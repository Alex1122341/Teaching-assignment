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

function routedSwapCommit(db,id,{name,candidateKey='',kind='',reason=''}){
 const {doc,writeBatch,serverTimestamp}=require('firebase/firestore');
 const batch=writeBatch(db),stamp=serverTimestamp(),signature=`sig:${id}`;
 const basePublic={course:'500',courseName:'',year:null,semester:'',week:null,date:'2026-10-05',start:'09:00',end:'10:00',timeUnknown:false,type:'LEC',topic:'',room:'',instructor:'Member Faculty'};
 const patchPublic={instructor:name};
 batch.set(doc(db,`change_requests/${id}`),{requestSchema:'office-routing-v1',requesterUid:'member',requesterName:'Member',requesterRole:'faculty',sessionId:'s1',requestType:'faculty_swap',scope:'self',groupId:'',groupName:'',status:'pending',revision:1,basePublic,patchPublic,currentFacultyName:'Member Faculty',proposedFacultyName:name,editableFields:[],requesterMessage:'',reason,course:'500',date:'2026-10-05',topic:'',requestedAt:stamp,updatedAt:stamp});
 batch.set(doc(db,`change_request_workflow/${id}`),{requestId:id,revision:1,requiredOffices:['adfa'],hasFacultyChange:true,finalType:'LEC',scopes:{adc:[],lab:[],adfa:['assignments','instructor']},scopeSignatures:{adc:'',lab:'',adfa:signature},updatedAt:stamp});
 batch.set(doc(db,`change_request_approvals/${id}_adfa`),{id:`${id}_adfa`,requestId:id,office:'adfa',revision:1,fields:['assignments','instructor'],scopeSignature:signature,status:'pending',decidedBy:'',decidedByName:'',decidedAt:null,pushBackReason:'',updatedAt:stamp});
 const to=candidateKey?{candidateKey}:{kind};
 batch.set(doc(db,`change_request_private/${id}`),{requestId:id,requesterUid:'member',revision:1,assignmentChange:{assignmentIndex:0,from:{facultyId:'f3'},to},updatedAt:stamp});
 return batch.commit();
}

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

check('normal opaque-key self replacement uses routed storage without exposing incoming UCID',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
 const {doc,getDoc}=require('firebase/firestore');
 const member=env.authenticatedContext('member').firestore();
 await assertSucceeds(routedSwapCommit(member,'opaque-swap',{name:'Other Faculty',candidateKey:'opaque-f4'}));
 const publicSnap=await assertSucceeds(getDoc(doc(member,'change_requests/opaque-swap')));
 const publicText=JSON.stringify(publicSnap.data());
 require('node:assert/strict').doesNotMatch(publicText,/opaque-f4|f4/);
 await assertFails(getDoc(doc(member,'change_request_private/opaque-swap')));
});

check('Sessional and Other routed self replacements require a nonblank reason',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
 const member=env.authenticatedContext('member').firestore();
 await assertFails(routedSwapCommit(member,'sessional-blank',{name:'Sessional',kind:'sessional',reason:' '}));
 await assertSucceeds(routedSwapCommit(member,'sessional-ok',{name:'Sessional',kind:'sessional',reason:'Sessional coverage requested.'}));
 await assertFails(routedSwapCommit(member,'other-blank',{name:'Other',kind:'other',reason:''}));
 await assertSucceeds(routedSwapCommit(member,'other-ok',{name:'Other',kind:'other',reason:'External teaching coverage.'}));
});
