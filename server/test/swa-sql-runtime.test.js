'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSwaSqlRuntime}=require('../src/runtime/swa-sql-runtime.js');

test('SWA SQL runtime requires server-side SQL and Firebase Admin settings',()=>{
  assert.throws(
    ()=>createSwaSqlRuntime({env:{FIREBASE_PROJECT_ID:'tester-teaching'}}),
    error=>error.code==='SWA_SQL_CONFIG_REQUIRED'
  );
});

test('SWA SQL runtime rejects a mismatched Firebase service account before SQL use',()=>{
  const env={
    FIREBASE_PROJECT_ID:'tester-teaching',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({
      project_id:'wrong-project',
      client_email:'svc@example.test',
      private_key:'fixture-private-key'
    }),
    PAWS_SQL_CONNECTION_STRING:'fixture-sql-connection-string'
  };
  assert.throws(()=>createSwaSqlRuntime({env}),error=>error.code==='FIREBASE_PROJECT_MISMATCH');
});
