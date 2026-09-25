'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {registerSwaFunctions}=require('../src/runtime/swa-functions.js');

test('SWA function adapter registers exact first-slice routes',()=>{
  const registrations=[];
  const app={http(name,options){registrations.push({name,options})}};
  registerSwaFunctions({app,runtimeFactory:()=>({handle:async()=>({statusCode:200,body:{ok:true}})})});
  assert.deepEqual(
    registrations.map(row=>[row.name,row.options.route,row.options.methods]),
    [
      ['pawsSqlHealth','health/sql',['GET']],
      ['pawsMe','v1/me',['GET']],
      ['pawsSessions','v1/sessions',['GET']]
    ]
  );
  assert.ok(registrations.every(row=>row.options.authLevel==='anonymous'));
});

test('SWA sessions adapter forwards bearer token and query values to shared API',async()=>{
  const registrations=[];
  const calls=[];
  const app={http(name,options){registrations.push({name,options})}};
  registerSwaFunctions({
    app,
    runtimeFactory:()=>({
      async handle(input){calls.push(input);return{statusCode:200,body:{sessions:[]}}}
    })
  });
  const sessions=registrations.find(row=>row.name==='pawsSessions');
  const request={
    method:'GET',
    headers:{get:name=>name.toLowerCase()==='authorization'?'Bearer firebase-token':''},
    query:{get:name=>({start:'2027-03-22',end:'2027-03-23'})[name]||''}
  };
  const result=await sessions.options.handler(request);
  assert.equal(result.status,200);
  assert.deepEqual(calls,[{
    method:'GET',
    path:'/api/v1/sessions',
    headers:{authorization:'Bearer firebase-token'},
    query:{start:'2027-03-22',end:'2027-03-23'}
  }]);
});
