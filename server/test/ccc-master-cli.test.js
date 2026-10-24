'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {run}=require('../../tools/master-refresh/run-master-refresh.cjs');
test('trusted CCC apply respects the existing commit gate before opening SQL',async()=>{
 await assert.rejects(run({mode:'CccApply',domain:'ccc',outputPath:'unused',batchId:'11111111-1111-4111-8111-111111111111',actorFirebaseUid:'admin',academicYear:'2026-27',expectedVersion:'0'.repeat(16),manifestSha256:'A'.repeat(64),sourceSha256:'B'.repeat(64),idempotencyKey:'11111111-1111-4111-8111-111111111112',confirm:true,completeDataset:true},{env:{},connect:async()=>assert.fail('Disabled commit reached SQL')}),{code:'WRITE_DISABLED'});
});
test('trusted CCC stage respects its separate gate',async()=>{
 await assert.rejects(run({mode:'CccStage',domain:'ccc',outputPath:'unused',sourcePath:'missing',workbookPath:'missing.xlsx',actorFirebaseUid:'admin',requestId:'11111111-1111-4111-8111-111111111111'},{env:{PAWS_CCC_REPLACE_COMMIT_ENABLED:'true'},connect:async()=>assert.fail('Disabled stage reached SQL')}),{code:'WRITE_DISABLED'});
});
