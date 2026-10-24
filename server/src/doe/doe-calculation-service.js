'use strict';

const engine = require('../domain/doe-policy-engine');

const text = value => value === null || value === undefined ? '' : String(value).trim();
const normalized = value => text(value).toUpperCase();
const MAPPING_DERIVED_FACTS = new Set(['units','courseUnitCount','curriculumStage','hiccEligible','developmentPhase']);

function doeError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function parseFactsJson(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    throw doeError('MAPPING_INVALID', 'The annual DOE mapping contains invalid facts.');
  }
}

function findMapping(rows, value, fields) {
  const key = normalized(value);
  if (!key) return null;
  const matches = (rows || []).filter(row => row.enabled !== false &&
    [...fields.map(field => row[field]), ...(parseFactsJson(row.mappingFactsJson || row.mappingFacts).aliases || [])]
      .some(alias => normalized(alias) === key));
  if (matches.length > 1) throw doeError('MAPPING_AMBIGUOUS', 'More than one annual mapping uses this code or alias.', { value });
  return matches[0] || null;
}

function mappingFor(bundle, rule, facts) {
  const requirement = text(rule.mappingRequirement).toLowerCase();
  if (!requirement) return { facts, mapping: null };
  if (requirement === 'course') {
    const courseCode = text(facts.courseCode);
    const mapping = findMapping(bundle.courseMappings, facts.courseLabel, ['courseCode']) || findMapping(bundle.courseMappings, courseCode, ['courseCode']);
    if (!mapping || text(mapping.reviewStatus || 'approved') !== 'approved' || (text(rule.category).toLowerCase() === 'hicc' && mapping.hiccEligible !== true)) {
      throw doeError('COURSE_MAPPING_REQUIRED', `An approved annual Course Mapping is required for ${courseCode || 'this assignment'}.`, { courseCode });
    }
    const enriched = { ...facts, ...parseFactsJson(mapping.mappingFactsJson || mapping.mappingFacts), courseCode: mapping.courseCode };
    if (mapping.unitCount !== null && mapping.unitCount !== undefined) enriched.units = Number(mapping.unitCount);
    if (mapping.curriculumStage) enriched.curriculumStage = mapping.curriculumStage;
    if (mapping.hiccEligible !== null && mapping.hiccEligible !== undefined) enriched.hiccEligible = mapping.hiccEligible === true;
    return { facts: enriched, mapping };
  }
  if (requirement === 'subject') {
    const subjectKey = text(facts.subjectKey);
    const mapping = findMapping(bundle.subjectMappings, subjectKey, ['subjectKey', 'subjectName']);
    if (!mapping || text(mapping.reviewStatus || 'approved') !== 'approved') {
      throw doeError('SUBJECT_MAPPING_REQUIRED', `An approved annual VISC Subject Mapping is required for ${subjectKey || 'this assignment'}.`, { subjectKey });
    }
    const enriched = { ...facts, ...parseFactsJson(mapping.mappingFactsJson || mapping.mappingFacts), subjectKey: mapping.subjectKey };
    if (mapping.curriculumStage) enriched.curriculumStage = mapping.curriculumStage;
    if (mapping.developmentPhase) enriched.developmentPhase = mapping.developmentPhase;
    return { facts: enriched, mapping };
  }
  throw doeError('MAPPING_REQUIREMENT_INVALID', 'The annual DOE rule has an unsupported mapping requirement.', { requirement });
}

function enrichFromKnownMappings(bundle, facts) {
  let enriched = { ...facts };
  const courseCode = text(facts.courseCode);
  const course = findMapping(bundle.courseMappings, facts.courseLabel, ['courseCode']) || findMapping(bundle.courseMappings, courseCode, ['courseCode']);
  if (course && text(course.reviewStatus || 'approved') === 'approved') {
    enriched = { ...enriched, ...parseFactsJson(course.mappingFactsJson || course.mappingFacts), courseCode: course.courseCode };
    if (course.unitCount !== null && course.unitCount !== undefined) enriched.units = Number(course.unitCount);
    if (course.curriculumStage) enriched.curriculumStage = course.curriculumStage;
    if (course.hiccEligible !== null && course.hiccEligible !== undefined) enriched.hiccEligible = course.hiccEligible === true;
  }
  const subjectKey = text(facts.subjectKey);
  const subject = findMapping(bundle.subjectMappings, subjectKey, ['subjectKey', 'subjectName']);
  if (subject && text(subject.reviewStatus || 'approved') === 'approved') {
    enriched = { ...enriched, ...parseFactsJson(subject.mappingFactsJson || subject.mappingFacts), subjectKey: subject.subjectKey };
    if (subject.curriculumStage) enriched.curriculumStage = subject.curriculumStage;
    if (subject.developmentPhase) enriched.developmentPhase = subject.developmentPhase;
  }
  return enriched;
}

function mappingSnapshot(mapping) {
  if (!mapping) return null;
  const { mappingFactsJson, ...evidence } = mapping;
  return { ...evidence, mappingFacts: parseFactsJson(mappingFactsJson) };
}

function unresolvedMapping(bundle, facts) {
  const category = text(facts.category);
  const candidates = (bundle.rules || []).filter(rule => {
    if (rule.enabled === false || text(rule.category) !== category || !['course','subject'].includes(text(rule.mappingRequirement))) return false;
    return (rule.selectors || []).every(selector => {
      if (engine.selectorMatches(selector, facts)) return true;
      return MAPPING_DERIVED_FACTS.has(text(selector.field)) && (facts[selector.field] === undefined || facts[selector.field] === null || facts[selector.field] === '');
    });
  });
  const requirement = candidates[0]?.mappingRequirement;
  if (requirement === 'course') throw doeError('COURSE_MAPPING_REQUIRED', `An approved annual Course Mapping is required for ${text(facts.courseCode) || 'this assignment'}.`, { courseCode: text(facts.courseCode) || null });
  if (requirement === 'subject') throw doeError('SUBJECT_MAPPING_REQUIRED', `An approved annual VISC Subject Mapping is required for ${text(facts.subjectKey) || 'this assignment'}.`, { subjectKey: text(facts.subjectKey) || null });
}

function createDoeCalculationService({ repository } = {}) {
  if (!repository || typeof repository.loadActivePolicy !== 'function') {
    throw new TypeError('An active DOE policy repository is required.');
  }

  async function previewAgainstBundle({ bundle, academicYear, facts = {} } = {}) {
      const year = text(academicYear);
      if (!/^\d{4}-\d{2}$/.test(year)) throw doeError('INVALID_ACADEMIC_YEAR', 'A canonical academic year is required.');
      if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw doeError('INVALID_FACTS', 'DOE assignment facts must be an object.');
      if (!bundle || !['active', 'draft'].includes(text(bundle.version?.status).toLowerCase()) || text(bundle.version?.academicYear) !== year) {
        throw doeError('DOE_POLICY_REQUIRED', `A valid annual DOE policy is required for ${year}.`, { academicYear: year });
      }

      const mappedFacts = enrichFromKnownMappings(bundle, facts);
      let selected;
      try {
        selected = engine.matchRule(bundle, mappedFacts, text(facts.category));
      } catch (caught) {
        if (caught.code === 'RULE_NOT_FOUND') {
          unresolvedMapping(bundle, mappedFacts);
          throw doeError('NEEDS_REVIEW', 'No annual DOE rule matches these assignment facts.', { causeCode: caught.code });
        }
        throw caught;
      }
      const rule = selected.rule;
      if (selected.source === 'rule' && text(rule.reviewStatus || 'approved') !== 'approved') {
        throw doeError('NEEDS_REVIEW', 'The matching annual DOE rule is not approved for calculation.', { ruleId: rule.ruleId });
      }
      if (selected.source === 'exception' && text(selected.exception.reviewStatus || 'approved') !== 'approved') {
        throw doeError('NEEDS_REVIEW', 'The matching annual DOE exception is not approved for calculation.', { exceptionId: selected.exception.exceptionId });
      }

      let enriched = mappedFacts;
      let mapping = null;
      if (selected.source === 'rule') ({ facts: enriched, mapping } = mappingFor(bundle, rule, enriched));
      let calculated;
      try {
        calculated = engine.calculate(bundle, enriched);
      } catch (caught) {
        if (caught.code === 'INPUT_MISSING' || caught.code === 'INPUT_INVALID') {
          throw doeError('REQUIRED_INPUT_MISSING', caught.message, { inputName: caught.inputName, causeCode: caught.code });
        }
        if (caught.code === 'RULE_NOT_FOUND') throw doeError('NEEDS_REVIEW', 'No annual DOE rule matches these assignment facts.', { causeCode: caught.code });
        throw caught;
      }

      const reference = selected.rule?.referenceId
        ? (bundle.references || []).find(row => text(row.referenceId) === text(selected.rule.referenceId))
        : null;
      if (selected.rule?.referenceId && (!reference || text(reference.reviewStatus || 'approved') !== 'approved')) {
        throw doeError('NEEDS_REVIEW', 'The matching annual DOE rule requires an approved structured source reference.', { ruleId: selected.rule.ruleId, referenceId: selected.rule.referenceId });
      }
      const referenceSnapshot = reference ? { ...reference } : selected.exception ? {
        title: text(selected.exception.sourceReference), sourceReference: text(selected.exception.sourceReference),
        reason: text(selected.exception.reason), exceptionId: text(selected.exception.exceptionId)
      } : null;

      return {
        ...calculated,
        ok: true,
        academicYear: year,
        policyVersionId: text(bundle.version.policyVersionId),
        policyRevision: Number(bundle.version.revision || 0),
        category: text(facts.category || rule?.category),
        factsSnapshot: { ...enriched },
        inputsSnapshot: { ...(calculated.inputs || {}) },
        parameterSnapshot: { ...(calculated.parameters || {}) },
        mappingSnapshot: mappingSnapshot(mapping),
        ruleSnapshot: { ...calculated.ruleSnapshot, ruleKey: calculated.ruleKey, category: text(rule?.category), label: text(rule?.ruleLabel), selectors: rule?.selectors || [] },
        referenceSnapshot,
        calculationText: `${calculated.resultDoe}% DOE${calculated.ruleKey ? ` · ${calculated.ruleKey}` : ''}`,
        status: 'calculated'
      };
  }

  return {
    async preview({ academicYear, facts = {} } = {}) {
      const year = text(academicYear);
      if (!/^\d{4}-\d{2}$/.test(year)) throw doeError('INVALID_ACADEMIC_YEAR', 'A canonical academic year is required.');
      const bundle = await repository.loadActivePolicy(year);
      if (!bundle || text(bundle.version?.status).toLowerCase() !== 'active' || text(bundle.version?.academicYear) !== year) {
        throw doeError('ACTIVE_POLICY_REQUIRED', `No active DOE policy is available for ${year}.`, { academicYear: year });
      }
      return previewAgainstBundle({ bundle, academicYear: year, facts });
    },
    previewWithPolicy({ policyBundle, academicYear, facts = {} } = {}) {
      return previewAgainstBundle({ bundle: policyBundle, academicYear, facts });
    }
  };
}

module.exports = { createDoeCalculationService, doeError };
