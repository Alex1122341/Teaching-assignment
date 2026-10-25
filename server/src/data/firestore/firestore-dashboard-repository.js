'use strict';

// The Dashboard repository is a composite: the SQL version merges the dashboard
// queries with the DOE target queries. Under Firestore only the Faculty read path
// exists so far, so this exposes exactly that and refuses everything else.
//
// The refusals are what make partial delivery honest. A Dashboard that answered
// "no data" for DOE would be worse than one that says DOE is not built, because
// the first looks like an empty result and the second tells the truth.

const { createFirestoreFacultyRepository } = require('./firestore-faculty-repository');
const { createFirestoreRoleAssignmentRepository } = require('./firestore-role-assignment-repository');
const { unsupported } = require('./firestore-session-repository');

// Everything the SQL dashboard repository provides. Anything not listed here is
// unknown to this module and is refused by the proxy at the bottom.
const FACULTY_READS = ['faculty', 'facultyById'];

const NOT_IMPLEMENTED = [
  'summary', 'teachingSummary', 'doeOverview', 'doeTargets',
  'afcRecords', 'createAfcRecord', 'createAfcManualBatch', 'cancelAfcRecord',
  'afcRecordWriteCapabilities', 'facultyAdminWriteCapabilities',
  'updateFaculty', 'deactivateFaculty', 'restoreFaculty'
];

function createFirestoreDashboardRepository(firestore) {
  const faculty = createFirestoreFacultyRepository(firestore);
  const assignments = createFirestoreRoleAssignmentRepository(firestore);

  const repository = {};
  for (const name of FACULTY_READS) repository[name] = faculty[name];

  // GET /api/v1/dashboard/roles. Administrator-only, enforced by dashboard-api.
  // The response must carry the same fields the existing editor reads.
  repository.roles = async ({ academicYear = null } = {}) => {
    const snapshot = await firestore.collection('role_assignments').get();
    const rows = [];
    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      if (academicYear && String(data.academicYear || '').trim() !== String(academicYear).trim()) continue;
      const record = await assignments.getById({ roleAssignmentId: doc.id });
      if (record) rows.push(record);
    }
    rows.sort((a, b) => a.facultyId.localeCompare(b.facultyId) || a.roleType.localeCompare(b.roleType));
    return rows;
  };

  // PUT /api/v1/dashboard/roles/:id/periods. The SQL backend identifies the
  // version with an eight-byte rowversion; Firestore has an integer revision.
  // The caller supplies whichever its backend understands and the other stays
  // undefined — no integer is ever dressed up as a rowversion.
  repository.updateRolePeriods = async ({ roleAssignmentId, expectedRevision, expectedVersion, periods, actorFirebaseUid } = {}) => {
    if (expectedRevision === null || expectedRevision === undefined) {
      throw Object.assign(Error('This backend identifies an appointment by its integer revision.'), {
        code: 'INVALID_ROLE_VERSION', status: 400
      });
    }
    if (expectedVersion !== undefined && expectedVersion !== null) {
      throw Object.assign(Error('A SQL rowversion cannot be used against the Firestore backend.'), {
        code: 'INVALID_ROLE_VERSION', status: 400
      });
    }
    const record = await assignments.update({ roleAssignmentId, expectedRevision, assignment: { periods }, actorFirebaseUid });
    return {
      roleAssignmentId: record.roleAssignmentId,
      facultyId: record.facultyId,
      academicYear: record.academicYear,
      roleType: record.roleType,
      roleCategory: record.roleCategory,
      scopeKind: record.scopeKind,
      scopeCode: record.scopeCode,
      periods: record.periods,
      revision: record.revision,
      status: record.status
    };
  };
  for (const name of NOT_IMPLEMENTED) {
    repository[name] = () => { throw unsupported(`dashboard.${name}`); };
  }

  // Anything not named above is also refused, so a future SQL method cannot be
  // silently undefined here and surface as "is not a function" far from the cause.
  return new Proxy(repository, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === 'then' || property === Symbol.toStringTag || property === 'isImplemented') return undefined;
      return () => { throw unsupported(`dashboard.${String(property)}`); };
    }
  });
}

module.exports = { FACULTY_READS, NOT_IMPLEMENTED, createFirestoreDashboardRepository };
