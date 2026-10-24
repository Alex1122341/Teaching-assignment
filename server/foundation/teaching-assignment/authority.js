'use strict';

const SUBJECT_KEY = /^[a-z][a-z0-9_-]{0,63}$/;
const CANONICAL_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const COURSE_CODE = /^[A-Z]{2,10} [0-9]{3,4}[A-Z]?$/;
const ACADEMIC_YEAR = /^(\d{4})-(\d{2})$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const ASSIGNMENT_MODES = new Set(['exclusive', 'concurrent']);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function normalizeSubjectKey(value) { const key = text(value).toLowerCase(); return SUBJECT_KEY.test(key) ? key : ''; }
function normalizeCourseCode(value) { const code = text(value).replace(/\s+/g, ' ').toUpperCase(); return COURSE_CODE.test(code) ? code : ''; }
function validRevision(value) { return Number.isInteger(value) && value >= 0; }
function validFingerprint(value) { return typeof value === 'string' && FINGERPRINT.test(value); }

function subjectRecord(input = {}) {
  const subjectKey = normalizeSubjectKey(input.subjectKey), label = text(input.label);
  if (!subjectKey || !label || label.length > 100 || typeof input.active !== 'boolean') throw new Error('Invalid Subject record.');
  return Object.freeze({subjectKey, label, active: input.active});
}

function responsibilityRecord(input = {}) {
  const responsibilityId = text(input.responsibilityId), kind = text(input.kind).toLowerCase(), label = text(input.label);
  if (!CANONICAL_ID.test(responsibilityId) || !['hicc', 'visc'].includes(kind) || !label || label.length > 120 || typeof input.active !== 'boolean') throw new Error('Invalid Teaching Responsibility record.');
  return Object.freeze({responsibilityId, kind, label, active: input.active});
}

function academicYear(value) {
  const year = text(value), match = ACADEMIC_YEAR.exec(year);
  return match && Number(match[2]) === (Number(match[1]) + 1) % 100 ? year : '';
}

function canonicalId(value, field) {
  const id = text(value);
  if (!CANONICAL_ID.test(id)) throw new Error(`${field} must be a canonical identifier.`);
  return id;
}

function packageIdentity({academicYear: year, groupId, hiccResponsibilityId} = {}) {
  const normalizedYear = academicYear(year);
  if (!normalizedYear) throw new Error('Academic Year must use YYYY-YY.');
  return `ta-package-v1__${normalizedYear}__${canonicalId(groupId, 'groupId')}__${canonicalId(hiccResponsibilityId, 'hiccResponsibilityId')}`;
}

function dateMs(value) {
  const raw = text(value instanceof Date ? value.toISOString().slice(0, 10) : value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : date.getTime();
}

function normalizeAssignmentMode(value) {
  const mode = text(value);
  return ASSIGNMENT_MODES.has(mode) ? mode : '';
}

function isCurrentTemporalAssignee(input = {}) {
  const start = dateMs(input.activeDate), end = dateMs(input.expirationDate), asOf = dateMs(input.asOfDate);
  return Boolean(normalizeAssignmentMode(input.assignmentMode) && input.enabled !== false && text(input.authenticatedFacultyId) && text(input.authenticatedFacultyId) === text(input.facultyId) && start !== null && end !== null && asOf !== null && end > start && asOf >= start && asOf < end);
}

function validateTemporalAssignees(rows) {
  if (!Array.isArray(rows)) throw new Error('Temporal assignees must be a list.');
  const byResponsibilityYear = new Map();
  rows.forEach(row => {
    if (!normalizeAssignmentMode(row?.assignmentMode)) throw new Error('Temporal assignee assignment mode is invalid.');
    const start = dateMs(row?.activeDate), end = dateMs(row?.expirationDate);
    if (start === null || end === null || end <= start) throw new Error('Temporal assignee expiration must be later than active date.');
    const responsibilityId = text(row?.responsibilityId), year = academicYear(row?.academicYear), facultyId = text(row?.facultyId);
    if (!CANONICAL_ID.test(responsibilityId) || !year || !facultyId) throw new Error('Temporal assignee partition identity is invalid.');
    const key = `${responsibilityId}\u0000${year}`;
    const bucket = byResponsibilityYear.get(key) || [];
    bucket.push({start, end, facultyId, assignmentMode: normalizeAssignmentMode(row?.assignmentMode)});
    byResponsibilityYear.set(key, bucket);
  });
  for (const windows of byResponsibilityYear.values()) {
    windows.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let leftIndex = 0; leftIndex < windows.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < windows.length; rightIndex += 1) {
        const left = windows[leftIndex], right = windows[rightIndex];
        if (right.start >= left.end) break;
        if (!left.facultyId || left.facultyId === right.facultyId || left.assignmentMode !== 'concurrent' || right.assignmentMode !== 'concurrent') {
          throw new Error('Temporal assignee windows overlap.');
        }
      }
    }
  }
  return true;
}

function isSubmittedRevisionFresh(record = {}) {
  return validRevision(record.workingRevision) && validRevision(record.submittedWorkingRevision) && record.submittedWorkingRevision === record.workingRevision && validFingerprint(record.reviewFingerprint);
}

function storedApprovalIntegrity(record = {}) {
  return validRevision(record.workingRevision) && validRevision(record.submittedWorkingRevision) && validRevision(record.viscApprovedWorkingRevision) && record.submittedWorkingRevision === record.viscApprovedWorkingRevision && validFingerprint(record.reviewFingerprint) && validFingerprint(record.viscApprovedFingerprint) && record.reviewFingerprint === record.viscApprovedFingerprint && record.workingRevision >= record.viscApprovedWorkingRevision;
}

function isApprovedRevisionFresh(record = {}) {
  return storedApprovalIntegrity(record) && record.workingRevision === record.viscApprovedWorkingRevision;
}

function hasCurrentViscReview(record = {}) {
  return text(record.status) === 'visc_review' && isSubmittedRevisionFresh(record) && record.viscApprovedWorkingRevision === null && record.viscApprovedFingerprint === null;
}

function hasCurrentViscApproval(record = {}) {
  return text(record.status) === 'visc_approved' && storedApprovalIntegrity(record) && isApprovedRevisionFresh(record);
}

function packageStateIntegrity(record = {}) {
  const status = text(record.status);
  if (!validRevision(record.workingRevision)) return false;
  if (status === 'draft') {
    return record.submittedWorkingRevision === null && record.reviewFingerprint === null && record.viscApprovedWorkingRevision === null && record.viscApprovedFingerprint === null;
  }
  if (status === 'changes_requested') {
    return validRevision(record.submittedWorkingRevision) && record.submittedWorkingRevision <= record.workingRevision && validFingerprint(record.reviewFingerprint) && record.viscApprovedWorkingRevision === null && record.viscApprovedFingerprint === null;
  }
  if (status === 'visc_review') return hasCurrentViscReview(record);
  if (status === 'visc_approved') return storedApprovalIntegrity(record);
  if (status === 'submitted_to_adfad' || status === 'adfad_finalized') return isApprovedRevisionFresh(record);
  return false;
}

function isPackageFresh(record = {}) {
  // Compatibility name only; authority uses packageStateIntegrity plus explicit freshness predicates.
  return packageStateIntegrity(record);
}

function packageIdentityMatches(record) {
  if (!record || !academicYear(record.academicYear) || !CANONICAL_ID.test(text(record.groupId)) || !CANONICAL_ID.test(text(record.hiccResponsibilityId))) return false;
  return record.packageIdentity === packageIdentity({academicYear: record.academicYear, groupId: record.groupId, hiccResponsibilityId: record.hiccResponsibilityId});
}

function trustedOwnership(session = {}) {
  const ownership = session.ownership || session.sessionOwnership || session;
  return {
    sessionId: text(ownership.sessionId),
    academicYear: text(ownership.academicYear),
    groupId: text(ownership.groupId),
    hiccResponsibilityId: text(ownership.hiccResponsibilityId),
    packageId: text(ownership.packageId),
    packageIdentity: text(ownership.packageIdentity),
    valid: !Object.prototype.hasOwnProperty.call(ownership, 'teachingAssignmentGroupId') && !Object.prototype.hasOwnProperty.call(ownership, 'responsibleHiccResponsibilityId') && !Object.prototype.hasOwnProperty.call(ownership, 'teachingAssignmentPackageId')
  };
}

function packageMatches(record, session) {
  const ownership = trustedOwnership(session), year = academicYear(ownership.academicYear);
  if (!ownership.valid || Object.prototype.hasOwnProperty.call(record || {}, 'teachingAssignmentPackageId') || !packageStateIntegrity(record) || !packageIdentityMatches(record) || !year || record.academicYear !== year || record.groupId !== ownership.groupId || !ownership.packageIdentity || ownership.packageIdentity !== record.packageIdentity || !ownership.packageId || ownership.packageId !== text(record.packageId)) return false;
  if (!ownership.hiccResponsibilityId || record.hiccResponsibilityId !== ownership.hiccResponsibilityId) return false;
  return true;
}

function packageHiccIsActive(input, record, group) {
  const packageHicc = input.packageHiccResponsibility || input.hiccResponsibility;
  return Boolean(packageHicc && text(packageHicc.responsibilityId) === record.hiccResponsibilityId && text(packageHicc.groupId) === text(group.groupId) && packageHicc.kind === 'hicc' && packageHicc.active === true && Array.isArray(group.hiccResponsibilityIds) && group.hiccResponsibilityIds.includes(record.hiccResponsibilityId));
}

function optionalSubject(value) {
  const raw = text(value);
  if (!raw) return null;
  const normalized = normalizeSubjectKey(raw);
  return normalized || false;
}

function exactHiccScope(scopes, session) {
  const course = normalizeCourseCode(session?.courseCode), subject = optionalSubject(session?.subjectKey);
  if (!course || subject === false || !Array.isArray(scopes)) return false;
  return scopes.some(scope => {
    const scopedCourse = normalizeCourseCode(scope?.courseCode), scopedSubject = optionalSubject(scope?.subjectKey);
    return scopedCourse === course && (scopedSubject === null || scopedSubject === subject);
  });
}

function isFacultyCurrentAssignee(input = {}) {
  const actor = text(input.authenticatedFacultyId), responsibility = input.responsibility, group = input.group, session = input.session;
  if (!actor || !responsibility || !group || !session || responsibility.active !== true || group.active !== true || !['hicc', 'visc'].includes(responsibility.kind)) return false;
  const responsibilityId = text(responsibility.responsibilityId);
  if (!responsibilityId) return false;
  const ownership = trustedOwnership(session), year = academicYear(ownership.academicYear);
  if (!year) return false;
  if (!Array.isArray(input.assignees)) return false;
  try { validateTemporalAssignees(input.assignees); } catch (_) { return false; }
  const active = input.assignees.filter(row => row.academicYear === year && text(row.responsibilityId) === responsibilityId && isCurrentTemporalAssignee({...row, authenticatedFacultyId: actor, asOfDate: input.asOfDate}));
  if (active.length !== 1) return false;
  const [assignee] = active;
  if (!assignee || text(assignee.responsibilityId) !== responsibilityId || text(assignee.academicYear) !== year || !isCurrentTemporalAssignee({...assignee, authenticatedFacultyId: actor, asOfDate: input.asOfDate})) return false;
  if (text(group.groupId) !== text(input.package?.groupId) || text(group.groupId) !== trustedOwnership(session).groupId) return false;
  if (responsibility.kind === 'hicc') return responsibilityId === text(input.package?.hiccResponsibilityId) && responsibilityId === trustedOwnership(session).hiccResponsibilityId && Array.isArray(group.hiccResponsibilityIds) && group.hiccResponsibilityIds.includes(responsibilityId) && packageMatches(input.package, session) && exactHiccScope(input.responsibilityScopes, session);
  return group.leaderViscResponsibilityId === responsibilityId && packageMatches(input.package, session) && packageHiccIsActive(input, input.package, group);
}

function workingSessionOwnership(input = {}) {
  const year = academicYear(input.academicYear), groupId = canonicalId(input.groupId, 'groupId'), hiccResponsibilityId = canonicalId(input.hiccResponsibilityId, 'hiccResponsibilityId'), sessionId = text(input.sessionId), packageId = text(input.packageId);
  if (!year || !sessionId || !packageId) throw new Error('Working session ownership requires a session, package, and Academic Year.');
  return Object.freeze({sessionId, academicYear: year, groupId, hiccResponsibilityId, packageId, packageIdentity: packageIdentity({academicYear: year, groupId, hiccResponsibilityId}), subjectId: input.subjectId ?? null, subjectKey: input.subjectKey ?? null, courseCode: input.courseCode ?? null});
}

module.exports = Object.freeze({normalizeSubjectKey, normalizeCourseCode, normalizeAssignmentMode, subjectRecord, responsibilityRecord, packageIdentity, isCurrentTemporalAssignee, validateTemporalAssignees, isSubmittedRevisionFresh, isApprovedRevisionFresh, hasCurrentViscReview, hasCurrentViscApproval, packageStateIntegrity, isPackageFresh, exactHiccScope, isFacultyCurrentAssignee, workingSessionOwnership});
