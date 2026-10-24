'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDashboardApi, validateAfcBatchInput } = require('../src/data/dashboard-api');
const { createDashboardFunctions } = require('../src/runtime/swa-dashboard-functions');
const { createSqlAfcWriteRepository } = require('../src/data/sql-afc-write-repository');

const FACULTY_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const ROW = { facultyId: FACULTY_ID, startDate: '2026-10-01', endDate: '2026-10-02', purpose: 'CCC Day' };

function makeApi({ role = 'adfa_general', batchResult = null, writeGates = { afcSingle: true, afcBatch: true } } = {}) {
  const calls = [];
  const api = createDashboardApi({
    verifyToken: async () => ({ uid: 'trusted-uid' }),
    findUser: async () => ({ active: true, mustChangePassword: false, baseRole: role, facultyId: ['faculty', 'hicc', 'visc'].includes(role) ? FACULTY_ID : null, displayName: 'Trusted admin' }),
    repository: {},
    writeGates,
    writeRepository: {
      createAfcManualBatch: async input => { calls.push(input); return batchResult || { status: 'CREATED', rows: [{ rowIndex: 0, afcRecordId: '44444444-4444-4444-8444-444444444444', purpose: ROW.purpose, status: 'CREATED' }] }; }
    }
  });
  return { api, calls };
}

test('AFC batch fails closed by default before invoking its write repository', async () => {
  let writes = 0;
  const api = createDashboardApi({
    verifyToken: async () => ({ uid: 'trusted-uid' }),
    findUser: async () => ({ active: true, mustChangePassword: false, baseRole: 'adfa_general' }),
    repository: {},
    writeRepository: { createAfcManualBatch: async () => { writes++; } }
  });
  const response = await api.createAfcManualBatch('token-secret', { requestId: REQUEST_ID, rows: [ROW] });
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'WRITE_DISABLED');
  assert.equal(writes, 0);
  assert.doesNotMatch(JSON.stringify(response), /token-secret|trusted-uid/);
});

test('AFC batch does not let the enabled gate bypass server-side admin authorization', async () => {
  const { api, calls } = makeApi({ role: 'faculty' });
  const response = await api.createAfcManualBatch('token', { requestId: REQUEST_ID, rows: [ROW] });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'ROLE_DENIED');
  assert.equal(calls.length, 0);
});

test('AFC batch accepts arbitrary exact Purpose without requiring an internal ReasonCode', () => {
  const result = validateAfcBatchInput({ requestId: REQUEST_ID, rows: [ROW] });
  assert.deepEqual(result, { requestId: REQUEST_ID, rows: [{ ...ROW, rowIndex: 0 }] });
  assert.equal(result.rows[0].purpose, 'CCC Day');
});

test('AFC batch accepts exactly 20 rows and preserves Purpose byte-for-byte at the API boundary', () => {
  const purpose = 'Clinical Day / PPVM (external) — Course: VETM 701';
  const rows = Array.from({ length: 20 }, (_, rowIndex) => ({
    ...ROW,
    facultyId: FACULTY_ID,
    startDate: `2026-10-${String(rowIndex + 1).padStart(2, '0')}`,
    endDate: `2026-10-${String(rowIndex + 1).padStart(2, '0')}`,
    purpose
  }));
  const result = validateAfcBatchInput({ requestId: REQUEST_ID, rows });
  assert.equal(result.rows.length, 20);
  assert.ok(result.rows.every(row => row.purpose === purpose));
});

test('AFC batch reports missing faculty, missing dates, reversed dates, and missing Purpose by row', () => {
  const result = validateAfcBatchInput({ requestId: REQUEST_ID, rows: [
    { ...ROW, facultyId: '', startDate: '', endDate: '', purpose: '' },
    { ...ROW, startDate: '2026-10-03', endDate: '2026-10-01' }
  ] });
  assert.equal(result.status, 400);
  assert.deepEqual(result.body.rows.map(row => row.rowIndex), [0, 1]);
  assert.deepEqual(result.body.rows[0].errors.sort(), ['FACULTY_REQUIRED', 'INVALID_DATE', 'PURPOSE_REQUIRED']);
  assert.deepEqual(result.body.rows[1].errors, ['END_BEFORE_START']);
});

test('AFC batch rejects empty and overlength Purpose before any repository write', async () => {
  for (const purpose of ['', ' '.repeat(2), 'x'.repeat(1001)]) {
    const { api, calls } = makeApi();
    const response = await api.createAfcManualBatch('token', { requestId: REQUEST_ID, rows: [{ ...ROW, purpose }] });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'AFC_BATCH_INVALID');
    assert.equal(calls.length, 0);
  }
});

test('AFC batch returns row-indexed validation errors and enforces max 20 before repository mutation', () => {
  const invalid = validateAfcBatchInput({ requestId: REQUEST_ID, rows: [ROW, { ...ROW, endDate: '2026-09-01', purpose: ' ' }] });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'AFC_BATCH_INVALID');
  assert.deepEqual(invalid.body.rows.map(row => row.rowIndex), [1]);
  assert.deepEqual(invalid.body.rows[0].errors.sort(), ['END_BEFORE_START', 'PURPOSE_REQUIRED']);
  const tooMany = validateAfcBatchInput({ requestId: REQUEST_ID, rows: Array.from({ length: 21 }, () => ROW) });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.error.code, 'AFC_BATCH_TOO_LARGE');
});

test('AFC batch rejects duplicate business rows inside the request without writing', async () => {
  const { api, calls } = makeApi();
  const response = await api.createAfcManualBatch('token', { requestId: REQUEST_ID, rows: [ROW, ROW] });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'AFC_BATCH_DUPLICATE');
  assert.equal(response.body.rows[0].rowIndex, 1);
  assert.equal(response.body.rows[0].status, 'CONFLICT');
  assert.equal(calls.length, 0);
});

test('AFC batch authorizes the server profile before calling the write repository', async () => {
  const { api, calls } = makeApi({ role: 'faculty' });
  const response = await api.createAfcManualBatch('token', { requestId: REQUEST_ID, rows: [ROW] });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'ROLE_DENIED');
  assert.equal(calls.length, 0);
});

test('AFC batch allows both ADFAD internal roles and denies Faculty, HICC, VISC, and inactive profiles', async () => {
  for (const role of ['developer', 'adfa_general', 'adfa_regular']) {
    const { api, calls } = makeApi({ role });
    const response = await api.createAfcManualBatch('token', { requestId: REQUEST_ID, rows: [ROW] });
    assert.equal(response.status, 201, role);
    assert.equal(calls.length, 1, role);
  }
  for (const role of ['faculty', 'hicc', 'visc']) {
    const { api, calls } = makeApi({ role });
    const response = await api.createAfcManualBatch('token', { requestId: REQUEST_ID, rows: [ROW] });
    assert.equal(response.status, 403, role);
    assert.equal(response.body.error.code, 'ROLE_DENIED', role);
    assert.equal(calls.length, 0, role);
  }
  let writes = 0;
  const api = createDashboardApi({
    verifyToken: async () => ({ uid: 'trusted-uid' }),
    findUser: async () => ({ active: false, baseRole: 'adfa_general' }),
    repository: {},
    writeRepository: { createAfcManualBatch: async () => { writes += 1; } }
  });
  const inactive = await api.createAfcManualBatch('token', { requestId: REQUEST_ID, rows: [ROW] });
  assert.equal(inactive.status, 403);
  assert.equal(inactive.body.error.code, 'PROFILE_REQUIRED');
  assert.equal(writes, 0);
});

test('AFC batch derives actor from authenticated SQL profile and maps repository duplicate outcomes', async () => {
  const { api, calls } = makeApi({ batchResult: { status: 'CONFLICT', rows: [{ rowIndex: 0, status: 'ALREADY_EXISTS' }] } });
  const response = await api.createAfcManualBatch('token', { requestId: REQUEST_ID, rows: [ROW], actorFirebaseUid: 'forged', actorName: 'forged' });
  assert.equal(response.status, 409);
  assert.equal(response.body.rows[0].status, 'ALREADY_EXISTS');
  assert.equal(calls[0].actorFirebaseUid, 'trusted-uid');
  assert.equal(calls[0].actorName, 'Trusted admin');
  assert.equal(calls[0].requestId, REQUEST_ID);
  assert.equal(calls[0].rows[0].purpose, ROW.purpose);
});

test('AFC batch maps a repeat RequestId to a stable successful replay without new rows', async () => {
  const { api, calls } = makeApi({ batchResult: { status: 'ALREADY_APPLIED', rows: [{ rowIndex: 0, status: 'ALREADY_APPLIED' }] } });
  const response = await api.createAfcManualBatch('token', { requestId: REQUEST_ID, rows: [ROW] });
  assert.equal(response.status, 200);
  assert.equal(response.body.idempotentReplay, true);
  assert.equal(response.body.rows[0].status, 'ALREADY_APPLIED');
  assert.equal(calls.length, 1);
});

test('AFC batch HTTP route is a dedicated POST and does not expose other methods', async () => {
  const { api, calls } = makeApi();
  const app = createDashboardFunctions({ api });
  const post = await app({ method: 'POST', url: 'https://local/api/v1/dashboard/afc-records/batch', headers: { get: () => 'Bearer token' }, json: async () => ({ requestId: REQUEST_ID, rows: [ROW] }) });
  assert.equal(post.status, 201);
  const get = await app({ method: 'GET', url: 'https://local/api/v1/dashboard/afc-records/batch', headers: { get: () => 'Bearer token' } });
  assert.equal(get.status, 405);
  assert.equal(get.headers.Allow, 'POST');
  const put = await app({ method: 'PUT', url: 'https://local/api/v1/dashboard/afc-records/batch', headers: { get: () => 'Bearer token' } });
  assert.equal(put.status, 405);
  assert.equal(put.headers.Allow, 'POST');
  assert.equal(calls.length, 1, 'GET and unsupported verbs must not invoke the write repository');
});

test('AFC SQL batch repository calls one fixed stored procedure with a bounded JSON payload', async () => {
  const calls = [];
  const repository = createSqlAfcWriteRepository({ query: async (sql, params) => { calls.push({ sql, params }); return [{ batchStatus: 'CREATED' }]; } });
  const result = await repository.createAfcManualBatch({ requestId: REQUEST_ID, rows: [{ ...ROW, rowIndex: 0 }], actorFirebaseUid: 'uid', actorName: 'Admin' });
  assert.equal(result.status, 'CREATED');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /paws_api\.CreateAfcManualBatch/);
  assert.deepEqual(JSON.parse(calls[0].params.rowsJson), [{ rowIndex: 0, facultyId: FACULTY_ID, startDate: ROW.startDate, endDate: ROW.endDate, purpose: ROW.purpose }]);
  assert.doesNotMatch(calls[0].sql, /INSERT\s+INTO\s+paws\.|UPDATE\s+paws\.|DELETE\s+FROM\s+paws\./i);
});

test('AFC batch SQL artifact stores exact Purpose, serializes batch writes, and audits each row in one transaction', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../database/azure-sql/015_afc_manual_batch.sql'), 'utf8');
  assert.match(sql, /ManualPurpose nvarchar\(1000\) NULL/);
  assert.match(sql, /BatchRequestId uniqueidentifier NULL/);
  assert.match(sql, /CREATE OR ALTER PROCEDURE paws_api\.CreateAfcManualBatch/);
  assert.match(sql, /sp_getapplock[\s\S]*@LockMode = N'Exclusive'[\s\S]*@LockOwner = N'Transaction'/);
  assert.match(sql, /BEGIN TRANSACTION[\s\S]*INSERT paws\.AfcManualRecord[\s\S]*INSERT paws\.AuditEvent[\s\S]*COMMIT TRANSACTION/);
  assert.match(sql, /N'afc_record_created'/);
  assert.match(sql, /N'multi_input'/);
  assert.match(sql, /BatchPayloadHash/);
  const procedureStart = sql.indexOf('CREATE OR ALTER PROCEDURE paws_api.CreateAfcManualBatch');
  const procedureEnd = sql.indexOf('\nGO', procedureStart);
  const procedure = sql.slice(procedureStart, procedureEnd);
  assert.doesNotMatch(procedure, /EXEC\s*\(\s*@|sp_executesql/i);
});

test('AFC migration 015 accepts only the verified temporary Beta principal and never widens its pre-existing role access', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../database/azure-sql/015_afc_manual_batch.sql'), 'utf8');
  assert.match(sql, /UC\\sa-xinyu\.zhu1/);
  assert.match(sql, /THROW 51520[\s\S]*database user does not exist/i);
  assert.match(sql, /THROW 51521[\s\S]*verified temporary Beta runtime principal/i);
  assert.doesNotMatch(sql, /sys\.database_role_members[\s\S]{0,180}THROW 51521/i);
  assert.match(sql, /TEMPORARY BETA SECURITY DEBT[\s\S]*db_owner/i);
  assert.match(sql, /WITH RuntimePrincipals AS[\s\S]*sys\.database_role_members[\s\S]*role_principal\.name = N'db_owner'/i);
  assert.match(sql, /permission_entry\.state = 'D'[\s\S]*THROW 51524/i);
  assert.match(sql, /permission_entry\.state IN \('G', 'W'\)[\s\S]*permission_entry\.permission_name IN \(N'EXECUTE', N'CONTROL'\)/i);
  assert.match(sql, /IF\s+@RuntimeCanExecute\s*=\s*0[\s\S]*GRANT EXECUTE ON OBJECT::paws_api\.CreateAfcManualBatch/i);
  assert.doesNotMatch(sql, /ALTER\s+ROLE|sp_addrolemember|IS_ROLEMEMBER|EXECUTE AS USER|GRANT\s+(?:INSERT|UPDATE|DELETE|CONTROL)\b|GRANT\s+EXECUTE\s+ON\s+SCHEMA::/i);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON OBJECT::paws_api\.CreateAfcManualBatch TO \[\$\(PAWS_API_PRINCIPAL\)\];\s*GO\s*$/i);
});

test('AFC migration 015 permission check fails closed when the runtime effective permission is unknown', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../database/azure-sql/015_afc_manual_batch.sql'), 'utf8');
  assert.match(sql, /@BatchProcedureId\s+IS\s+NULL[\s\S]*THROW 51523/i);
  assert.match(sql, /@RuntimeCanExecute\s+IS\s+NULL[\s\S]*THROW 51525/i);
  assert.match(sql, /IF\s+@RuntimeCanExecute\s*=\s*0[\s\S]*GRANT EXECUTE ON OBJECT::paws_api\.CreateAfcManualBatch/i);
});

test('AFC migration 015 remains additive, data-preserving, and safe to re-apply before acceptance data exists', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../database/azure-sql/015_afc_manual_batch.sql'), 'utf8');
  assert.match(sql, /COL_LENGTH\(N'paws\.AfcManualRecord', N'ManualPurpose'\) IS NULL[\s\S]*ALTER TABLE paws\.AfcManualRecord ADD ManualPurpose/i);
  assert.match(sql, /CREATE OR ALTER VIEW paws\.vAfcRecordUnified/);
  assert.match(sql, /CREATE OR ALTER PROCEDURE paws_api\.CreateAfcManualBatch/);
  assert.match(sql, /IF NOT EXISTS\s*\([\s\S]*UX_AfcManualRecord_BatchRequestRow[\s\S]*CREATE UNIQUE INDEX UX_AfcManualRecord_BatchRequestRow/i);
  assert.doesNotMatch(sql, /\b(?:DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE)\s+paws\.(?:AfcRecord|AfcManualRecord)\b/i);
  assert.match(sql, /ReasonCode nvarchar\(32\) NULL/);
});

test('AFC migration 015 defers references to newly-added columns until SQL Server compiles them', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../database/azure-sql/015_afc_manual_batch.sql'), 'utf8');
  assert.match(sql, /SET QUOTED_IDENTIFIER ON;[\s\S]*SET NUMERIC_ROUNDABORT OFF;/i);
  assert.match(sql, /EXEC\s+sys\.sp_executesql\s+N'[\s\S]*CK_AfcManualRecord_PurposeMode/);
  assert.match(sql, /EXEC\s+sys\.sp_executesql\s+N'[\s\S]*CK_AfcManualRecord_BatchKey/);
  assert.match(sql, /EXEC\s+sys\.sp_executesql\s+N'CREATE UNIQUE INDEX UX_AfcManualRecord_BatchRequestRow/);
  const firstBatch = sql.split(/\nGO\b/i, 1)[0];
  const staticSql = firstBatch.replace(/EXEC\s+sys\.sp_executesql\s+N'[\s\S]*?';/gi, '');
  assert.doesNotMatch(staticSql, /ALTER TABLE paws\.AfcManualRecord WITH CHECK ADD CONSTRAINT CK_AfcManualRecord_PurposeMode/i);
  assert.doesNotMatch(staticSql, /ALTER TABLE paws\.AfcManualRecord WITH CHECK ADD CONSTRAINT CK_AfcManualRecord_BatchKey/i);
  assert.doesNotMatch(staticSql, /CREATE UNIQUE INDEX UX_AfcManualRecord_BatchRequestRow/i);
});

test('AFC unified view preserves imported Purpose, exact manual Purpose, and legacy reason display', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../database/azure-sql/015_afc_manual_batch.sql'), 'utf8');
  assert.match(sql, /a\.Purpose AS Purpose[\s\S]*CAST\(N'import' AS nvarchar\(16\)\) AS SourceKind/);
  assert.match(sql, /COALESCE\(m\.ManualPurpose, CASE m\.ReasonCode[\s\S]*CAST\(N'manual' AS nvarchar\(16\)\) AS SourceKind/);
  assert.match(sql, /WHEN N'university_travel' THEN N'University Travel'/);
  assert.match(sql, /WHEN N'other' THEN N'Other'/);
  assert.match(sql, /u\.Purpose COLLATE Latin1_General_100_BIN2/);
});

test('AFC batch rollback refuses absent or incomplete migration state before querying batch columns', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../database/azure-sql/rollback_015_afc_manual_batch.sql'), 'utf8');
  assert.match(sql, /COL_LENGTH\(N'paws\.AfcManualRecord', N'BatchRequestId'\) IS NULL[\s\S]*THROW 51536/);
  assert.match(sql, /sp_executesql[\s\S]*BatchRequestId IS NOT NULL OR ManualPurpose IS NOT NULL/);
  assert.match(sql, /IF OBJECT_ID\(N'paws_api\.CreateAfcManualBatch', N'P'\) IS NOT NULL[\s\S]*REVOKE EXECUTE/);
  assert.match(sql, /Rollback refused because manual-purpose batch data exists/);
});
