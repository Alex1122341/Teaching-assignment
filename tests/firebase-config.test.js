'use strict';
// Guards the configuration decoupling that keeps this public repository safe.
//
// The Firebase client configuration used to be hard-coded in faculty-access.js
// and faculty-admin.js pointing at the shared live project, while every pull
// request publishes a public preview site. The configuration now lives in a
// single file whose committed default targets the isolated LAB project, and
// production configuration is generated at deploy time.

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
