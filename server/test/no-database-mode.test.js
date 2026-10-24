'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqlConnection } = require('../src/data/sql-connection.js');
const { createSwaSqlRuntime } = require('../src/runtime/swa-sql-runtime.js');

// The target repository currently has no business database. That is a supported
// deployment state, and these tests pin the behaviour that makes it safe:
// the application starts, business reads answer one typed code, writes fail
// closed, and nothing is ever dialled.

function fakeSqlRecorder() {
  const state = { pools: 0 };
  const sql = {
    ConnectionPool: class {
      constructor(config) { this.config = config; state.pools++; }
      async connect() { return this; }
      request() { return { input() { return this; }, async query() { return { recordset: [] }; } }; }
      async close() {}
    },
    Transaction: class { on() {} async begin() {} async commit() {} async rollback() {} },
    Request: class { input() { return this; } async query() { return { recordset: [] }; } },
    ISOLATION_LEVEL: { SERIALIZABLE: 'S' }
  };
  return { sql, state };
}

const admin = {
  initializeApp() { return {}; },
  credential: { cert() { return {}; } },
  auth() {
    return {
      verifyIdToken: async () => ({
        uid: 'u1',
        email: 'someone@example.test',
        aud: 'demo-project',
        iss: 'https://securetoken.google.com/demo-project'
      })
    };
  }
};

test('with no database configured the runtime still composes', () => {
  const { sql, state } = fakeSqlRecorder();
  const runtime = createSwaSqlRuntime({ env: { FIREBASE_PROJECT_ID: 'demo-project' }, admin, sqlModule: sql });
  assert.equal(typeof runtime, 'function');
  assert.equal(typeof runtime.close, 'function');
  // Nothing may be dialled merely to assemble the application.
  assert.equal(state.pools, 0);
});

test('a business route answers one typed DATABASE_NOT_CONFIGURED, not a generic failure', async () => {
  const { sql } = fakeSqlRecorder();
  const runtime = createSwaSqlRuntime({ env: { FIREBASE_PROJECT_ID: 'demo-project' }, admin, sqlModule: sql });
  const response = await runtime(new Request('https://example.test/api/v1/dashboard/summary', {
    headers: { authorization: 'Bearer token' }
  }));
  assert.equal(response.status, 503);
  assert.equal(response.jsonBody.error.code, 'DATABASE_NOT_CONFIGURED');
  assert.match(response.jsonBody.error.message, /not configured/i);
  await runtime.close();
});

test('an unauthenticated caller is rejected before the unconfigured check', async () => {
  const { sql } = fakeSqlRecorder();
  const runtime = createSwaSqlRuntime({ env: { FIREBASE_PROJECT_ID: 'demo-project' }, admin, sqlModule: sql });
  // No authorization header: authentication must still be the first gate, so the
  // caller learns they are unauthenticated rather than that the database is absent.
  const response = await runtime(new Request('https://example.test/api/v1/dashboard/summary'));
  assert.equal(response.status, 401);
  await runtime.close();
});

test('an unconfigured connection refuses reads and writes without touching the wire', async () => {
  const { sql, state } = fakeSqlRecorder();
  const connection = createSqlConnection({ sqlModule: sql });
  assert.equal(connection.isConfigured, false);
  assert.equal(connection.isConnected, false);

  for (const run of [
    () => connection.query('SELECT 1'),
    () => connection.transaction(async () => {})
  ]) {
    await assert.rejects(run, error => error.code === 'DATABASE_NOT_CONFIGURED' && error.status === 503);
  }
  // Health reports the truth rather than throwing: "not configured" is a known
  // state, and a health probe that throws is indistinguishable from a crash.
  assert.equal(await connection.health(), false);
  assert.equal(state.pools, 0, 'an unconfigured connection must never open a pool');
  await connection.close();
});

test('a configured connection reports itself as configured', () => {
  const { sql } = fakeSqlRecorder();
  const connection = createSqlConnection({ sqlModule: sql, tokenProvider: async () => 'token', server: 'srv', database: 'db' });
  assert.equal(connection.isConfigured, true);
});

test('blank database settings fall through to the unconfigured state rather than a default host', () => {
  const { sql, state } = fakeSqlRecorder();
  // Empty strings are what a deployment with no database actually has.
  const runtime = createSwaSqlRuntime({
    env: { FIREBASE_PROJECT_ID: 'demo-project', AZURE_SQL_SERVER: '', AZURE_SQL_DATABASE: '', PAWS_SQL_CONNECTION_STRING: '' },
    admin,
    sqlModule: sql
  });
  assert.equal(typeof runtime, 'function');
  assert.equal(state.pools, 0);
});
