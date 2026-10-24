'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createSqlCalendarActivityRepository}=require('../src/data/sql-calendar-activity-repository');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('staging binds source data without interpolating names or actor identity into SQL',async()=>{
 let sent;const repo=createSqlCalendarActivityRepository({query:async(sql,params)=>{sent={sql,params};return[{responseJson:'{"batchId":"staged"}'}];}});
 const rows=[{sourceRow:2,facultySourceName:"Synthetic'; DROP TABLE paws.Faculty;--",startDate:'2026-11-05',endDate:'2026-11-06',originalLabel:'CCC Day',category:'ccc',treatment:'working_candidate',issues:[]}];
 const result=await repo.stage({actorFirebaseUid:'verified-actor',requestId:ID,parsed:{sourceSha256:'A'.repeat(64),sheetName:'AFC records',dataset:'afc-working-activities',rows}});
 assert.deepEqual(result,{batchId:'staged'});assert.match(sent.sql,/EXEC paws_api.StageCalendarActivityImport/);
 assert.equal(sent.sql.includes('DROP TABLE'),false);assert.equal(sent.params.ActorFirebaseUid,'verified-actor');assert.deepEqual(JSON.parse(sent.params.RowsJson),rows);
});
test('list binds sanitized candidate keys and stable range cursor as values',async()=>{
 let sent;const body={activities:[{activityId:ID,facultyKey:ID,facultyDisplayName:'Synthetic Faculty',category:'ccc',label:'CCC Day',startDate:'2026-11-05',endDate:'2026-11-06',courseCode:null,timeEvidence:[],timeStatus:'not_provided',staffingKind:'assigned',staffingLabel:null,blockLabel:null,version:'0000000000000001'}],nextCursor:null};
 const repo=createSqlCalendarActivityRepository({query:async(sql,params)=>{sent={sql,params};return[{responseJson:JSON.stringify(body)}];}});
 const result=await repo.list({actorFirebaseUid:'verified-faculty',start:'2026-11-01',end:'2026-12-01',facultyKey:ID,category:'ccc',cursor:'2026-11-05|'+ID,limit:100});
 assert.deepEqual(result,body);assert.equal(sent.params.EndExclusive,'2026-12-01');assert.equal(sent.params.FacultyKey,ID);assert.equal(sent.params.Cursor,'2026-11-05|'+ID);assert.equal(sent.sql.includes(ID),false);
});
test('preview refresh sends optimistic versions and import reads remain separate',async()=>{
 const calls=[];const repo=createSqlCalendarActivityRepository({query:async(sql,params)=>{calls.push({sql,params});return[{responseJson:'{"previewVersion":"0000000000000002"}'}];}});
 await repo.preview({actorFirebaseUid:'verified-admin',batchId:ID,expectedVersion:'0000000000000001'});
 await repo.getImport({actorFirebaseUid:'verified-admin',batchId:ID});
 assert.match(calls[0].sql,/PreviewCalendarActivityImport/);assert.equal(calls[0].params.ExpectedVersion,'0000000000000001');
 assert.match(calls[1].sql,/GetCalendarActivityImport/);assert.equal(calls[1].params.ExpectedVersion,undefined);
});
test('malformed SQL JSON fails safely rather than manufacturing an empty successful preview',async()=>{
 const repo=createSqlCalendarActivityRepository({query:async()=>[{responseJson:'{private broken'}]});
 await assert.rejects(()=>repo.getImport({actorFirebaseUid:'verified-admin',batchId:ID}),error=>error.code==='INVALID_CALENDAR_RESPONSE'&&!error.message.includes('private'));
});
test('activity projection strips accidental confidential columns and timing evidence notes',async()=>{
 const repo=createSqlCalendarActivityRepository({query:async()=>[{responseJson:JSON.stringify({activities:[{activityId:ID,facultyKey:ID,facultyDisplayName:'Synthetic Faculty',category:'ccc',label:'CCC Day',startDate:'2026-11-05',endDate:'2026-11-06',courseCode:null,timeStatus:'partial',version:'0000000000000001',facultyId:ID,email:'private@example.test',ucid:'private',afcPurpose:'private',timeEvidence:[{date:'2026-11-05',startTime:'09:00',endTime:'10:00',evidenceNote:'private'}]}],nextCursor:null,privateNotes:'private'})}]});
 const result=await repo.list({actorFirebaseUid:'verified-faculty',start:'2026-11-01',end:'2026-12-01'});
 assert.equal(JSON.stringify(result).includes('private'),false);
 assert.deepEqual(result.activities[0].timeEvidence,[{date:'2026-11-05',startTime:'09:00',endTime:'10:00'}]);
});
