'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPawsDataClient}=require('../paws-data-client.js');

test('Azure SQL session client sends current Firebase ID token to same-origin API',async()=>{
  const calls=[];
  const client=createPawsDataClient({
    backend:'azure-sql',
    tokenProvider:async()=> 'firebase-token',
    fetchImpl:async(url,options)=>{
      calls.push({url,options});
      return{ok:true,status:200,json:async()=>({sessions:[{id:'s1'}]})};
    }
  });
  const rows=await client.listSessions({start:'2027-03-22',end:'2027-03-23'});
  assert.deepEqual(rows,[{id:'s1'}]);
  assert.equal(calls[0].url,'/api/v1/sessions?start=2027-03-22&end=2027-03-23');
  assert.equal(calls[0].options.headers.Authorization,'Bearer firebase-token');
  assert.equal(client.sessionWritesEnabled(),false);
  assert.equal(client.sessionBackend(),'azure-sql');
});

test('Azure SQL session client surfaces backend failure without Firestore fallback',async()=>{
  const client=createPawsDataClient({
    backend:'azure-sql',
    tokenProvider:async()=> 'token',
    fetchImpl:async()=>({ok:false,status:503,json:async()=>({code:'SQL_UNAVAILABLE',message:'Database unavailable.'})})
  });
  await assert.rejects(
    ()=>client.listSessions({start:'2027-03-22',end:'2027-03-23'}),
    error=>error.code==='SQL_UNAVAILABLE'&&error.statusCode===503
  );
});

test('Firestore backend keeps session writes enabled and owns its existing read path',async()=>{
  const client=createPawsDataClient({
    backend:'firestore',
    tokenProvider:async()=> 'token',
    fetchImpl:async()=>{throw Error('must not fetch')}
  });
  assert.equal(client.sessionWritesEnabled(),true);
  assert.equal(client.sessionBackend(),'firestore');
  await assert.rejects(
    ()=>client.listSessions({start:'2027-03-22',end:'2027-03-23'}),
    error=>error.code==='FIRESTORE_SESSION_READ_OWNED_BY_TIMETABLE'
  );
});

test('Azure SQL client validates range before requesting token',async()=>{
  let tokenCalls=0;
  const client=createPawsDataClient({
    backend:'azure-sql',
    tokenProvider:async()=>{tokenCalls++;return'token'},
    fetchImpl:async()=>{throw Error('must not fetch')}
  });
  await assert.rejects(()=>client.listSessions({start:'bad',end:'2027-03-23'}),error=>error.code==='INVALID_DATE_RANGE');
  assert.equal(tokenCalls,0);
});
