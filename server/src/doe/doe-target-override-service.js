'use strict';

const { randomUUID } = require('node:crypto');
const { InvalidAcademicYearError, resolveAcademicYear } = require('../data/academic-year');
const { isAdministratorRole } = require('../auth/role-policy');
const REASONS = new Set(['RSL','Mat Leave','Sick Leave','Special Event','Other']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = value => String(value ?? '').trim();
const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const doeError = (code, message, status = 422) => Object.assign(new Error(message), { code, status });

function createDoeTargetOverrideService({ repository, auditIdFactory = randomUUID, clock = () => new Date() } = {}) {
  if (!repository?.getFacultyTargetSource || !repository?.saveFacultyTargetOverride) throw new TypeError('DOE Faculty target repository is required.');

  async function saveOverride({ actor = {}, facultyId, academicYear, override = null } = {}) {
    const role = text(actor.role).toLowerCase(), faculty = text(facultyId);
    if (!isAdministratorRole(role)) throw doeError('FORBIDDEN', 'This account cannot edit Faculty DOE targets.', 403);
    if (!UUID.test(faculty)) throw doeError('DOE_TARGET_INVALID', 'A valid Faculty ID is required.');
    let year;
    try { year = resolveAcademicYear(academicYear); }
    catch (error) { if (error instanceof InvalidAcademicYearError) throw doeError('INVALID_ACADEMIC_YEAR', 'A valid Academic Year is required.', 400); throw error; }

    const current = await repository.getFacultyTargetSource(faculty, year);
    if (!current) throw doeError('FACULTY_NOT_FOUND', 'Faculty record was not found.', 404);
    const contractTeachingDoe = finite(current.contractTeachingDoe);
    let overrideDoe = null, overrideReason = null, overrideNotes = null;
    if (override !== null && override !== undefined) {
      if (!override || typeof override !== 'object' || Array.isArray(override)) throw doeError('DOE_TARGET_OVERRIDE_INVALID', 'An override must contain a non-negative value and approved reason.');
      overrideDoe = finite(override.value);
      overrideReason = text(override.reason);
      overrideNotes = text(override.notes) || null;
      if (overrideDoe === null || overrideDoe < 0 || !REASONS.has(overrideReason) || overrideNotes?.length > 2000) {
        throw doeError('DOE_TARGET_OVERRIDE_INVALID', 'Override requires a non-negative DOE value and a supported reason; notes may not exceed 2000 characters.');
      }
    }
    const effectiveTargetDoe = overrideDoe === null ? contractTeachingDoe : overrideDoe;
    const now = clock(), changedAt = now instanceof Date ? now.toISOString() : String(now);
    const target = {
      facultyId: faculty, academicYear: year, contractTeachingDoe, overrideDoe, overrideReason, overrideNotes,
      effectiveTargetDoe, source: overrideDoe === null ? text(current.source || 'contract') : 'approved_override',
      policyVersionId: text(current.policyVersionId) || null, updatedBy: text(actor.uid), updatedAt: changedAt
    };
    const auditRecord = {
      auditEventId: auditIdFactory(), policyVersionId: target.policyVersionId, academicYear: year,
      action: overrideDoe === null ? 'faculty_doe_override_cleared' : 'faculty_doe_override_saved',
      entityType: 'faculty_doe_target', entityId: current.doeFacultyTargetId || `${faculty}--${year}`, facultyId: faculty,
      actorUid: text(actor.uid), before: current, after: target, changedAt
    };
    return repository.saveFacultyTargetOverride({ target, auditRecord });
  }

  return Object.freeze({ saveOverride });
}

module.exports = { createDoeTargetOverrideService, DOE_OVERRIDE_REASONS: [...REASONS] };
