'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqlDoeTargetOverrideRepository } = require('../src/data/sql-doe-target-override-repository');

test('target lookup joins Faculty to the canonical annual target', async () => {
  let call;
  const repository = createSqlDoeTargetOverrideRepository({ query: async (sql, params) => { call = { sql, params }; return [{ facultyId: params.facultyId, contractTeachingDoe: 40 }]; } });
  const row = await repository.getFacultyTargetSource('11111111-1111-1111-1111-111111111111', '2026-27');
  assert.equal(row.contractTeachingDoe, 40);
  assert.match(call.sql, /LEFT JOIN paws\.DoeFacultyTarget/i);
  assert.match(call.sql, /t\.AcademicYear=@academicYear AND t\.Active=1/i);
});

test('target override is an atomic audited update that preserves existing contract DOE', async () => {
  let call;
  const repository = createSqlDoeTargetOverrideRepository({ query: async (sql, params) => { call = { sql, params }; return []; } });
  await repository.saveFacultyTargetOverride({
    target: { facultyId: '11111111-1111-1111-1111-111111111111', academicYear: '2026-27', contractTeachingDoe: 40, overrideDoe: 25, overrideReason: 'RSL', overrideNotes: 'approved', effectiveTargetDoe: 25, source: 'approved_override', policyVersionId: '11111111-1111-1111-1111-111111111112', updatedBy: 'uid' },
    auditRecord: { auditEventId: '11111111-1111-1111-1111-111111111113', action: 'faculty_doe_override_saved', entityId: 'target-1', actorUid: 'uid', before: {}, after: { effectiveTargetDoe: 25 } }
  });
  assert.match(call.sql, /BEGIN TRANSACTION[\s\S]*COMMIT TRANSACTION[\s\S]*ROLLBACK TRANSACTION/i);
  assert.match(call.sql, /SET OverrideDoe=@overrideDoe,OverrideReason=@overrideReason,OverrideNotes=@overrideNotes/i);
  assert.doesNotMatch(call.sql, /SET[^;]*ContractTeachingDoe=/i);
  assert.match(call.sql, /INSERT INTO paws\.DoeAuditEvent/i);
  assert.equal(call.params.contractTeachingDoe, 40);
});
