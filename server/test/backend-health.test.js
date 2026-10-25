'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSwaSqlRuntime } = require('../src/runtime/swa-sql-runtime');

// Health must describe the backend that is actually behind the API. The failure
// this replaces asked the SQL connection unconditionally, so a working Firestore
// backend reported itself dead and an unreachable Firestore could report healthy.

function fakeFirestore({ fail = null } = {}) {
  return {
    collection() {
      return {
        limit() { return this; },
        async get() {
          if (fail) throw fail;
          return { docs: [] };
        },
        doc(id) {
          const snapshot = { id, exists: false, data: () => ({}), get: async () => snapshot };
          return snapshot;
        },
        where() { return this; },
        orderBy() { return this; }
      };
    }
  };
}

function adminWith(firestoreFactory) {
  return {
    initializeApp() { return { options: {} }; },
    app() { throw Error('no app'); },
    credential: { cert() { return {}; } },
    auth() { return { verifyIdToken: async () => ({}) }; },
    firestore: firestoreFactory
  };
}

test('a healthy Firestore backend reports ok and names itself', async () => {
  const runtime = createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'vista-teaching-lab' },
    admin: adminWith(() => fakeFirestore())
  });
  const report = await runtime.health();
  assert.equal(report.ok, true);
  assert.equal(report.backend, 'firestore');
  assert.equal(report.projectId, 'vista-teaching-lab');
  await runtime.close();
});

test('a Firestore backend that cannot be created reports unconfigured, never ok', async () => {
  const runtime = createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'vista-teaching-lab' },
    admin: adminWith(() => null)
  });
  const report = await runtime.health();
  assert.equal(report.ok, false);
  assert.equal(report.reason, 'FIRESTORE_NOT_CONFIGURED');
  await runtime.close();
});

test('a project mismatch is reported instead of being assumed away', async () => {
  const runtime = createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'tester-teaching' },
    admin: adminWith(() => fakeFirestore())
  });
  const report = await runtime.health();
  assert.equal(report.ok, false);
  assert.equal(report.reason, 'PROJECT_MISMATCH');
  await runtime.close();
});

test('an unreachable Firestore is a failure, not a success', async () => {
  const runtime = createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'vista-teaching-lab' },
    admin: adminWith(() => fakeFirestore({ fail: Object.assign(Error('down'), { code: 14 }) }))
  });
  const report = await runtime.health();
  assert.equal(report.ok, false);
  assert.equal(report.backend, 'firestore');
  assert.equal(report.reason, 'BACKEND_UNAVAILABLE');
  await runtime.close();
});

test('an Admin SDK credential failure in the probe is not reported as healthy', async () => {
  const runtime = createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'vista-teaching-lab' },
    admin: adminWith(() => fakeFirestore({ fail: Object.assign(Error('denied'), { code: 7 }) }))
  });
  const report = await runtime.health();
  assert.equal(report.ok, false);
  assert.equal(report.reason, 'BACKEND_CREDENTIAL_FORBIDDEN');
  await runtime.close();
});

test('SQL mode keeps its own health behaviour and label', async () => {
  const sql = {
    ConnectionPool: class {
      async connect() { return this; }
      request() { return { input() { return this; }, async query() { return { recordset: [{ ok: 1 }] }; } }; }
      async close() {}
    },
    Transaction: class { on() {} async begin() {} async commit() {} async rollback() {} },
    Request: class { input() { return this; } async query() { return { recordset: [{ ok: 1 }] }; } },
    ISOLATION_LEVEL: { SERIALIZABLE: 'S' }
  };
  const runtime = createSwaSqlRuntime({
    env: { FIREBASE_PROJECT_ID: 'demo', AZURE_SQL_SERVER: 'srv', AZURE_SQL_DATABASE: 'db' },
    admin: adminWith(() => null),
    sqlModule: sql
  });
  // The SQL path still resolves credentials through the App Service identity
  // endpoint, which is not present in this environment. What matters here is that
  // the probe stays on the SQL branch, reports a backend, and fails closed rather
  // than throwing or claiming success.
  const report = await runtime.health();
  assert.equal(report.backend, 'sql');
  assert.equal(typeof report.ok, 'boolean');
  assert.equal(report.ok, false, 'no identity endpoint here, so the probe must not claim healthy');
  await runtime.close();
});

test('an unconfigured SQL backend reports not-ok rather than throwing', async () => {
  const runtime = createSwaSqlRuntime({
    env: { FIREBASE_PROJECT_ID: 'demo' },
    admin: adminWith(() => null)
  });
  const report = await runtime.health();
  assert.equal(report.backend, 'sql');
  assert.equal(report.configured, false);
  assert.equal(report.ok, false);
  await runtime.close();
});

// ---------------------------------------------------------------------------
// The HTTP endpoint must reflect the same probe. It used to answer 200 with
// status 'ok' unconditionally, so a monitor watching it learned nothing.
// ---------------------------------------------------------------------------
const http = require('node:http');
const { createUniversityHttpServer } = require('../src/runtime/university-http-server');

const ATTESTATION_ENV = {
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

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(runtime, run) {
  const server = createUniversityHttpServer({ env: ATTESTATION_ENV, runtime });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(server.address().port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('the HTTP health endpoint reports a healthy backend as 200', async () => {
  const runtime = createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'vista-teaching-lab' },
    admin: adminWith(() => fakeFirestore())
  });
  await withServer(runtime, async port => {
    const response = await httpGet(port, '/api/health/runtime');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.backend, 'firestore');
    // Under Firestore it must not keep claiming the SQL authority.
    assert.equal(response.body.authority, 'firestore');
  });
  await runtime.close();
});

test('the HTTP health endpoint reports an unreachable backend as 503, never 200', async () => {
  const runtime = createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'vista-teaching-lab' },
    admin: adminWith(() => fakeFirestore({ fail: Object.assign(Error('down'), { code: 14 }) }))
  });
  await withServer(runtime, async port => {
    const response = await httpGet(port, '/api/health/runtime');
    assert.equal(response.status, 503);
    assert.equal(response.body.status, 'unavailable');
    assert.equal(response.body.reason, 'BACKEND_UNAVAILABLE');
  });
  await runtime.close();
});

test('the HTTP health endpoint reports a mismatched project as 503', async () => {
  const runtime = createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'tester-teaching' },
    admin: adminWith(() => fakeFirestore())
  });
  await withServer(runtime, async port => {
    const response = await httpGet(port, '/api/health/runtime');
    assert.equal(response.status, 503);
    assert.equal(response.body.reason, 'PROJECT_MISMATCH');
  });
  await runtime.close();
});
