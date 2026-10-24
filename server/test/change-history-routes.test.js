'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createChangeHistoryFunctions}=require('../src/runtime/swa-change-history-functions');
test('strict history routes preserve authenticated JSON export without broadening the binary PDF transport',async()=>{
 const calls=[],api=Object.fromEntries(['query','page','export'].map(method=>[method,async(token,args)=>{calls.push({method,token,args});return {status:200,body:{safe:true}};}]));
 const route=createChangeHistoryFunctions({api});
 const request=(path,method='GET')=>new Request('https://example.test/api/v1/change-history'+path,{method,headers:{authorization:'Bearer synthetic'}});
 for(const [path,expected] of [['?scope=mine','query'],['/page?snapshot=abc&offset=100','page'],['/export?snapshot=abc&format=xlsx','export']]){assert.equal((await route(request(path))).status,200);assert.equal(calls.at(-1).method,expected);assert.equal(calls.at(-1).token,'synthetic');}
 const previous=calls.length;
 for(const path of ['?scope=mine&scope=timetable','?scope=mine&actorFirebaseUid=spoof','/export?snapshot=x&format=xlsx&format=csv','/page?offset=0&facultyId=private'])assert.equal((await route(request(path))).status,400);
 assert.equal((await route(request('?scope=mine','POST'))).status,405);assert.equal((await route(request('/unknown'))).status,404);assert.equal(calls.length,previous);
});
test('repository binds verified identity and exclusive UTC range inside consistent read transaction',async()=>{
 const {createSqlChangeHistoryRepository}=require('../src/data/sql-change-history-repository');let inside=false;
 const db={transaction:async cb=>{inside=true;try{return await cb();}finally{inside=false;}},query:async(sql,params)=>{assert.equal(inside,true);assert.match(sql,/EXEC paws_api.ListChangeHistoryEvents/);assert.deepEqual(params,{ActorFirebaseUid:'verified',Scope:'mine',StartUtc:'2026-10-01T00:00:00.000Z',EndExclusiveUtc:'2026-10-17T00:00:00.000Z'});return [];}};
 await createSqlChangeHistoryRepository(db).list({actorFirebaseUid:'verified',scope:'mine',start:'2026-10-01',end:'2026-10-17'});
});

test('SQL repository refuses unbounded Dashboard caller and binds the earliest restored archive date',async()=>{
 const {createSqlChangeHistoryRepository}=require('../src/data/sql-change-history-repository');
 const {DASHBOARD_HISTORY_ARCHIVE_START_UTC:cutoff}=require('../src/history/change-history-api');
 let calls=0;
 const db={transaction:async cb=>cb(),query:async(sql,params)=>{
  calls++;assert.match(sql,/ListChangeHistoryEvents/);assert.equal(params.Scope,'dashboard');
  assert.equal(params.StartUtc,cutoff);assert.equal(params.EndExclusiveUtc,'2026-10-22T00:00:00.000Z');return [];}};
 const repository=createSqlChangeHistoryRepository(db);
 assert.throws(()=>repository.list({actorFirebaseUid:'user',scope:'dashboard',start:'2019-01-01',end:'9999-12-31'}),/UTC bounds/);
 assert.equal(calls,0);
 await repository.list({actorFirebaseUid:'user',scope:'dashboard',start:'2019-01-01',end:'9999-12-31',startUtc:cutoff,endUtc:'2026-10-22T00:00:00.000Z'});
 assert.equal(calls,1);
});
