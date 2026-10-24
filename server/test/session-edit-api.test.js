'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDataApi } = require('../src/data/data-api');
const { createSqlSessionRepository } = require('../src/data/sql-session-repository');
const { createSwaFunctions } = require('../src/runtime/swa-functions');

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const PATCH = {
  date: '2026-10-05', startTime: '09:00', endTime: '10:00',
  courseCode: '315', sessionType: 'LEC', topic: 'Updated topic', room: 'VET 123'
};

function makeRequest(path, { method = 'PATCH', token = 'valid', body = PATCH } = {}) {
  return {
    method, url: 'https://local' + path,
    headers: { get: name => name.toLowerCase() === 'authorization' ? `Bearer ${token}` : null },
    json: async () => body
  };
}

function apiFor(profile, overrides = {}) {
  const calls = [];
  const api = createDataApi({
    verifyToken: async () => ({ uid: 'firebase-actor' }),
    findUser: async () => profile,
    listSessions: async () => [],
    updateSession: async input => { calls.push(input); return { id: SESSION_ID, ...PATCH }; },
    writeGates: { sessionEdit: true },
    ...overrides
  });
  return { api, calls };
}

test('SQL session PATCH fails closed by default before calling its write repository', async () => {
  let writes = 0;
  const api = createDataApi({
    verifyToken: async () => ({ uid: 'firebase-actor' }),
    findUser: async () => ({ active: true, mustChangePassword: false, baseRole: 'owner' }),
    listSessions: async () => [],
    updateSession: async () => { writes++; }
  });
  const response = await api.updateExistingSession('token-secret', SESSION_ID, PATCH);
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'WRITE_DISABLED');
  assert.equal(writes, 0);
  assert.doesNotMatch(JSON.stringify(response), /token-secret|firebase-actor/);
});

test('SQL session PATCH keeps authentication and authorization ahead of the disabled gate', async () => {
  const api = createDataApi({
    verifyToken: async () => { throw new Error('invalid token'); },
    findUser: async () => null,
    listSessions: async () => [],
    updateSession: async () => { throw new Error('must not write'); }
  });
  assert.equal((await api.updateExistingSession('secret', SESSION_ID, PATCH)).status, 401);
});

test('SQL session edit requires an active server profile and an explicitly allowed admin role', async () => {
  for (const profile of [null, { active: false, baseRole: 'administrator' }, { active: true, baseRole: 'faculty' }, { active: true, baseRole: 'hicc' }]) {
    let writes = 0;
    const { api } = apiFor(profile, { updateSession: async () => { writes++; } });
    const result = await api.updateExistingSession('valid', SESSION_ID, PATCH);
    assert.equal(result.status, 403);
    assert.equal(writes, 0);
  }
});

test('SQL session edit derives its actor from Firebase and does not trust caller actor fields', async () => {
  const { api, calls } = apiFor({ active: true, mustChangePassword: false, baseRole: 'adfa_general', displayName: 'Admin' });
  const result = await api.updateExistingSession('valid', SESSION_ID, { ...PATCH, actorUid: 'spoofed', actorName: 'Spoofed' });
  assert.equal(result.status, 400);
  assert.equal(calls.length, 0);

  const accepted = await api.updateExistingSession('valid', SESSION_ID, PATCH);
  assert.equal(accepted.status, 200);
  assert.equal(calls[0].actorFirebaseUid, 'firebase-actor');
  assert.equal(calls[0].actorName, 'Admin');
  assert.equal(calls[0].sessionId, SESSION_ID);
});

test('SQL session edit rejects malformed identifiers, dates, intervals, types, and unsupported keys', async () => {
  const { api, calls } = apiFor({ active: true, mustChangePassword: false, baseRole: 'administrator' });
  for (const [id, patch] of [
    ['bad-id', PATCH], [SESSION_ID, { ...PATCH, date: '2026-02-30' }],
    [SESSION_ID, { ...PATCH, startTime: '10:00', endTime: '09:00' }],
    [SESSION_ID, { ...PATCH, sessionType: 'not-a-session-type' }],
    [SESSION_ID, { ...PATCH, facultyAssignments: [] }]
  ]) {
    assert.equal((await api.updateExistingSession('valid', id, patch)).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('SQL session edit returns not found and contains repository failures', async () => {
  const profile = { active: true, mustChangePassword: false, baseRole: 'owner' };
  let { api } = apiFor(profile, { updateSession: async () => null });
  assert.equal((await api.updateExistingSession('valid', SESSION_ID, PATCH)).status, 404);
  ({ api } = apiFor(profile, { updateSession: async () => { throw Error('private SQL detail'); } }));
  const failed = await api.updateExistingSession('valid', SESSION_ID, PATCH);
  assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(failed), /private SQL detail/);
});

test('SQL session edit exposes only reviewed validation/conflict categories from its stored procedure', async () => {
  const profile = { active: true, mustChangePassword: false, baseRole: 'owner' };
  for (const [number, status, code] of [
    [51242, 400, 'INVALID_SESSION_VALUES'],
    [51243, 400, 'COURSE_NOT_FOUND'],
    [51244, 409, 'SESSION_ACADEMIC_YEAR_INVALID'],
    [51245, 400, 'SESSION_DATE_OUTSIDE_ACADEMIC_YEAR'],
    [51246, 409, 'DUPLICATE_SESSION_CONFLICT']
  ]) {
    const { api } = apiFor(profile, { updateSession: async () => { throw Object.assign(new Error('private SQL details'), { number }); } });
    const response = await api.updateExistingSession('valid', SESSION_ID, PATCH);
    assert.equal(response.status, status);
    assert.equal(response.body.error.code, code);
    assert.doesNotMatch(JSON.stringify(response), /private SQL details/);
  }
});

test('SQL session repository uses one fixed procedure call and never writes assignments', async () => {
  let seen;
  const repository = createSqlSessionRepository({ query: async (query, params) => { seen = { query, params }; return [{ id: SESSION_ID }]; } });
  await repository.updateExisting({ sessionId: SESSION_ID, actorFirebaseUid: 'u', actorName: 'Admin', ...PATCH });
  assert.match(seen.query, /EXEC\s+paws_api\.UpdateCalendarSession/i);
  assert.match(seen.query, /@ActorFirebaseUid\s*=\s*@actorFirebaseUid/i);
  assert.doesNotMatch(seen.query, /SessionAssignment|DELETE\s+FROM|staging\./i);
  assert.equal(seen.params.sessionId, SESSION_ID);
  assert.equal(seen.params.actorFirebaseUid, 'u');
});

test('PATCH route is limited to one session id and rejects unsupported methods or malformed JSON', async () => {
  let call;
  const route = createSwaFunctions({ api: {
    health: async () => ({}), currentUser: async () => ({}), sessions: async () => ({}),
    updateExistingSession: async (...args) => { call = args; return { status: 200, body: { session: {} } }; }
  } });
  assert.equal((await route(makeRequest('/api/v1/sessions/' + SESSION_ID))).status, 200);
  assert.equal(call[1], SESSION_ID);
  assert.equal(call[2].courseCode, PATCH.courseCode);
  const unsupported = await route(makeRequest('/api/v1/sessions/' + SESSION_ID, { method: 'DELETE' }));
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.Allow, 'PATCH');
  assert.equal((await route({ ...makeRequest('/api/v1/sessions/' + SESSION_ID), json: async () => { throw Error('bad'); } })).status, 400);
});

test('session edit SQL migration is transactional, audited, scalar-only, and separately reversible', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const migration = fs.readFileSync(path.resolve(__dirname, '../../database/azure-sql/012_session_edit_api.sql'), 'utf8');
  const rollback = fs.readFileSync(path.resolve(__dirname, '../../database/azure-sql/rollback_012_session_edit_api.sql'), 'utf8');
  assert.match(migration, /CREATE OR ALTER PROCEDURE paws_api\.UpdateCalendarSession/i);
  assert.match(migration, /BEGIN TRANSACTION[\s\S]*INSERT paws\.AuditEvent[\s\S]*COMMIT TRANSACTION/i);
  assert.match(migration, /WITH \(UPDLOCK, HOLDLOCK\)/i);
  assert.match(migration, /Unsupported or duplicate session edit fields/i);
  assert.match(migration, /@NextDate\s*<\s*DATEFROMPARTS\([\s\S]*,\s*5,\s*1\)[\s\S]*@NextDate\s*>=\s*DATEFROMPARTS\([\s\S]*\+\s*1,\s*5,\s*1\)/i);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?paws\.SessionAssignment/i);
  assert.match(rollback, /DROP PROCEDURE paws_api\.UpdateCalendarSession/i);
  assert.doesNotMatch(rollback, /DROP TABLE|DELETE FROM/i);
});
