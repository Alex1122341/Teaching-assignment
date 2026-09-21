'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createProductionServices,createProductionDependencies}=require('../src/server.js');

function fakeDb(){return{collection(){return{where(){return{get:async()=>({docs:[]})}},doc(){return{get:async()=>({exists:false}),set:async()=>{}}}}}}}

test('production wiring exposes calculation and annual rulebook services',()=>{
  const services=createProductionServices({firestore:fakeDb()});
  assert.equal(typeof services.calculationService.calculateAssignment,'function');
  assert.equal(typeof services.rulebookService.copyAcademicYear,'function');
  assert.equal(typeof services.rulebookService.validateAnnualReview,'function');
  assert.equal(typeof services.worksheetService.buildFacultyWorksheet,'function');
  assert.equal(typeof services.worksheetService.listFacultyDoe,'function');
  assert.equal(typeof services.workflowPreviewService.previewSessionChange,'function');
  assert.equal(typeof services.workflowPreviewService.previewFacultyTransfer,'function');
});

test('production wiring exposes server-side DOE policy administration service',()=>{
  const services=createProductionServices({firestore:fakeDb()});
  assert.equal(typeof services.policyAdminService.validateDraft,'function');
  assert.equal(typeof services.policyAdminService.testRule,'function');
  assert.equal(typeof services.policyAdminService.runImpactPreview,'function');
  assert.equal(typeof services.policyAdminService.publish,'function');
  assert.equal(typeof services.policyAdminService.previewRecalculate,'function');
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
