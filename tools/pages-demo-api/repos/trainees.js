'use strict';
// Trainees & supervision for the Frontend Demo. Uses the real trainee service
// (paging, summary, CSV) on top of synthetic supervision counts.
const { createTraineeService } = require('../../../server/src/trainees/trainee-service.js');
const { isAdministratorRole } = require('../../../server/src/auth/role-policy.js');
const { traineeRows, supervisionDoe } = require('./doe.js');

function createTraineeRepository(store) {
  const service = createTraineeService();
  function dataset({ actorFirebaseUid, query = '', category = null, expectedScope = {} }) {
    const profile = store.tables.users.find(u => u.firebaseUid === actorFirebaseUid) || {};
    const administrator = isAdministratorRole(profile.baseRole);
    const names = new Map(store.tables.faculty.map(f => [f.facultyId, f.displayName]));
    const index = ['undergrad', 'vetm506', 'preceptor', 'im', 'grad_primary', 'grad_cosupervised', 'postdoc'].indexOf(category);
    const rows = traineeRows(store)
      .filter(row => administrator || row.facultyId === profile.facultyId)
      .filter(row => !query || String(names.get(row.facultyId) || '').toLowerCase().includes(String(query).toLowerCase()))
      .filter(row => index < 0 || (row.counts[index] || 0) > 0)
      .map(row => { const doe = supervisionDoe(row.counts); return { facultyId: row.facultyId, displayName: names.get(row.facultyId) || '', rawCounts: row.counts, sourceDoe: doe, currentRawDoe: doe, currentAppliedDoe: doe, sourceStatus: row.counts.includes(null) ? 'missing_count' : 'matched', sourceRef: row.sourceRef, privateNotes: null }; });
    return { version: 1, scope: { actorUid: actorFirebaseUid, role: profile.baseRole, facultyId: profile.facultyId || null, administrator }, rows, coverage: [{ academicYear: store.tables.academicYear, source: 'Trainees 2026-27 (synthetic)', rows: rows.length }] };
  }
  return {
    async listTrainees(p) { return service.page({ dataset: dataset(p), ...p }); },
    async exportTrainees(p) { return service.csv(dataset(p).rows, { academicYear: p.academicYear }); }
  };
}
module.exports = { createTraineeRepository };
