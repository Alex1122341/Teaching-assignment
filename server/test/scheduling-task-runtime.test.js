'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createSchedulingTaskFunctions}=require('../src/runtime/swa-scheduling-task-functions');
const {createSchedulingTaskApi}=require('../src/scheduling/scheduling-task-api');
const {createSqlSchedulingTaskRepository}=require('../src/data/sql-scheduling-task-repository');
function route(){return createSchedulingTaskFunctions({api:createSchedulingTaskApi({verifyToken:async token=>{if(token!=='valid')throw Error('private');return {uid:'verified'};},findUser:async()=>({active:true,baseRole:'owner'}),repository:createSqlSchedulingTaskRepository({query:async(sql,params)=>{
 assert.match(sql,/EXEC paws_api.ListSchedulingTasks/);assert.equal(params.ActorFirebaseUid,'verified');assert.equal(JSON.parse(params.QueryJson).academicYear,'2026-27');
 return [{responseJson:JSON.stringify({tasks:[],total:0,nextCursor:null,snapshotVersion:'A'.repeat(64),academicYears:[],filters:{faculty:[],courses:[]},capabilities:{canReview:true},private:'SECRET'})}];
}})})});}
test('HTTP scheduling route authenticates and returns the real API/repository projection',async()=>{
 const handle=route();const response=await handle(new Request('https://paws.example/api/v1/scheduling-tasks?academicYear=2026-27',{headers:{Authorization:'Bearer valid'}}));
 assert.equal(response.status,200);assert.equal(response.jsonBody.total,0);assert.equal(response.jsonBody.capabilities.canReview,false);assert.doesNotMatch(JSON.stringify(response),/SECRET/);
 assert.equal((await handle(new Request('https://paws.example/api/v1/scheduling-tasks?academicYear=2026-27'))).status,401);
});
test('HTTP scheduling route rejects duplicate queries, unsupported methods, invalid JSON and unknown paths',async()=>{
 const handle=route();
 for(const [request,status] of [[new Request('https://paws.example/api/v1/scheduling-tasks?academicYear=2026-27&academicYear=2027-28'),400],[new Request('https://paws.example/api/v1/scheduling-tasks',{method:'POST'}),405],[new Request('https://paws.example/api/v1/scheduling-tasks/unknown'),404],[new Request('https://paws.example/api/v1/scheduling-tasks/'+ 'A'.repeat(64)+'/review',{method:'POST',body:'broken'}),400]])assert.equal((await handle(request)).status,status);
});
