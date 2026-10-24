'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../src/app.js');

test('health endpoint does not require authentication',async()=>{
  const app=createApp({authProvider:{verify:async()=>{throw Error('should not run')}},services:{}});
  const response=await app.inject({method:'GET',url:'/api/health'});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.json(),{ok:true,service:'ucvm-doe-api'});
});

// The Firestore-era `/api/doe/*` surface was retired together with the old DOE
// engine; DOE is served by the ported SQL runtime under `/api/v1/doe/*`. These
// assertions replace the former per-route DOE tests so that a silent
// reintroduction of the retired surface is still caught.
test('the retired Firestore DOE surface is no longer served',async()=>{
  const app=createApp({authProvider:{verify:async()=>({uid:'u1',role:'adfa_regular'})},services:{}});
  for(const [method,url] of [
    ['POST','/api/doe/calculate'],
    ['GET','/api/doe/faculty/f1/worksheet?academicYear=2027-28'],
    ['GET','/api/doe/list?academicYear=2027-28']
  ]){
    const response=await app.inject({method,url,headers:{authorization:'Bearer token'},payload:method==='POST'?{}:undefined});
    assert.equal(response.statusCode,404,`${method} ${url}`);
    assert.equal(response.json().code,'NOT_FOUND');
  }
});

test('DOE API CORS permits configured frontend origin and preflight without authentication',async()=>{
  const app=createApp({authProvider:{verify:async()=>({uid:'u1'})},services:{},allowedOrigins:['https://alex1122341.github.io']});
  const preflight=await app.inject({method:'OPTIONS',url:'/api/doe/calculate',headers:{origin:'https://alex1122341.github.io','access-control-request-method':'POST'}});
  assert.equal(preflight.statusCode,204);
  assert.equal(preflight.headers['access-control-allow-origin'],'https://alex1122341.github.io');
  const blocked=await app.inject({method:'OPTIONS',url:'/api/doe/calculate',headers:{origin:'https://example.invalid','access-control-request-method':'POST'}});
  assert.equal(blocked.statusCode,403);
});


test('v1 me returns the authenticated SQL-shaped account projection',async()=>{
  const app=createApp({authProvider:{verify:async()=>({uid:'u1',email:'alex@example.test',name:'Alex',role:'developer',facultyId:'',officeName:'ADFA',mustChangePassword:false})},services:{}});
  const response=await app.inject({method:'GET',url:'/api/v1/me',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.json(),{uid:'u1',email:'alex@example.test',name:'Alex',role:'developer',facultyId:'',officeName:'ADFA',mustChangePassword:false});
});


test('SQL health endpoint proves repository connectivity without requiring a bearer token',async()=>{
  let calls=0;
  const app=createApp({
    authProvider:{verify:async()=>{throw Error('should not run')}},
    services:{sessionReadService:{async ping(){calls++;return true},async listSessions(){return[]}}}
  });
  const response=await app.inject({method:'GET',url:'/api/health/sql'});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.json(),{ok:true,service:'ucvm-doe-api',dependency:'azure-sql'});
  assert.equal(calls,1);
});

test('SQL health endpoint fails closed when SQL repository is unavailable',async()=>{
  const app=createApp({authProvider:{verify:async()=>{throw Error('should not run')}},services:{}});
  const response=await app.inject({method:'GET',url:'/api/health/sql'});
  assert.equal(response.statusCode,503);
  assert.equal(response.json().code,'SQL_HEALTH_UNAVAILABLE');
});
