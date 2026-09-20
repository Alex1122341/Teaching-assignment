'use strict';
// Guards the configuration decoupling that keeps this public repository safe.
//
// The Firebase client configuration used to be hard-coded in faculty-access.js
// and faculty-admin.js pointing at the shared live project, while every pull
// request publishes a public preview site. The configuration now lives in a
// single runtime file whose committed default targets the isolated LAB project.
// The public production Web SDK config is pinned under tools/ and is consumed
// only by the main build; it is not part of the deployed source allowlist or PR preview.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

// A real Firebase web API key. The committed placeholder must not match this.
const REAL_API_KEY = /AIza[0-9A-Za-z_-]{35}/;
const RUNTIME_SOURCES = ['faculty-access.js', 'faculty-admin.js', 'index.html', 'faculty-admin.html', 'password.html', 'user-management.html'];

test('no runtime source hard-codes a Firebase project configuration', () => {
  for (const name of RUNTIME_SOURCES) {
    const source = read(name);
    assert.doesNotMatch(source, /tester-teaching/, `${name} still references the legacy live project`);
    assert.doesNotMatch(source, REAL_API_KEY, `${name} still contains a Firebase API key`);
    assert.doesNotMatch(source, /messagingSenderId/, `${name} still contains an inline Firebase config`);
  }
});

test('the client configuration has a single source of truth', () => {
  const source = read('firebase-config.js');
  assert.match(source, /UCVM_FIREBASE_CONFIG/);
  assert.match(source, /UCVM_FIREBASE_EMULATOR/);
  assert.match(source, /UCVM_DOE_API_BASE_URL\s*=\s*''/);
  // The committed default must be the isolated LAB project, never production.
  assert.match(source, /projectId:\s*'vista-teaching-lab'/);
  assert.doesNotMatch(source, REAL_API_KEY);
});

test('every page loads the configuration before the shared Firebase helper', () => {
  for (const page of RUNTIME_SOURCES.filter(name => name.endsWith('.html'))) {
    const source = read(page);
    const config = source.indexOf('src="firebase-config.js"');
    const access = source.indexOf('src="faculty-access.js"');
    assert.ok(config >= 0, `${page} does not load firebase-config.js`);
    assert.ok(access >= 0, `${page} does not load faculty-access.js`);
    assert.ok(config < access, `${page} loads firebase-config.js after faculty-access.js`);
  }
});

test('the configuration file is part of the deployed asset set', () => {
  const manifest = JSON.parse(read('tools/static-assets.json'));
  assert.ok(manifest.includes('firebase-config.js'));
  assert.ok(manifest.indexOf('firebase-config.js') < manifest.indexOf('faculty-access.js'));
});

test('the Firebase project alias defaults to the isolated lab project', () => {
  const rc = JSON.parse(read('.firebaserc'));
  assert.equal(rc.projects.default, 'vista-teaching-lab');
  assert.equal(rc.projects.lab, 'vista-teaching-lab');
  // A deploy without an explicit --project must never reach production.
  assert.notEqual(rc.projects.default, rc.projects.production);
});

test('the seeder refuses to run against a non-lab project without an explicit flag', () => {
  const source = read('tools/seed-database.js');
  assert.match(source, /vista-teaching-lab/);
  assert.match(source, /--dry-run/);
  assert.match(source, /--verify/);
});

test('shared Firebase helper configures local emulators only once across lazy module initialization',()=>{
  const source=read('faculty-access.js');
  assert.match(source,/emulatorConfigured=false/);
  assert.match(source,/UCVM_FIREBASE_EMULATOR&&!emulatorConfigured/);
  assert.match(source,/auth\.useEmulator\('http:\/\/127\.0\.0\.1:9099'\);emulatorConfigured=true/);
});


test('production config generator supports an injected DOE API base URL without committing it',()=>{
  const source=read('tools/build-firebase-config.js');
  assert.match(source,/--doe-api-base-url/);
  assert.match(source,/DOE_API_BASE_URL/);
  assert.match(source,/UCVM_DOE_API_BASE_URL/);
  assert.doesNotMatch(read('firebase-config.js'),/azurewebsites\.net/);
});

test('production Firebase Web config is pinned tools-only and excluded from preview/deployment source assets',()=>{
  const config=JSON.parse(read('tools/production-firebase-web-config.json'));
  assert.equal(config.projectId,'tester-teaching');
  assert.equal(config.authDomain,'tester-teaching.firebaseapp.com');
  assert.match(config.apiKey,REAL_API_KEY);
  const manifest=JSON.parse(read('tools/static-assets.json'));
  assert.equal(manifest.includes('tools/production-firebase-web-config.json'),false);
  assert.equal(manifest.includes('production-firebase-web-config.json'),false);
  const workflow=read('.github/workflows/azure-static-web-apps.yml');
  assert.match(workflow,/--from-json tools\/production-firebase-web-config\.json/);
  assert.doesNotMatch(read('firebase-config.js'),/tester-teaching/);
});


test('lab Firebase Web config is pinned tools-only and supports one-command refresh',()=>{
  const config=JSON.parse(read('tools/lab-firebase-web-config.json'));
  assert.equal(config.projectId,'vista-teaching-lab');
  assert.equal(config.authDomain,'vista-teaching-lab.firebaseapp.com');
  assert.ok(config.apiKey==='GENERATE_WITH_npm_run_config:pin:lab'||REAL_API_KEY.test(config.apiKey));
  const manifest=JSON.parse(read('tools/static-assets.json'));
  assert.equal(manifest.includes('tools/lab-firebase-web-config.json'),false);
  const workflow=read('.github/workflows/github-pages-test.yml');
  assert.match(workflow,/--from-json tools\/lab-firebase-web-config\.json/);
  assert.doesNotMatch(workflow,/LAB_FIREBASE_WEB_CONFIG_JSON/);
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['config:pin:lab'],'node tools/pin-lab-firebase-web-config.js');
  const pin=read('tools/pin-lab-firebase-web-config.js');
  assert.match(pin,/apps:sdkconfig/);
  assert.match(pin,/vista-teaching-lab/);
  assert.doesNotMatch(pin,/tester-teaching/);
});

test('lab config pin helper validates only a real vista-teaching-lab Web config',()=>{
  const pin=require('../tools/pin-lab-firebase-web-config.js');
  const good={
    apiKey:'AIza'+'A'.repeat(35),
    authDomain:'vista-teaching-lab.firebaseapp.com',
    projectId:'vista-teaching-lab',
    storageBucket:'vista-teaching-lab.firebasestorage.app',
    messagingSenderId:'123456789012',
    appId:'1:123456789012:web:abcdef0123456789abcdef'
  };
  assert.equal(pin.validateLabConfig(good).projectId,'vista-teaching-lab');
  assert.throws(()=>pin.validateLabConfig({...good,projectId:'tester-teaching'}),/vista-teaching-lab/);
  assert.throws(()=>pin.validateLabConfig({...good,apiKey:'GENERATE_WITH_npm_run_config:pin:lab'}),/API key/);
});

test('preview config verifier accepts only the isolated lab project with DOE API disabled',()=>{
  const {validatePreview}=require('../tools/verify-preview-client-config.js');
  const good={
    firebaseConfig:{
      apiKey:'AIza'+'A'.repeat(35),
      authDomain:'vista-teaching-lab.firebaseapp.com',
      projectId:'vista-teaching-lab',
      storageBucket:'vista-teaching-lab.firebasestorage.app',
      messagingSenderId:'123456789012',
      appId:'1:123456789012:web:abcdef0123456789abcdef'
    },
    emulator:false,
    projectId:'vista-teaching-lab',
    doeApiBaseUrl:''
  };
  assert.equal(validatePreview(good),true);
  assert.throws(()=>validatePreview({...good,firebaseConfig:{...good.firebaseConfig,apiKey:'GENERATE_WITH_tools_build-firebase-config.js'}}),/placeholder|invalid/i);
  assert.throws(()=>validatePreview({...good,projectId:'tester-teaching',firebaseConfig:{...good.firebaseConfig,projectId:'tester-teaching',authDomain:'tester-teaching.firebaseapp.com'}}),/vista-teaching-lab/);
  assert.throws(()=>validatePreview({...good,doeApiBaseUrl:'https://example.azurewebsites.net'}),/must not be configured to reach a DOE API endpoint/);
});
