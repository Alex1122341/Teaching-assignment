'use strict';

// Firestore persistence for role assignments (appointments).
//
// Date semantics are NOT invented here. `server/src/roles/role-effective-status.js`
// is the authoritative classifier, shared with the Faculty Dashboard's
// faculty-role-periods.js and pinned by tests/leadership-directory-view.test.js:
//
//   * startDate and endDate are INCLUSIVE Calgary dates; a null endDate is
//     open-ended.
//   * Periods take precedence; a period with no start cannot prove anything
//     ("dates-needed").
//   * All periods in the future is "upcoming"; otherwise not-effective is
//     "inactive", which covers both "ended" and "a gap between periods".
//
// An earlier draft of the mapping document proposed exclusive end dates. That was
// wrong and is corrected: mixing the two would make "does the last day count?"
// silently ambiguous at every boundary.
//
// Status is DERIVED on read, never stored. A stored status would be a second
// source of truth that drifts the moment a date passes.

const { unsupported } = require('./firestore-session-repository');
const { classify, calgaryDate, validDate } = require('../../roles/role-effective-status');

const COLLECTION = 'role_assignments';
const AUDIT = 'role_assignment_audit';

// A responsibility is not a permission. `roleType` names the academic duty
// (HICC, VISC, ADC, LAB …); the account's permission role lives in `users.role`
// and is never written here.
const SCOPE_KINDS = new Set(['course', 'subject', 'rotation', 'none']);

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function isoFromTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function toPeriods(document) {
  const periods = Array.isArray(document.periods) ? document.periods : [];
  return periods.map(period => ({
    startDate: text(period && period.startDate) || null,
    endDate: text(period && period.endDate) || null
  }));
}

// Maps a stored assignment onto the classifier's input. The classifier wants
// `periodsJson` when a schedule exists, and the legacy single pair otherwise.
function toClassifierInput(document) {
  const periods = toPeriods(document);
  if (periods.length) return { hasSchedule: true, periodsJson: JSON.stringify(periods) };
  return {
    hasSchedule: false,
    effectiveDate: text(document.effectiveDate) || null,
    expirationDate: text(document.expirationDate) || null
  };
}

function toRecord(id, document, asOf) {
  const periods = toPeriods(document);
  const status = classify(toClassifierInput(document), asOf);
  return {
    roleAssignmentId: id,
    facultyId: text(document.facultyId),
    academicYear: text(document.academicYear),
    roleCategory: text(document.roleCategory),
    roleType: text(document.roleType),
    scopeKind: text(document.scopeKind) || 'none',
    scopeCode: text(document.scopeCode),
    periods,
    // Derived, never stored.
    status: status.status,
    statusStartDate: status.startDate,
    statusEndDate: status.endDate,
    nextStartDate: status.nextStartDate || null,
    revision: Number(document.revision) || 0,
    createdAtUtc: isoFromTimestamp(document.createdAtUtc),
    updatedAtUtc: isoFromTimestamp(document.updatedAtUtc),
    createdBy: text(document.createdBy),
    updatedBy: text(document.updatedBy)
  };
}

function validatePeriods(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return 'At least one period is required.';
  if (periods.length > 12) return 'At most twelve periods are allowed.';
  for (const period of periods) {
    const start = period && period.startDate != null && period.startDate !== '' ? String(period.startDate) : null;
    const end = period && period.endDate != null && period.endDate !== '' ? String(period.endDate) : null;
    if (!start) return 'Each period needs a start date.';
    if (!validDate(start)) return `Invalid start date: ${start}.`;
    if (end !== null && !validDate(end)) return `Invalid end date: ${end}.`;
    // Inclusive dates: an end before the start is empty, not a one-day period.
    if (end !== null && end < start) return 'A period cannot end before it starts.';
  }
  return null;
}

function createFirestoreRoleAssignmentRepository(firestore) {
  if (!firestore || typeof firestore.collection !== 'function') {
    throw Object.assign(Error('A Firestore instance is required.'), { code: 'BACKEND_CONFIG_INVALID' });
  }

  const repository = {
    async listByFaculty({ facultyId, academicYear = null, asOf = null } = {}) {
      const id = text(facultyId);
      if (!id) return [];
      const today = asOf ? String(asOf) : calgaryDate();
      if (!validDate(today)) throw Object.assign(Error('A Calgary as-of date is required.'), { code: 'INVALID_DATE', status: 400 });

      const snapshot = await firestore.collection(COLLECTION).where('facultyId', '==', id).get();
      const records = snapshot.docs.map(doc => toRecord(doc.id, doc.data() || {}, today));
      const filtered = academicYear ? records.filter(r => r.academicYear === text(academicYear)) : records;
      return filtered.sort((a, b) =>
        String(a.statusStartDate || '').localeCompare(String(b.statusStartDate || '')) ||
        a.roleType.localeCompare(b.roleType) ||
        a.roleAssignmentId.localeCompare(b.roleAssignmentId));
    },

    async getById({ roleAssignmentId, asOf = null } = {}) {
      const id = text(roleAssignmentId);
      if (!id) return null;
      const snapshot = await firestore.collection(COLLECTION).doc(id).get();
      if (!snapshot.exists) return null;
      return toRecord(snapshot.id, snapshot.data() || {}, asOf ? String(asOf) : calgaryDate());
    },

    // Creation is transactional with its audit record: an assignment that exists
    // without a matching audit entry would be an unaudited change.
    async create({ assignment, actorFirebaseUid, idFactory } = {}) {
      const periods = assignment && assignment.periods;
      const problem = validatePeriods(periods);
      if (problem) throw Object.assign(Error(problem), { code: 'INVALID_PERIOD', status: 400 });
      const scopeKind = text(assignment.scopeKind) || 'none';
      if (!SCOPE_KINDS.has(scopeKind)) throw Object.assign(Error('Invalid scope kind.'), { code: 'INVALID_SCOPE', status: 400 });
      const facultyId = text(assignment.facultyId);
      if (!facultyId) throw Object.assign(Error('A faculty id is required.'), { code: 'INVALID_FACULTY_ID', status: 400 });

      const roleAssignmentId = idFactory ? idFactory() : require('node:crypto').randomUUID();
      const now = new Date();

      return firestore.runTransaction(async transaction => {
        // The faculty reference is validated inside the transaction so an
        // assignment cannot be created against a faculty record that vanished.
        const facultyRef = firestore.collection('faculty').doc(facultyId);
        const facultySnapshot = await transaction.get(facultyRef);
        if (!facultySnapshot.exists) {
          throw Object.assign(Error('The faculty record does not exist.'), { code: 'FACULTY_NOT_FOUND', status: 400 });
        }

        const record = {
          facultyId,
          academicYear: text(assignment.academicYear),
          roleCategory: text(assignment.roleCategory),
          roleType: text(assignment.roleType),
          scopeKind,
          scopeCode: text(assignment.scopeCode),
          periods: periods.map(p => ({ startDate: text(p.startDate), endDate: text(p.endDate) || null })),
          revision: 1,
          createdAtUtc: now,
          updatedAtUtc: now,
          createdBy: text(actorFirebaseUid),
          updatedBy: text(actorFirebaseUid)
        };
        transaction.set(firestore.collection(COLLECTION).doc(roleAssignmentId), record);
        transaction.set(firestore.collection(AUDIT).doc(), {
          roleAssignmentId,
          action: 'create',
          revision: 1,
          actorFirebaseUid: text(actorFirebaseUid),
          recordedAtUtc: now,
          after: record
        });
        return toRecord(roleAssignmentId, record, calgaryDate());
      });
    },

    // Optimistic concurrency: the caller supplies the revision it read. A mismatch
    // is a 409, not a silent last-write-wins.
    async update({ roleAssignmentId, expectedRevision, assignment, actorFirebaseUid } = {}) {
      const id = text(roleAssignmentId);
      if (!id) throw Object.assign(Error('A role assignment id is required.'), { code: 'INVALID_ID', status: 400 });
      const periods = assignment && assignment.periods;
      const problem = validatePeriods(periods);
      if (problem) throw Object.assign(Error(problem), { code: 'INVALID_PERIOD', status: 400 });

      const now = new Date();
      return firestore.runTransaction(async transaction => {
        const ref = firestore.collection(COLLECTION).doc(id);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw Object.assign(Error('Role assignment not found.'), { code: 'NOT_FOUND', status: 404 });

        const before = snapshot.data() || {};
        const current = Number(before.revision) || 0;
        if (Number(expectedRevision) !== current) {
          throw Object.assign(Error('This assignment was changed by someone else. Reload and try again.'), {
            code: 'REVISION_CONFLICT', status: 409, expectedRevision: current
          });
        }

        const after = {
          ...before,
          periods: periods.map(p => ({ startDate: text(p.startDate), endDate: text(p.endDate) || null })),
          roleCategory: assignment.roleCategory === undefined ? before.roleCategory : text(assignment.roleCategory),
          roleType: assignment.roleType === undefined ? before.roleType : text(assignment.roleType),
          scopeKind: assignment.scopeKind === undefined ? before.scopeKind : text(assignment.scopeKind),
          scopeCode: assignment.scopeCode === undefined ? before.scopeCode : text(assignment.scopeCode),
          revision: current + 1,
          updatedAtUtc: now,
          updatedBy: text(actorFirebaseUid)
        };
        transaction.set(ref, after);
        transaction.set(firestore.collection(AUDIT).doc(), {
          roleAssignmentId: id,
          action: 'update',
          revision: current + 1,
          actorFirebaseUid: text(actorFirebaseUid),
          recordedAtUtc: now,
          before,
          after
        });
        return toRecord(id, after, calgaryDate());
      });
    }
  };

  return repository;
}

module.exports = {
  AUDIT,
  COLLECTION,
  SCOPE_KINDS,
  createFirestoreRoleAssignmentRepository,
  toClassifierInput,
  toRecord,
  unsupported,
  validatePeriods
};
