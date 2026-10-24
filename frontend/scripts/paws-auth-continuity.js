/* Shared authentication-continuity classification for the PAWS Beta.
 *
 * BETA-R4D-12B2A1. This module is deliberately pure: it inspects a failure and
 * reports what kind of failure it is. It never:
 *   - reads or writes credentials, Firebase ID tokens, browser storage, cookies
 *   - performs API, SQL or cloud-database access
 *   - signs a user out
 *   - retries anything
 *
 * The core rule it encodes:
 *   AUTHENTICATION SESSION != API AVAILABILITY
 *   AUTHENTICATION SESSION != APPLICATION AUTHORIZATION RESULT
 *
 * So a transient dependency failure or an authorization denial must never be
 * confused with "the Firebase login is gone".
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UCVM_AUTH_CONTINUITY = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  const KINDS = {
    TRANSIENT: 'transient',
    AUTHORIZATION_DENIED: 'authorization-denied',
    REAUTH_REQUIRED: 'reauth-required',
    PASSWORD_CHANGE_REQUIRED: 'password-change-required',
    UNEXPECTED: 'unexpected'
  };

  const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
  const TRANSIENT_CODES = new Set([
    'SQL_UNAVAILABLE',
    'HTTP_408', 'HTTP_425', 'HTTP_429', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504'
  ]);
  const DENIED_STATUS = new Set([403]);
  const DENIED_CODES = new Set([
    'ROLE_DENIED',
    'PROFILE_REQUIRED',
    'FACULTY_LINK_REQUIRED',
    'ACCOUNT_INACTIVE',
    'INACTIVE_PROFILE'
  ]);
  const REAUTH_CODES = new Set(['UNAUTHENTICATED', 'SESSION_REAUTH_REQUIRED', 'TOKEN_REFRESH_FAILED']);
  const REAUTH_STATUS = new Set([401]);
  const PASSWORD_CODES = new Set(['PASSWORD_CHANGE_REQUIRED']);

  const MESSAGES = {
    [KINDS.TRANSIENT]: 'Temporarily unavailable — your sign-in is still active.',
    [KINDS.AUTHORIZATION_DENIED]: 'Access denied for this PAWS profile. Your sign-in is still active.',
    [KINDS.REAUTH_REQUIRED]: 'Your session could not be verified. Sign out and sign in again if this continues.',
    [KINDS.PASSWORD_CHANGE_REQUIRED]: 'A password change is required for this account.',
    [KINDS.UNEXPECTED]: 'Access could not be verified. Your sign-in is still active.'
  };

  function codeOf(error) {
    return String((error && error.code) || '').trim().toUpperCase();
  }

  function statusOf(error) {
    const value = error && error.status;
    return Number.isFinite(value) ? value : null;
  }

  function isTransportFailure(error) {
    if (!(error instanceof Error)) return false;
    // A transport-level rejection (DNS/offline/connection) has no HTTP status.
    return /failed to fetch|networkerror|network request failed|load failed/i.test(error.message || '');
  }

  function classifyAuthError(error) {
    const code = codeOf(error);
    const status = statusOf(error);

    if (PASSWORD_CODES.has(code)) {
      return { kind: KINDS.PASSWORD_CHANGE_REQUIRED, code, status, recoverable: false, message: MESSAGES[KINDS.PASSWORD_CHANGE_REQUIRED] };
    }
    if (REAUTH_CODES.has(code) || REAUTH_STATUS.has(status)) {
      return { kind: KINDS.REAUTH_REQUIRED, code, status, recoverable: false, message: MESSAGES[KINDS.REAUTH_REQUIRED] };
    }
    if (DENIED_CODES.has(code) || DENIED_STATUS.has(status)) {
      return { kind: KINDS.AUTHORIZATION_DENIED, code, status, recoverable: false, message: MESSAGES[KINDS.AUTHORIZATION_DENIED] };
    }
    if (TRANSIENT_CODES.has(code) || TRANSIENT_STATUS.has(status) || isTransportFailure(error)) {
      return { kind: KINDS.TRANSIENT, code, status, recoverable: true, message: MESSAGES[KINDS.TRANSIENT] };
    }
    return { kind: KINDS.UNEXPECTED, code, status, recoverable: true, message: MESSAGES[KINDS.UNEXPECTED] };
  }

  return { classifyAuthError, kinds: KINDS, messages: MESSAGES };
});
