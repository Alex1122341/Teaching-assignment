'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTraineeService,summarizeTrainees,traineeCsv}=require('../src/trainees/trainee-service');
const row=(facultyId,displayName,rawCounts=[0,null,53,0,0,0,0])=>({facultyId,displayName,rawCounts,sourceDoe:null,currentRawDoe:2,currentAppliedDoe:null,sourceStatus:'source_missing',privateNotes:{E:'Own note'},sourceRef:{sheet:'# Trainees',row:3,column:'A'}});
const dataset=rows=>({rows,version:'v1',scope:{actorUid:'actor',role:'administrator',facultyId:null},coverage:[]});
test('statistics preserve blanks versus zero and count only supplied rows, excluding a guide row',()=>{
 const result=summarizeTrainees([row('a','Example Faculty')],{administrator:true});
 assert.equal(result.supervisionAssignments,53);assert.equal(result.categories.preceptor,53);assert.equal(result.categories.vetm506,null);assert.equal(result.missingCountCells,1);assert.equal(result.facultyWithTrainees,1);assert.equal(result.sourceIssues,1);
 assert.equal(Object.hasOwn(summarizeTrainees([],{administrator:false}),'facultyWithTrainees'),false);
});
test('keyset pages share full filtered totals and bind cursor to identity, filters and dataset',async()=>{
 const service=createTraineeService({secret:Buffer.alloc(32,1)}),data=dataset([row('a','Alpha'),row('b','Beta',[1,0,0,0,0,0,0]),row('c','Gamma',[2,0,0,0,0,0,0])]);
 const first=service.page({dataset:data,academicYear:'2026-27',query:'',category:null,limit:1});
 assert.equal(first.rows.length,1);assert.equal(first.summary.supervisionAssignments,56);assert.ok(first.nextCursor);
 const second=service.page({dataset:data,academicYear:'2026-27',query:'',category:null,limit:1,cursor:first.nextCursor});assert.equal(second.rows[0].facultyId,'b');assert.equal(second.summary.supervisionAssignments,56);
 for(const changed of [{query:'different'},{academicYear:'2025-26'},{dataset:{...data,version:'v2'}},{dataset:{...data,scope:{...data.scope,actorUid:'other'}}}])assert.throws(()=>service.page({dataset:data,academicYear:'2026-27',query:'',category:null,limit:1,cursor:first.nextCursor,...changed}),{code:'TRAINEE_CURSOR_CONFLICT'});
});
test('CSV exports all authorized supplied rows and neutralizes formulas, quotes and line breaks',()=>{
 const file=traineeCsv([row('a','=HYPERLINK("unsafe")'),row('b','Other')],{academicYear:'2026-27'});
 const csv=file.toString('utf8');assert.match(csv,/Supervision assignments/);assert.match(csv,/'=HYPERLINK/);assert.match(csv,/N\/A/);assert.match(csv,/,0,/);assert.match(csv,/Other/);assert.doesNotMatch(csv,/ucid|email/i);
});
