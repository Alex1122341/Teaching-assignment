'use strict';
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
let env;

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-password-security',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await db.doc('users/password-active').set({active:true,email:'password-active@ucvm.test',role:'faculty',mustChangePassword:true});
  await db.doc('users/password-disabled').set({active:false,email:'password-disabled@ucvm.test',role:'faculty',mustChangePassword:true});
  await db.doc('users/password-escalation').set({active:true,email:'password-escalation@ucvm.test',role:'faculty',mustChangePassword:true});
 });
});

after(async()=>{if(env)await env.cleanup()});
const check=(name,fn)=>test(name,{skip:!enabled},fn);

check('active signed-in user may complete only the profile-side password workflow marker',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing');
 const {doc,updateDoc,serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('password-active').firestore();
 await assertSucceeds(updateDoc(doc(db,'users/password-active'),{
  mustChangePassword:false,
  passwordChangedAt:serverTimestamp(),
  updatedAt:serverTimestamp()
 }));
});

check('disabled user cannot clear the forced-password workflow marker',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const {doc,updateDoc,serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('password-disabled').firestore();
 await assertFails(updateDoc(doc(db,'users/password-disabled'),{
  mustChangePassword:false,
  passwordChangedAt:serverTimestamp(),
  updatedAt:serverTimestamp()
 }));
});

check('password workflow completion cannot be combined with privilege escalation',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const {doc,updateDoc,serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('password-escalation').firestore();
 await assertFails(updateDoc(doc(db,'users/password-escalation'),{
  role:'owner',
  mustChangePassword:false,
  passwordChangedAt:serverTimestamp(),
  updatedAt:serverTimestamp()
 }));
});
