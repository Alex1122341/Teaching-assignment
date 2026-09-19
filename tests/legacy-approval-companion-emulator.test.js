'use strict';
// Closes audit finding F4 / R08 for the legacy (pre-routing) request shape.
//
// The routed path already proved that the session write happened, via
// routedSessionApplyFor(). The legacy path did not: an approver could set
// status=approved with appliedAt=now while the session document was never
// touched, leaving an approval that was never actually applied.
//
// These tests are the negative evidence for that fix.

const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('legacy approval companion write: '+name,{skip:!enabled},fn);

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-legacy-approval',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role] of [['adfa','adfa_regular'],['faculty','faculty']])
   await db.doc(`users/${uid}`).set({role,active:true,mustChangePassword:false,email:`${uid}@example.test`,...(role==='faculty'?{facultyId:'f1'}:{})});
  await db.doc('faculty/f1').set({email:'faculty@example.test'});
  // A pre-routing request: no requestSchema, so it is not a routed request.
  await db.doc('change_requests/legacy1').set({requesterUid:'faculty',requesterRole:'faculty',sessionId:'s1',requestType:'session_edit',status:'pending'});
  // The source session and its public calendar projection must stay field-equal,
  // so both are seeded and both are updated together.
  await db.doc('sessions/s1').set({course:'505',courseName:'Clinical Skills',year:2,semester:'winter',week:1,date:'2027-03-22',start:'09:00',end:'11:00',timeUnknown:false,type:'LAB',topic:'Suturing',room:'Skills Lab',instructor:'Faculty One'});
  await db.doc('calendar_sessions/s1').set({sessionId:'s1',course:'505',courseName:'Clinical Skills',year:2,semester:'winter',week:1,date:'2027-03-22',start:'09:00',end:'11:00',timeUnknown:false,type:'LAB',topic:'Suturing',room:'Skills Lab',instructor:'Faculty One',instructorNames:['Faculty One']});
 });
});
after(async()=>{if(env)await env.cleanup()});

check('approving a legacy request without the session write is denied',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const {serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('adfa').firestore();
 const stamp=serverTimestamp();
 await assertFails(db.doc('change_requests/legacy1').update({
  status:'approved',approvedBy:'adfa',approvedByName:'ADFA Regular',approvedAt:stamp,appliedAt:stamp
 }));
});

check('approving a legacy request with the paired session write succeeds',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing');
 const {serverTimestamp,writeBatch,doc}=require('firebase/firestore');
 const db=env.authenticatedContext('adfa').firestore();
 const stamp=serverTimestamp();
 const batch=writeBatch(db);
 batch.update(doc(db,'sessions/s1'),{topic:'Advanced Suturing',updatedBy:'adfa',updatedAt:stamp});
 batch.update(doc(db,'calendar_sessions/s1'),{topic:'Advanced Suturing'});
 batch.update(doc(db,'change_requests/legacy1'),{
  status:'approved',approvedBy:'adfa',approvedByName:'ADFA Regular',approvedAt:stamp,appliedAt:stamp
 });
 await assertSucceeds(batch.commit());
});

check('rejecting a legacy request does not require a session write',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing');
 const {serverTimestamp}=require('firebase/firestore');
 // Rejecting applies nothing, so no companion write is required.
 await env.withSecurityRulesDisabled(async ctx=>{
  await ctx.firestore().doc('change_requests/legacy2').set({requesterUid:'faculty',requesterRole:'faculty',sessionId:'s2',requestType:'session_edit',status:'pending'});
 });
 const db=env.authenticatedContext('adfa').firestore();
 await assertSucceeds(db.doc('change_requests/legacy2').update({
  status:'rejected',rejectedBy:'adfa',rejectedByName:'ADFA Regular',rejectedAt:serverTimestamp(),rejectionReason:'Not approved.'
 }));
});

check('a faculty member cannot approve a legacy request',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const {serverTimestamp,writeBatch,doc}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async ctx=>{
  await ctx.firestore().doc('change_requests/legacy3').set({requesterUid:'faculty',requesterRole:'faculty',sessionId:'s3',requestType:'session_edit',status:'pending'});
 });
 const db=env.authenticatedContext('faculty').firestore();
 const stamp=serverTimestamp();
 const batch=writeBatch(db);
 batch.update(doc(db,'sessions/s3'),{topic:'x',updatedBy:'faculty',updatedAt:stamp});
 batch.update(doc(db,'change_requests/legacy3'),{
  status:'approved',approvedBy:'faculty',approvedByName:'Faculty',approvedAt:stamp,appliedAt:stamp
 });
 await assertFails(batch.commit());
});
