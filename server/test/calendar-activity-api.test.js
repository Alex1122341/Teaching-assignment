'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createCalendarActivityApi}=require('../src/calendar/calendar-activity-api');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',SHA='4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF';
const upload={requestId:ID,sourceSha256:SHA,fileName:'Synthetic.xlsx',fileBase64:'c3ludGhldGlj'};
const commit={expectedVersion:'0000000000000001',manifestSha256:'A'.repeat(64),sourceSha256:SHA,idempotencyKey:ID,confirm:true};
const evidence={expectedVersion:'0000000000000001',date:'2026-11-05',startTime:'09:00',endTime:'10:00',evidenceRef:'synthetic approval',evidenceNote:'private evidence note'};
function harness({profile={active:true,mustChangePassword:false,baseRole:'administrator'},gates={calendarActivityStage:true,calendarActivityCommit:true,calendarActivityTime:true},failure=null}={}){
 const calls=[];let parsed=0;const repository=Object.fromEntries(['list','stage','getImport','preview','commit','resolveTime'].map(method=>[method,async args=>{calls.push({method,args});if(failure)throw failure;return method==='list'?{activities:[{activityId:ID,label:'CCC Day',timeEvidence:[{date:'2026-11-05',startTime:'09:00',endTime:'10:00',evidenceNote:'private'}],email:'private@example.test',ucid:'private'}],nextCursor:null}:{batchId:ID,receiptId:ID,insertedCount:1,deletedAfcCount:1,sourceSha256:SHA};}]));
 const api=createCalendarActivityApi({verifyToken:async token=>{if(token==='bad')throw Error('private token error');return {uid:'verified-actor'};},findUser:async()=>profile,repository,writeGates:gates,parseWorkbook:async(buffer,policy)=>{parsed++;assert.equal(buffer.toString(),'synthetic');assert.equal(policy.sourceSha256,SHA);return {sourceSha256:SHA,rows:[]};}});
 return {api,calls,parsed:()=>parsed};
}
test('missing and invalid tokens reject before workbook parsing or repository access',async()=>{
 for(const token of ['',null,'bad']){const h=harness();assert.equal((await h.api.stage(token,upload)).status,401);assert.equal(h.calls.length,0);assert.equal(h.parsed(),0);}
});
for(const profile of [null,{active:false,baseRole:'administrator'},{active:true,mustChangePassword:true,baseRole:'owner'},{active:true,baseRole:'faculty',facultyId:null},{active:true,baseRole:'unknown'}]){
 test('profile boundary rejects '+JSON.stringify(profile),async()=>{const h=harness({profile});assert.equal((await h.api.list('ok',{start:'2026-11-01',end:'2026-11-08'})).status,403);assert.equal(h.calls.length,0);});
}
for(const role of ['faculty','hicc','visc','adc','lab']){
 test(role+' cannot stage, read imports, preview, commit or resolve time',async()=>{
  const h=harness({profile:{active:true,mustChangePassword:false,baseRole:role,facultyId:ID}});
  for(const run of [()=>h.api.stage('ok',upload),()=>h.api.getImport('ok',ID),()=>h.api.preview('ok',ID,{expectedVersion:commit.expectedVersion}),()=>h.api.commit('ok',ID,commit),()=>h.api.resolveTime('ok',ID,evidence)])assert.equal((await run()).status,403);
  assert.equal(h.calls.length,0);assert.equal(h.parsed(),0);
 });
}
test('authorized list binds verified actor and bounds, strips private fields and rejects injected scope fields',async()=>{
 const h=harness({profile:{active:true,baseRole:'faculty',facultyId:ID}});
 const result=await h.api.list('ok',{start:'2026-11-01',end:'2026-11-08',category:'ccc',limit:'100'});
 assert.equal(result.status,200);assert.equal(h.calls[0].args.actorFirebaseUid,'verified-actor');assert.equal(h.calls[0].args.start,'2026-11-01');assert.doesNotMatch(JSON.stringify(result.body),/private/);
 for(const query of [{start:'2026-11-01',end:'2026-11-08',facultyId:ID},{start:'2026-11-01',end:'2026-11-08',actorFirebaseUid:'spoof'}, {},{start:'2025-01-01',end:'2027-01-01'},{start:'2026-02-30',end:'2026-03-05'},{start:'2026-11-01',end:'2026-11-08',category:'unknown'},{start:'2026-11-01',end:'2026-11-08',limit:'101'}])assert.equal((await h.api.list('ok',query)).status,400);
 assert.equal(h.calls.length,1);
});
test('administrator input is closed, source-approved and parsed only after the stage gate',async()=>{
 const h=harness();assert.equal((await h.api.stage('ok',upload)).status,201);assert.equal(h.parsed(),1);assert.equal(h.calls[0].args.actorFirebaseUid,'verified-actor');
 for(const patch of [{actorFirebaseUid:'spoof'},{facultyId:ID},{rows:[]},{sourceSha256:'0'.repeat(64)},{fileBase64:'c3lu dGhldGlj'},{fileBase64:'c3ludGhldGlj='},{fileName:'../Synthetic.xlsx'},{fileBase64:Buffer.alloc(524289).toString('base64')}])assert.ok([400,413].includes((await h.api.stage('ok',{...upload,...patch})).status));
 assert.equal(h.calls.length,1);assert.equal(h.parsed(),1);
});
test('all independent gates require boolean true and never leak write capability to faculty',async()=>{
 for(const value of [undefined,false,'true','TRUE',1]){
  const h=harness({gates:{calendarActivityStage:value,calendarActivityCommit:value,calendarActivityTime:value}});
  assert.equal((await h.api.stage('ok',upload)).status,503);assert.equal((await h.api.preview('ok',ID,{expectedVersion:commit.expectedVersion})).status,503);assert.equal((await h.api.commit('ok',ID,commit)).status,503);assert.equal((await h.api.resolveTime('ok',ID,evidence)).status,503);assert.equal(h.calls.length,0);assert.equal(h.parsed(),0);
 }
 const h=harness({profile:{active:true,baseRole:'faculty',facultyId:ID}});const caps=await h.api.capabilities('ok');assert.deepEqual(caps.body.writeCapabilities,{calendarActivityStage:false,calendarActivityCommit:false,calendarActivityTime:false});
});
test('commit and evidence reject extra keys, unapproved hash, missing confirmation and malformed dates/times',async()=>{
 const h=harness();
 for(const patch of [{actorFirebaseUid:'spoof'},{afcIds:[ID]},{confirm:false},{confirm:'true'},{sourceSha256:'0'.repeat(64)},{manifestSha256:'bad'},{expectedVersion:'bad'}])assert.equal((await h.api.commit('ok',ID,{...commit,...patch})).status,400);
 for(const patch of [{facultyId:ID},{date:'2026-02-30'},{startTime:'09:00:30'},{startTime:'10:00'},{endTime:'24:00'},{evidenceRef:''},{evidenceNote:' '},{evidenceNote:'x'.repeat(1001)}])assert.equal((await h.api.resolveTime('ok',ID,{...evidence,...patch})).status,400);
 assert.equal(h.calls.length,0);assert.equal((await h.api.commit('ok',ID,commit)).status,200);assert.equal((await h.api.resolveTime('ok',ID,evidence)).status,200);
});
test('identifier arrays are invalid JSON fields rather than being coerced into UUID strings',async()=>{
 const h=harness();
 assert.equal((await h.api.stage('ok',{...upload,requestId:[ID]})).status,400);
 assert.equal((await h.api.commit('ok',ID,{...commit,idempotencyKey:[ID]})).status,400);
 assert.equal((await h.api.getImport('ok',[ID])).status,400);
 assert.equal((await h.api.resolveTime('ok',[ID],evidence)).status,400);
 assert.equal((await h.api.list('ok',{start:'2026-11-01',end:'2026-11-08',facultyKey:[ID]})).status,400);
 assert.equal(h.calls.length,0);assert.equal(h.parsed(),0);
});
test('faculty-key mapping is opt-in administrator-only and excludes accidental private metadata',async()=>{
 const keys=[{facultyId:ID,facultyKey:ID,email:'private@example.test'}];let calls=0;
 const make=baseRole=>createCalendarActivityApi({verifyToken:async()=>({uid:'verified'}),findUser:async()=>({active:true,baseRole,facultyId:ID}),repository:{list:async args=>{calls++;assert.equal(args.includeFacultyKeys,true);return {activities:[],nextCursor:null,facultyKeys:keys};}}});
 const query={start:'2026-05-01',end:'2026-05-08',includeFacultyKeys:'true'};
 assert.equal((await make('faculty').list('ok',query)).status,403);assert.equal(calls,0);
 const result=await make('owner').list('ok',query);assert.equal(result.status,200);assert.deepEqual(result.body.facultyKeys,[{facultyId:ID,facultyKey:ID}]);assert.doesNotMatch(JSON.stringify(result.body),/private/);
});
for(const [number,status] of [[53801,403],[53802,400],[53803,404],[53804,409],[53805,409],[53806,409],[53807,409],[53808,409],[53809,409],[12345,503]]){
 test('SQL error '+number+' is fixed and sanitized',async()=>{const h=harness({failure:Object.assign(Error('private SQL server and note'),{number})});const out=await h.api.commit('ok',ID,commit);assert.equal(out.status,status);assert.doesNotMatch(JSON.stringify(out),/private/);});
}
