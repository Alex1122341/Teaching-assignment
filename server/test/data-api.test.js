'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDataApi}=require('../src/data/data-api.js');

test('data API health does not require Firebase auth',async()=>{
  const api=createDataApi({
    authProvider:{verify:async()=>{throw Error('must not run')}},
    sessionReadService:{ping:async()=>true,listSessions:async()=>[]}
  });
  const result=await api.handle({method:'GET',path:'/api/health/sql',headers:{},query:{}});
  assert.equal(result.statusCode,200);
  assert.deepEqual(result.body,{ok:true,service:'ucvm-doe-api',dependency:'azure-sql'});
});

test('data API current-user response comes from verified SQL-backed actor',async()=>{
  const api=createDataApi({
    authProvider:{verify:async token=>{assert.equal(token,'token');return{uid:'u1',email:'a@example.test',name:'A',role:'faculty',facultyId:'f1',officeName:'',mustChangePassword:false}}},
    sessionReadService:{ping:async()=>true,listSessions:async()=>[]}
  });
  const result=await api.handle({method:'GET',path:'/api/v1/me',headers:{authorization:'Bearer token'},query:{}});
  assert.equal(result.statusCode,200);
  assert.equal(result.body.uid,'u1');
  assert.equal(result.body.role,'faculty');
});

test('data API preserves Faculty email scoping for session reads',async()=>{
  const calls=[];
  const api=createDataApi({
    authProvider:{verify:async()=>({uid:'u1',role:'faculty',email:'faculty@ucalgary.ca'})},
    sessionReadService:{ping:async()=>true,async listSessions(input){calls.push(input);return[]}}
  });
  const result=await api.handle({
    method:'GET',
    path:'/api/v1/sessions',
    headers:{authorization:'Bearer token'},
    query:{start:'2027-03-22',end:'2027-03-23'}
  });
  assert.equal(result.statusCode,200);
  assert.equal(result.body.source,'azure-sql');
  assert.deepEqual(calls,[{start:'2027-03-22',end:'2027-03-23',facultyEmail:'faculty@ucalgary.ca'}]);
});

test('data API returns SQL error without silent Firestore fallback',async()=>{
  const api=createDataApi({
    authProvider:{verify:async()=>({uid:'u1',role:'administrator',email:'a@example.test'})},
    sessionReadService:{
      ping:async()=>true,
      listSessions:async()=>{throw Object.assign(Error('Database unavailable.'),{code:'SQL_UNAVAILABLE',statusCode:503})}
    }
  });
  const result=await api.handle({
    method:'GET',
    path:'/api/v1/sessions',
    headers:{authorization:'Bearer token'},
    query:{start:'2027-03-22',end:'2027-03-23'}
  });
  assert.equal(result.statusCode,503);
  assert.equal(result.body.code,'SQL_UNAVAILABLE');
});
