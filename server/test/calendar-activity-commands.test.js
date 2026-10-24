'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createSqlCalendarActivityRepository}=require('../src/data/sql-calendar-activity-repository');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('atomic commit binds a confirmed source manifest and returns only receipt metadata',async()=>{
 let sent;const repo=createSqlCalendarActivityRepository({query:async(sql,params)=>{sent={sql,params};return[{responseJson:JSON.stringify({receiptId:ID,batchId:ID,sourceSha256:'A'.repeat(64),manifestSha256:'B'.repeat(64),insertedCount:1,deletedAfcCount:1,committedAtUtc:'2026-10-14T12:00:00Z',idempotentReplay:false,privateBeforeImage:'private'})}];}});
 const result=await repo.commit({actorFirebaseUid:'verified-admin',batchId:ID,expectedVersion:'0000000000000001',sourceSha256:'A'.repeat(64),manifestSha256:'B'.repeat(64),idempotencyKey:ID,confirm:true});
 assert.match(sent.sql,/CommitCalendarActivityImport/);assert.equal(sent.params.Confirm,true);assert.equal(sent.params.ExpectedVersion,'0000000000000001');assert.equal(sent.params.ManifestSha256,'B'.repeat(64));
 assert.equal(result.insertedCount,1);assert.equal(result.deletedAfcCount,1);assert.equal(JSON.stringify(result).includes('private'),false);
});
test('time evidence binds one exact day and never emits private notes in the activity response',async()=>{
 let sent;const repo=createSqlCalendarActivityRepository({query:async(sql,params)=>{sent={sql,params};return[{responseJson:JSON.stringify({activityId:ID,facultyKey:ID,facultyDisplayName:'Synthetic',category:'ccc',label:'CCC Day',startDate:'2026-11-05',endDate:'2026-11-06',courseCode:null,timeStatus:'partial',version:'0000000000000002',timeEvidence:[{date:'2026-11-05',startTime:'09:00',endTime:'10:00',evidenceNote:'private'}]})}];}});
 const result=await repo.resolveTime({actorFirebaseUid:'verified-admin',activityId:ID,expectedVersion:'0000000000000001',date:'2026-11-05',startTime:'09:00',endTime:'10:00',evidenceRef:'approved source',evidenceNote:"private';DROP TABLE example;--"});
 assert.match(sent.sql,/ResolveCalendarActivityDayTime/);assert.equal(sent.params.ActivityDate,'2026-11-05');assert.equal(sent.sql.includes('DROP TABLE'),false);assert.equal(JSON.stringify(result).includes('private'),false);
});
test('SQL refusal is propagated for the API to map without treating it as a successful receipt',async()=>{
 const repo=createSqlCalendarActivityRepository({query:async()=>{throw Object.assign(new Error('database refused'),{number:53804});}});
 await assert.rejects(()=>repo.commit({actorFirebaseUid:'verified-admin',batchId:ID,expectedVersion:'0000000000000001',sourceSha256:'A'.repeat(64),manifestSha256:'B'.repeat(64),idempotencyKey:ID,confirm:true}),{number:53804});
});
