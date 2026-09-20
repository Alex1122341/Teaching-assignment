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
 assert.equal(rows.length,2);assert.equal(facultyRow.assignedTeachingDoe,40);assert.equal(facultyRow.teachingLineCount,1);
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
