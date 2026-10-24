'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDoeTargetOverrideService } = require('../src/doe/doe-target-override-service');

function setup(contractTeachingDoe = 40) {
  const calls = [];
  const repository = {
    getFacultyTargetSource: async () => ({ facultyId: '11111111-1111-1111-1111-111111111111', contractTeachingDoe, overrideDoe: null }),
    saveFacultyTargetOverride: async input => { calls.push(input); return { facultyId: input.target.facultyId, effectiveTargetDoe: input.target.effectiveTargetDoe }; }
  };
  const service = createDoeTargetOverrideService({ repository, auditIdFactory: () => '11111111-1111-1111-1111-111111111112', clock: () => new Date('2026-10-07T12:00:00.000Z') });
  return { calls, service };
}

test('office DOE override saves a non-negative annual target without changing contract DOE', async () => {
  const { calls, service } = setup(40);
  const result = await service.saveOverride({
    actor: { uid: 'admin-uid', role: 'administrator' }, facultyId: '11111111-1111-1111-1111-111111111111', academicYear: '2026-27',
    override: { value: 25, reason: 'RSL', notes: 'approved' }
  });
  assert.equal(calls[0].target.contractTeachingDoe, 40);
  assert.equal(calls[0].target.overrideDoe, 25);
  assert.equal(calls[0].target.effectiveTargetDoe, 25);
  assert.equal(result.effectiveTargetDoe, 25);
  assert.equal(calls[0].auditRecord.after.contractTeachingDoe, 40);
});

test('clearing an override restores contract DOE and omits override reason and notes', async () => {
  const { calls, service } = setup(40);
  await service.saveOverride({ actor: { uid: 'admin-uid', role: 'owner' }, facultyId: '11111111-1111-1111-1111-111111111111', academicYear: '2026-27', override: null });
  assert.equal(calls[0].target.overrideDoe, null);
  assert.equal(calls[0].target.overrideReason, null);
  assert.equal(calls[0].target.overrideNotes, null);
  assert.equal(calls[0].target.effectiveTargetDoe, 40);
});

test('Developer can manage Faculty DOE targets under the canonical role policy', async () => {
  const { calls, service } = setup(40);
  await service.saveOverride({ actor: { uid: 'developer-uid', role: 'developer' }, facultyId: '11111111-1111-1111-1111-111111111111', academicYear: '2026-27', override: { value: 25, reason: 'RSL' } });
  assert.equal(calls[0].target.updatedBy, 'developer-uid');
});

test('override reason and value are validated; access roles cannot authorize policy changes', async () => {
  const { service } = setup();
  await assert.rejects(() => service.saveOverride({ actor: { uid: 'admin-uid', role: 'administrator' }, facultyId: '11111111-1111-1111-1111-111111111111', academicYear: '2026-27', override: { value: 20, reason: '' } }), { code: 'DOE_TARGET_OVERRIDE_INVALID' });
  await assert.rejects(() => service.saveOverride({ actor: { uid: 'admin-uid', role: 'administrator' }, facultyId: '11111111-1111-1111-1111-111111111111', academicYear: '2026-27', override: { value: -1, reason: 'RSL' } }), { code: 'DOE_TARGET_OVERRIDE_INVALID' });
  await assert.rejects(() => service.saveOverride({ actor: { uid: 'faculty-uid', role: 'faculty' }, facultyId: '11111111-1111-1111-1111-111111111111', academicYear: '2026-27', override: null }), { code: 'FORBIDDEN' });
});
