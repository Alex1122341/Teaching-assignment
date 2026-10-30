'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createUniversityHttpServer } = require('../src/runtime/university-http-server');

const identity = {
  PAWS_RELEASE_SHA: 'a'.repeat(40),
  PAWS_RUNTIME_TRUST_ANCHOR: 'b'.repeat(40),
  PAWS_API_ALLOWED_ORIGINS: 'https://paws.example.edu',
  PAWS_AFC_SINGLE_WRITE_ENABLED: 'false',
  PAWS_AFC_BATCH_WRITE_ENABLED: 'false',
  PAWS_SESSION_EDIT_WRITE_ENABLED: 'false',
  PAWS_AFC_REQUEST_WRITE_ENABLED: 'false',
  PAWS_AFC_DECISION_WRITE_ENABLED: 'false',
  PAWS_AFC_ARTIFACT_WRITE_ENABLED: 'false'
};

function request(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

test('University server refuses missing or malformed release SHA and trust anchor', () => {
  const runtime = async () => ({ status: 200, jsonBody: {} });
  assert.throws(() => createUniversityHttpServer({ runtime, env: {} }), /PAWS_RELEASE_SHA/);
  assert.throws(() => createUniversityHttpServer({ runtime, env: { ...identity, PAWS_RELEASE_SHA: 'A'.repeat(40) } }), /PAWS_RELEASE_SHA/);
  assert.throws(() => createUniversityHttpServer({ runtime, env: { ...identity, PAWS_RUNTIME_TRUST_ANCHOR: 'not-a-sha' } }), /PAWS_RUNTIME_TRUST_ANCHOR/);
});

test('runtime attestation is direct, read-only, no-store, and reports all P1/P2 write gates', async t => {
  let runtimeCalls = 0;
  const server = createUniversityHttpServer({ runtime: async () => { runtimeCalls++; return { status: 500 }; }, env: identity });
  t.after(() => server.close());
  const port = await listen(server);
  const response = await request(port, '/api/health/runtime?cache=ignored', { headers: { origin: 'https://paws.example.edu' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['access-control-allow-origin'], 'https://paws.example.edu');
  const body = JSON.parse(response.body);
  assert.equal(body.service, 'paws-university-api');
  assert.equal(body.authority, 'vetmed-ops-sql');
  assert.equal(body.releaseSha, identity.PAWS_RELEASE_SHA);
  assert.equal(body.runtimeTrustAnchor, identity.PAWS_RUNTIME_TRUST_ANCHOR);
  assert.deepEqual(body.writeGates, {
    swapRequest: false, swapDecision: false, swapApply: false, afcSingle: false,
    afcBatch: false,
    afcCancel: false,
    afcEdit: false,
    sessionEdit: false,
    sessionCreate: false,
    afcRequest: false,
    afcDecision: false,
    afcArtifact: false, afcFormUpload: false, cccReplaceStage: false, cccReplaceCommit: false,
    taDraft: false,
    taReview: false,
    taFinal: false,
    taPublish: false,
    facultyAdmin: false,
    doeAdmin: false, doeManualAssignment: false,
    doePolicyPublish: false,
    doeRecalculate: false,
    schedulingTaskReview:false,calendarActivityStage:false,calendarActivityCommit:false,calendarActivityTime:false
  });
  assert.equal(runtimeCalls, 0);
});

test('runtime attestation rejects non-GET methods without invoking runtime', async t => {
  let runtimeCalls = 0;
  const server = createUniversityHttpServer({ runtime: async () => { runtimeCalls++; return { status: 200, jsonBody: {} }; }, env: identity });
  t.after(() => server.close());
  const port = await listen(server);
  const response = await request(port, '/api/health/runtime', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET');
  assert.equal(runtimeCalls, 0);
});

test('runtime health preflight retains exact CORS allowlist behavior without credentials', async t => {
  const server = createUniversityHttpServer({ runtime: async () => ({ status: 200, jsonBody: {} }), env: identity });
  t.after(() => server.close());
  const port = await listen(server);
  const allowed = await request(port, '/api/health/runtime', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://paws.example.edu',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization,content-type'
    }
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://paws.example.edu');
  assert.equal(allowed.headers['access-control-allow-methods'], 'GET, POST, PATCH, PUT, OPTIONS');
  assert.equal(allowed.headers['access-control-allow-headers'], 'Authorization, Content-Type, X-PAWS-Support-Context');
  assert.equal(allowed.headers['access-control-allow-credentials'], undefined);
  const denied = await request(port, '/api/health/runtime', { headers: { origin: 'https://evil.example' } });
  assert.equal(denied.status, 403);
});
