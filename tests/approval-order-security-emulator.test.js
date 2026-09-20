'use strict';
// Emulator proof that approval stages are strictly serial: ADC -> LAB -> ADFA.
// A later office must not be able to write an approval while an earlier required
// office is still pending, even by writing Firestore directly.
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('ordered approval: '+name,{skip:!enabled},fn);

const basePublic={course:'601',courseName:'Lab Skills',year:2,semester:'winter',week:4,date:'2027-06-01',start:'09:00',end:'11:00',timeUnknown:false,type:'LAB',topic:'Old topic',room:'LAB 2',instructor:''};
const patchPublic={date:'2027-06-02',topic:'New topic',instructor:'Dr New'};
function publicRequest(){return{requestSchema:'office-routing-v1',requesterUid:'faculty',requesterName:'Faculty User',requesterRole:'faculty',sessionId:'s1',requestType:'session_edit',scope:'hicc',groupId:'g1',groupName:'HICC 1',status:'pending',revision:1,basePublic:{...basePublic},patchPublic:{...patchPublic},currentFacultyName:'',proposedFacultyName:'Dr New',editableFields:[],requesterMessage:'',reason:'',course:'601',date:'2027-06-01',topic:'New topic',requestedAt:new Date('2026-09-17T12:00:00Z'),updatedAt:new Date('2026-09-17T12:00:00Z')};}
// LAB final type: date is ADC-owned, topic is LAB-owned, instructor is ADFA-owned.
function workflow(){return{requestId:'r3',revision:1,requiredOffices:['adc','lab','adfa'],hasFacultyChange:true,finalType:'LAB',scopes:{adc:['date'],lab:['topic'],adfa:['instructor']},scopeSignatures:{adc:'adc-v1',lab:'lab-v1',adfa:'adfa-v1'},updatedAt:new Date('2026-09-17T12:00:00Z')};}
function approval(office,fields,signature){return{id:`r3_${office}`,requestId:'r3',office,revision:1,fields,scopeSignature:signature,status:'pending',decidedBy:'',decidedByName:'',decidedAt:null,pushBackReason:'',updatedAt:new Date('2026-09-17T12:00:00Z')};}

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-approval-order',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role] of [['faculty','faculty'],['adc','adc'],['lab','lab'],['adfa','adfa_regular'],['developer','developer']])await db.doc(`users/${uid}`).set({role,active:true,mustChangePassword:false,email:`${uid}@example.test`});
  await db.doc('faculty/f1').set({email:'faculty@example.test'});
  await db.doc('change_requests/r3').set(publicRequest());
  await db.doc('change_request_workflow/r3').set(workflow());
  await db.doc('change_request_approvals/r3_adc').set(approval('adc',['date'],'adc-v1'));
  await db.doc('change_request_approvals/r3_lab').set(approval('lab',['topic'],'lab-v1'));
  await db.doc('change_request_approvals/r3_adfa').set(approval('adfa',['instructor'],'adfa-v1'));
 });
});
after(async()=>{if(env)await env.cleanup()});

const approve=(db,office,stamp)=>{const batch=db.batch();batch.update(db.doc(`change_request_approvals/r3_${office}`),{status:'approved',decidedBy:office,decidedByName:office.toUpperCase(),decidedAt:stamp,pushBackReason:'',updatedAt:stamp});batch.update(db.doc('change_requests/r3'),{updatedAt:stamp});return batch.commit();};

check('LAB cannot approve while ADC is still pending',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('lab').firestore();
 await assertFails(approve(db,'lab',serverTimestamp()));
});

check('ADFA cannot approve while ADC is still pending',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('adfa').firestore();
 await assertFails(approve(db,'adfa',serverTimestamp()));
});

check('ADC approves its own scope first',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('adc').firestore();
 await assertSucceeds(approve(db,'adc',serverTimestamp()));
});

check('ADFA still cannot approve while the applicable LAB stage is pending',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('adfa').firestore();
 await assertFails(approve(db,'adfa',serverTimestamp()));
});

check('LAB approves after ADC',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('lab').firestore();
 await assertSucceeds(approve(db,'lab',serverTimestamp()));
});

check('ADFA approves last, once every earlier required office has approved',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
 const db=env.authenticatedContext('adfa').firestore();
 await assertSucceeds(approve(db,'adfa',serverTimestamp()));
});

check('reject and push back are not blocked by stage order',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await db.doc('change_requests/r4').set({...publicRequest(),sessionId:'s2'});
  await db.doc('change_request_workflow/r4').set({...workflow(),requestId:'r4'});
  await db.doc('change_request_approvals/r4_adc').set({...approval('adc',['date'],'adc-v1'),id:'r4_adc',requestId:'r4'});
  await db.doc('change_request_approvals/r4_lab').set({...approval('lab',['topic'],'lab-v1'),id:'r4_lab',requestId:'r4'});
  await db.doc('change_request_approvals/r4_adfa').set({...approval('adfa',['instructor'],'adfa-v1'),id:'r4_adfa',requestId:'r4'});
 });
 const db=env.authenticatedContext('adfa').firestore(),stamp=serverTimestamp(),batch=db.batch();
 batch.update(db.doc('change_request_approvals/r4_adfa'),{status:'rejected',decidedBy:'adfa',decidedByName:'ADFA',decidedAt:stamp,pushBackReason:'',updatedAt:stamp});
 batch.update(db.doc('change_requests/r4'),{status:'rejected',editableFields:[],requesterMessage:'',updatedAt:stamp});
 await assertSucceeds(batch.commit());
});

check('Developer cross-office testing still respects the stage order',async()=>{
 const {assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await db.doc('change_requests/r5').set({...publicRequest(),sessionId:'s5'});
  await db.doc('change_request_workflow/r5').set({...workflow(),requestId:'r5'});
  for(const [office,fields,signature] of [['adc',['date'],'adc-v1'],['lab',['topic'],'lab-v1'],['adfa',['instructor'],'adfa-v1']])await db.doc(`change_request_approvals/r5_${office}`).set({...approval(office,fields,signature),id:`r5_${office}`,requestId:'r5'});
 });
 const db=env.authenticatedContext('developer').firestore();
 const decide=async(office,stamp)=>{const batch=db.batch();batch.update(db.doc(`change_request_approvals/r5_${office}`),{status:'approved',decidedBy:'developer',decidedByName:'VISTA Developer',decidedAt:stamp,pushBackReason:'',updatedAt:stamp});batch.update(db.doc('change_requests/r5'),{updatedAt:stamp});return batch.commit()};
 // Developer cannot jump straight to ADFA or LAB while ADC is pending.
 await assertFails(decide('adfa',serverTimestamp()));
 await assertFails(decide('lab',serverTimestamp()));
 await assertSucceeds(decide('adc',serverTimestamp()));
 await assertFails(decide('adfa',serverTimestamp()));
 await assertSucceeds(decide('lab',serverTimestamp()));
 await assertSucceeds(decide('adfa',serverTimestamp()));
});
