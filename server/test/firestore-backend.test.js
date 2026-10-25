'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  academicYearForDate,
  createFirestoreSessionRepository,
  toRow
} = require('../src/data/firestore/firestore-session-repository');
const { createFirestoreUserRepository } = require('../src/data/firestore/firestore-user-repository');
const {
  createFirestoreRepositories,
  firestoreCoverage,
  resolveDataBackend,
  unimplementedRepository
} = require('../src/data/backend-provider');
const { createSwaSqlRuntime } = require('../src/runtime/swa-sql-runtime');

// ---------------------------------------------------------------------------
// A deliberately small Firestore double. It implements only what the read path
// uses — where / array-contains / orderBy / get / doc.get — so a test cannot pass
// by exercising behaviour the real client does not have.
// ---------------------------------------------------------------------------
function fakeFirestore(seed = {}) {
  const calls = [];
  const collections = new Map(Object.entries(seed));

  function queryFor(name) {
    const filters = [];
    let order = null;
    const api = {
      where(field, op, value) { filters.push({ field, op, value }); return api; },
      orderBy(field) { order = field; return api; },
      async get() {
        calls.push({ collection: name, filters: [...filters], order });
        let rows = (collections.get(name) || []).map(doc => ({ id: doc.id, data: () => doc }));
        for (const { field, op, value } of filters) {
          rows = rows.filter(row => {
            const actual = row.data()[field];
            if (op === '>=') return String(actual) >= String(value);
            if (op === '<') return String(actual) < String(value);
            if (op === 'array-contains') return Array.isArray(actual) && actual.includes(value);
            throw Error(`unsupported operator in fake: ${op}`);
          });
        }
        if (order) rows.sort((a, b) => String(a.data()[order]).localeCompare(String(b.data()[order])));
        return { docs: rows };
      }
    };
    return api;
  }

  return {
    calls,
    collection(name) {
      const base = queryFor(name);
      return Object.assign(base, {
        doc(id) {
          const found = (collections.get(name) || []).find(d => d.id === id);
          const snapshot = { id, exists: Boolean(found), data: () => (found || {}) };
          snapshot.get = async () => snapshot;
          return snapshot;
        }
      });
    }
  };
}

const sessionDocs = [
  { id: 's1', course: 'VETM 301', courseName: 'Veterinary Anatomy I', date: '2027-01-12', start: '09:30', end: '11:30', year: 2, semester: 'winter', type: 'LAB', room: 'Clinical Skills Lab', topic: 'Thoracic limb', instructorNames: ['Chen, Morgan'], facultyIds: ['f1'], assignments: [{ facultyId: 'f1', teachingRole: 'Primary' }], timeUnknown: false, week: 1 },
  { id: 's2', course: 'VETM 302', courseName: 'Veterinary Physiology', date: '2027-02-02', start: '11:30', end: '13:30', year: 2, semester: 'winter', type: 'Lecture', room: 'Lecture Theatre', topic: 'Renal', instructorNames: ['Okafor, Ada'], facultyIds: ['f2'], assignments: [], timeUnknown: false, week: 3 },
  { id: 's3', course: 'VETM 401', courseName: 'Small Animal Surgery', date: '2027-09-14', start: '08:00', end: '10:00', year: 4, semester: 'fall', type: 'SRL', room: 'OR 2', topic: 'Ovariohysterectomy', instructorNames: ['Chen, Morgan'], facultyIds: ['f1'], assignments: [], timeUnknown: false, week: 1 }
];

test('an academic year runs from 1 May to 30 April, matching the SQL rule', () => {
  // The boundary is May, not September: the SQL session API rejects a date
  // outside DATEFROMPARTS(year,5,1) .. DATEFROMPARTS(year+1,5,1).
  assert.equal(academicYearForDate('2026-05-01'), '2026-27');
  assert.equal(academicYearForDate('2026-04-30'), '2025-26');
  assert.equal(academicYearForDate('2027-01-12'), '2026-27');
  assert.equal(academicYearForDate('2026-09-01'), '2026-27');
  // Summer sits in the year that has already started, which is where a September
  // boundary would have been wrong.
  assert.equal(academicYearForDate('2026-08-31'), '2026-27');
  assert.equal(academicYearForDate('2027-05-01'), '2027-28');
  assert.equal(academicYearForDate('not-a-date'), null);
});

test('a Firestore session maps to exactly the SQL row shape', () => {
  const row = toRow('s1', sessionDocs[0]);
  assert.deepEqual(Object.keys(row).sort(), [
    'academicYear', 'assignmentsJson', 'courseCode', 'courseName', 'curriculumYear',
    'date', 'endTime', 'id', 'instructorNames', 'room', 'sessionType',
    'startTime', 'topic', 'unresolvedAssignmentCount'
  ]);
  assert.equal(row.courseCode, 'VETM 301');
  assert.equal(row.sessionType, 'LAB');
  assert.equal(row.instructorNames, 'Chen, Morgan');
  assert.equal(row.academicYear, '2026-27');
  assert.deepEqual(JSON.parse(row.assignmentsJson), [{ facultyId: 'f1', teachingRole: 'Primary' }]);
});

test('list applies the date range and faculty filter in the query, not in memory', async () => {
  const firestore = fakeFirestore({ sessions: sessionDocs });
  const repository = createFirestoreSessionRepository(firestore);
  const rows = await repository.list({ start: '2027-01-01', end: '2027-03-01' });
  assert.deepEqual(rows.map(r => r.id), ['s1', 's2']);
  const filters = firestore.calls.at(-1).filters;
  assert.deepEqual(filters, [
    { field: 'date', op: '>=', value: '2027-01-01' },
    { field: 'date', op: '<', value: '2027-03-01' }
  ]);
});

test('a faculty filter narrows to that faculty member only', async () => {
  const firestore = fakeFirestore({ sessions: sessionDocs });
  const repository = createFirestoreSessionRepository(firestore);
  const rows = await repository.list({ start: '2027-01-01', end: '2028-01-01', facultyId: 'f1' });
  assert.deepEqual(rows.map(r => r.id), ['s1', 's3']);
  assert.ok(firestore.calls.at(-1).filters.some(f => f.field === 'facultyIds' && f.op === 'array-contains'));
});

test('every write refuses instead of reporting a save that did not happen', async () => {
  const repository = createFirestoreSessionRepository(fakeFirestore({ sessions: sessionDocs }));
  for (const operation of ['updateExisting', 'createNew', 'createBatch', 'replaceAssignments']) {
    await assert.rejects(
      async () => repository[operation]({}),
      error => error.code === 'BACKEND_OPERATION_UNSUPPORTED' && error.status === 501 && error.operation === operation,
      operation
    );
  }
});

test('the backend selector defaults to SQL and rejects anything unknown', () => {
  assert.equal(resolveDataBackend({}), 'sql');
  assert.equal(resolveDataBackend({ PAWS_DATA_BACKEND: 'sql' }), 'sql');
  assert.equal(resolveDataBackend({ PAWS_DATA_BACKEND: 'Firestore' }), 'firestore');
  assert.throws(() => resolveDataBackend({ PAWS_DATA_BACKEND: 'postgres' }), /Unsupported PAWS_DATA_BACKEND/);
});

test('an unimplemented repository refuses rather than answering "no rows"', () => {
  const repository = unimplementedRepository('dashboard');
  assert.throws(() => repository.list(), error => error.code === 'BACKEND_OPERATION_UNSUPPORTED');
  assert.throws(() => repository.anythingAtAll(), error => error.code === 'BACKEND_OPERATION_UNSUPPORTED');
  // Must never be mistaken for a promise, or `await repo.list()` would resolve.
  assert.equal(repository.then, undefined);
});

test('coverage states plainly which repositories exist on Firestore', () => {
  const coverage = firestoreCoverage(['sessions', 'users', 'dashboard', 'afcWrite']);
  assert.deepEqual(coverage.implemented, ['sessions', 'users']);
  assert.deepEqual(coverage.unimplemented, ['dashboard', 'afcWrite']);
  const built = createFirestoreRepositories(fakeFirestore({}), ['sessions', 'users', 'dashboard']);
  assert.equal(typeof built.sessions.list, 'function');
  assert.equal(typeof built.users.findByUid, 'function');
  assert.throws(() => built.dashboard.list(), error => error.code === 'BACKEND_OPERATION_UNSUPPORTED');
});

test('a Firestore profile maps to the identity shape every guard reads', async () => {
  const firestore = fakeFirestore({
    users: [{ id: 'uid-1', email: 'morgan.chen@example.test', name: 'Chen, Morgan', role: 'faculty', facultyId: 'f1', active: true, mustChangePassword: false }]
  });
  const repository = createFirestoreUserRepository(firestore);
  const profile = await repository.findByUid('uid-1');
  assert.deepEqual(profile, {
    firebaseUid: 'uid-1',
    email: 'morgan.chen@example.test',
    displayName: 'Chen, Morgan',
    baseRole: 'faculty',
    facultyId: 'f1',
    active: true,
    mustChangePassword: false
  });
  assert.equal(await repository.findByUid('missing'), null);
});

test('the Firestore backend refuses to auto-provision an unknown account', async () => {
  const repository = createFirestoreUserRepository(fakeFirestore({ users: [] }));
  await assert.rejects(
    async () => repository.provision({ uid: 'stranger' }),
    error => error.code === 'PROFILE_NOT_PROVISIONED' && error.status === 403
  );
});

test('the runtime composes with the Firestore backend and needs no SQL connection', () => {
  const admin = {
    initializeApp() { return {}; },
    credential: { cert() { return {}; } },
    auth() { return { verifyIdToken: async () => ({}) }; },
    firestore() { return fakeFirestore({ sessions: sessionDocs }); }
  };
  const runtime = createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'vista-teaching-lab' },
    admin
  });
  assert.equal(typeof runtime, 'function');
  assert.equal(typeof runtime.close, 'function');
});

test('the Firestore backend reports its own unconfigured state, not the SQL one', async () => {
  // No firestore() on the injected admin, so the backend cannot be reached.
  const admin = {
    initializeApp() { return {}; },
    credential: { cert() { return {}; } },
    auth() {
      return { verifyIdToken: async () => ({ uid: 'u1', aud: 'vista-teaching-lab', iss: 'https://securetoken.google.com/vista-teaching-lab' }) };
    }
  };
  const runtime = createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'vista-teaching-lab' },
    admin
  });
  const response = await runtime(new Request('https://example.test/api/v1/dashboard/summary', {
    headers: { authorization: 'Bearer token' }
  }));
  assert.equal(response.status, 503);
  assert.equal(response.jsonBody.error.code, 'FIRESTORE_NOT_CONFIGURED');
  await runtime.close();
});

test('under Firestore an unimplemented domain answers 501, never a false 503 or empty list', async () => {
  const admin = {
    initializeApp() { return {}; },
    credential: { cert() { return {}; } },
    auth() {
      return { verifyIdToken: async () => ({ uid: 'u1', aud: 'vista-teaching-lab', iss: 'https://securetoken.google.com/vista-teaching-lab' }) };
    },
    firestore() {
      return fakeFirestore({
        sessions: sessionDocs,
        // Authentication runs before any domain route, so a real profile has to
        // exist or the request stops at 403 and never reaches the domain.
        users: [{ id: 'u1', email: 'morgan.chen@example.test', name: 'Chen, Morgan', role: 'adfa_regular', active: true, mustChangePassword: false }]
      });
    }
  };
  const runtime = createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'vista-teaching-lab' },
    admin
  });
  // A domain whose repository has no Firestore implementation. Its API catches the
  // repository failure and would answer 503 SQL_UNAVAILABLE; the route translates
  // that to 501 so "not built" is never mistaken for "temporarily broken".
  const response = await runtime(new Request('https://example.test/api/v1/dashboard/faculty', {
    headers: { authorization: 'Bearer token' }
  }));
  assert.equal(response.status, 501);
  assert.equal(response.jsonBody.error.code, 'BACKEND_OPERATION_UNSUPPORTED');
  await runtime.close();
});
