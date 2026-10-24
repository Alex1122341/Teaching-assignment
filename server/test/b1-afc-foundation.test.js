'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDashboardApi } = require('../src/data/dashboard-api');
const { createDashboardFunctions } = require('../src/runtime/swa-dashboard-functions');
const { createSqlDashboardRepository } = require('../src/data/sql-dashboard-repository');

const root = path.join(__dirname, '..', '..');
const FACULTY_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_ID = '22222222-2222-4222-8222-222222222222';

function request(url, { method = 'GET', body, token = 'token' } = {}) {
  return {
    method,
    url: `https://local${url}`,
    headers: { get: name => name.toLowerCase() === 'authorization' ? `Bearer ${token}` : null },
    async json() {
      if (body instanceof Error) throw body;
      return body;
    }
  };
}

function harness({ role = 'administrator', repository = {}, writeGates = { afcSingle: true, afcBatch: true } } = {}) {
  const calls = [];
  const profile = { active: true, mustChangePassword: false, baseRole: role, displayName: 'Trusted Admin', facultyId: null };
  const api = createDashboardApi({
    verifyToken: async () => ({ uid: 'firebase-uid' }),
    findUser: async () => profile,
    writeGates,
    repository: {
      summary: async () => ({}),
      faculty: async () => [],
      facultyById: async () => null,
      listAfcRecords: async args => { calls.push(['list', args]); return []; },
      createAfcRecord: async args => { calls.push(['create', args]); return { ...args, afcRecordId: CREATED_ID, facultyName: 'Ada One', reason: 'Vacation', sourceKind: 'manual', active: true }; },
      ...repository
    }
  });
  return { app: createDashboardFunctions({ api }), calls };
}

test('B1 AFC single POST fails closed by default before invoking its write repository', async () => {
  let writes = 0;
  const api = createDashboardApi({
    verifyToken: async () => ({ uid: 'firebase-uid' }),
    findUser: async () => ({ active: true, mustChangePassword: false, baseRole: 'administrator' }),
    repository: { createAfcRecord: async () => { writes++; } }
  });
  const response = await createDashboardFunctions({ api })(request('/api/v1/dashboard/afc-records', {
    method: 'POST',
    body: { facultyId: FACULTY_ID, startDate: '2026-10-01', endDate: '2026-10-01', reasonCode: 'vacation' }
  }));
  assert.equal(response.status, 503);
  assert.equal(response.jsonBody.error.code, 'WRITE_DISABLED');
  assert.equal(writes, 0);
});

test('B1 migration 007 creates isolated manual AFC storage, unified view, and trusted procedure', () => {
  const source = fs.readFileSync(path.join(root, 'database', 'azure-sql', '007_afc_manual_write_foundation.sql'), 'utf8');
  assert.match(source, /CREATE TABLE\s+paws\.AfcManualRecord/i);
  assert.match(source, /CREATE(?: OR ALTER)? VIEW\s+paws\.vAfcRecordUnified/i);
  assert.match(source, /CREATE SCHEMA\s+paws_api/i);
  assert.match(source, /CREATE(?: OR ALTER)? PROCEDURE\s+paws_api\.CreateAfcRecord/i);
  assert.match(source, /SET XACT_ABORT ON/i);
  assert.match(source, /BEGIN TRY/i);
  assert.match(source, /BEGIN TRANSACTION/i);
  assert.match(source, /ROLLBACK/i);
  assert.match(source, /afc_record_created/i);
  const procedure = source.slice(source.indexOf('CREATE OR ALTER PROCEDURE'));
  assert.doesNotMatch(procedure, /sp_executesql|EXEC\s*\(@|EXEC\s+\(/i);
  assert.doesNotMatch(source, /TeachingResponsibility|TeachingAssignmentGroup|SessionAssignment|DoeRule|005_|006_/i);
});

test('B1 least-privilege proposal grants only unified read and exact procedure execute', () => {
  const source = fs.readFileSync(path.join(root, 'database', 'azure-sql', '007_afc_manual_write_permissions.sql'), 'utf8');
  const proof = fs.readFileSync(path.join(root, 'database', 'azure-sql', '007_afc_manual_write_least_privilege_proof.sql'), 'utf8');
  assert.match(source, /GRANT\s+SELECT\s+ON\s+OBJECT::paws\.vAfcRecordUnified/i);
  assert.match(source, /GRANT\s+EXECUTE\s+ON\s+OBJECT::paws_api\.CreateAfcRecord/i);
  assert.doesNotMatch(source, /GRANT\s+(?:INSERT|UPDATE|DELETE).*AfcManualRecord/i);
  assert.doesNotMatch(source, /GRANT\s+EXECUTE\s+ON\s+SCHEMA::paws_api/i);
  assert.match(proof, /LEAST_PRIVILEGE_WRITE_PROOF_OK/);
  assert.match(proof, /AfcManualRecord/i);
  assert.match(proof, /SCHEMA_ID\(N?'staging'\)/i);
  assert.match(proof, /paws schema mutation DENY/i);
  assert.match(proof, /paws_api schema ownership/i);
});

test('B1 AFC route allows GET and POST but keeps other methods at 405', async () => {
  const { app } = harness();
  const list = await app(request('/api/v1/dashboard/afc-records'));
  assert.equal(list.status, 200);
  const created = await app(request('/api/v1/dashboard/afc-records', {
    method: 'POST',
    body: { facultyId: FACULTY_ID, startDate: '2026-10-01', endDate: '2026-10-01', reasonCode: 'vacation', notes: '' }
  }));
  assert.equal(created.status, 201);
  for (const method of ['PUT', 'PATCH', 'DELETE', 'HEAD']) {
    const response = await app(request('/api/v1/dashboard/afc-records', { method }));
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.Allow, 'GET, POST');
  }
});

test('B1 POST validates dates, reason, notes, and ignores client identity fields', async () => {
  const { app, calls } = harness();
  const cases = [
    [{ facultyId: FACULTY_ID, startDate: '2026-02-30', endDate: '2026-03-01', reasonCode: 'vacation' }, 'INVALID_DATE'],
    [{ facultyId: FACULTY_ID, startDate: '2026-03-02', endDate: '2026-03-01', reasonCode: 'vacation' }, 'INVALID_DATE_RANGE'],
    [{ facultyId: FACULTY_ID, startDate: '2026-03-01', endDate: '2026-03-01', reasonCode: 'unknown' }, 'INVALID_REASON'],
    [{ facultyId: FACULTY_ID, startDate: '2026-03-01', endDate: '2026-03-01', reasonCode: 'special', notes: '  ' }, 'NOTES_REQUIRED'],
    [{ facultyId: FACULTY_ID, startDate: '2026-03-01', endDate: '2026-03-01', reasonCode: 'vacation', notes: 'x'.repeat(1001) }, 'NOTES_TOO_LONG']
  ];
  for (const [body, code] of cases) {
    const response = await app(request('/api/v1/dashboard/afc-records', { method: 'POST', body }));
    assert.equal(response.status, 400, code);
    assert.equal(response.jsonBody.error.code, code);
  }
  const response = await app(request('/api/v1/dashboard/afc-records', {
    method: 'POST',
    body: { facultyId: FACULTY_ID, startDate: '2026-03-01', endDate: '2026-03-01', reasonCode: 'vacation', notes: '', actorFirebaseUid: 'evil', actorName: 'Evil', requestId: 'evil', afcRecordId: 'evil' }
  }));
  assert.equal(response.status, 201);
  const [, args] = calls.find(call => call[0] === 'create');
  assert.equal(args.facultyId, FACULTY_ID);
  assert.equal(args.actorFirebaseUid, 'firebase-uid');
  assert.equal(args.actorName, 'Trusted Admin');
  assert.match(args.afcRecordId, /^[0-9a-f-]{36}$/i);
  assert.match(args.requestId, /^[0-9a-f-]{36}$/i);
});

test('B1 AFC list/create are administrator-only', async () => {
  for (const role of ['faculty', 'hicc', 'visc', 'viewer', 'other_office', 'unsupported']) {
    const { app } = harness({ role });
    assert.equal((await app(request('/api/v1/dashboard/afc-records'))).status, 403, role + ' list');
    assert.equal((await app(request('/api/v1/dashboard/afc-records', { method: 'POST', body: {} }))).status, 403, role + ' create');
  }
});

test('B1 write repository and dashboard read repository are separate and bounded', () => {
  const write = fs.readFileSync(path.join(root, 'server', 'src', 'data', 'sql-afc-write-repository.js'), 'utf8');
  const read = fs.readFileSync(path.join(root, 'server', 'src', 'data', 'sql-dashboard-repository.js'), 'utf8');
  assert.match(write, /paws_api\.CreateAfcRecord/);
  assert.doesNotMatch(write, /execute\s*\(\s*sql|INSERT\s+INTO\s+paws\.AfcManualRecord|UPDATE\s+paws|DELETE\s+FROM\s+paws|MERGE\s+/i);
  assert.match(read, /vAfcRecordUnified/);
  assert.match(read, /TOP \(@limit\)/i);
});

test('B1R SQL keeps the ReasonCode vocabulary exact and validates beyond storage width', () => {
  const source = fs.readFileSync(path.join(root, 'database', 'azure-sql', '007_afc_manual_write_foundation.sql'), 'utf8');
  const procedure = source.slice(source.indexOf('CREATE OR ALTER PROCEDURE'));
  assert.match(source, /ReasonCode\s+COLLATE\s+Latin1_General_100_BIN2\s+IN/i);
  assert.match(procedure, /@ReasonCode\s+nvarchar\(128\)/i);
  assert.match(procedure, /@Notes\s+nvarchar\(max\)/i);
  assert.doesNotMatch(procedure, /LOWER\s*\(/i);
  assert.match(procedure, /@ReasonCode\s+COLLATE\s+Latin1_General_100_BIN2\s+NOT IN/i);
  assert.match(procedure, /DATALENGTH\(\@Notes\)\s*\/\s*2\s*>\s*1000/i);
  assert.match(procedure, /@ReasonCode\s+COLLATE\s+Latin1_General_100_BIN2\s+IN\s*\(N'special'/i);
  assert.match(source, /university_travel.*vacation.*rsl.*medical.*mat.*special.*other/s);
});

test('B1R migration and proof fail closed on both schema/object ownership models', () => {
  const migration = fs.readFileSync(path.join(root, 'database', 'azure-sql', '007_afc_manual_write_foundation.sql'), 'utf8');
  const permissions = fs.readFileSync(path.join(root, 'database', 'azure-sql', '007_afc_manual_write_permissions.sql'), 'utf8');
  const proof = fs.readFileSync(path.join(root, 'database', 'azure-sql', '007_afc_manual_write_least_privilege_proof.sql'), 'utf8');
  assert.match(migration, /sys\.schemas[\s\S]*principal_id/i);
  assert.match(migration, /USER_NAME\(principal_id\)\s*<>\s*N'dbo'/i);
  for (const source of [permissions, proof]) {
    assert.match(source, /sys\.schemas[\s\S]*principal_id/i);
    assert.match(source, /sys\.objects[\s\S]*principal_id/i);
    assert.match(source, /USER_NAME\(principal_id\)\s*<>\s*N'dbo'/i);
  }
  assert.doesNotMatch(proof, /sys\.database_principals[\s\S]{0,160}owning_principal_id/i);
  assert.match(migration, /schema must be owned by dbo/i);
  assert.match(permissions, /All guards above execute before either new B1 GRANT/i);
  assert.ok(permissions.indexOf('GRANT SELECT ON OBJECT::paws.vAfcRecordUnified') > permissions.indexOf('All guards above execute before either new B1 GRANT'));
});

test('B1R permission scripts reject unexpected grants before exact post-state grants', () => {
  const permissions = fs.readFileSync(path.join(root, 'database', 'azure-sql', '007_afc_manual_write_permissions.sql'), 'utf8');
  const proof = fs.readFileSync(path.join(root, 'database', 'azure-sql', '007_afc_manual_write_least_privilege_proof.sql'), 'utf8');
  for (const source of [permissions, proof]) {
    assert.match(source, /database-level permission/i);
    assert.match(source, /schema-level permission/i);
    assert.match(source, /object (?:write|mutation|execute)/i);
    assert.match(source, /public[\s\S]*paws_api[\s\S]*staging/i);
    assert.match(source, /database_role_members/i);
    assert.match(source, /schema_id\s*\(N?'paws'\)/i);
    assert.match(source, /schema_id\s*\(N?'staging'\)/i);
    assert.match(source, /paws_api\.CreateAfcRecord/i);
  }
  assert.match(proof, /LEAST_PRIVILEGE_WRITE_PROOF_OK/);
  assert.match(proof, /permission_name\s+IN\s*\(N'INSERT',\s*N'UPDATE',\s*N'DELETE'/i);
  assert.match(proof, /permission_name\s*=\s*N'EXECUTE'/i);
});

test('B1R admin AFC list preserves inactive Faculty history while creation stays active-only', () => {
  const source = fs.readFileSync(path.join(root, 'server', 'src', 'data', 'sql-dashboard-repository.js'), 'utf8');
  const listStart = source.indexOf('async listAfcRecords');
  const listEnd = source.indexOf('\n    },', listStart);
  const list = source.slice(listStart, listEnd);
  assert.doesNotMatch(list, /f\.Active\s*=\s*1/i);
  assert.match(list, /INNER JOIN paws\.Faculty f ON f\.FacultyId = u\.FacultyId/i);
  const migration = fs.readFileSync(path.join(root, 'database', 'azure-sql', '007_afc_manual_write_foundation.sql'), 'utf8');
  const procedure = migration.slice(migration.indexOf('CREATE OR ALTER PROCEDURE'));
  assert.match(procedure, /f\.FacultyId\s*=\s*\@FacultyId[\s\S]*f\.Active\s*=\s*1/i);
});

test('B1R procedure response is captured in-transaction and has no post-commit business read', () => {
  const source = fs.readFileSync(path.join(root, 'database', 'azure-sql', '007_afc_manual_write_foundation.sql'), 'utf8');
  const procedure = source.slice(source.indexOf('CREATE OR ALTER PROCEDURE'));
  const commit = procedure.indexOf('COMMIT TRANSACTION;');
  assert.ok(commit > 0);
  const afterCommit = procedure.slice(commit);
  assert.doesNotMatch(afterCommit, /FROM\s+paws\.(?:vAfcRecordUnified|AfcManualRecord|Faculty)/i);
  assert.match(afterCommit, /\@FacultyName\s+AS\s+facultyName/i);
  assert.match(afterCommit, /CAST\(N'manual'\s+AS\s+nvarchar\(16\)\)\s+AS\s+sourceKind/i);
  assert.match(procedure, /BEGIN TRANSACTION[\s\S]*SELECT\s+\@FacultyName\s*=\s*f\.DisplayName[\s\S]*AfcManualRecord[\s\S]*AuditEvent[\s\S]*COMMIT TRANSACTION/i);
});

// ---------------------------------------------------------------------------
// B1D-R — unfiltered AFC list must not emit an empty WHERE clause.
//
// The reviewed acceptance call is GET /api/v1/dashboard/afc-records?limit=2000
// with no search/reason/active filter. Before the hotfix the repository always
// interpolated `WHERE ${predicates.join(' AND ')}`, so an unfiltered request
// produced `WHERE  ORDER BY ...` -> SQL syntax error -> HTTP 503.
// ---------------------------------------------------------------------------

function afcQueryAdapter(rows = []) {
  const seen = [];
  return {
    seen,
    db: { query: async (sql, params) => { seen.push({ sql, params }); return rows; } }
  };
}

test('B1D-R unfiltered AFC list emits no empty WHERE clause and binds only the limit', async () => {
  const adapter = afcQueryAdapter([]);
  const repository = createSqlDashboardRepository(adapter.db);
  await repository.listAfcRecords({ limit: 2000 });

  assert.equal(adapter.seen.length, 1, 'exactly one statement must be issued');
  const { sql, params } = adapter.seen[0];

  assert.match(sql, /FROM paws\.vAfcRecordUnified u/);
  assert.match(sql, /INNER JOIN paws\.Faculty f ON f\.FacultyId = u\.FacultyId/);
  assert.match(sql, /ORDER BY u\.StartDate DESC, f\.DisplayName, u\.AfcRecordId/);
  // The defect: the unfiltered statement contained a bare WHERE token.
  assert.doesNotMatch(sql, /\bWHERE\b/i, 'an unfiltered list must not emit a WHERE clause');
  assert.doesNotMatch(sql, /WHERE\s+ORDER\s+BY/i);
  // No fabricated business predicate (historical rows stay readable).
  assert.doesNotMatch(sql, /u\.Active\s*=\s*1|f\.Active\s*=\s*1/i);
  assert.deepEqual(params, { limit: 2000 });
});

test('B1D-R unfiltered AFC list still maps every DTO field from an imported row', async () => {
  const row = {
    afcRecordId: 'a-1',
    facultyId: FACULTY_ID,
    facultyName: 'Ada One',
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    reasonCode: null,
    reason: 'Vacation',
    notes: null,
    legacyPurpose: 'Vacation',
    active: true,
    sourceKind: 'import',
    createdAtUtc: null,
    createdByName: null,
    recordKey: 'import:a-1'
  };
  const adapter = afcQueryAdapter([row]);
  const records = await createSqlDashboardRepository(adapter.db).listAfcRecords({ limit: 2000 });

  assert.equal(records.length, 1);
  assert.equal(records[0].afcRecordId, 'a-1');
  assert.equal(records[0].facultyId, FACULTY_ID);
  assert.equal(records[0].facultyName, 'Ada One');
  assert.equal(records[0].startDate, '2026-10-01');
  assert.equal(records[0].endDate, '2026-10-05');
  assert.equal(records[0].reason, 'Vacation');
  assert.equal(records[0].active, true);
  assert.equal(records[0].sourceKind, 'import');
  assert.equal(records[0].recordKey, 'import:a-1');
});

test('B1D-R filtered AFC list keeps a parameterized WHERE and the same ORDER BY', async () => {
  const activeAdapter = afcQueryAdapter([]);
  await createSqlDashboardRepository(activeAdapter.db).listAfcRecords({ limit: 2000, active: true });
  const activeQuery = activeAdapter.seen[0];
  assert.match(activeQuery.sql, /WHERE u\.Active = \@active/);
  assert.match(activeQuery.sql, /ORDER BY u\.StartDate DESC/);
  assert.equal(activeQuery.params.active, true);
  assert.equal(activeQuery.params.limit, 2000);

  const reasonAdapter = afcQueryAdapter([]);
  await createSqlDashboardRepository(reasonAdapter.db).listAfcRecords({ limit: 10, reason: 'vacation' });
  const reasonQuery = reasonAdapter.seen[0];
  assert.match(reasonQuery.sql, /WHERE \(u\.ReasonCode = \@reason OR/);
  assert.match(reasonQuery.sql, /ORDER BY u\.StartDate DESC/);
  assert.equal(reasonQuery.params.reason, 'vacation');
  assert.equal(reasonQuery.params.limit, 10);

  const searchAdapter = afcQueryAdapter([]);
  await createSqlDashboardRepository(searchAdapter.db).listAfcRecords({ search: '100%' });
  const searchQuery = searchAdapter.seen[0];
  assert.match(searchQuery.sql, /WHERE \(f\.DisplayName LIKE \@search/);
  assert.match(searchQuery.sql, /ORDER BY u\.StartDate DESC/);
  assert.equal(typeof searchQuery.params.search, 'string', 'search stays parameterized');
  assert.ok(!searchQuery.sql.includes('100%'), 'user input must never be interpolated into SQL');
  assert.equal(searchQuery.params.limit, 2000, 'the 2000 bound is unchanged');
});
