'use strict';
// Testing-site-only helpers used by frontend/scripts/testing-only-features.js.
// PAWS has no "create Faculty" API (records come from HR), so the testing
// site's "+ Add Faculty" writes straight into the synthetic demo store.
const { uuidFor } = require('./ids.js');

function createTestingOnly(store) {
  function addFaculty(input = {}, actorFirebaseUid = '') {
    const first = String(input.preferredFirstName || '').trim();
    const last = String(input.preferredLastName || '').trim();
    const ucid = String(input.ucid || '').trim();
    if (!first || !last) throw new Error('First and last name are required.');
    if (!/^\d{8}$/.test(ucid)) throw new Error('UCID must be 8 digits.');
    const t = store.tables;
    if (t.faculty.some(row => row.ucid === ucid)) throw new Error(`UCID ${ucid} already exists.`);
    const now = store.nowIso();
    const row = {
      facultyId: uuidFor(`testing-only-faculty-${ucid}-${now}`),
      legacyId: '',
      preferredFirstName: first,
      preferredLastName: last,
      displayName: `${first} ${last}`,
      storedDisplayName: `${last}, ${first}`,
      hrName: `${last}, ${first}`,
      ucid,
      email: String(input.email || '').trim() || `${first}.${last}@example.test`.toLowerCase(),
      recordType: String(input.recordType || 'Faculty'),
      stream: String(input.stream || 'Teaching'),
      rank: String(input.rank || 'Assistant Professor'),
      fte: Number.isFinite(Number(input.fte)) && input.fte !== '' ? Number(input.fte) : 1,
      contractTeachingDoe: Number.isFinite(Number(input.contractTeachingDoe)) && input.contractTeachingDoe !== '' ? Number(input.contractTeachingDoe) : 40,
      reportsToFacultyId: null,
      active: true,
      updatedAtUtc: now,
      versionToken: `v1-${ucid}`,
      profile: { teachingArea: String(input.teachingArea || ''), professionalCategory: String(input.professionalCategory || ''), profileVersion: '0x' + Date.now().toString(16).padStart(16, '0').slice(-16).toUpperCase() }
    };
    t.faculty.push(row);
    store.audit({ domain: 'lookup', changeType: 'faculty_created', facultyId: row.facultyId, actorFirebaseUid, before: null, after: { displayName: row.displayName, ucid, rank: row.rank } });
    store.commit();
    return { facultyId: row.facultyId, displayName: row.displayName, ucid };
  }
  return Object.freeze({ addFaculty });
}

module.exports = { createTestingOnly };
