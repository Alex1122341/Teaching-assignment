'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createFirestoreRoleAssignmentRepository,
  toRecord,
  validatePeriods
} = require('../src/data/firestore/firestore-role-assignment-repository');

// The authoritative rule (server/src/roles/role-effective-status.js):
// startDate and endDate are INCLUSIVE Calgary dates; null endDate is open-ended.
// These tests pin the exact boundaries, because an off-by-one here is invisible
// until somebody's appointment ends a day early.

const doc = (overrides = {}) => ({
  facultyId: 'fac-001',
  academicYear: '2026-27',
  roleCategory: 'Leadership',
  roleType: 'HICC',
  scopeKind: 'course',
  scopeCode: 'VETM 301',
  periods: [{ startDate: '2026-09-01', endDate: '2027-06-30' }],
  revision: 1,
  ...overrides
});

test('the starting date is already effective', () => {
  const record = toRecord('r1', doc(), '2026-09-01');
  assert.equal(record.status, 'active');
  assert.equal(record.statusStartDate, '2026-09-01');
});

test('the day before the start is upcoming', () => {
  const record = toRecord('r1', doc(), '2026-08-31');
  assert.equal(record.status, 'upcoming');
  // The classifier reports the deciding period's start as statusStartDate for an
  // upcoming appointment; nextStartDate is only set when the caller is inactive.
  assert.equal(record.statusStartDate, '2026-09-01');
});

test('the ending date is still effective — end dates are inclusive', () => {
  const record = toRecord('r1', doc(), '2027-06-30');
  assert.equal(record.status, 'active', 'the last day must count');
  assert.equal(record.statusEndDate, '2027-06-30');
});

test('the day after expiration is inactive', () => {
  const record = toRecord('r1', doc(), '2027-07-01');
  assert.equal(record.status, 'inactive');
  assert.equal(record.statusEndDate, '2027-06-30');
});

test('an open-ended period stays effective indefinitely', () => {
  const record = toRecord('r1', doc({ periods: [{ startDate: '2026-09-01', endDate: null }] }), '2030-01-01');
  assert.equal(record.status, 'active');
  assert.equal(record.statusEndDate, null);
});

test('a gap between periods is inactive, and the next start is reported', () => {
  const record = toRecord('r1', doc({
    periods: [
      { startDate: '2026-09-01', endDate: '2026-12-31' },
      { startDate: '2027-02-01', endDate: '2027-06-30' }
    ]
  }), '2027-01-15');
  assert.equal(record.status, 'inactive', 'a gap is not active');
  assert.equal(record.nextStartDate, '2027-02-01');
});

test('a later period in the same assignment becomes active again', () => {
  const record = toRecord('r1', doc({
    periods: [
      { startDate: '2026-09-01', endDate: '2026-12-31' },
      { startDate: '2027-02-01', endDate: '2027-06-30' }
    ]
  }), '2027-02-01');
  assert.equal(record.status, 'active');
  assert.equal(record.statusStartDate, '2027-02-01');
});

test('all periods in the future is upcoming, not inactive', () => {
  const record = toRecord('r1', doc({
    periods: [{ startDate: '2027-09-01', endDate: '2028-06-30' }]
  }), '2026-09-01');
  assert.equal(record.status, 'upcoming');
});

test('a period with no start cannot prove anything', () => {
  const record = toRecord('r1', doc({ periods: [{ startDate: null, endDate: '2027-06-30' }] }), '2026-09-01');
  assert.equal(record.status, 'dates-needed');
});

test('status is derived on read, never stored', () => {
  const stored = doc();
  assert.equal('status' in stored, false, 'a stored status would be a second source of truth');
  assert.equal(toRecord('r1', stored, '2026-09-01').status, 'active');
  assert.equal(toRecord('r1', stored, '2027-07-01').status, 'inactive');
});

test('period validation rejects impossible windows', () => {
  assert.match(validatePeriods([{ startDate: '2026-09-01', endDate: '2026-08-01' }]), /cannot end before it starts/);
  assert.match(validatePeriods([{ startDate: null, endDate: '2027-01-01' }]), /needs a start date/);
  assert.match(validatePeriods([{ startDate: 'not-a-date' }]), /Invalid start date/);
  assert.equal(validatePeriods([]), null, 'explicit empty periods are valid and inactive');
  assert.equal(validatePeriods([{ startDate: '2026-09-01', endDate: '2026-09-01' }]), null, 'a one-day period is valid');
  assert.equal(validatePeriods([{ startDate: '2026-09-01', endDate: null }]), null);
});

// ---------------------------------------------------------------------------
// Transactional writes
// ---------------------------------------------------------------------------
function fakeFirestore({ faculty = [{ id: 'fac-001', firstName: 'Morgan', lastName: 'Chen' }], assignments = [] } = {}) {
  const state = { assignments: [...assignments], audit: [] };
  const snapshotOf = (data, id) => ({ id, exists: Boolean(data), data: () => data || {}, get: async () => snapshotOf(data, id) });

  const collection = name => ({
    doc(id) {
      if (name === 'faculty') {
        const found = faculty.find(f => f.id === id);
        return { id, _kind: 'faculty', _data: found };
      }
      if (name === 'role_assignment_audit') return { id: null, _kind: 'audit', _data: null };
      const found = state.assignments.find(a => a.id === id);
      return { id, _kind: 'assignment', _data: found };
    },
    async get() {
      if (name === 'role_assignments') return { docs: state.assignments.map(a => ({ id: a.id, data: () => a })) };
      return { docs: [] };
    },
    where() { return this; }
  });

  return {
    state,
    collection,
    async runTransaction(fn) {
      const ops = [];
      const transaction = {
        async get(ref) {
          if (ref._kind === 'faculty') return snapshotOf(ref._data, ref.id);
          return snapshotOf(ref._data, ref.id);
        },
        set(ref, data) { ops.push({ ref, data }); }
      };
      const result = await fn(transaction);
      for (const { ref, data } of ops) {
        if (ref._kind === 'audit') state.audit.push(data);
        else {
          const index = state.assignments.findIndex(a => a.id === ref.id);
          const stored = { id: ref.id, ...data };
          if (index >= 0) state.assignments[index] = stored;
          else state.assignments.push(stored);
        }
      }
      return result;
    }
  };
}

test('creating an assignment writes it with its audit record in one transaction', async () => {
  const firestore = fakeFirestore();
  const repository = createFirestoreRoleAssignmentRepository(firestore);
  const record = await repository.create({
    assignment: { facultyId: 'fac-001', academicYear: '2026-27', roleCategory: 'Leadership', roleType: 'HICC', scopeKind: 'course', scopeCode: 'VETM 301', periods: [{ startDate: '2026-09-01', endDate: '2027-06-30' }] },
    actorFirebaseUid: 'admin-1',
    idFactory: () => 'ra-1'
  });
  assert.equal(record.roleAssignmentId, 'ra-1');
  assert.equal(record.revision, 1);
  assert.equal(firestore.state.assignments.length, 1);
  assert.equal(firestore.state.audit.length, 1, 'an unaudited write must not be possible');
  assert.equal(firestore.state.audit[0].action, 'create');
});

test('creating against a missing faculty record is refused', async () => {
  const firestore = fakeFirestore();
  const repository = createFirestoreRoleAssignmentRepository(firestore);
  await assert.rejects(
    () => repository.create({ assignment: { facultyId: 'fac-999', roleType: 'HICC', periods: [{ startDate: '2026-09-01' }] }, actorFirebaseUid: 'admin-1', idFactory: () => 'ra-2' }),
    error => error.code === 'FACULTY_NOT_FOUND'
  );
  assert.equal(firestore.state.assignments.length, 0);
  assert.equal(firestore.state.audit.length, 0, 'a refused write must leave no audit trace of a change');
});

test('a stale revision is rejected with 409 and writes nothing', async () => {
  const firestore = fakeFirestore({ assignments: [{ id: 'ra-1', ...doc({ revision: 3 }) }] });
  const repository = createFirestoreRoleAssignmentRepository(firestore);
  await assert.rejects(
    () => repository.update({ roleAssignmentId: 'ra-1', expectedRevision: 2, assignment: { periods: [{ startDate: '2026-09-01' }] }, actorFirebaseUid: 'admin-1' }),
    error => error.code === 'REVISION_CONFLICT' && error.status === 409
  );
  assert.equal(firestore.state.assignments[0].revision, 3, 'the record must be untouched');
  assert.equal(firestore.state.audit.length, 0);
});

test('an accepted update bumps the revision and appends before/after', async () => {
  const firestore = fakeFirestore({ assignments: [{ id: 'ra-1', ...doc({ revision: 1 }) }] });
  const repository = createFirestoreRoleAssignmentRepository(firestore);
  const record = await repository.update({
    roleAssignmentId: 'ra-1',
    expectedRevision: 1,
    assignment: { periods: [{ startDate: '2026-09-01', endDate: '2027-12-31' }] },
    actorFirebaseUid: 'admin-1'
  });
  assert.equal(record.revision, 2);
  assert.equal(firestore.state.audit.length, 1);
  assert.equal(firestore.state.audit[0].action, 'update');
  assert.ok(firestore.state.audit[0].before, 'the audit must record what changed');
  assert.ok(firestore.state.audit[0].after);
});

// ---------------------------------------------------------------------------
// Period sequence validation
// ---------------------------------------------------------------------------
test('touching periods are rejected because inclusive boundaries share a day', () => {
  assert.match(
    validatePeriods([
      { startDate: '2026-09-01', endDate: '2026-12-31' },
      { startDate: '2026-12-31', endDate: '2027-06-30' }
    ]),
    /must not overlap or share a boundary date/
  );
});

test('genuinely overlapping periods are rejected', () => {
  assert.match(
    validatePeriods([
      { startDate: '2026-09-01', endDate: '2027-01-31' },
      { startDate: '2027-01-01', endDate: '2027-06-30' }
    ]),
    /must not overlap/
  );
});

test('adjacent periods with a clean gap are accepted', () => {
  assert.equal(validatePeriods([
    { startDate: '2026-09-01', endDate: '2026-12-31' },
    { startDate: '2027-01-01', endDate: '2027-06-30' }
  ]), null);
});

test('out-of-order periods are rejected', () => {
  assert.match(
    validatePeriods([
      { startDate: '2027-01-01', endDate: '2027-06-30' },
      { startDate: '2026-09-01', endDate: '2026-12-31' }
    ]),
    /must be ordered by start date/
  );
});

test('duplicate start dates are rejected', () => {
  assert.match(
    validatePeriods([
      { startDate: '2026-09-01', endDate: '2026-10-31' },
      { startDate: '2026-09-01', endDate: '2026-12-31' }
    ]),
    /cannot start on the same date/
  );
});

test('nothing may follow an open-ended period', () => {
  assert.match(
    validatePeriods([
      { startDate: '2026-09-01', endDate: null },
      { startDate: '2027-01-01', endDate: '2027-06-30' }
    ]),
    /may follow an open-ended period/
  );
});

test('more than twelve periods is refused', () => {
  const many = Array.from({ length: 13 }, (_, i) => ({
    startDate: String(2020 + i) + '-09-01',
    endDate: String(2020 + i) + '-12-31'
  }));
  assert.match(validatePeriods(many), /At most twelve periods/);
});

test('an explicit empty schedule can be saved without deleting the role', () => {
  assert.equal(validatePeriods([]), null);
});

test('an explicit empty schedule is inactive, not dates-needed', () => {
  // A document that says `periods: []` has made a statement: no coverage.
  const explicit = toRecord('r1', doc({ periods: [] }), '2026-09-01');
  assert.equal(explicit.status, 'inactive');

  // A document with no periods field at all never established its dates.
  const legacy = toRecord('r2', { facultyId: 'fac-001', roleType: 'HICC', revision: 1 }, '2026-09-01');
  assert.equal(legacy.status, 'dates-needed');
});

test('creating over an existing assignment id is refused, not silently overwritten', async () => {
  const firestore = fakeFirestore({ assignments: [{ id: 'ra-1', ...doc({ revision: 1 }) }] });
  const repository = createFirestoreRoleAssignmentRepository(firestore);
  await assert.rejects(
    () => repository.create({
      assignment: { facultyId: 'fac-001', roleType: 'VISC', periods: [{ startDate: '2026-09-01' }] },
      actorFirebaseUid: 'admin-1',
      idFactory: () => 'ra-1'
    }),
    error => error.code === 'ASSIGNMENT_EXISTS' && error.status === 409
  );
  assert.equal(firestore.state.assignments.length, 1, 'the existing record must survive');
  assert.equal(firestore.state.assignments[0].roleType, 'HICC', 'and must not be mutated');
});

test('a write without a verified actor is refused', async () => {
  const firestore = fakeFirestore();
  const repository = createFirestoreRoleAssignmentRepository(firestore);
  await assert.rejects(
    () => repository.create({ assignment: { facultyId: 'fac-001', roleType: 'HICC', periods: [{ startDate: '2026-09-01' }] }, actorFirebaseUid: '', idFactory: () => 'ra-9' }),
    error => error.code === 'ACTOR_REQUIRED'
  );
  assert.equal(firestore.state.audit.length, 0);
});
