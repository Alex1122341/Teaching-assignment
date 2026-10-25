'use strict';

// Route-level authorization, decided before dispatch.
//
// The 501 "not implemented" gate used to run with only a token check, so a faculty
// account asking for an administrator-only operation was told "this feature is not
// built" instead of "you may not do this". Authorization must outrank
// implementation status: a caller who would be refused on a working route must be
// refused on an unbuilt one too, otherwise the gate itself becomes a way to
// discover the shape of the system.
//
// This module answers one question — may this profile call this route at all? — and
// nothing else. It does not decide what the route returns.

const { isAdministratorRole, isSelfServiceRole, isSupportedRole } = require('./role-policy');

// Capabilities a route can require.
//   any          any recognised role
//   self-or-admin an administrator, or a self-service role acting on its own scope
//   admin        an administrator only
const CAPABILITY = Object.freeze({ ANY: 'any', SELF_OR_ADMIN: 'selfOrAdmin', ADMIN: 'admin' });

// Ordered: the first match wins, so narrower patterns must precede broader ones.
// Entries may carry a `methods` set. A route that reads and writes at the same
// path needs different capabilities per method: a faculty member may GET their own
// record but must never PATCH it.
const ROUTE_CAPABILITIES = Object.freeze([
  // Administrator-only writes and administrative reads.
  [/^\/api\/v1\/dashboard\/faculty\/[^/]+\/(restore|deactivate)$/, CAPABILITY.ADMIN],
  [/^\/api\/v1\/dashboard\/faculty\/[^/]+$/, CAPABILITY.SELF_OR_ADMIN, new Set(['GET', 'HEAD'])],
  [/^\/api\/v1\/dashboard\/faculty\/[^/]+$/, CAPABILITY.ADMIN],
  [/^\/api\/v1\/dashboard\/faculty-admin\//, CAPABILITY.ADMIN],
  [/^\/api\/v1\/dashboard\/afc-records(\/|$)/, CAPABILITY.ADMIN],
  // Administrative Dashboard tabs. A self-service role must be refused here even
  // when the operation is unbuilt, so the answer describes authority, not build state.
  [/^\/api\/v1\/dashboard\/(doe-overview|doe-targets)(\/|$)/, CAPABILITY.ADMIN],
  [/^\/api\/v1\/dashboard\/faculty(\/|$)/, CAPABILITY.SELF_OR_ADMIN],
  // summary, teaching-summary and roles are administrator-only in dashboard-api.js
  // (each returns 403 ROLE_DENIED for a non-administrator). This table previously
  // said self-or-admin, which let a faculty account reach the route and receive 501
  // instead of the 403 the authoritative API would have produced.
  [/^\/api\/v1\/dashboard\/(summary|teaching-summary|roles)(\/|$)/, CAPABILITY.ADMIN],
  [/^\/api\/v1\/dashboard\//, CAPABILITY.ADMIN],
  [/^\/api\/v1\/doe\//, CAPABILITY.ADMIN],
  [/^\/api\/v1\/calendar-activities(\/|$)/, CAPABILITY.ADMIN],
  [/^\/api\/v1\/calendar-activity-imports(\/|$)/, CAPABILITY.ADMIN],
  [/^\/api\/v1\/ccc-replacements(\/|$)/, CAPABILITY.ADMIN],
  [/^\/api\/v1\/scheduling-tasks(\/|$)/, CAPABILITY.ADMIN],
  [/^\/api\/v1\/afc-forms(\/|$)/, CAPABILITY.ADMIN],
  [/^\/api\/v1\/teaching-assignments(\/|$)/, CAPABILITY.SELF_OR_ADMIN],
  [/^\/api\/v1\/swaps(\/|$)/, CAPABILITY.SELF_OR_ADMIN],
  [/^\/api\/v1\/afc-requests(\/|$)/, CAPABILITY.SELF_OR_ADMIN],
  [/^\/api\/v1\/change-history(\/|$)/, CAPABILITY.SELF_OR_ADMIN],
  [/^\/api\/v1\/faculty\/[^/]+\/availability\/?$/, CAPABILITY.SELF_OR_ADMIN],
  [/^\/api\/v1\/ccc-schedule\/?$/, CAPABILITY.ANY],
  [/^\/api\/v1\/leadership-directory\/?$/, CAPABILITY.ANY]
]);

function capabilityFor(pathname, method = 'GET') {
  const verb = String(method || 'GET').toUpperCase();
  for (const [pattern, capability, methods] of ROUTE_CAPABILITIES) {
    if (!pattern.test(pathname)) continue;
    // An entry restricted to certain methods only matches those methods; another
    // entry for the same path then decides the rest.
    if (methods && !methods.has(verb)) continue;
    return capability;
  }
  return null;
}

function allows(capability, role) {
  if (!isSupportedRole(role)) return false;
  if (capability === CAPABILITY.ADMIN) return isAdministratorRole(role);
  if (capability === CAPABILITY.SELF_OR_ADMIN) return isAdministratorRole(role) || isSelfServiceRole(role);
  return true;
}

function denial(status, code, message) {
  return { status, jsonBody: { error: { code, message } } };
}

// Returns null when the profile may proceed, or a ready-to-send refusal.
// The checks and their order mirror `resolveScope` in dashboard-api, so the gate
// and the working routes cannot drift apart.
function authorizeRoute({ profile, pathname, method = 'GET' }) {
  if (!profile || profile.active !== true) {
    return denial(403, 'PROFILE_REQUIRED', 'An active user profile is required.');
  }
  if (profile.mustChangePassword === true) {
    return denial(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change is required before using this feature.');
  }

  const role = String(profile.baseRole || '').trim();
  if (!isSupportedRole(role)) {
    return denial(403, 'ROLE_DENIED', 'This role cannot use this feature.');
  }

  const capability = capabilityFor(pathname, method);
  if (!capability) return null;
  if (!allows(capability, role)) {
    return denial(403, 'ROLE_DENIED', 'This role cannot use this feature.');
  }

  // A self-service role acting on its own scope needs a faculty link to have a
  // scope at all. Without one there is nothing to scope to, which is a refusal
  // rather than an empty result.
  if (capability !== CAPABILITY.ADMIN && isSelfServiceRole(role)) {
    if (!String(profile.facultyId || '').trim()) {
      return denial(403, 'FACULTY_LINK_REQUIRED', 'This account is not linked to a Faculty record.');
    }
  }
  return null;
}

module.exports = { CAPABILITY, ROUTE_CAPABILITIES, allows, authorizeRoute, capabilityFor };
