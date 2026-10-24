'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDoeAssignmentService } = require('../src/doe/doe-assignment-service');

function setup() {
  const calls = [];
  const repository = {
    saveDoeAssignment: async input => { calls.push(['save', input]); return { assignmentFactId: input.assignment.assignmentFactId, revision: input.assignment.revision }; },
    deactivateDoeAssignment: async input => { calls.push(['deactivate', input]); return { assignmentFactId: input.assignmentFactId, active: false }; }
  };
  const calculationService = { preview: async input => {
    calls.push(['preview', input]);
    return {
      ok: true, resultDoe: 12, ruleId: 'rule-1', ruleKey: 'coordination', policyVersionId: 'policy-1', policyRevision: 4,
      calculationText: '12% DOE · coordination', factsSnapshot: input.facts,
      inputsSnapshot: { hours: 2 }, parameterSnapshot: { rate: 6 },
      ruleSnapshot: { ruleId: 'rule-1' }, referenceSnapshot: { title: 'UCVM Workload Guidelines' }
    };
  } };
  return { calls, service: createDoeAssignmentService({ repository, calculationService, idFactory: () => '11111111-1111-1111-1111-111111111112', calculationIdFactory: () => '11111111-1111-1111-1111-111111111113', clock: () => new Date('2026-10-07T12:00:00.000Z') }) };
}

test('DOE role assignment save submits facts for server preview and persists calculation evidence without client DOE', async () => {
  const { calls, service } = setup();
  const result = await service.saveDoeAssignment({
    actor: { uid: 'admin-uid' }, academicYear: '2026-27', facultyId: '11111111-1111-1111-1111-111111111111',
    facts: { roleType: 'Course Coordinator', scopeText: 'VTMD 204', courseCode: 'VTMD 204', hours: 2, doeCredit: 999 }, notes: 'accepted source',
    trigger: 'faculty_edit'
  });
  assert.equal(calls[0][0], 'preview');
  assert.equal(calls[0][1].facts.doeCredit, undefined);
  assert.equal(calls[1][0], 'save');
  assert.equal(calls[1][1].assignment.assignmentFactId, '11111111-1111-1111-1111-111111111112');
  assert.equal(calls[1][1].assignment.CurrentCalculationId, undefined);
  assert.equal(calls[1][1].calculation.calculationId, '11111111-1111-1111-1111-111111111113');
  assert.equal(calls[1][1].calculation.resultDoe, 12);
  assert.equal(calls[1][1].calculation.calculationTrigger, 'faculty_edit');
  assert.equal(calls[1][1].calculation.referenceSnapshot.title, 'UCVM Workload Guidelines');
  assert.equal(result.resultDoe, 12);
});

test('DOE assignment edit requires revision and saves a new calculation rather than mutating old evidence', async () => {
  const { calls, service } = setup();
  await service.saveDoeAssignment({
    actor: { uid: 'admin-uid' }, academicYear: '2026-27', facultyId: '11111111-1111-1111-1111-111111111111',
    assignmentFactId: '11111111-1111-1111-1111-111111111112', expectedRevision: 3,
    facts: { roleType: 'Course Coordinator', scopeText: 'VTMD 205', courseCode: 'VTMD 205' }, notes: 'edited'
  });
  assert.equal(calls[1][1].expectedRevision, 3);
  assert.equal(calls[1][1].assignment.revision, 4);
  assert.equal(calls[1][1].calculation.calculationId, '11111111-1111-1111-1111-111111111113');
});

test('DOE assignment cannot be saved when rule matching is unresolved', async () => {
  const repository = {
    saveDoeAssignment: async () => assert.fail('must not save unresolved DOE'),
    deactivateDoeAssignment: async () => assert.fail('must not deactivate during this test')
  };
  const service = createDoeAssignmentService({
    repository, calculationService: { preview: async () => { throw Object.assign(new Error('mapping required'), { code: 'COURSE_MAPPING_REQUIRED' }); } },
    idFactory: () => '11111111-1111-1111-1111-111111111112', calculationIdFactory: () => '11111111-1111-1111-1111-111111111113'
  });
  await assert.rejects(() => service.saveDoeAssignment({
    actor: { uid: 'admin-uid' }, academicYear: '2026-27', facultyId: '11111111-1111-1111-1111-111111111111',
    facts: { roleType: 'Course Coordinator', courseCode: 'UNKNOWN' }
  }), { code: 'COURSE_MAPPING_REQUIRED' });
});

test('DOE assignment deactivation calls soft-deactivate with optimistic revision', async () => {
  const { calls, service } = setup();
  const result = await service.deactivateDoeAssignment({
    actor: { uid: 'admin-uid' }, facultyId: '11111111-1111-1111-1111-111111111111',
    academicYear: '2026-27', assignmentFactId: '11111111-1111-1111-1111-111111111112', expectedRevision: 5, reason: 'ended'
  });
  assert.deepEqual(calls[0], ['deactivate', {
    actorUid: 'admin-uid', facultyId: '11111111-1111-1111-1111-111111111111', academicYear: '2026-27',
    assignmentFactId: '11111111-1111-1111-1111-111111111112', expectedRevision: 5, reason: 'ended'
  }]);
  assert.equal(result.active, false);
});
