'use strict';
// Locks in the audit-history append-only invariant (audit finding R10).
//
// session_change_log and faculty_change_log previously permitted an administrator
// to rewrite the `changes` / changed-by fields of an existing entry. Audit history
// must instead be immutable: a correction is a new event, never an edit.
const {test,before,after}=require('node:test'),fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('audit log append-only: '+name,{skip:!enabled},fn);

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-audit-append-only',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role] of [['owner','owner'],['adfa','adfa_regular'],['faculty','faculty']])
   await db.doc(`users/${uid}`).set({role,active:true,mustChangePassword:false,email:uid+'@example.test',...(role==='faculty'?{facultyId:'f1'}:{})});
  await db.doc('faculty/f1').set({email:'faculty@example.test'});
  await db.doc('session_change_log/s1').set({action:'session_updated',changedBy:'adfa',changedByName:'ADFA Admin',changedByEmail:'adfa@example.test',changedAt:new Date(),changes:[{field:'room',before:'A',after:'B'}]});
  await db.doc('faculty_change_log/f1').set({action:'update_doe_roles',changedBy:'adfa',changedByName:'ADFA Admin',changedByEmail:'adfa@example.test',changedAt:new Date(),changes:[{field:'managedRoles2026_27',before:[],after:['visc']}]});
 });
});
after(async()=>{if(env)await env.cleanup();});

check('an ADFA administrator cannot rewrite an existing session change log entry',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const db=env.authenticatedContext('adfa').firestore();
 await assertFails(db.doc('session_change_log/s1').update({changes:[{field:'room',before:'A',after:'C'}]}));
});

check('an ADFA administrator cannot rewrite an existing faculty change log entry',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const db=env.authenticatedContext('adfa').firestore();
 await assertFails(db.doc('faculty_change_log/f1').update({changes:[{field:'managedRoles2026_27',before:[],after:[]}]}));
});

check('the changed-by attribution of an audit entry cannot be altered',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const db=env.authenticatedContext('owner').firestore();
 await assertFails(db.doc('session_change_log/s1').update({changedByName:'Someone Else'}));
 await assertFails(db.doc('faculty_change_log/f1').update({changedByEmail:'other@example.test'}));
});

check('audit entries cannot be deleted even by the owner',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const db=env.authenticatedContext('owner').firestore();
 await assertFails(db.doc('session_change_log/s1').delete());
 await assertFails(db.doc('faculty_change_log/f1').delete());
});

check('a new audit entry can still be appended by an ADFA administrator',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing');
 const {serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('adfa').firestore();
 await assertSucceeds(db.doc('session_change_log/s2').set({action:'session_updated',changedBy:'adfa',changedByName:'ADFA Admin',changedByEmail:'adfa@example.test',changedAt:serverTimestamp(),changes:[{field:'topic',before:'',after:'Suturing'}]}));
 await assertSucceeds(db.doc('faculty_change_log/f2').set({action:'update_doe_roles',changedBy:'adfa',changedByName:'ADFA Admin',changedByEmail:'adfa@example.test',changedAt:serverTimestamp(),changes:[{field:'managedRoles2026_27',before:[],after:['hicc']}]}));
});

check('a faculty member cannot append or rewrite audit entries',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const {serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('faculty').firestore();
 await assertFails(db.doc('session_change_log/s3').set({action:'session_updated',changedBy:'faculty',changedByName:'Faculty',changedByEmail:'faculty@example.test',changedAt:serverTimestamp(),changes:[]}));
 await assertFails(db.doc('session_change_log/s1').update({changes:[]}));
});
