'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFirestoreFacultyRepository, displayNameOf, statusOf, toFte, validLabFacultyId, academicYearForDate, versionFromSnapshot } = require('../src/data/firestore/firestore-faculty-repository');
const { createFirestoreDashboardRepository } = require('../src/data/firestore/firestore-dashboard-repository');

const MOCK_UPDATE_TIME = { seconds: 1790208000, nanoseconds: 123456789 };
const MOCK_VERSION = versionFromSnapshot({ updateTime: MOCK_UPDATE_TIME });

// FTE is a fraction (SQL decimal(6,4); the seed writes 1 and 0.8), not a percentage.
const FACULTY = [
  { id: 'fac-001', firstName: 'Morgan', lastName: 'Chen', ucid: '90000001', email: 'morgan.chen@example.test', rank: 'Professor', fte: 1, active: true },
  { id: 'fac-002', firstName: 'Ada', lastName: 'Okafor', ucid: '90000002', email: 'ada.okafor@example.test', rank: 'Lecturer', fte: 0.8, active: false },
  // The live lab really does contain records with no `active` field at all.
  { id: 'fac-003', firstName: 'No', lastName: 'Status', ucid: '90000003', email: 'no.status@example.test', rank: 'Sessional' }
];

function fakeFirestore(seed = { faculty: FACULTY, sessions: [], afc_requests: [], role_assignments: [] }, { failCollections = [] } = {}) {
  return {
    collection(name) {
      const rows = seed[name] || [];
      const api = {
        where() { return api; },
        limit() { return api; },
        orderBy() { return api; },
        async get() {
          if (failCollections.includes(name)) throw Object.assign(Error('query failed'), { code: 14 });
          return { docs: rows.map(row => ({ id: row.id, updateTime: MOCK_UPDATE_TIME, data: () => row })) };
        },
        doc(id) {
          const found = rows.find(row => row.id === id);
          const snapshot = { id, _collection: name, exists: Boolean(found), updateTime: MOCK_UPDATE_TIME, data: () => found || {}, get: async () => snapshot };
          return snapshot;
        }
      };
      return api;
    },
    async runTransaction(fn) {
      const ops = [];
      const transaction = {
        async get(ref) {
          const rows = seed[ref._collection] || [];
          const found = rows.find(row => row.id === ref.id);
          return { id: ref.id, exists: Boolean(found), updateTime: MOCK_UPDATE_TIME, data: () => found || {} };
        },
        set(ref, data) {
          ops.push({ ref, data });
        }
      };
      const result = await fn(transaction);
      for (const { ref, data } of ops) {
        const rows = seed[ref._collection] || (seed[ref._collection] = []);
        const index = rows.findIndex(row => row.id === ref.id);
        const stored = { id: ref.id, ...data };
        if (index >= 0) rows[index] = stored;
        else rows.push(stored);
      }
      return result;
    }
  };
}

test('names display as Last Name, First Name', () => {
  assert.equal(displayNameOf({ firstName: 'Morgan', lastName: 'Chen' }), 'Chen, Morgan');
  assert.equal(displayNameOf({ lastName: 'Chen' }), 'Chen');
  assert.equal(displayNameOf({ firstName: 'Morgan' }), 'Morgan');
  assert.equal(displayNameOf({}), '');
});

test('employment status is three-valued, never a collapsed boolean', () => {
  assert.equal(statusOf({ active: true }), 'active');
  assert.equal(statusOf({ active: false }), 'inactive');
  assert.equal(statusOf({}), 'unknown');
  assert.equal(statusOf({ active: 'yes' }), 'unknown', 'a non-boolean is not an established status');
});

test('FTE is a fraction and passes through unchanged', () => {
  assert.equal(toFte(1), 1);
  assert.equal(toFte(0.8), 0.8);
  assert.equal(toFte(0), 0);
  assert.equal(toFte(null), null);
  assert.equal(toFte(undefined), null);
  assert.equal(toFte('0.6'), 0.6);
});

test('the lab identifier format is validated, not loosened to accept anything', () => {
  assert.equal(validLabFacultyId('fac-001'), true);
  assert.equal(validLabFacultyId('FAC_001'), true);
  assert.equal(validLabFacultyId(''), false);
  assert.equal(validLabFacultyId('has space'), false);
  assert.equal(validLabFacultyId('a/b'), false);
  assert.equal(validLabFacultyId('..'), false);
});

test('an academic year runs 1 May to 30 April', () => {
  assert.equal(academicYearForDate('2026-05-01'), '2026-27');
  assert.equal(academicYearForDate('2026-04-30'), '2025-26');
  assert.equal(academicYearForDate('2027-01-12'), '2026-27');
  assert.equal(academicYearForDate('2026-08-31'), '2026-27');
});

test('a faculty row carries the SQL contract field names', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  const { rows } = await repository.faculty({ status: 'all' });
  const row = rows.find(r => r.facultyId === 'fac-001');
  for (const field of ['facultyId', 'preferredFirstName', 'preferredLastName', 'displayName', 'ucid', 'email', 'rank', 'fte', 'active', 'status', 'updatedAtUtc', 'sessionCount', 'roleCount', 'afcCount']) {
    assert.ok(field in row, field);
  }
  assert.equal(row.displayName, 'Chen, Morgan');
  assert.equal(row.fte, 1);
  assert.equal(row.status, 'active');
});

test('an unestablished status is its own bucket, not a confirmed inactive', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  const active = await repository.faculty({ status: 'active' });
  assert.deepEqual(active.rows.map(r => r.facultyId), ['fac-001']);

  const inactive = await repository.faculty({ status: 'inactive' });
  assert.deepEqual(inactive.rows.map(r => r.facultyId), ['fac-002'], 'unknown must not be folded into inactive');

  const unknown = await repository.faculty({ status: 'unknown' });
  assert.deepEqual(unknown.rows.map(r => r.facultyId), ['fac-003']);
});

test('the missing-status count survives serialisation', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  const outcome = await repository.faculty({ status: 'all' });
  assert.equal(outcome.dataQuality.missingActive, 1);
  const serialised = JSON.parse(JSON.stringify(outcome));
  assert.equal(serialised.dataQuality.missingActive, 1, 'metadata must survive JSON for the browser to display it');
});

test('a failed count query is reported as unknown, never as zero', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore(undefined, { failCollections: ['afc_requests'] }));
  const outcome = await repository.faculty({ status: 'all' });
  const row = outcome.rows.find(r => r.facultyId === 'fac-001');
  assert.equal(row.afcCount, null, 'no claim can be made when the query failed');
  assert.equal(outcome.dataQuality.countFailures.afcCount, 'COUNT_QUERY_FAILED');
  assert.equal(row.sessionCount, 0);
});

test('search covers name, email and ucid', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  assert.deepEqual((await repository.faculty({ search: 'okafor', status: 'all' })).rows.map(r => r.facultyId), ['fac-002']);
  assert.deepEqual((await repository.faculty({ search: '90000001', status: 'all' })).rows.map(r => r.facultyId), ['fac-001']);
  assert.deepEqual((await repository.faculty({ search: 'morgan.chen@', status: 'all' })).rows.map(r => r.facultyId), ['fac-001']);
});

test('an invalid status filter is rejected rather than ignored', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  await assert.rejects(() => repository.faculty({ status: 'whatever' }), /Invalid Faculty status filter/);
});

test('faculty detail is a structured object, not a flat row', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  const record = await repository.facultyById({ facultyId: 'fac-001' });
  assert.ok(record.faculty, 'the faculty section must be nested');
  assert.equal(record.faculty.displayName, 'Chen, Morgan');
  assert.ok('academicYear' in record);
  // Roles are now sourced, so an empty array means "this person has none" and the
  // section is NOT listed as unavailable. Sections with no source stay null AND
  // named, so a consumer can still tell the two apart.
  assert.deepEqual(record.roles, [], 'no assignments means an empty array, not null');
  assert.equal(record.unavailable.includes('roles'), false);
  assert.equal(record.afcRecords, null);
  assert.ok(record.unavailable.includes('afcRecords'));
});

test('faculty detail honours includeInactive', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  assert.equal(await repository.facultyById({ facultyId: 'fac-002' }), null);
  const inactive = await repository.facultyById({ facultyId: 'fac-002', includeInactive: true });
  assert.equal(inactive.faculty.displayName, 'Okafor, Ada');
  assert.equal(await repository.facultyById({ facultyId: 'nope', includeInactive: true }), null);
});

test('counts are gathered in one query per collection, not per faculty', async () => {
  let collectionReads = 0;
  const base = fakeFirestore({
    faculty: FACULTY,
    sessions: [
      { id: 's1', facultyIds: ['fac-001'], date: '2027-01-12' },
      { id: 's2', facultyIds: ['fac-001'], date: '2027-02-02' },
      { id: 's3', facultyIds: ['fac-001'], date: '2025-01-10' }
    ],
    afc_requests: [{ id: 'a1', facultyId: 'fac-001' }],
    role_assignments: [{ id: 'r1', facultyId: 'fac-001' }]
  });
  const counted = {
    collection(name) {
      const api = base.collection(name);
      const original = api.get;
      api.get = async function patched() { collectionReads += 1; return original(); };
      return api;
    }
  };
  const repository = createFirestoreFacultyRepository(counted);
  const row = (await repository.faculty({ status: 'all', academicYear: '2026-27' })).rows.find(r => r.facultyId === 'fac-001');
  assert.equal(row.afcCount, 1, 'AFC is keyed by a singular facultyId');
  assert.equal(row.roleCount, 1, 'roles are keyed by a singular facultyId');
  assert.equal(row.sessionCount, 2, 'only sessions in the requested academic year are counted');
  // faculty + sessions + afc_requests + role_assignments = 4, independent of roster size.
  assert.equal(collectionReads, 4, 'counting must not scale with the number of faculty rows');
});

test('a faculty update writes and appends an audit record in one transaction', async () => {
  const seed = { faculty: [{ ...FACULTY[0] }], sessions: [], afc_requests: [], role_assignments: [] };
  const repository = createFirestoreFacultyRepository(fakeFirestore(seed));
  const updated = await repository.updateFaculty({ facultyId: 'fac-001', rank: 'Professor Emeritus', expectedUpdatedAtUtc: MOCK_VERSION, actorFirebaseUid: 'admin-1' });
  assert.equal(updated.rank, 'Professor Emeritus');
  assert.equal(updated.displayName, 'Chen, Morgan');
  const audit = seed.faculty_change_log || [];
  assert.equal(audit.length, 1, 'an unaudited write must not be possible');
  assert.equal(audit[0].action, 'update');
});

test('a write without a verified actor is refused', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  await assert.rejects(
    () => repository.updateFaculty({ facultyId: 'fac-001', rank: 'X', actorFirebaseUid: '' }),
    error => error.code === 'ACTOR_REQUIRED'
  );
});

test('an FTE percentage is rejected rather than silently scaled', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  await assert.rejects(
    () => repository.updateFaculty({ facultyId: 'fac-001', fte: 100, expectedUpdatedAtUtc: MOCK_VERSION, actorFirebaseUid: 'admin-1' }),
    error => error.code === 'INVALID_FTE'
  );
});

test('deactivation keeps the record and only changes its status', async () => {
  const firestore = fakeFirestore();
  const repository = createFirestoreFacultyRepository(firestore);
  const after = await repository.deactivateFaculty({ facultyId: 'fac-001', expectedUpdatedAtUtc: MOCK_VERSION, actorFirebaseUid: 'admin-1' });
  assert.equal(after.active, false);
  // The record still exists, so historical references keep resolving.
  assert.ok(await repository.facultyById({ facultyId: 'fac-001', includeInactive: true }));
});

test('an absent Faculty precondition is refused, not interpreted as current', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  await assert.rejects(
    () => repository.updateFaculty({ facultyId: 'fac-001', rank: 'X', actorFirebaseUid: 'admin-1' }),
    error => error.code === 'FACULTY_VERSION_REQUIRED' && error.status === 400
  );
});

test('a stale precondition is a 409 and writes nothing', async () => {
  const repository = createFirestoreFacultyRepository(fakeFirestore());
  await assert.rejects(
    () => repository.updateFaculty({ facultyId: 'fac-001', rank: 'X', expectedUpdatedAtUtc: '2000-01-01T00:00:00.000000000Z', actorFirebaseUid: 'admin-1' }),
    error => error.code === 'REVISION_CONFLICT' && error.status === 409
  );
});

test('the Dashboard exposes Faculty reads and refuses the rest', async () => {
  const dashboard = createFirestoreDashboardRepository(fakeFirestore());
  assert.equal(typeof dashboard.faculty, 'function');
  assert.equal(typeof dashboard.facultyById, 'function');
  for (const operation of ['summary', 'doeOverview', 'afcRecords']) {
    assert.throws(() => dashboard[operation](), error => error.code === 'BACKEND_OPERATION_UNSUPPORTED', operation);
  }
  assert.throws(() => dashboard.somethingNew(), error => error.code === 'BACKEND_OPERATION_UNSUPPORTED');
});
