'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDataApi } = require('../src/data/data-api');
const { createSwaFunctions } = require('../src/runtime/swa-functions');
const { createRequestTiming } = require('../src/perf/request-timing');
const { createSqlConnection } = require('../src/data/sql-connection');
const { createSqlUserRepository } = require('../src/data/sql-user-repository');

const profile = { email: 'test@example.edu', displayName: 'Test User', baseRole: 'administrator', facultyId: null, active: true, mustChangePassword: false };
const request = (token) => ({ method: 'GET', url: 'https://local/api/v1/me', headers: { get: name => name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null } });

test('authenticated /me preserves JSON body and exposes approved Server-Timing', async () => {
  const api = createDataApi({
    verifyToken: async () => ({ uid: 'u' }),
    findUser: async (_uid, timing) => { timing.record('sql_connect', 0, 'warm'); timing.record('sql_user_query', 3.2); return profile; },
    listSessions: async () => []
  });
  const out = await createSwaFunctions({ api })(request('ok'));
  assert.equal(out.status, 200);
  assert.deepEqual(out.jsonBody, { profile: { email: 'test@example.edu', displayName: 'Test User', role: 'adfa_regular', facultyId: null, active: true, mustChangePassword: false } });
  assert.match(out.headers['Server-Timing'], /firebase_verify/);
  assert.match(out.headers['Server-Timing'], /sql_connect;dur=0;desc="warm"/);
  assert.match(out.headers['Server-Timing'], /sql_user_query/);
  assert.match(out.headers['Server-Timing'], /profile_validate/);
  assert.match(out.headers['Server-Timing'], /me_total/);
  assert.equal(out.headers['Access-Control-Expose-Headers'], 'Server-Timing');
});

test('anonymous and invalid token requests expose no detailed timing', async () => {
  const api = createDataApi({ verifyToken: async () => { throw Error('invalid'); }, findUser: async () => { throw Error('must not run'); }, listSessions: async () => [] });
  const app = createSwaFunctions({ api });
  for (const token of [null, 'bad']) {
    const out = await app(request(token));
    assert.equal(out.status, 401);
    assert.equal(out.headers && out.headers['Server-Timing'], undefined);
    assert.equal(out.headers && out.headers['Access-Control-Expose-Headers'], undefined);
  }
});

test('authenticated SQL connect failure remains 503 with partial timing only', async () => {
  const sql = { ConnectionPool: class { async connect() { throw Error('connect failed'); } } };
  const db = createSqlConnection({ connectionString: 'Server=x;Database=y;', sql });
  const users = createSqlUserRepository(db);
  const api = createDataApi({ verifyToken: async () => ({ uid: 'u' }), findUser: users.findByUid, listSessions: async () => [] });
  const out = await createSwaFunctions({ api })(request('ok'));
  assert.equal(out.status, 503);
  assert.match(out.headers['Server-Timing'], /firebase_verify/);
  assert.match(out.headers['Server-Timing'], /sql_connect/);
  assert.match(out.headers['Server-Timing'], /me_total/);
  assert.doesNotMatch(out.headers['Server-Timing'], /sql_user_query/);
  assert.doesNotMatch(out.headers['Server-Timing'], /uid|connect failed|Server=x|email|facultyid/i);
});


test('warm UserProfile query failure remains 503 and reports warm connect plus query timing', async () => {
  let queryCount = 0;
  const sql = { ConnectionPool: class {
    async connect() { return this; }
    request() { return { input() {}, async query() { queryCount++; if (queryCount > 1) throw Error('query failed'); return { recordset: [] }; } }; }
  } };
  const db = createSqlConnection({ connectionString: 'Server=x;Database=y;', sql });
  await db.query('SELECT 1');
  const users = createSqlUserRepository(db);
  const api = createDataApi({ verifyToken: async () => ({ uid: 'u' }), findUser: users.findByUid, listSessions: async () => [] });
  const out = await createSwaFunctions({ api })(request('ok'));
  assert.equal(out.status, 503);
  assert.match(out.headers['Server-Timing'], /sql_connect;dur=0;desc="warm"/);
  assert.match(out.headers['Server-Timing'], /sql_user_query/);
  assert.match(out.headers['Server-Timing'], /me_total/);
});

test('health and sessions routes do not receive /me Server-Timing instrumentation', async () => {
  const api = {
    health: async () => ({ status: 200, body: { status: 'ok' } }),
    currentUser: async () => ({ status: 200, body: { profile: {} } }),
    sessions: async () => ({ status: 200, body: { sessions: [] } })
  };
  const app = createSwaFunctions({ api });
  const health = await app({ ...request('ok'), url: 'https://local/api/health/sql' });
  const sessions = await app({ ...request('ok'), url: 'https://local/api/v1/sessions' });
  assert.equal(health.headers && health.headers['Server-Timing'], undefined);
  assert.equal(sessions.headers && sessions.headers['Server-Timing'], undefined);
});
test('authorization security matrix is unchanged by /me timing', async () => {
  const cases = [
    [{ active: false }, 403],
    [{ active: true, mustChangePassword: true, baseRole: 'administrator' }, 403],
    [{ active: true, mustChangePassword: false, baseRole: 'unsupported' }, 403],
    [{ active: true, mustChangePassword: false, baseRole: 'faculty', facultyId: null }, 403],
    [{ active: true, mustChangePassword: false, baseRole: 'administrator', facultyId: null, displayName: 'A' }, 200],
    [{ active: true, mustChangePassword: false, baseRole: 'faculty', facultyId: 'f1', displayName: 'F' }, 200]
  ];
  for (const [p, status] of cases) {
    const api = createDataApi({ verifyToken: async () => ({ uid: 'u' }), findUser: async (_uid, timing) => { timing.record('sql_connect', 0, 'warm'); timing.record('sql_user_query', 0.1); return p; }, listSessions: async () => [] });
    assert.equal((await createSwaFunctions({ api })(request('ok'))).status, status);
  }
});
