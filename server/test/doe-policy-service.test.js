'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDoePolicyService } = require('../src/doe/doe-policy-service');

function makeRepository(overrides = {}) {
  const draft = {
    version: { policyVersionId: 'draft-1', academicYear: '2026-27', status: 'draft', revision: 2, validatedRevision: null, impactRevision: null },
    rules: [{ ruleId: 'rule-1', ruleKey: 'lecture', category: 'teaching', ruleLabel: 'Lecture', referenceId: 'ref-1', priority: 1, calculationMode: 'per_hour', resultKind: 'credit', parameters: [{ name: 'rate', valueNumber: 1 }], inputs: [{ inputName: 'hours', required: true }], selectors: [{ field: 'activityType', operator: 'equals', valueText: 'lecture' }] }],
    references: [{ referenceId: 'ref-1', title: 'UCVM Workload Guidelines', section: 'Teaching', pageNumber: 4, reviewStatus: 'approved' }],
    exceptions: [], courseMappings: [], subjectMappings: []
  };
  const calls = [];
  return {
    calls,
    async getPolicyVersion(id) { calls.push(['getPolicyVersion', id]); return id === 'draft-1' ? structuredClone(draft) : null; },
    async createDraft(input) { calls.push(['createDraft', input]); return { policyVersionId: 'draft-new', academicYear: input.academicYear, status: 'draft', revision: 0 }; },
    async saveDraft(input) { calls.push(['saveDraft', input]); return { ...draft, version: { ...draft.version, revision: 3 } }; },
    async markValidated(input) { calls.push(['markValidated', input]); return { revision: input.revision, checksum: input.checksum }; },
    async previewImpact(input) { calls.push(['previewImpact', input]); return { impactRunId: 'impact-1', draftRevision: input.revision, needsReview: 0 }; },
    async publishPolicy(input) { calls.push(['publishPolicy', input]); return { policyVersionId: input.policyVersionId, status: 'active' }; },
    async clonePolicy(input) { calls.push(['clonePolicy', input]); return { policyVersionId: 'draft-copy', academicYear: input.academicYear, status: 'draft', revision: 0 }; },
    async listHistory(year) { calls.push(['listHistory', year]); return [{ academicYear: year, status: 'active' }]; },
    async archivePolicy(input) { calls.push(['archivePolicy', input]); return { policyVersionId: input.policyVersionId, status: 'archived' }; },
    async recalculate(input) { calls.push(['recalculate', input]); return { created: 3, needsReview: 1 }; },
    ...overrides
  };
}

test('DOE Draft saves use optimistic revision and reject a stale editor before persistence', async () => {
  const repository = makeRepository();
  const service = createDoePolicyService({ repository });
  await assert.rejects(service.saveDraft({ policyVersionId: 'draft-1', expectedRevision: 1, patch: { rules: [] }, actorUid: 'admin-1' }), error => error.code === 'DOE_POLICY_REVISION_CONFLICT');
  assert.equal(repository.calls.some(([name]) => name === 'saveDraft'), false);
});

test('DOE Draft validation records its exact revision and rejects missing references', async () => {
  const repository = makeRepository();
  const service = createDoePolicyService({ repository });
  const result = await service.validateDraft({ policyVersionId: 'draft-1', expectedRevision: 2, actorUid: 'admin-1' });
  assert.equal(result.valid, true);
  assert.equal(repository.calls.find(([name]) => name === 'markValidated')[1].revision, 2);
  const invalid = makeRepository({ getPolicyVersion: async () => ({ version: { policyVersionId: 'draft-1', academicYear: '2026-27', status: 'draft', revision: 2 }, rules: [{ ruleId: 'r', ruleKey: 'x', category: 'teaching', calculationMode: 'fixed', parameters: [{ name: 'fixed', valueNumber: 1 }], referenceId: 'missing' }], references: [], exceptions: [], courseMappings: [], subjectMappings: [] }) });
  const invalidService = createDoePolicyService({ repository: invalid });
  const invalidResult = await invalidService.validateDraft({ policyVersionId: 'draft-1', expectedRevision: 2, actorUid: 'admin-1' });
  assert.equal(invalidResult.valid, false);
  assert.ok(invalidResult.errors.some(item => item.code === 'REFERENCE_REQUIRED'));
});

test('DOE impact preview is revision-bound and publish rejects stale validation or impact evidence', async () => {
  const repository = makeRepository();
  const service = createDoePolicyService({ repository, calculationService: { previewWithPolicy: async ({ policyBundle, facts }) => ({ resultDoe: 1, policyVersionId: policyBundle.version.policyVersionId, facts }) } });
  const impact = await service.previewImpact({ policyVersionId: 'draft-1', expectedRevision: 2, actorUid: 'admin-1' });
  assert.equal(impact.impactRunId, 'impact-1');
  await assert.rejects(service.publishDraft({ policyVersionId: 'draft-1', expectedRevision: 2, actorUid: 'admin-1' }), error => error.code === 'DOE_VALIDATION_REQUIRED');
  repository.getPolicyVersion = async () => ({ version: { policyVersionId: 'draft-1', academicYear: '2026-27', status: 'draft', revision: 2, validatedRevision: 2, impactRevision: 1 }, rules: [], references: [], exceptions: [], courseMappings: [], subjectMappings: [] });
  await assert.rejects(service.publishDraft({ policyVersionId: 'draft-1', expectedRevision: 2, actorUid: 'admin-1' }), error => error.code === 'DOE_IMPACT_REQUIRED');
});

test('DOE Draft copy creates a new academic-year identity without changing its source', async () => {
  const repository = makeRepository();
  const service = createDoePolicyService({ repository });
  const result = await service.copyPreviousYear({ sourcePolicyVersionId: 'draft-1', academicYear: '2027-28', actorUid: 'admin-1' });
  assert.deepEqual(result, { policyVersionId: 'draft-copy', academicYear: '2027-28', status: 'draft', revision: 0 });
  assert.equal(repository.calls.find(([name]) => name === 'clonePolicy')[1].sourcePolicyVersionId, 'draft-1');
});

test('controlled recalculation pins one Active policy and sends only facts to the calculation runner', async () => {
  const calls = [];
  const repository = makeRepository({
    async loadActivePolicy(year) { return { version: { policyVersionId: 'active-1', academicYear: year, status: 'active', revision: 7 } }; },
    async recalculate(input) { calls.push(input); return { recordsCreated: 2 }; }
  });
  const calculationService = { previewWithPolicy: async input => ({ resultDoe: 2, ...input }) };
  const result = await createDoePolicyService({ repository, calculationService }).recalculate({ academicYear: '2026-27', actorUid: 'admin-1', limit: 2 });
  assert.equal(result.recordsCreated, 2);
  assert.equal(calls[0].policyVersionId, 'active-1');
  assert.equal(calls[0].policyRevision, 7);
  assert.equal((await calls[0].calculate({ category: 'teaching' })).policyBundle.version.status, 'active');
});
