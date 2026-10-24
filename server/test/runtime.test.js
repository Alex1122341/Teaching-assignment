'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDataApi, FACULTY_SCOPED_ROLES } = require('../src/data/data-api');
const { createSwaFunctions } = require('../src/runtime/swa-functions');

const request = (url, token = 'ok') => ({
  method: 'GET',
  url: 'https://local' + url,
  headers: { get: name => name.toLowerCase() === 'authorization' ? 'Bearer ' + token : null }
});

test('missing, inactive and password-change SQL profiles fail closed', async () => {
  for (const profile of [null, { active: false }, { active: true, baseRole: 'administrator', mustChangePassword: true }]) {
    let reads = 0;
    const api = createDataApi({
      verifyToken: async () => ({ uid: 'u' }),
      findUser: async () => profile,
      listSessions: async () => { reads++; return []; }
    });
    assert.equal((await api.currentUser('ok')).status, 403);
    assert.equal(reads, 0);
  }
});

test('invalid Firebase token is rejected before SQL profile lookup', async () => {
  let lookups = 0;
  const api = createDataApi({
    verifyToken: async () => { throw new Error('bad token'); },
    findUser: async () => { lookups++; return null; },
    listSessions: async () => []
  });
  assert.equal((await api.currentUser('bad')).status, 401);
  assert.equal(lookups, 0);
});

test('only faculty, HICC and VISC are Faculty-scoped', () => {
  assert.deepEqual([...FACULTY_SCOPED_ROLES].sort(), ['faculty', 'hicc', 'visc']);
});

test('HICC requires FacultyId and unsupported viewer role fails closed', async () => {
  let scope;
  const base = { verifyToken: async () => ({ uid: 'u' }), listSessions: async args => { scope = args; return []; } };
  let api = createDataApi({ ...base, findUser: async () => ({ active: true, mustChangePassword: false, baseRole: 'hicc', facultyId: null }) });
  assert.equal((await api.sessions('ok', {})).status, 403);

  api = createDataApi({ ...base, findUser: async () => ({ active: true, mustChangePassword: false, baseRole: 'viewer', facultyId: null }) });
  assert.equal((await api.sessions('ok', {})).status, 403);
  assert.equal(scope, undefined);
});

test('Faculty-scoped session reads pass FacultyId to repository', async () => {
  let scope;
  const api = createDataApi({
    verifyToken: async () => ({ uid: 'u' }),
    findUser: async () => ({ active: true, mustChangePassword: false, baseRole: 'hicc', facultyId: 'f1' }),
    listSessions: async args => { scope = args; return [{ id: 's1' }]; }
  });
  const out = await api.sessions('ok', { start: '2026-09-01', end: '2026-09-08' });
  assert.equal(out.status, 200);
  assert.equal(scope.facultyId, 'f1');
  assert.equal(scope.start, '2026-09-01');
});

test('unbounded GET sessions is allowed for the canonical dataset', async () => {
  const rows = Array.from({ length: 1937 }, (_, i) => ({ id: String(i) }));
  const api = createDataApi({
    verifyToken: async () => ({ uid: 'u' }),
    findUser: async () => ({ active: true, mustChangePassword: false, baseRole: 'administrator', facultyId: null }),
    listSessions: async args => {
      assert.equal(args.start, null);
      assert.equal(args.end, null);
      return rows;
    }
  });
  const out = await api.sessions('ok', {});
  assert.equal(out.status, 200);
  assert.equal(out.body.sessions.length, 1937);
});

test('HTTP wrapper exposes authenticated read and explicitly scoped write routes', async () => {
  const api = {
    health: async () => ({ status: 503, body: { error: { code: 'SQL_UNAVAILABLE', message: 'safe' } } }),
    currentUser: async () => ({ status: 200, body: { profile: {} } }),
    sessions: async () => ({ status: 200, body: { sessions: [] } }),
    updateExistingSession: async () => ({ status: 200, body: { session: {} } }),
    createSession: async () => ({ status: 201, body: { session: {} } }),
    createSessionBatch: async () => ({ status: 201, body: { sessions: [] } }),
    replaceSessionAssignments: async () => ({ status: 200, body: { session: {} } })
  };
  const app = createSwaFunctions({ api });
  assert.equal((await app(request('/api/v1/me'))).status, 200);
  assert.equal((await app(request('/api/v1/sessions'))).status, 200);
  assert.equal((await app({ ...request('/api/v1/sessions'), method: 'POST', json: async () => ({}) })).status, 201);
  assert.equal((await app({ ...request('/api/v1/sessions/batch'), method: 'POST', json: async () => ({}) })).status, 201);
  assert.equal((await app({ ...request('/api/v1/sessions/id'), method: 'PATCH', json: async () => ({ topic: 'test' }) })).status, 200);
  assert.equal((await app({ ...request('/api/v1/sessions/id/assignments'), method: 'PATCH', json: async () => ({ assignments: [] }) })).status, 200);
  assert.equal((await app({ ...request('/api/v1/sessions'), method: 'DELETE' })).status, 405);
});
