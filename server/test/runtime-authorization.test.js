'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSwaSqlRuntime } = require('../src/runtime/swa-sql-runtime');

// Authorization must outrank implementation status. The failure this covers: the
// 501 gate checked only that a token was valid, so a faculty account asking for an
// administrator-only operation learned "this feature is not built" instead of
// "you may not do this" — and an inactive account learned the same.

const USERS = {
  'admin-1': { email: 'ada.okonkwo@example.test', name: 'Okonkwo, Ada', role: 'adfa_regular', active: true, mustChangePassword: false },
  'faculty-1': { email: 'morgan.chen@example.test', name: 'Chen, Morgan', role: 'faculty', facultyId: 'f1', active: true, mustChangePassword: false },
  'faculty-nolink': { email: 'no.link@example.test', name: 'Link, No', role: 'faculty', active: true, mustChangePassword: false },
  'inactive-1': { email: 'gone@example.test', name: 'Gone, User', role: 'adfa_regular', active: false, mustChangePassword: false },
  'rotate-1': { email: 'rotate@example.test', name: 'Rotate, User', role: 'adfa_regular', active: true, mustChangePassword: true },
  'office-1': { email: 'office@example.test', name: 'Office, Other', role: 'other_office', active: true, mustChangePassword: false }
};

function firestoreFor() {
  return {
    collection() {
      return {
        limit() { return this; },
        where() { return this; },
        orderBy() { return this; },
        async get() { return { docs: [] }; },
        doc(id) {
          const record = USERS[id];
          const snapshot = { id, exists: Boolean(record), data: () => record || {}, get: async () => snapshot };
          return snapshot;
        }
      };
    }
  };
}

function runtimeFor() {
  const admin = {
    initializeApp() { return { options: {} }; },
    app() { throw Error('none'); },
    credential: { cert() { return {}; } },
    auth() {
      return {
        // The token is the uid, which keeps the fake honest about "who is calling".
        verifyIdToken: async token => {
          if (!USERS[token]) throw Object.assign(Error('bad token'), { code: 'auth/id-token-expired' });
          return { uid: token, aud: 'vista-teaching-lab', iss: 'https://securetoken.google.com/vista-teaching-lab' };
        }
      };
    },
    firestore: () => firestoreFor()
  };
  return createSwaSqlRuntime({
    env: { PAWS_DATA_BACKEND: 'firestore', FIREBASE_PROJECT_ID: 'vista-teaching-lab' },
    admin
  });
}

function get(runtime, path, token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return runtime(new Request(`https://example.test${path}`, { headers }));
}

test('an anonymous caller cannot discover which domains exist', async () => {
  const runtime = runtimeFor();
  for (const path of ['/api/v1/dashboard/faculty', '/api/v1/doe/faculty/f1', '/api/v1/afc-forms']) {
    const response = await get(runtime, path);
    assert.equal(response.status, 401, path);
    assert.equal(response.jsonBody.error.code, 'UNAUTHENTICATED');
  }
  await runtime.close();
});

test('an invalid token is 401, not 501', async () => {
  const runtime = runtimeFor();
  const response = await get(runtime, '/api/v1/dashboard/faculty', 'not-a-user');
  assert.equal(response.status, 401);
  await runtime.close();
});

test('an account with no profile is refused before any capability is considered', async () => {
  const runtime = runtimeFor();
  const response = await get(runtime, '/api/v1/dashboard/faculty', 'ghost');
  assert.equal(response.status, 401, 'an unknown uid cannot even be verified against a profile');
  await runtime.close();
});

test('an inactive account is 403, not 501', async () => {
  const runtime = runtimeFor();
  const response = await get(runtime, '/api/v1/dashboard/faculty', 'inactive-1');
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'PROFILE_REQUIRED');
  await runtime.close();
});

test('an account that must change its password is refused', async () => {
  const runtime = runtimeFor();
  const response = await get(runtime, '/api/v1/dashboard/faculty', 'rotate-1');
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'PASSWORD_CHANGE_REQUIRED');
  await runtime.close();
});

test('an unsupported role is refused', async () => {
  const runtime = runtimeFor();
  const response = await get(runtime, '/api/v1/dashboard/faculty', 'office-1');
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'ROLE_DENIED');
  await runtime.close();
});

test('a faculty account asking for an administrator-only operation is 403, not 501', async () => {
  const runtime = runtimeFor();
  // DOE is administrator-only and unimplemented. The answer must describe the
  // caller's authority, not the build state.
  const response = await get(runtime, '/api/v1/doe/faculty/f1', 'faculty-1');
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'ROLE_DENIED');
  await runtime.close();
});

test('a faculty account asking for an administrator-only Dashboard read is 403', async () => {
  const runtime = runtimeFor();
  // dashboard-api.js marks summary, teaching-summary and roles administrator-only.
  // The capability table previously disagreed, which produced 501 instead of 403.
  for (const path of ['/api/v1/dashboard/summary', '/api/v1/dashboard/teaching-summary', '/api/v1/dashboard/roles']) {
    const response = await get(runtime, path, 'faculty-1');
    assert.equal(response.status, 403, path);
    assert.equal(response.jsonBody.error.code, 'ROLE_DENIED', path);
  }
  await runtime.close();
});

test('an administrator reaches 501 on an unbuilt administrator operation', async () => {
  const runtime = runtimeFor();
  const response = await get(runtime, '/api/v1/dashboard/summary', 'admin-1');
  assert.equal(response.status, 501);
  assert.equal(response.jsonBody.error.code, 'BACKEND_OPERATION_UNSUPPORTED');
  await runtime.close();
});

test('a faculty account asking for an administrative Dashboard tab is 403, not 501', async () => {
  const runtime = runtimeFor();
  // The explicit requirement: authority is answered before build state, even
  // though the DOE overview is also unbuilt.
  const response = await get(runtime, '/api/v1/dashboard/doe-overview', 'faculty-1');
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'ROLE_DENIED');
  await runtime.close();
});

test('the implemented Faculty list is reachable and does not answer 501', async () => {
  const runtime = runtimeFor();
  const response = await get(runtime, '/api/v1/dashboard/faculty', 'admin-1');
  assert.notEqual(response.status, 501, 'Faculty reads are implemented');
  await runtime.close();
});

test('a self-service account with no faculty link has no scope and is refused', async () => {
  const runtime = runtimeFor();
  const response = await get(runtime, '/api/v1/dashboard/faculty', 'faculty-nolink');
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'FACULTY_LINK_REQUIRED');
  await runtime.close();
});

test('an administrator reaches 501 on an unbuilt administrator operation', async () => {
  const runtime = runtimeFor();
  const response = await get(runtime, '/api/v1/doe/faculty/f1', 'admin-1');
  assert.equal(response.status, 501);
  assert.equal(response.jsonBody.error.code, 'BACKEND_OPERATION_UNSUPPORTED');
  await runtime.close();
});

test('a faculty account may read its own record but may not PATCH it', async () => {
  const runtime = runtimeFor();
  // The profile's faculty link is `f1`, so this is the record it may read.
  const read = await get(runtime, '/api/v1/dashboard/faculty/f1', 'faculty-1');
  assert.notEqual(read.status, 403, 'reading its own record is allowed');

  // A body is supplied because the route wrapper parses JSON before the API runs
  // its authorization; without one the caller would see 400 INVALID_JSON and the
  // authorization outcome would never be exercised.
  const patched = await runtime(new Request('https://example.test/api/v1/dashboard/faculty/f1', {
    method: 'PATCH',
    headers: { authorization: 'Bearer faculty-1', 'content-type': 'application/json' },
    body: JSON.stringify({ rank: 'Professor' })
  }));
  assert.equal(patched.status, 403, 'editing a Faculty record is administrator-only');
  assert.equal(patched.jsonBody.error.code, 'ROLE_DENIED');
  await runtime.close();
});

test('the roles route is administrator-only for both read and write', async () => {
  const runtime = runtimeFor();
  const read = await get(runtime, '/api/v1/dashboard/roles', 'faculty-1');
  assert.equal(read.status, 403);

  const write = await runtime(new Request('https://example.test/api/v1/dashboard/roles/ra-1/periods', {
    method: 'PUT',
    headers: { authorization: 'Bearer faculty-1', 'content-type': 'application/json' },
    body: JSON.stringify({ periods: [{ startDate: '2026-09-01', endDate: '2027-06-30' }], expectedRevision: 1 })
  }));
  assert.equal(write.status, 403);
  assert.equal(write.jsonBody.error.code, 'ROLE_DENIED');
  await runtime.close();
});

test('the roles route is reachable for an administrator instead of answering 501', async () => {
  const runtime = runtimeFor();
  const response = await get(runtime, '/api/v1/dashboard/roles', 'admin-1');
  assert.notEqual(response.status, 501, 'role reads are implemented');
  await runtime.close();
});
