'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMasterRefreshService}=require('../src/master-refresh/master-refresh-service');
const {manifestHash}=require('../src/master-refresh/master-source-domain');
const batch='10000000-0000-4000-8000-000000000001',hash='A'.repeat(64);
function source(){const s={schemaVersion:1,academicYear:'2026-27',sourceSha256:hash,appointments:[],rotations:[],cccAllocations:[],roleDefinitions:[],trainees:[],cccSlots:[],issues:[]};return {...s,manifestSha256:manifestHash(s)};}
const applyArgs=()=>({batchId:batch,domain:'appointments',expectedVersion:'0'.repeat(16),manifestSha256:hash,sourceSha256:hash,idempotencyKey:batch,actorFirebaseUid:'admin-test',confirm:true});
test('preview rejects a changed manifest before any repository operation',async()=>{
 let calls=0;const service=createMasterRefreshService({repository:{preview:async()=>{calls++;}}});const s=source();s.appointments.push({sourceDoe:200});
 await assert.rejects(service.preview({domain:'appointments',academicYear:'2026-27',source:s,actorFirebaseUid:'admin-test'}),{code:'SOURCE_MANIFEST_MISMATCH'});assert.equal(calls,0);
});
test('unknown domain and mismatching academic year never stage a source',async()=>{
 const service=createMasterRefreshService({repository:{preview:async()=>assert.fail('invalid source reached SQL')}});
 for(const p of [{domain:'anything',academicYear:'2026-27'},{domain:'appointments',academicYear:'2025-26'}])await assert.rejects(service.preview({...p,source:source(),actorFirebaseUid:'admin-test'}));
});
test('trusted apply rejects inserted row/DOE fields instead of forwarding them',async()=>{
 const service=createMasterRefreshService({repository:{apply:async()=>assert.fail('injected operations reached SQL')}});
 await assert.rejects(service.apply({...applyArgs(),operations:[{newDoe:1}]}),{code:'INVALID_MASTER_REFRESH_REQUEST'});
});
test('explicit confirmation and complete preview binding are required',async()=>{
 const service=createMasterRefreshService({repository:{apply:async()=>assert.fail('unconfirmed request reached SQL')}});
 for(const p of [{confirm:false},{expectedVersion:null},{sourceSha256:'not-hash'},{actorFirebaseUid:''},{idempotencyKey:'wrong'}])await assert.rejects(service.apply({...applyArgs(),...p}),{code:'INVALID_MASTER_REFRESH_REQUEST'});
});
test('apply accepts only public receipt fields and stable replay result',async()=>{
 const service=createMasterRefreshService({repository:{apply:async()=>({receiptId:batch,appliedCount:1,heldCount:2,idempotentReplay:true,beforeRows:[{private:'record'}]})}});
 assert.deepEqual(await service.apply(applyArgs()),{receiptId:batch,appliedCount:1,heldCount:2,idempotentReplay:true});
});
test('recovery rejects row injection and requires explicit operator confirmation',async()=>{
 const service=createMasterRefreshService({repository:{recover:async()=>assert.fail('invalid recovery reached SQL')}});
 for(const p of [{receiptId:batch,actorFirebaseUid:'admin-test',confirm:false},{receiptId:batch,actorFirebaseUid:'admin-test',confirm:true,beforeRows:[]}])await assert.rejects(service.recover(p),{code:'INVALID_MASTER_REFRESH_REQUEST'});
});
test('staging requires current engine evidence and binds comparison to SQL state',async()=>{
 const s=source();let received;
 const service=createMasterRefreshService({repository:{loadDoeContext:async()=>({currentRoles:[],supervision:[],activeBundle:{version:{academicYear:'2026-27',status:'active'},rules:[]},contextHash:'D'.repeat(64)}),preview:async p=>{received=p;return{batchId:batch};}}});
 await service.preview({domain:'appointments',academicYear:'2026-27',source:s,actorFirebaseUid:'admin-test'});
 assert.equal(received.doeGuard.contextHash,'D'.repeat(64));assert.match(received.doeGuard.doeGuardHash,/^[A-F0-9]{64}$/);
 assert.deepEqual(received.doeGuard.rows,[]);
 const unguarded=createMasterRefreshService({repository:{preview:async()=>assert.fail('Unguarded stage')}});
 await assert.rejects(unguarded.preview({domain:'appointments',academicYear:'2026-27',source:s,actorFirebaseUid:'admin-test'}),{code:'MASTER_ENGINE_REQUIRED'});
});
