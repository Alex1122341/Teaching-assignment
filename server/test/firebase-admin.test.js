'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {firebaseAdminOptionsFromEnv,createFirebaseAdminClients}=require('../src/auth/firebase-admin.js');

test('Firebase Admin config rejects service account from another project',()=>{
  const env={
    FIREBASE_PROJECT_ID:'tester-teaching',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({
      project_id:'vista-teaching-lab',
      client_email:'svc@example.test',
      private_key:'fixture-private-key'
    })
  };
  assert.throws(()=>firebaseAdminOptionsFromEnv(env),error=>error.code==='FIREBASE_PROJECT_MISMATCH');
});

test('Firebase Admin config requires client email and private key when JSON is supplied',()=>{
  assert.throws(
    ()=>firebaseAdminOptionsFromEnv({
      FIREBASE_PROJECT_ID:'tester-teaching',
      FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'tester-teaching'})
    }),
    error=>error.code==='FIREBASE_CONFIG_INVALID'
  );
});

test('Auth-only Firebase Admin initialization does not require Firestore',()=>{
  const appObject={name:'server-app'};
  const authClient={verifyIdToken:async()=>({uid:'u1'})};
  const adminModule={
    app:{
      getApps:()=>[],
      cert:account=>({account}),
      initializeApp:()=>appObject
    },
    auth:{getAuth:app=>{assert.equal(app,appObject);return authClient}}
  };
  const clients=createFirebaseAdminClients({
    adminModule,
    includeFirestore:false,
    env:{
      FIREBASE_PROJECT_ID:'tester-teaching',
      FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({
        project_id:'tester-teaching',
        client_email:'svc@example.test',
        private_key:'fixture-private-key'
      })
    }
  });
  assert.equal(clients.adminAuth,authClient);
  assert.equal(clients.firestore,null);
});
