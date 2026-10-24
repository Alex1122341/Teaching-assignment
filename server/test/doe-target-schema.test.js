'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const forward = fs.readFileSync(path.join(root, 'database', 'azure-sql', '008_doe_faculty_target_foundation.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'database', 'azure-sql', '008_doe_faculty_target_foundation_rollback.sql'), 'utf8');

test('DOE target schema keeps contract values empty-capable and derives the effective value', () => {
  assert.match(forward, /ContractTeachingDoe\s+decimal\s*\(12,\s*6\)\s+NULL/i);
  assert.match(forward, /EffectiveTargetDoe\s+AS\s+COALESCE\s*\(\s*OverrideDoe\s*,\s*ContractTeachingDoe\s*\)\s+PERSISTED/i);
  assert.doesNotMatch(forward, /ContractTeachingDoe\s+decimal\s*\(12,\s*6\)[^,\n]*DEFAULT/i);
});

test('DDL declares the required computed-column and filtered-index SET options before opening the transaction', () => {
  const setup = forward.slice(0, forward.indexOf('BEGIN TRY'));
  for (const option of ['ANSI_NULLS', 'ANSI_PADDING', 'ANSI_WARNINGS', 'ARITHABORT', 'CONCAT_NULL_YIELDS_NULL', 'QUOTED_IDENTIFIER']) {
    assert.ok(new RegExp('SET\\s+' + option + '\\s+ON', 'i').test(setup), option + ' must be ON before DDL');
  }
  assert.ok(setup.toUpperCase().includes('SET NUMERIC_ROUNDABORT OFF'));
});

test('DOE target schema is year-scoped, faculty-linked, and has one active row per faculty/year', () => {
  assert.match(forward, /CREATE TABLE\s+paws\.DoeFacultyTarget/i);
  assert.match(forward, /FOREIGN KEY\s*\(\s*FacultyId\s*\)\s*REFERENCES\s+paws\.Faculty\s*\(\s*FacultyId\s*\)/i);
  assert.match(forward, /AcademicYear[^\n]*LIKE\s+'\[1-9\]\[0-9\]\[0-9\]\[0-9\]-\[0-9\]\[0-9\]'/i);
  assert.match(forward, /UNIQUE\s+INDEX[^;]+DoeFacultyTarget[^;]+FacultyId[^;]+AcademicYear[^;]+WHERE\s+Active\s*=\s*1/is);
});

test('DOE policy version reference enforces matching academic year', () => {
  assert.match(forward, /CREATE TABLE\s+paws\.DoePolicyVersion/i);
  assert.match(forward, /FOREIGN KEY\s*\(\s*PolicyVersionId\s*,\s*AcademicYear\s*\)\s*REFERENCES\s+paws\.DoePolicyVersion\s*\(\s*PolicyVersionId\s*,\s*AcademicYear\s*\)/i);
});

test('override data requires a reason and no business values or grants are part of the migration', () => {
  assert.match(forward, /OverrideDoe\s+IS\s+NOT\s+NULL[^;]+OverrideReason/is);
  assert.doesNotMatch(forward, /^\s*(INSERT|UPDATE|DELETE|GRANT)\b/im);
});

test('rollback refuses populated objects and drops only the exact new DOE tables in dependency order', () => {
  assert.match(rollback, /DoeFacultyTarget[^;]+COUNT_BIG/i);
  assert.match(rollback, /DoePolicyVersion[^;]+COUNT_BIG/i);
  assert.ok(rollback.indexOf('DROP TABLE paws.DoeFacultyTarget') < rollback.indexOf('DROP TABLE paws.DoePolicyVersion'));
  assert.doesNotMatch(rollback, /DROP\s+SCHEMA|DROP\s+DATABASE/i);
});
