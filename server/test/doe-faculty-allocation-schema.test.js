'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const forward = fs.readFileSync(path.join(root, 'database/azure-sql/013_doe_faculty_allocation.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'database/azure-sql/rollback_013_doe_faculty_allocation.sql'), 'utf8');

test('DOE allocation schema is versioned, normalized, provenance-linked, and preserves explicit zero', () => {
  assert.match(forward, /CREATE TABLE\s+paws\.DoeFacultyAllocation/i);
  for (const field of ['FacultyId', 'AcademicYear', 'CategoryCode', 'AllocationDoe', 'SourceReference', 'PolicyVersionId', 'Active', 'CreatedAtUtc', 'UpdatedAtUtc']) {
    assert.match(forward, new RegExp(`\\b${field}\\b`, 'i'));
  }
  assert.match(forward, /AllocationDoe\s+decimal\(12,6\)\s+NOT NULL/i);
  assert.match(forward, /CHECK\s*\([\s\S]*?CategoryCode[\s\S]*?scholarly_activity[\s\S]*?onboarding[\s\S]*?\)/i);
  assert.match(forward, /FOREIGN KEY\s*\(\s*FacultyId\s*\)\s*REFERENCES\s+paws\.Faculty\s*\(\s*FacultyId\s*\)/i);
  assert.match(forward, /FOREIGN KEY\s*\(\s*PolicyVersionId\s*,\s*AcademicYear\s*\)\s*REFERENCES\s+paws\.DoePolicyVersion/i);
  assert.match(forward, /UNIQUE\s+INDEX[\s\S]*?FacultyId[\s\S]*?AcademicYear[\s\S]*?CategoryCode[\s\S]*?WHERE\s+Active\s*=\s*1/i);
  assert.match(forward, /BEGIN\s+TRANSACTION/i);
  assert.match(forward, /ROLLBACK\s+TRANSACTION/i);
});

test('DOE allocation rollback fails closed while imported rows remain and drops only the allocation table', () => {
  assert.match(rollback, /BEGIN\s+TRANSACTION/i);
  assert.match(rollback, /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+paws\.DoeFacultyAllocation/i);
  assert.match(rollback, /THROW/i);
  assert.match(rollback, /DROP TABLE\s+paws\.DoeFacultyAllocation/i);
  assert.doesNotMatch(rollback, /DROP TABLE\s+paws\.DoeFacultyTarget/i);
});
