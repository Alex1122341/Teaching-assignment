'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createProductionServices}=require('../src/server.js');

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
