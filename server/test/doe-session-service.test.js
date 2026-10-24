'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDoeSessionService } = require('../src/doe/doe-session-service');

const SESSION = '11111111-1111-4111-8111-111111111111';
const ASSIGNMENT = '22222222-2222-4222-8222-222222222222';
const FACULTY = '33333333-3333-4333-8333-333333333333';
const POLICY = '44444444-4444-4444-8444-444444444444';

function setup({ preview = async input => ({
  status: 'calculated', policyVersionId: POLICY, policyRevision: 3, ruleId: '55555555-5555-4555-8555-555555555555',
  ruleKey: 'lecture', category: 'teaching', factsSnapshot: input.facts, inputsSnapshot: {}, parameterSnapshot: {},
  ruleSnapshot: { ruleKey: 'lecture' }, referenceSnapshot: { title: 'UCVM Workload Guidelines' },
  calculationText: '4% DOE', resultDoe: 4
}), activePolicy = async () => ({ version: { policyVersionId: POLICY, revision: 3 } }) } = {}) {
  const calls = { loaded: [], saved: [] };
  const repository = {
    loadSessionDoeFacts: async id => {
      calls.loaded.push(id);
      return { sessionId: SESSION, academicYear: '2026-27', curriculumYear: '2', courseCode: 'VTMD 204', sessionType: 'LEC', sessionDate: '2026-09-10', startTime: '09:00:00', endTime: '10:30:00', assignments: [{ sessionAssignmentId: ASSIGNMENT, facultyId: FACULTY, teachingRole: 'Lecture' }] };
    },
    loadActivePolicy: activePolicy,
    saveSessionDoeCalculations: async input => { calls.saved.push(input); }
  };
  return { service: createDoeSessionService({ repository, calculationService: { preview }, idFactory: () => '66666666-6666-4666-8666-666666666666', clock: () => new Date('2026-10-07T12:00:00Z') }), calls };
}

test('session DOE re-matches facts server-side and persists a new immutable calculation link', async () => {
  const { service, calls } = setup();
  const outcome = await service.recalculate({ sessionId: SESSION, actor: { uid: 'server-actor' }, trigger: 'session_edit' });
  assert.equal(outcome.status, 'calculated');
  assert.equal(outcome.calculatedCount, 1);
  assert.equal(calls.loaded[0], SESSION);
  const row = calls.saved[0].rows[0];
  assert.equal(row.sessionAssignmentId, ASSIGNMENT);
  assert.equal(row.resultDoe, 4);
  assert.equal(row.calculatedBy, 'server-actor');
  assert.equal(row.calculationTrigger, 'session_edit');
  assert.equal(row.factsSnapshot.courseCode, 'VTMD 204');
  assert.equal(row.factsSnapshot.category, 'teaching');
  assert.equal(row.factsSnapshot.activityType, 'LEC');
  assert.equal(row.factsSnapshot.role, 'Lecture');
  assert.equal(row.factsSnapshot.hours, 1.5);
});

test('missing mapping or rule is persisted as Needs Review with no numeric result', async () => {
  const { service, calls } = setup({ preview: async () => { throw Object.assign(new Error('Annual mapping required'), { code: 'COURSE_MAPPING_REQUIRED' }); } });
  const outcome = await service.recalculate({ sessionId: SESSION, actor: { uid: 'server-actor' }, trigger: 'session_edit' });
  assert.equal(outcome.status, 'needs_review');
  assert.deepEqual(outcome.issueCodes, ['COURSE_MAPPING_REQUIRED']);
  const row = calls.saved[0].rows[0];
  assert.equal(row.calculationStatus, 'needs_review');
  assert.equal(row.resultDoe, null);
  assert.equal(row.ruleSnapshot.issueCode, 'COURSE_MAPPING_REQUIRED');
});

test('missing active policy remains unavailable and creates no fabricated calculation', async () => {
  const { service, calls } = setup({
    preview: async () => { throw Object.assign(new Error('No active annual policy'), { code: 'ACTIVE_POLICY_REQUIRED' }); },
    activePolicy: async () => null
  });
  const outcome = await service.recalculate({ sessionId: SESSION, actor: { uid: 'server-actor' }, trigger: 'session_edit' });
  assert.equal(outcome.status, 'needs_review');
  assert.deepEqual(outcome.issueCodes, ['ACTIVE_POLICY_REQUIRED']);
  assert.equal(calls.saved.length, 0);
});
