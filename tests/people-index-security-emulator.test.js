'use strict';
// Closes audit finding F3 / R06 / R07.
//
// Previously `allow list` on /users was open to any faculty-role account, so a
// plain faculty member could enumerate every colleague's name, email, facultyId,
// active flag and password-change state. Faculty-role accounts now read the
// sanitized settings/people_index projection instead, and the raw collection is
// Owner-only.
//
// These tests are the negative evidence for that change: they assert the denial
// as well as the replacement read path.

const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('people index privacy: '+name,{skip:!enabled},fn);

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-people-index',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role,extra] of [
   ['owner','owner',{}],
   ['adfa','adfa_regular',{}],
   ['hicc','hicc',{facultyId:'fac-001'}],
   ['faculty1','faculty',{facultyId:'fac-002'}],
   ['adc','adc',{officeName:'DVM / ADC Office'}],
   ['lab','lab',{officeName:'LAB Office'}],
   ['inactive','faculty',{facultyId:'fac-003',active:false}]
  ])await db.doc(`users/${uid}`).set({role,active:extra.active!==false,mustChangePassword:false,email:`${uid}@example.test`,name:uid,...extra});
  await db.doc('faculty/fac-001').set({email:'hicc@example.test'});
  await db.doc('faculty/fac-002').set({email:'faculty1@example.test'});
  await db.doc('faculty/fac-003').set({email:'inactive@example.test'});
  await db.doc('settings/people_index').set({
   schemaVersion:'ucvm-people-index-v1',
   entries:[{uid:'hicc',name:'HICC Lead',role:'hicc',facultyId:'fac-001',aliases:['hicc.lead']}],
   generatedAt:new Date()
  });
 });
});
after(async()=>{if(env)await env.cleanup()});

check('a faculty account cannot list the users collection',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['faculty1','hicc','adfa']){
  const db=env.authenticatedContext(uid).firestore();
  await assertFails(db.collection('users').get());
  await assertFails(db.collection('users').where('role','in',['faculty','hicc','visc']).get());
 }
});

check('the owner can still list the users collection',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing');
 await assertSucceeds(env.authenticatedContext('owner').firestore().collection('users').get());
});

check('a faculty account cannot read another account document',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
 const db=env.authenticatedContext('faculty1').firestore();
 await assertSucceeds(db.doc('users/faculty1').get());
 await assertFails(db.doc('users/hicc').get());
});

check('faculty-role accounts can read the sanitized people projection instead',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing');
 for(const uid of ['faculty1','hicc']){
  await assertSucceeds(env.authenticatedContext(uid).firestore().doc('settings/people_index').get());
 }
});

check('the people projection is not readable by office or inactive accounts',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['adc','lab','inactive']){
  await assertFails(env.authenticatedContext(uid).firestore().doc('settings/people_index').get());
 }
});

check('only an administrator can write the people projection',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
 const {serverTimestamp}=require('firebase/firestore');
 const payload={schemaVersion:'ucvm-people-index-v1',entries:[],generatedAt:serverTimestamp()};
 await assertSucceeds(env.authenticatedContext('owner').firestore().doc('settings/people_index').set(payload));
 await assertSucceeds(env.authenticatedContext('adfa').firestore().doc('settings/people_index').set(payload));
 for(const uid of ['faculty1','hicc','adc']){
  await assertFails(env.authenticatedContext(uid).firestore().doc('settings/people_index').set(payload));
 }
});

check('the people projection envelope rejects extra fields',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
 const {serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('adfa').firestore();
 await assertSucceeds(db.doc('settings/people_index').set({
  schemaVersion:'ucvm-people-index-v1',entries:[],generatedAt:serverTimestamp()
 }));
 await assertFails(db.doc('settings/people_index').set({
  schemaVersion:'ucvm-people-index-v1',entries:[],generatedAt:serverTimestamp(),leaked:'private@example.test'
 }));
});

check('the sanitized swap index envelope rejects extra fields and a wrong schema version',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
 const {serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('adfa').firestore();
 await assertSucceeds(db.doc('settings/faculty_swap_index').set({
  schemaVersion:'ucvm-faculty-swap-index-v1',entries:[],generatedAt:serverTimestamp()
 }));
 await assertFails(db.doc('settings/faculty_swap_index').set({
  schemaVersion:'ucvm-faculty-swap-index-v1',entries:[],generatedAt:serverTimestamp(),ucid:'30009999'
 }));
 await assertFails(db.doc('settings/faculty_swap_index').set({
  entries:[],generatedAt:serverTimestamp()
 }));
});
