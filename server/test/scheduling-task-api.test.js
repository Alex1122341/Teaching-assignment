'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSchedulingTaskApi}=require('../src/scheduling/scheduling-task-api');
const {createWriteGates}=require('../src/data/write-gates');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',KEY='A'.repeat(64);
const command={academicYear:'2026-27',expectedEvidenceVersion:'B'.repeat(64),expectedReviewVersion:'0000000000000000',reviewStatus:'Reviewed'};
function harness({profile={active:true,baseRole:'adfa_regular'},gates={},repository={}}={}){
 return createSchedulingTaskApi({verifyToken:async()=>({uid:'verified-actor'}),findUser:async()=>profile,writeGates:gates,repository});
}
function task(){return {issueKey:KEY,facultyKey:ID,displayName:'Synthetic Faculty',courseCode:'206',sessionId:ID,date:'2026-11-05',startTime:'09:00',endTime:'10:00',type:'instructor_overlap',severity:'Conflict',reviewStatus:'Unreviewed',evidenceVersion:'B'.repeat(64),reviewVersion:'0000000000000000',canReview:true,relatedSessions:[{id:ID,courseCode:'207',date:'2026-11-05',startTime:'09:30',endTime:'10:30',email:'PRIVATE'}],email:'PRIVATE',ucid:'PRIVATE',afcPurpose:'PRIVATE'};}
function queue(){return {tasks:[task()],total:1,nextCursor:null,snapshotVersion:'C'.repeat(64),academicYears:[{academicYear:'2026-27',email:'PRIVATE'}],filters:{faculty:[{facultyKey:ID,displayName:'Synthetic Faculty',ucid:'PRIVATE'}],courses:[{courseCode:'206',email:'PRIVATE'}]},capabilities:{canReview:true}};}

test('scheduling tasks reject absent or invalid credentials before SQL access',async()=>{
 const api=createSchedulingTaskApi({verifyToken:async()=>{throw Error('private identity detail');},findUser:async()=>{throw Error('SQL must not run');},repository:{}});
 for(const token of ['',null,'expired']){
  const response=await api.list(token,{academicYear:'2026-27'});
  assert.equal(response.status,401);
  assert.doesNotMatch(JSON.stringify(response.body),/private identity|SQL must/);
 }
});

test('unusable SQL profiles cannot read scheduling tasks',async()=>{
 for(const profile of [null,{active:false,baseRole:'owner'},{active:true,baseRole:'unknown'},{active:true,baseRole:'faculty'},{active:true,baseRole:'owner',mustChangePassword:true}]){
  assert.equal((await harness({profile}).list('valid',{academicYear:'2026-27'})).status,403);
 }
});

test('faculty and office roles cannot review and administrator review defaults to disabled',async()=>{
 for(const baseRole of ['faculty','hicc','visc','adc','lab']){
  assert.equal((await harness({profile:{active:true,baseRole,facultyId:ID},gates:{schedulingTaskReview:true}}).review('valid',KEY,command)).status,403);
 }
 assert.equal((await harness().review('valid',KEY,command)).status,503);
});

test('authorized task read returns only safe public fields and clamps review capability to role and gate',async()=>{
 for(const baseRole of ['owner','administrator','adfa_general','adfa_regular','admin','developer','faculty','hicc','visc','adc','lab']){
  const api=harness({profile:{active:true,baseRole,facultyId:ID},gates:{schedulingTaskReview:true},repository:{list:async input=>{assert.equal(input.actorFirebaseUid,'verified-actor');assert.equal(input.query.academicYear,'2026-27');return queue();}}});
  const response=await api.list('valid',{academicYear:'2026-27'});
  assert.equal(response.status,200);assert.equal(response.body.tasks.length,1);
  assert.doesNotMatch(JSON.stringify(response.body),/PRIVATE|ucid|email|afcPurpose/);
  assert.equal(response.body.capabilities.canReview,['owner','administrator','adfa_general','adfa_regular','admin','developer'].includes(baseRole));
 }
 const disabled=await harness({repository:{list:async()=>queue()}}).list('valid',{academicYear:'2026-27'});
 assert.equal(disabled.body.tasks[0].canReview,false);
});

test('invalid filters are rejected before SQL and do not accept caller identity or object-shaped fields',async()=>{
 const api=harness({repository:{list:async()=>{throw Error('validation failed to stop SQL');}}});
 for(const query of [{},{academicYear:''},{academicYear:'x'.repeat(33)},{academicYear:['2026-27']},{academicYear:'2026-27',facultyId:ID},{academicYear:'2026-27',actorFirebaseUid:'spoof'},{academicYear:'2026-27',start:'2026-02-30',end:'2026-03-05'},{academicYear:'2026-27',start:'2026-11-01'},{academicYear:'2026-27',limit:'101'},{academicYear:'2026-27',limit:'1.5'},{academicYear:'2026-27',type:'private'},{academicYear:'2026-27',cursor:'bad'},{academicYear:'2026-27',reviewStatus:'Closed'}]){
  assert.equal((await api.list('valid',query)).status,400,JSON.stringify(query));
 }
});

test('administrator review binds verified identity, validates body and sanitizes its result',async()=>{
 for(const baseRole of ['owner','administrator','admin','adfa_general','adfa_regular','developer']){
  const api=harness({profile:{active:true,baseRole},gates:{schedulingTaskReview:true},repository:{review:async input=>{assert.equal(input.actorFirebaseUid,'verified-actor');assert.equal(input.issueKey,KEY);assert.equal(input.expectedEvidenceVersion,command.expectedEvidenceVersion);return {...task(),reviewStatus:'Reviewed'};}}});
  const response=await api.review('valid',KEY,command);assert.equal(response.status,200);assert.equal(response.body.reviewStatus,'Reviewed');assert.doesNotMatch(JSON.stringify(response.body),/PRIVATE|email|ucid/);
  for(const body of [{...command,actorFirebaseUid:'spoof'},{...command,reviewStatus:'Closed'},{...command,expectedReviewVersion:['0000000000000000']},{...command,academicYear:''}])assert.equal((await api.review('valid',KEY,body)).status,400);
 }
});

test('stale SQL evidence maps to refresh while unexpected database errors stay private',async()=>{
 for(const [number,status] of [[54310,409],[54303,403],[54301,400],[99999,503]]){
  const api=harness({repository:{list:async()=>{throw Object.assign(Error('PRIVATE SQL server and reason'),{number});}}});
  const response=await api.list('valid',{academicYear:'2026-27'});assert.equal(response.status,status);assert.doesNotMatch(JSON.stringify(response.body),/PRIVATE/);
 }
});

test('review capability opens only for the exact domain environment switch',async()=>{
 for(const value of [undefined,false,true,'false','TRUE',' true ','true']){
  const api=harness({gates:createWriteGates({PAWS_SCHEDULING_TASK_REVIEW_ENABLED:value}),repository:{list:async()=>queue()}});
  const response=await api.list('valid',{academicYear:'2026-27'});
  assert.equal(response.body.capabilities.canReview,value==='true');
 }
});
