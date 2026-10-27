'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSwaSqlRuntime}=require('../src/runtime/swa-sql-runtime');
test('trusted runtime serves reports only for active administrators and keeps support denied',async()=>{
 const seen=[];let role='owner';
 class Pool{async connect(){return this;}async close(){}request(){const params={};return {input(k,v){params[k]=v;return this;},async query(sql){seen.push({sql,params});if(sql.includes('FROM paws.UserProfile'))return {recordset:[{firebaseUid:'user',active:true,baseRole:role,mustChangePassword:false}]};if(sql.includes('FROM paws.SupportContext'))return {recordset:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',targetUid:'target',expiresAtUtc:'2099-01-01'}]};throw Error('Unexpected SQL business read');}};}}
 const project='synthetic-project',admin={initializeApp:()=>({}),auth:()=>({verifyIdToken:async()=>({uid:'user',aud:project,iss:'https://securetoken.google.com/'+project})})};
 const runtime=createSwaSqlRuntime({env:{FIREBASE_PROJECT_ID:project,PAWS_SQL_CONNECTION_STRING:'Server=localhost;Database=VetMed-Ops;Encrypt=true;',PAWS_SQL_DRIVER:'tedious'},admin,sql:{ConnectionPool:Pool}});
 try{const headers={authorization:'Bearer synthetic'},url='http://local/api/v1/reports/catalog';const result=await runtime(new Request(url,{headers}));assert.equal(result.status,200);assert.deepEqual(result.jsonBody.sources.map(s=>s.id),['workload','schedule','roles','history']);role='faculty';assert.equal((await runtime(new Request(url,{headers}))).status,403);role='developer';const denied=await runtime(new Request(url,{headers:{...headers,'x-paws-support-context':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}));assert.equal(denied.status,403);assert.equal(denied.jsonBody.error.code,'SUPPORT_ROUTE_DENIED');assert.ok(seen.every(x=>x.sql.includes('FROM paws.UserProfile')||x.sql.includes('FROM paws.SupportContext')));}finally{await runtime.close();}
});
