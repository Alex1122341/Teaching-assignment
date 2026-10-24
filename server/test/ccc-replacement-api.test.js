'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',SHA='A'.repeat(64),YEAR='2026-27';
const stage={requestId:ID,sourceSha256:SHA,academicYear:YEAR,dataset:'ccc-calendar',fileName:'CCC.xlsx',fileBase64:'dGVzdA=='};
const commit={academicYear:YEAR,dataset:'ccc-calendar',sourceSha256:SHA,expectedVersion:'0000000000000001',manifestSha256:SHA,idempotencyKey:ID,confirm:true,completeDataset:true};
function harness({role='administrator',active=true,gates={cccReplaceStage:true,cccReplaceCommit:true},error}={}){
 const {createCccReplacementApi}=require('../src/calendar/ccc-replacement-api');const calls=[];
 const repository=Object.fromEntries(['stage','get','preview','commit'].map(method=>[method,async args=>{calls.push({method,args});if(error)throw error;return {receiptId:ID,deletedCount:2,insertedCount:1,committedAtUtc:'2026-10-17T00:00:00Z',idempotentReplay:false,recoveryJson:'PRIVATE',batchId:ID};}]));
 const api=createCccReplacementApi({verifyToken:async token=>{if(token!=='ok')throw Error();return {uid:'verified'};},findUser:async()=>({baseRole:role,active,mustChangePassword:false,facultyId:ID}),repository,writeGates:gates,parseWorkbook:async(buffer,year)=>{calls.push({method:'parse'});assert.equal(buffer.toString(),'test');return {sourceSha256:SHA,academicYear:year,dataset:'ccc-calendar',sheetName:'CCC',rows:[]};}});return {api,calls};
}
test('CCC endpoints authorize before parse or data access',async()=>{
 for(const options of [{role:'faculty'},{role:'hicc'},{role:'other_office'},{active:false}]){const h=harness(options);for(const call of [()=>h.api.stage('ok',stage),()=>h.api.get('ok',ID),()=>h.api.preview('ok',ID,{expectedVersion:commit.expectedVersion}),()=>h.api.commit('ok',ID,commit)])assert.equal((await call()).status,403);assert.deepEqual(h.calls,[]);}
 const h=harness();assert.equal((await h.api.stage('',stage)).status,401);assert.deepEqual(h.calls,[]);
});
test('CCC stage accepts closed bounded workbook payload and binds source/year/dataset',async()=>{
 const h=harness();assert.equal((await h.api.stage('ok',stage)).status,201);assert.equal(h.calls[1].args.actorFirebaseUid,'verified');assert.equal(h.calls[1].args.fileName,'CCC.xlsx');
 for(const patch of [{actorFirebaseUid:'spoof'},{rows:[]},{schemaVersion:2},{slotCounts:{total:1}},{staffingKind:'unassigned'},{dataset:'afc-working-activities'},{academicYear:'2026'},{academicYear:'2026-2027'},{fileName:'../CCC.xlsx'},{fileBase64:'dGVzdA='},{fileBase64:Buffer.alloc(524289).toString('base64')},{requestId:[ID]}])assert.ok([400,413].includes((await h.api.stage('ok',{...stage,...patch})).status));assert.equal(h.calls.length,2);
});
test('CCC read preview strips raw recovery and private source evidence',async()=>{
 const h=harness();const response=await h.api.get('ok',ID);
 assert.doesNotMatch(JSON.stringify(response),/PRIVATE|recoveryJson/);
});
test('CCC independent gates require boolean true and do not enable original migration',async()=>{
 for(const value of [undefined,false,'true',1]){const h=harness({gates:{cccReplaceStage:value,cccReplaceCommit:value}});assert.equal((await h.api.stage('ok',stage)).status,503);assert.equal((await h.api.preview('ok',ID,{expectedVersion:commit.expectedVersion})).status,503);assert.equal((await h.api.commit('ok',ID,commit)).status,503);assert.deepEqual(h.calls,[]);}
 const {createWriteGates}=require('../src/data/write-gates');const gates=createWriteGates({PAWS_CCC_REPLACE_STAGE_ENABLED:'true',PAWS_CCC_REPLACE_COMMIT_ENABLED:'true'});assert.equal(gates.cccReplaceStage,true);assert.equal(gates.cccReplaceCommit,true);assert.equal(gates.calendarActivityCommit,false);
});
test('CCC commit requires complete-dataset confirmation and strips private recovery',async()=>{
 const h=harness();for(const patch of [{completeDataset:false},{confirm:'true'},{expectedVersion:'bad'},{manifestSha256:'bad'},{dataset:'ccc-roles'},{academicYear:'2026'},{targetIds:[]},{idempotencyKey:[ID]}])assert.equal((await h.api.commit('ok',ID,{...commit,...patch})).status,400);assert.equal(h.calls.length,0);
 const r=await h.api.commit('ok',ID,commit);assert.equal(r.status,200);assert.equal(r.body.deletedCount,2);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|recoveryJson/);
});
test('CCC SQL failures return safe stale/expired/protected/authorization errors',async()=>{
 for(const [number,status,code] of [[54901,403,'ROLE_DENIED'],[54903,404,'NOT_FOUND'],[54904,409,'PREVIEW_CONFLICT'],[54905,409,'PREVIEW_EXPIRED'],[54906,409,'INVALID_SOURCE'],[54907,409,'REPLAY_CONFLICT'],[54908,409,'PROTECTED_REFERENCE'],[54909,409,'AVAILABILITY_BUSY']]){const h=harness({error:{number,message:'PRIVATE'}}),r=await h.api.commit('ok',ID,commit);assert.equal(r.status,status);assert.equal(r.body.error.code,code);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);}
});
