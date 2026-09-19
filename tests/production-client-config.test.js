'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const builder=require('../tools/build-firebase-config.js');
const verifier=require('../tools/verify-production-client-config.js');

const firebaseConfig={
 apiKey:'AIzaExamplePublicWebKey0000000000000000000',
 authDomain:'tester-teaching.firebaseapp.com',
 projectId:'tester-teaching',
 storageBucket:'tester-teaching.firebasestorage.app',
 messagingSenderId:'123456789012',
 appId:'1:123456789012:web:abcdef0123456789abcdef'
};

test('DOE API base URL normalization requires HTTPS outside localhost',()=>{
 assert.equal(builder.normalizeDoeApiBaseUrl('https://ucvm-doe-api.azurewebsites.net/'),'https://ucvm-doe-api.azurewebsites.net');
 assert.equal(builder.normalizeDoeApiBaseUrl('http://127.0.0.1:8080/'),'http://127.0.0.1:8080');
 assert.throws(()=>builder.normalizeDoeApiBaseUrl('http://ucvm-doe-api.azurewebsites.net'),/HTTPS/);
 assert.throws(()=>builder.normalizeDoeApiBaseUrl('not-a-url'),/absolute URL/);
 assert.throws(()=>builder.normalizeDoeApiBaseUrl('https://example.test/path?token=x'),/query parameters/);
});

test('generated client config carries Firebase and DOE API configuration without exposing emulator mode on production hosts',()=>{
 const source=builder.render(firebaseConfig,{doeApiBaseUrl:'https://ucvm-doe-api.azurewebsites.net/'});
 const vm=require('node:vm'),window={location:{hostname:'red-cliff-04871ca0f.5.azurestaticapps.net'}};
 vm.runInNewContext(source,{window});
 assert.equal(window.UCVM_FIREBASE_PROJECT_ID,'tester-teaching');
 assert.equal(window.UCVM_FIREBASE_EMULATOR,false);
 assert.equal(window.UCVM_DOE_API_BASE_URL,'https://ucvm-doe-api.azurewebsites.net');
});

test('production verifier accepts the intended project and HTTPS DOE API endpoint',()=>{
 assert.equal(verifier.validate({
  firebaseConfig,emulator:false,projectId:'tester-teaching',
  doeApiBaseUrl:'https://ucvm-doe-api.azurewebsites.net'
 }),true);
});

test('production verifier fails closed for lab, placeholder, missing or insecure configuration',()=>{
 assert.throws(()=>verifier.validate({
  firebaseConfig:{...firebaseConfig,projectId:'vista-teaching-lab'},emulator:false,projectId:'vista-teaching-lab',
  doeApiBaseUrl:'https://ucvm-doe-api.azurewebsites.net'
 }),/tester-teaching/);
 assert.throws(()=>verifier.validate({
  firebaseConfig:{...firebaseConfig,apiKey:'GENERATE_WITH_tools_build-firebase-config.js'},emulator:false,projectId:'tester-teaching',
  doeApiBaseUrl:'https://ucvm-doe-api.azurewebsites.net'
 }),/placeholder/);
 assert.throws(()=>verifier.validate({firebaseConfig,emulator:false,projectId:'tester-teaching',doeApiBaseUrl:''}),/missing/);
 assert.throws(()=>verifier.validate({firebaseConfig,emulator:false,projectId:'tester-teaching',doeApiBaseUrl:'http://example.test'}),/HTTPS/);
});
