'use strict';

const { randomUUID } = require('node:crypto');

const text = value => String(value ?? '').trim();
const ROLE_CATEGORY = new Map([
  ['course coordinator', 'course_coordination'], ['course coordinator / hicc', 'hicc'], ['hicc', 'hicc'],
  ['visc', 'visc'], ['rotation / week lead', 'rotation'], ['ccc', 'course_coordination'],
  ['trainee / supervision', 'supervision'], ['special project', 'approved_activity'], ['other', 'other']
]);
const ALLOWED_ROLES = new Set(ROLE_CATEGORY.keys());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clone = value => JSON.parse(JSON.stringify(value));

function assignmentError(code, message) { return Object.assign(new Error(message), { code }); }

function createDoeAssignmentService({ repository, calculationService, idFactory = randomUUID, calculationIdFactory = randomUUID, auditIdFactory = randomUUID, clock = () => new Date() } = {}) {
  if (!repository?.saveDoeAssignment || !repository?.deactivateDoeAssignment) throw new TypeError('DOE assignment repository is required.');
  if (!calculationService?.preview) throw new TypeError('DOE calculation preview service is required.');

  async function saveDoeAssignment({ actor = {}, academicYear, facultyId, assignmentFactId = '', expectedRevision = 0, facts = {}, notes = '', trigger = 'faculty_edit' } = {}) {
    const year = text(academicYear), faculty = text(facultyId), roleType = text(facts?.roleType);
    if (!/^\d{4}-\d{2}$/.test(year) || !UUID.test(faculty)) throw assignmentError('DOE_ASSIGNMENT_INVALID', 'Faculty ID and Academic Year are required.');
    if (!facts || typeof facts !== 'object' || Array.isArray(facts) || !ALLOWED_ROLES.has(roleType.toLowerCase())) {
      throw assignmentError('DOE_ASSIGNMENT_INVALID', 'A supported DOE role type and assignment facts are required.');
    }
    const id = text(assignmentFactId) || idFactory();
    if (!UUID.test(id)) throw assignmentError('DOE_ASSIGNMENT_INVALID', 'DOE assignment identity is invalid.');
    if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) throw assignmentError('DOE_REVISION_INVALID', 'An expected non-negative assignment revision is required.');
    if (assignmentFactId && Number(expectedRevision) < 1) throw assignmentError('DOE_REVISION_INVALID', 'Editing an existing DOE assignment requires its current revision.');
    if (!assignmentFactId && Number(expectedRevision) !== 0) throw assignmentError('DOE_REVISION_INVALID', 'A new DOE assignment must start at revision zero.');
    const category = ROLE_CATEGORY.get(roleType.toLowerCase());
    const cleanFacts = { ...facts, academicYear: year, facultyId: faculty, category, activityType: roleType, roleType };
    for (const field of ['doeCredit', 'doeRate', 'resultDoe', 'policyVersionId', 'ruleId', 'ruleKey', 'calculationId']) delete cleanFacts[field];
    const preview = await calculationService.preview({ academicYear: year, facts: cleanFacts, calculatedBy: text(actor.uid) });
    if (!preview || preview.ok !== true || !Number.isFinite(Number(preview.resultDoe)) || !text(preview.policyVersionId)) {
      throw assignmentError('NEEDS_REVIEW', 'The server could not produce an authoritative DOE result for these assignment facts.');
    }
    const now = clock(), changedAt = now instanceof Date ? now.toISOString() : String(now);
    const calculation = {
      calculationId: calculationIdFactory(), academicYear: year, policyVersionId: text(preview.policyVersionId), policyRevision: Number(preview.policyRevision),
      ruleId: text(preview.ruleId) || null, ruleKey: text(preview.ruleKey) || null, exceptionId: text(preview.exceptionId) || null,
      category, facultyId: faculty, sessionId: text(cleanFacts.sessionId) || null, assignmentId: id,
      sourceEntityType: 'doe_assignment', sourceEntityId: id,
      factsSnapshot: clone(preview.factsSnapshot || cleanFacts), inputsSnapshot: clone(preview.inputsSnapshot || {}),
      parameterSnapshot: clone(preview.parameterSnapshot || {}), ruleSnapshot: clone(preview.ruleSnapshot || {}),
      referenceSnapshot: preview.referenceSnapshot ? clone(preview.referenceSnapshot) : null,
      calculationText: text(preview.calculationText), resultDoe: Number(preview.resultDoe), status: 'calculated',
      calculationTrigger: text(trigger) || 'faculty_edit', calculatedBy: text(actor.uid), calculatedAt: changedAt
    };
    const assignment = {
      assignmentFactId: id, facultyId: faculty, academicYear: year, category,
      roleType, activityType: roleType, scopeText: text(facts.scopeText || facts.courseCode || facts.subjectKey),
      courseCode: text(facts.courseCode) || null, subjectKey: text(facts.subjectKey) || null,
      sessionId: text(facts.sessionId) || null, sessionAssignmentId: null,
      sourceEntityType: 'doe_assignment', sourceEntityId: id,
      notes: text(notes).slice(0, 1000) || null, active: true,
      inputs: Object.fromEntries(Object.entries(cleanFacts).filter(([key, value]) =>
        !['academicYear','category','roleType','activityType','courseCode','subjectKey','facultyId','sessionId','scopeText','assignmentId','sourceEntityType','sourceEntityId'].includes(key) &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      )),
      revision: Number(expectedRevision) + 1, createdBy: text(actor.uid), updatedBy: text(actor.uid), updatedAt: changedAt
    };
    const auditRecord = {
      auditEventId: auditIdFactory(), policyVersionId: calculation.policyVersionId, academicYear: year,
      action: assignmentFactId ? 'doe_assignment_updated' : 'doe_assignment_created',
      entityType: 'doe_assignment', entityId: id, facultyId: faculty, actorUid: text(actor.uid),
      before: null, after: { ...assignment, currentCalculationId: calculation.calculationId, resultDoe: calculation.resultDoe }, changedAt
    };
    const saved = await repository.saveDoeAssignment({ assignment, calculation, auditRecord, expectedRevision: Number(expectedRevision) });
    return { ...saved, assignmentFactId: id, calculationId: calculation.calculationId, resultDoe: calculation.resultDoe, policyVersionId: calculation.policyVersionId, ruleKey: calculation.ruleKey, revision: assignment.revision };
  }

  async function deactivateDoeAssignment({ actor = {}, facultyId, academicYear, assignmentFactId, expectedRevision, reason = '' } = {}) {
    const faculty = text(facultyId), year = text(academicYear), id = text(assignmentFactId);
    if (!UUID.test(faculty) || !UUID.test(id) || !/^\d{4}-\d{2}$/.test(year) || !Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 1) {
      throw assignmentError('DOE_ASSIGNMENT_INVALID', 'Faculty ID, Academic Year, assignment ID and current revision are required.');
    }
    const result = await repository.deactivateDoeAssignment({
      actorUid: text(actor.uid), facultyId: faculty, academicYear: year, assignmentFactId: id,
      expectedRevision: Number(expectedRevision), reason: text(reason).slice(0, 1000)
    });
    return { ...result, assignmentFactId: id, active: false };
  }

  return Object.freeze({ saveDoeAssignment, deactivateDoeAssignment });
}

module.exports = { createDoeAssignmentService, ROLE_CATEGORY };
