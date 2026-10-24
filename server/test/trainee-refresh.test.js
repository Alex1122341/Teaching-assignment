'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMasterRefreshService}=require('../src/master-refresh/master-refresh-service');
const {manifestHash}=require('../src/master-refresh/master-source-domain');
test('trainee metadata staging uses the same source and live engine guard without accepting supplied writes',async()=>{
 const source={schemaVersion:1,academicYear:'2026-27',sourceSha256:'A'.repeat(64),appointments:[],rotations:[],cccAllocations:[],roleDefinitions:[],cccSlots:[],issues:[],trainees:[{facultyId:'11111111-1111-4111-8111-111111111111',identityStatus:'resolved',sourceDoe:null,rawCounts:[0,null,53,0,0,0,0],categoryDoe:[0,null,null,0,0,0,0],sourceRef:{sheet:'# Trainees',row:3,column:'A'}}]};source.manifestSha256=manifestHash(source);
 let staged;const service=createMasterRefreshService({repository:{loadDoeContext:async()=>({contextHash:'D'.repeat(64),currentRoles:[],supervision:[],activeBundle:{version:{status:'active',academicYear:'2026-27'},rules:[]}}),preview:async p=>{staged=p;return{domain:p.domain};}}});
 const result=await service.preview({domain:'trainees',academicYear:'2026-27',source,actorFirebaseUid:'owner'});
 assert.equal(result.domain,'trainees');assert.equal(staged.doeGuard.rows[0].status,'source_missing');assert.equal(staged.doeGuard.rows[0].candidateDoe,null);
 await assert.rejects(service.preview({domain:'trainees',academicYear:'2026-27',source,actorFirebaseUid:'owner',newRawDoe:200}),{code:'INVALID_MASTER_REFRESH_REQUEST'});
});
