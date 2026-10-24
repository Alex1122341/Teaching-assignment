'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {createCalendarActivityFunctions}=require('../src/runtime/swa-calendar-activity-functions');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const paths=[['GET','/api/v1/calendar-activities?start=2026-11-01&end=2026-11-08','list'],['GET','/api/v1/calendar-activities/capabilities','capabilities'],['POST','/api/v1/calendar-activity-imports','stage'],['GET','/api/v1/calendar-activity-imports/'+ID,'getImport'],['POST','/api/v1/calendar-activity-imports/'+ID+'/preview','preview'],['POST','/api/v1/calendar-activity-imports/'+ID+'/commit','commit'],['POST','/api/v1/calendar-activities/'+ID+'/time-evidence','resolveTime']];
for(const [method,path,name] of paths){test('route '+name+' binds exact method and bearer token',async()=>{
 const calls=[];const route=createCalendarActivityFunctions({api:Object.fromEntries(paths.map(x=>[x[2],async(...args)=>{calls.push({method:x[2],args});return {status:200,body:{ok:true}};}]))});
 const request=new Request('http://local'+path,{method,headers:{authorization:'Bearer verified','content-type':'application/json'},...(method==='POST'?{body:'{"synthetic":true}'}:{})});
 assert.equal((await route(request)).status,200);assert.equal(calls[0].method,name);assert.equal(calls[0].args[0],'verified');
 const wrong=await route(new Request('http://local'+path,{method:'DELETE'}));assert.equal(wrong.status,405);assert.equal(wrong.headers.Allow,method);assert.equal(calls.length,1);
});}
test('extra/duplicate queries, malformed JSON and unknown routes are rejected before the API',async()=>{
 let calls=0;const api=new Proxy({},{get:()=>async()=>{calls++;return {status:200,body:{}};}});const route=createCalendarActivityFunctions({api});
 for(const path of ['/api/v1/calendar-activities?start=a&start=b','/api/v1/calendar-activities?actorFirebaseUid=spoof','/api/v1/calendar-activity-imports/'+ID+'?source=spoof'])assert.equal((await route(new Request('http://local'+path))).status,400);
 assert.equal((await route(new Request('http://local/api/v1/calendar-activity-imports',{method:'POST',body:'bad'}))).status,400);
 assert.equal((await route(new Request('http://local/api/v1/calendar-activity-imports/'+ID+'/recovery'))).status,404);assert.equal(calls,0);
});
test('real runtime mounts the authenticated SQL activity reader, preserves gates and rejects delegated support routes',async()=>{
 const {createSwaSqlRuntime}=require('../src/runtime/swa-sql-runtime');const seen=[];
 class FakePool{
  async connect(){return this;}async close(){}
  request(){const params={};return {input(key,value){params[key]=value;return this;},async query(sql){seen.push({sql,params});
   if(sql.includes('FROM paws.UserProfile'))return {recordset:[{firebaseUid:params.uid,active:true,mustChangePassword:false,baseRole:params.uid==='root'?'developer':'owner',displayName:'Synthetic'}]};
   if(sql.includes('FROM paws.SupportContext'))return {recordset:[{id:ID,targetUid:'target',expiresAtUtc:'2099-01-01'}]};
   if(sql.includes('ListCalendarActivities'))return {recordset:[{responseJson:'{"activities":[],"nextCursor":null}'}]};
   throw Error('Unexpected SQL');
  }};}
 }
 const project='synthetic-project';const admin={initializeApp:()=>({}),auth:()=>({verifyIdToken:async()=>({uid:'root',aud:project,iss:'https://securetoken.google.com/'+project})})};
 const runtime=createSwaSqlRuntime({env:{FIREBASE_PROJECT_ID:project,PAWS_SQL_CONNECTION_STRING:'Server=localhost;Database=VetMed-Ops;Encrypt=true;',PAWS_SQL_DRIVER:'tedious'},admin,sql:{ConnectionPool:FakePool}});
 try{
  const headers={authorization:'Bearer synthetic'};
  const result=await runtime(new Request('http://local/api/v1/calendar-activities?start=2026-11-01&end=2026-11-08',{headers}));assert.equal(result.status,200);assert.equal(seen.find(x=>x.sql.includes('ListCalendarActivities')).params.ActorFirebaseUid,'root');
  const caps=await runtime(new Request('http://local/api/v1/calendar-activities/capabilities',{headers}));assert.deepEqual(caps.jsonBody.writeCapabilities,{calendarActivityStage:false,calendarActivityCommit:false,calendarActivityTime:false});
  const before=seen.filter(x=>x.sql.includes('CalendarActivityImport')).length;
  const denied=await runtime(new Request('http://local/api/v1/calendar-activity-imports',{method:'POST',headers:{...headers,'content-type':'application/json','x-paws-support-context':ID},body:'{}'}));assert.equal(denied.status,403);assert.equal(denied.jsonBody.error.code,'SUPPORT_ROUTE_DENIED');assert.equal(seen.filter(x=>x.sql.includes('CalendarActivityImport')).length,before);
 }finally{await runtime.close();}
});
