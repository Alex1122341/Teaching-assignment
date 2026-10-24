'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const TEST_RUNTIME_IDENTITY = { PAWS_RELEASE_SHA: 'a'.repeat(40), PAWS_RUNTIME_TRUST_ANCHOR: 'b'.repeat(40) };
const {
  createSqlAfcApprovalRepository,
  RECOMMEND_PROCEDURE,
  REJECT_PROCEDURE,
  APPROVE_PROCEDURE
} = require('../src/data/sql-afc-approval-repository');
const { createAfcRequestFunctions } = require('../src/runtime/swa-afc-request-functions');

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const APPROVAL_ID = '33333333-3333-4333-8333-333333333333';

function makeRequest(action, body, token = 'firebase-token') {
  return new Request('https://local/api/v1/afc-requests/' + REQUEST_ID + '/' + action, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(body || {})
  });
}

test('approval SQL repository invokes only the three trusted decision procedures', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return [{ afcRequestId: REQUEST_ID, status: 'pending_admin' }]; } };
  const repository = createSqlAfcApprovalRepository(db);
  const base = {
    afcRequestId: REQUEST_ID, approvalId: APPROVAL_ID,
    signatureMode: 'typed', signatureName: 'Approver Example',
    signatureSignedAt: '2026-10-04T13:00:00.000Z',
    signatureFingerprint: 'b'.repeat(64), signatureImageDataUrl: null,
    actorFirebaseUid: 'uid-approver'
  };

  await repository.recommendRequest(base);
  await repository.rejectRequest({ ...base, rejectionReason: 'Rejected.' });
  await repository.approveRequest(base);

  assert.equal(calls.length, 3);
  assert.equal(RECOMMEND_PROCEDURE, 'paws_api.RecommendAfcRequest');
  assert.equal(REJECT_PROCEDURE, 'paws_api.RejectAfcRequest');
  assert.equal(APPROVE_PROCEDURE, 'paws_api.ApproveAfcRequest');
  assert.match(calls[0].sql, /EXEC paws_api\.RecommendAfcRequest/);
  assert.match(calls[1].sql, /EXEC paws_api\.RejectAfcRequest/);
  assert.match(calls[2].sql, /EXEC paws_api\.ApproveAfcRequest/);
  assert.equal(calls[1].params.rejectionReason, 'Rejected.');
  for (const call of calls) {
    assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
    assert.equal(call.params.actorFirebaseUid, 'uid-approver');
  }
});

test('HTTP wrapper mounts recommend, reject and approve as POST-only AFC request actions', async () => {
  const calls = [];
  const route = createAfcRequestFunctions({ api: {
    list: async () => ({ status: 200, body: {} }),
    submit: async () => ({ status: 201, body: {} }),
    withdraw: async () => ({ status: 200, body: {} }),
    recommend: async (token, id, payload) => { calls.push(['recommend', token, id, payload]); return { status: 200, body: {} }; },
    reject: async (token, id, payload) => { calls.push(['reject', token, id, payload]); return { status: 200, body: {} }; },
    approve: async (token, id, payload) => { calls.push(['approve', token, id, payload]); return { status: 200, body: {} }; }
  } });

  assert.equal((await route(makeRequest('recommend', { signature: { uid: 'firebase-token' } }))).status, 200);
  assert.equal((await route(makeRequest('reject', { signature: {}, rejectionReason: 'No.' }))).status, 200);
  assert.equal((await route(makeRequest('approve', { signature: {} }))).status, 200);
  assert.deepEqual(calls.map(row => row[0]), ['recommend', 'reject', 'approve']);
  assert.ok(calls.every(row => row[1] === 'firebase-token' && row[2] === REQUEST_ID));

  const getRequest = {
    method: 'GET',
    url: 'https://local/api/v1/afc-requests/' + REQUEST_ID + '/approve',
    headers: { get: name => name.toLowerCase() === 'authorization' ? 'Bearer firebase-token' : null }
  };
  const denied = await route(getRequest);
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.Allow, 'POST');
});

test('approval routes reject malformed JSON before calling the approval API', async () => {
  let calls = 0;
  const route = createAfcRequestFunctions({ api: {
    recommend: async () => { calls += 1; return { status: 200, body: {} }; },
    reject: async () => { calls += 1; return { status: 200, body: {} }; },
    approve: async () => { calls += 1; return { status: 200, body: {} }; }
  } });
  const request = {
    method: 'POST',
    url: 'https://local/api/v1/afc-requests/' + REQUEST_ID + '/approve',
    headers: { get: () => 'Bearer firebase-token' },
    json: async () => { throw new SyntaxError('bad'); }
  };
  assert.equal((await route(request)).status, 400);
  assert.equal(calls, 0);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
}

function post(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write('{}');
    req.end();
  });
}

test('actual SQL runtime mounts approval actions and rejects anonymous decisions before SQL lookup', async t => {
  const { createSwaSqlRuntime } = require('../src/runtime/swa-sql-runtime');
  const { createUniversityHttpServer } = require('../src/runtime/university-http-server');
  let sqlQueries = 0;
  class FakePool {
    async connect() { return this; }
    request() { return { input() { return this; }, async query() { sqlQueries += 1; return { recordset: [] }; } }; }
    async close() {}
  }
  const env = {
    FIREBASE_PROJECT_ID: 'test-project',
    PAWS_SQL_CONNECTION_STRING: 'Server=localhost;Database=VetMed-Ops;Encrypt=true;',
    PAWS_SQL_DRIVER: 'tedious'
  };
  const runtime = createSwaSqlRuntime({ env, admin: {}, sql: { ConnectionPool: FakePool } });
  const server = createUniversityHttpServer({ runtime, env: { ...TEST_RUNTIME_IDENTITY } });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await runtime.close(); });
  const port = await listen(server);
  assert.equal(await post(port, '/api/v1/afc-requests/' + REQUEST_ID + '/recommend'), 401);
  assert.equal(await post(port, '/api/v1/afc-requests/' + REQUEST_ID + '/reject'), 401);
  assert.equal(await post(port, '/api/v1/afc-requests/' + REQUEST_ID + '/approve'), 401);
  assert.equal(sqlQueries, 0);
});
