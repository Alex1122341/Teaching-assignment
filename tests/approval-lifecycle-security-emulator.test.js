'use strict';
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('routed approval lifecycle: '+name,{skip:!enabled},fn);
const basePublic={course:'505',courseName:'Clinical Skills',year:3,semester:'winter',week:8,date:'2027-03-22',start:'09:00',end:'10:00',timeUnknown:false,type:'LEC',topic:'Old topic',room:'CSB 116',instructor:''};
function publicRequest(overrides={}){return{requestSchema:'office-routing-v1',requesterUid:'faculty',requesterName:'Faculty User',requesterRole:'faculty',sessionId:'s1',requestType:'session_edit',scope:'hicc',groupId:'g1',groupName:'HICC 1',status:'pending',revision:1,basePublic:{...basePublic},patchPublic:{date:'2027-03-23'},currentFacultyName:'',proposedFacultyName:'',editableFields:[],requesterMessage:'',reason:'',course:'505',date:'2027-03-22',topic:'Old topic',requestedAt:new Date('2026-09-17T12:00:00Z'),updatedAt:new Date('2026-09-17T12:00:00Z'),...overrides};}
function workflow(overrides={}){return{requestId:'r1',revision:1,requiredOffices:['adc'],hasFacultyChange:false,finalType:'LEC',scopes:{adc:['date'],lab:[],adfa:[]},scopeSignatures:{adc:'date-v1',lab:'[]',adfa:'[]'},updatedAt:new Date('2026-09-17T12:00:00Z'),...overrides};}
function approval(overrides={}){return{id:'r1_adc',requestId:'r1',office:'adc',revision:1,fields:['date'],scopeSignature:'date-v1',status:'pending',decidedBy:'',decidedByName:'',decidedAt:null,pushBackReason:'',updatedAt:new Date('2026-09-17T12:00:00Z'),...overrides};}
const calendar={sessionId:'s1',course:'505',courseName:'Clinical Skills',year:3,semester:'winter',week:8,date:'2027-03-22',start:'09:00',end:'10:00',timeUnknown:false,type:'LEC',topic:'Old topic',room:'CSB 116',instructorNames:[],instructor:''};
const source={...basePublic,assignments:[],facultyIds:[],updatedBy:'seed',updatedByName:'Seed'};

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-approval-lifecycle',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role] of [['faculty','faculty'],['other','faculty'],['adc','adc'],['lab','lab'],['adfa','adfa_regular']]){const profile={role,active:true,mustChangePassword:false,email:`${uid}@example.test`};if(role==='faculty')profile.facultyId=uid==='faculty'?'f1':'f2';await db.doc(`users/${uid}`).set(profile);}
  await db.doc('faculty/f1').set({email:'faculty@example.test'});await db.doc('faculty/f2').set({email:'other@example.test'});
  await db.doc('change_requests/r1').set(publicRequest());await db.doc('change_request_workflow/r1').set(workflow());await db.doc('change_request_approvals/r1_adc').set(approval());
  await db.doc('sessions/s1').set(source);await db.doc('calendar_sessions/s1').set(calendar);
  await db.doc('change_requests/withdraw').set(publicRequest({sessionId:'s2'}));
  await db.doc('change_requests/resubmit').set(publicRequest({sessionId:'s3',status:'update_required',editableFields:['date'],requesterMessage:'Choose another date.'}));
  await db.doc('change_request_workflow/resubmit').set(workflow({requestId:'resubmit'}));await db.doc('change_request_approvals/resubmit_adc').set(approval({id:'resubmit_adc',requestId:'resubmit',status:'push_back',decidedBy:'adc',decidedByName:'ADC',decidedAt:new Date('2026-09-17T12:05:00Z'),pushBackReason:'Choose another date.'}));
  await db.doc('change_requests/withdrawn').set(publicRequest({sessionId:'s4',status:'withdrawn',withdrawnBy:'faculty',withdrawnAt:new Date('2026-09-17T12:10:00Z')}));
 });
});
after(async()=>{if(env)await env.cleanup()});

check('ADC may approve its own scope atomically but cannot decide another office record',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore'),db=env.authenticatedContext('adc').firestore();
 let batch=db.batch(),stamp=serverTimestamp();
 batch.update(db.doc('change_request_approvals/r1_adc'),{status:'approved',decidedBy:'adc',decidedByName:'ADC',decidedAt:stamp,pushBackReason:'',updatedAt:stamp});
 batch.update(db.doc('change_requests/r1'),{status:'pending',updatedAt:stamp});
 await assertSucceeds(batch.commit());
 await env.withSecurityRulesDisabled(async ctx=>{await ctx.firestore().doc('change_request_approvals/r1_lab').set({id:'r1_lab',requestId:'r1',office:'lab',revision:1,fields:['topic'],scopeSignature:'lab-v1',status:'pending',decidedBy:'',decidedByName:'',decidedAt:null,pushBackReason:''})});
 stamp=serverTimestamp();batch=db.batch();batch.update(db.doc('change_request_approvals/r1_lab'),{status:'approved',decidedBy:'adc',decidedByName:'ADC',decidedAt:stamp,updatedAt:stamp});batch.update(db.doc('change_requests/r1'),{status:'pending',updatedAt:stamp});await assertFails(batch.commit());
});

check('requester may withdraw only its own open request and terminal request cannot be reactivated',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');
 const mine=env.authenticatedContext('faculty').firestore(),other=env.authenticatedContext('other').firestore();
 let stamp=serverTimestamp();await assertSucceeds(mine.doc('change_requests/withdraw').update({status:'withdrawn',editableFields:[],requesterMessage:'',withdrawnBy:'faculty',withdrawnAt:stamp,updatedAt:stamp}));
 stamp=serverTimestamp();await assertFails(other.doc('change_requests/resubmit').update({status:'withdrawn',editableFields:[],requesterMessage:'',withdrawnBy:'other',withdrawnAt:stamp,updatedAt:stamp}));
 await assertFails(mine.doc('change_requests/withdrawn').update({status:'pending',updatedAt:serverTimestamp()}));
});

check('requester blind resubmission can reset only the returned scope without reading internal records',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore'),db=env.authenticatedContext('faculty').firestore();
 const stamp=serverTimestamp(),batch=db.batch(),newDate='2027-03-24';
 batch.update(db.doc('change_requests/resubmit'),{patchPublic:{date:newDate},status:'pending',revision:2,editableFields:[],requesterMessage:'',date:newDate,updatedAt:stamp});
 batch.set(db.doc('change_request_workflow/resubmit'),{requestId:'resubmit',revision:2,requiredOffices:['adc'],hasFacultyChange:false,finalType:'LEC',scopes:{adc:['date'],lab:[],adfa:[]},scopeSignatures:{adc:'date-v2',lab:'[]',adfa:'[]'},updatedAt:stamp});
 batch.set(db.doc('change_request_approvals/resubmit_adc'),{id:'resubmit_adc',requestId:'resubmit',office:'adc',revision:2,fields:['date'],scopeSignature:'date-v2',status:'pending',decidedBy:'',decidedByName:'',decidedAt:null,pushBackReason:'',updatedAt:stamp},{merge:true});
 await assertSucceeds(batch.commit());
});

check('last required office may apply an approved non-Faculty request exactly through the public patch',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore'),db=env.authenticatedContext('adc').firestore();
 const stamp=serverTimestamp(),batch=db.batch();
 batch.update(db.doc('sessions/s1'),{date:'2027-03-23',approvalRequestId:'r1',approvalRevision:1,updatedBy:'adc',updatedByName:'ADC',updatedAt:stamp});
 batch.set(db.doc('calendar_sessions/s1'),{...calendar,date:'2027-03-23'});
 batch.update(db.doc('change_requests/r1'),{status:'approved',editableFields:[],requesterMessage:'',appliedRevision:1,appliedAt:stamp,updatedAt:stamp});
 batch.set(db.collection('session_change_log').doc(),{action:'approved_session_edit',override:null,requestId:'r1',sessionId:'s1',course:'505',date:'2027-03-23',topic:'Old topic',instructors:[],changes:[{field:'date',before:'2027-03-22',after:'2027-03-23'}],changedBy:'adc',changedByName:'ADC',changedByEmail:'',changedAt:stamp});
 batch.set(db.collection('change_request_audit').doc(),{requestId:'r1',requesterUid:'faculty',sessionId:'s1',event:'request_applied',revision:1,office:'adc',changedBy:'adc',changedByName:'ADC',changedAt:stamp});
 await assertSucceeds(batch.commit());
});
