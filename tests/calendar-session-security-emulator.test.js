'use strict';
const {test,before,after}=require('node:test'),fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('calendar session: '+name,{skip:!enabled},fn);
before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-calendar-security',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role,fid] of [['adc','adc',''],['lab','lab',''],['owner','owner',''],['adfa','adfa_regular',''],['faculty','faculty','f1'],['otherfaculty','faculty','f2'],['inactive','adc',''],['password','lab','']])await db.doc(`users/${uid}`).set({role,active:uid!=='inactive',mustChangePassword:uid==='password',email:uid+'@example.test',...(fid?{facultyId:fid}:{})});
  await db.doc('faculty/f1').set({email:'faculty@example.test',doe:3.5});
  await db.doc('faculty/f2').set({email:'otherfaculty@example.test',doe:3.5});
  await db.doc('sessions/s1').set({course:'505',date:'2027-03-22',start:'14:45',end:'16:15',type:'LAB',topic:'Suturing',instructor:'Jane Smith',facultyIds:['f1'],assignments:[{ucid:'f1',name:'Jane Smith',doeCredit:0.5}]});
  await db.doc('calendar_sessions/s1').set({sessionId:'s1',course:'505',courseName:'',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'',instructor:'Jane Smith',instructorNames:['Jane Smith']});
  await db.doc('settings/faculty_swap_index').set({entries:[{key:'k',unavailableRanges:[{start:'2027-01-01',end:'2027-01-10'}]}]});
  await db.doc('public_schedule/ccc_events').set({events:[{facultyId:'f1',startDate:'2027-01-01'}]});
  await db.doc('session_change_log/faculty-related').set({action:'batch_update',sessionId:'s1',course:'505',date:'2027-03-22',topic:'Suturing',instructors:['Jane Smith'],changes:[{field:'date',before:'2027-03-21',after:'2027-03-22'}],changedBy:'owner',changedByName:'OWNER',changedByEmail:'owner@example.test',changedAt:new Date('2026-09-18T12:10:00Z')});
  await db.doc('afc_audit/faculty-related').set({action:'afc_submitted',requesterUid:'faculty',reportToUid:'owner',changedBy:'owner',changedAt:new Date('2026-09-18T12:11:00Z')});
  await db.doc('account_audit/faculty-related').set({action:'account_updated',targetUid:'faculty',changedBy:'owner',changedAt:new Date('2026-09-18T12:12:00Z')});
  await db.doc('change_request_audit/requester-related').set({requestId:'r-owned',requesterUid:'faculty',sessionId:'missing-session',event:'office_approve',revision:1,status:'pending',office:'lab',message:'',changedFields:['topic'],changedBy:'owner',changedByName:'OWNER',changedAt:new Date('2026-09-18T12:13:00Z')});
  await db.doc('change_request_audit/session-related').set({requestId:'r-session',requesterUid:'owner',sessionId:'s1',event:'office_approve',revision:1,status:'pending',office:'lab',message:'',changedFields:['topic'],changedBy:'owner',changedByName:'OWNER',changedAt:new Date('2026-09-18T12:14:00Z')});
  for(const uid of ['adc','lab']){
   await db.doc(`afc_requests/${uid}-legacy`).set({requesterUid:uid,reportToUid:uid,purpose:'private purpose',status:'pending_admin'});
   await db.doc(`change_requests/${uid}-legacy`).set({requesterUid:uid,fromFaculty:{ucid:'f1'},status:'pending'});
   await db.doc(`change_request_private/${uid}-private`).set({requesterUid:uid,assignmentChange:{ucid:'f1'}});
   await db.doc(`faculty_groups/${uid}-group`).set({ownerUid:uid,memberUids:[uid,'faculty']});
   for(const collection of ['session_change_log','faculty_change_log','afc_audit','account_audit','audit_events'])await db.doc(`${collection}/${uid}-legacy`).set({changedBy:uid,requesterUid:uid,reportToUid:uid,privateFacultyId:'f1'});
   await db.doc(`session_change_log/${uid}-safe`).set({action:'batch_update',sessionId:'s1',course:'505',date:'2027-03-22',topic:'Suturing',instructors:[],before:{topic:'Old'},after:{topic:'Suturing'},changes:[{field:'topic',before:'Old',after:'Suturing'}],changedBy:uid,changedByName:uid.toUpperCase(),changedByEmail:'',changedAt:new Date('2026-09-18T12:00:00Z')});
   await db.doc(`change_request_audit/${uid}-safe`).set({requestId:'r-'+uid,event:'office_approved',revision:1,status:'pending',office:uid,message:'',changedFields:['topic'],changedBy:uid,changedByName:uid.toUpperCase(),changedAt:new Date('2026-09-18T12:00:00Z')});
  }
 });
});
after(async()=>{if(env)await env.cleanup();});
check('ADC and LAB can get and query sanitized calendar but not private source sessions',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['adc','lab']){const db=env.authenticatedContext(uid).firestore();await assertSucceeds(db.doc('calendar_sessions/s1').get());await assertSucceeds(db.collection('calendar_sessions').where('date','==','2027-03-22').get());await assertFails(db.doc('sessions/s1').get());await assertFails(db.collection('sessions').get());}
});
check('office accounts are denied private data even when legacy actor or requester IDs match',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['adc','lab']){const db=env.authenticatedContext(uid).firestore();for(const path of ['faculty/f1','settings/faculty_swap_index','settings/faculty_swap_map','settings/faculty_index','public_schedule/ccc_events',`faculty_groups/${uid}-group`,`afc_requests/${uid}-legacy`,`change_requests/${uid}-legacy`,`change_request_private/${uid}-private`,...['session_change_log','faculty_change_log','afc_audit','account_audit','audit_events'].map(c=>`${c}/${uid}-legacy`)])await assertFails(db.doc(path).get());}
});
check('ADC and LAB can read only their sanitized personal session and workflow history',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['adc','lab']){
  const db=env.authenticatedContext(uid).firestore();
  await assertSucceeds(db.doc(`session_change_log/${uid}-safe`).get());
  await assertSucceeds(db.doc(`change_request_audit/${uid}-safe`).get());
  await assertFails(db.doc(`session_change_log/${uid}-legacy`).get());
 }
});
check('Faculty can read session, AFC and account audit records related to themselves but not another Faculty',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const faculty=env.authenticatedContext('faculty').firestore(),other=env.authenticatedContext('otherfaculty').firestore();
 for(const path of ['session_change_log/faculty-related','afc_audit/faculty-related','account_audit/faculty-related','change_request_audit/requester-related','change_request_audit/session-related'])await assertSucceeds(faculty.doc(path).get());
 await assertSucceeds(faculty.collection('session_change_log').where('sessionId','==','s1').get());
 await assertSucceeds(faculty.collection('afc_audit').where('requesterUid','==','faculty').get());
 await assertSucceeds(faculty.collection('account_audit').where('targetUid','==','faculty').get());
 await assertSucceeds(faculty.collection('change_request_audit').where('requesterUid','==','faculty').get());
 await assertSucceeds(faculty.collection('change_request_audit').where('sessionId','==','s1').get());
 for(const path of ['session_change_log/faculty-related','afc_audit/faculty-related','account_audit/faculty-related','change_request_audit/requester-related','change_request_audit/session-related'])await assertFails(other.doc(path).get());
 await assertFails(other.collection('session_change_log').where('sessionId','==','s1').get());
 await assertFails(other.collection('change_request_audit').where('sessionId','==','s1').get());
});
check('ADFA and Faculty keep their existing reads',async()=>{
 const {assertSucceeds}=require('@firebase/rules-unit-testing');for(const uid of ['adfa','owner','faculty']){const db=env.authenticatedContext(uid).firestore();await assertSucceeds(db.doc('sessions/s1').get());await assertSucceeds(db.doc('faculty/f1').get());}
});
check('inactive, password-required and anonymous users cannot read calendar',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');for(const uid of ['inactive','password'])await assertFails(env.authenticatedContext(uid).firestore().doc('calendar_sessions/s1').get());await assertFails(env.unauthenticatedContext().firestore().doc('calendar_sessions/s1').get());
});
check('only Owner may link an office profile and it cannot carry Faculty identity',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const owner=env.authenticatedContext('owner').firestore(),stamp=()=>require('firebase/firestore').serverTimestamp();
 const fields={name:'Office',email:'office@example.test',role:'adc',active:true,mustChangePassword:true,updatedBy:'owner',updatedAt:stamp(),createdAt:stamp()};
 await assertSucceeds(owner.doc('users/new-office').set(fields));
 await assertFails(owner.doc('users/unsafe-office').set({...fields,facultyId:'f1',facultyRoles:['faculty']}));
 await assertFails(env.authenticatedContext('adfa').firestore().doc('users/not-owner').set({...fields,updatedBy:'adfa'}));
});
check('ADC and LAB cannot write arbitrary calendar repair, source changes or their own role',async()=>{
 const {assertFails}=require('@firebase/rules-unit-testing');
 for(const uid of ['adc','lab']){const db=env.authenticatedContext(uid).firestore();await assertFails(db.doc('calendar_sessions/forged').set({facultyIds:['f1']}));await assertFails(db.doc('calendar_sessions/s1').update({instructorNames:['private@example.test']}));await assertFails(db.doc('sessions/s1').update({assignments:[]}));await assertFails(db.doc(`users/${uid}`).update({role:'owner'}));}
});
