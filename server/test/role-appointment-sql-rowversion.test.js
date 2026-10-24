'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'server/src/data/sql-dashboard-repository.js'), 'utf8');
const existing = fs.readFileSync(path.join(root, 'database/azure-sql/035_role_appointment_periods.sql'), 'utf8');
const newMigration = path.join(root, 'database/azure-sql/058_role_appointment_rowversion_hex.sql');

function procedure(text) {
  const match = /CREATE OR ALTER PROCEDURE paws_api\.SetRoleAppointmentPeriods[\s\S]*?\r?\nGO\b/i.exec(text);
  assert.ok(match, 'Role Period SQL procedure must exist');
  return match[0].replace(/\r\n/g, '\n');
}

test('both SQL Dashboard Role and Appointment projections emit 18-character hex rather than raw rowversion bytes', () => {
  const expected = /CONVERT\(varchar\(18\),\s*CONVERT\(varbinary\(8\),\s*rs\.ScheduleVersion\),\s*1\) AS scheduleVersion/g;
  assert.equal([...source.matchAll(expected)].length, 2);
  assert.doesNotMatch(source, /CONVERT\(varchar\(18\),\s*rs\.ScheduleVersion,\s*1\)/);
});

test('new additive migration changes only the two version encodings inside accepted SQL procedure', () => {
  assert.equal(fs.existsSync(newMigration), true, 'Add an idempotent 058 migration; do not rewrite previously applied 035');
  const changed = procedure(fs.readFileSync(newMigration, 'utf8'));
  const prior = procedure(existing);
  const broken = 'CONVERT(varchar(18),ScheduleVersion,1)';
  assert.equal(prior.split(broken).length - 1, 2, 'The original procedure has exactly two unsafe conversions');
  const expected = prior.split(broken).join('CONVERT(varchar(18),CONVERT(varbinary(8),ScheduleVersion),1)');
  assert.equal(changed, expected, 'Keep auth, locking, SQL rowversion compare, grants, audit and dates unchanged');
});

test('verified SQL patch keeps optimistic concurrency check and no data resets', () => {
  if (!fs.existsSync(newMigration)) {
    assert.fail('Missing immutable corrective SQL migration');
  }
  const sql = fs.readFileSync(newMigration, 'utf8');
  assert.match(sql, /@version\s*<>\s*@ExpectedVersion/);
  assert.match(sql, /WITH\(UPDLOCK,HOLDLOCK\)/);
  assert.match(sql, /THROW 53509/);
  assert.match(sql, /paws\.AuditEvent/);
  assert.doesNotMatch(sql, /\b(?:ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM\s+paws\.RoleAssignment)\b/i);
});

test('SQLCMD batch terminator is a standalone GO line before CREATE OR ALTER', () => {
  const sql = fs.readFileSync(newMigration, 'utf8');
  assert.match(sql, /\r?\nGO\r?\nCREATE OR ALTER PROCEDURE paws_api\.SetRoleAppointmentPeriods\b/);
  assert.doesNotMatch(sql, /GOCREATE OR ALTER/i);
});