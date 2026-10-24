'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createSqlSchedulingTaskRepository}=require('../src/data/sql-scheduling-task-repository');
const KEY='A'.repeat(64),EVIDENCE='B'.repeat(64);
test('review adapter binds all command parameters and removes private fields recursively',async()=>{
 const repository=createSqlSchedulingTaskRepository({query:async(sql,params)=>{
  assert.equal(sql,'EXEC paws_api.ReviewSchedulingTask @ActorFirebaseUid=@ActorFirebaseUid,@IssueKey=@IssueKey,@AcademicYear=@AcademicYear,@ExpectedEvidenceVersion=@ExpectedEvidenceVersion,@ExpectedReviewVersion=@ExpectedReviewVersion,@ReviewStatus=@ReviewStatus');
  assert.deepEqual(params,{ActorFirebaseUid:'verified',IssueKey:KEY,AcademicYear:'2026-27',ExpectedEvidenceVersion:EVIDENCE,ExpectedReviewVersion:'0000000000000000',ReviewStatus:'Reviewed'});
  return [{responseJson:JSON.stringify({issueKey:KEY,evidenceVersion:EVIDENCE,reviewVersion:'0000000000000001',type:'afc_unavailable',severity:'Conflict',reviewStatus:'Reviewed',canReview:true,email:'PRIVATE',displayName:{email:'PRIVATE'},relatedSessions:[{id:'session',email:'PRIVATE',courseCode:{ucid:'PRIVATE'}}]})}];
 }});
 const value=await repository.review({actorFirebaseUid:'verified',issueKey:KEY,academicYear:'2026-27',expectedEvidenceVersion:EVIDENCE,expectedReviewVersion:'0000000000000000',reviewStatus:'Reviewed'});
 assert.equal(value.reviewStatus,'Reviewed');assert.equal(value.displayName,null);assert.equal(value.relatedSessions[0].courseCode,null);assert.doesNotMatch(JSON.stringify(value),/PRIVATE|email|ucid/);
});
test('invalid database payload never becomes a successful conflict-free queue',async()=>{
 for(const responseJson of ['broken','{}','{"tasks":[],"total":0}',JSON.stringify({tasks:[],total:0,snapshotVersion:{private:'secret'}})]){
  const repository=createSqlSchedulingTaskRepository({query:async()=>[{responseJson}]});
  await assert.rejects(repository.list({actorFirebaseUid:'verified',query:{academicYear:'2026-27'}}),{code:'INVALID_SCHEDULING_RESPONSE'});
 }
});
