'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSqlConnectionConfig, createSqlConnection } = require('../src/data/sql-connection');

const endpoint = 'Server=tcp:sql.example.test,1433;Database=teaching-assignment-lab;Encrypt=true;TrustServerCertificate=false;';

test('managed identity mode builds an Azure AD default configuration', () => {
  const config = buildSqlConnectionConfig({
    connectionString: endpoint,
    miClientId: '00000000-0000-4000-8000-000000000001'
  });

  assert.equal(config.server, 'sql.example.test');
  assert.equal(config.port, 1433);
  assert.equal(config.database, 'teaching-assignment-lab');
  assert.deepEqual(config.authentication, {
    type: 'azure-active-directory-default',
    options: { clientId: '00000000-0000-4000-8000-000000000001' }
  });
  assert.equal(config.options.encrypt, true);
  assert.equal(config.options.trustServerCertificate, false);
});

test('managed identity mode rejects password-bearing endpoint configuration', () => {
  assert.throws(
    () => buildSqlConnectionConfig({
      connectionString: `${endpoint}User ID=legacy;Password=secret;`,
      miClientId: '00000000-0000-4000-8000-000000000001'
    }),
    /not allowed|unknown/i
  );
});

test('managed identity mode uses an allowlist for endpoint fields', () => {
  for (const field of ['User ID', 'UID', 'Username', 'Password', 'PWD', 'Authentication', 'Integrated Security', 'Trusted_Connection', 'Access Token', 'Client Secret', 'Client ID', 'Tenant ID', 'Account Key', 'Token', 'UnknownOption']) {
    assert.throws(
      () => buildSqlConnectionConfig({
        connectionString: `${endpoint}${field}=value;`,
        miClientId: '00000000-0000-0000-0000-000000000001'
      }),
      /not allowed|unknown/i,
      field
    );
  }
});

test('conflicting endpoint aliases fail closed', () => {
  assert.throws(
    () => buildSqlConnectionConfig({
      connectionString: 'Server=a;Data Source=b;Database=db;',
      miClientId: '00000000-0000-0000-0000-000000000001'
    }),
    /conflicting/i
  );
  assert.throws(
    () => buildSqlConnectionConfig({
      connectionString: 'Server=a;Database=x;Initial Catalog=y;',
      miClientId: '00000000-0000-0000-0000-000000000001'
    }),
    /conflicting/i
  );
});

test('managed identity mode rejects weakened encryption settings', () => {
  assert.throws(
    () => buildSqlConnectionConfig({
      connectionString: 'Server=a;Database=db;Encrypt=false;',
      miClientId: '00000000-0000-0000-0000-000000000001'
    }),
    /Encrypt must be true/i
  );
  assert.throws(
    () => buildSqlConnectionConfig({
      connectionString: 'Server=a;Database=db;TrustServerCertificate=true;',
      miClientId: '00000000-0000-0000-0000-000000000001'
    }),
    /TrustServerCertificate must be false/i
  );
});

test('managed identity mode fails closed when endpoint configuration is incomplete', () => {
  assert.throws(
    () => buildSqlConnectionConfig({
      connectionString: 'Database=teaching-assignment-lab;',
      miClientId: '00000000-0000-4000-8000-000000000001'
    }),
    /server.*database/i
  );
});

test('managed identity mode rejects a malformed client ID', () => {
  assert.throws(
    () => buildSqlConnectionConfig({ connectionString: endpoint, miClientId: 'not-a-guid' }),
    /PAWS_SQL_MI_CLIENT_ID must be a UUID/i
  );
});

test('managed identity mode accepts a generic GUID-shaped client ID', () => {
  const config = buildSqlConnectionConfig({
    connectionString: endpoint,
    miClientId: '00000000-0000-0000-0000-000000000001'
  });
  assert.equal(config.authentication.options.clientId, '00000000-0000-0000-0000-000000000001');
});

test('legacy mode preserves the original connection string', () => {
  assert.equal(buildSqlConnectionConfig({ connectionString: endpoint }), endpoint);
});

test('connection pool receives the managed identity configuration', async () => {
  let received;
  const sql = {
    ConnectionPool: class {
      constructor(config) { received = config; }
      async connect() { return this; }
      request() { return { input() {}, async query() { return { recordset: [] }; } }; }
    }
  };
  await createSqlConnection({
    connectionString: endpoint,
    miClientId: '00000000-0000-4000-8000-000000000001',
    sql
  }).query('SELECT 1');
  assert.equal(received.authentication.options.clientId, '00000000-0000-4000-8000-000000000001');
  assert.equal(received.options.encrypt, true);
});

test('missing SQL endpoint configuration fails closed', () => {
  assert.throws(
    () => buildSqlConnectionConfig({ miClientId: '00000000-0000-4000-8000-000000000001' }),
    /PAWS_SQL_CONNECTION_STRING is required/
  );
});

// ---------------------------------------------------------------------------
// BETA-R4D-10A2 regression: parameter binding must never leave a variable that
// the statement references undeclared. The live Dashboard summary returned
// 503 SQL_UNAVAILABLE ("Must declare the scalar variable @facultyId") because
// an explicit `null` was dropped instead of being bound as SQL NULL.
// ---------------------------------------------------------------------------

function recordingConnection() {
  const bound = [];
  const sql = {
    ConnectionPool: class {
      constructor() {}
      async connect() { return this; }
      request() {
        return {
          input(name, value) { bound.push({ name, value }); },
          async query() { return { recordset: [] }; }
        };
      }
    }
  };
  return { bound, sql };
}

test('an explicitly supplied null is bound as a real SQL NULL', async () => {
  const { bound, sql } = recordingConnection();
  await createSqlConnection({
    connectionString: endpoint,
    miClientId: '00000000-0000-4000-8000-000000000001',
    sql
  }).query('SELECT 1 WHERE (@facultyId IS NULL OR 1 = 1)', { facultyId: null });
  assert.deepEqual(bound, [{ name: 'facultyId', value: null }]);
});

test('an undefined parameter is skipped rather than bound', async () => {
  const { bound, sql } = recordingConnection();
  await createSqlConnection({
    connectionString: endpoint,
    miClientId: '00000000-0000-4000-8000-000000000001',
    sql
  }).query('SELECT 1', { facultyId: undefined });
  assert.deepEqual(bound, []);
});

test('every parameter the statement references is actually bound', async () => {
  const { bound, sql } = recordingConnection();
  const text = 'SELECT 1 WHERE a = @academicYear AND (@facultyId IS NULL OR b = @facultyId) AND c IN (@hiccRoleType0)';
  await createSqlConnection({
    connectionString: endpoint,
    miClientId: '00000000-0000-4000-8000-000000000001',
    sql
  }).query(text, { academicYear: '2026-27', facultyId: null, hiccRoleType0: 'VISC' });
  const declared = [...new Set([...text.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]))];
  const names = bound.map(b => b.name);
  for (const name of declared) {
    assert.equal(names.includes(name), true, `parameter @${name} is referenced but was not bound`);
  }
});
