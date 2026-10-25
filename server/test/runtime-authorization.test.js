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

test('a faculty account asking for its own scope reaches 501 on an unbuilt feature', async () => {
  const runtime = runtimeFor();
  const response = await get(runtime, '/api/v1/dashboard/faculty', 'faculty-1');
  assert.equal(response.status, 501);
  assert.equal(response.jsonBody.error.code, 'BACKEND_OPERATION_UNSUPPORTED');
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
