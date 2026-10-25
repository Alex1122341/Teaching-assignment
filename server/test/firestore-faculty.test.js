'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFirestoreFacultyRepository, displayNameOf, validLabFacultyId } = require('../src/data/firestore/firestore-faculty-repository');
const { createFirestoreDashboardRepository } = require('../src/data/firestore/firestore-dashboard-repository');

const FACULTY = [
  { id: 'fac-001', firstName: 'Morgan', lastName: 'Chen', ucid: '90000001', email: 'morgan.chen@example.test', rank: 'Professor', fte: 100, active: true },
  { id: 'fac-002', firstName: 'Ada', lastName: 'Okafor', ucid: '90000002', email: 'ada.okafor@example.test', rank: 'Lecturer', fte: 60, active: false },
  // The live lab really does contain records with no `active` field at all.
  { id: 'fac-003', firstName: 'No', lastName: 'Status', ucid: '90000003', email: 'no.status@example.test', rank: 'Sessional' }
];

function fakeFirestore(seed = { faculty: FACULTY, sessions: [], afc_requests: [], role_assignments: [] }) {
  return {
    collection(name) {
      const rows = seed[name] || [];
      const api = {
        where(field, op, value) {
          api._filter = { field, op, value };
          return api;
        },
        limit() { return api; },
        orderBy() { return api; },
        async get() {
          if (api._filter) {
            const { field, value } = api._filter;
            return { docs: rows.filter(row => Array.isArray(row[field]) && row[field].includes(value)).map(row => ({ id: row.id, data: () => row })) };
          }
          return { docs: rows.map(row => ({ id: row.id, data: () => row })) };
        },
        doc(id) {
          const found = rows.find(row => row.id === id);
          const snapshot = { id, exists: Boolean(found), data: () => found || {}, get: async () => snapshot };
          return snapshot;
        }
      };
      return api;
    }
  };
}

test('names display as Last Name, First Name', () => {
  assert.equal(displayNameOf({ firstName: 'Morgan', lastName: 'Chen' }), 'Chen, Morgan');
  assert.equal(displayNameOf({ lastName: 'Chen' }), 'Chen');
  assert.equal(displayNameOf({ firstName: 'Morgan' }), 'Morgan');
  assert.equal(displayNameOf({}), '');
});

test('the lab identifier format is validated, not loosened to accept anything', () => {
  assert.equal(validLabFacultyId('fac-001'), true);
  assert.equal(validLabFacultyId('FAC_001'), true);
  assert.equal(validLabFacultyId(''), false);
  assert.equal(validLabFacultyId('has space'), false);
  assert.equal(validLabFacultyId('a/b'), false);
  assert.equal(validLabFacultyId('..'), false);
});

test('a faculty row carries the SQL contract field names', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  const rows = await repository.faculty({ status: 'all' });
  const row = rows.find(r => r.facultyId === 'fac-001');
  assert.deepEqual(Object.keys(row).sort(), [
    'active', 'activeEstablished', 'afcCount', 'displayName', 'email', 'facultyId', 'fte',
    'jointAppointmentCount', 'preferredFirstName', 'preferredLastName', 'professionalCategory',
    'rank', 'recordType', 'reportsToFacultyId', 'reportsToName', 'roleCount', 'sessionCount',
    'stream', 'teachingArea', 'ucid', 'updatedAtUtc'
  ]);
  assert.equal(row.displayName, 'Chen, Morgan');
  assert.equal(row.preferredFirstName, 'Morgan');
  assert.equal(row.fte, 100);
});

test('a record with no active field fails closed and is counted, not hidden', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  const active = await repository.faculty({ status: 'active' });
  assert.deepEqual(active.map(r => r.facultyId), ['fac-001']);
  assert.equal(active.dataQuality.missingActive, 1, 'the gap must be visible');

  const all = await repository.faculty({ status: 'all' });
  const noStatus = all.find(r => r.facultyId === 'fac-003');
  assert.equal(noStatus.active, false, 'an unestablished status is not "active"');
  assert.equal(noStatus.activeEstablished, false);
});

test('inactive filter returns the explicitly inactive and the unestablished', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  const rows = await repository.faculty({ status: 'inactive' });
  assert.deepEqual(rows.map(r => r.facultyId).sort(), ['fac-002', 'fac-003']);
});

test('search covers name, email and ucid', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  assert.deepEqual((await repository.faculty({ search: 'okafor', status: 'all' })).map(r => r.facultyId), ['fac-002']);
  assert.deepEqual((await repository.faculty({ search: '90000001', status: 'all' })).map(r => r.facultyId), ['fac-001']);
  assert.deepEqual((await repository.faculty({ search: 'morgan.chen@', status: 'all' })).map(r => r.facultyId), ['fac-001']);
});

test('an invalid status filter is rejected rather than ignored', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  await assert.rejects(() => repository.faculty({ status: 'whatever' }), /Invalid Faculty status filter/);
});

test('facultyById honours includeInactive', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  assert.equal(await repository.facultyById({ facultyId: 'fac-002' }), null);
  const inactive = await repository.facultyById({ facultyId: 'fac-002', includeInactive: true });
  assert.equal(inactive.displayName, 'Okafor, Ada');
  assert.equal(await repository.facultyById({ facultyId: 'nope', includeInactive: true }), null);
});

test('counts are derived from the collections that own them', async () => {
  const firestore = fakeFirestore({
    faculty: FACULTY,
    sessions: [{ id: 's1', facultyIds: ['fac-001'] }, { id: 's2', facultyIds: ['fac-001'] }],
    afc_requests: [{ id: 'a1', facultyIds: ['fac-001'] }],
    role_assignments: [{ id: 'r1', facultyIds: ['fac-001'] }]
  });
  const repository = createFirestoreFacultyRepository(firestore);
  const row = (await repository.faculty({ status: 'all' })).find(r => r.facultyId === 'fac-001');
  assert.equal(row.sessionCount, 2);
  assert.equal(row.afcCount, 1);
  assert.equal(row.roleCount, 1);
});

test('faculty writes refuse instead of reporting a save that did not happen', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  for (const operation of ['updateFaculty', 'deactivateFaculty', 'restoreFaculty', 'updateRolePeriods']) {
    assert.throws(() => repository[operation]({}), error => error.code === 'BACKEND_OPERATION_UNSUPPORTED', operation);
  }
});

test('the Dashboard exposes Faculty reads and refuses the rest', async () => {
  const dashboard = createFirestoreDashboardRepository(fakeFirestore());
  assert.equal(typeof dashboard.faculty, 'function');
  assert.equal(typeof dashboard.facultyById, 'function');
  for (const operation of ['summary', 'doeOverview', 'afcRecords', 'updateFaculty']) {
    assert.throws(() => dashboard[operation](), error => error.code === 'BACKEND_OPERATION_UNSUPPORTED', operation);
  }
  // Unknown methods refuse too, rather than being undefined.
  assert.throws(() => dashboard.somethingNew(), error => error.code === 'BACKEND_OPERATION_UNSUPPORTED');
});
