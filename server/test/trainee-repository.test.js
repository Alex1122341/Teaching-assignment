'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSqlTraineeRepository}=require('../src/data/sql-trainee-repository');
test('SQL scopes and filters before worksheet enrichment and never interpolates search text',async()=>{
 let seen;const repository=createSqlTraineeRepository({query:async(q,p)=>{seen={q,p};return[{responseJson:JSON.stringify({rows:[],version:'v1',scope:{actorUid:'verified',role:'faculty',facultyId:'own'},coverage:[]})}];}},{worksheetService:{buildFacultyWorksheet:async()=>assert.fail('Empty private dataset read DOE'),listFacultyDoe:async()=>assert.fail('Self read all DOE')}});
 const result=await repository.listTrainees({actorFirebaseUid:'verified',academicYear:'2026-27',query:"';DELETE FROM paws.Faculty;--",category:null,limit:25,cursor:null});
 assert.match(seen.q,/EXEC paws_api.ListTraineeSource/);assert.equal(seen.q.includes('DELETE'),false);assert.equal(seen.p.Query,"';DELETE FROM paws.Faculty;--");assert.deepEqual(result.rows,[]);assert.equal(result.summary.supervisionAssignments,0);
});
test('worksheet zero cannot fill a missing raw supervision source',async()=>{
 const source={rows:[{facultyId:'own',displayName:'Example',rawCounts:Array(7).fill(null),currentRawDoe:null}],version:'v1',scope:{actorUid:'verified',role:'faculty',facultyId:'own',administrator:false},coverage:[]};
 const repo=createSqlTraineeRepository({query:async()=>[{responseJson:JSON.stringify(source)}]},{worksheetService:{buildFacultyWorksheet:async()=>({totals:{rawSupervisionDoe:0,appliedSupervisionDoe:0}})}});
 const result=await repo.listTrainees({actorFirebaseUid:'verified',academicYear:'2026-27',limit:25});assert.equal(result.rows[0].currentRawDoe,null);assert.equal(result.rows[0].currentAppliedDoe,null);
});
test('normalized supervision evidence supplies current DOE without a legacy snapshot',async()=>{
 for(const admin of [false,true]){
  const source={rows:[{facultyId:'own',displayName:'Example',rawCounts:Array(7).fill(null),currentRawDoe:null}],version:'v1',scope:{actorUid:'verified',role:admin?'owner':'faculty',facultyId:admin?null:'own',administrator:admin},coverage:[]};
  const worksheetService={buildFacultyWorksheet:async()=>({sections:{supervision:{lines:[{sourceEntityType:'doe_assignment',resultDoe:5}]}},totals:{rawSupervisionDoe:5,appliedSupervisionDoe:3}}),listFacultyDoe:async()=>[{facultyId:'own',supervisionLineCount:1,rawSupervisionDoe:5,appliedSupervisionDoe:3}]};
  const repo=createSqlTraineeRepository({query:async()=>[{responseJson:JSON.stringify(source)}]},{worksheetService});const result=await repo.listTrainees({actorFirebaseUid:'verified',academicYear:'2026-27',limit:25});
  assert.equal(result.rows[0].currentRawDoe,5);assert.equal(result.rows[0].currentAppliedDoe,3);
 }
});
test('unexpected cross-faculty SQL rows fail before enrichment or delivery',async()=>{
 const source={rows:[{facultyId:'other',displayName:'Private Other'}],version:'v1',scope:{actorUid:'verified',role:'faculty',facultyId:'own',administrator:false},coverage:[]};
 const repo=createSqlTraineeRepository({query:async()=>[{responseJson:JSON.stringify(source)}]},{worksheetService:{buildFacultyWorksheet:async()=>assert.fail('Cross-faculty DOE read')}});
 await assert.rejects(repo.listTrainees({actorFirebaseUid:'verified',academicYear:'2026-27'}),{code:'TRAINEE_SCOPE_INVALID'});
});
test('default repository uses the established worksheet service factory',()=>{
 assert.equal(typeof createSqlTraineeRepository({query:async()=>[]}).listTrainees,'function');
});
