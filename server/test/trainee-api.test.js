'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTraineeApi}=require('../src/trainees/trainee-api');
const id='11111111-1111-4111-8111-111111111111';
function harness({role='faculty',active=true,error=null}={}){
 const calls=[];const api=createTraineeApi({verifyToken:async t=>{if(t!=='ok')throw Error();return{uid:'verified'};},findUser:async()=>({active,mustChangePassword:false,baseRole:role,facultyId:id}),repository:{listTrainees:async p=>{calls.push(p);if(error)throw error;return{academicYear:p.academicYear,rows:[],summary:{supervisionAssignments:0},nextCursor:null,coverage:[]};},exportTrainees:async p=>{calls.push(p);return Buffer.from('CSV');}}});return{api,calls};
}
test('faculty search and export cannot inject another faculty or actor scope',async()=>{
 const h=harness();const result=await h.api.list('ok',{academicYear:'2026-27',query:'Other faculty'});assert.equal(result.status,200);assert.deepEqual(result.body.rows,[]);assert.equal(h.calls[0].actorFirebaseUid,'verified');assert.equal(h.calls[0].facultyId,undefined);
 for(const p of [{facultyId:id},{actorFirebaseUid:'spoof'},{academicYear:'2026-28'},{query:'x'.repeat(201)},{category:'unknown'},{limit:'101'},{cursor:['bad']}])assert.equal((await h.api.list('ok',{academicYear:'2026-27',...p})).status,400);
 const exported=await h.api.export('ok',{academicYear:'2026-27',query:'Other faculty'});assert.equal(exported.status,200);assert.equal(h.calls.at(-1).actorFirebaseUid,'verified');assert.equal((await h.api.export('ok',{academicYear:'2026-27',cursor:'x'})).status,400);
});
test('administrator and self roles use shared authorization while unsupported/revoked roles never query',async()=>{
 for(const role of ['owner','administrator','adfa_general','adfa_regular','admin','developer','faculty','hicc','visc'])assert.equal((await harness({role}).api.list('ok',{academicYear:'2026-27'})).status,200);
 for(const options of [{role:'viewer'},{role:'other_office'},{active:false}]){const h=harness(options);assert.equal((await h.api.list('ok',{academicYear:'2026-27'})).status,403);assert.equal(h.calls.length,0);}
 const h=harness();assert.equal((await h.api.list('',{academicYear:'2026-27'})).status,401);assert.equal(h.calls.length,0);
});
test('SQL role revocation and stale cursors fail with safe fixed errors',async()=>{
 for(const [error,status] of [[{number:55401,message:'private'},403],[{code:'TRAINEE_CURSOR_CONFLICT',message:'private'},409],[Error('private'),503]]){const h=harness({error});const r=await h.api.list('ok',{academicYear:'2026-27'});assert.equal(r.status,status);assert.doesNotMatch(JSON.stringify(r),/private/);}
});
test('Dashboard HTTP routes keep CSV bytes private, reject duplicate filters and stay GET only',async()=>{
 const {createDashboardFunctions}=require('../src/runtime/swa-dashboard-functions');const h=harness();const route=createDashboardFunctions({api:{},traineeApi:h.api});
 const request=(path,method='GET')=>({url:'https://local/api/v1/dashboard/trainees'+path,method,headers:{get:()=> 'Bearer ok'}});
 const listed=await route(request('?academicYear=2026-27'));assert.equal(listed.status,200);assert.match(listed.headers['Cache-Control'],/no-store/);
 const exported=await route(request('/export?academicYear=2026-27'));assert.equal(exported.status,200);assert.equal(exported.body.toString(),'CSV');assert.equal(exported.jsonBody,undefined);
 assert.equal((await route(request('?academicYear=2026-27','POST'))).status,405);
 assert.equal((await route(request('?academicYear=2026-27&academicYear=2025-26'))).status,400);
});
