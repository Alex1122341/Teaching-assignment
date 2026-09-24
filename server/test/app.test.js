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

test('DOE endpoints reject missing bearer token',async()=>{
  const app=createApp({authProvider:{verify:async()=>null},services:{}});
  const response=await app.inject({method:'POST',url:'/api/doe/calculate',payload:{}});
  assert.equal(response.statusCode,401);
  assert.equal(response.json().code,'AUTH_REQUIRED');
});


test('faculty worksheet route passes academic year query to worksheet service',async()=>{
  const calls=[];
  const app=createApp({
    authProvider:{verify:async()=>({uid:'u1',role:'adfa_regular'})},
    services:{
      calculationService:{calculateAssignment:async()=>({})},
      worksheetService:{
        async buildFacultyWorksheet(input){calls.push(input);return{facultyId:input.facultyId,academicYear:input.academicYear,status:'calculated'}},
        async listFacultyDoe(){return[]}
      }
    }
  });
  const response=await app.inject({method:'GET',url:'/api/doe/faculty/f1/worksheet?academicYear=2027-28',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,200);
  assert.deepEqual(calls,[{facultyId:'f1',academicYear:'2027-28'}]);
});

test('DOE list route uses the same worksheet service contract',async()=>{
  const calls=[];
  const app=createApp({
    authProvider:{verify:async()=>({uid:'u1',role:'adfa_regular'})},
    services:{
      calculationService:{calculateAssignment:async()=>({})},
      worksheetService:{
        async buildFacultyWorksheet(){return{}},
        async listFacultyDoe(input){calls.push(input);return[{facultyId:'f1',assignedTeachingDoe:12}]}
      }
    }
  });
  const response=await app.inject({method:'GET',url:'/api/doe/list?academicYear=2027-28',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,200);
  assert.equal(response.json()[0].assignedTeachingDoe,12);
  assert.deepEqual(calls,[{academicYear:'2027-28'}]);
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
