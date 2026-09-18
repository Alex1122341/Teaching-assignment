'use strict';
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('WS5B role matrix: '+name,{skip:!enabled},fn);
const calendar=(sessionId,overrides={})=>({sessionId,course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'CSB 116',instructor:'Dr Jane Smith',instructorNames:['Dr Jane Smith'],...overrides});
const source=(overrides={})=>({course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'CSB 116',instructor:'Dr Jane Smith',instructorNames:['Dr Jane Smith'],facultyIds:['f1'],assignments:[{ucid:'f1',name:'Dr Jane Smith'}],updatedBy:'seed',updatedByName:'Seed',updatedAt:new Date(),...overrides});
const publicRequest=(requesterUid='faculty')=>({requestSchema:'office-routing-v1',requesterUid,requesterName:'Faculty One',requesterRole:'faculty',sessionId:'s_faculty',requestType:'session_edit',scope:'self',groupId:'',groupName:'',status:'pending',revision:1,basePublic:{course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'CSB 116',instructor:'Dr Jane Smith'},patchPublic:{course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-23',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'CSB 116',instructor:'Dr Jane Smith'},currentFacultyName:'Dr Jane Smith',proposedFacultyName:'Dr Jane Smith',editableFields:[],requesterMessage:'',reason:'',course:'505',date:'2027-03-23',topic:'Suturing',requestedAt:new Date(),updatedAt:new Date(),appliedRevision:0,appliedAt:null,withdrawnBy:'',withdrawnAt:null});

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-ws5b-matrix',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role,facultyId] of [['adc','adc',''],['lab','lab',''],['adfa','adfa_regular',''],['faculty','faculty','f1'],['other','faculty','f2']])await db.doc(`users/${uid}`).set({role,active:true,mustChangePassword:false,facultyId,email:`${uid}@example.test`});
  await db.doc('faculty/f1').set({email:'faculty@example.test'});await db.doc('faculty/f2').set({email:'other@example.test'});
  for(const id of ['s_adc','s_lab','s_adfa','s_faculty']){await db.doc(`sessions/${id}`).set(source());await db.doc(`calendar_sessions/${id}`).set(calendar(id));}
  await db.doc('afc_requests/a1').set({requesterUid:'faculty',facultyId:'f1',reportToUid:'',status:'pending_admin'});
  await db.doc('change_requests/r1').set(publicRequest('faculty'));
  await db.doc('change_requests/r2').set({...publicRequest('other'),sessionId:'s_faculty'});
  await db.doc('change_request_workflow/r1').set({requestId:'r1',revision:1,requiredOffices:['adc'],hasFacultyChange:false,finalType:'LAB',scopes:{adc:['date'],lab:[],adfa:[]},scopeSignatures:{adc:'sig',lab:'',adfa:''},updatedAt:new Date()});
  await db.doc('change_request_approvals/r1_adc').set({id:'r1_adc',requestId:'r1',office:'adc',revision:1,fields:['date'],scopeSignature:'sig',status:'pending',decidedBy:'',decidedByName:'',decidedAt:null,pushBackReason:'',updatedAt:new Date()});
  await db.doc('change_request_private/r1').set({requestId:'r1',requesterUid:'faculty',revision:1,assignmentChange:{assignmentIndex:0,from:{facultyId:'f1'},to:{candidateKey:'opaque'}},updatedAt:new Date()});
 });
});
after(async()=>{if(env)await env.cleanup()});

check('ADC reads sanitized calendar only and may change ADC-owned public fields but not assignments',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');const db=env.authenticatedContext('adc').firestore();
 const id='s_adc';
 await assertSucceeds(db.doc(`calendar_sessions/${id}`).get());await assertFails(db.doc(`sessions/${id}`).get());await assertFails(db.doc('faculty/f1').get());await assertFails(db.doc('afc_requests/a1').get());
 const batch=db.batch(),stamp=serverTimestamp();batch.update(db.doc(`sessions/${id}`),{date:'2027-03-23',updatedBy:'adc',updatedByName:'ADC',updatedAt:stamp});batch.set(db.doc(`calendar_sessions/${id}`),calendar(id,{date:'2027-03-23'}));await assertSucceeds(batch.commit());
 await assertFails(db.doc(`sessions/${id}`).update({assignments:[],updatedBy:'adc',updatedByName:'ADC',updatedAt:serverTimestamp()}));
});

check('LAB reads sanitized calendar and can change LAB topic only',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');const db=env.authenticatedContext('lab').firestore();
 const id='s_lab';
 await assertSucceeds(db.doc(`calendar_sessions/${id}`).get());await assertFails(db.doc(`sessions/${id}`).get());
 const batch=db.batch(),stamp=serverTimestamp();batch.update(db.doc(`sessions/${id}`),{topic:'Advanced Suturing',updatedBy:'lab',updatedByName:'LAB',updatedAt:stamp});batch.set(db.doc(`calendar_sessions/${id}`),calendar(id,{topic:'Advanced Suturing'}));await assertSucceeds(batch.commit());
 await assertFails(db.doc(`sessions/${id}`).update({room:'Other',updatedBy:'lab',updatedByName:'LAB',updatedAt:serverTimestamp()}));
});

check('ADFA retains private Faculty AFC and instructor assignment authority',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');const db=env.authenticatedContext('adfa').firestore();
 const id='s_adfa';
 await assertSucceeds(db.doc(`sessions/${id}`).get());await assertSucceeds(db.doc('faculty/f1').get());await assertSucceeds(db.doc('afc_requests/a1').get());
 const batch=db.batch(),stamp=serverTimestamp();batch.update(db.doc(`sessions/${id}`),{instructor:'Dr Updated',facultyIds:['f1'],assignments:[{ucid:'f1',name:'Dr Updated'}],updatedBy:'adfa',updatedByName:'ADFA',updatedAt:stamp});batch.set(db.doc(`calendar_sessions/${id}`),calendar(id,{instructor:'Dr Updated',instructorNames:['Dr Updated']}));await assertSucceeds(batch.commit());
});

check('Faculty reads only own public request internals stay private and only owner can withdraw',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),{serverTimestamp}=require('firebase/firestore');const own=env.authenticatedContext('faculty').firestore(),other=env.authenticatedContext('other').firestore();
 await assertSucceeds(own.doc('change_requests/r1').get());await assertFails(own.doc('change_request_workflow/r1').get());await assertFails(own.doc('change_request_approvals/r1_adc').get());await assertFails(own.doc('change_request_private/r1').get());await assertFails(other.doc('change_requests/r1').get());
 await assertSucceeds(own.doc('change_requests/r1').update({status:'withdrawn',editableFields:[],requesterMessage:'',withdrawnBy:'faculty',withdrawnAt:serverTimestamp(),updatedAt:serverTimestamp()}));
 await assertFails(other.doc('change_requests/r1').update({status:'withdrawn',editableFields:[],requesterMessage:'',withdrawnBy:'other',withdrawnAt:serverTimestamp(),updatedAt:serverTimestamp()}));
});
