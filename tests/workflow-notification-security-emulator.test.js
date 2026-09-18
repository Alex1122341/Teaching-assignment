'use strict';
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;let env;
const check=(name,fn)=>test('workflow notification security: '+name,{skip:!enabled},fn);
const payload=(overrides={})=>({recipientOffice:'adc',kind:'office_decision',requestId:'r1',sessionId:'s1',course:'505',date:'2027-03-22',start:'14:45',end:'16:15',type:'LAB',topic:'Suturing',facultyDisplayName:'Dr Jane Smith',message:'',createdAt:new Date(),readBy:[],...overrides});

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:'demo-ucvm-workflow-notifications',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role] of [['adc','adc'],['lab','lab'],['adfa','adfa_regular'],['owner','owner'],['faculty','faculty']])await db.doc(`users/${uid}`).set({role,active:true,mustChangePassword:false,email:`${uid}@example.test`,...(role==='faculty'?{facultyId:'f1'}:{})});
  await db.doc('faculty/f1').set({email:'faculty@example.test'});
  await db.doc('calendar_sessions/s1').set({sessionId:'s1',course:'505',courseName:'Clinical Skills',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'CSB 116',instructor:'Dr Jane Smith',instructorNames:['Dr Jane Smith']});
  await db.doc('workflow_notifications/n-adc').set(payload({recipientOffice:'adc'}));
  await db.doc('workflow_notifications/n-lab').set(payload({recipientOffice:'lab'}));
  await db.doc('workflow_notifications/n-adfa').set(payload({recipientOffice:'adfa'}));
 });
});
after(async()=>{if(env)await env.cleanup()});

check('office accounts read only their own office feed while Owner can read all',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const adc=env.authenticatedContext('adc').firestore(),lab=env.authenticatedContext('lab').firestore(),adfa=env.authenticatedContext('adfa').firestore(),owner=env.authenticatedContext('owner').firestore();
 await assertSucceeds(adc.doc('workflow_notifications/n-adc').get());await assertFails(adc.doc('workflow_notifications/n-lab').get());
 await assertSucceeds(lab.doc('workflow_notifications/n-lab').get());await assertFails(lab.doc('workflow_notifications/n-adfa').get());
 await assertSucceeds(adfa.doc('workflow_notifications/n-adfa').get());await assertFails(adfa.doc('workflow_notifications/n-adc').get());
 await assertSucceeds(owner.doc('workflow_notifications/n-adc').get());await assertSucceeds(owner.doc('workflow_notifications/n-lab').get());
});

check('acknowledgement can only add the signed-in UID to readBy',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const adc=env.authenticatedContext('adc').firestore();
 await assertSucceeds(adc.doc('workflow_notifications/n-adc').update({readBy:['adc']}));
 await assertFails(adc.doc('workflow_notifications/n-adc').update({message:'forged'}));
 await assertFails(adc.doc('workflow_notifications/n-adc').update({readBy:['adc','someone-else']}));
 await assertFails(env.authenticatedContext('lab').firestore().doc('workflow_notifications/n-adc').update({readBy:['lab']}));
});

check('ADC can emit only a sanitized ADFA assignment recheck matching the live calendar',async()=>{
 const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const {serverTimestamp}=require('firebase/firestore');
 const row={recipientOffice:'adfa',kind:'assignment_recheck_required',requestId:'',sessionId:'s1',course:'505',date:'2027-03-22',start:'14:45',end:'16:15',type:'LAB',topic:'Suturing',facultyDisplayName:'Dr Jane Smith',message:'',createdAt:serverTimestamp(),readBy:[]};
 await assertSucceeds(env.authenticatedContext('adc').firestore().doc('workflow_notifications/recheck-ok').set(row));
 await assertFails(env.authenticatedContext('adc').firestore().doc('workflow_notifications/recheck-private').set({...row,facultyDisplayName:'private@example.test'}));
 await assertFails(env.authenticatedContext('lab').firestore().doc('workflow_notifications/recheck-lab').set(row));
});
