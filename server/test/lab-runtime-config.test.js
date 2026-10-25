'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const scripts = path.join(root, 'frontend', 'scripts');
const pages = path.join(root, 'frontend', 'pages');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const scriptFiles = fs.readdirSync(scripts).filter(f => f.endsWith('.js'));
const pageFiles = fs.readdirSync(pages).filter(f => f.endsWith('.html'));

// These tests pin the lab retargeting. Every one of them failed before this
// change: the frontend carried five copies of a `tester-teaching` configuration,
// a committed Cloudflare Tunnel origin, and a `ucalgary.ca` sign-in pre-check
// that rejected every synthetic identity.

test('no frontend script targets the retired tester-teaching project', () => {
  const offenders = scriptFiles.filter(file => {
    const body = fs.readFileSync(path.join(scripts, file), 'utf8');
    // Comments are allowed to name the retired project when explaining history.
    return body.split('\n').some(line => /tester-teaching/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line));
  });
  assert.deepEqual(offenders, [], 'only comments may mention tester-teaching');
});

test('no committed tunnel origin remains anywhere in the frontend', () => {
  const offenders = [];
  for (const file of scriptFiles) {
    const body = fs.readFileSync(path.join(scripts, file), 'utf8');
    if (/trycloudflare\.com|tunnel\.|ngrok\.io/i.test(body)) offenders.push(file);
  }
  for (const file of pageFiles) {
    const body = fs.readFileSync(path.join(pages, file), 'utf8');
    if (/trycloudflare\.com|ngrok\.io/i.test(body)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test('the runtime configuration is the single source of truth for the lab project', () => {
  const config = require(path.join(scripts, 'paws-runtime-config.js'));
  assert.equal(config.projectId, 'vista-teaching-lab');
  assert.equal(config.firebase.projectId, 'vista-teaching-lab');
  assert.equal(config.firebase.authDomain, 'vista-teaching-lab.firebaseapp.com');
  // The lab signs in synthetic identities on the reserved test domain.
  assert.equal(config.allowedEmailDomain, 'example.test');
  // Empty means same-origin; a hardcoded external origin would reintroduce the
  // dependency on an unstable tunnel.
  assert.equal(config.apiOrigin, '');
});

test('no frontend script carries its own Firebase Web configuration copy', () => {
  const offenders = scriptFiles.filter(file => {
    if (file === 'paws-runtime-config.js') return false;
    const body = fs.readFileSync(path.join(scripts, file), 'utf8');
    return /apiKey\s*:\s*['"]AIza/.test(body);
  });
  assert.deepEqual(offenders, [], 'Firebase config must come from paws-runtime-config.js');
});

test('every page loads the runtime configuration before any other local script', () => {
  assert.ok(pageFiles.length >= 5, 'expected the five PAWS pages');
  for (const file of pageFiles) {
    const html = fs.readFileSync(path.join(pages, file), 'utf8');
    const configAt = html.indexOf('paws-runtime-config.js');
    assert.ok(configAt > -1, `${file} must load paws-runtime-config.js`);
    const firstLocal = html.search(/<script src="(?!https?:)[^"]+\.js"><\/script>/);
    assert.ok(firstLocal > -1, `${file} must load local scripts`);
    assert.equal(configAt, firstLocal + '<script src="'.length, `${file} must load it first`);
  }
});

test('the API origin module no longer claims a temporary ingress', () => {
  const origin = require(path.join(scripts, 'paws-api-origin.js'));
  assert.equal(origin.temporaryIngress, false);
  assert.equal(origin.apiOrigin, '');
  assert.equal(origin.releaseLabel, 'SAME-ORIGIN API');
});

test('the PAWS manifest publishes the runtime configuration', () => {
  const manifest = JSON.parse(read('tools/static-assets.paws.json'));
  assert.ok(manifest.includes('paws-runtime-config.js'));
});
