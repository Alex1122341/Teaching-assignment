'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createUniversityHttpServer } = require('../src/runtime/university-http-server');
const TEST_RUNTIME_IDENTITY = Object.freeze({
  PAWS_RELEASE_SHA: 'a'.repeat(40),
  PAWS_RUNTIME_TRUST_ANCHOR: 'b'.repeat(40)
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

function get(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: options.method || 'GET', headers: options.headers || {} }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function getRaw(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: options.method || 'GET', headers: options.headers || {} }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}
test('authorized trainee CSV export preserves exact bytes through the loopback adapter',async t=>{
 const bytes=Buffer.from('\uFEFFAcademic year,Faculty\r\n2026-27,Example\r\n','utf8');
 const server=createUniversityHttpServer({runtime:async()=>({status:200,body:bytes,headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="trainees-2026-27.csv"','Cache-Control':'private, no-store'}}),env:{...TEST_RUNTIME_IDENTITY}});
 t.after(()=>server.close());const port=await listen(server);const result=await getRaw(port,'/api/v1/dashboard/trainees/export?academicYear=2026-27',{headers:{authorization:'Bearer synthetic'}});
 assert.equal(result.status,200);assert.deepEqual(result.body,bytes);assert.match(result.headers['cache-control'],/no-store/);assert.match(result.headers['content-type'],/text\/csv/);
});

test('loopback adapter preserves runtime route response and Firebase bearer header', async t => {
  const calls = [];
  const server = createUniversityHttpServer({
    runtime: async request => {
      calls.push(request);
      return { status: 200, jsonBody: { path: new URL(request.url).pathname, authorization: request.headers.get('authorization') } };
    },
    env: { ...TEST_RUNTIME_IDENTITY }
  });
  t.after(() => server.close());
  const port = await listen(server);
  const response = await get(port, '/api/v1/me', { headers: { authorization: 'Bearer firebase-token' } });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { path: '/api/v1/me', authorization: 'Bearer firebase-token' });
  assert.equal(calls.length, 1);
});

test('only exact activity upload POST uses the existing 1 MiB cap',async t=>{
 const seen=[];const server=createUniversityHttpServer({runtime:async request=>{seen.push(new URL(request.url).pathname);return {status:201,jsonBody:{received:(await request.json()).fileBase64.length}};},env:{...TEST_RUNTIME_IDENTITY}});
 t.after(()=>server.close());const port=await listen(server);const body=JSON.stringify({fileBase64:'A'.repeat(80000)});const headers={'content-type':'application/json'};
 assert.equal((await get(port,'/api/v1/calendar-activity-imports',{method:'POST',headers,body})).status,201);
 for(const [method,path] of [['PUT','/api/v1/calendar-activity-imports'],['POST','/api/v1/calendar-activity-imports/'],['POST','/api/v1/calendar-activity-imports/id/commit'],['POST','/api/v1/dashboard/afc-records']])assert.equal((await get(port,path,{method,headers,body})).status,413);
 assert.deepEqual(seen,['/api/v1/calendar-activity-imports']);
 const tooLarge=JSON.stringify({fileBase64:'A'.repeat(1048577)});assert.equal((await get(port,'/api/v1/calendar-activity-imports',{method:'POST',headers,body:tooLarge})).status,413);
});

test('unset CORS allowlist denies browser cross-origin requests', async t => {
  const server = createUniversityHttpServer({ runtime: async () => ({ status: 200, jsonBody: {} }), env: { ...TEST_RUNTIME_IDENTITY } });
  t.after(() => server.close());
  const port = await listen(server);
  const response = await get(port, '/api/v1/me', { headers: { origin: 'https://evil.example' } });
  assert.equal(response.status, 403);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('exact allowlist permits origin and rejects substring lookalikes', async t => {
  const server = createUniversityHttpServer({
    runtime: async () => ({ status: 200, jsonBody: {} }),
    env: { ...TEST_RUNTIME_IDENTITY, PAWS_API_ALLOWED_ORIGINS: 'https://paws.example.edu' }
  });
  t.after(() => server.close());
  const port = await listen(server);
  const allowed = await get(port, '/api/v1/me', { headers: { origin: 'https://paws.example.edu' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://paws.example.edu');
  const denied = await get(port, '/api/v1/me', { headers: { origin: 'https://paws.example.edu.evil.test' } });
  assert.equal(denied.status, 403);
});

test('bounded JSON POST reaches existing AFC route with parsed payload', async t => {
  let received;
  const server = createUniversityHttpServer({
    runtime: async request => { received = await request.json(); return { status: 201, jsonBody: { ok: true } }; },
    env: { ...TEST_RUNTIME_IDENTITY, PAWS_API_MAX_BODY_BYTES: '64' }
  });
  t.after(() => server.close());
  const port = await listen(server);
  const response = await get(port, '/api/v1/dashboard/afc-records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ a: 1 })
  });
  assert.equal(response.status, 201);
  assert.deepEqual(received, { a: 1 });
});

test('session batch accepts the bounded 1 MiB payload while other routes retain the configured limit', async t => {
  const seen = [];
  const server = createUniversityHttpServer({
    runtime: async request => { seen.push(new URL(request.url).pathname); await request.arrayBuffer(); return { status: 201, jsonBody: { ok: true } }; },
    env: { ...TEST_RUNTIME_IDENTITY, PAWS_API_MAX_BODY_BYTES: '65536' }
  });
  t.after(() => server.close());
  const port = await listen(server);
  const body = JSON.stringify({ sessions: ['x'.repeat(70_000)] });
  const batch = await get(port, '/api/v1/sessions/batch', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body
  });
  assert.equal(batch.status, 201);
  const other = await get(port, '/api/v1/dashboard/afc-records', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body
  });
  assert.equal(other.status, 413);
  assert.deepEqual(seen, ['/api/v1/sessions/batch']);
});

test('binary runtime responses preserve exact PDF bytes and private download headers', async t => {
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x25]);
  const server = createUniversityHttpServer({
    runtime: async () => ({
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'attachment; filename="afc-approved-22222222-2222-4222-8222-222222222222.pdf"'
      },
      binaryBody: bytes
    }),
    env: { ...TEST_RUNTIME_IDENTITY, PAWS_API_ALLOWED_ORIGINS: 'https://paws.example.edu' }
  });
  t.after(() => server.close());
  const port = await listen(server);
  const response = await getRaw(port, '/api/v1/afc-requests/22222222-2222-4222-8222-222222222222/approved-artifact', {
    headers: { origin: 'https://paws.example.edu' }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, bytes);
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.equal(response.headers['content-length'], String(bytes.length));
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['content-disposition'], 'attachment; filename="afc-approved-22222222-2222-4222-8222-222222222222.pdf"');
  assert.match(response.headers['access-control-expose-headers'], /Content-Disposition/i);
});

test('malformed and oversized JSON fail before the runtime', async t => {
  let calls = 0;
  const server = createUniversityHttpServer({
    runtime: async () => { calls++; return { status: 200, jsonBody: {} }; },
    env: { ...TEST_RUNTIME_IDENTITY, PAWS_API_MAX_BODY_BYTES: '8' }
  });
  t.after(() => server.close());
  const port = await listen(server);
  const malformed = await get(port, '/api/v1/dashboard/afc-records', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{'
  });
  assert.equal(malformed.status, 400);
  const oversized = await get(port, '/api/v1/dashboard/afc-records', {
    method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '9' }, body: '123456789'
  });
  assert.equal(oversized.status, 413);
  assert.equal(calls, 0);
});

test('non-loopback binding is rejected and runtime exceptions fail closed', async t => {
  assert.throws(() => createUniversityHttpServer({ runtime: async () => ({}), env: { ...TEST_RUNTIME_IDENTITY }, host: '0.0.0.0' }), /loopback/i);
  const server = createUniversityHttpServer({ runtime: async () => { throw new Error('secret detail'); }, env: { ...TEST_RUNTIME_IDENTITY }, logger: { error() {} } });
  t.after(() => server.close());
  const port = await listen(server);
  const response = await get(port, '/api/v1/me');
  assert.equal(response.status, 503);
  assert.equal(response.body.includes('secret detail'), false);
});

test('local HTTP acceptance mounts the existing SQL health route and closes its pool', async t => {
  const { createSwaSqlRuntime } = require('../src/runtime/swa-sql-runtime');
  let queryText;
  let poolClosed = false;
  class FakePool {
    async connect() { return this; }
    request() {
      return {
        input() { return this; },
        async query(text) { queryText = text; return { recordset: [{ ok: 'VetMed-Ops' }] }; }
      };
    }
    async close() { poolClosed = true; }
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
  const response = await get(port, '/api/health/sql');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { status: 'ok', service: 'paws-beta-sql-runtime' });
  assert.match(queryText, /paws\.UserProfile/);
  await runtime.close();
  assert.equal(poolClosed, true);
});

test('OPTIONS preflight permits only an exact allowlisted origin and headers', async t => {
  const server = createUniversityHttpServer({
    runtime: async () => ({ status: 200, jsonBody: {} }),
    env: { ...TEST_RUNTIME_IDENTITY, PAWS_API_ALLOWED_ORIGINS: 'https://paws.example.edu' }
  });
  t.after(() => server.close());
  const port = await listen(server);
  const allowed = await get(port, '/api/v1/dashboard/afc-records', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://paws.example.edu',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type'
    }
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers['access-control-allow-methods'], 'GET, POST, PATCH, PUT, OPTIONS');
  assert.equal(allowed.headers['access-control-allow-headers'], 'Authorization, Content-Type, X-PAWS-Support-Context');
  const denied = await get(port, '/api/v1/me', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://paws.example.edu',
      'access-control-request-method': 'DELETE',
      'access-control-request-headers': 'authorization'
    }
  });
  assert.equal(denied.status, 403);
});

test('actual PAWS runtime keeps anonymous /me and Dashboard requests unauthorized without SQL access', async t => {
  const { createSwaSqlRuntime } = require('../src/runtime/swa-sql-runtime');
  const env = {
    FIREBASE_PROJECT_ID: 'test-project',
    PAWS_SQL_CONNECTION_STRING: 'Server=localhost;Database=VetMed-Ops;Encrypt=true;',
    PAWS_SQL_DRIVER: 'tedious'
  };
  let sqlQueries = 0;
  class FakePool {
    async connect() { return this; }
    request() { return { input() { return this; }, async query() { sqlQueries++; return { recordset: [] }; } }; }
    async close() {}
  }
  const runtime = createSwaSqlRuntime({ env, admin: {}, sql: { ConnectionPool: FakePool } });
  const server = createUniversityHttpServer({ runtime, env: { ...TEST_RUNTIME_IDENTITY } });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await runtime.close();
  });
  const port = await listen(server);
  const me = await get(port, '/api/v1/me');
  const dashboard = await get(port, '/api/v1/dashboard/summary');
  assert.equal(me.status, 401);
  assert.equal(dashboard.status, 401);
  assert.equal(sqlQueries, 0);
});

test('service port configuration fails closed outside the valid TCP range', () => {
  const { listenPort } = require('../src/runtime/university-api');
  assert.equal(listenPort({}), 8787);
  assert.equal(listenPort({ PAWS_API_PORT: '49152' }), 49152);
  for (const value of ['0', '65536', 'NaN', '-1', '']) {
    assert.throws(() => listenPort({ PAWS_API_PORT: value }), /PAWS_API_PORT/);
  }
});

