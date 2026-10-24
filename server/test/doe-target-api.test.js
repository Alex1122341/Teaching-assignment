'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDashboardApi } = require('../src/data/dashboard-api');
const { createDashboardFunctions } = require('../src/runtime/swa-dashboard-functions');

const TARGET = { facultyId: '11111111-1111-1111-1111-111111111111', academicYear: '2026-27', contractTeachingDoe: null, overrideDoe: null, effectiveTargetDoe: null, active: true };
const request = (url, method = 'GET', token = 'ok') => ({ method, url: 'https://local' + url, headers: { get: name => name.toLowerCase() === 'authorization' ? 'Bearer ' + token : null } });
function build(role = 'administrator', overrides = {}) {
  const calls = [];
  const repository = { doeTargets: async args => { calls.push(args); return [TARGET]; }, ...overrides.repository };
  const api = createDashboardApi({
    verifyToken: async () => ({ uid: 'uid-1' }),
    findUser: async () => ({ active: overrides.active !== false, mustChangePassword: overrides.mustChangePassword === true, baseRole: role, facultyId: overrides.facultyId || null }),
    repository
  });
  return { app: createDashboardFunctions({ api }), calls };
}

test('administrator reads DOE targets for the canonical academic year', async () => {
  const { app, calls } = build('adfa_general');
  const response = await app(request('/api/v1/dashboard/doe-targets?academicYear=2026-2027'));
  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.academicYear, '2026-27');
  assert.deepEqual(response.jsonBody.doeTargets, [TARGET]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].academicYear, '2026-27');
});

test('self-service roles are denied before any DOE repository access', async () => {
  const { app, calls } = build('faculty', { facultyId: '11111111-1111-1111-1111-111111111111' });
  const response = await app(request('/api/v1/dashboard/doe-targets?academicYear=2026-27'));
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'ROLE_DENIED');
  assert.equal(calls.length, 0);
});

test('inactive and password-change-required profiles are denied before DOE access', async () => {
  for (const overrides of [{ active: false }, { mustChangePassword: true }]) {
    const { app, calls } = build('administrator', overrides);
    const response = await app(request('/api/v1/dashboard/doe-targets?academicYear=2026-27'));
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  }
});

test('invalid academic year is rejected before DOE repository access', async () => {
  const { app, calls } = build('administrator');
  const response = await app(request('/api/v1/dashboard/doe-targets?academicYear=2026'));
  assert.equal(response.status, 400);
  assert.equal(response.jsonBody.error.code, 'INVALID_ACADEMIC_YEAR');
  assert.equal(calls.length, 0);
});

test('DOE SQL failures become a generic 503 response', async () => {
  const { app } = build('administrator', { repository: { doeTargets: async () => { throw new Error('sensitive SQL detail'); } } });
  const response = await app(request('/api/v1/dashboard/doe-targets?academicYear=2026-27'));
  assert.equal(response.status, 503);
  assert.equal(response.jsonBody.error.code, 'SQL_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(response.jsonBody), /sensitive SQL detail/);
});

test('DOE targets allow GET only', async () => {
  const { app } = build('administrator');
  const response = await app(request('/api/v1/dashboard/doe-targets?academicYear=2026-27'));
  assert.equal(response.status, 200);
  const mutation = await app(request('/api/v1/dashboard/doe-targets', 'POST'));
  assert.equal(mutation.status, 405);
  assert.equal(mutation.headers.Allow, 'GET');
});
