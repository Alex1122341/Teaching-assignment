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
// Divergence from the Beta source, and one correction:
//
//   `isSupportedRole` is NOT merely descriptive in the ported APIs — it is used
//   as the authorization predicate. An earlier revision of this port treated
//   `other_office` as a supported office role, on the reasoning that the role is
//   formal in `AGENTS.md` and issued by `sql-user-repository.js`, and that
//   omitting it would demote those accounts to "no role". That reasoning was
//   wrong: marking the role supported GRANTED it access to every ported API,
//   because those APIs read `isSupportedRole` as "may proceed". The Beta suites
//   caught it — `other_office` is expected to be refused by CCC Schedule and the
//   other scoped routes.
//
//   It is therefore left unsupported, matching the Beta table. An `other_office`
//   account is a real identity, but it holds no business capability here, and
//   failing closed is the safe direction. `faculty-access.js` may still label it
//   in the browser.
//
//   `editor` and `viewer` are likewise not mapped, even though
//   `faculty-access.js` collapses them onto `faculty` for display: that collapse
//   would grant a legacy label self-service scope SQL never issues, because
//   `sql-user-repository.js` cannot provision either role.

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
// `other_office` is deliberately absent: see the header note. It is a real
// identity but carries no business capability in the ported APIs.
const OFFICE_ROLES = new Set(['adc', 'lab']);
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
