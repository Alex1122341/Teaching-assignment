const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('maintenance helpers replace and remove sessions without losing faculty IDs',()=>{
 const api=require(path.join(root,'index-maintenance.js'));
 const next={id:'s2',assignments:[{ucid:'1002'},{facultyId:'1001'}]};
 const replaced=api.replaceSession([{id:'s1'},{id:'s2',assignments:[]}],next);
 assert.deepEqual(replaced.find(x=>x.id==='s2').facultyIds,['1001','1002']);
 assert.deepEqual(api.removeSession(replaced,'s1').map(x=>x.id),['s2']);
});

test('session writes add derived faculty IDs',()=>{
 const index=read('timetable.js'),admin=read('faculty-admin.js'),approval=read('approval-workflow.js');
 assert.match(index,/UCVM_INDEX_MAINTENANCE\.sessionForWrite\(s\)/);
 assert.match(admin,/UCVM_INDEX_MAINTENANCE\.sessionForWrite\(rec\)/);
 assert.match(approval,/patch\.facultyIds=UCVM_DATA_INDEX\.sessionFacultyIds/);
});

test('session mutations update derived settings from exact before and after records',()=>{
 const index=read('timetable.js'),approval=read('approval-workflow.js'),admin=read('faculty-admin.js'),maintenance=read('index-maintenance.js');
 assert.match(index,/UCVM_INDEX_MAINTENANCE\.updateDerivedIndexes\(db,changes/);
 assert.match(index,/\{before:existing\|\|null,after:next\}/);
 assert.match(index,/\{before:s,after:null\}/);
 assert.match(approval,/updateDerivedIndexes\?\.\(\[\{before:current,after/);
 assert.match(admin,/writeDerivedIndexes/);
 assert.match(maintenance,/faculty_index/);
 assert.match(maintenance,/schedule_stats/);
});

test('derived settings writes are limited to administrators',()=>{
 const rules=read('firestore.rules');
 assert.match(rules,/id in \['faculty_index','schedule_stats','faculty_swap_index','faculty_swap_map'\].*admin\(\)/s);
});

test('session deltas update totals, courses, faculty counts, and assigned DOE',()=>{
 const api=require(path.join(root,'index-maintenance.js'));
 const facultyIndex={entries:[
  {id:'1001',name:'Alex',sessionCount:1,assignedTeachingDOE:5},
  {id:'1002',name:'Blair',sessionCount:0,assignedTeachingDOE:10}
 ]};
 const stats={sessionCount:1,assignedFacultyCount:1,courseCounts:{200:1}};
 const before={id:'s1',course:'200',assignments:[{ucid:'1001',doeCredit:5}]};
 const after={id:'s1',course:'204',assignments:[{ucid:'1002',doeCredit:2.5}]};
 const result=api.applySessionChanges(facultyIndex,stats,[{before,after}]);
 assert.deepEqual(result.scheduleStats,{sessionCount:1,assignedFacultyCount:1,courseCounts:{204:1}});
 assert.deepEqual(result.facultyIndex.entries,[
  {id:'1001',name:'Alex',sessionCount:0,assignedTeachingDOE:0},
  {id:'1002',name:'Blair',sessionCount:1,assignedTeachingDOE:12.5}
 ]);
 assert.deepEqual(facultyIndex.entries[0],{id:'1001',name:'Alex',sessionCount:1,assignedTeachingDOE:5});
});

test('create and delete session deltas are reversible and empty changes are idempotent',()=>{
 const api=require(path.join(root,'index-maintenance.js'));
 const index={entries:[{id:'1001',sessionCount:0,assignedTeachingDOE:7}]},stats={sessionCount:0,assignedFacultyCount:0,courseCounts:{}};
 const session={id:'s1',course:'300',assignments:[{facultyId:'1001',doeCredit:1.25}]};
 const added=api.applySessionChanges(index,stats,[{before:null,after:session}]);
 assert.deepEqual(added.scheduleStats,{sessionCount:1,assignedFacultyCount:1,courseCounts:{300:1}});
 assert.deepEqual(added.facultyIndex.entries,[{id:'1001',sessionCount:1,assignedTeachingDOE:8.25}]);
 const removed=api.applySessionChanges(added.facultyIndex,added.scheduleStats,[{before:session,after:null}]);
 assert.deepEqual(removed,{facultyIndex:index,scheduleStats:stats});
 assert.deepEqual(api.applySessionChanges(index,stats,[]),{facultyIndex:index,scheduleStats:stats});
});

function fakeSettingsDb(docs){
 return{collection:name=>{assert.equal(name,'settings');return{doc:id=>({get:async()=>Object.prototype.hasOwnProperty.call(docs,id)?{exists:true,data:()=>docs[id]}:{exists:false,data:()=>undefined}})}}};
}

function fullVerifierFixture(){
 const api=require(path.join(root,'index-maintenance.js'));
 const dataIndex=require(path.join(root,'data-index.js'));
 const faculty=[
  {__id:'1001',preferredFullName:'Alex',active:true,doe:{teaching:20}},
  {__id:'1002',preferredFullName:'Blair',active:true,doe:{teaching:20}}
 ];
 const sessions=[{id:'s1',course:'200',assignments:[{ucid:'1001',doeCredit:2}]}];
 const privateMap={schemaVersion:'ucvm-faculty-swap-map-v1',entries:[
  {key:'key-a',facultyId:'1001'},
  {key:'key-b',facultyId:'1002'}
 ]};
 const swap=dataIndex.buildFacultySwapIndexes(faculty,privateMap,()=>{throw Error('verify must not allocate keys')});
 const base=api.derivedDocuments(faculty,sessions);
 return{api,faculty,sessions,docs:{
  faculty_index:{...base.facultyIndex,generatedAt:'old',generatedBy:'u',generatedByName:'N'},
  schedule_stats:{...base.scheduleStats,generatedAt:'old'},
  faculty_swap_index:{...swap.publicIndex,generatedAt:'old'},
  faculty_swap_map:{...swap.privateMap,generatedAt:'old',generatedBy:'u',generatedByName:'N'}
 }};
}

test('full verifier returns HEALTHY and ignores generation metadata',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions});
 assert.equal(result.ok,true);
 assert.equal(result.severity,'healthy');
 assert.equal(result.mismatchCount,0);
 assert.deepEqual(result.documents,{
  faculty_index:'healthy',schedule_stats:'healthy',faculty_swap_index:'healthy',faculty_swap_map:'healthy'
 });
});

test('full verifier reports exact schedule_stats path and values',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 docs.schedule_stats.courseCounts['200']=9;
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions});
 assert.equal(result.severity,'mismatch');
 assert.ok(result.mismatches.some(row=>row.document==='schedule_stats'&&row.path==='courseCounts.200'&&row.expected===1&&row.actual===9));
});

test('legacy provisional verifier name delegates to full structured verification',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 docs.schedule_stats.sessionCount=99;
 const result=await api.verifyDerivedIndexesProvisional(fakeSettingsDb(docs),faculty,sessions);
 assert.equal(result.severity,'mismatch');
 assert.ok(result.mismatches.some(row=>row.document==='schedule_stats'&&row.path==='sessionCount'));
});

test('new active faculty without private mapping is repairable and verify allocates nothing',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 faculty.push({__id:'1003',preferredFullName:'Casey',active:true});
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions});
 assert.equal(result.severity,'mismatch');
 assert.ok(result.mismatches.some(row=>row.issue==='missing-new-faculty-key'&&row.path==='faculty.1003'));
});

test('duplicate private key ownership is critical',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 docs.faculty_swap_map.entries[1].key='key-a';
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions});
 assert.equal(result.severity,'critical');
 assert.equal(result.documents.faculty_swap_map,'critical');
 assert.ok(result.mismatches.some(row=>row.issue==='duplicate-key-ownership'));
});

test('missing and invalid derived documents are named explicitly',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 delete docs.faculty_index;
 docs.schedule_stats='broken';
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions});
 assert.ok(result.mismatches.some(row=>row.document==='faculty_index'&&row.issue==='document-missing'));
 assert.ok(result.mismatches.some(row=>row.document==='schedule_stats'&&row.issue==='invalid-structure'));
});

test('verifier counts all mismatches but returns at most 50 details',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 docs.faculty_index.entries=Array.from({length:80},(_,i)=>({id:String(i),name:`Wrong ${i}`}));
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions,maxDetails:50});
 assert.ok(result.mismatchCount>50);
 assert.equal(result.mismatches.length,50);
});

function fakeBatchDb(initial={}){
 const docs=new Map(Object.entries(initial)),commits=[];let generated=0;
 const makeRef=id=>({id,get:async()=>docs.has(id)?{exists:true,data:()=>docs.get(id)}:{exists:false,data:()=>undefined}});
 return{
  commits,
  collection(name){if(name!=='settings')throw Error(`unexpected collection ${name}`);return{doc(id){return id===undefined?{id:`generated-${++generated}`} : makeRef(id)}}},
  batch(){const writes=[];return{set(ref,data){writes.push({id:ref.id,data})},async commit(){for(const write of writes)docs.set(write.id,write.data);commits.push(writes)}}}
 };
}

test('writeDerivedIndexes commits all four settings documents in one batch',async()=>{
 const api=require(path.join(root,'index-maintenance.js'));
 const db=fakeBatchDb({
  faculty_swap_map:{schemaVersion:'ucvm-faculty-swap-map-v1',entries:[{key:'stable',facultyId:'1001'}]},
  faculty_swap_index:{schemaVersion:'ucvm-faculty-swap-index-v1',entries:[{key:'stable',name:'Alex',aliases:['Alex'],unavailableRanges:[]}]}
 });
 await api.writeDerivedIndexes(db,[{__id:'1001',preferredFullName:'Alex',active:true}],[],{uid:'g',name:'General'});
 assert.equal(db.commits.length,1);
 assert.deepEqual(db.commits[0].map(row=>row.id).sort(),['faculty_index','faculty_swap_index','faculty_swap_map','schedule_stats']);
});

test('incremental derived DOE maintenance preserves missing-credit error state instead of treating it as zero',()=>{
 const api=require(path.join(root,'index-maintenance.js'));
 const dataIndex=require(path.join(root,'data-index.js'));
 const faculty=[{__id:'1001',preferredFullName:'Alex',facultySummary2026_27:{sourceNonTimetableTeachingDOE:2}}];
 const before={id:'s1',assignments:[{ucid:'1001',doeCredit:1,doePolicyVersionId:'policy-v1'}]};
 const initial=dataIndex.buildFacultyIndex(faculty,[before]);
 const after={id:'s1',assignments:[{ucid:'1001',creditedHours:4,doeRate:.3}]};
 const result=api.applySessionChanges(initial,{sessionCount:1,assignedFacultyCount:1,courseCounts:{}},[{before,after}]);
 const entry=result.facultyIndex.entries[0];
 assert.equal(entry.missingDoeCount,1);
 assert.equal(entry.calculationStatus,'error');
 assert.equal(entry.assignedTeachingDOE,2);
});
