'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createProductionServices,createProductionDependencies}=require('../src/server.js');

function fakeDb(){return{collection(){return{where(){return{get:async()=>({docs:[]})}},doc(){return{get:async()=>({exists:false}),set:async()=>{}}}}}}}

// The legacy Firestore DOE services were retired with the old engine. DOE is now
// composed by the ported SQL runtime (server/src/runtime/swa-sql-runtime.js), so
// this wiring must expose only the SQL read path. These assertions replace the
// former "exposes calculation/rulebook/policy services" checks so that a silent
// reintroduction of the retired wiring is still caught.
test('production wiring no longer exposes the retired Firestore DOE services',()=>{
  const services=createProductionServices({firestore:fakeDb()});
  for(const name of ['calculationService','rulebookService','worksheetService','workflowPreviewService','policyAdminService','targetService']){
    assert.equal(services[name],undefined,`${name} must not be wired`);
  }
  assert.equal(Object.hasOwn(services,'sessionReadService'),true);
});

test('the ported SQL runtime is the DOE composition root',()=>{
  const {createSwaSqlRuntime}=require('../src/runtime/swa-sql-runtime.js');
  assert.equal(typeof createSwaSqlRuntime,'function');
  // Composing with no database must not throw: DOE is simply unavailable until a
  // database exists, and that is reported per request.
  const runtime=createSwaSqlRuntime({
    env:{FIREBASE_PROJECT_ID:'demo-project'},
    admin:{initializeApp(){return{}},credential:{cert(){return{}}},auth(){return{verifyIdToken:async()=>({})}}},
    sqlModule:{ConnectionPool:class{async connect(){return this}request(){return{input(){return this},async query(){return{recordset:[]}}}}async close(){}}}
  });
  assert.equal(typeof runtime,'function');
  assert.equal(typeof runtime.close,'function');
});


test('production dependencies support Firebase Admin v14 modular exports',()=>{
  const appObject={name:'server-app'};
  const authClient={verifyIdToken:async()=>({uid:'u1'})};
  const firestoreClient=fakeDb();
  const serviceAccount={project_id:'vista-teaching-lab',client_email:'svc@example.test',private_key:'PRIVATE'};
  const adminModule={
    app:{
      getApps:()=>[],
      cert:account=>({account}),
      initializeApp:options=>{assert.equal(options.projectId,'vista-teaching-lab');assert.deepEqual(options.credential.account,serviceAccount);return appObject}
    },
    auth:{getAuth:app=>{assert.equal(app,appObject);return authClient}},
    firestore:{getFirestore:app=>{assert.equal(app,appObject);return firestoreClient}}
  };
  const deps=createProductionDependencies({
    adminModule,
    env:{
      FIREBASE_PROJECT_ID:'vista-teaching-lab',
      FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)
    }
  });
  assert.equal(deps.firestore,firestoreClient);
  assert.equal(deps.adminAuth,authClient);
  assert.equal(typeof deps.authProvider.verify,'function');
});

test('Azure environment parsing keeps Firebase credentials server-side and parses CORS allowlist',()=>{
  const {firebaseAdminOptionsFromEnv,allowedOriginsFromEnv}=require('../src/server.js');
  const env={
    FIREBASE_PROJECT_ID:'tester-teaching',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'tester-teaching',client_email:'svc@example.test',private_key:'PRIVATE'}),
    ALLOWED_ORIGINS:'https://alex1122341.github.io, https://example.test/'
  };
  const config=firebaseAdminOptionsFromEnv(env);
  assert.equal(config.projectId,'tester-teaching');
  assert.equal(config.serviceAccount.client_email,'svc@example.test');
  assert.deepEqual(allowedOriginsFromEnv(env.ALLOWED_ORIGINS),['https://alex1122341.github.io','https://example.test/']);
});

test('invalid Firebase service account JSON fails closed at server startup',()=>{
  const {firebaseAdminOptionsFromEnv}=require('../src/server.js');
  assert.throws(()=>firebaseAdminOptionsFromEnv({FIREBASE_SERVICE_ACCOUNT_JSON:'{bad'}),error=>error.code==='FIREBASE_CONFIG_INVALID');
});
