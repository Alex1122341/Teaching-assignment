'use strict';
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('approval privacy: '+name,{skip:!enabled},fn);

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-approval-security',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role] of [['faculty','faculty'],['other','faculty'],['adc','adc'],['lab','lab'],['adfa','adfa_regular'],['owner','owner']]){const profile={role,active:true,mustChangePassword:false,email:`${uid}@example.test`};if(role==='faculty')profile.facultyId=uid==='faculty'?'f1':'f2';await db.doc(`users/${uid}`).set(profile);}
  await db.doc('faculty/f1').set({email:'faculty@example.test'});await db.doc('faculty/f2').set({email:'other@example.test'});
  await db.doc('change_requests/r1').set({requestSchema:'office-routing-v1',requesterUid:'faculty',requesterRole:'faculty',sessionId:'s1',requestType:'faculty_swap',status:'pending',revision:1,basePublic:{course:'505'},patchPublic:{instructor:'Dr New'},currentFacultyName:'Dr Old',proposedFacultyName:'Dr New',editableFields:[],requesterMessage:''});
  await db.doc('change_request_workflow/r1').set({requestId:'r1',revision:1,requiredOffices:['adc','lab','adfa'],hasFacultyChange:true,finalType:'LAB',scopes:{adc:['date'],lab:['topic'],adfa:['assignments']},scopeSignatures:{adc:'adc-sig',lab:'lab-sig',adfa:'adfa-sig'}});
  await db.doc('change_request_approvals/r1_adc').set({requestId:'r1',office:'adc',revision:1,fields:['date'],scopeSignature:'adc-sig',status:'pending'});
  await db.doc('change_request_approvals/r1_lab').set({requestId:'r1',office:'lab',revision:1,fields:['topic'],scopeSignature:'lab-sig',status:'pending'});
  await db.doc('change_request_approvals/r1_adfa').set({requestId:'r1',office:'adfa',revision:1,fields:['assignments'],scopeSignature:'adfa-sig',status:'pending'});
  await db.doc('change_request_private/r1').set({requestId:'r1',requesterUid:'faculty',revision:1,assignmentChange:{from:{facultyId:'f1'},to:{candidateKey:'opaque'}}});
  await db.doc('change_requests/legacy').set({requesterUid:'faculty',requesterRole:'faculty',status:'pending',fromFaculty:{facultyId:'f1'},toFaculty:{facultyId:'f2'},base:{assignments:[{ucid:'f1'}]}});
 });
});
after(async()=>{if(env)await env.cleanup()});

check('requester reads only its sanitized public request',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),db=env.authenticatedContext('faculty').firestore();
 await assertSucceeds(db.doc('change_requests/r1').get());
 await assertFails(db.doc('change_request_workflow/r1').get());
 await assertFails(db.doc('change_request_approvals/r1_adfa').get());
 await assertFails(db.doc('change_request_private/r1').get());
});
check('ADC and LAB can read routed public/workflow status but never private assignment data or legacy private-shaped requests',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['adc','lab']){const db=env.authenticatedContext(uid).firestore();await assertSucceeds(db.doc('change_requests/r1').get());await assertSucceeds(db.doc('change_request_workflow/r1').get());await assertSucceeds(db.doc(`change_request_approvals/r1_${uid}`).get());await assertFails(db.doc('change_request_private/r1').get());await assertFails(db.doc('change_requests/legacy').get());}
});
check('ADFA may read the private assignment record and legacy requests',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing'),db=env.authenticatedContext('adfa').firestore();
 await assertSucceeds(db.doc('change_requests/r1').get());await assertSucceeds(db.doc('change_request_workflow/r1').get());await assertSucceeds(db.doc('change_request_approvals/r1_adfa').get());await assertSucceeds(db.doc('change_request_private/r1').get());await assertSucceeds(db.doc('change_requests/legacy').get());
});
check('another Faculty account cannot read someone else public request',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');await assertFails(env.authenticatedContext('other').firestore().doc('change_requests/r1').get());
});


check('Developer can approve ADC LAB and ADFA routed scopes with one identity',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing');
 const {serverTimestamp}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await db.doc('users/developer').set({role:'developer',active:true,mustChangePassword:false,email:'developer@example.test'});
  for(const office of ['adc','lab','adfa']){
   const id='dev-'+office,fields=office==='adc'?['date']:office==='lab'?['topic']:['assignments'];
   await db.doc('change_requests/'+id).set({requestSchema:'office-routing-v1',requesterUid:'faculty',requesterRole:'faculty',sessionId:'s1',requestType:office==='adfa'?'faculty_swap':'session_edit',status:'pending',revision:1,editableFields:[],requesterMessage:''});
   // A routed approval always has its workflow document. The serial stage order
   // is derived from it, so the fixture must provide one.
   const scopes={adc:[],lab:[],adfa:[]},scopeSignatures={adc:'',lab:'',adfa:''};
   scopes[office]=fields;scopeSignatures[office]=office+'-sig';
   await db.doc('change_request_workflow/'+id).set({requestId:id,revision:1,requiredOffices:[office],hasFacultyChange:office==='adfa',finalType:'LEC',scopes,scopeSignatures,updatedAt:new Date('2026-09-20T12:00:00Z')});
   await db.doc('change_request_approvals/'+id+'_'+office).set({id:id+'_'+office,requestId:id,office,revision:1,fields,scopeSignature:office+'-sig',status:'pending',decidedBy:'',decidedByName:'',decidedAt:null,pushBackReason:'',updatedAt:new Date('2026-09-20T12:00:00Z')});
  }
 });
 const db=env.authenticatedContext('developer').firestore();
 for(const office of ['adc','lab','adfa']){
  const id='dev-'+office,requestRef=db.doc('change_requests/'+id),approvalRef=db.doc('change_request_approvals/'+id+'_'+office);
  await assertSucceeds(db.runTransaction(async tx=>{
   tx.update(requestRef,{updatedAt:serverTimestamp()});
   tx.update(approvalRef,{status:'approved',decidedBy:'developer',decidedByName:'VISTA Developer',decidedAt:serverTimestamp(),pushBackReason:'',updatedAt:serverTimestamp()});
  }));
 }
});

check('Owner-delegated Administrator can approve the explicit ADC scope without changing primary role',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),make=async(id,office)=>{
   const fields=office==='adc'?['date']:['assignments'],scopes={adc:[],lab:[],adfa:[]},scopeSignatures={adc:'',lab:'',adfa:''};
   scopes[office]=fields;scopeSignatures[office]=office+'-sig';
   await db.doc('change_requests/'+id).set({requestSchema:'office-routing-v1',requesterUid:'faculty',requesterRole:'faculty',sessionId:'s1',requestType:'session_edit',status:'pending',revision:1,editableFields:[],requesterMessage:'',updatedAt:new Date('2026-09-20T12:00:00Z')});
   await db.doc('change_request_workflow/'+id).set({requestId:id,revision:1,requiredOffices:[office],hasFacultyChange:office==='adfa',finalType:'LEC',scopes,scopeSignatures,updatedAt:new Date('2026-09-20T12:00:00Z')});
   await db.doc('change_request_approvals/'+id+'_'+office).set({id:id+'_'+office,requestId:id,office,revision:1,fields,scopeSignature:office+'-sig',status:'pending',decidedBy:'',decidedByName:'',decidedAt:null,pushBackReason:'',updatedAt:new Date('2026-09-20T12:00:00Z')});
  };
  await db.doc('users/delegated-admin').set({role:'administrator',officeAccess:['adc'],active:true,mustChangePassword:false,email:'delegated@example.test'});
  await make('delegated-adc','adc');await make('delegated-adfa','adfa');
 });
 const db=env.authenticatedContext('delegated-admin').firestore(),decide=async(id,office)=>{
  const stamp=serverTimestamp(),batch=db.batch();
  batch.update(db.doc('change_requests/'+id),{updatedAt:stamp});
  batch.update(db.doc('change_request_approvals/'+id+'_'+office),{status:'approved',decidedBy:'delegated-admin',decidedByName:'Delegated Admin',decidedAt:stamp,pushBackReason:'',updatedAt:stamp});
  return batch.commit();
 };
 await assertSucceeds(decide('delegated-adc','adc'));
 await assertFails(decide('delegated-adfa','adfa'));
});
