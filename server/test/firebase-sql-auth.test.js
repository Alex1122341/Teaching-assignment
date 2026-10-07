'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {bootstrapProfilesFromEnv,createFirebaseSqlAuthProvider}=require('../src/auth/firebase-sql-auth.js');

test('bootstrap profile config is server-side, email-normalized JSON',()=>{
  const profiles=bootstrapProfilesFromEnv(JSON.stringify({'Admin@UCalgary.ca':{role:'developer',displayName:'Admin'}}));
  assert.equal(profiles['admin@ucalgary.ca'].role,'developer');
  assert.throws(()=>bootstrapProfilesFromEnv('{bad'),error=>error.code==='SQL_PROFILE_BOOTSTRAP_INVALID');
});

test('SQL auth trusts Firebase token identity and server bootstrap only',async()=>{
  const calls=[];
  const provider=createFirebaseSqlAuthProvider({
    adminAuth:{verifyIdToken:async token=>{assert.equal(token,'token');return{uid:'firebase-1',email:'Admin@UCalgary.ca',name:'Firebase Name'}}},
    userRepository:{async provision(input){calls.push(input);return{uid:input.uid,email:input.email,name:'SQL Admin',role:'developer',active:true}}},
    bootstrapProfiles:{'admin@ucalgary.ca':{role:'developer',displayName:'Approved Admin'}}
  });
  const actor=await provider.verify('token');
  assert.equal(actor.role,'developer');
  assert.equal(calls[0].uid,'firebase-1');
  assert.equal(calls[0].email,'admin@ucalgary.ca');
  assert.equal(calls[0].bootstrap.role,'developer');
});

test('SQL auth rejects inactive SQL profiles',async()=>{
  const provider=createFirebaseSqlAuthProvider({
    adminAuth:{verifyIdToken:async()=>({uid:'u1',email:'u@example.test'})},
    userRepository:{provision:async()=>({uid:'u1',active:false})}
  });
  await assert.rejects(()=>provider.verify('token'),error=>error.code==='PROFILE_INACTIVE');
});


test('SQL auth redacts Firebase Admin token-verification internals',async()=>{
  const provider=createFirebaseSqlAuthProvider({
    adminAuth:{verifyIdToken:async()=>{throw Error('firebase admin internal detail')}},
    userRepository:{provision:async()=>{throw Error('must not run')}}
  });
  await assert.rejects(
    ()=>provider.verify('token'),
    error=>error.code==='AUTH_REQUIRED'&&error.statusCode===401&&!/internal detail/i.test(error.message)
  );
});

test('SQL auth redacts unexpected SQL profile repository errors',async()=>{
  const provider=createFirebaseSqlAuthProvider({
    adminAuth:{verifyIdToken:async()=>({uid:'u1',email:'u@example.test'})},
    userRepository:{provision:async()=>{throw Error('sql driver internal detail')}}
  });
  await assert.rejects(
    ()=>provider.verify('token'),
    error=>error.code==='SQL_PROFILE_UNAVAILABLE'&&error.statusCode===503&&!/driver internal/i.test(error.message)
  );
});
