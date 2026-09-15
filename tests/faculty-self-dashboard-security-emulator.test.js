'use strict';
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
let env;
before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-faculty-self-dashboard',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  const admin=context.firestore();
  await admin.doc('users/member').set({active:true,role:'faculty',name:'Member',email:'member@ucvm.test',facultyId:'f1'});
  await admin.doc('users/regular').set({active:true,role:'adfa_regular',name:'Regular',email:'regular@ucvm.test'});
  await admin.doc('faculty/f1').set({preferredFullName:'Faculty One',email:'directory-one@ucvm.test'});
  await admin.doc('faculty/f2').set({preferredFullName:'Faculty Two',email:'directory-two@ucvm.test'});
 });
});
after(async()=>{if(env)await env.cleanup()});
const check=(name,fn)=>test(name,{skip:!enabled},fn);

check('faculty can get only their linked faculty record while administrators can list the directory',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
 const {getDoc,getDocs,doc,collection}=require('firebase/firestore');
 const member=env.authenticatedContext('member').firestore();
 const regular=env.authenticatedContext('regular').firestore();
 await assertSucceeds(getDoc(doc(member,'faculty/f1')));
 await assertFails(getDoc(doc(member,'faculty/f2')));
 await assertFails(getDocs(collection(member,'faculty')));
 await assertSucceeds(getDocs(collection(regular,'faculty')));
});
