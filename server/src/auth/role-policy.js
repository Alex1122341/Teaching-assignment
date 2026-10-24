'use strict';

// Server-side role policy.
//
// This is the server counterpart of `web/js/core/faculty-access.js`. The two
// must agree, because the browser helper decides what to render and this module
// decides what the API will actually serve. A role that the browser understands
// but the server does not would render a control whose every request is
// rejected; a role the server understands but the browser does not would hide a
// capability the account genuinely holds.
//
// Divergence from the Beta source is deliberate and load-bearing:
//
//   `other_office` is a formal role in this repository (see AGENTS.md) and in
//   `server/src/data/sql-user-repository.js`, but it does not exist in the Beta
//   role table. Porting the Beta table verbatim would make
//   `normalizeBaseRole('other_office')` return `null`, so every `other_office`
//   account would silently lose role recognition and fall through to the
//   least-privileged branch. It is therefore added to the supported set and
//   classified as an office role, matching `faculty-access.js`, which treats
//   `other_office` alongside `adc` and `lab`.
//
//   `editor` and `viewer` are deliberately NOT mapped here, even though
//   `faculty-access.js` collapses them onto `faculty` for display. On the server
//   that collapse would grant a legacy label the full self-service scope —
//   Dashboard tabs, own-record reads — that SQL never actually issues, because
//   `sql-user-repository.js` cannot provision either role. A display alias must
//   not become an authorization grant, so unknown server-side roles fail closed.

const NORMALIZED_ROLE = Object.freeze({
  owner: 'adfa_general',
  administrator: 'adfa_regular',
  admin: 'adfa_regular'
});

const SELF_SERVICE_ROLES = new Set(['faculty', 'hicc', 'visc']);
// The raw alias spellings are listed alongside their canonical targets, matching
// the Beta export shape. Membership is only ever tested after normalisation, so
// listing them here changes no decision; it keeps the exported set honest about
// which role strings are treated as administrative.
const ADMINISTRATOR_ROLES = new Set(['developer', 'adfa_general', 'adfa_regular', 'owner', 'administrator', 'admin']);
const GENERAL_ROLES = new Set(['developer', 'adfa_general', 'owner']);
// `other_office` is an office account in this repository, not a legacy alias.
const OFFICE_ROLES = new Set(['adc', 'lab', 'other_office']);
// The alias spellings themselves must be recognised as inputs. Without this the
// lookup below would reject `owner`, `editor` and friends before it ever reached
// the normalisation table, so a legacy account would be treated as having no
// role at all instead of collapsing onto its canonical one.
const ALIAS_ROLES = new Set(Object.keys(NORMALIZED_ROLE));
const SUPPORTED_ROLES = new Set([
  ...ADMINISTRATOR_ROLES,
  ...SELF_SERVICE_ROLES,
  ...OFFICE_ROLES,
  ...ALIAS_ROLES
]);

function normalizeBaseRole(value) {
  const role = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SUPPORTED_ROLES.has(role)) return null;
  return NORMALIZED_ROLE[role] || role;
}

function isSupportedRole(value) {
  return normalizeBaseRole(value) !== null;
}

function isAdministratorRole(value) {
  const role = normalizeBaseRole(value);
  return role !== null && ADMINISTRATOR_ROLES.has(role);
}

function isGeneralRole(value) {
  const role = normalizeBaseRole(value);
  return role !== null && GENERAL_ROLES.has(role);
}

function isSelfServiceRole(value) {
  const role = normalizeBaseRole(value);
  return role !== null && SELF_SERVICE_ROLES.has(role);
}

function isOfficeRole(value) {
  const role = normalizeBaseRole(value);
  return role !== null && OFFICE_ROLES.has(role);
}

module.exports = {
  normalizeBaseRole,
  isSupportedRole,
  isAdministratorRole,
  isGeneralRole,
  isSelfServiceRole,
  isOfficeRole,
  SUPPORTED_ROLES,
  ADMINISTRATOR_ROLES,
  GENERAL_ROLES,
  SELF_SERVICE_ROLES,
  OFFICE_ROLES
};
