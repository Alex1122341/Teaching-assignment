'use strict';

const { DOE_RULES } = require('./doe-rule-book');
const { courseEvidence } = require('./doe-course-catalog-2026-27');

const CALCULATOR_SOURCE = 'Teaching Assignments 2026-27 MASTER.xlsx · DOE Calculator';
const CALCULATOR_VERSION = '2026-27-v1';
const TOLERANCE = 0.000001;

const RULE_BY_CODE = Object.freeze(Object.fromEntries(DOE_RULES.map(rule => [rule.ruleCode, rule])));
const TEACHING_ROLE_RULES = Object.freeze({
  Lecture: Object.freeze({ ruleCode: 'lecture', rate: 0.30 }),
  SRL: Object.freeze({ ruleCode: 'srl', rate: 0.30 }),
  'Lab Primary': Object.freeze({ ruleCode: 'lab_primary', rate: 0.21 }),
  'Lab Secondary': Object.freeze({ ruleCode: 'lab_secondary', rate: 0.19 })
});
const DOE_NON_CREDIT_SESSION_TYPES = Object.freeze(['Quiz/Midterm', 'OSCE']);
const DOE_NON_CREDIT_SESSION_TYPE_SET = new Set(DOE_NON_CREDIT_SESSION_TYPES);
const VISC_RATE_BY_YEAR = Object.freeze({
  '2025-26': Object.freeze({ ruleCode: 'visc_2025_26', rate: 7.5 }),
  '2026-27': Object.freeze({ ruleCode: 'visc_2026_27', rate: 5 }),
  '2027-28': Object.freeze({ ruleCode: 'visc_2027_28', rate: 2.5 }),
  '2028+': Object.freeze({ ruleCode: 'visc_2028_maintenance', rate: 1.75 })
});
const SUPERVISION_RATES = Object.freeze({
  undergraduate: Object.freeze({ ruleCode: 'supervision_undergraduate', rate: 1 }),
  fourthYearPreceptor: Object.freeze({ ruleCode: 'supervision_4th_year_preceptor', rate: 0.75 }),
  graduatePrimary: Object.freeze({ ruleCode: 'supervision_graduate_primary', rate: 3 }),
  graduateCosupervisor: Object.freeze({ ruleCode: 'supervision_graduate_cosupervisor', rate: 2 }),
  postdoctoral: Object.freeze({ ruleCode: 'supervision_postdoctoral', rate: 1.5 })
});

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value) {
  const parsed = number(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function fixed(value) {
  if (value === null) return null;
  return Math.round((value + Number.EPSILON) * 1000000) / 1000000;
}

function ruleMeta(ruleCode) {
  const rule = RULE_BY_CODE[ruleCode] || null;
  return rule ? {
    ruleCode,
    ruleLabel: rule.ruleLabel,
    sourceReference: rule.sourceReference,
    calculatorSource: CALCULATOR_SOURCE,
    calculatorVersion: CALCULATOR_VERSION
  } : {
    ruleCode,
    ruleLabel: null,
    sourceReference: null,
    calculatorSource: CALCULATOR_SOURCE,
    calculatorVersion: CALCULATOR_VERSION
  };
}

function review(reason, extra = {}) {
  return {
    applicable: true,
    calculatedDoe: null,
    status: 'needs-review',
    reviewReason: reason,
    ...extra
  };
}

function notApplicable(reason = 'session-type-not-covered-by-doe-calculator') {
  return {
    applicable: false,
    calculatedDoe: null,
    status: 'not-applicable',
    reviewReason: null,
    note: reason,
    calculatorSource: CALCULATOR_SOURCE,
    calculatorVersion: CALCULATOR_VERSION
  };
}

function calculateTeachingRule(assignment = {}) {
  const sessionType = text(assignment.sessionType);
  if (DOE_NON_CREDIT_SESSION_TYPE_SET.has(sessionType)) return notApplicable();

  const teachingRole = text(assignment.teachingRole);
  const selected = TEACHING_ROLE_RULES[teachingRole];
  if (!selected) return review('teaching-role-not-covered-by-calculator', {
    teachingRole: teachingRole || null,
    sessionType: sessionType || null,
    calculatorSource: CALCULATOR_SOURCE,
    calculatorVersion: CALCULATOR_VERSION
  });

  const quantity = nonNegative(assignment.doeQuantity ?? assignment.creditedHours);
  if (quantity === null) return review('credited-hours-required', {
    rate: selected.rate,
    unit: 'credited hour',
    ...ruleMeta(selected.ruleCode)
  });

  return {
    applicable: true,
    calculatedDoe: fixed(selected.rate * quantity),
    rate: selected.rate,
    quantity,
    unit: 'credited hour',
    status: 'calculated',
    reviewReason: null,
    ...ruleMeta(selected.ruleCode)
  };
}

function resolveTeachingDoe(assignment = {}) {
  const stored = number(assignment.doeCredit);
  const calculation = calculateTeachingRule(assignment);
  if (!calculation.applicable) {
    return {
      ...calculation,
      storedDoe: stored,
      effectiveDoe: stored,
      source: stored === null ? 'not-applicable' : 'stored'
    };
  }

  const calculated = calculation.calculatedDoe;
  if (stored !== null) {
    const mismatch = calculated !== null && Math.abs(stored - calculated) > TOLERANCE;
    return {
      ...calculation,
      storedDoe: stored,
      effectiveDoe: stored,
      source: 'stored',
      status: mismatch ? 'stored-calculation-mismatch' : 'stored',
      reviewReason: mismatch ? 'stored-doe-differs-from-calculator' : null,
      requiresReview: mismatch
    };
  }

  return {
    ...calculation,
    storedDoe: null,
    effectiveDoe: calculated,
    source: calculated === null ? 'missing' : 'calculator',
    requiresReview: calculation.status === 'needs-review'
  };
}

function calculateCourseCoordinatorDoe(courseUnits) {
  const units = nonNegative(courseUnits);
  if (units === null) return review('course-units-required', { calculatorSource: CALCULATOR_SOURCE, calculatorVersion: CALCULATOR_VERSION });
  let ruleCode;
  let rate;
  if (units < 3) [ruleCode, rate] = ['course_coordination_lt3', 1.75];
  else if (units < 6) [ruleCode, rate] = ['course_coordination_3_5', 3.5];
  else if (units < 10) [ruleCode, rate] = ['course_coordination_6_9', 7];
  else if (units < 15) [ruleCode, rate] = ['course_coordination_10_14', 10];
  else [ruleCode, rate] = ['course_coordination_15_plus', 15];
  return {
    applicable: true,
    calculatedDoe: rate,
    rate,
    quantity: units,
    unit: 'course unit',
    status: 'calculated',
    reviewReason: null,
    ...ruleMeta(ruleCode)
  };
}

function calculateHiccDoe(courseUnits, { developmentApplicable = null } = {}) {
  if (developmentApplicable === null || developmentApplicable === undefined) {
    return review('hicc-development-applicability-required', { ...ruleMeta('hicc_curriculum_development') });
  }
  const units = nonNegative(courseUnits);
  if (units === null) return review('course-units-required', { rate: 2, unit: 'course unit', ...ruleMeta('hicc_curriculum_development') });
  if (developmentApplicable === false) {
    return {
      applicable: false,
      calculatedDoe: 0,
      rate: 0,
      quantity: units,
      unit: 'course unit',
      status: 'not-applicable',
      reviewReason: null,
      ...ruleMeta('hicc_curriculum_development')
    };
  }
  return {
    applicable: true,
    calculatedDoe: fixed(units * 2),
    rate: 2,
    quantity: units,
    unit: 'course unit',
    status: 'calculated',
    reviewReason: null,
    ...ruleMeta('hicc_curriculum_development')
  };
}

function calculateViscDoe(academicYear, subjectCount = 1) {
  const year = text(academicYear);
  const selected = VISC_RATE_BY_YEAR[year] || (year && /^20(?:2[89]|[3-9]\d)-/.test(year) ? VISC_RATE_BY_YEAR['2028+'] : null);
  if (!selected) return review('visc-year-not-covered-by-calculator', { academicYear: year || null, calculatorSource: CALCULATOR_SOURCE, calculatorVersion: CALCULATOR_VERSION });
  const quantity = nonNegative(subjectCount);
  if (quantity === null || quantity === 0) return review('visc-subject-count-required', { rate: selected.rate, unit: 'subject', ...ruleMeta(selected.ruleCode) });
  return {
    applicable: true,
    calculatedDoe: fixed(selected.rate * quantity),
    rate: selected.rate,
    quantity,
    unit: 'subject',
    status: 'calculated',
    reviewReason: null,
    ...ruleMeta(selected.ruleCode)
  };
}

function calculateRotationParticipantDoe(rotationWeeks) {
  const weeks = nonNegative(rotationWeeks);
  if (weeks === null) return review('rotation-weeks-required', { rate: 2.5, unit: 'week', ...ruleMeta('rotation_participant') });
  return {
    applicable: true,
    calculatedDoe: fixed(weeks * 2.5),
    rate: 2.5,
    quantity: weeks,
    unit: 'week',
    status: 'calculated',
    reviewReason: null,
    ...ruleMeta('rotation_participant')
  };
}

function calculateRotationCoordinationDoe(uniqueRotationTypes = 1) {
  const quantity = nonNegative(uniqueRotationTypes);
  if (quantity === null || quantity === 0) return review('rotation-type-count-required', { rate: 2, unit: 'unique rotation type', ...ruleMeta('rotation_coordination') });
  return {
    applicable: true,
    calculatedDoe: fixed(quantity * 2),
    rate: 2,
    quantity,
    unit: 'unique rotation type',
    status: 'calculated',
    reviewReason: null,
    ...ruleMeta('rotation_coordination')
  };
}

function calculateCccDoe(shiftCount) {
  const quantity = nonNegative(shiftCount);
  if (quantity === null) return review('ccc-shift-count-required', { rate: 0.5, unit: 'shift', ...ruleMeta('ccc_shift') });
  return {
    applicable: true,
    calculatedDoe: fixed(quantity * 0.5),
    rate: 0.5,
    quantity,
    unit: 'shift',
    status: 'calculated',
    reviewReason: null,
    ...ruleMeta('ccc_shift')
  };
}

function calculateSupervisionDoe(counts = {}) {
  const components = [];
  let supplied = 0;
  let total = 0;
  for (const [key, config] of Object.entries(SUPERVISION_RATES)) {
    const value = nonNegative(counts[key]);
    if (value === null) continue;
    supplied += 1;
    const doe = fixed(value * config.rate);
    total += doe;
    components.push({ key, count: value, rate: config.rate, doe, ...ruleMeta(config.ruleCode) });
  }
  if (!supplied) return review('trainee-counts-required', { calculatorSource: CALCULATOR_SOURCE, calculatorVersion: CALCULATOR_VERSION, components: [] });
  return {
    applicable: true,
    calculatedDoe: fixed(total),
    status: 'calculated',
    reviewReason: null,
    components,
    calculatorSource: CALCULATOR_SOURCE,
    calculatorVersion: CALCULATOR_VERSION
  };
}

function calculateTraineeReserveReference({ teachingDoe, teachingFocused = false } = {}) {
  const teaching = nonNegative(teachingDoe);
  if (teaching === null) return review('teaching-doe-required-for-trainee-reserve', { calculatorSource: CALCULATOR_SOURCE, calculatorVersion: CALCULATOR_VERSION });
  if (teachingFocused) {
    return {
      applicable: true,
      calculatedDoe: null,
      ceilingDoe: 7.5,
      status: 'ceiling-only',
      reviewReason: null,
      ...ruleMeta('teaching_focused_reserve_ceiling')
    };
  }
  if (teaching <= 35) {
    return {
      applicable: true,
      calculatedDoe: fixed(teaching / 2),
      ceilingDoe: fixed(teaching / 2),
      status: 'reserve-reference',
      reviewReason: null,
      ...ruleMeta('supervision_reserve_split')
    };
  }
  return {
    applicable: true,
    calculatedDoe: null,
    ceilingDoe: 15,
    status: 'ceiling-only',
    reviewReason: null,
    ...ruleMeta('supervision_reserve_ceiling')
  };
}

function calculateRoleRule(role = {}, inputs = {}) {
  const roleType = text(role.roleType);
  const academicYear = text(role.academicYear || inputs.academicYear);
  const course = text(role.courseOrSubjectOrRotation || role.courseName);
  const catalog = academicYear === '2026-27' && course ? courseEvidence(course) : null;
  const courseUnits = inputs.courseUnits ?? role.courseUnits ?? catalog?.courseUnits ?? null;
  const hiccDevelopmentApplicable = inputs.developmentApplicable
    ?? role.developmentApplicable
    ?? catalog?.hiccDevelopmentApplicable
    ?? null;

  switch (roleType) {
    case 'VISC': {
      const inferredOneSubject = course ? 1 : null;
      return { ...calculateViscDoe(academicYear, inputs.subjectCount ?? role.subjectCount ?? inferredOneSubject), prorationSensitive: true, candidateBasis: 'full-year-reference-before-proration' };
    }
    case 'Designated Rotation Coordinator': {
      const inferredOneType = course ? 1 : null;
      return calculateRotationCoordinationDoe(inputs.uniqueRotationTypes ?? role.uniqueRotationTypes ?? inferredOneType);
    }
    case 'Rotation Participant':
      return calculateRotationParticipantDoe(inputs.rotationWeeks ?? role.rotationWeeks);
    case 'CCC':
      return calculateCccDoe(inputs.shiftCount ?? role.shiftCount);
    case 'Course Coordinator':
      return { ...calculateCourseCoordinatorDoe(courseUnits), courseUnits, courseEvidenceSource: catalog?.source || null, prorationSensitive: true, candidateBasis: 'full-year-reference-before-proration' };
    case 'HICC':
      return {
        ...calculateHiccDoe(courseUnits, { developmentApplicable: hiccDevelopmentApplicable }),
        courseUnits,
        hiccDevelopmentApplicable,
        courseEvidenceSource: catalog?.source || null,
        prorationSensitive: true,
        candidateBasis: 'full-year-reference-before-proration'
      };
    case 'Course Coordinator / HICC (legacy ambiguous)': {
      const cc = calculateCourseCoordinatorDoe(courseUnits);
      const hicc = calculateHiccDoe(courseUnits, { developmentApplicable: hiccDevelopmentApplicable });
      return review('legacy-course-coordinator-hicc-role-must-be-resolved', {
        courseUnits,
        hiccDevelopmentApplicable,
        candidates: {
          courseCoordinatorDoe: cc.calculatedDoe,
          courseCoordinatorRuleCode: cc.ruleCode || null,
          hiccDoe: hicc.calculatedDoe,
          hiccRuleCode: hicc.ruleCode || null
        },
        candidateBasis: 'full-year-reference-before-proration',
        courseEvidenceSource: catalog?.source || null,
        calculatorSource: CALCULATOR_SOURCE,
        calculatorVersion: CALCULATOR_VERSION
      });
    }
    default:
      return review('role-type-not-covered-by-calculator', {
        roleType: roleType || null,
        calculatorSource: CALCULATOR_SOURCE,
        calculatorVersion: CALCULATOR_VERSION
      });
  }
}

function resolveRoleDoe(role = {}, inputs = {}) {
  const mapped = number(role.doeMappedValue);
  const override = number(role.doeOverrideValue);
  const calculation = role.sourceAllocationStatus === 'source_missing' && mapped === null && override === null
    ? review('source-allocation-missing') : calculateRoleRule(role, inputs);
  const calculated = calculation.calculatedDoe;
  const stored = override !== null ? override : mapped;
  const hasTemporalWindow = Boolean(text(role.effectiveDate) || text(role.expirationDate));
  const prorationReview = stored === null
    && calculated !== null
    && calculated !== 0
    && calculation.prorationSensitive === true
    && hasTemporalWindow;
  const effective = override !== null
    ? override
    : mapped !== null
      ? mapped
      : prorationReview
        ? null
        : calculated;
  const source = override !== null
    ? 'override'
    : mapped !== null
      ? 'mapped'
      : prorationReview
        ? 'missing'
        : calculated !== null
          ? 'calculator'
          : 'missing';

  // A stored value on a dated annual/stage role may already be the approved
  // case-by-case proration. Comparing it with the full-year reference would
  // create a false mismatch, so date-sensitive full-year references remain
  // evidence only whenever a temporal window is present.
  const comparableToFullYear = !(calculation.prorationSensitive === true && hasTemporalWindow);
  const mismatch = stored !== null
    && calculated !== null
    && comparableToFullYear
    && Math.abs(stored - calculated) > TOLERANCE;
  const unresolvedReason = prorationReview
    ? 'role-date-proration-review-required'
    : calculation.reviewReason;

  return {
    ...calculation,
    mappedDoe: mapped,
    overrideDoe: override,
    effectiveDoe: effective,
    source,
    status: mismatch
      ? 'stored-calculation-mismatch'
      : source === 'missing'
        ? 'needs-review'
        : source,
    reviewReason: mismatch
      ? 'stored-doe-differs-from-calculator'
      : source === 'missing'
        ? unresolvedReason
        : null,
    requiresReview: mismatch || source === 'missing',
    hasTemporalWindow,
    prorationReview,
    candidateBasis: calculation.candidateBasis || (calculation.prorationSensitive === true ? 'full-year-reference-before-proration' : null)
  };
}

module.exports = {
  CALCULATOR_SOURCE,
  CALCULATOR_VERSION,
  DOE_NON_CREDIT_SESSION_TYPES,
  TEACHING_ROLE_RULES,
  calculateTeachingRule,
  resolveTeachingDoe,
  calculateCourseCoordinatorDoe,
  calculateHiccDoe,
  calculateViscDoe,
  calculateRotationParticipantDoe,
  calculateRotationCoordinationDoe,
  calculateCccDoe,
  calculateSupervisionDoe,
  calculateTraineeReserveReference,
  calculateRoleRule,
  resolveRoleDoe
};
