'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '../../database/azure-sql/019_session_create_and_assignment_api.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(__dirname, '../../database/azure-sql/rollback_019_session_create_and_assignment_api.sql'), 'utf8');

test('migration 019 is guarded, bounded, audited, transactional and uses fixed stored procedures', () => {
  assert.match(migration, /DB_NAME\(\)\s*<>\s*N'VetMed-Ops'/i);
  for (const object of ['ValidateCalendarSessionJson', 'CreateCalendarSession', 'CreateCalendarSessionBatch', 'ReplaceCalendarSessionAssignments', 'SessionBatchRequest']) {
    assert.match(migration, new RegExp(`OBJECT_ID\\(N'paws_api\\.${object}'`, 'i'));
  }
  assert.match(migration, /LEFT\(LTRIM\(@SessionsJson\),\s*1\)\s*<>\s*N'\['/i);
  assert.match(migration, /COUNT\(\*\) FROM @Rows\) > 200/i);
  assert.match(migration, /PayloadSha256/);
  assert.match(migration, /UPDLOCK, HOLDLOCK/);
  assert.match(migration, /AuditEvent/i);
  assert.match(migration, /BEGIN TRANSACTION/i);
  assert.match(migration, /IF XACT_STATE\(\) <> 0 ROLLBACK TRANSACTION/i);
  assert.doesNotMatch(migration, /\bEXEC(?:UTE)?\s*\(\s*N?['"+@]/i);
  assert.doesNotMatch(migration, /\bGRANT\s+(?:INSERT|UPDATE|DELETE|CONTROL)\b/i);
});

test('migration 019 validates canonical active Faculty assignments and refuses recorded-DOE removals', () => {
  assert.match(migration, /faculty\.FacultyId\s*=\s*assignment\.FacultyId\s+AND\s+faculty\.Active\s*=\s*1/i);
  assert.match(migration, /existing\.FacultyId IS NULL OR existing\.FacultyResolutionStatus <> N'resolved' OR existing\.SourceFacultyName IS NOT NULL/i);
  assert.match(migration, /existing\.CreditedHours IS NOT NULL OR existing\.DoeRate IS NOT NULL/i);
  assert.match(migration, /THROW 51262/i);
  assert.match(migration, /THROW 51263/i);
  assert.match(migration, /N'Needs Review'/);
  assert.match(migration, /ActorFirebaseUid/);
  assert.match(migration, /ActorName/);
});

test('batch procedure avoids nested resultsets and returns an index for canonical conflicts', () => {
  assert.match(migration, /@ReturnSession bit = 1/i);
  assert.match(migration, /@ReturnSession = 0/i);
  assert.match(migration, /CONCAT\(N'Batch row ',\s*@ConflictRow/i);
  assert.match(migration, /ORDER BY row\.RowNumber/i);
  assert.match(migration, /AS \[rowCount\]/i);
});

test('migration DDL is atomic across SQLCMD batch separators', () => {
  assert.match(migration, /BEGIN TRANSACTION;[\s\S]*?CREATE TABLE paws_api\.SessionBatchRequest/i);
  assert.match(migration, /CREATE PROCEDURE paws_api\.ReplaceCalendarSessionAssignments[\s\S]*?GO\s*\n(?:\s*--[^\n]*\n)*\s*COMMIT TRANSACTION;/i);
});

test('rollback 019 refuses to remove objects after P1 data or idempotency receipts exist', () => {
  assert.match(rollback, /DB_NAME\(\)\s*<>\s*N'VetMed-Ops'/i);
  assert.match(rollback, /ImporterVersion IN \(N'paws-api-p1-019'/);
  assert.match(rollback, /EXISTS \(SELECT 1 FROM paws_api\.SessionBatchRequest\)/i);
  assert.match(rollback, /THROW 51912/i);
  assert.match(rollback, /IF OBJECT_ID\(N'paws_api\.ReplaceCalendarSessionAssignments', N'P'\) IS NOT NULL\s+DROP PROCEDURE/i);
  assert.match(rollback, /IF OBJECT_ID\(N'paws_api\.SessionBatchRequest', N'U'\) IS NOT NULL\s+DROP TABLE/i);
  assert.doesNotMatch(rollback, /\bDELETE\s+FROM\s+paws\.(?:Session|SessionAssignment|AuditEvent)/i);
  assert.doesNotMatch(rollback, /\bDROP\s+(?:TABLE|PROCEDURE)\s+(?:paws\.|staging\.)/i);
});

test('rollback 019 can recover an empty partial DDL migration without touching business data', () => {
  assert.doesNotMatch(rollback, /requires the complete migration object set/i);
  assert.match(rollback, /OBJECT_ID\(N'paws_api\.SessionBatchRequest', N'U'\) IS NOT NULL[\s\S]*?EXISTS \(SELECT 1 FROM paws_api\.SessionBatchRequest\)/i);
  assert.match(rollback, /BEGIN TRANSACTION[\s\S]*?COMMIT TRANSACTION/i);
  assert.match(rollback, /paws-api-p1-019-assignments/i);
  assert.match(migration, /AS \[rowCount\]/i);
});
