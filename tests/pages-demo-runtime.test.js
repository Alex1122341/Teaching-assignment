'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const runtime=require('../tools/pages-demo-runtime.js');

test('Pages demo store supports reads, writes, merge and reset without cloud state',()=>{
  const memory=new Map();
  const storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
  const seed={documents:[{path:'users/u1',data:{name:'Demo',role:'faculty',active:true}},{path:'sessions/s1',data:{date:'2027-01-11',facultyIds:['f1'],count:1}}]};
  const store=runtime.createStore(seed,storage);
  assert.equal(store.read('users/u1').name,'Demo');
  store.write('sessions/s1',{count:runtime.FieldValue.increment(2)},{merge:true});
  assert.equal(store.read('sessions/s1').count,3);
  store.write('sessions/s1',{note:'x'},{merge:true});
  assert.equal(store.read('sessions/s1').note,'x');
  store.reset();
  assert.equal(store.read('sessions/s1').count,1);
  assert.equal(store.read('sessions/s1').note,undefined);
});

test('Pages demo resets persisted browser data when the canonical seed version changes',()=>{
  const memory=new Map(),storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
  const first=runtime.createStore({version:1,documents:[{path:'sessions/s1',data:{topic:'Old seed'}}]},storage);
  first.update('sessions/s1',{topic:'Browser edit'});
  assert.equal(first.read('sessions/s1').topic,'Browser edit');
  const same=runtime.createStore({version:1,documents:[{path:'sessions/s1',data:{topic:'Old seed'}}]},storage);
  assert.equal(same.read('sessions/s1').topic,'Browser edit');
  const upgraded=runtime.createStore({version:2,documents:[{path:'sessions/s1',data:{topic:'New seed'}}]},storage);
  assert.equal(upgraded.read('sessions/s1').topic,'New seed');
});

test('Pages demo query filter helper covers timetable query operators',()=>{
  const row={date:'2027-01-11',facultyIds:['f1','f2'],year:2};
  assert.equal(runtime.filterMatches(row,'date','>=','2027-01-01'),true);
  assert.equal(runtime.filterMatches(row,'date','<=','2027-01-31'),true);
  assert.equal(runtime.filterMatches(row,'facultyIds','array-contains','f2'),true);
  assert.equal(runtime.filterMatches(row,'year','in',[1,2,3]),true);
  assert.equal(runtime.filterMatches(row,'year','==',2),true);
});

test('Pages demo Firebase auto-signs a synthetic admin and persists browser-local writes',async()=>{
  const values=new Map();
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const sessionStorage={setItem(){}};
  const seed={documents:[
    {path:'users/uid-adfa-general',data:{name:'ADFA General',role:'adfa_general',active:true,mustChangePassword:false}},
    {path:'sessions/s1',data:{date:'2027-01-11',topic:'Before'}}
  ]};
  const root={localStorage:storage,sessionStorage,document:{readyState:'loading',addEventListener(){},getElementById(){return null},createElement(){return{}},head:{appendChild(){}},body:{appendChild(){}}},location:{reload(){}}};
  const demo=runtime.createDemoFirebase(root,seed);
  assert.equal(demo.auth.currentUser.uid,'uid-developer');
  const db=demo.firebase.firestore();
  await db.collection('sessions').doc('s1').update({topic:'After'});
  assert.equal((await db.collection('sessions').doc('s1').get()).data().topic,'After');
});


test('Pages demo defaults role testing to Developer and exposes synthetic DOE summaries',()=>{
 const source=require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../tools/pages-demo-runtime.js'),'utf8');
 assert.match(source,/DEFAULT_UID='uid-developer'/);assert.match(source,/DEMO ROLE TESTER/);assert.match(source,/Test as role/);
 const memory=new Map(),storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
 const seed={documents:[
  {path:'users/uid-developer',data:{name:'VISTA Developer',role:'developer',active:true,mustChangePassword:false}},
  {path:'faculty/f1',data:{firstName:'Demo',lastName:'Faculty',doe:40,facultySummary2026_27:{assignedTeachingDOE:40},managedRoles2026_27:[]}},
  {path:'sessions/s1',data:{assignments:[{facultyId:'f1',doeCredit:10}]}}
 ]};
 const store=runtime.createStore(seed,storage),rows=runtime.demoDoeRows(store,'2026-27'),facultyRow=rows.find(row=>row.facultyId==='f1'),serverOnly=rows.find(row=>row.facultyId==='demo-server-only');
 assert.equal(rows.length,2);
 // The DOE List now reports the calculation, not the legacy summary value, so the
 // row is internally consistent: scheduled teaching is the aggregated DOE credit
 // and the effective target comes from the existing contract Teaching DOE.
 assert.equal(facultyRow.scheduledTeachingDoe,10);
 assert.equal(facultyRow.assignedTeachingDoe,10);
 assert.equal(facultyRow.effectiveTargetDoe,40);
 assert.equal(facultyRow.remainingDoe,30);
 assert.equal(facultyRow.teachingLineCount,1);
 assert.ok(serverOnly);assert.equal(serverOnly.serverOnlyDemo,true);assert.equal(serverOnly.assignedTeachingDoe,22);
});


test('Pages demo secondary Auth creates a synthetic login without replacing Developer',async()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},sessionStorage={setItem(){}};
 const seed={documents:[{path:'users/uid-developer',data:{name:'VISTA Developer',email:'developer@example.test',role:'developer',active:true,mustChangePassword:false}}]};
 const root={localStorage:storage,sessionStorage,document:{readyState:'loading',addEventListener(){},getElementById(){return null},createElement(){return{}},head:{appendChild(){}},body:{appendChild(){}}},location:{reload(){}}};
 const demo=runtime.createDemoFirebase(root,seed),app=demo.firebase.initializeApp({projectId:'demo'},'ucvm-provisioning'),secondary=app.auth();
 assert.equal(demo.auth.currentUser.uid,'uid-developer');assert.equal(secondary.currentUser,null);
 const credential=await secondary.createUserWithEmailAndPassword('new.office@example.test','DemoPass123!');
 assert.match(credential.user.uid,/^demo-auth-[0-9a-f]{8}$/);assert.equal(credential.user.email,'new.office@example.test');assert.equal(demo.auth.currentUser.uid,'uid-developer');
 await assert.rejects(()=>secondary.createUserWithEmailAndPassword('new.office@example.test','DemoPass123!'),error=>error.code==='auth/email-already-in-use');
 await secondary.signOut();assert.equal(demo.auth.currentUser.uid,'uid-developer');
 demo.reset();
 const recreated=await secondary.createUserWithEmailAndPassword('new.office@example.test','DemoPass123!');
 assert.equal(recreated.user.uid,credential.user.uid);assert.equal(demo.auth.currentUser.uid,'uid-developer');
});

// ---------------------------------------------------------------------------
// Frontend Demo DOE calculation (spec section 19 / 23H)
// ---------------------------------------------------------------------------
const doeSeed={documents:[
 {path:'faculty/f1',data:{preferredFullName:'Dr One',doe:40,facultySummary2026_27:{assignedTeachingDOE:40}}},
 {path:'faculty/f2',data:{preferredFullName:'Dr Two',doe:30,facultySummary2026_27:{assignedTeachingDOE:30}}},
 {path:'faculty/f3',data:{preferredFullName:'Dr Override',doe:40,doeOverride2026_27:{value:28,reason:'0.8 FTE'}}},
 {path:'sessions/s1',data:{course:'601',topic:'Neuro',assignments:[{facultyId:'f1',name:'Dr One',role:'Lecture',creditedHours:2,doeRate:6,doeCredit:12}]}},
 {path:'sessions/s2',data:{course:'602',topic:'Anatomy',assignments:[{facultyId:'f1',name:'Dr One',role:'Lecture',creditedHours:2,doeRate:4,doeCredit:8}]}},
 {path:'sessions/s3',data:{course:'603',topic:'No evidence',assignments:[{facultyId:'f2',name:'Dr Two',role:'Lecture'}]}}
]};
const doeStore=()=>{const memory=new Map();return runtime.createStore(doeSeed,{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)})};

test('demo DOE List and worksheet are produced from one shared calculation source',()=>{
 const store=doeStore(),rows=runtime.demoDoeRows(store,'2026-27'),worksheet=runtime.demoDoeWorksheet(store,'f1','2026-27');
 const row=rows.find(item=>item.facultyId==='f1');
 assert.ok(row);assert.ok(worksheet);
 assert.equal(row.scheduledTeachingDoe,worksheet.totals.scheduledTeachingDoe);
 assert.equal(row.assignedTeachingDoe,worksheet.totals.assignedTeachingDoe);
 assert.equal(row.effectiveTargetDoe,worksheet.totals.effectiveTargetDoe);
 assert.equal(row.remainingDoe,worksheet.totals.remainingDoe);
 assert.equal(runtime.demoDoeWorksheet(store,'nobody','2026-27'),null);
});

test('a normal demo Faculty row is internally consistent',()=>{
 const rows=runtime.demoDoeRows(doeStore(),'2026-27'),row=rows.find(item=>item.facultyId==='f1');
 assert.equal(row.status,'calculated');
 assert.equal(row.scheduledTeachingDoe,20);
 assert.equal(row.effectiveTargetDoe,40);
 assert.equal(row.assignedTeachingDoe,20);
 assert.equal(row.remainingDoe,20);
 assert.equal(row.teachingLineCount,2);
 assert.equal(row.unratedLineCount,0);
 assert.equal(row.demoOnly,true);
 assert.equal(row.authoritative,false);
 // Every faculty record is listed; no row is dropped to fabricate gaps.
 assert.deepEqual(rows.map(item=>item.facultyId).sort(),['demo-server-only','f1','f2','f3']);
});

test('the worksheet carries one calculation line per assignment with evidence',()=>{
 const worksheet=runtime.demoDoeWorksheet(doeStore(),'f1','2026-27');
 assert.equal(worksheet.lines.length,2);
 for(const line of worksheet.lines){
  assert.equal(line.status,'calculated');
  assert.equal(typeof line.resultDoe,'number');
  assert.equal(line.sourceEntityType,'session_assignment');
  assert.match(line.lineId,/^s\d+--\d+$/);
  assert.ok(line.courseCode);
  assert.ok(line.calculationText);
  assert.ok(line.ruleKey);
  assert.ok(line.policyVersionId);
  assert.ok(line.calculationId);
 }
 assert.equal(worksheet.label,'Frontend Demo DOE — non-authoritative');
 assert.equal(worksheet.authoritative,false);
});

test('an assignment without DOE evidence becomes Needs Review instead of assuming zero',()=>{
 const store=doeStore(),rows=runtime.demoDoeRows(store,'2026-27'),row=rows.find(item=>item.facultyId==='f2');
 assert.equal(row.status,'needs_review');
 assert.equal(row.unratedLineCount,1);
 // No fabricated total: a total is withheld rather than reported as 0.
 assert.equal(row.assignedTeachingDoe,null);
 assert.equal(row.remainingDoe,null);
 assert.equal(row.scheduledTeachingDoe,0);
 const worksheet=runtime.demoDoeWorksheet(store,'f2','2026-27');
 assert.equal(worksheet.status,'needs_review');
 assert.equal(worksheet.lines.length,1);
 assert.equal(worksheet.lines[0].status,'needs_review');
 assert.equal(worksheet.lines[0].resultDoe,null);
 assert.equal(worksheet.lines[0].errorCode,'DOE_SOURCE_PROVENANCE_INCOMPLETE');
 assert.equal(worksheet.totals.assignedTeachingDoe,null);
 assert.ok(worksheet.errors.length>0);
});

test('an explicit demo override wins over the contract Teaching DOE target',()=>{
 const row=runtime.demoDoeRows(doeStore(),'2026-27').find(item=>item.facultyId==='f3');
 assert.equal(row.effectiveTargetDoe,28);
});

test('reconciliation fixtures cover the six states without corrupting normal DOE rows',()=>{
 const store=doeStore(),rows=runtime.demoDoeRows(store,'2026-27'),fixtures=runtime.demoReconciliationRows(store,'2026-27');
 const states=fixtures.map(row=>row.status).sort();
 for(const status of ['different_doe','legacy_only','matched','missing_mapping','needs_review','server_only'])assert.ok(states.includes(status),status);
 assert.ok(fixtures.every(row=>row.reconciliationFixture===true&&row.demoOnly===true));
 // Normal Faculty rows stay internally consistent: the healthy row equals its own worksheet.
 for(const row of rows.filter(item=>!item.serverOnlyDemo)){
  const worksheet=runtime.demoDoeWorksheet(store,row.facultyId,'2026-27');
  assert.equal(row.assignedTeachingDoe,worksheet.totals.assignedTeachingDoe);
  assert.equal(row.scheduledTeachingDoe,worksheet.totals.scheduledTeachingDoe);
 }
 assert.equal(rows.find(item=>item.facultyId==='f1').status,'calculated');
});

test('demo DOE rows never present a reconciliation anomaly as a normal Faculty result',()=>{
 const rows=runtime.demoDoeRows(doeStore(),'2026-27');
 for(const row of rows){
  if(row.serverOnlyDemo)continue;
  assert.notEqual(row.issueCodes.includes('COURSE_MAPPING_REQUIRED'),true,row.facultyId);
  assert.equal(row.authoritative,false);
 }
});


test('Frontend Demo exposes a non-authoritative read-only DOE Rule Book fixture',async()=>{
 const service=runtime.demoRulebookService('2026-27');
 assert.equal(service.readOnly,true);assert.equal(service.authoritative,false);assert.equal(service.demoOnly,true);
 const policies=await service.listPolicies();assert.equal(policies.length,1);assert.equal(policies[0].academicYear,'2026-27');
 const versions=await service.listVersions(policies[0].policyId);assert.equal(versions.length,1);assert.equal(versions[0].status,'active');
 const bundle=await service.loadPolicyBundle(versions[0].policyVersionId);assert.ok(bundle.rules.some(row=>row.category==='teaching'));assert.ok(bundle.rules.some(row=>row.category==='role'));assert.ok(bundle.courseMappings.length);assert.ok(bundle.subjectMappings.length);
 const audit=await service.listAudit(versions[0].policyVersionId);assert.equal(audit.length,1);
 await assert.rejects(()=>service.saveRule(versions[0].policyVersionId,{}),error=>error.code==='FRONTEND_DEMO_READ_ONLY'&&/read-only/i.test(error.message));
});
