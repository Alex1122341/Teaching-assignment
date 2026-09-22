'use strict';
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('my changes security: '+name,{skip:!enabled},fn);

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-my-changes',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  const users={
   owner:{role:'owner'},adfa:{role:'adfa_regular'},adc:{role:'adc'},lab:{role:'lab'},office:{role:'other_office'},
   faculty:{role:'faculty',facultyId:'f1'},hicc:{role:'hicc',facultyId:'f1'},other:{role:'faculty',facultyId:'f2'}
  };
  for(const [uid,p] of Object.entries(users))await db.doc('users/'+uid).set({active:true,mustChangePassword:false,email:uid+'@example.test',...p});
  await db.doc('faculty/f1').set({email:'faculty@example.test'});
  await db.doc('faculty/f2').set({email:'other@example.test'});
  await db.doc('sessions/s1').set({course:'505',date:'2027-03-22',facultyIds:['f1'],assignments:[{ucid:'f1'}]});
  await db.doc('sessions/s2').set({course:'506',date:'2027-03-23',facultyIds:['f2'],assignments:[{ucid:'f2'}]});

  await db.doc('session_change_log/related-s1').set({sessionId:'s1',course:'505',changedBy:'adfa',changedByName:'ADFA',changedAt:new Date(),changes:[]});
  await db.doc('session_change_log/unrelated-s2').set({sessionId:'s2',course:'506',changedBy:'adfa',changedByName:'ADFA',changedAt:new Date(),changes:[]});
  await db.doc('session_change_log/adc-own').set({sessionId:'s2',course:'506',changedBy:'adc',changedByName:'ADC',changedAt:new Date(),changes:[]});
  await db.doc('session_change_log/lab-own').set({sessionId:'s2',course:'506',changedBy:'lab',changedByName:'LAB',changedAt:new Date(),changes:[]});

  await db.doc('faculty_change_log/f1-related').set({facultyId:'f1',changedBy:'adfa',changedByName:'ADFA',changedAt:new Date(),changes:[]});
  await db.doc('faculty_change_log/f2-unrelated').set({facultyId:'f2',changedBy:'adfa',changedByName:'ADFA',changedAt:new Date(),changes:[]});

  await db.doc('account_audit/target-faculty').set({targetUid:'faculty',targetName:'Faculty',changedBy:'adfa',changedByName:'ADFA',changedAt:new Date()});
  await db.doc('account_audit/target-other').set({targetUid:'other',targetName:'Other',changedBy:'adfa',changedByName:'ADFA',changedAt:new Date()});
  await db.doc('account_audit/office-own').set({targetUid:'other',changedBy:'office',changedByName:'Office',changedAt:new Date()});

  await db.doc('afc_audit/afc-self').set({action:'afc_submitted',requestId:'afc1',requesterUid:'faculty',reportToUid:'hicc',changedBy:'adfa',changedByName:'ADFA',changedAt:new Date()});
  await db.doc('afc_audit/afc-other').set({action:'afc_submitted',requestId:'afc2',requesterUid:'other',reportToUid:'other',changedBy:'adfa',changedByName:'ADFA',changedAt:new Date()});

  await db.doc('change_requests/r1').set({requestSchema:'office-routing-v1',requesterUid:'faculty',requesterRole:'faculty',sessionId:'s1',requestType:'session_edit',status:'pending'});
  await db.doc('change_requests/r2').set({requestSchema:'office-routing-v1',requesterUid:'other',requesterRole:'faculty',sessionId:'s2',requestType:'session_edit',status:'pending'});
  await db.doc('change_request_audit/r1-event').set({requestId:'r1',event:'office_approved',changedBy:'adfa',changedByName:'ADFA',changedAt:new Date()});
  await db.doc('change_request_audit/r2-event').set({requestId:'r2',event:'office_approved',changedBy:'adfa',changedByName:'ADFA',changedAt:new Date()});
  await db.doc('change_request_audit/adc-event').set({requestId:'r2',event:'office_approved',changedBy:'adc',changedByName:'ADC',changedAt:new Date()});
 });
});
after(async()=>{if(env)await env.cleanup()});

check('ADC and LAB may read their own audit events but not another actor history',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const adc=env.authenticatedContext('adc').firestore(),lab=env.authenticatedContext('lab').firestore();
 await assertSucceeds(adc.doc('session_change_log/adc-own').get());
 await assertSucceeds(adc.doc('change_request_audit/adc-event').get());
 await assertFails(adc.doc('session_change_log/lab-own').get());
 await assertSucceeds(lab.doc('session_change_log/lab-own').get());
 await assertFails(lab.doc('session_change_log/adc-own').get());
});

check('faculty may read session and faculty history related to their current linked teaching identity',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const db=env.authenticatedContext('faculty').firestore();
 await assertSucceeds(db.doc('session_change_log/related-s1').get());
 await assertFails(db.doc('session_change_log/unrelated-s2').get());
 await assertSucceeds(db.doc('faculty_change_log/f1-related').get());
 await assertFails(db.doc('faculty_change_log/f2-unrelated').get());
});

check('a user may read account history targeting their own account but not another account',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const faculty=env.authenticatedContext('faculty').firestore(),office=env.authenticatedContext('office').firestore();
 await assertSucceeds(faculty.doc('account_audit/target-faculty').get());
 await assertFails(faculty.doc('account_audit/target-other').get());
 await assertSucceeds(office.doc('account_audit/office-own').get());
 await assertFails(office.doc('account_audit/target-faculty').get());
});

check('AFC audit is visible only when the user is requester report-to actor or global history admin',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const faculty=env.authenticatedContext('faculty').firestore(),hicc=env.authenticatedContext('hicc').firestore(),adc=env.authenticatedContext('adc').firestore();
 await assertSucceeds(faculty.doc('afc_audit/afc-self').get());
 await assertSucceeds(hicc.doc('afc_audit/afc-self').get());
 await assertFails(adc.doc('afc_audit/afc-self').get());
 await assertFails(faculty.doc('afc_audit/afc-other').get());
});

check('requester sees their public request lifecycle while internal audit stays actor/admin scoped',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const db=env.authenticatedContext('faculty').firestore();
 await assertSucceeds(db.doc('change_requests/r1').get());
 await assertFails(db.doc('change_requests/r2').get());
 await assertFails(db.doc('change_request_audit/r1-event').get());
 await assertFails(db.doc('change_request_audit/r2-event').get());
});

check('self-history query shapes are rule-authorized only for the signed-in relationship',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const faculty=env.authenticatedContext('faculty').firestore();
 await assertSucceeds(faculty.collection('session_change_log').where('sessionId','==','s1').get());
 await assertFails(faculty.collection('session_change_log').where('sessionId','==','s2').get());
 await assertSucceeds(faculty.collection('faculty_change_log').where('facultyId','==','f1').get());
 await assertFails(faculty.collection('faculty_change_log').where('facultyId','==','f2').get());
 await assertSucceeds(faculty.collection('account_audit').where('targetUid','==','faculty').get());
 await assertSucceeds(faculty.collection('afc_audit').where('requesterUid','==','faculty').get());
 await assertSucceeds(faculty.collection('change_requests').where('requesterUid','==','faculty').get());
 const adc=env.authenticatedContext('adc').firestore();
 await assertSucceeds(adc.collection('session_change_log').where('changedBy','==','adc').get());
 await assertSucceeds(adc.collection('change_request_audit').where('changedBy','==','adc').get());
});

check('ADFA global history authority remains unchanged',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing');
 const db=env.authenticatedContext('adfa').firestore();
 for(const ref of ['session_change_log/unrelated-s2','faculty_change_log/f2-unrelated','account_audit/target-other','afc_audit/afc-other','change_request_audit/r2-event'])await assertSucceeds(db.doc(ref).get());
});
