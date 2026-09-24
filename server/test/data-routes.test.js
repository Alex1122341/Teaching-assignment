'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../src/app.js');

test('authenticated data sessions route returns Azure SQL read model',async()=>{
  const calls=[];
  const app=createApp({
    authProvider:{verify:async()=>({uid:'u1',role:'adfa_regular',email:'admin@ucalgary.ca'})},
    services:{sessionReadService:{async listSessions(input){calls.push(input);return[{id:'s1',date:'2027-03-22'}]}}}
  });
  const response=await app.inject({method:'GET',url:'/api/data/sessions?start=2027-03-22&end=2027-03-22',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,200);
  assert.equal(response.json().source,'azure-sql');
  assert.equal(response.json().count,1);
  assert.deepEqual(calls,[{start:'2027-03-22',end:'2027-03-22',facultyEmail:''}]);
});

test('faculty-shaped roles are restricted by their authenticated email',async()=>{
  const calls=[];
  const app=createApp({
    authProvider:{verify:async()=>({uid:'u1',role:'faculty',email:'faculty@ucalgary.ca'})},
    services:{sessionReadService:{async listSessions(input){calls.push(input);return[]}}}
  });
  const response=await app.inject({method:'GET',url:'/api/data/sessions?start=2027-03-22&end=2027-03-23',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,200);
  assert.equal(calls[0].facultyEmail,'faculty@ucalgary.ca');
});

test('data session route rejects unauthenticated and invalid ranges',async()=>{
  const app=createApp({authProvider:{verify:async()=>({uid:'u1',role:'adfa_regular'})},services:{sessionReadService:{listSessions:async()=>[]}}});
  const missing=await app.inject({method:'GET',url:'/api/data/sessions?start=2027-03-22&end=2027-03-23'});
  assert.equal(missing.statusCode,401);
  const invalid=await app.inject({method:'GET',url:'/api/data/sessions?start=bad&end=2027-03-23',headers:{authorization:'Bearer token'}});
  assert.equal(invalid.statusCode,400);
});
