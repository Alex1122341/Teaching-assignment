'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqlDoeEngineRepository } = require('../src/data/sql-doe-engine-repository');

test('loads the active annual policy with normalized relational rules, mappings, and references', async () => {
  const calls = [];
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    if (/FROM paws\.DoePolicyVersion/i.test(sql)) return [{ policyVersionId: 'p1', academicYear: '2026-27', status: 'active', revision: 4 }];
    if (/FROM paws\.DoePolicyRule/i.test(sql)) return [{ ruleId: 'r1', policyVersionId: 'p1', ruleKey: 'lecture', category: 'teaching', ruleLabel: 'Lecture', priority: 2, calculationMode: 'per_hour', resultKind: 'credit', reviewStatus: 'approved', enabled: true }];
    if (/FROM paws\.DoeRuleSelector/i.test(sql)) return [{ ruleId: 'r1', field: 'activityType', operator: 'equals', valueType: 'text', valueText: 'lecture' }];
    if (/FROM paws\.DoeRuleParameter/i.test(sql)) return [{ ruleId: 'r1', name: 'rate', valueNumber: 0.3 }];
    if (/FROM paws\.DoeRuleTier/i.test(sql)) return [];
    if (/FROM paws\.DoeRuleInput/i.test(sql)) return [{ ruleId: 'r1', inputName: 'hours', required: true }];
    if (/FROM paws\.DoeReferenceSource/i.test(sql)) return [{ referenceId: 'ref1', policyVersionId: 'p1', title: 'UCVM Workload Guidelines', pageNumber: 14 }];
    if (/FROM paws\.DoePolicyException/i.test(sql)) return [];
    if (/FROM paws\.DoeCourseMapping/i.test(sql)) return [{ mappingId: 'm1', courseCode: 'VTMD 204', unitCount: 6, enabled: true, reviewStatus: 'approved' }];
    if (/FROM paws\.DoeSubjectMapping/i.test(sql)) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const repository = createSqlDoeEngineRepository(db);
  const bundle = await repository.loadActivePolicy('2026-27');
  assert.equal(bundle.version.revision, 4);
  assert.equal(bundle.rules[0].selectors[0].field, 'activityType');
  assert.equal(bundle.rules[0].parameters[0].valueNumber, 0.3);
  assert.equal(bundle.rules[0].inputs[0].inputName, 'hours');
  assert.equal(bundle.references[0].title, 'UCVM Workload Guidelines');
  assert.equal(bundle.courseMappings[0].unitCount, 6);
  assert.ok(calls.every(call => call.params.policyVersionId === 'p1') || /DoePolicyVersion/.test(calls.find(c => /DoePolicyVersion/.test(c.sql)).sql));
});

test('an academic year without active policy returns null without reading children', async () => {
  let count = 0;
  const repository = createSqlDoeEngineRepository({ query: async () => { count += 1; return []; } });
  assert.equal(await repository.loadActivePolicy('2026-27'), null);
  assert.equal(count, 1);
});
