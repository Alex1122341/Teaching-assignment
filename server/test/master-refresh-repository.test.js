'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSqlMasterRefreshRepository}=require('../src/data/sql-master-refresh-repository');
test('source text is a SQL parameter and cannot become an executable statement',async()=>{
 const captured=[];const repo=createSqlMasterRefreshRepository({query:async(q,p)=>{captured.push({q,p});return[{responseJson:'{"batchId":"test"}'}];}});
 await repo.preview({domain:'appointments',academicYear:'2026-27',source:{label:"';DELETE FROM paws.RoleAssignment;--"},actorFirebaseUid:'admin-test'});
 assert.equal(captured.length,1);assert.match(captured[0].q,/^EXEC paws_api\.PreviewMasterRefresh\b/);assert.equal(captured[0].q.includes('DELETE'),false);assert.equal(JSON.parse(captured[0].p.SourceJson).label,"';DELETE FROM paws.RoleAssignment;--");
});
test('repository rejects a malformed procedure result rather than continuing',async()=>{
 const repo=createSqlMasterRefreshRepository({query:async()=>[{responseJson:'null'}]});
 await assert.rejects(repo.apply({}),{code:'INVALID_MASTER_REFRESH_RESPONSE'});
});
test('apply binds source, preview, request key and actor as separate parameters',async()=>{
 let seen;const repo=createSqlMasterRefreshRepository({query:async(q,p)=>{seen={q,p};return[{responseJson:'{"receiptId":"R","appliedCount":1,"heldCount":0,"idempotentReplay":false}'}];}});
 const r=await repo.apply({domain:'appointments',batchId:'B',expectedVersion:'V',manifestSha256:'M',sourceSha256:'S',idempotencyKey:'K',actorFirebaseUid:'U',confirm:true});
 assert.equal(r.receiptId,'R');assert.match(seen.q,/^EXEC paws_api\.CommitMasterRefresh\b/);assert.deepEqual(seen.p,{Domain:'appointments',BatchId:'B',ExpectedVersion:'V',ManifestSha256:'M',SourceSha256:'S',IdempotencyKey:'K',ActorFirebaseUid:'U',Confirm:true});
});
test('engine context refuses evidence that changed between SQL reads',async()=>{
 let snapshots=0;
 const db={query:async q=>q.includes('MasterRefreshSnapshot')?[{contextHash:(++snapshots===1?'A':'B').repeat(64)}]:q.includes('FROM paws.DoePolicyVersion WITH')?[{policyVersionId:'active',academicYear:'2026-27',status:'active'}]:[]};
 const repo=createSqlMasterRefreshRepository(db);
 await assert.rejects(repo.loadDoeContext({academicYear:'2026-27'}),{code:'MASTER_DOE_CONTEXT_CHANGED'});
});
