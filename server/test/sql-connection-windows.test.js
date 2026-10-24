'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { buildSqlConnectionConfig } = require('../src/data/sql-connection');
const { createSwaSqlRuntime } = require('../src/runtime/swa-sql-runtime');

const endpoint = 'Server=tcp:ITAPPVETOPSDB01.uc.ucalgary.ca,1433;Database=VetMed-Ops;Encrypt=true;';
const miClientId = '00000000-0000-4000-8000-000000000001';

test('default driver remains Tedious-compatible and preserves the legacy endpoint', () => {
  assert.equal(buildSqlConnectionConfig({ connectionString: endpoint }), endpoint);
});

test('Windows mode parses endpoint and uses trusted connection with strict TLS by default', () => {
  const config = buildSqlConnectionConfig({ connectionString: endpoint, driver: 'msnodesqlv8' });
  assert.equal(config.server, 'ITAPPVETOPSDB01.uc.ucalgary.ca');
  assert.equal(config.port, 1433);
  assert.equal(config.database, 'VetMed-Ops');
  assert.equal(config.options.trustedConnection, true);
  assert.equal(config.options.encrypt, true);
  assert.equal(config.options.trustServerCertificate, false);
  assert.match(config.connectionString, /Driver=\{ODBC Driver 18 for SQL Server\}/);
  assert.match(config.connectionString, /Trusted_Connection=Yes/);
  assert.match(config.connectionString, /Encrypt=Yes/);
  assert.match(config.connectionString, /TrustServerCertificate=No/);
  assert.equal(config.authentication, undefined);
});

test('Windows mode can allow the self-signed certificate only with an explicit test flag', () => {
  const config = buildSqlConnectionConfig({
    connectionString: endpoint + 'TrustServerCertificate=true;',
    driver: 'msnodesqlv8',
    allowSelfSigned: true
  });
  assert.equal(config.options.encrypt, true);
  assert.equal(config.options.trustServerCertificate, true);
  assert.match(config.connectionString, /TrustServerCertificate=Yes/);
});

test('Windows mode rejects certificate bypass without the explicit test flag', () => {
  assert.throws(
    () => buildSqlConnectionConfig({
      connectionString: endpoint + 'TrustServerCertificate=true;',
      driver: 'msnodesqlv8'
    }),
    /test-only|PAWS_SQL_ALLOW_SELF_SIGNED/i
  );
});

test('Windows mode rejects false encryption', () => {
  assert.throws(
    () => buildSqlConnectionConfig({
      connectionString: endpoint.replace('Encrypt=true', 'Encrypt=false'),
      driver: 'msnodesqlv8'
    }),
    /Encrypt must be true/i
  );
});

test('Windows mode uses an allowlist and rejects credential-bearing fields', () => {
  for (const field of [
    'User ID', 'UID', 'Username', 'Password', 'PWD', 'Access Token',
    'Client Secret', 'Tenant ID', 'Account Key'
  ]) {
    assert.throws(
      () => buildSqlConnectionConfig({
        connectionString: endpoint + field + '=not-used;',
        driver: 'msnodesqlv8'
      }),
      /not allowed|unknown/i,
      field
    );
  }
});

test('Windows mode rejects conflicting Managed Identity configuration', () => {
  assert.throws(
    () => buildSqlConnectionConfig({
      connectionString: endpoint,
      driver: 'msnodesqlv8',
      miClientId
    }),
    /cannot be combined|conflict/i
  );
});

test('unknown SQL driver is rejected', () => {
  assert.throws(
    () => buildSqlConnectionConfig({ connectionString: endpoint, driver: 'mssql/anything' }),
    /unsupported.*driver|driver.*unsupported/i
  );
});

test('default Tedious mode rejects the self-signed bypass setting instead of weakening TLS', () => {
  assert.throws(
    () => buildSqlConnectionConfig({
      connectionString: endpoint + 'TrustServerCertificate=true;',
      driver: 'tedious',
      allowSelfSigned: true
    }),
    /only.*Windows|msnodesqlv8/i
  );
});

test('runtime parses PAWS_SQL_ALLOW_SELF_SIGNED strictly', () => {
  for (const value of ['1', 'yes', 'TRUE-ish', '']) {
    assert.throws(
      () => createSwaSqlRuntime({
        env: { FIREBASE_PROJECT_ID: 'tester-teaching', PAWS_SQL_CONNECTION_STRING: endpoint, PAWS_SQL_DRIVER: 'msnodesqlv8', PAWS_SQL_ALLOW_SELF_SIGNED: value },
        admin: {},
        sql: {}
      }),
      /PAWS_SQL_ALLOW_SELF_SIGNED.*true.*false/i
    );
  }
});

test('runtime rejects an unknown driver selector before loading a driver', () => {
  assert.throws(
    () => createSwaSqlRuntime({ env: { FIREBASE_PROJECT_ID: 'tester-teaching', PAWS_SQL_CONNECTION_STRING: endpoint, PAWS_SQL_DRIVER: 'other' }, admin: {} }),
    /unsupported.*driver|driver.*unsupported/i
  );
});

test('runtime loads the Windows SQL module only for explicit Windows mode', () => {
  const originalLoad = Module._load;
  const loaded = [];
  const fakeSql = { ConnectionPool: class {} };
  Module._load = function(request, parent, isMain) {
    if (request === 'mssql' || request === 'mssql/msnodesqlv8') {
      loaded.push(request);
      return fakeSql;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    createSwaSqlRuntime({
      env: { FIREBASE_PROJECT_ID: 'tester-teaching', PAWS_SQL_CONNECTION_STRING: endpoint },
      admin: {}
    });
    assert.deepEqual(loaded, ['mssql']);
    loaded.length = 0;
    createSwaSqlRuntime({
      env: { FIREBASE_PROJECT_ID: 'tester-teaching', PAWS_SQL_CONNECTION_STRING: endpoint, PAWS_SQL_DRIVER: 'msnodesqlv8' },
      admin: {}
    });
    assert.deepEqual(loaded, ['mssql/msnodesqlv8']);
  } finally {
    Module._load = originalLoad;
  }
});

test('runtime preserves an injected SQL driver in Windows mode', () => {
  const fake = { ConnectionPool: class {} };
  const runtime = createSwaSqlRuntime({
    env: { FIREBASE_PROJECT_ID: 'tester-teaching', PAWS_SQL_CONNECTION_STRING: endpoint, PAWS_SQL_DRIVER: 'msnodesqlv8' },
    admin: {},
    sql: fake
  });
  assert.equal(typeof runtime, 'function');
});

test('Windows SQL pool receives trusted connection and strict TLS settings', async () => {
  let received;
  const sql = {
    ConnectionPool: class {
      constructor(config) { received = config; }
      async connect() { return this; }
      request() { return { async query() { return { recordset: [] }; } }; }
    }
  };
  const { createSqlConnection } = require('../src/data/sql-connection');
  await createSqlConnection({
    connectionString: endpoint,
    driver: 'msnodesqlv8',
    sql
  }).query('SELECT 1');
  assert.equal(received.options.trustedConnection, true);
  assert.equal(received.options.encrypt, true);
  assert.equal(received.options.trustServerCertificate, false);
  assert.match(received.connectionString, /Driver=\{ODBC Driver 18 for SQL Server\}/);
  assert.match(received.connectionString, /Trusted_Connection=Yes/);
});
