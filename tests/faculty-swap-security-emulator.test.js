'use strict';
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
let env;

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-swap-security',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await db.doc('users/member').set({active:true,email:'member@ucvm.test',name:'Member',role:'faculty',facultyId:'f3'});
  await db.doc('users/regular').set({active:true,email:'regular@ucvm.test',name:'Regular',role:'adfa_regular'});
  await db.doc('faculty/f3').set({preferredFullName:'Member Faculty',email:'member@ucvm.test'});
  await db.doc('faculty/f4').set({preferredFullName:'Other Faculty',email:'other@ucvm.test'});
  await db.doc('settings/faculty_swap_index').set({schemaVersion:'ucvm-faculty-swap-index-v1',entries:[{key:'opaque-f4',name:'Other Faculty',aliases:['Other Faculty'],unavailableRanges:[]}]});
  await db.doc('settings/faculty_swap_map').set({schemaVersion:'ucvm-faculty-swap-map-v1',entries:[{key:'opaque-f4',facultyId:'f4'}]});
  await db.doc('sessions/s1').set({course:'500',date:'2026-10-05',start:'09:00',end:'10:00',assignments:[{ucid:'f3',name:'Member Faculty'}],facultyIds:['f3']});
 });
});
after(async()=>{if(env)await env.cleanup()});
const check=(name,fn)=>test(name,{skip:!enabled},fn);

check('faculty can read sanitized swap index but not private key map or full faculty records',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
 const {doc,getDoc}=require('firebase/firestore');
 const member=env.authenticatedContext('member').firestore(),admin=env.authenticatedContext('regular').firestore();
 await assertSucceeds(getDoc(doc(member,'settings/faculty_swap_index')));
 await assertFails(getDoc(doc(member,'settings/faculty_swap_map')));
 await assertFails(getDoc(doc(member,'faculty/f4')));
 await assertSucceeds(getDoc(doc(admin,'settings/faculty_swap_index')));
 await assertSucceeds(getDoc(doc(admin,'settings/faculty_swap_map')));
});

check('faculty cannot write sanitized or private swap indexes',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 const {doc,setDoc}=require('firebase/firestore');
 const member=env.authenticatedContext('member').firestore();
 await assertFails(setDoc(doc(member,'settings/faculty_swap_index'),{entries:[]}));
 await assertFails(setDoc(doc(member,'settings/faculty_swap_map'),{entries:[]}));
});

check('normal opaque-key self replacement can be requested without exposing incoming UCID',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing');
 const {doc,setDoc,serverTimestamp}=require('firebase/firestore');
 const member=env.authenticatedContext('member').firestore();
 await assertSucceeds(setDoc(doc(member,'change_requests/opaque-swap'),{
  requesterUid:'member',requesterRole:'faculty',status:'pending',requestedAt:serverTimestamp(),sessionId:'s1',requestType:'faculty_swap',
  fromFaculty:{facultyId:'f3',name:'Member Faculty'},toFaculty:{candidateKey:'opaque-f4',name:'Other Faculty'},reason:''
 }));
});

check('Sessional and Other self replacements require a nonblank reason',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
 const {doc,setDoc,serverTimestamp}=require('firebase/firestore');
 const member=env.authenticatedContext('member').firestore();
 const base={requesterUid:'member',requesterRole:'faculty',status:'pending',requestedAt:serverTimestamp(),sessionId:'s1',requestType:'faculty_swap',fromFaculty:{facultyId:'f3',name:'Member Faculty'}};
 await assertFails(setDoc(doc(member,'change_requests/sessional-blank'),{...base,toFaculty:{kind:'sessional',name:'Sessional'},reason:' '}));
 await assertSucceeds(setDoc(doc(member,'change_requests/sessional-ok'),{...base,requestedAt:serverTimestamp(),toFaculty:{kind:'sessional',name:'Sessional'},reason:'Sessional coverage requested.'}));
 await assertFails(setDoc(doc(member,'change_requests/other-blank'),{...base,requestedAt:serverTimestamp(),toFaculty:{kind:'other',name:'Other'},reason:''}));
 await assertSucceeds(setDoc(doc(member,'change_requests/other-ok'),{...base,requestedAt:serverTimestamp(),toFaculty:{kind:'other',name:'Other'},reason:'External teaching coverage.'}));
});
