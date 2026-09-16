'use strict';
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
let env;
const users={general:{role:'adfa_general',name:'General'},general2:{role:'adfa_general',name:'General Two'},regular:{role:'adfa_regular',name:'Regular'},member:{role:'faculty',name:'Member',facultyId:'f1'}};
const check=(name,fn)=>test(name,{skip:!enabled},fn);

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 const {doc,setDoc}=require('firebase/firestore');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-access',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  const admin=context.firestore();
  for(const [uid,p]of Object.entries(users))await setDoc(doc(admin,`users/${uid}`),{active:true,email:`${uid}@ucvm.test`,mustChangePassword:false,...p});
  await setDoc(doc(admin,'faculty/f1'),{preferredFullName:'Faculty 1',email:'member@ucvm.test',updatedBy:'general'});
  await setDoc(doc(admin,'sessions/s1'),{course:'301',topic:'Original',date:'2026-09-08',facultyIds:['f1'],assignments:[{ucid:'f1'}],updatedBy:'general'});
  await setDoc(doc(admin,'change_requests/r1'),{status:'pending',requesterUid:'member',sessionId:'s1'});
 });
});
after(async()=>{if(env)await env.cleanup()});

async function seedLocked(){
 const {doc,setDoc}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async context=>{
  const admin=context.firestore();
  await setDoc(doc(admin,'settings/system_state'),{teachingDataWriteLocked:true,maintenanceMode:'bulk_import',activeImportId:'i1',maintenanceOwnerUid:'general',maintenanceOwnerName:'General'});
  await setDoc(doc(admin,'bulk_import_jobs/i1'),{importId:'i1',status:'FAILED',phase:'APPLYING_SESSIONS',sourceFingerprint:'abc',startedBy:'general'});
 });
}

check('ready users can read maintenance system state',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing'),{doc,getDoc}=require('firebase/firestore');
 await seedLocked();
 await assertSucceeds(getDoc(doc(env.authenticatedContext('member').firestore(),'settings/system_state')));
});

check('maintenance lock blocks normal admins and permits only active owner teaching-data recovery writes',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),{doc,setDoc,serverTimestamp}=require('firebase/firestore');
 await seedLocked();
 const regular=env.authenticatedContext('regular').firestore(),general2=env.authenticatedContext('general2').firestore(),general=env.authenticatedContext('general').firestore();
 await assertFails(setDoc(doc(regular,'sessions/s1'),{topic:'blocked',updatedBy:'regular',updatedAt:serverTimestamp()},{merge:true}));
 await assertFails(setDoc(doc(general2,'sessions/s1'),{topic:'blocked',updatedBy:'general2',updatedAt:serverTimestamp()},{merge:true}));
 await assertSucceeds(setDoc(doc(general,'sessions/s1'),{topic:'recovery-preserved'},{merge:true}));
 await assertFails(setDoc(doc(regular,'faculty/f1'),{facultySummaryStatus2026_27:'blocked',updatedBy:'regular'},{merge:true}));
 await assertFails(setDoc(doc(general2,'faculty/f1'),{facultySummaryStatus2026_27:'blocked',updatedBy:'general2'},{merge:true}));
 await assertSucceeds(setDoc(doc(general,'faculty/f1'),{facultySummaryStatus2026_27:'recovery'},{merge:true}));
 await assertFails(setDoc(doc(regular,'settings/faculty_index'),{entries:[]}));
 await assertFails(setDoc(doc(general2,'settings/faculty_index'),{entries:[]}));
 await assertSucceeds(setDoc(doc(general,'settings/faculty_index'),{entries:[]}));
});

check('change-request decisions are blocked for everyone while teaching maintenance is active',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing'),{doc,updateDoc,serverTimestamp}=require('firebase/firestore');
 await seedLocked();
 const regular=env.authenticatedContext('regular').firestore(),general=env.authenticatedContext('general').firestore();
 const patch={status:'approved',approvedBy:'regular',approvedByName:'Regular',approvedAt:serverTimestamp(),appliedAt:serverTimestamp()};
 await assertFails(updateDoc(doc(regular,'change_requests/r1'),patch));
 await assertFails(updateDoc(doc(general,'change_requests/r1'),{...patch,approvedBy:'general',approvedByName:'General'}));
});

check('bulk import job events are active-owner-only and append-only',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),{doc,setDoc,updateDoc,deleteDoc,serverTimestamp}=require('firebase/firestore');
 await seedLocked();
 const regular=env.authenticatedContext('regular').firestore(),general2=env.authenticatedContext('general2').firestore(),general=env.authenticatedContext('general').firestore();
 const event={type:'BULK_IMPORT_FAILED',changedBy:'general',changedByName:'General',changedAt:serverTimestamp()};
 await assertFails(setDoc(doc(regular,'bulk_import_jobs/i1/events/e1'),{...event,changedBy:'regular'}));
 await assertFails(setDoc(doc(general2,'bulk_import_jobs/i1/events/e1'),{...event,changedBy:'general2'}));
 await assertSucceeds(setDoc(doc(general,'bulk_import_jobs/i1/events/e1'),event));
 await assertFails(updateDoc(doc(general,'bulk_import_jobs/i1/events/e1'),{type:'forged'}));
 await assertFails(deleteDoc(doc(general,'bulk_import_jobs/i1/events/e1')));
});

check('non-terminal unlock fails and terminal job plus unlock succeeds atomically',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),{doc,writeBatch}=require('firebase/firestore');
 await seedLocked();
 const db=env.authenticatedContext('general').firestore();
 const bad=writeBatch(db);bad.set(doc(db,'settings/system_state'),{teachingDataWriteLocked:false,maintenanceMode:'none',activeImportId:'',maintenanceOwnerUid:'',maintenanceOwnerName:''},{merge:true});
 await assertFails(bad.commit());
 const good=writeBatch(db);good.set(doc(db,'bulk_import_jobs/i1'),{status:'COMPLETED',phase:'COMPLETED'},{merge:true});good.set(doc(db,'settings/system_state'),{teachingDataWriteLocked:false,maintenanceMode:'none',activeImportId:'',maintenanceOwnerUid:'',maintenanceOwnerName:''},{merge:true});
 await assertSucceeds(good.commit());
});

check('another ADFA General can take over recovery only by coupling owner and job updates',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),{doc,writeBatch}=require('firebase/firestore');
 await seedLocked();
 const db=env.authenticatedContext('general2').firestore();
 const lone=writeBatch(db);lone.set(doc(db,'settings/system_state'),{maintenanceOwnerUid:'general2',maintenanceOwnerName:'General Two'},{merge:true});await assertFails(lone.commit());
 const takeover=writeBatch(db);takeover.set(doc(db,'settings/system_state'),{maintenanceOwnerUid:'general2',maintenanceOwnerName:'General Two'},{merge:true});takeover.set(doc(db,'bulk_import_jobs/i1'),{recoveryTakenOverBy:'general2',recoveryTakenOverByName:'General Two',recoveryTakeoverReason:'Original administrator unavailable'},{merge:true});
 await assertSucceeds(takeover.commit());
});
