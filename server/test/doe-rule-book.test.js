'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DOE_RULES, GUIDELINE_SOURCE } = require('../src/domain/doe-rule-book');

test('UCVM guideline rule book preserves the reviewed assigned teaching rates and coordination tiers', () => {
  const byCode = Object.fromEntries(DOE_RULES.map(rule => [rule.ruleCode, rule]));
  assert.equal(byCode.lecture.rateOrTierPct, '0.30%');
  assert.equal(byCode.lecture.basis, 'per contact hour');
  assert.equal(byCode.srl.rateOrTierPct, '0.30%');
  assert.equal(byCode.lab_primary.rateOrTierPct, '0.21%');
  assert.equal(byCode.lab_secondary.rateOrTierPct, '0.19%');
  assert.deepEqual(['1.75%', '3.5%', '7%', '10%', '15%'],
    ['course_coordination_lt3', 'course_coordination_3_5', 'course_coordination_6_9', 'course_coordination_10_14', 'course_coordination_15_plus'].map(code => byCode[code].rateOrTierPct));
  assert.deepEqual(['under 3 units', '3–5 units', '6–9 units', '10–14 units', '15+ units'],
    ['course_coordination_lt3', 'course_coordination_3_5', 'course_coordination_6_9', 'course_coordination_10_14', 'course_coordination_15_plus'].map(code => byCode[code].academicYearOrStage));
  assert.equal(byCode.rotation_participant.rateOrTierPct, '2.5%');
  assert.equal(byCode.rotation_coordination.rateOrTierPct, '+2%');
  assert.equal(byCode.ccc_shift.rateOrTierPct, '0.5%');
  assert.equal(byCode.ccc_shift.basis, 'per shift');
});

test('UCVM guideline rule book preserves supervision, HICC, and VISC stage semantics', () => {
  const byCode = Object.fromEntries(DOE_RULES.map(rule => [rule.ruleCode, rule]));
  assert.deepEqual(['1%', '0.75%', '3%', '2%', '1.5%'],
    ['supervision_undergraduate', 'supervision_4th_year_preceptor', 'supervision_graduate_primary', 'supervision_graduate_cosupervisor', 'supervision_postdoctoral'].map(code => byCode[code].rateOrTierPct));
  assert.match(byCode.hicc_curriculum_development.calculationOrNote, /only while curriculum development remains applicable/i);
  assert.deepEqual(['7.5%', '5%', '2.5%', '1.75%'],
    ['visc_2025_26', 'visc_2026_27', 'visc_2027_28', 'visc_2028_maintenance'].map(code => byCode[code].rateOrTierPct));
  assert.match(byCode.visc_2026_27.academicYearOrStage, /2026-27/);
  assert.match(byCode.supervision_rolling_average.basis, /three-year/i);
});

test('rule book explicitly blocks deriving individual Research, PPVM, or role Service/Admin DOE', () => {
  const byCode = Object.fromEntries(DOE_RULES.map(rule => [rule.ruleCode, rule]));
  assert.match(byCode.research_expectation.calculationOrNote, /not a formula for individual contract DOE/i);
  assert.match(byCode.ppvm_contract.calculationOrNote, /do not infer/i);
  assert.match(byCode.service_admin_contract.calculationOrNote, /must not be split across individual roles/i);
  assert.equal(GUIDELINE_SOURCE.leadershipApproved, '2025-02-26');
  assert.equal(GUIDELINE_SOURCE.facultyCouncilApproved, '2025-03-12');
  assert.equal(GUIDELINE_SOURCE.effective, '2025-04-01');
  assert.equal(GUIDELINE_SOURCE.updated, '2025-12-23');
});
