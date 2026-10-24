'use strict';

const crypto = require('node:crypto');
const engine = require('../domain/doe-policy-engine');
const reserve = require('./doe-reserve-service');

class DoePolicyLifecycleError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'DoePolicyLifecycleError'; this.code = code; Object.assign(this, details); }
}

const text = value => value === null || value === undefined ? '' : String(value).trim();
const checksum = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const DRAFT_COLLECTIONS = ['rules','references','exceptions','courseMappings','subjectMappings'];

function validateMappings(bundle, errors) {
  for (const row of bundle.courseMappings || []) {
    const code = text(row.courseCode);
    if (!code || row.unitCount !== null && row.unitCount !== undefined && (!Number.isFinite(Number(row.unitCount)) || Number(row.unitCount) <= 0)) {
      errors.push({ code: 'COURSE_MAPPING_INVALID', message: 'Course Mapping requires a canonical course code and positive units when supplied.', mappingId: text(row.mappingId) });
    }
    if (row.mappingFactsJson && typeof row.mappingFactsJson === 'string') {
      try { if (!JSON.parse(row.mappingFactsJson) || Array.isArray(JSON.parse(row.mappingFactsJson))) throw new Error(); }
      catch (_) { errors.push({ code: 'COURSE_MAPPING_INVALID', message: 'Course Mapping facts must be a JSON object.', mappingId: text(row.mappingId) }); }
    }
  }
  for (const row of bundle.subjectMappings || []) {
    if (!text(row.subjectKey) || !text(row.subjectName)) errors.push({ code: 'SUBJECT_MAPPING_INVALID', message: 'VISC Subject Mapping requires a canonical subject key and name.', mappingId: text(row.mappingId) });
  }
}

function createDoePolicyService({ repository, calculationService } = {}) {
  const required = ['getPolicyVersion','createDraft','saveDraft','markValidated','previewImpact','publishPolicy','clonePolicy','listHistory','archivePolicy','recalculate'];
  if (!repository || required.some(name => typeof repository[name] !== 'function')) throw new TypeError('DOE policy lifecycle repository is incomplete.');

  async function getDraft(policyVersionId, expectedRevision) {
    const id = text(policyVersionId);
    if (!id) throw new DoePolicyLifecycleError('DOE_POLICY_REQUIRED', 'A policy version ID is required.');
    const bundle = await repository.getPolicyVersion(id);
    if (!bundle) throw new DoePolicyLifecycleError('DOE_POLICY_NOT_FOUND', 'DOE policy version was not found.');
    const version = bundle.version || {};
    if (text(version.status).toLowerCase() !== 'draft') throw new DoePolicyLifecycleError('DOE_POLICY_NOT_DRAFT', 'Only Draft DOE policy versions may be changed.');
    if (!Number.isSafeInteger(expectedRevision) || Number(version.revision) !== expectedRevision) {
      throw new DoePolicyLifecycleError('DOE_POLICY_REVISION_CONFLICT', 'DOE policy Draft changed; reload before saving.', { currentRevision: Number(version.revision) });
    }
    return bundle;
  }

  return Object.freeze({
    async createDraft({ academicYear, versionLabel, sourceReference, actorUid } = {}) {
      const year = text(academicYear);
      if (!/^\d{4}-\d{2}$/.test(year)) throw new DoePolicyLifecycleError('INVALID_ACADEMIC_YEAR', 'A canonical Academic Year is required.');
      if (!text(versionLabel) || !text(sourceReference)) throw new DoePolicyLifecycleError('DOE_DRAFT_INVALID', 'Draft label and source provenance are required.');
      return repository.createDraft({ academicYear: year, versionLabel: text(versionLabel), sourceReference: text(sourceReference), actorUid });
    },

    async saveDraft({ policyVersionId, expectedRevision, patch, actorUid } = {}) {
      const before = await getDraft(policyVersionId, expectedRevision);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !DRAFT_COLLECTIONS.includes(key) && key !== 'versionLabel' && key !== 'sourceReference' && key !== 'reservePolicy')) {
        throw new DoePolicyLifecycleError('DOE_DRAFT_INVALID', 'Draft update contains unsupported policy fields.');
      }
      const updated = { ...before };
      for (const key of DRAFT_COLLECTIONS) if (Object.prototype.hasOwnProperty.call(patch, key)) {
        if (!Array.isArray(patch[key])) throw new DoePolicyLifecycleError('DOE_DRAFT_INVALID', `${key} must be a list.`);
        updated[key] = patch[key];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'versionLabel')) updated.version = { ...updated.version, versionLabel: text(patch.versionLabel) };
      if (Object.prototype.hasOwnProperty.call(patch, 'sourceReference')) updated.version = { ...updated.version, sourceReference: text(patch.sourceReference) };
      if (Object.prototype.hasOwnProperty.call(patch, 'reservePolicy')) updated.reservePolicy = patch.reservePolicy;
      const version = await repository.saveDraft({ policyVersionId, academicYear: before.version.academicYear, expectedRevision, actorUid, bundle: updated });
      return { ...updated, version: { ...before.version, ...version } };
    },

    async validateDraft({ policyVersionId, expectedRevision, actorUid } = {}) {
      const bundle = await getDraft(policyVersionId, expectedRevision);
      const result = engine.validatePolicy(bundle);
      const references = new Set((bundle.references || []).map(item => text(item.referenceId)).filter(Boolean));
      for (const rule of bundle.rules || []) {
        if (rule.enabled !== false && !text(rule.referenceId)) result.errors.push({ code: 'REFERENCE_REQUIRED', message: `Rule ${text(rule.ruleKey)} requires a structured source reference.`, ruleId: text(rule.ruleId) });
        if (text(rule.referenceId) && !references.has(text(rule.referenceId))) result.errors.push({ code: 'REFERENCE_REQUIRED', message: `Rule ${text(rule.ruleKey)} references a missing structured source.`, ruleId: text(rule.ruleId), referenceId: text(rule.referenceId) });
      }
      const usedReferences = new Set((bundle.rules || []).filter(rule => rule.enabled !== false).map(rule => text(rule.referenceId)).filter(Boolean));
      for (const reference of bundle.references || []) if (usedReferences.has(text(reference.referenceId)) && text(reference.reviewStatus) !== 'approved') result.errors.push({ code: 'REFERENCE_REVIEW_REQUIRED', message: 'Linked guideline reference requires annual review before publication.', referenceId: text(reference.referenceId) });
      for (const mapping of [...(bundle.courseMappings || []), ...(bundle.subjectMappings || [])]) {
        if (text(mapping.referenceId) && !references.has(text(mapping.referenceId))) result.errors.push({ code: 'REFERENCE_REQUIRED', message: 'Mapping references a missing structured source.', mappingId: text(mapping.mappingId), referenceId: text(mapping.referenceId) });
      }
      validateMappings(bundle, result.errors);
      if ((bundle.rules || []).some(rule => rule.enabled !== false && text(rule.category) === 'reserve')) {
        try { reserve.normalizePolicy(bundle.reservePolicy); }
        catch (error) { result.errors.push({ code: error.code || 'RESERVE_POLICY_INVALID', message: error.message }); }
      }
      result.valid = result.errors.length === 0;
      const policyChecksum = checksum({ version: { academicYear: bundle.version.academicYear, revision: expectedRevision }, rules: bundle.rules || [], references: bundle.references || [], exceptions: bundle.exceptions || [], courseMappings: bundle.courseMappings || [], subjectMappings: bundle.subjectMappings || [], reservePolicy: bundle.reservePolicy || null });
      const recorded = await repository.markValidated({ policyVersionId, academicYear: bundle.version.academicYear, revision: expectedRevision, checksum: policyChecksum, valid: result.valid, errors: result.errors, actorUid });
      return { ...result, revision: expectedRevision, checksum: policyChecksum, ...recorded };
    },

    async previewImpact({ policyVersionId, expectedRevision, actorUid } = {}) {
      const bundle = await getDraft(policyVersionId, expectedRevision);
      if (!calculationService || typeof calculationService.previewWithPolicy !== 'function') throw new DoePolicyLifecycleError('DOE_IMPACT_PREVIEW_UNAVAILABLE', 'The DOE policy calculation runner is unavailable.');
      const validation = await this.validateDraft({ policyVersionId, expectedRevision, actorUid });
      if (!validation.valid) throw new DoePolicyLifecycleError('DOE_VALIDATION_FAILED', 'Rule Book must validate before Impact Preview.', { errors: validation.errors });
      const calculate = facts => calculationService.previewWithPolicy({ policyBundle: bundle, academicYear: bundle.version.academicYear, facts });
      return repository.previewImpact({ policyVersionId, academicYear: bundle.version.academicYear, revision: expectedRevision, checksum: validation.checksum, actorUid, calculate });
    },

    async publishDraft({ policyVersionId, expectedRevision, actorUid } = {}) {
      const bundle = await getDraft(policyVersionId, expectedRevision);
      const version = bundle.version;
      if (Number(version.validatedRevision) !== expectedRevision) throw new DoePolicyLifecycleError('DOE_VALIDATION_REQUIRED', 'The current Draft revision must pass validation before publishing.');
      if (Number(version.impactRevision) !== expectedRevision) throw new DoePolicyLifecycleError('DOE_IMPACT_REQUIRED', 'Impact Preview is required for the current Draft revision before publishing.');
      return repository.publishPolicy({ policyVersionId, academicYear: version.academicYear, revision: expectedRevision, actorUid });
    },

    async copyPreviousYear({ sourcePolicyVersionId, academicYear, actorUid, mode } = {}) {
      const targetYear = text(academicYear);
      if (!/^\d{4}-\d{2}$/.test(targetYear)) throw new DoePolicyLifecycleError('INVALID_ACADEMIC_YEAR', 'A canonical target Academic Year is required.');
      const source = await repository.getPolicyVersion(text(sourcePolicyVersionId));
      if (!source) throw new DoePolicyLifecycleError('DOE_POLICY_NOT_FOUND', 'Source Rule Book was not found.');
      if (!['clone','working_draft'].includes(mode) && text(source.version.academicYear) === targetYear) throw new DoePolicyLifecycleError('DOE_COPY_YEAR_SAME', 'Copy must create a Draft for a different Academic Year.');
      if (['clone','working_draft'].includes(mode) && text(source.version.academicYear) !== targetYear) throw new DoePolicyLifecycleError('DOE_DRAFT_INVALID', 'Clone stays within its source Academic Year. Use Copy for a different year.');
      if (mode === 'working_draft' && text(source.version.status).toLowerCase() !== 'active') throw new DoePolicyLifecycleError('ACTIVE_POLICY_REQUIRED', 'Working Draft requires the current Active policy.');
      return repository.clonePolicy({ sourcePolicyVersionId, sourceAcademicYear: source.version.academicYear, academicYear: targetYear, actorUid, includeExceptions: mode === 'working_draft', reuseWorkingDraft: mode === 'working_draft' });
    },

    listHistory(academicYear) { return repository.listHistory(text(academicYear)); },
    archive({ policyVersionId, expectedRevision, actorUid } = {}) { return repository.archivePolicy({ policyVersionId, expectedRevision, actorUid }); },
    recalculate({ academicYear, actorUid, limit, preview = false, expectedPolicyVersionId, expectedPolicyRevision } = {}) {
      if (!calculationService || typeof calculationService.previewWithPolicy !== 'function') throw new DoePolicyLifecycleError('DOE_RECALCULATION_UNAVAILABLE', 'The active-policy calculation runner is unavailable.');
      const year = text(academicYear);
      if (typeof repository.loadActivePolicy !== 'function') throw new DoePolicyLifecycleError('DOE_RECALCULATION_UNAVAILABLE', 'The active Rule Book repository is unavailable.');
      return repository.loadActivePolicy(year).then(bundle => {
        if (!bundle || text(bundle.version?.status).toLowerCase() !== 'active') throw new DoePolicyLifecycleError('ACTIVE_POLICY_REQUIRED', `No active DOE policy is available for ${year}.`);
        if ((expectedPolicyVersionId && text(expectedPolicyVersionId) !== text(bundle.version.policyVersionId)) || (expectedPolicyRevision !== undefined && Number(expectedPolicyRevision) !== Number(bundle.version.revision))) throw new DoePolicyLifecycleError('DOE_POLICY_REVISION_CONFLICT', 'Active policy changed after preview. Preview again before recalculating.');
        const calculate = facts => calculationService.previewWithPolicy({ policyBundle: bundle, academicYear: year, facts });
        return repository.recalculate({ academicYear: year, policyVersionId: bundle.version.policyVersionId, policyRevision: Number(bundle.version.revision), actorUid, limit, calculate, preview });
      });
    }
  });
}

module.exports = { createDoePolicyService, DoePolicyLifecycleError };
