'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '..', 'src', 'data', 'sql-doe-target-repository.js');

test('DOE repository reads only active rows through a parameterized canonical-year query', async () => {
  assert.equal(fs.existsSync(modulePath), true, 'SQL DOE target repository should exist');
  const { createSqlDoeTargetRepository } = require(modulePath);
  const calls = [];
  const repository = createSqlDoeTargetRepository({ query: async (sql, params) => { calls.push({ sql, params }); return [{
    doeFacultyTargetId: '33333333-3333-3333-3333-333333333333',
    facultyId: '11111111-1111-1111-1111-111111111111',
    academicYear: '2026-27',
    contractTeachingDoe: null,
    overrideDoe: 0,
    effectiveTargetDoe: 0,
    overrideReason: 'approved exception',
    overrideNotes: null,
    source: null,
    policyVersionId: null,
    active: true,
    updatedAtUtc: new Date('2026-10-04T00:00:00Z')
  }]; } });
  const rows = await repository.doeTargets({ academicYear: '2026-2027' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.academicYear, '2026-27');
  assert.equal(calls[0].params.limit, 500);
  assert.match(calls[0].sql, /FROM paws\.DoeFacultyTarget/i);
  assert.match(calls[0].sql, /t\.Active\s*=\s*1/i);
  assert.doesNotMatch(calls[0].sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b|staging|firestore/i);
  assert.equal(rows[0].contractTeachingDoe, null);
  assert.equal(rows[0].overrideDoe, 0);
  assert.equal(rows[0].effectiveTargetDoe, 0);
  assert.equal(rows[0].updatedAtUtc, '2026-10-04T00:00:00.000Z');
});

test('DOE repository rejects malformed academic years before SQL access', async () => {
  assert.equal(fs.existsSync(modulePath), true, 'SQL DOE target repository should exist');
  const { createSqlDoeTargetRepository } = require(modulePath);
  let called = false;
  const repository = createSqlDoeTargetRepository({ query: async () => { called = true; return []; } });
  await assert.rejects(repository.doeTargets({ academicYear: '2026' }), { code: 'INVALID_ACADEMIC_YEAR' });
  assert.equal(called, false);
});
