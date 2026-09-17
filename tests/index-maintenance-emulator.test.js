'use strict';
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../index-maintenance.js');

const PROJECT_ID='demo-ucvm-derived-index';
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
const check=(name,fn)=>test(name,{skip:!enabled,concurrency:false},fn);
let env;

function compatDb(modularDb){
 const f=require('firebase/firestore');
 const wrap=(collectionName,id)=>({
  id,
  _native:f.doc(modularDb,collectionName,id),
  get:async()=>{const snap=await f.getDoc(f.doc(modularDb,collectionName,id));return{exists:snap.exists(),id:snap.id,data:()=>snap.data()}}
 });
 return{
  collection(name){return{
   doc(id){if(id===undefined){const native=f.doc(f.collection(modularDb,name));return{id:native.id,_native:native}}return wrap(name,id)},
   async get(){const snap=await f.getDocs(f.collection(modularDb,name));return{docs:snap.docs.map(row=>({id:row.id,data:()=>row.data()}))}}
  }},
  batch(){const native=f.writeBatch(modularDb);return{set(ref,data){native.set(ref._native,data)},commit(){return native.commit()}}}
 };
}

const faculty=[
 {__id:'f1',preferredFullName:'Faculty One',active:true,email:'f1@ucvm.test',awayFromCampusRecords:[{startDate:'2026-10-01',endDate:'2026-10-03'}]},
 {__id:'f2',preferredFullName:'Faculty Two',active:true,email:'f2@ucvm.test'}
];
const sessions=[{id:'s1',course:'301',date:'2026-09-08',assignments:[{ucid:'f1',doeCredit:2}]}];

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:PROJECT_ID,firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
});
after(async()=>{if(env)await env.cleanup()});

async function seedHealthy(){
 const {doc,setDoc}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,'users/general'),{active:true,email:'general@ucvm.test',mustChangePassword:false,role:'adfa_general',name:'General'});
  for(const row of faculty){const {__id,...data}=row;await setDoc(doc(db,`faculty/${__id}`),data)}
  for(const row of sessions){const {id,...data}=row;await setDoc(doc(db,`sessions/${id}`),data)}
  await api.writeDerivedIndexes(compatDb(db),faculty,sessions,{uid:'general',name:'General'});
 });
}

beforeEach(async()=>{if(!enabled)return;await env.clearFirestore();await seedHealthy()});

const generalDb=()=>compatDb(env.authenticatedContext('general').firestore());

check('missing faculty_index is detected, rebuilt, and HEALTHY afterward',async()=>{
 const {doc,deleteDoc}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async context=>deleteDoc(doc(context.firestore(),'settings/faculty_index')));
 const beforeReport=await api.verifyDerivedIndexes(generalDb());
 assert.equal(beforeReport.severity,'mismatch');
 assert.ok(beforeReport.mismatches.some(row=>row.document==='faculty_index'&&row.issue==='document-missing'));
 const afterReport=await api.rebuildDerivedIndexes(generalDb(),{uid:'general',name:'General'});
 assert.equal(afterReport.ok,true);
 assert.equal(afterReport.severity,'healthy');
});

check('wrong schedule count reports exact values then rebuilds cleanly',async()=>{
 const {doc,setDoc}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'settings/schedule_stats'),{sessionCount:9,assignedFacultyCount:1,courseCounts:{301:9}}));
 const beforeReport=await api.verifyDerivedIndexes(generalDb());
 assert.equal(beforeReport.severity,'mismatch');
 assert.ok(beforeReport.mismatches.some(row=>row.document==='schedule_stats'&&row.path==='courseCounts.301'&&row.expected===1&&row.actual===9));
 const afterReport=await api.rebuildDerivedIndexes(generalDb(),{uid:'general',name:'General'});
 assert.equal(afterReport.ok,true);
});

check('stale public swap display and AFC ranges repair without changing private key',async()=>{
 const {doc,getDoc,setDoc}=require('firebase/firestore');
 const raw=env.authenticatedContext('general').firestore();
 const beforeMap=(await getDoc(doc(raw,'settings/faculty_swap_map'))).data(),stable=beforeMap.entries.find(row=>row.facultyId==='f1').key;
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'settings/faculty_swap_index'),{schemaVersion:'ucvm-faculty-swap-index-v1',entries:[{key:stable,name:'Wrong Name',aliases:['Wrong Name'],unavailableRanges:[]}]}));
 const beforeReport=await api.verifyDerivedIndexes(generalDb());
 assert.equal(beforeReport.severity,'mismatch');
 const afterReport=await api.rebuildDerivedIndexes(generalDb(),{uid:'general',name:'General'});
 assert.equal(afterReport.ok,true);
 const afterMap=(await getDoc(doc(raw,'settings/faculty_swap_map'))).data(),afterKey=afterMap.entries.find(row=>row.facultyId==='f1').key;
 assert.equal(afterKey,stable);
});

check('new active faculty receives one new opaque key while existing keys stay stable',async()=>{
 const {doc,getDoc,setDoc}=require('firebase/firestore');
 const raw=env.authenticatedContext('general').firestore();
 const beforeMap=(await getDoc(doc(raw,'settings/faculty_swap_map'))).data();
 const beforeKeys=Object.fromEntries(beforeMap.entries.map(row=>[row.facultyId,row.key]));
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'faculty/f3'),{preferredFullName:'Faculty Three',active:true,email:'f3@ucvm.test'}));
 const beforeReport=await api.verifyDerivedIndexes(generalDb());
 assert.equal(beforeReport.severity,'mismatch');
 assert.ok(beforeReport.mismatches.some(row=>row.issue==='missing-new-faculty-key'&&row.path==='faculty.f3'));
 const afterReport=await api.rebuildDerivedIndexes(generalDb(),{uid:'general',name:'General'});
 assert.equal(afterReport.ok,true);
 const afterMap=(await getDoc(doc(raw,'settings/faculty_swap_map'))).data();
 const f3=afterMap.entries.find(row=>row.facultyId==='f3');
 assert.ok(f3?.key);
 assert.equal(afterMap.entries.find(row=>row.facultyId==='f1').key,beforeKeys.f1);
 assert.equal(afterMap.entries.find(row=>row.facultyId==='f2').key,beforeKeys.f2);
 assert.notEqual(f3.key,beforeKeys.f1);
 assert.notEqual(f3.key,beforeKeys.f2);
});

check('duplicate private opaque-key ownership is CRITICAL and rebuild is blocked',async()=>{
 const {doc,getDoc,setDoc}=require('firebase/firestore');
 const raw=env.authenticatedContext('general').firestore(),before=(await getDoc(doc(raw,'settings/faculty_swap_map'))).data(),key=before.entries[0].key;
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'settings/faculty_swap_map'),{schemaVersion:'ucvm-faculty-swap-map-v1',entries:[{key,facultyId:'f1'},{key,facultyId:'f2'}]}));
 const report=await api.verifyDerivedIndexes(generalDb());
 assert.equal(report.severity,'critical');
 assert.ok(report.mismatches.some(row=>row.issue==='duplicate-key-ownership'));
 await assert.rejects(()=>api.rebuildDerivedIndexes(generalDb(),{uid:'general',name:'General'}),error=>error.code==='critical-derived-index');
 const unchanged=(await getDoc(doc(raw,'settings/faculty_swap_map'))).data();
 assert.equal(unchanged.entries[0].key,unchanged.entries[1].key);
});

check('missing private map with surviving public keys is CRITICAL',async()=>{
 const {doc,deleteDoc}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async context=>deleteDoc(doc(context.firestore(),'settings/faculty_swap_map')));
 const report=await api.verifyDerivedIndexes(generalDb());
 assert.equal(report.severity,'critical');
 assert.ok(report.mismatches.some(row=>row.issue==='missing-private-map-with-public-keys'));
 await assert.rejects(()=>api.rebuildDerivedIndexes(generalDb(),{uid:'general',name:'General'}),error=>error.code==='critical-derived-index');
});
