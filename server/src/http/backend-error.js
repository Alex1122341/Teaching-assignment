'use strict';

// Typed backend-error propagation.
//
// The ported API mappers were written against SQL: they read `error.number`,
// match it against a table of stored-procedure error codes, and answer 503 for
// anything else. That is correct for SQL, but it silently erases every typed
// error a different backend raises — a Firestore permission denial, a missing
// configuration, an unimplemented operation all became the same 503.
//
// This module is the single place that decides what a typed backend error means
// over HTTP. Mappers call `backendFailure(caught)` first and return its result
// when it is not null, so the typed meaning survives instead of being flattened.
//
// Two rules matter here:
//
//   1. A code is mapped only if it is known. An unknown error is NOT guessed at;
//      `backendFailure` returns null and the caller keeps its own fallback.
//   2. Messages are fixed strings chosen here, never `error.message`. Internal
//      exception text can carry connection strings, host names or stack detail,
//      none of which may reach a browser.

// Codes this module understands, with the HTTP meaning and a safe message.
const BACKEND_ERRORS = Object.freeze({
  // The feature exists in the product but not in this backend yet.
  BACKEND_OPERATION_UNSUPPORTED: { status: 501, message: 'This feature is not implemented for the configured backend.' },

  // The backend is not configured. Distinct from "configured but unreachable".
  FIRESTORE_NOT_CONFIGURED: { status: 503, message: 'The Firestore backend is not configured.' },
  DATABASE_NOT_CONFIGURED: { status: 503, message: 'The business database is not configured.' },
  BACKEND_CONFIG_INVALID: { status: 500, message: 'The backend configuration is invalid.' },
  SQL_CONFIG_INVALID: { status: 500, message: 'The database configuration is invalid.' },

  // The backend is configured but the operation could not complete.
  SQL_CONNECTION_CLOSED: { status: 503, message: 'The data service is unavailable.' },
  BACKEND_UNAVAILABLE: { status: 503, message: 'The data service is temporarily unavailable.' },

  // Credential/identity outcomes.
  SQL_IDENTITY_UNAVAILABLE: { status: 503, message: 'The data service is temporarily unavailable.' },
  SQL_IDENTITY_TOKEN_FAILED: { status: 503, message: 'The data service is temporarily unavailable.' },
  SQL_IDENTITY_TOKEN_MISSING: { status: 503, message: 'The data service is temporarily unavailable.' },
  SQL_IDENTITY_TOKEN_INVALID: { status: 503, message: 'The data service is temporarily unavailable.' },

  // Identity outcomes that are the caller's problem, not the service's.
  PROFILE_NOT_PROVISIONED: { status: 403, message: 'An active user profile is required.' },
  UNAUTHENTICATED: { status: 401, message: 'Sign in required.' },
  FORBIDDEN: { status: 403, message: 'You are not authorized for this action.' },

  // Concurrency.
  REVISION_CONFLICT: { status: 409, message: 'This record was changed by someone else. Reload and try again.' }
});

// Firestore Admin SDK failures arrive as gRPC status codes on `error.code`
// (numbers, not our string codes).
//
// IMPORTANT: the Admin SDK bypasses Firestore security rules, so PERMISSION_DENIED
// and UNAUTHENTICATED from it describe the *server's* credential, not the calling
// user. Reporting them as 403/401 would tell a signed-in user they lack permission
// for something that is actually a deployment fault, and would send operators
// looking at the wrong layer. They are therefore server faults (5xx). End-user
// authorization uses our own typed codes, which are unambiguous.
const GRPC_STATUS = Object.freeze({
  5: { status: 404, code: 'BACKEND_NOT_FOUND', message: 'The requested record was not found.' },
  6: { status: 409, code: 'REVISION_CONFLICT', message: 'This record was changed by someone else. Reload and try again.' },
  7: { status: 500, code: 'BACKEND_CREDENTIAL_FORBIDDEN', message: 'The service credential is not permitted to perform this operation.' },
  8: { status: 429, code: 'BACKEND_RATE_LIMITED', message: 'The data service is busy. Try again shortly.' },
  9: { status: 409, code: 'REVISION_CONFLICT', message: 'This record was changed by someone else. Reload and try again.' },
  10: { status: 503, code: 'BACKEND_UNAVAILABLE', message: 'The data service is unavailable.' },
  13: { status: 500, code: 'BACKEND_FAILURE', message: 'The data service failed unexpectedly.' },
  14: { status: 503, code: 'BACKEND_UNAVAILABLE', message: 'The data service is unavailable.' },
  16: { status: 500, code: 'BACKEND_CREDENTIAL_INVALID', message: 'The service credential was rejected.' }
});

function failure(status, code, message) {
  return { status, body: { error: { code, message } } };
}

// Returns a ready-to-send response for a recognised backend error, or null when
// the error is not one this module understands. Null means "the caller decides".
function backendFailure(caught) {
  if (!caught || typeof caught !== 'object') return null;

  const code = typeof caught.code === 'string' ? caught.code : '';

  // Firebase Auth token failures carry `auth/...` codes. They are the caller's,
  // not the server's, so they stay 401 even though the SDK produced them.
  if (code.startsWith('auth/')) {
    return failure(401, 'UNAUTHENTICATED', 'Sign in required.');
  }

  if (code && BACKEND_ERRORS[code]) {
    const mapped = BACKEND_ERRORS[code];
    return failure(mapped.status, code, mapped.message);
  }

  // gRPC-style numeric status from the Firestore Admin SDK.
  const grpc = Number(caught.code);
  if (Number.isInteger(grpc) && GRPC_STATUS[grpc]) {
    const mapped = GRPC_STATUS[grpc];
    return failure(mapped.status, mapped.code, mapped.message);
  }

  return null;
}

// True when the error means "this feature has no implementation here", which is
// the only condition that may be reported as 501.
function isUnsupported(caught) {
  return Boolean(caught && caught.code === 'BACKEND_OPERATION_UNSUPPORTED');
}

module.exports = {
  BACKEND_ERRORS,
  GRPC_STATUS,
  backendFailure,
  isUnsupported
};
