'use strict';

const { validateAuthorizedProfile } = require('../data/data-api');
const { backendFailure } = require('../http/backend-error');
const { canonicalAcademicYear } = require('../data/academic-year');
const { calgaryDate, classify } = require('./role-effective-status');
const names = require('../domain/person-name');

// Teaching Schedule HICC–CC / VISC directory (read-only).
//
// Any active, supported PAWS account may read it (the same population as the CCC Schedule), after
// Firebase token verification and the SQL UserProfile checks (active, no forced password change,
// supported role, faculty link for faculty-scoped roles). The response is built here from an
// allow-list: role type, scope label, Faculty display name, status and dates. Nothing else leaves
// the server: no DOE, identifiers, emails, notes or source fields.

const GROUP = Object.freeze({ HICC: 'hiccCc', 'Course Coordinator': 'hiccCc', VISC: 'visc' });
const ROLE_LABELS = Object.freeze({ hicc: 'HICC', 'course coordinator': 'Course Coordinator', visc: 'VISC' });
const ROLE_RANK = Object.freeze({ HICC: 0, 'Course Coordinator': 1, VISC: 2 });
const STATUS = new Set(['active', 'inactive', 'upcoming', 'dates-needed']);
const NAME_MAX = 260;
const SCOPE_MAX = 200;
const fail = (status, code, message) => ({ status, body: { error: { code, message } } });
const compare = (a, b) => String(a || '').localeCompare(String(b || ''), 'en', { numeric: true, sensitivity: 'base' });

function trimmed(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// Turns validated SQL rows into the public directory. Pure; unit-tested without SQL.
function buildDirectory(rows, { academicYear, asOfDate }) {
  const groups = { hiccCc: [], visc: [] };
  const seen = new Set();
  for (const row of rows) {
    const roleKey = typeof row?.roleType === 'string' ? row.roleType.trim().toLowerCase() : '';
    const roleType = Object.hasOwn(ROLE_LABELS, roleKey) ? ROLE_LABELS[roleKey] : '';
    const group = GROUP[roleType];
    if (!group) continue;
    const facultyName = trimmed(names.format({firstName:row.facultyFirstName,lastName:row.facultyLastName,displayName:row.facultyName}), NAME_MAX);
    if (!facultyName) continue;
    const completeScope = trimmed(row.courseCode, Infinity) || trimmed(row.recordedScope, Infinity);
    const scope = trimmed(completeScope, SCOPE_MAX);
    const decided = classify({ hasSchedule: row.hasSchedule === 1 || row.hasSchedule === true, periodsJson: row.periodsJson,
      effectiveDate: row.effectiveDate, expirationDate: row.expirationDate }, asOfDate);
    // Genuine duplicates only: same person, role, scope and the same recorded dates.
    const identity = JSON.stringify([roleType, String(completeScope || '').toLowerCase(), String(row.facultyKey || facultyName).toLowerCase(),
      row.hasSchedule ? String(row.periodsJson || '') : [row.effectiveDate || null, row.expirationDate || null]]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const entry = { roleType, scope, facultyName, status: decided.status, startDate: decided.startDate || null, endDate: decided.endDate || null };
    if (decided.nextStartDate) entry.nextStartDate = decided.nextStartDate;
    groups[group].push(entry);
  }
  // Total order: ties after the visible keys fall back to the dates, so the output never depends on SQL row order.
  const dates = (a, b) => compare(a.status, b.status) || compare(a.startDate, b.startDate) || compare(a.endDate, b.endDate) || compare(a.nextStartDate, b.nextStartDate);
  groups.hiccCc.sort((a, b) => compare(a.scope, b.scope) || ROLE_RANK[a.roleType] - ROLE_RANK[b.roleType] || compare(a.facultyName, b.facultyName) || dates(a, b));
  groups.visc.sort((a, b) => compare(a.scope, b.scope) || compare(a.facultyName, b.facultyName) || dates(a, b));
  // Entries without a recorded scope sort last within each list.
  for (const key of ['hiccCc', 'visc']) groups[key].sort((a, b) => (a.scope ? 0 : 1) - (b.scope ? 0 : 1));
  return { academicYear, asOfDate, hiccCc: groups.hiccCc, visc: groups.visc };
}

function createLeadershipDirectoryApi({ verifyToken, findUser, repository, today = () => calgaryDate() } = {}) {
  if (typeof verifyToken !== 'function' || typeof findUser !== 'function' || typeof repository?.list !== 'function') {
    throw new Error('Leadership directory dependencies required.');
  }
  return Object.freeze({
    async list(token, query = {}) {
      if (typeof token !== 'string' || !token) return fail(401, 'UNAUTHENTICATED', 'Sign in to view the HICC–CC and VISC lists.');
      let decoded;
      try { decoded = await verifyToken(token); } catch (_) { return fail(401, 'UNAUTHENTICATED', 'Sign in to view the HICC–CC and VISC lists.'); }
      if (typeof decoded?.uid !== 'string' || !decoded.uid || decoded.uid.length > 128) return fail(401, 'UNAUTHENTICATED', 'Sign in to view the HICC–CC and VISC lists.');
      let validated;
      try { validated = validateAuthorizedProfile(await findUser(decoded.uid)); } catch(caught){ return backendFailure(caught) || fail(503, 'SERVICE_UNAVAILABLE', 'Unable to validate PAWS access.'); }
      if (validated.status) return validated;
      if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => key !== 'academicYear')) {
        return fail(400, 'INVALID_QUERY', 'Select a valid academic year.');
      }
      let academicYear;
      try { academicYear = canonicalAcademicYear(query.academicYear); } catch (_) { return fail(400, 'INVALID_ACADEMIC_YEAR', 'Select a valid academic year.'); }
      const startYear = Number(academicYear.slice(0, 4));
      if (academicYear !== query.academicYear || startYear < 2020 || startYear > 2097) return fail(400, 'INVALID_ACADEMIC_YEAR', 'Use a supported YYYY-YY academic year.');
      try {
        const asOfDate = today();
        const rows = await repository.list({ academicYear });
        const body = buildDirectory(rows, { academicYear, asOfDate });
        if (![...body.hiccCc, ...body.visc].every(entry => STATUS.has(entry.status))) throw new Error('Invalid directory status.');
        return { status: 200, body };
      } catch(caught){
        return backendFailure(caught) || fail(503, 'SERVICE_UNAVAILABLE', 'The HICC–CC and VISC lists are temporarily unavailable.');
      }
    }
  });
}

module.exports = { createLeadershipDirectoryApi, buildDirectory };
