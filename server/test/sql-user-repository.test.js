'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSqlUserRepository}=require('../src/data/sql-user-repository.js');

function fakeSql(responses){
  const queries=[],inputs=[];
  class ConnectionPool{
    async connect(){return this}
    request(){return{input(name,value){inputs.push([name,value]);return this},async query(sql){queries.push(sql);return responses.shift()||{recordset:[]}}}}
    async close(){}
  }
  return{sql:{ConnectionPool},queries,inputs};
}

test('SQL user repository returns an existing UID profile without provisioning',async()=>{
  const fake=fakeSql([{recordset:[{FirebaseUid:'u1',Email:'A@Example.test',DisplayName:'A',BaseRole:'faculty',FacultyId:'f1',Active:true,MustChangePassword:false,OfficeName:null}]}]);
  const repo=createSqlUserRepository({sqlModule:fake.sql,tokenProvider:async()=> 'token'});
  const profile=await repo.provision({uid:'u1',email:'a@example.test'});
  assert.equal(profile.email,'a@example.test');
  assert.equal(profile.role,'faculty');
  assert.equal(fake.queries.length,1);
});

test('SQL user repository can provision an active Faculty by matching verified email',async()=>{
  const fake=fakeSql([
    {recordset:[]},
    {recordset:[]},
    {recordset:[{FacultyId:'11111111-1111-1111-1111-111111111111',DisplayName:'Faculty One'}]},
    {recordset:[]}
  ]);
  const repo=createSqlUserRepository({sqlModule:fake.sql,tokenProvider:async()=> 'token'});
  const profile=await repo.provision({uid:'u2',email:'faculty@ucalgary.ca',name:'Token Name'});
  assert.equal(profile.role,'faculty');
  assert.equal(profile.name,'Faculty One');
  assert.equal(profile.facultyId,'11111111-1111-1111-1111-111111111111');
  assert.match(fake.queries.at(-1),/INSERT paws\.UserProfile/);
});

test('SQL user repository requires an approved bootstrap for non-Faculty accounts',async()=>{
  const fake=fakeSql([{recordset:[]},{recordset:[]},{recordset:[]}]);
  const repo=createSqlUserRepository({sqlModule:fake.sql,tokenProvider:async()=> 'token'});
  await assert.rejects(()=>repo.provision({uid:'u3',email:'office@ucalgary.ca'}),error=>error.code==='SQL_PROFILE_REQUIRED');
});

test('SQL user repository provisions allowlisted office account without browser-selected role',async()=>{
  const fake=fakeSql([{recordset:[]},{recordset:[]},{recordset:[]},{recordset:[]}]);
  const repo=createSqlUserRepository({sqlModule:fake.sql,tokenProvider:async()=> 'token'});
  const profile=await repo.provision({uid:'u4',email:'office@ucalgary.ca',bootstrap:{role:'adfa_general',displayName:'Office Admin',officeName:'ADFA'}});
  assert.equal(profile.role,'adfa_general');
  assert.equal(profile.officeName,'ADFA');
  assert.match(fake.queries.at(-1),/INSERT paws\.UserProfile/);
});
