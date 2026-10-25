'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { backendFailure, isUnsupported } = require('../src/http/backend-error');

// Each backend outcome must keep its own HTTP meaning. The failure this replaces
// was a route-level heuristic that rewrote any 503 into 501 under Firestore,
// which would have reported a genuine outage as "not implemented".

const typed = code => Object.assign(Error('internal detail that must not leak'), { code });

test('an unimplemented operation is 501, and only that is', () => {
  const response = backendFailure(typed('BACKEND_OPERATION_UNSUPPORTED'));
  assert.equal(response.status, 501);
  assert.equal(response.body.error.code, 'BACKEND_OPERATION_UNSUPPORTED');
  assert.equal(isUnsupported(typed('BACKEND_OPERATION_UNSUPPORTED')), true);
  // Nothing else may be treated as unsupported.
  for (const code of ['FIRESTORE_NOT_CONFIGURED', 'DATABASE_NOT_CONFIGURED', 'SQL_CONNECTION_CLOSED']) {
    assert.equal(isUnsupported(typed(code)), false, code);
  }
});

test('an unconfigured backend is 503, never 501', () => {
  for (const code of ['FIRESTORE_NOT_CONFIGURED', 'DATABASE_NOT_CONFIGURED']) {
    const response = backendFailure(typed(code));
    assert.equal(response.status, 503, code);
    assert.equal(isUnsupported(typed(code)), false, code);
  }
});

test('Firestore connectivity failures are 503', () => {
  for (const grpc of [10, 14]) {
    const response = backendFailure(Object.assign(Error('x'), { code: grpc }));
    assert.equal(response.status, 503, String(grpc));
    assert.equal(response.body.error.code, 'BACKEND_UNAVAILABLE');
  }
});

test('an Admin SDK credential failure is a server fault, never the user\'s 403/401', () => {
  // The Admin SDK bypasses Firestore rules, so PERMISSION_DENIED (7) and
  // UNAUTHENTICATED (16) describe the service credential. Telling a signed-in user
  // "you are forbidden" would send them and the operator to the wrong layer.
  const forbidden = backendFailure(Object.assign(Error('x'), { code: 7 }));
  assert.equal(forbidden.status, 500);
  assert.equal(forbidden.body.error.code, 'BACKEND_CREDENTIAL_FORBIDDEN');

  const unauthenticated = backendFailure(Object.assign(Error('x'), { code: 16 }));
  assert.equal(unauthenticated.status, 500);
  assert.equal(unauthenticated.body.error.code, 'BACKEND_CREDENTIAL_INVALID');

  // Neither may be mistaken for "not implemented".
  assert.equal(isUnsupported(Object.assign(Error('x'), { code: 7 })), false);
  assert.equal(isUnsupported(Object.assign(Error('x'), { code: 16 })), false);
});

test('a Firebase Auth token failure is the caller\'s 401', () => {
  for (const code of ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/argument-error']) {
    const response = backendFailure(Object.assign(Error('x'), { code }));
    assert.equal(response.status, 401, code);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
  }
});

test('authentication and authorization outcomes stay distinct', () => {
  assert.equal(backendFailure(typed('UNAUTHENTICATED')).status, 401);
  assert.equal(backendFailure(typed('FORBIDDEN')).status, 403);
  assert.equal(backendFailure(typed('PROFILE_NOT_PROVISIONED')).status, 403);
});

test('a revision conflict is 409', () => {
  assert.equal(backendFailure(typed('REVISION_CONFLICT')).status, 409);
  assert.equal(backendFailure(Object.assign(Error('x'), { code: 6 })).status, 409);
  assert.equal(backendFailure(Object.assign(Error('x'), { code: 9 })).status, 409);
  // A conflict is not an unsupported feature.
  assert.equal(isUnsupported(Object.assign(Error('x'), { code: 6 })), false);
});

test('an unknown error is not guessed at', () => {
  // The caller keeps its own fallback; this module must not invent a status.
  assert.equal(backendFailure(Error('something else')), null);
  assert.equal(backendFailure(Object.assign(Error('x'), { code: 'SOMETHING_ELSE' })), null);
  assert.equal(backendFailure(Object.assign(Error('x'), { code: 99 })), null);
  assert.equal(backendFailure(null), null);
  assert.equal(backendFailure(undefined), null);
});

test('no internal detail reaches the response body', () => {
  const response = backendFailure(typed('BACKEND_OPERATION_UNSUPPORTED'));
  const serialised = JSON.stringify(response.body);
  assert.doesNotMatch(serialised, /internal detail/);
  assert.doesNotMatch(serialised, /stack/i);
  for (const code of ['FIRESTORE_NOT_CONFIGURED', 'REVISION_CONFLICT', 'PROFILE_NOT_PROVISIONED']) {
    assert.doesNotMatch(JSON.stringify(backendFailure(typed(code)).body), /internal detail/, code);
  }
});

test('SQL-mode configuration errors are 500, not 503', () => {
  // A bad configuration will not fix itself by retrying, so it must not read as a
  // transient outage.
  assert.equal(backendFailure(typed('BACKEND_CONFIG_INVALID')).status, 500);
  assert.equal(backendFailure(typed('SQL_CONFIG_INVALID')).status, 500);
});
