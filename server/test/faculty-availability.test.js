'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFacultyAvailabilityApi}=require('../src/availability/faculty-availability-api');
const {createFacultyAvailabilityFunctions}=require('../src/runtime/swa-faculty-availability-functions');
const {createSqlFacultyAvailabilityRepository}=require('../src/data/sql-faculty-availability-repository');
const facultyId='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const authorized={baseRole:'adfa_regular',active:true,mustChangePassword:false};
const make=(profile=authorized)=>createFacultyAvailabilityApi({
 verifyToken:async token=>{if(token!=='ok')throw Error('invalid');return{uid:'actor'}},
 findUser:async()=>profile,
 repository:{list:async query=>({items:[],total:0,nextCursor:null,coverage:{undatedSessions:0,undatedRoles:0},today:'2026-10-20',input:query})}
});
test('requires authenticated user and rejects other Faculty in self service',async()=>{
 assert.equal((await make().list('',facultyId)).status,401);
 assert.equal((await make({baseRole:'faculty',facultyId,active:true,mustChangePassword:false}).list('ok',other)).status,403);
 assert.equal((await make({baseRole:'hicc',facultyId,active:true,mustChangePassword:false}).list('ok',facultyId)).status,200);
 assert.equal((await make({baseRole:'faculty',facultyId,active:false,mustChangePassword:false}).list('ok',facultyId)).status,403);
});
test('date rules: default upcoming, from past, inclusive range, impossible dates',async()=>{
 const api=make();
 assert.equal((await api.list('ok',facultyId)).body.mode,'upcoming');
 assert.equal((await api.list('ok',facultyId,{mode:'from',startDate:'2025-05-01'})).status,200);
 assert.equal((await api.list('ok',facultyId,{mode:'range',startDate:'2025-01-01',endDate:'2025-01-31'})).status,200);
 for(const x of [{mode:'range',startDate:'2027-02-30',endDate:'2027-03-01'},{mode:'range',startDate:'2026-09-10',endDate:'2026-09-01'},{mode:'from'}, {mode:'upcoming',startDate:'2026-09-01'}, {mode:'range',startDate:'2026-10-01'}])
  assert.equal((await api.list('ok',facultyId,x)).status,400);
});
test('bounded cursor and kind validation prevents unauthorized broad reads',async()=>{
 const api=make();
 assert.equal((await api.list('ok',facultyId,{limit:'101'})).status,400);
 assert.equal((await api.list('ok',facultyId,{cursor:'-1'})).status,400);
 assert.equal((await api.list('ok',facultyId,{kind:'sensitive'})).status,400);
 assert.equal((await api.list('ok','bad-uid')).status,400);
});

test('dates are bounded by SQL date years including rejection of year zero',async()=>{
 const api=make();assert.equal((await api.list('ok',facultyId,{mode:'from',startDate:'0000-01-01'})).status,400);
 for(const startDate of ['0001-01-01','0099-12-31','9999-12-31'])assert.equal((await api.list('ok',facultyId,{mode:'from',startDate})).status,200);
});
test('SQL adapter is only the reviewed read-only procedure with canonical identity',async()=>{
 const calls=[];
 const repository=createSqlFacultyAvailabilityRepository({query:async(text,args)=>{calls.push({text,args});return[{responseJson:JSON.stringify({items:[],total:0})}]}});
 await repository.list({actorFirebaseUid:'actor',facultyId,mode:'range',startDate:'2024-01-01',endDate:'2024-03-01',kind:'afc',cursor:0,limit:50});
 assert.match(calls[0].text,/EXEC paws_api.ListFacultyAvailability/);
 assert.equal(calls[0].args.facultyId,facultyId);
 assert.doesNotMatch(calls[0].text,/\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
});
test('route validates methods, query duplication and return shape',async()=>{
 const route=createFacultyAvailabilityFunctions({api:make()});
 const r=(url,method='GET')=>route({url:'https://localhost'+url,method,headers:{get:()=> 'Bearer ok'}});
 assert.equal((await r('/api/v1/faculty/'+facultyId+'/availability')).status,200);
 assert.equal((await r('/api/v1/faculty/'+facultyId+'/availability','POST')).status,405);
 assert.equal((await r('/api/v1/faculty/'+facultyId+'/availability?kind=all&kind=afc')).status,400);
});

test('standard canonical UUID is accepted; malformed identifiers are 400 at the route',async()=>{
 assert.equal((await make().list('ok',facultyId)).status,200);
 const route=createFacultyAvailabilityFunctions({api:make()});
 assert.equal((await route({url:'https://local/api/v1/faculty/not-a-uuid/availability',method:'GET',headers:{get:()=> 'Bearer ok'}})).status,400);
});

test('only sanitized scheduling fields are delivered; invalid SQL coverage cannot look complete',async()=>{
 const response={items:[{eventKey:'x',kind:'afc',label:'Away from campus',startDate:'2026-10-20',endDate:'2026-10-20',availability:'away',timeStatus:'all_day',reason:'medical-secret',email:'private@example.test',notes:'private'}],total:1,nextCursor:null,today:'2026-10-20',coverage:{undatedSessions:0,undatedRoles:0},ucid:'private'};
 const api=createFacultyAvailabilityApi({verifyToken:async()=>({uid:'actor'}),findUser:async()=>authorized,repository:{list:async()=>response}});
 const result=await api.list('ok',facultyId);assert.equal(result.status,200);assert.doesNotMatch(JSON.stringify(result.body),/medical-secret|private@example|ucid|notes/);
 delete response.coverage;assert.equal((await api.list('ok',facultyId)).status,503);
});

test('SQL failure, invalid tokens, unsupported roles and SQL scope refusal stay explicit failures',async()=>{
 assert.equal((await make().list('bad',facultyId)).status,401);
 assert.equal((await make({...authorized,baseRole:'other_office'}).list('ok',facultyId)).status,403);
 for(const [number,status]of [[55603,403],[55604,404],[55601,400],[99999,503]]){
  const api=createFacultyAvailabilityApi({verifyToken:async()=>({uid:'actor'}),findUser:async()=>authorized,repository:{list:async()=>{throw Object.assign(Error('private SQL error'),{number})}}});
  const result=await api.list('ok',facultyId);assert.equal(result.status,status);assert.equal(result.body.items,undefined);assert.doesNotMatch(JSON.stringify(result),/private SQL/);
 }
});
