'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDashboardApi } = require('../src/data/dashboard-api');
const { createDashboardFunctions } = require('../src/runtime/swa-dashboard-functions');
const { createWriteGates } = require('../src/data/write-gates');

const FACULTY_ID = '11111111-1111-4111-8111-111111111111';
const UPDATED = '2026-10-06T12:00:00.000Z';
const row = { facultyId: FACULTY_ID, displayName: 'Test Faculty', active: true, updatedAtUtc: UPDATED };
const input = () => ({
  expectedUpdatedAtUtc: UPDATED,
  expectedProfileVersion: null,
  preferredFirstName: 'Test', preferredLastName: 'Faculty', displayName: 'Test Faculty',
  ucid: 'test-1', email: 'test@example.edu', recordType: 'Faculty', stream: 'Small Animal', rank: 'Clinical',
  fte: 1, reportsToFacultyId: null,
  professionalProfile: { teachingArea: null, professionalCategory: null, serviceDate: null, priorYearsExperience: null,
    dvmEarnedDate: null, dvmType: null, mastersEarnedDate: null, mastersArea: null, phdEarnedDate: null, phdArea: null,
    boardCertifiedDate: null, boardCertification: null, boardCertificationCount: null, abvmaLicenseNumber: null, abvmaMemberType: null }
});
const request = (url, { method = 'GET', body, token = 'ok' } = {}) => ({
  method,
  url: 'https://local' + url,
  headers: { get: name => name.toLowerCase() === 'authorization' ? 'Bearer ' + token : null },
  json: async () => body
});

function harness(role = 'admin', { enabled = true, repository = {} } = {}) {
  const calls = [];
  const store = {
    faculty: async args => { calls.push(['faculty', args]); return [row]; },
    facultyById: async args => { calls.push(['facultyById', args]); return { faculty: row, linkedRecords: {} }; },
    updateFaculty: async args => { calls.push(['updateFaculty', args]); return row; },
    deactivateFaculty: async args => { calls.push(['deactivateFaculty', args]); return { ...row, active: false }; },
    restoreFaculty: async args => { calls.push(['restoreFaculty', args]); return row; },
    ...repository
  };
  const api = createDashboardApi({
    verifyToken: async () => ({ uid: 'trusted-firebase-uid', name: 'untrusted-token-name' }),
    findUser: async () => ({ active: true, mustChangePassword: false, baseRole: role, displayName: 'SQL Actor', facultyId: role === 'faculty' ? FACULTY_ID : null }),
    repository: store,
    writeRepository: store,
    writeGates: { facultyAdmin: enabled }
  });
  return { app: createDashboardFunctions({ api }), calls };
}

test('Faculty admin gate defaults off and only exact true enables it', () => {
  assert.equal(createWriteGates({}).facultyAdmin, false);
  assert.equal(createWriteGates({ PAWS_FACULTY_ADMIN_WRITE_ENABLED: 'TRUE' }).facultyAdmin, false);
  assert.equal(createWriteGates({ PAWS_FACULTY_ADMIN_WRITE_ENABLED: 'true' }).facultyAdmin, true);
});

test('write capability is admin-only and reports the gate state', async () => {
  const enabled = harness('owner');
  assert.deepEqual((await enabled.app(request('/api/v1/dashboard/faculty-admin/write-capabilities'))).jsonBody.writeCapabilities, { facultyAdmin: true });
  const disabled = harness('admin', { enabled: false });
  assert.deepEqual((await disabled.app(request('/api/v1/dashboard/faculty-admin/write-capabilities'))).jsonBody.writeCapabilities, { facultyAdmin: false });
  assert.equal((await harness('faculty').app(request('/api/v1/dashboard/faculty-admin/write-capabilities'))).status, 403);
});

test('all administrator roles, including Developer, can update Faculty through the narrow API', async () => {
  for (const role of ['developer', 'admin', 'administrator', 'adfa_regular', 'adfa_general', 'owner']) {
    const { app, calls } = harness(role);
    const response = await app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}`, {
      method: 'PATCH', body: input()
    }));
    assert.equal(response.status, 200, role);
    assert.equal(calls.find(([name]) => name === 'updateFaculty')[1].actorFirebaseUid, 'trusted-firebase-uid', role);
  }
});

test('faculty, hicc, visc, viewer and unsupported roles cannot mutate Faculty', async () => {
  for (const role of ['faculty', 'hicc', 'visc', 'viewer', 'other_office']) {
    const { app, calls } = harness(role);
    const response = await app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}`, {
      method: 'PATCH', body: input()
    }));
    assert.equal(response.status, 403, role);
    assert.equal(calls.length, 0, role);
  }
});

test('self-service detail remains active-only and does not expose admin relationship counts', async () => {
  const self = harness('faculty', { repository: { facultyById: async args => { assert.equal(args.includeInactive, false); return { faculty: row, linkedRecords: { activeUserProfileCount: 99 } }; } } });
  const response = await self.app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}`));
  assert.equal(response.status, 200);
  assert.equal('linkedRecords' in response.jsonBody, false);
});

test('write gate blocks update before the repository is called', async () => {
  const { app, calls } = harness('admin', { enabled: false });
  const response = await app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}`, {
    method: 'PATCH', body: input()
  }));
  assert.equal(response.status, 503);
  assert.equal(response.jsonBody.error.code, 'WRITE_DISABLED');
  assert.equal(calls.length, 0);
});

test('status filter is admin-only and active/inactive/all reaches repository as a bounded status', async () => {
  for (const status of ['active', 'inactive', 'all']) {
    const { app, calls } = harness('administrator');
    const response = await app(request(`/api/v1/dashboard/faculty?status=${status}`));
    assert.equal(response.status, 200, status);
    assert.equal(calls[0][1].status, status);
  }
  const self = harness('faculty');
  const denied = await self.app(request('/api/v1/dashboard/faculty?status=inactive'));
  assert.equal(denied.status, 403);
  assert.equal(self.calls.length, 0);
});

test('unsupported status and stale edits return conflict without a write', async () => {
  const invalid = harness('admin');
  assert.equal((await invalid.app(request('/api/v1/dashboard/faculty?status=deleted'))).status, 400);
  const stale = harness('admin', { repository: { updateFaculty: async () => { const error = new Error('stale'); error.code = 'FACULTY_REVISION_CONFLICT'; throw error; } } });
  const response = await stale.app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}`, {
    method: 'PATCH', body: input()
  }));
  assert.equal(response.status, 409);
  assert.equal(response.jsonBody.error.code, 'FACULTY_REVISION_CONFLICT');
});

test('Faculty edits require a valid loaded profile rowversion token', async () => {
  const { app, calls } = harness('admin');
  const bad = await app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}`, { method: 'PATCH', body: { ...input(), expectedProfileVersion: 'newer' } }));
  assert.equal(bad.status, 400);
  assert.equal(bad.jsonBody.error.code, 'FACULTY_VERSION_REQUIRED');
  assert.equal(calls.length, 0);
  const good = await app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}`, { method: 'PATCH', body: { ...input(), expectedProfileVersion: '0x0000000000000001' } }));
  assert.equal(good.status, 200);
  assert.equal(calls.find(([name]) => name === 'updateFaculty')[1].expectedProfileVersion, '0x0000000000000001');
});

test('Faculty edits reject values outside canonical record types and SQL decimal ranges', async () => {
  for (const changes of [
    { recordType: 'synthetic' },
    { fte: 10 },
    { professionalProfile: { ...input().professionalProfile, priorYearsExperience: 1000 } },
    { professionalProfile: { ...input().professionalProfile, boardCertificationCount: 1000 } }
  ]) {
    const { app, calls } = harness('admin');
    const response = await app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}`, {
      method: 'PATCH', body: { ...input(), ...changes }
    }));
    assert.equal(response.status, 400);
    assert.equal(response.jsonBody.error.code, 'INVALID_FACULTY_FIELDS');
    assert.equal(calls.length, 0);
  }
});

test('restore and deactivate preserve a stable Faculty ID through distinct actions', async () => {
  const { app, calls } = harness('adfa_regular');
  const deactivate = await app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}/deactivate`, {
    method: 'POST', body: { expectedUpdatedAtUtc: UPDATED, confirm: true }
  }));
  const restore = await app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}/restore`, {
    method: 'POST', body: { expectedUpdatedAtUtc: UPDATED }
  }));
  assert.equal(deactivate.status, 200);
  assert.equal(restore.status, 200);
  assert.equal(calls.find(([name]) => name === 'deactivateFaculty')[1].facultyId, FACULTY_ID);
  assert.equal(calls.find(([name]) => name === 'restoreFaculty')[1].facultyId, FACULTY_ID);
});

test('Faculty action endpoints reject GET and only the documented methods are accepted', async () => {
  const { app } = harness('admin');
  assert.equal((await app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}/restore`))).status, 405);
  assert.equal((await app(request(`/api/v1/dashboard/faculty/${FACULTY_ID}`, { method: 'POST', body: input() }))).status, 405);
});
