'use strict';
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('AFC withdraw security: '+name,{skip:!enabled},fn);

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-afc-withdraw',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role] of [['faculty','faculty'],['other','faculty'],['report','faculty'],['adfa','adfa_regular']])await db.doc(`users/${uid}`).set({role,active:true,mustChangePassword:false,facultyId:uid==='faculty'?'f1':uid==='other'?'f2':'',email:`${uid}@example.test`});
  await db.doc('faculty/f1').set({email:'faculty@example.test'});await db.doc('faculty/f2').set({email:'other@example.test'});
  const base={requesterUid:'faculty',requesterEmail:'faculty@example.test',facultyId:'f1',facultyName:'Faculty One',reportToUid:'report',startDate:'2026-10-01',endDate:'2026-10-02',reason:'vacation',workDays:2,submittedAt:new Date(),updatedAt:new Date()};
  await db.doc('afc_requests/report-pending').set({...base,status:'pending_report_to'});
  await db.doc('afc_requests/admin-pending').set({...base,status:'pending_admin'});
  await db.doc('afc_requests/race-withdraw-first').set({...base,status:'pending_admin'});
  await db.doc('afc_requests/race-approve-first').set({...base,status:'pending_admin'});
  await db.doc('afc_requests/approved').set({...base,status:'approved'});
  await db.doc('afc_requests/rejected').set({...base,status:'rejected'});
  await db.doc('afc_requests/withdrawn').set({...base,status:'withdrawn',withdrawnBy:'faculty',withdrawnAt:new Date()});
 });
});
after(async()=>{if(env)await env.cleanup()});

const withdrawPatch=()=>{const {serverTimestamp}=require('firebase/firestore');return{status:'withdrawn',withdrawnBy:'faculty',withdrawnAt:serverTimestamp(),updatedAt:serverTimestamp()}};
const approvePatch=()=>{const {serverTimestamp}=require('firebase/firestore');return{status:'approved',adminSignature:{uid:'adfa'},pdfChunkCount:1,pdfSha256:'abc',pdfByteLength:3,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()}};

check('requester may withdraw from either pending state but another Faculty may not',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const own=env.authenticatedContext('faculty').firestore(),other=env.authenticatedContext('other').firestore();
 await assertSucceeds(own.doc('afc_requests/report-pending').update(withdrawPatch()));
 await assertSucceeds(own.doc('afc_requests/admin-pending').update(withdrawPatch()));
 await assertFails(other.doc('afc_requests/race-withdraw-first').update({...withdrawPatch(),withdrawnBy:'other'}));
});

check('approved rejected and withdrawn requests are terminal for withdrawal',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing'),own=env.authenticatedContext('faculty').firestore();
 for(const id of ['approved','rejected','withdrawn'])await assertFails(own.doc(`afc_requests/${id}`).update(withdrawPatch()));
});

check('withdrawal wins before final approval and final approval wins before withdrawal',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const own=env.authenticatedContext('faculty').firestore(),adfa=env.authenticatedContext('adfa').firestore();
 await assertSucceeds(own.doc('afc_requests/race-withdraw-first').update(withdrawPatch()));
 await assertFails(adfa.doc('afc_requests/race-withdraw-first').update(approvePatch()));
 await assertSucceeds(adfa.doc('afc_requests/race-approve-first').update(approvePatch()));
 await assertFails(own.doc('afc_requests/race-approve-first').update(withdrawPatch()));
});
