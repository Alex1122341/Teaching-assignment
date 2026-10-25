'use strict';

// The Dashboard repository is a composite: the SQL version merges the dashboard
// queries with the DOE target queries. Under Firestore only the Faculty read path
// exists so far, so this exposes exactly that and refuses everything else.
//
// The refusals are what make partial delivery honest. A Dashboard that answered
// "no data" for DOE would be worse than one that says DOE is not built, because
// the first looks like an empty result and the second tells the truth.

const { createFirestoreFacultyRepository } = require('./firestore-faculty-repository');
const { unsupported } = require('./firestore-session-repository');

// Everything the SQL dashboard repository provides. Anything not listed here is
// unknown to this module and is refused by the proxy at the bottom.
const FACULTY_READS = ['faculty', 'facultyById'];

const NOT_IMPLEMENTED = [
  'summary', 'teachingSummary', 'roles', 'doeOverview', 'doeTargets',
  'afcRecords', 'createAfcRecord', 'createAfcManualBatch', 'cancelAfcRecord',
  'afcRecordWriteCapabilities', 'facultyAdminWriteCapabilities',
  'updateRolePeriods', 'updateFaculty', 'deactivateFaculty', 'restoreFaculty'
];

function createFirestoreDashboardRepository(firestore) {
  const faculty = createFirestoreFacultyRepository(firestore);

  const repository = {};
  for (const name of FACULTY_READS) repository[name] = faculty[name];
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
