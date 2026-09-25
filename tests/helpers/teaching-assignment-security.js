'use strict';
const fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {Timestamp,serverTimestamp}=require('firebase/firestore');
const PACKAGE='ta-sub-v2__2026-27__surgery__hicc-surgery';
const packageRow=(patch={})=>({id:PACKAGE,academicYearKey:'2026-27',groupId:'surgery',hiccResponsibilityId:'hicc-surgery',viscResponsibilityId:'visc-surgery',status:'draft',revision:0,workingRevision:0,submittedWorkingRevision:null,viscApprovedWorkingRevision:null,reviewFingerprint:'',viscApprovedFingerprint:'',viscReviewComment:'',submittedForReviewAt:null,viscReviewedAt:null,finalSubmittedAt:null,updatedBy:'owner',updatedAt:Timestamp.fromMillis(0),...patch});
const session=(patch={})=>({academicYear:'2026-27',teachingAssignmentGroupId:'surgery',responsibleHiccResponsibilityId:'hicc-surgery',teachingAssignmentSubmissionId:PACKAGE,course:'VTMD 505',courseName:'Surgery',subjectKey:'surgery',year:1,semester:'Fall',week:1,date:'2026-10-01',start:'09:00',end:'10:00',timeUnknown:false,type:'LEC',topic:'Surgery basics',room:'A1',instructor:'',assignments:[],facultyIds:[],labGroupIds:[],updatedBy:'owner',updatedAt:Timestamp.fromMillis(0),...patch});
const projection=(row,id='s1')=>Object.fromEntries([['sessionId',id],...['course','courseName','subjectKey','year','semester','week','date','start','end','timeUnknown','type','topic','room','instructor','labGroupIds','academicYear','teachingAssignmentGroupId','responsibleHiccResponsibilityId'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]),['instructorNames',[]]]);
const meta=uid=>({updatedBy:uid,updatedAt:serverTimestamp()});
async function setup(projectId){
 const env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8')}});
 await env.clearFirestore();
 await seed(env,async fire=>{
  for(const [uid,role] of [['owner','owner'],['admin','administrator'],['hicc','hicc'],['successor','faculty'],['visc','visc'],['other','hicc'],['faculty','faculty'],['adc','adc'],['lab','lab'],['expired','hicc'],['future','hicc'],['disabled','hicc']])await fire.doc('users/'+uid).set({role,active:true,mustChangePassword:false,facultyId:'f-'+uid});
  await fire.doc('teaching_subjects/surgery').set({key:'surgery',label:'Surgery',active:true});
  await fire.doc('teaching_assignment_groups/surgery').set({id:'surgery',name:'Surgery',active:true,leaderViscResponsibilityId:'visc-surgery',hiccResponsibilityIds:['hicc-surgery']});
  await fire.doc('teaching_responsibilities/hicc-surgery').set({id:'hicc-surgery',kind:'hicc',groupId:'surgery',active:true,academicScopeTokens:['hicc|VTMD 505|surgery']});
  await fire.doc('teaching_responsibilities/visc-surgery').set({id:'visc-surgery',kind:'visc',groupId:'',active:true,academicScopeTokens:[]});
  for(const uid of ['hicc','successor','visc','expired','future','disabled']){
   const responsibilityId=uid==='visc'?'visc-surgery':'hicc-surgery';
   const now=Date.now(),activeAt=Timestamp.fromMillis(uid==='future'?now+3600000:now-3600000),expiresAt=Timestamp.fromMillis(uid==='expired'?now-1:now+7200000);
   await fire.doc(`teaching_responsibilities/${responsibilityId}/years/2026-27/assignees/${uid}`).set({responsibilityId,academicYearKey:'2026-27',assigneeUid:uid,facultyId:'f-'+uid,enabled:uid!=='disabled',windows:[{activeDate:'2026-09-01',expirationDate:'2027-01-01',activeAt,expiresAt}]});
  }
  await fire.doc('teaching_assignment_submissions/'+PACKAGE).set(packageRow());
  await fire.doc('sessions/s1').set(session());
  await fire.doc('calendar_sessions/s1').set(projection(session()));
 });return env;
}
async function seed(env,fn){return env.withSecurityRulesDisabled(c=>fn(c.firestore()));}
function edit(env,uid,patch,{bump=true,revision=1,id='s1',row=session()}={}){
 const fire=env.authenticatedContext(uid).firestore(),batch=fire.batch();
 batch.update(fire.doc('sessions/'+id),{...patch,...meta(uid)});
 batch.set(fire.doc('calendar_sessions/'+id),projection({...row,...patch},id));
 if(bump)batch.update(fire.doc('teaching_assignment_submissions/'+row.teachingAssignmentSubmissionId),{workingRevision:revision,workingChange:{kind:'session',id},...meta(uid)});
 return batch.commit();
}
module.exports={PACKAGE,packageRow,session,projection,meta,setup,seed,edit};
