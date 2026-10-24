'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqlDoePolicyRepository } = require('../src/data/sql-doe-policy-repository');

test('Draft persistence writes normalized Rule Book children in a guarded transaction and invalidates revision evidence', async () => {
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); return [{ policyVersionId: params?.policyVersionId, revision: 3, status: 'draft' }]; } };
  const repository = createSqlDoePolicyRepository(db);
  const result = await repository.saveDraft({
    policyVersionId: '00000000-0000-4000-8000-000000000001', academicYear: '2026-27', expectedRevision: 2, actorUid: 'admin-1',
    bundle: { version: { versionLabel: 'v2', sourceReference: 'Guideline' }, references: [], rules: [{ ruleId: '00000000-0000-4000-8000-000000000002', ruleKey: 'lecture', category: 'teaching', ruleLabel: 'Lecture', calculationMode: 'fixed', parameters: [{ name: 'fixed', valueNumber: 0 }], selectors: [], tiers: [], inputs: [] }], exceptions: [], courseMappings: [], subjectMappings: [] }
  });
  assert.equal(result.revision, 3);
  const sql = calls[0].sql;
  assert.match(sql, /Status=N'draft' AND Revision=@expectedRevision/);
  assert.match(sql, /DELETE FROM paws\.DoePolicyRule/);
  assert.ok(sql.indexOf('DELETE FROM paws.DoePolicyRule WHERE PolicyVersionId=@policyVersionId') < sql.indexOf('DELETE FROM paws.DoeReferenceSource WHERE PolicyVersionId=@policyVersionId'), 'referenced Rules must be removed before their structured References');
  assert.match(sql, /INSERT INTO paws\.DoeRuleSelector/);
  assert.match(sql, /INSERT INTO paws\.DoeRuleParameter/);
  assert.match(sql, /INSERT INTO paws\.DoeRuleTier/);
  assert.match(sql, /INSERT INTO paws\.DoeRuleInput/);
  assert.match(sql, /Revision=Revision\+1,ValidatedRevision=NULL,ValidatedChecksum=NULL,ImpactRevision=NULL,ImpactChecksum=NULL/);
  assert.match(sql, /INSERT INTO paws\.DoeAuditEvent/);
});

test('policy publication is one transaction and requires matching validation plus impact evidence', async () => {
  let sql = '';
  const repository = createSqlDoePolicyRepository({ async query(statement) { sql = statement; return [{ status: 'active' }]; } });
  const result = await repository.publishPolicy({ policyVersionId: 'policy-1', academicYear: '2026-27', revision: 4, actorUid: 'admin-1' });
  assert.equal(result.status, 'active');
  assert.match(sql, /ValidatedRevision=@revision AND ImpactRevision=@revision/);
  assert.match(sql, /UPDATE paws\.DoePolicyVersion SET Status=N'archived'/);
  assert.match(sql, /INSERT INTO paws\.DoePolicyPublication/);
  assert.match(sql, /INSERT INTO paws\.DoeAuditEvent/);
  assert.match(sql, /COMMIT/);
});

test('SQL policy version reads retain relational selectors, structured references and annual mappings', async () => {
  const calls = [];
  const db = { async query(sql) { calls.push(sql); if (sql.includes('FROM paws.DoePolicyVersion')) return [{ policyVersionId: 'p1', academicYear: '2026-27', status: 'draft', revision: 0 }]; if (sql.includes('FROM paws.DoePolicyRule WHERE')) return [{ ruleId: 'r1', ruleKey: 'k', category: 'teaching', priority: 1, enabled: true }]; if (sql.includes('FROM paws.DoeReferenceSource')) return [{ referenceId: 'ref1', title: 'UCVM Workload Guidelines', section: 'Lecture', pageNumber: 4 }]; if (sql.includes('FROM paws.DoeCourseMapping')) return [{ mappingId: 'm1', courseCode: 'VTMD 204', unitCount: 6, mappingFactsJson: '{"unitCount":6}', enabled: true }]; return []; } };
  const policy = await createSqlDoePolicyRepository(db).getPolicyVersion('p1');
  assert.equal(policy.version.status, 'draft');
  assert.equal(policy.references[0].title, 'UCVM Workload Guidelines');
  assert.equal(policy.courseMappings[0].mappingFacts.unitCount, 6);
  assert.ok(calls.some(sql => sql.includes('paws.DoeRuleSelector')));
  assert.ok(calls.some(sql => sql.includes('paws.DoeRuleParameter')));
  assert.ok(calls.some(sql => sql.includes('paws.DoeSubjectMapping')));
});

test('Impact Preview calculates a bounded current assignment snapshot and persists impact rows only', async () => {
  const calls = [];
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO paws.DoeImpactRun(')) return [{ impactRunId: 'impact-1', assignmentsChanged: params.assignmentsChanged, totalDelta: params.totalDelta }];
    if (sql.includes('FROM paws.DoePolicyVersion')) return [{ policyVersionId: 'p1', academicYear: '2026-27', status: 'draft', revision: 3, validatedRevision: 3, impactRevision: null }];
    if (sql.includes('FROM paws.DoePolicyRule WHERE')) return [{ ruleId: 'reserve-rule', ruleKey: 'reserve', category: 'reserve', priority: 1, enabled: true }];
    if (sql.includes('FROM paws.DoeAssignmentFact a')) return [{ assignmentFactId: 'a1', facultyId: 'f1', academicYear: '2026-27', category: 'teaching', roleType: 'Course Coordinator', courseCode: 'VTMD 204', sourceEntityType: 'doe_assignment', sourceEntityId: 'a1', revision: 2, oldDoe: 10, inputsJson: '[]' }];
    return [];
  } };
  const repository = createSqlDoePolicyRepository(db);
  const result = await repository.previewImpact({ policyVersionId: 'p1', academicYear: '2026-27', revision: 3, checksum: 'a'.repeat(64), actorUid: 'admin-1', calculate: async facts => ({ resultDoe: facts.courseCode ? 12 : 0 }) });
  assert.equal(result.impactRunId, 'impact-1');
  assert.equal(result.assignmentsChanged, 1);
  const transaction = calls.find(call => call.sql.includes('INSERT INTO paws.DoeImpactRun('));
  assert.match(transaction.sql, /INSERT INTO paws\.DoeImpactRunRow/);
  assert.match(transaction.sql, /UPDATE paws\.DoePolicyVersion SET ImpactRevision/);
  assert.equal(calls.some(call => /UPDATE paws\.DoeAssignmentFact|INSERT INTO paws\.DoeCalculationRecord/.test(call.sql)), false);
  assert.equal(transaction.params.needsReview, 0);
});

test('annual Reserve policy values survive SQL normalization in rule parameters', async () => {
  const saved = [];
  const db = { async query(sql, params) {
    saved.push({ sql, params });
    if (sql.includes('FROM paws.DoePolicyVersion')) return [{ policyVersionId: 'p1', academicYear: '2026-27', status: 'draft', revision: 0 }];
    if (sql.includes('FROM paws.DoePolicyRule WHERE')) return [{ ruleId: 'r-reserve', ruleKey: 'reserve', category: 'reserve', priority: 1, enabled: true, reviewStatus: 'approved' }];
    if (sql.includes('FROM paws.DoeRuleParameter')) return ['splitThreshold','splitRatio','highTeachingTraineeCeiling','teachingFocusedTraineeCeiling','rollingAverageYears'].map((name, index) => ({ ruleId: 'r-reserve', name, valueNumber: [30,0.5,20,40,3][index] }));
    return [];
  } };
  const repository = createSqlDoePolicyRepository(db);
  await repository.saveDraft({ policyVersionId: 'p1', academicYear: '2026-27', expectedRevision: 0, actorUid: 'admin-1', bundle: {
    version: { versionLabel: 'Draft', sourceReference: 'UCVM' }, rules: [{ ruleId: 'r-reserve', ruleKey: 'reserve', category: 'reserve', ruleLabel: 'Reserve', calculationMode: 'fixed', parameters: [], selectors: [], tiers: [], inputs: [] }],
    reservePolicy: { splitThreshold: 30, splitRatio: 0.5, highTeachingTraineeCeiling: 20, teachingFocusedTraineeCeiling: 40, rollingAverageYears: 3 },
    references: [], exceptions: [], courseMappings: [], subjectMappings: []
  } });
  assert.match(saved[0].params.rulesJson, /splitThreshold/);
  const loaded = await repository.getPolicyVersion('p1');
  assert.deepEqual(loaded.reservePolicy, { splitThreshold: 30, splitRatio: 0.5, highTeachingTraineeCeiling: 20, teachingFocusedTraineeCeiling: 40, rollingAverageYears: 3 });
});

test('Reserve parameters are unavailable until the annual Reserve rule is approved and enabled', async () => {
  const db = { async query(sql) {
    if (sql.includes('FROM paws.DoePolicyVersion')) return [{ policyVersionId: 'p1', academicYear: '2026-27', status: 'draft', revision: 0 }];
    if (sql.includes('FROM paws.DoePolicyRule WHERE')) return [{ ruleId: 'r-reserve', ruleKey: 'reserve', category: 'reserve', priority: 1, enabled: false, reviewStatus: 'needs_review' }];
    if (sql.includes('FROM paws.DoeRuleParameter')) return ['splitThreshold','splitRatio','highTeachingTraineeCeiling','teachingFocusedTraineeCeiling','rollingAverageYears'].map((name, index) => ({ ruleId: 'r-reserve', name, valueNumber: [35,0.5,15,7.5,3][index] }));
    return [];
  } };
  const loaded = await createSqlDoePolicyRepository(db).getPolicyVersion('p1');
  assert.equal(loaded.reservePolicy, null);
});

test('controlled recalculation writes immutable result records and atomically moves current pointers', async () => {
  const calls = [];
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('SELECT TOP (@limit)')) return [{ assignmentFactId: 'a1', facultyId: 'f1', academicYear: '2026-27', category: 'teaching', roleType: 'Course Coordinator', courseCode: 'VTMD 204', sourceEntityType: 'doe_assignment', sourceEntityId: 'a1', revision: 4, inputsJson: '[]' }];
    if (sql.includes('INSERT INTO paws.DoeCalculationRecord')) return [{ recordsCreated: params.recordCount, needsReview: params.needsReview, policyVersionId: params.policyVersionId, policyRevision: params.policyRevision }];
    if (sql.includes('SELECT COUNT_BIG(*) AS remaining')) return [{ remaining: 0 }];
    return [];
  } };
  const repository = createSqlDoePolicyRepository(db);
  const result = await repository.recalculate({ academicYear: '2026-27', policyVersionId: '00000000-0000-4000-8000-000000000001', policyRevision: 5, actorUid: 'admin-1', limit: 20, calculate: async facts => ({
    policyVersionId: '00000000-0000-4000-8000-000000000001', ruleId: '00000000-0000-4000-8000-000000000002', ruleKey: 'course-coordination',
    category: facts.category, resultDoe: 12, factsSnapshot: facts, inputsSnapshot: {}, parameterSnapshot: { rate: 2 },
    ruleSnapshot: { ruleKey: 'course-coordination' }, referenceSnapshot: { title: 'UCVM Workload Guidelines' }, calculationText: '12% DOE'
  }) });
  assert.equal(result.recordsCreated, 1);
  const transaction = calls.find(call => call.sql.includes('INSERT INTO paws.DoeCalculationRecord'));
  assert.match(transaction.sql, /INSERT INTO paws\.DoeCalculationRecord/);
  assert.match(transaction.sql, /UPDATE a SET CurrentCalculationId/);
  assert.match(transaction.sql, /DOE_POLICY_CHANGED/);
  assert.match(transaction.sql, /DOE_ASSIGNMENT_REVISION_CONFLICT/);
  assert.doesNotMatch(transaction.sql, /UPDATE paws\.DoeCalculationRecord|DELETE FROM paws\.DoeCalculationRecord/);
  assert.match(transaction.sql, /CalculationTrigger/);
  assert.match(transaction.sql, /calculationTrigger/);
  assert.doesNotMatch(transaction.sql, /\bTrigger\b/);
  assert.equal(transaction.params.needsReview, 0);
});
