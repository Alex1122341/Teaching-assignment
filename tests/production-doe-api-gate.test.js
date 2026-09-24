'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {cleanBaseUrl,cleanOrigin,verifyDoeApi}=require('../tools/verify-production-doe-api.js');

function response({status=200,payload={ok:true,service:'ucvm-doe-api'},cors='https://red-cliff-04871ca0f.5.azurestaticapps.net'}={}){
  return{
    ok:status>=200&&status<300,
    status,
    headers:{get:name=>String(name).toLowerCase()==='access-control-allow-origin'?cors:null},
    text:async()=>JSON.stringify(payload)
  };
}

test('production DOE API gate accepts healthy service and exact production CORS origin',async()=>{
 const result=await verifyDoeApi({
  baseUrl:'https://ucvm-doe-api.azurewebsites.net/',
  origin:'https://red-cliff-04871ca0f.5.azurestaticapps.net/',
  fetchImpl:async(url,options)=>{
   assert.equal(options.headers.Origin,'https://red-cliff-04871ca0f.5.azurestaticapps.net');
   if(url.endsWith('/api/health/sql'))return response({payload:{ok:true,service:'ucvm-doe-api',dependency:'azure-sql'}});
   assert.equal(url,'https://ucvm-doe-api.azurewebsites.net/api/health');
   return response();
  }
 });
 assert.equal(result.ok,true);
 assert.equal(result.sql,true);
});

test('production DOE API gate fails closed for insecure or local endpoints',()=>{
 assert.throws(()=>cleanBaseUrl('http://example.test'),/HTTPS/);
 assert.throws(()=>cleanBaseUrl('https://localhost:3000'),/localhost/);
 assert.throws(()=>cleanOrigin('http://red-cliff-04871ca0f.5.azurestaticapps.net'),/HTTPS origin/);
});

test('production DOE API gate rejects wrong service, HTTP failure and missing CORS',async()=>{
 await assert.rejects(()=>verifyDoeApi({
  baseUrl:'https://ucvm-doe-api.azurewebsites.net',
  origin:'https://red-cliff-04871ca0f.5.azurestaticapps.net',
  fetchImpl:async()=>response({payload:{ok:true,service:'wrong'}})
 }),/expected service/);
 await assert.rejects(()=>verifyDoeApi({
  baseUrl:'https://ucvm-doe-api.azurewebsites.net',
  origin:'https://red-cliff-04871ca0f.5.azurestaticapps.net',
  fetchImpl:async()=>response({status:503})
 }),/HTTP 503/);
 await assert.rejects(()=>verifyDoeApi({
  baseUrl:'https://ucvm-doe-api.azurewebsites.net',
  origin:'https://red-cliff-04871ca0f.5.azurestaticapps.net',
  fetchImpl:async()=>response({cors:''})
 }),/does not allow/);
});


test('production DOE API gate fails when Azure SQL connectivity is unhealthy',async()=>{
 let calls=0;
 await assert.rejects(()=>verifyDoeApi({
  baseUrl:'https://ucvm-doe-api.azurewebsites.net',
  origin:'https://red-cliff-04871ca0f.5.azurestaticapps.net',
  fetchImpl:async()=>{
   calls++;
   if(calls===1)return response();
   return response({status:503,payload:{ok:false,service:'ucvm-doe-api',dependency:'azure-sql'}});
  }
 }),/Azure SQL health check returned HTTP 503/);
 assert.equal(calls,2);
});
