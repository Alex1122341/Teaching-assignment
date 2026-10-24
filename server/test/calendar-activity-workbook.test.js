'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const JSZip=require('jszip');
const {makeWorkbook,syntheticPolicyFor}=require('./fixtures/calendar-activity-workbook');
const {parseActivityWorkbook,runActivityWorkbookWorker}=require('../src/calendar/activity-workbook');
const {approvedActivityImportPolicy,normalizeActivityNameKey}=require('../src/calendar/activity-import-policy');
const row={facultySourceName:'Synthetic Faculty',startDate:'2026-11-05',endDate:'2026-11-06',purpose:'CCC Day'};
async function parse(rows,options={},policyChanges={}){const bytes=await makeWorkbook(rows,options);return parseActivityWorkbook(bytes,syntheticPolicyFor(bytes,policyChanges));}

test('owner revision retains Remote work as Away instead of a Calendar work candidate',async()=>{
 const result=await parse([{...row,purpose:'Remote Work (approved)'}]);
 assert.equal(result.rows[0].treatment,'retain_afc');assert.equal(result.rows[0].category,null);
 assert.equal(result.rows[0].disposition,'away');assert.equal(result.rows[0].needsReview,false);
 assert.equal(approvedActivityImportPolicy('4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF').policyVersion,'afc-working-activities-v2');
});
test('abnormal rows are Away needing review without repairing identities, dates or duplicates',async()=>{
 const result=await parse([{...row,purpose:'Vacation'},{...row,purpose:'Vacation'},{...row,endDate:'2026-11-04'},{...row,facultySourceName:''},{...row,purpose:''}]);
 assert.equal(result.rows.length,5);
 for(const value of result.rows){assert.equal(value.disposition,'away');assert.equal(value.needsReview,true);assert.equal(value.treatment,'quarantined');assert.ok(value.issues.length);}
 assert.equal(result.rows[2].endDate,'2026-11-04');assert.equal(result.rows[3].facultySourceName,'');assert.equal(result.rows[4].originalLabel,'');
 assert.ok(result.rows[0].issues.includes('DUPLICATE_SOURCE_ROW'));assert.ok(result.rows[1].issues.includes('DUPLICATE_SOURCE_ROW'));
});
test('OPA and every approved absence category stay AFC',async()=>{
 const labels=['OPA','University Travel','Vacation','Vacation/University Travel','RSL','Special Leave','Medical','Parental Leave','Administrative Leave','Study Leave'];
 const result=await parse(labels.map(purpose=>({...row,purpose})));
 assert.deepEqual(result.rows.map(r=>r.treatment),Array(10).fill('retain_afc'));
});
test('exact working labels produce categories without inventing clock or course',async()=>{
 const labels=['CCC Day','Rotation Participant','Clinical Day / PPVM (external)','VETM 581 Clinical Rounds (12:30 - 4:30pm): 9 Sep 2026, 6 Jan 2027, 8 Apr 2027','571 - CLINICAL PHARMACOLOGY','VETM 591 IM Presentations (all day): 5 Apr 2027','Teaching Excellence Program(8-12:30pm)'];
 const result=await parse(labels.map(purpose=>({...row,purpose})));
 assert.deepEqual(result.rows.map(r=>r.category),['ccc','rotation_participant','clinical_day','vetm581_rounds','vetm571_clinical_pharmacology','vetm591_presentations','teaching_excellence']);
 for(const value of result.rows){assert.equal(value.treatment,'working_candidate');assert.equal(value.startTime,undefined);assert.equal(value.courseCode,undefined);}
});
test('source dates span May1 and weekends without clipping or fabricated year',async()=>{
 const value=(await parse([{...row,startDate:'2026-01-11',endDate:'2027-08-31'}])).rows[0];
 assert.equal(value.startDate,'2026-01-11');assert.equal(value.endDate,'2027-08-31');assert.equal(value.academicYear,undefined);
});
test('1904 and ISO string date cells preserve calendar dates',async()=>{
 const value=(await parse([{...row,startValue:'2026-11-05'}],{date1904:true})).rows[0];
 assert.equal(value.startDate,'2026-11-05');assert.equal(value.endDate,'2026-11-06');assert.deepEqual(value.issues,[]);
});
test('source row numbers and hash-bound departed exclusions survive blank formatting',async()=>{
 const result=await parse([{...row,sourceRow:267}],{}, {excludedRows:[267]});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].sourceRow,267);assert.equal(result.rows[0].treatment,'excluded');
});
test('all duplicate members are quarantined without silently dropping absence history',async()=>{
 const result=await parse([{...row,purpose:'Vacation'},{...row,purpose:'vacation '}]);
 assert.equal(result.rows.length,2);
 for(const value of result.rows){assert.equal(value.treatment,'quarantined');assert.ok(value.issues.includes('DUPLICATE_SOURCE_ROW'));}
});
test('malformed values and unknown labels are quarantined individually',async()=>{
 const result=await parse([{...row,endDate:'2026-11-04'},{...row,facultySourceName:''},{...row,purpose:''},{...row,purpose:'Teaching somewhere'},{...row,startValue:'2026-02-30'},{...row,startValue:60},{...row,startValue:new Date('2026-11-05T12:00:00Z')}]);
 assert.equal(result.rows.length,7);assert.ok(result.rows.every(r=>r.treatment==='quarantined'));
 assert.ok(result.rows[0].issues.includes('END_BEFORE_START'));
 assert.ok(result.rows[1].issues.includes('MISSING_FACULTY'));
 assert.ok(result.rows[2].issues.includes('MISSING_PURPOSE'));
 assert.ok(result.rows[3].issues.includes('UNCLASSIFIED_PURPOSE'));
});
test('cached formulas in approved fields never become imported values',async()=>{
 const result=await parse([{...row,purposeValue:{formula:'"CCC Day"',result:'CCC Day'}},{...row,startValue:{formula:'DATE(2026,11,5)',result:46331}}]);
 assert.ok(result.rows.every(r=>r.treatment==='quarantined'&&r.issues.includes('FORMULA_NOT_ALLOWED')));
});
test('auxiliary cells and ignored external formulas do not become activity records',async()=>{
 const value=await parse([{...row,auxiliary:'private auxiliary'}],{ignoredFormula:true});
 assert.equal(value.rows.length,1);assert.equal(value.rows[0].treatment,'working_candidate');assert.equal(JSON.stringify(value).includes('private'),false);
});
test('wrong headers fail rather than guessing a source schema',async()=>{
 await assert.rejects(()=>parse([row],{headers:['Person','Start','End','Purpose']}),{code:'INVALID_SOURCE'});
});
test('name keys preserve accents and punctuation but normalize the closed whitespace set',()=>{
 assert.equal(normalizeActivityNameKey("  Zoë\u00a0 O'Connor ,\t Jr  "),"ZOË O'CONNOR, JR");
 assert.notEqual(normalizeActivityNameKey('Anne-Marie'),normalizeActivityNameKey('Anne Marie'));
});
test('approved production policy is closed and includes the departed source rows',()=>{
 const p=approvedActivityImportPolicy('4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF');
 assert.deepEqual(p.excludedRows,[267,297,563,773]);assert.equal(p.dataset,'afc-working-activities');
 assert.throws(()=>approvedActivityImportPolicy('0'.repeat(64)),{code:'APPROVED_SOURCE_REQUIRED'});
});
test('claimed hash cannot authorize different bytes',async()=>{
 const bytes=await makeWorkbook([row]);
 await assert.rejects(()=>parseActivityWorkbook(bytes,syntheticPolicyFor(bytes,{sourceSha256:'0'.repeat(64)})),{code:'APPROVED_SOURCE_REQUIRED'});
});
test('compressed size is bounded before any worker allocation',async()=>{
 const bytes=Buffer.alloc(524289);await assert.rejects(()=>parseActivityWorkbook(bytes,syntheticPolicyFor(bytes)),{code:'IMPORT_LIMIT'});
});
test('truncated archives are rejected',async()=>{
 const bytes=(await makeWorkbook([row])).subarray(0,400);
 await assert.rejects(()=>parseActivityWorkbook(bytes,syntheticPolicyFor(bytes)),{code:'INVALID_SOURCE'});
});
test('actual expansion and archive-entry limits reject small compressed bombs',async()=>{
 for(const kind of ['expansion','entries']){
  const zip=new JSZip();
  if(kind==='expansion')zip.file('large.xml','a'.repeat(16777217));else for(let i=0;i<1025;i++)zip.file('entry-'+i,'x');
  const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  await assert.rejects(()=>parseActivityWorkbook(bytes,syntheticPolicyFor(bytes)),{code:'IMPORT_LIMIT'});
 }
});
test('path traversal and macro payloads fail even when no extraction is requested',async()=>{
 for(const name of ['../private.xml','xl/vbaProject.bin']){
  const zip=new JSZip();zip.file(name,'payload');
  const bytes=await zip.generateAsync({type:'nodebuffer'});
  await assert.rejects(()=>parseActivityWorkbook(bytes,syntheticPolicyFor(bytes)),{code:'INVALID_SOURCE'});
 }
});
test('CRC-corrupted stored entries fail before a workbook is parsed',async()=>{
 const zip=new JSZip();zip.file('visible.txt','unique-crc-test');
 const bytes=await zip.generateAsync({type:'nodebuffer',compression:'STORE'});
 const offset=bytes.indexOf(Buffer.from('unique-crc-test'));bytes[offset]=bytes[offset]^1;
 await assert.rejects(()=>parseActivityWorkbook(bytes,syntheticPolicyFor(bytes)),{code:'INVALID_SOURCE'});
});
test('selected populated-row cap excludes oversized imports rather than truncating',async()=>{
 await assert.rejects(()=>parse(Array.from({length:5001},(_,i)=>({...row,facultySourceName:'Synthetic '+i}))),{code:'IMPORT_LIMIT'});
});
test('worker timeout releases parser capacity and reports a safe error',async()=>{
 const {EventEmitter}=require('node:events');
 class HungWorker extends EventEmitter {terminate(){return Promise.resolve(0);} }
 await assert.rejects(()=>runActivityWorkbookWorker(Buffer.from('x'),{}, {WorkerClass:HungWorker,deadlineMs:5}),{code:'IMPORT_PARSE_TIMEOUT'});
});
test('worker errors settle once without leaking private diagnostics',async()=>{
 const {EventEmitter}=require('node:events');
 class BadWorker extends EventEmitter {constructor(){super();setImmediate(()=>this.emit('error',new Error('private path secret')));}terminate(){return Promise.resolve(0);}}
 await assert.rejects(()=>runActivityWorkbookWorker(Buffer.from('x'),{}, {WorkerClass:BadWorker}),error=>error.code==='INVALID_SOURCE'&&!error.message.includes('secret'));
});
test('two busy workers reject excess work and free capacity after timeout',async()=>{
 const {EventEmitter}=require('node:events');
 class HungWorker extends EventEmitter {terminate(){return Promise.resolve(0);}}
 const pending=Promise.allSettled([1,2].map(()=>runActivityWorkbookWorker(Buffer.from('x'),{}, {WorkerClass:HungWorker,deadlineMs:30})));
 await assert.rejects(()=>runActivityWorkbookWorker(Buffer.from('x'),{}, {WorkerClass:HungWorker}),{code:'IMPORT_BUSY'});
 assert.ok((await pending).every(r=>r.status==='rejected'&&r.reason.code==='IMPORT_PARSE_TIMEOUT'));
 class ReplyWorker extends EventEmitter {constructor(){super();setImmediate(()=>this.emit('message',{ok:true,result:{parsed:true}}));}terminate(){return Promise.resolve(0);}}
 assert.deepEqual(await runActivityWorkbookWorker(Buffer.from('x'),{}, {WorkerClass:ReplyWorker}),{parsed:true});
});
test('duplicate archive paths and encrypted flags are rejected',async()=>{
 const zip=new JSZip();zip.file('aa.xml','one');zip.file('bb.xml','two');
 const original=await zip.generateAsync({type:'nodebuffer',compression:'STORE'});
 const duplicate=Buffer.from(original);let at=duplicate.indexOf('bb.xml');
 while(at!==-1){Buffer.from('aa.xml').copy(duplicate,at);at=duplicate.indexOf('bb.xml',at+6);}
 await assert.rejects(()=>parseActivityWorkbook(duplicate,syntheticPolicyFor(duplicate)),{code:'INVALID_SOURCE'});
 const encrypted=Buffer.from(original);const central=encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
 encrypted.writeUInt16LE(encrypted.readUInt16LE(central+8)|1,central+8);
 await assert.rejects(()=>parseActivityWorkbook(encrypted,syntheticPolicyFor(encrypted)),{code:'INVALID_SOURCE'});
});
test('forged expanded-byte metadata cannot bypass actual stream limits',async()=>{
 const zip=new JSZip();zip.file('large.xml','a'.repeat(16777217));
 const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 const central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bytes.writeUInt32LE(1,central+24);
 await assert.rejects(()=>parseActivityWorkbook(bytes,syntheticPolicyFor(bytes)),{code:'IMPORT_LIMIT'});
});
