'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createSqlConnection}=require('../src/data/sql-connection');
const {createSqlCalendarActivityRepository}=require('../src/data/sql-calendar-activity-repository');
const {createSwaSqlRuntime}=require('../src/runtime/swa-sql-runtime');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function driver(){
 const pools=[],calls=[];
 class Pool{
  constructor(config){this.config=typeof config==='string'?{requestTimeout:15000}:{requestTimeout:15000,...config};pools.push(this);}
  async connect(){this.connectedBudget=this.config.requestTimeout;return this;}
  async close(){this.closed=true;}
  request(){const pool=this,params={};return {input(k,v){params[k]=v;return this;},async query(text){calls.push({text,params,budget:pool.config.requestTimeout});
   if(text.includes('FROM paws.UserProfile'))return {recordset:[{firebaseUid:'root',active:true,mustChangePassword:false,baseRole:'owner',displayName:'Synthetic'}]};
   return {recordset:[{responseJson:'{"activities":[],"nextCursor":null,"batchId":"synthetic"}'}]};
  }};}
 }
 return {sql:{ConnectionPool:Pool},pools,calls};
}
test('a private import pool receives its bounded timeout before connect without mutating ordinary config',async()=>{
 const d=driver(),config={server:'synthetic',options:{encrypt:true}};
 const imports=createSqlConnection({config,sql:d.sql,requestTimeoutMs:90000}),ordinary=createSqlConnection({config,sql:d.sql});
 try{await imports.query('SELECT 1');await ordinary.query('SELECT 2');assert.equal(d.pools[0].connectedBudget,90000);assert.equal(d.pools[1].connectedBudget,15000);assert.equal(config.requestTimeout,undefined);}finally{await imports.close();await ordinary.close();}
});
test('invalid, unlimited and excessive import timeout budgets reject before opening a connection',()=>{
 for(const requestTimeoutMs of [0,-1,NaN,Infinity,1.5,999,120001,'90000',null])assert.throws(()=>createSqlConnection({config:{},sql:driver().sql,requestTimeoutMs}),/timeout/i);
});
test('only stage, preview and commit use the dedicated import connection',async()=>{
 const calls=[],db=label=>({query:async(text,params)=>{calls.push({label,text,params});return[{responseJson:'{"activities":[],"nextCursor":null}'}];}});
 const repo=createSqlCalendarActivityRepository(db('ordinary'),{importDb:db('import')});
 await repo.stage({actorFirebaseUid:'root',parsed:{sourceSha256:'A'.repeat(64),rows:[]},requestId:ID});
 await repo.preview({actorFirebaseUid:'root',batchId:ID,expectedVersion:'0000000000000001'});
 await repo.commit({actorFirebaseUid:'root',batchId:ID,expectedVersion:'0000000000000001',manifestSha256:'B'.repeat(64),sourceSha256:'A'.repeat(64),idempotencyKey:ID,confirm:true});
 await repo.getImport({actorFirebaseUid:'root',batchId:ID});await repo.list({actorFirebaseUid:'root',start:'2026-11-01',end:'2026-12-01'});await repo.resolveTime({actorFirebaseUid:'root',activityId:ID});
 assert.deepEqual(calls.map(x=>x.label),['import','import','import','ordinary','ordinary','ordinary']);
 assert.equal(calls[1].params.ExpectedVersion,'0000000000000001');assert.equal(calls[2].params.Confirm,true);
});
test('real runtime keeps identity and ordinary reads on the default pool and closes the dedicated preview pool',async()=>{
 const d=driver(),project='synthetic-project';
 const admin={initializeApp:()=>({}),auth:()=>({verifyIdToken:async()=>({uid:'root',aud:project,iss:'https://securetoken.google.com/'+project})})};
 const runtime=createSwaSqlRuntime({env:{FIREBASE_PROJECT_ID:project,PAWS_SQL_CONNECTION_STRING:'Server=synthetic;Database=synthetic;Encrypt=true;',PAWS_CALENDAR_ACTIVITY_STAGE_ENABLED:'true'},admin,sql:d.sql});
 const headers={authorization:'Bearer synthetic','content-type':'application/json'};
 try{
  const preview=await runtime(new Request('http://local/api/v1/calendar-activity-imports/'+ID+'/preview',{method:'POST',headers,body:JSON.stringify({expectedVersion:'0000000000000001'})}));
  assert.equal(preview.status,200);
  const list=await runtime(new Request('http://local/api/v1/calendar-activities?start=2026-11-01&end=2026-11-08',{headers}));assert.equal(list.status,200);
  assert.equal(d.calls.find(x=>x.text.includes('PreviewCalendarActivityImport')).budget,90000);
  assert.equal(d.calls.find(x=>x.text.includes('ListCalendarActivities')).budget,15000);
  assert.ok(d.calls.filter(x=>x.text.includes('FROM paws.UserProfile')).every(x=>x.budget===15000));
 }finally{await runtime.close();}
 assert.equal(d.pools.length,2);assert.ok(d.pools.every(x=>x.closed));
});
