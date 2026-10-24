'use strict';

const { InvalidAcademicYearError, resolveAcademicYear } = require('../data/academic-year');
const { isAdministratorRole, isGeneralRole, normalizeBaseRole } = require('../auth/role-policy');
const SELF_WORKSHEET = new Set(['faculty', 'hicc', 'visc']);
const FACT_FIELDS = new Set([
  'category','activityType','roleType','teachingRole','courseCode','subjectKey','facultyId','sessionId','assignmentId',
  'week','year','stage','hours','shifts','weeks','trainees','targetDoe','baseDoe','fte','quantity','date',
  'sourceEntityType','sourceEntityId','subjectName','units','courseUnitCount','curriculumStage','hiccEligible',
  'developmentPhase','stream','teachingTarget','rawSupervision','assignedTeaching','scopeText'
]);
const ok = body => ({ status: 200, body });
const fail = (status, code, message) => ({ status, body: { error: { code, message } } });
const text = value => value === null || value === undefined ? '' : String(value).trim();
const SQL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalYear(value) {
  try { return resolveAcademicYear(value); }
  catch (caught) {
    if (caught instanceof InvalidAcademicYearError) return null;
    throw caught;
  }
}

function validateFacts(facts) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return false;
  const entries = Object.entries(facts);
  if (!entries.length || entries.length > 64) return false;
  return entries.every(([key, value]) => FACT_FIELDS.has(key) &&
    (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') &&
    (typeof value !== 'number' || Number.isFinite(value)) &&
    (typeof value !== 'string' || value.length <= 1000));
}

function createDoeApi({ verifyToken, findUser, repository, calculationService, worksheetService, assignmentService, manualAssignmentService, targetOverrideService, workflowPreviewService, policyService, writeGates = {} } = {}) {
  if (!verifyToken || !findUser || !repository || !calculationService) throw new TypeError('DOE API requires authentication, SQL repositories, and the calculation service.');
  async function actor(token) {
    if (!token) return { response: fail(401, 'UNAUTHENTICATED', 'A Firebase bearer token is required.') };
    let decoded;
    try { decoded = await verifyToken(token); }
    catch (_) { return { response: fail(401, 'UNAUTHENTICATED', 'The Firebase bearer token is invalid.') }; }
    const uid = text(decoded?.uid);
    if (!uid) return { response: fail(401, 'UNAUTHENTICATED', 'The Firebase identity is unavailable.') };
    let user;
    try { user = await findUser(uid); }
    catch (_) { return { response: fail(503, 'SERVICE_UNAVAILABLE', 'The SQL user profile service is unavailable.') }; }
    if (!user || user.active !== true) return { response: fail(403, 'PROFILE_REQUIRED', 'An active SQL user profile is required.') };
    if (user.mustChangePassword === true) return { response: fail(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change is required before DOE access.') };
    const role = normalizeBaseRole(user.baseRole);
    return { uid, user, role };
  }
  async function invoke(token, adminOnly, action) {
    const identity = await actor(token);
    if (identity.response) return identity.response;
    if (adminOnly && !isAdministratorRole(identity.role)) return fail(403, 'ROLE_DENIED', 'This role cannot access DOE administration.');
    try { return await action(identity); }
    catch (caught) {
      const status = ['INVALID_ACADEMIC_YEAR','INVALID_FACTS','DOE_POLICY_REQUIRED','DOE_DRAFT_INVALID','DOE_WORKFLOW_PREVIEW_INVALID','MANUAL_DOE_INVALID'].includes(caught.code) ? 400
        : caught.code === 'MANUAL_DOE_REVISION_CONFLICT' ? 409
        : ['MANUAL_DOE_NOT_FOUND','MANUAL_DOE_FACULTY_NOT_FOUND'].includes(caught.code) ? 404
        : ['ACTIVE_POLICY_REQUIRED','DOE_POLICY_REVISION_CONFLICT','DOE_VALIDATION_REQUIRED','DOE_IMPACT_REQUIRED','DOE_POLICY_NOT_DRAFT','DOE_COPY_YEAR_SAME','DOE_POLICY_VERSION_LABEL_EXISTS'].includes(caught.code) ? 409
        : caught.code === 'DOE_POLICY_NOT_FOUND' ? 404
        : caught.code === 'SESSION_NOT_FOUND' ? 404
        : ['FACULTY_TRANSFER_INVALID','FACULTY_ASSIGNMENT_AMBIGUOUS','FACULTY_ALREADY_ASSIGNED'].includes(caught.code) ? 422
        : caught.code === 'DOE_VALIDATION_FAILED' ? 422
        : ['COURSE_MAPPING_REQUIRED','SUBJECT_MAPPING_REQUIRED','REQUIRED_INPUT_MISSING','NEEDS_REVIEW','AMBIGUOUS_RULE','EXCEPTION_AMBIGUOUS','MAPPING_INVALID','MAPPING_REQUIREMENT_INVALID','CALCULATION_MODE_INVALID','PARAMETER_MISSING','PARAMETER_INVALID','TIER_INVALID','TIER_NOT_FOUND','OUTPUT_NON_FINITE','OUTPUT_OUT_OF_RANGE'].includes(caught.code) ? 422
        : 503;
      if (status === 503) return fail(status, 'DOE_UNAVAILABLE', 'The DOE service is temporarily unavailable.');
      return fail(status, caught.code, caught.message);
    }
  }

  return Object.freeze({
    async writeCapabilities(token) {
      return invoke(token, true, async () => ok({ writeCapabilities: {
        doeAdmin: writeGates.doeAdmin === true,
        doeManualAssignment: writeGates.doeManualAssignment === true && writeGates.facultyAdmin === true,
        doePolicyPublish: writeGates.doePolicyPublish === true,
        doeRecalculate: writeGates.doeRecalculate === true
      } }));
    },
    async manualScopeSuggestions(token, { academicYear } = {}) {
      const year = canonicalYear(academicYear);
      if (!year) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A valid Academic Year is required.');
      return invoke(token, true, async () => {
        if (!manualAssignmentService) return fail(503, 'DOE_UNAVAILABLE', 'Manual DOE is unavailable.');
        return ok({ suggestions: await manualAssignmentService.scopeSuggestions(year) });
      });
    },
    async saveManualAssignment(token, payload, assignmentId = '', deactivate = false) {
      return invoke(token, true, async identity => {
        if (writeGates.doeManualAssignment !== true || writeGates.facultyAdmin !== true) return fail(503, 'WRITE_DISABLED', 'Manual DOE assignment writes are currently disabled.');
        if (!manualAssignmentService) return fail(503, 'DOE_UNAVAILABLE', 'Manual DOE is unavailable.');
        return ok({ assignment: await manualAssignmentService.save({ actorUid: identity.uid, payload, assignmentId, deactivate }) });
      });
    },
    async policyVersion(token, { policyVersionId } = {}) {
      if (!text(policyVersionId)) return fail(400, 'DOE_POLICY_REQUIRED', 'A policy version ID is required.');
      return invoke(token, true, async () => {
        const policy = await repository.getPolicyVersion(text(policyVersionId));
        if (policy && repository.getImpactPreview) policy.impactPreview = await repository.getImpactPreview(text(policyVersionId));
        return policy ? ok({ policy }) : fail(404, 'DOE_POLICY_NOT_FOUND', 'DOE policy version was not found.');
      });
    },
    async createPolicyDraft(token, payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !['academicYear','versionLabel','sourceReference'].includes(key))) return fail(400, 'DOE_DRAFT_INVALID', 'Draft accepts only year, label, and source provenance.');
      const year = canonicalYear(payload.academicYear);
      if (!year) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A valid Academic Year is required.');
      return invoke(token, true, async identity => {
        if (writeGates.doeAdmin !== true) return fail(503, 'WRITE_DISABLED', 'DOE Draft writes are currently disabled.');
        if (!policyService?.createDraft) return fail(503, 'DOE_UNAVAILABLE', 'DOE policy lifecycle is unavailable.');
        return ok({ policy: await policyService.createDraft({ ...payload, academicYear: year, actorUid: identity.uid }) });
      });
    },
    async savePolicyDraft(token, policyVersionId, payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !['expectedRevision','patch'].includes(key)) || !Number.isSafeInteger(payload.expectedRevision)) return fail(400, 'DOE_DRAFT_INVALID', 'Draft update requires an expected revision and supported changes.');
      return invoke(token, true, async identity => {
        if (writeGates.doeAdmin !== true) return fail(503, 'WRITE_DISABLED', 'DOE Draft writes are currently disabled.');
        if (!policyService?.saveDraft) return fail(503, 'DOE_UNAVAILABLE', 'DOE policy lifecycle is unavailable.');
        return ok({ policy: await policyService.saveDraft({ policyVersionId, expectedRevision: payload.expectedRevision, patch: payload.patch, actorUid: identity.uid }) });
      });
    },
    async validatePolicyDraft(token, policyVersionId, payload) {
      if (!payload || !Number.isSafeInteger(payload.expectedRevision)) return fail(400, 'DOE_DRAFT_INVALID', 'Validation requires the current Draft revision.');
      return invoke(token, true, async identity => {
        if (writeGates.doeAdmin !== true) return fail(503, 'WRITE_DISABLED', 'DOE policy validation writes are currently disabled.');
        if (!policyService?.validateDraft) return fail(503, 'DOE_UNAVAILABLE', 'DOE policy lifecycle is unavailable.');
        return ok({ validation: await policyService.validateDraft({ policyVersionId, expectedRevision: payload.expectedRevision, actorUid: identity.uid }) });
      });
    },
    async previewPolicyImpact(token, policyVersionId, payload) {
      if (!payload || !Number.isSafeInteger(payload.expectedRevision)) return fail(400, 'DOE_DRAFT_INVALID', 'Impact Preview requires the current Draft revision.');
      return invoke(token, true, async identity => {
        if (writeGates.doeAdmin !== true) return fail(503, 'WRITE_DISABLED', 'DOE Impact Preview is currently disabled.');
        if (!policyService?.previewImpact) return fail(503, 'DOE_UNAVAILABLE', 'DOE policy lifecycle is unavailable.');
        return ok({ impact: await policyService.previewImpact({ policyVersionId, expectedRevision: payload.expectedRevision, actorUid: identity.uid }) });
      });
    },
    async publishPolicyDraft(token, policyVersionId, payload) {
      if (!payload || !Number.isSafeInteger(payload.expectedRevision)) return fail(400, 'DOE_DRAFT_INVALID', 'Publish requires the current Draft revision.');
      return invoke(token, true, async identity => {
        if (writeGates.doePolicyPublish !== true) return fail(503, 'WRITE_DISABLED', 'DOE policy publishing is currently disabled.');
        if (!isGeneralRole(identity.role)) return fail(403, 'ROLE_DENIED', 'This account cannot publish DOE policies.');
        if (!policyService?.publishDraft) return fail(503, 'DOE_UNAVAILABLE', 'DOE policy lifecycle is unavailable.');
        return ok({ publication: await policyService.publishDraft({ policyVersionId, expectedRevision: payload.expectedRevision, actorUid: identity.uid }) });
      });
    },
    async copyPolicy(token, payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !['sourcePolicyVersionId','academicYear','mode'].includes(key))) return fail(400, 'DOE_DRAFT_INVALID', 'Copy accepts a source policy, target Academic Year and optional clone mode.');
      if (payload.mode !== undefined && !['clone','working_draft'].includes(payload.mode)) return fail(400, 'DOE_DRAFT_INVALID', 'Unsupported policy copy mode.');
      const year = canonicalYear(payload.academicYear);
      if (!year || !text(payload.sourcePolicyVersionId)) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A source Rule Book and valid target Academic Year are required.');
      return invoke(token, true, async identity => {
        if (writeGates.doeAdmin !== true) return fail(503, 'WRITE_DISABLED', 'DOE Rule Book copy is currently disabled.');
        if (!policyService?.copyPreviousYear) return fail(503, 'DOE_UNAVAILABLE', 'DOE policy lifecycle is unavailable.');
        return ok({ policy: await policyService.copyPreviousYear({ ...payload, academicYear: year, actorUid: identity.uid }) });
      });
    },
    async policyHistory(token, { academicYear } = {}) {
      const year = canonicalYear(academicYear);
      if (!year) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A valid Academic Year is required.');
      return invoke(token, true, async () => {
        if (!policyService?.listHistory) return fail(503, 'DOE_UNAVAILABLE', 'DOE policy history is unavailable.');
        return ok({ history: await policyService.listHistory(year) });
      });
    },
    async archivePolicy(token, policyVersionId, payload) {
      if (!payload || !Number.isSafeInteger(payload.expectedRevision)) return fail(400, 'DOE_DRAFT_INVALID', 'Archive requires the expected policy revision.');
      return invoke(token, true, async identity => {
        if (writeGates.doePolicyPublish !== true) return fail(503, 'WRITE_DISABLED', 'DOE policy lifecycle writes are currently disabled.');
        if (!isGeneralRole(identity.role)) return fail(403, 'ROLE_DENIED', 'This account cannot archive DOE policies.');
        if (!policyService?.archive) return fail(503, 'DOE_UNAVAILABLE', 'DOE policy lifecycle is unavailable.');
        return ok({ policy: await policyService.archive({ policyVersionId, expectedRevision: payload.expectedRevision, actorUid: identity.uid }) });
      });
    },
    async recalculate(token, payload) {
      const year = canonicalYear(payload?.academicYear);
      if (!year) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A valid Academic Year is required.');
      return invoke(token, true, async identity => {
        if (writeGates.doeRecalculate !== true) return fail(503, 'WRITE_DISABLED', 'DOE recalculation is currently disabled.');
        if (!isGeneralRole(identity.role)) return fail(403, 'ROLE_DENIED', 'This account cannot run global DOE recalculation.');
        if (!policyService?.recalculate) return fail(503, 'DOE_UNAVAILABLE', 'DOE recalculation is unavailable.');
        if (payload.preview !== undefined && typeof payload.preview !== 'boolean') return fail(400, 'DOE_DRAFT_INVALID', 'Preview must be a boolean.');
        return ok({ recalculation: await policyService.recalculate({ academicYear: year, actorUid: identity.uid, limit: payload.limit, preview: payload.preview === true, expectedPolicyVersionId: payload.expectedPolicyVersionId, expectedPolicyRevision: payload.expectedPolicyRevision }) });
      });
    },
    async activePolicy(token, { academicYear } = {}) {
      const year = canonicalYear(academicYear);
      if (!year) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A valid academic year is required.');
      return invoke(token, true, async () => {
        const policy = await repository.loadActivePolicy(year);
        return policy ? ok({ policy }) : fail(404, 'ACTIVE_POLICY_NOT_FOUND', 'No active Rule Book exists for this academic year.');
      });
    },
    async preview(token, payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
          Object.keys(payload).some(key => !['academicYear','facts'].includes(key))) {
        return fail(400, 'INVALID_PREVIEW', 'Preview accepts only academicYear and assignment facts.');
      }
      const year = canonicalYear(payload.academicYear);
      if (!year) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A valid academic year is required.');
      if (!validateFacts(payload.facts)) return fail(400, 'INVALID_FACTS', 'Preview requires bounded, supported assignment facts.');
      return invoke(token, true, async identity => {
        const facts = { ...payload.facts, academicYear: year };
        const preview = await calculationService.preview({ academicYear: year, facts, calculatedBy: identity.uid });
        return ok({ preview });
      });
    },
    async previewWorkflow(token, payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
          Object.keys(payload).some(key => !['sessionId','outgoingFacultyId','incomingFacultyId'].includes(key))) {
        return fail(400, 'DOE_WORKFLOW_PREVIEW_INVALID', 'Workflow preview accepts only session and faculty identities.');
      }
      if (![payload.sessionId, payload.outgoingFacultyId, payload.incomingFacultyId].every(value => SQL_ID.test(text(value)))) {
        return fail(400, 'DOE_WORKFLOW_PREVIEW_INVALID', 'Session and faculty identities must be SQL IDs.');
      }
      return invoke(token, true, async () => {
        if (!workflowPreviewService?.previewFacultyTransfer) return fail(503, 'DOE_UNAVAILABLE', 'The DOE workflow preview is temporarily unavailable.');
        const preview = await workflowPreviewService.previewFacultyTransfer({
          sessionId: text(payload.sessionId), outgoingFacultyId: text(payload.outgoingFacultyId), incomingFacultyId: text(payload.incomingFacultyId)
        });
        return ok({ preview });
      });
    },
    async worksheet(token, { academicYear, facultyId } = {}) {
      const year = canonicalYear(academicYear), id = text(facultyId);
      if (!year) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A valid academic year is required.');
      if (!id) return fail(400, 'FACULTY_ID_REQUIRED', 'A Faculty ID is required.');
      const identity = await actor(token);
      if (identity.response) return identity.response;
      const self = text(identity.user.facultyId).toLowerCase() === id.toLowerCase();
      if (!isAdministratorRole(identity.role) && !(SELF_WORKSHEET.has(identity.role) && self)) return fail(403, 'ROLE_DENIED', 'This role cannot read the requested Faculty DOE worksheet.');
      if (!worksheetService?.buildFacultyWorksheet) return fail(503, 'DOE_UNAVAILABLE', 'The DOE worksheet service is temporarily unavailable.');
      try { return ok({ worksheet: await worksheetService.buildFacultyWorksheet({ facultyId: id, academicYear: year }) }); }
      catch (_) { return fail(503, 'DOE_UNAVAILABLE', 'The DOE worksheet service is temporarily unavailable.'); }
    },
    async listWorksheets(token, { academicYear } = {}) {
      const year = canonicalYear(academicYear);
      if (!year) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A valid academic year is required.');
      if (!worksheetService?.listFacultyDoe) return fail(503, 'DOE_UNAVAILABLE', 'The DOE worksheet service is temporarily unavailable.');
      return invoke(token, true, async () => ok({ worksheets: await worksheetService.listFacultyDoe({ academicYear: year }) }));
    },
    async saveAssignment(token, payload, { assignmentFactId = '' } = {}) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
          Object.keys(payload).some(key => !['academicYear','facultyId','expectedRevision','facts','notes','trigger'].includes(key))) {
        return fail(400, 'INVALID_ASSIGNMENT', 'DOE assignment accepts only annual identity and assignment facts.');
      }
      const year = canonicalYear(payload.academicYear);
      if (!year) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A valid academic year is required.');
      if (!text(payload.facultyId) || !payload.facts || typeof payload.facts !== 'object' || Array.isArray(payload.facts)) return fail(400, 'INVALID_ASSIGNMENT', 'Faculty ID and assignment facts are required.');
      if (assignmentFactId && (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 1)) return fail(400, 'DOE_REVISION_INVALID', 'Editing an assignment requires its current revision.');
      if (!assignmentFactId && payload.expectedRevision !== undefined && payload.expectedRevision !== 0) return fail(400, 'DOE_REVISION_INVALID', 'A new assignment must start at revision zero.');
      return invoke(token, true, async identity => {
        if (writeGates.doeAdmin !== true) return fail(503, 'WRITE_DISABLED', 'DOE assignment writes are currently disabled.');
        if (!assignmentService?.saveDoeAssignment) return fail(503, 'DOE_UNAVAILABLE', 'The DOE assignment service is temporarily unavailable.');
        const result = await assignmentService.saveDoeAssignment({
          actor: { uid: identity.uid, role: identity.role, name: identity.user.displayName, email: identity.user.email },
          academicYear: year, facultyId: payload.facultyId, assignmentFactId,
          expectedRevision: payload.expectedRevision ?? (assignmentFactId ? null : 0), facts: payload.facts,
          notes: payload.notes, trigger: payload.trigger || 'faculty_edit'
        });
        return { status: 200, body: { assignment: result } };
      });
    },
    async deactivateAssignment(token, payload, assignmentFactId) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
          Object.keys(payload).some(key => !['academicYear','facultyId','expectedRevision','reason'].includes(key))) {
        return fail(400, 'INVALID_ASSIGNMENT', 'DOE assignment deactivation accepts only identity and revision fields.');
      }
      const year = canonicalYear(payload.academicYear);
      if (!year) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A valid academic year is required.');
      return invoke(token, true, async identity => {
        if (writeGates.doeAdmin !== true) return fail(503, 'WRITE_DISABLED', 'DOE assignment writes are currently disabled.');
        if (!assignmentService?.deactivateDoeAssignment) return fail(503, 'DOE_UNAVAILABLE', 'The DOE assignment service is temporarily unavailable.');
        const result = await assignmentService.deactivateDoeAssignment({
          actor: { uid: identity.uid, role: identity.role, name: identity.user.displayName, email: identity.user.email },
          academicYear: year, facultyId: payload.facultyId, assignmentFactId,
          expectedRevision: payload.expectedRevision, reason: payload.reason
        });
        return { status: 200, body: { assignment: result } };
      });
    },
    async saveTargetOverride(token, facultyId, payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
          Object.keys(payload).some(key => !['academicYear','override'].includes(key))) {
        return fail(400, 'INVALID_TARGET_OVERRIDE', 'Target override accepts only Academic Year and override facts.');
      }
      const year = canonicalYear(payload.academicYear);
      if (!year) return fail(400, 'INVALID_ACADEMIC_YEAR', 'A valid Academic Year is required.');
      if (!Object.prototype.hasOwnProperty.call(payload, 'override')) return fail(400, 'INVALID_TARGET_OVERRIDE', 'Override must be provided explicitly; use null to clear it.');
      return invoke(token, true, async identity => {
        if (writeGates.doeAdmin !== true) return fail(503, 'WRITE_DISABLED', 'DOE target writes are currently disabled.');
        if (!targetOverrideService?.saveOverride) return fail(503, 'DOE_UNAVAILABLE', 'The DOE target service is temporarily unavailable.');
        const result = await targetOverrideService.saveOverride({
          actor: { uid: identity.uid, role: identity.role, name: identity.user.displayName, email: identity.user.email },
          facultyId, academicYear: year, override: payload.override ?? null
        });
        return { status: 200, body: { target: result } };
      });
    }
  });
}

module.exports = { createDoeApi, validateDoeFacts: validateFacts, DOE_FACT_FIELDS: FACT_FIELDS };
