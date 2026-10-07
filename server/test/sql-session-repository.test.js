'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {appServiceManagedIdentityToken,createSqlSessionRepository}=require('../src/data/sql-session-repository.js');

test('managed identity token provider uses the App Service local identity endpoint',async()=>{
  const calls=[];
  const token=await appServiceManagedIdentityToken({
    env:{IDENTITY_ENDPOINT:'http://127.0.0.1:41741/MSI/token',IDENTITY_HEADER:'secret-header'},
    fetchImpl:async(url,options)=>{calls.push({url:String(url),options});return{ok:true,json:async()=>({access_token:'sql-token'})}}
  });
  assert.equal(token,'sql-token');
  assert.match(calls[0].url,/resource=https%3A%2F%2Fdatabase\.windows\.net%2F/);
  assert.match(calls[0].url,/api-version=2019-08-01/);
  assert.equal(calls[0].options.headers['X-IDENTITY-HEADER'],'secret-header');
});

test('SQL session repository reads only the canonical paws view and maps calendar fields',async()=>{
  const inputs=[];
  class ConnectionPool{
    constructor(config){this.config=config}
    async connect(){return this}
    request(){return{input(name,value){inputs.push([name,value]);return this},async query(sql){assert.match(sql,/FROM paws\.vCalendarSession/);assert.doesNotMatch(sql,/staging\./);return{recordset:[{sessionId:'00000000-0000-0000-0000-000000000001',academicYear:'2026-27',curriculumYear:'Year 3',course:'505',courseName:'Surgery',topic:'Pre-Op',type:'LAB',date:'2027-03-22',start:'14:45',end:'16:15',room:'CSB',instructor:'Faculty One; Faculty Two'}]}}}}
    async close(){this.closed=true}
  }
  const repository=createSqlSessionRepository({sqlModule:{ConnectionPool},tokenProvider:async()=> 'token'});
  const rows=await repository.listSessions({start:'2027-03-22',end:'2027-03-22',facultyEmail:'faculty@example.test'});
  assert.equal(rows.length,1);
  assert.equal(rows[0].year,3);
  assert.deepEqual(rows[0].instructorNames,['Faculty One','Faculty Two']);
  assert.equal(rows[0].timeUnknown,false);
  assert.deepEqual(inputs,[['start','2027-03-22'],['end','2027-03-22'],['facultyEmail','faculty@example.test']]);
});

test('SQL session repository fails closed when managed identity is unavailable',async()=>{
  await assert.rejects(()=>appServiceManagedIdentityToken({env:{},fetchImpl:async()=>{}}),error=>error.code==='SQL_IDENTITY_UNAVAILABLE');
});


test('SQL health ping uses only an object granted to the SWA beta principal',async()=>{
  const queries=[];
  const repository=createSqlSessionRepository({
    poolRunner:async work=>work({
      request(){
        return{
          async query(sql){
            queries.push(sql);
            if(/FROM\s+paws\.Session\b/i.test(sql)){
              throw Object.assign(Error('permission denied'),{code:'EACCES'});
            }
            return{recordset:[]};
          }
        };
      }
    },{})
  });
  assert.equal(await repository.ping(),true);
  assert.equal(queries.length,1);
  assert.match(queries[0],/FROM\s+paws\.vCalendarSession\b/i);
  assert.doesNotMatch(queries[0],/FROM\s+paws\.Session\b/i);
});
