'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFirestoreLeadershipDirectoryRepository } = require('../src/data/firestore/firestore-leadership-directory-repository');
const { buildDirectory } = require('../src/roles/leadership-directory-api');

// The directory is a published projection. Two things must hold: only verified
// role types appear, and the response carries nothing confidential.

const FACULTY = [
  { id: 'fac-001', firstName: 'Morgan', lastName: 'Chen', ucid: '90000001', email: 'morgan.chen@example.test', active: true, doe: 40 },
  { id: 'fac-002', firstName: 'Ada', lastName: 'Okafor', ucid: '90000002', email: 'ada.okafor@example.test', active: false, doe: 20 },
  { id: 'fac-003', firstName: 'No', lastName: 'Status', ucid: '90000003', email: 'no.status@example.test', doe: 10 }
];

const ASSIGNMENTS = [
  { id: 'ra-1', facultyId: 'fac-001', academicYear: '2026-27', roleType: 'HICC', scopeKind: 'course', scopeCode: 'VETM 301', periods: [{ startDate: '2026-09-01', endDate: '2027-06-30' }] },
  { id: 'ra-2', facultyId: 'fac-001', academicYear: '2026-27', roleType: 'VISC', scopeKind: 'subject', scopeCode: 'Anatomy', periods: [{ startDate: '2026-09-01', endDate: null }] },
  { id: 'ra-3', facultyId: 'fac-001', academicYear: '2026-27', roleType: 'Course Coordinator', scopeKind: 'course', scopeCode: 'VETM 302', periods: [{ startDate: '2026-09-01', endDate: '2027-06-30' }] },
  // Inactive faculty must not appear in a published directory.
  { id: 'ra-4', facultyId: 'fac-002', academicYear: '2026-27', roleType: 'HICC', scopeKind: 'course', scopeCode: 'VETM 401', periods: [{ startDate: '2026-09-01' }] },
  // Unknown employment status must not appear either.
  { id: 'ra-5', facultyId: 'fac-003', academicYear: '2026-27', roleType: 'VISC', scopeKind: 'course', scopeCode: 'VETM 402', periods: [{ startDate: '2026-09-01' }] },
  // An unverified legacy label is not promoted into the directory.
  { id: 'ra-6', facultyId: 'fac-001', academicYear: '2026-27', roleType: 'Legacy Coordinator', scopeKind: 'course', scopeCode: 'VETM 500', periods: [{ startDate: '2026-09-01' }] },
  // A different academic year is filtered out.
  { id: 'ra-7', facultyId: 'fac-001', academicYear: '2025-26', roleType: 'HICC', scopeKind: 'course', scopeCode: 'VETM 200', periods: [{ startDate: '2025-09-01', endDate: '2026-06-30' }] }
];

function fakeFirestore() {
  return {
    collection(name) {
      const rows = name === 'faculty' ? FACULTY : ASSIGNMENTS;
      return {
        async get() { return { docs: rows.map(row => ({ id: row.id, data: () => row })) }; },
        doc(id) {
          const found = rows.find(row => row.id === id);
          const snapshot = { id, exists: Boolean(found), data: () => found || {}, get: async () => snapshot };
          return snapshot;
        }
      };
    }
  };
}

test('only verified role types reach the directory', async () => {
  const repository = createFirestoreLeadershipDirectoryRepository(fakeFirestore());
  const rows = await repository.list({ academicYear: '2026-27' });
  const types = rows.map(r => r.roleType).sort();
  assert.deepEqual(types, ['Course Coordinator', 'HICC', 'VISC']);
  assert.equal(rows.some(r => r.roleType === 'Legacy Coordinator'), false);
});

test('inactive and unestablished faculty are excluded from the directory', async () => {
  const repository = createFirestoreLeadershipDirectoryRepository(fakeFirestore());
  const rows = await repository.list({ academicYear: '2026-27' });
  assert.deepEqual([...new Set(rows.map(r => r.facultyId))], ['fac-001']);
});

test('the academic year filter is applied', async () => {
  const repository = createFirestoreLeadershipDirectoryRepository(fakeFirestore());
  const rows = await repository.list({ academicYear: '2025-26' });
  assert.deepEqual(rows.map(r => r.id || r.roleType), ['HICC']);
  assert.equal(rows[0].courseCode, 'VETM 200');
});

test('the built directory exposes only approved fields', async () => {
  const repository = createFirestoreLeadershipDirectoryRepository(fakeFirestore());
  const rows = await repository.list({ academicYear: '2026-27' });
  const body = buildDirectory(rows, { academicYear: '2026-27', asOfDate: '2026-10-01' });

  const serialised = JSON.stringify(body);
  // Nothing confidential may appear anywhere in the payload.
  for (const forbidden of ['90000001', 'morgan.chen@example.test', 'doe', 'ucId', 'ucid', 'email']) {
    assert.equal(serialised.includes(forbidden), false, `directory must not expose ${forbidden}`);
  }

  const hicc = body.hiccCc.find(entry => entry.roleType === 'HICC');
  assert.ok(hicc, 'the HICC entry must be present');
  assert.equal(hicc.facultyName, 'Chen, Morgan', 'names display as Last Name, First Name');
  assert.equal(hicc.status, 'active');
  assert.ok('effectiveDate' in hicc || 'startDate' in hicc || 'statusStartDate' in hicc);
});

test('a period boundary is inclusive in the published status', async () => {
  const repository = createFirestoreLeadershipDirectoryRepository(fakeFirestore());
  const rows = await repository.list({ academicYear: '2026-27' });
  const onEnd = buildDirectory(rows, { academicYear: '2026-27', asOfDate: '2027-06-30' });
  const afterEnd = buildDirectory(rows, { academicYear: '2026-27', asOfDate: '2027-07-01' });
  const onEndHicc = onEnd.hiccCc.find(e => e.roleType === 'HICC');
  const afterHicc = afterEnd.hiccCc.find(e => e.roleType === 'HICC');
  assert.equal(onEndHicc.status, 'active', 'the last day still counts');
  assert.equal(afterHicc.status, 'inactive');
});
