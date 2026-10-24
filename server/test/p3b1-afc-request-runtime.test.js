'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createAfcRequestFunctions } = require('../src/runtime/swa-afc-request-functions');
const TEST_RUNTIME_IDENTITY = { PAWS_RELEASE_SHA: 'a'.repeat(40), PAWS_RUNTIME_TRUST_ANCHOR: 'b'.repeat(40) };

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

function makeRequest(path, { method = 'GET', token = 'firebase-token', body, invalidJson = false } = {}) {
  return {
    method,
    url: 'https://local' + path,
    headers: { get: name => name.toLowerCase() === 'authorization' && token ? 'Bearer ' + token : null },
    json: async () => {
      if (invalidJson) throw new SyntaxError('invalid');
      return body;
    }
  };
}

test('AFC request HTTP routes pass only bearer identity and bounded request data to the API', async () => {
  const calls = [];
  const api = {
    list: async token => { calls.push(['list', token]); return { status: 200, body: { afcRequests: [] } }; },
    submit: async (token, body) => { calls.push(['submit', token, body]); return { status: 201, body: { afcRequest: { status: 'pending_report_to' } } }; },
    withdraw: async (token, id) => { calls.push(['withdraw', token, id]); return { status: 200, body: { afcRequest: { status: 'withdrawn' } } }; }
  };
  const route = createAfcRequestFunctions({ api });
  assert.equal((await route(makeRequest('/api/v1/afc-requests'))).status, 200);
  assert.equal((await route(makeRequest('/api/v1/afc-requests', { method: 'POST', body: { startDate: '2026-10-05' } }))).status, 201);
  assert.equal((await route(makeRequest('/api/v1/afc-requests/' + REQUEST_ID + '/withdraw', { method: 'POST' }))).status, 200);
  assert.deepEqual(calls, [
    ['list', 'firebase-token'],
    ['submit', 'firebase-token', { startDate: '2026-10-05' }],
    ['withdraw', 'firebase-token', REQUEST_ID]
  ]);
});

test('AFC request HTTP routes reject unsupported methods, malformed JSON and unknown paths', async () => {
  let calls = 0;
  const route = createAfcRequestFunctions({ api: {
    list: async () => { calls++; return { status: 200, body: {} }; },
    submit: async () => { calls++; return { status: 201, body: {} }; },
    withdraw: async () => { calls++; return { status: 200, body: {} }; }
  } });
  const wrongMethod = await route(makeRequest('/api/v1/afc-requests', { method: 'DELETE' }));
  assert.equal(wrongMethod.status, 405);
  assert.match(wrongMethod.headers.Allow, /GET/);
  assert.equal((await route(makeRequest('/api/v1/afc-requests', { method: 'POST', invalidJson: true }))).status, 400);
  assert.equal((await route(makeRequest('/api/v1/other'))).status, 404);
  assert.equal(calls, 0);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('actual SQL runtime mounts AFC requests and rejects anonymous callers before SQL lookup', async t => {
  const { createSwaSqlRuntime } = require('../src/runtime/swa-sql-runtime');
  const { createUniversityHttpServer } = require('../src/runtime/university-http-server');
  let sqlQueries = 0;
  class FakePool {
    async connect() { return this; }
    request() { return { input() { return this; }, async query() { sqlQueries++; return { recordset: [] }; } }; }
    async close() {}
  }
  const env = {
    FIREBASE_PROJECT_ID: 'test-project',
    PAWS_SQL_CONNECTION_STRING: 'Server=localhost;Database=VetMed-Ops;Encrypt=true;',
    PAWS_SQL_DRIVER: 'tedious'
  };
  const runtime = createSwaSqlRuntime({ env, admin: {}, sql: { ConnectionPool: FakePool } });
  const server = createUniversityHttpServer({ runtime, env: { ...TEST_RUNTIME_IDENTITY } });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await runtime.close();
  });
  const port = await listen(server);
  assert.equal(await get(port, '/api/v1/afc-requests'), 401);
  assert.equal(sqlQueries, 0);
});
