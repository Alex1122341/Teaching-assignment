'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDoeCalculationService } = require('../src/doe/doe-calculation-service');

function policy(overrides = {}) {
  return {
    version: { policyVersionId: 'p-1', academicYear: '2026-27', revision: 3, status: 'active' },
    rules: [{
      ruleId: 'r-1', ruleKey: 'course-hicc-development', category: 'hicc', priority: 1, enabled: true,
      mappingRequirement: 'course', calculationMode: 'formula', formulaText: 'units * rate',
      parameters: [{ name: 'rate', valueNumber: 2 }], inputs: [{ inputName: 'units', required: true }],
      selectors: [
        { field: 'roleType', operator: 'equals', valueText: 'HICC' },
        { field: 'curriculumStage', operator: 'equals', valueText: 'Year 2' }
      ], referenceId: 'ref-1'
    }],
    references: [{ referenceId: 'ref-1', title: 'UCVM Workload Guidelines', section: 'Development', pageNumber: 14, reviewStatus: 'approved' }],
    courseMappings: [{ courseCode: 'VTMD 204', unitCount: 6, curriculumStage: 'Year 2', hiccEligible: true }],
    subjectMappings: [], exceptions: [], ...overrides
  };
}

test('course mappings enrich only declared authoritative facts and preserve source evidence', async () => {
  const service = createDoeCalculationService({ repository: { loadActivePolicy: async () => policy() } });
  const preview = await service.preview({ academicYear: '2026-27', facts: { category: 'hicc', roleType: 'HICC', courseCode: 'VTMD 204' } });
  assert.equal(preview.resultDoe, 12);
  assert.equal(preview.policyVersionId, 'p-1');
  assert.equal(preview.referenceSnapshot.title, 'UCVM Workload Guidelines');
  assert.equal(preview.inputs.units, 6);
});

test('a required but absent course mapping fails closed with a mapping-specific result', async () => {
  const service = createDoeCalculationService({ repository: { loadActivePolicy: async () => policy({ courseMappings: [] }) } });
  await assert.rejects(service.preview({ academicYear: '2026-27', facts: { category: 'hicc', roleType: 'HICC', courseCode: 'UNKNOWN' } }), error => error.code === 'COURSE_MAPPING_REQUIRED');
});

test('missing annual active policy and unmatched rule never become zero DOE', async () => {
  const noPolicy = createDoeCalculationService({ repository: { loadActivePolicy: async () => null } });
  await assert.rejects(noPolicy.preview({ academicYear: '2026-27', facts: { roleType: 'HICC' } }), error => error.code === 'ACTIVE_POLICY_REQUIRED');
  const unmatched = createDoeCalculationService({ repository: { loadActivePolicy: async () => policy({ rules: [] }) } });
  await assert.rejects(unmatched.preview({ academicYear: '2026-27', facts: { roleType: 'HICC' } }), error => error.code === 'NEEDS_REVIEW');
});

test('Draft policy preview uses the supplied revision bundle without requiring it to be Active', async () => {
  const policyBundle = {
    version: { policyVersionId: 'draft-p1', academicYear: '2026-27', status: 'draft', revision: 4 },
    rules: [{ ruleId: 'r1', ruleKey: 'lecture', category: 'teaching', activityType: 'lecture', ruleLabel: 'Lecture', priority: 1,
      calculationMode: 'per_hour', resultKind: 'credit', enabled: true, reviewStatus: 'approved',
      parameters: [{ name: 'rate', valueNumber: 2 }], inputs: [{ inputName: 'hours', required: true }],
      selectors: [{ field: 'activityType', operator: 'equals', valueText: 'lecture' }] }],
    references: [], exceptions: [], courseMappings: [], subjectMappings: []
  };
  const service = createDoeCalculationService({ repository: { loadActivePolicy: async () => { throw new Error('active policy should not be read'); } } });
  const preview = await service.previewWithPolicy({ policyBundle, academicYear: '2026-27', facts: { category: 'teaching', activityType: 'lecture', hours: 3 } });
  assert.equal(preview.resultDoe, 6);
  assert.equal(preview.policyVersionId, 'draft-p1');
  assert.equal(preview.policyRevision, 4);
});

test('a rule with an unapproved or missing structured reference is Needs Review', async () => {
  for (const references of [[], [{ referenceId: 'ref-1', title: 'UCVM Workload Guidelines', reviewStatus: 'needs_review' }]]) {
    const service = createDoeCalculationService({ repository: { loadActivePolicy: async () => policy({ references }) } });
    await assert.rejects(service.preview({ academicYear: '2026-27', facts: { category: 'hicc', roleType: 'HICC', courseCode: 'VTMD 204' } }), error => error.code === 'NEEDS_REVIEW');
  }
});

test('VISC subject mapping is the only source of subject stage and development phase', async () => {
  const viscRule = {
    ruleId:'visc-1',ruleKey:'visc-development',category:'visc',priority:1,enabled:true,
    mappingRequirement:'subject',calculationMode:'fixed',parameters:[{name:'fixed',valueNumber:2}],
    selectors:[{field:'developmentPhase',operator:'equals',valueText:'development'}],
    referenceId:'ref-1'
  };
  const service = createDoeCalculationService({ repository:{loadActivePolicy:async()=>policy({rules:[viscRule],courseMappings:[],subjectMappings:[{subjectKey:'S-01',subjectName:'Canonical Subject',developmentPhase:'development',curriculumStage:'Year 1',reviewStatus:'approved'}]})} });
  const result = await service.preview({academicYear:'2026-27',facts:{category:'visc',roleType:'VISC',subjectKey:'S-01'}});
  assert.equal(result.resultDoe,2);
  const missing = createDoeCalculationService({ repository:{loadActivePolicy:async()=>policy({rules:[viscRule],courseMappings:[],subjectMappings:[]})} });
  await assert.rejects(missing.preview({academicYear:'2026-27',facts:{category:'visc',roleType:'VISC',subjectKey:'UNKNOWN'}}),error=>error.code==='SUBJECT_MAPPING_REQUIRED');
});
