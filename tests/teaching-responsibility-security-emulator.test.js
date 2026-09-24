'use strict';
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const {assertSucceeds,assertFails,initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {serverTimestamp,Timestamp}=require('firebase/firestore');

const enabled=Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const check=(name,fn)=>test('Teaching responsibility security: '+name,{skip:!enabled},fn);
let env;
const db=uid=>env.authenticatedContext(uid).firestore();

before(async()=>{
 if(!enabled)return;
 env=await initializeTestEnvironment({projectId:'demo-ucvm-teaching-responsibility',
  firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  const fire=context.firestore();
  for(const [uid,role,facultyId] of [
   ['owner','owner',''],['developer','developer',''],['administrator','administrator',''],
   ['bill','faculty','f-bill'],['lisa','faculty','f-lisa'],['other','faculty','f-other']
  ])await fire.doc('users/'+uid).set({role,active:true,mustChangePassword:false,email:uid+'@example.test',...(facultyId?{facultyId}:{})});
 });
});
after(async()=>{if(env)await env.cleanup()});

check('Owner and Developer manage definitions while Administrator and Faculty cannot',async()=>{
 for(const uid of ['owner','developer']){
  const fire=db(uid);
  await assertSucceeds(fire.doc('teaching_responsibilities/hicc-surgery').set({
   id:'hicc-surgery',kind:'hicc',groupId:'surgery',label:'Surgery HICC',
   academicScopeTokens:['hicc|vtmd-505|surgery'],active:true,updatedBy:uid,updatedByName:uid,updatedAt:serverTimestamp()
  }));
 }
 for(const uid of ['administrator','bill']){
  await assertFails(db(uid).doc('teaching_responsibilities/blocked').set({
   id:'blocked',kind:'visc',groupId:'',label:'Blocked',academicScopeTokens:[],active:true,
   updatedBy:uid,updatedByName:uid,updatedAt:serverTimestamp()
  }));
 }
});

check('Owner can write a safe dated assignee projection and the assignee can read only their own row',async()=>{
 const fire=db('owner'),activeAt=Timestamp.fromDate(new Date('2026-09-01T06:00:00Z')),expiresAt=Timestamp.fromDate(new Date('2027-03-01T07:00:00Z'));
 await assertSucceeds(fire.doc('teaching_responsibilities/hicc-surgery/years/2026-27/assignees/lisa').set({
  responsibilityId:'hicc-surgery',academicYearKey:'2026-27',assigneeUid:'lisa',facultyId:'f-lisa',enabled:true,
  windows:[{activeDate:'2026-09-01',expirationDate:'2027-03-01',activeAt,expiresAt,sourceDoeAssignmentFactId:'role-fact-1'}],
  updatedBy:'owner',updatedByName:'Owner',updatedAt:serverTimestamp()
 }));
 await assertSucceeds(db('lisa').doc('teaching_responsibilities/hicc-surgery/years/2026-27/assignees/lisa').get());
 await assertFails(db('bill').doc('teaching_responsibilities/hicc-surgery/years/2026-27/assignees/lisa').get());
 await assertFails(db('lisa').collection('teaching_responsibilities/hicc-surgery/years/2026-27/assignees').get());
});

check('Assignee projections reject private leave DOE override and arbitrary note fields',async()=>{
 const fire=db('owner'),activeAt=Timestamp.fromDate(new Date('2026-09-01T06:00:00Z')),expiresAt=Timestamp.fromDate(new Date('2027-03-01T07:00:00Z'));
 const base={responsibilityId:'hicc-surgery',academicYearKey:'2026-27',assigneeUid:'bill',facultyId:'f-bill',enabled:true,
  windows:[{activeDate:'2026-09-01',expirationDate:'2027-03-01',activeAt,expiresAt,sourceDoeAssignmentFactId:'role-fact-2'}],
  updatedBy:'owner',updatedByName:'Owner',updatedAt:serverTimestamp()};
 for(const extra of [{doeOverride:-2},{rslReason:'leave'},{notes:'private leave details'},{afcReason:'away'}])
  await assertFails(fire.doc('teaching_responsibilities/hicc-surgery/years/2026-27/assignees/bill').set({...base,...extra}));
});

check('Group configuration is high-trust only and keeps stable responsibility IDs',async()=>{
 const row={id:'surgery',name:'Surgery',leaderViscResponsibilityId:'visc-surgery',hiccResponsibilityIds:['hicc-surgery'],active:true,
  updatedBy:'owner',updatedByName:'Owner',updatedAt:serverTimestamp()};
 await assertSucceeds(db('owner').doc('teaching_assignment_groups/surgery').set(row));
 await assertFails(db('administrator').doc('teaching_assignment_groups/surgery-2').set({...row,id:'surgery-2',updatedBy:'administrator'}));
 await assertFails(db('lisa').doc('teaching_assignment_groups/surgery').get());
});
