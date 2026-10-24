'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDataApi } = require('../src/data/data-api');
const { createWriteGates } = require('../src/data/write-gates');
const { createSqlSessionRepository } = require('../src/data/sql-session-repository');
const { createSwaFunctions } = require('../src/runtime/swa-functions');

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const FACULTY_ID = '22222222-3333-4444-8555-666666666666';
const REQUEST_ID = '33333333-4444-4555-8666-777777777777';
const SESSION = Object.freeze({
  academicYear: '2026-27', curriculumYear: '1', courseCode: '315', sessionType: 'LEC',
  date: '2026-10-06', startTime: '09:00', endTime: '10:00', topic: 'P1 contract test',
  room: 'VET 123', assignments: [{ facultyId: FACULTY_ID, teachingRole: 'Lecture' }]
});

function makeApi({ role = 'administrator', gates = {}, overrides = {} } = {}) {
  const calls = { create: [], batch: [], assignments: [] };
  const api = createDataApi({
    verifyToken: async () => ({ uid: 'firebase-actor' }),
    findUser: async () => ({ active: true, mustChangePassword: false, baseRole: role, displayName: 'Canonical Admin' }),
    listSessions: async () => [],
    createSession: async input => { calls.create.push(input); return { id: SESSION_ID, ...input.session }; },
    createSessionBatch: async input => { calls.batch.push(input); return input.sessions.map((session, index) => ({ id: SESSION_ID.replace(/1/g, String(index + 1)), ...session })); },
    replaceSessionAssignments: async input => { calls.assignments.push(input); return { id: input.sessionId, assignments: input.assignments }; },
    writeGates: gates,
    ...overrides
  });
  return { api, calls };
}

test('session create gate is independent, exact-true, and fail-closed by default', () => {
  assert.deepEqual(createWriteGates({}), {
    swapRequest: false, swapDecision: false, swapApply: false, afcSingle: false, afcBatch: false, afcCancel: false, sessionEdit: false, sessionCreate: false,
    afcRequest: false, afcDecision: false, afcArtifact: false, afcFormUpload: false, cccReplaceStage: false, cccReplaceCommit: false,
    taDraft: false, taReview: false, taFinal: false, taPublish: false, facultyAdmin: false,
    doeAdmin: false, doeManualAssignment: false, doePolicyPublish: false, doeRecalculate: false,
    schedulingTaskReview:false,calendarActivityStage:false,calendarActivityCommit:false,calendarActivityTime:false
  });
  assert.equal(createWriteGates({ PAWS_SESSION_CREATE_WRITE_ENABLED: 'TRUE' }).sessionCreate, false);
  assert.equal(createWriteGates({ PAWS_SESSION_CREATE_WRITE_ENABLED: 'true' }).sessionCreate, true);
  assert.equal(createWriteGates({ PAWS_SESSION_CREATE_WRITE_ENABLED: 'true', PAWS_SESSION_EDIT_WRITE_ENABLED: 'false' }).sessionEdit, false);
});

test('single session create is disabled before repository invocation when its gate is false', async () => {
  const { api, calls } = makeApi({ role: 'developer' });
  const response = await api.createSession('token', SESSION);
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'WRITE_DISABLED');
  assert.equal(calls.create.length, 0);
});

test('single session create is admin-only and derives actor identity from verified Firebase and SQL profile', async () => {
  const { api, calls } = makeApi({ role: 'developer', gates: { sessionCreate: true } });
  const response = await api.createSession('token', SESSION);
  assert.equal(response.status, 201);
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].actorFirebaseUid, 'firebase-actor');
  assert.equal(calls.create[0].actorName, 'Canonical Admin');
  assert.deepEqual(calls.create[0].session, SESSION);

  for (const role of ['faculty', 'hicc', 'visc', 'viewer']) {
    const denied = makeApi({ role, gates: { sessionCreate: true } });
    assert.equal((await denied.api.createSession('token', SESSION)).status, 403);
    assert.equal(denied.calls.create.length, 0);
  }
});

test('session create rejects actor forgery, unsupported fields, and unvalidated values before SQL', async () => {
  const { api, calls } = makeApi({ gates: { sessionCreate: true } });
  for (const session of [
    { ...SESSION, actorFirebaseUid: 'spoofed' },
    { ...SESSION, doeCredit: 8 },
    { ...SESSION, date: '2026-02-30' },
    { ...SESSION, academicYear: '2026-28' },
    { ...SESSION, sessionType: 'arbitrary' },
    { ...SESSION, sessionType: 'CCC' },
    { ...SESSION, startTime: '10:00', endTime: '09:00' },
    { ...SESSION, assignments: [{ facultyId: FACULTY_ID, displayName: 'Impersonated Faculty' }] }
  ]) {
    assert.equal((await api.createSession('token', session)).status, 400);
  }
  assert.equal(calls.create.length, 0);
});

test('session batch validates all rows and duplicate keys before one repository call', async () => {
  const { api, calls } = makeApi({ gates: { sessionCreate: true } });
  const duplicated = await api.createSessionBatch('token', { requestId: REQUEST_ID, sessions: [SESSION, { ...SESSION, startTime: '09:00:00', endTime: '10:00:00' }] });
  assert.equal(duplicated.status, 409);
  assert.equal(calls.batch.length, 0);

  const invalid = await api.createSessionBatch('token', { requestId: REQUEST_ID, sessions: [SESSION, { ...SESSION, date: 'bad' }] });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error.code, /ROW|DUPLICATE|INVALID/);
  assert.equal(calls.batch.length, 0);

  const accepted = await api.createSessionBatch('token', { requestId: REQUEST_ID, sessions: [SESSION] });
  assert.equal(accepted.status, 201);
  assert.equal(calls.batch.length, 1);
  assert.equal(calls.batch[0].requestId, REQUEST_ID);
  assert.equal(calls.batch[0].actorFirebaseUid, 'firebase-actor');
});

test('batch canonical duplicate conflict returns a safe row-indexed server error', async () => {
  const conflict = makeApi({
    gates: { sessionCreate: true },
    overrides: { createSessionBatch: async () => { const error = new Error('Batch row 2 conflicts with canonical timetable data.'); error.number = 51253; throw error; } }
  });
  const response = await conflict.api.createSessionBatch('token', { requestId: REQUEST_ID, sessions: [SESSION] });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body.error.details, [{ row: 2, code: 'DUPLICATE_SESSION_CONFLICT' }]);
  assert.doesNotMatch(JSON.stringify(response.body), /canonical timetable data|firebase-actor|Canonical Admin/);
});

test('session batch returns explicit idempotent replay status from the fixed procedure result', async () => {
  const replay = makeApi({
    gates: { sessionCreate: true },
    overrides: { createSessionBatch: async () => [{ id: SESSION_ID, idempotentReplay: 1 }] }
  });
  const response = await replay.api.createSessionBatch('token', { requestId: REQUEST_ID, sessions: [SESSION] });
  assert.equal(response.status, 200);
  assert.equal(response.body.idempotentReplay, true);
});

test('session assignment targets are requested only for timetable-edit administrators', async () => {
  const requests = [];
  const make = role => createDataApi({
    verifyToken: async () => ({ uid: 'firebase-actor' }),
    findUser: async () => ({ active: true, baseRole: role, facultyId: role === 'faculty' ? FACULTY_ID : null }),
    listSessions: async input => { requests.push({ role, ...input }); return []; }
  });
  for (const role of ['developer', 'administrator', 'adfa_regular', 'faculty']) {
    assert.equal((await make(role).sessions('token', {})).status, 200);
  }
  assert.equal((await make('viewer').sessions('token', {})).status, 403, 'unsupported viewer role fails closed');
  assert.deepEqual(requests.map(({ role, includeAssignmentTargets }) => [role, includeAssignmentTargets]), [
    ['developer', true], ['administrator', true], ['adfa_regular', true], ['faculty', false]
  ]);
});

test('session batch enforces the 200-row bound and denies non-admin callers', async () => {
  const sessions = Array.from({ length: 201 }, (_, index) => ({ ...SESSION, topic: `topic ${index}`, date: `2026-10-${String((index % 28) + 1).padStart(2, '0')}` }));
  const { api, calls } = makeApi({ gates: { sessionCreate: true } });
  assert.equal((await api.createSessionBatch('token', { requestId: REQUEST_ID, sessions })).status, 400);
  assert.equal(calls.batch.length, 0);
  const denied = makeApi({ role: 'faculty', gates: { sessionCreate: true } });
  assert.equal((await denied.api.createSessionBatch('token', { requestId: REQUEST_ID, sessions: [SESSION] })).status, 403);
  assert.equal(denied.calls.batch.length, 0);
});

test('assignment replacement is admin-only, gated, and accepts canonical FacultyIds only', async () => {
  const { api, calls } = makeApi({ gates: { sessionEdit: true } });
  const response = await api.replaceSessionAssignments('token', SESSION_ID, { assignments: [{ facultyId: FACULTY_ID, teachingRole: 'Lecture' }] });
  assert.equal(response.status, 200);
  assert.equal(calls.assignments.length, 1);
  assert.equal(calls.assignments[0].actorFirebaseUid, 'firebase-actor');
  assert.equal(calls.assignments[0].assignments[0].facultyId, FACULTY_ID);

  for (const payload of [
    { assignments: [{ displayName: 'Faculty Name' }] },
    { assignments: [{ facultyId: FACULTY_ID, doeCredit: 4 }] },
    { assignments: [{ facultyId: 'not-a-uuid' }] }
  ]) assert.equal((await api.replaceSessionAssignments('token', SESSION_ID, payload)).status, 400);
  assert.equal(calls.assignments.length, 1);

  const denied = makeApi({ role: 'faculty', gates: { sessionEdit: true } });
  assert.equal((await denied.api.replaceSessionAssignments('token', SESSION_ID, { assignments: [] })).status, 403);
  assert.equal(denied.calls.assignments.length, 0);
});

test('new SQL write repository methods call only their three fixed reviewed procedures', async () => {
  const calls = [];
  const repository = createSqlSessionRepository({ query: async (sql, params) => { calls.push({ sql, params }); return [{ id: SESSION_ID }]; } });
  await repository.createNew({ session: SESSION, actorFirebaseUid: 'firebase-actor', actorName: 'Canonical Admin' });
  await repository.createBatch({ requestId: REQUEST_ID, sessions: [SESSION], actorFirebaseUid: 'firebase-actor', actorName: 'Canonical Admin' });
  await repository.replaceAssignments({ sessionId: SESSION_ID, assignments: SESSION.assignments, actorFirebaseUid: 'firebase-actor', actorName: 'Canonical Admin' });
  assert.match(calls[0].sql, /EXEC\s+paws_api\.CreateCalendarSession/i);
  assert.match(calls[1].sql, /EXEC\s+paws_api\.CreateCalendarSessionBatch/i);
  assert.match(calls[2].sql, /EXEC\s+paws_api\.ReplaceCalendarSessionAssignments/i);
  assert.doesNotMatch(calls.map(call => call.sql).join('\n'), /INSERT\s+INTO\s+paws\.|UPDATE\s+paws\.|DELETE\s+FROM\s+paws\./i);
  assert.equal(calls[0].params.actorFirebaseUid, 'firebase-actor');
  assert.equal(calls[1].params.requestId, REQUEST_ID);
  assert.equal(JSON.parse(calls[2].params.assignmentsJson)[0].facultyId, FACULTY_ID);
});

test('session list includes canonical assignment identities only for explicit administrator projection', async () => {
  const calls = [];
  const repository = createSqlSessionRepository({ query: async (sql, params) => { calls.push({ sql, params }); return []; } });
  await repository.list({ includeAssignmentTargets: false });
  await repository.list({ includeAssignmentTargets: true });
  assert.match(calls[0].sql, /CAST\(N'\[\]' AS nvarchar\(max\)\) AS assignmentsJson/);
  assert.doesNotMatch(calls[0].sql, /REPLACE\([\s\S]*?f\.PreferredFirstName[\s\S]*? AS displayName/);
  assert.match(calls[1].sql, /REPLACE\([\s\S]*?f\.PreferredFirstName[\s\S]*? AS displayName/);
  assert.match(calls[1].sql, /unresolvedAssignmentCount/);
});

test('University API exposes only POST create/batch and PATCH assignment routes', async () => {
  const calls = [];
  const route = createSwaFunctions({ api: {
    health: async () => ({}), currentUser: async () => ({}), sessions: async () => ({}), updateExistingSession: async () => ({}),
    createSession: async (...args) => { calls.push(['create', ...args]); return { status: 201, body: { session: {} } }; },
    createSessionBatch: async (...args) => { calls.push(['batch', ...args]); return { status: 201, body: { sessions: [] } }; },
    replaceSessionAssignments: async (...args) => { calls.push(['assignments', ...args]); return { status: 200, body: { session: {} } }; }
  } });
  const request = (path, method, body = {}) => ({ method, url: 'https://local' + path, headers: { get: name => name.toLowerCase() === 'authorization' ? 'Bearer test' : null }, json: async () => body });
  assert.equal((await route(request('/api/v1/sessions', 'POST', SESSION))).status, 201);
  assert.equal((await route(request('/api/v1/sessions/batch', 'POST', { requestId: REQUEST_ID, sessions: [SESSION] }))).status, 201);
  assert.equal((await route(request(`/api/v1/sessions/${SESSION_ID}/assignments`, 'PATCH', { assignments: [] }))).status, 200);
  assert.equal((await route(request('/api/v1/sessions/batch', 'GET'))).status, 405);
  assert.equal((await route(request(`/api/v1/sessions/${SESSION_ID}/assignments`, 'POST'))).status, 405);
  assert.deepEqual(calls.map(call => call[0]), ['create', 'batch', 'assignments']);
  assert.equal(calls[0][2].courseCode, SESSION.courseCode);
  assert.equal(calls[1][2].requestId, REQUEST_ID);
});
