'use strict';

const { randomUUID } = require('node:crypto');

// BETA-R4D-10A2 — read-only Dashboard API.
//
// Authorization model (server-side, authoritative):
//
//   administrator roles : developer, owner, administrator, adfa_general, adfa_regular, admin
//   self-service roles  : faculty, hicc, visc
//   denied              : viewer, other_office (retired), any unsupported role
//
// Endpoint contract:
//
//   GET /dashboard/summary          administrators only; self-service => 403
//   GET /dashboard/faculty          administrators: full active roster
//                                   self-service  : exactly ONE row (own FacultyId)
//   GET /dashboard/faculty/:id      administrators: any faculty
//                                   self-service  : own FacultyId only, else 403
//
// A faculty-scoped caller without a linked FacultyId is refused with
// 403 FACULTY_LINK_REQUIRED before any SQL read happens. Scope is enforced by a
// server-side predicate, never by hiding fields in the UI.

const { InvalidAcademicYearError, resolveAcademicYear } = require('./academic-year');
const { writeDisabled } = require('./write-gates');
const { ADMINISTRATOR_ROLES, SELF_SERVICE_ROLES, isAdministratorRole, normalizeBaseRole } = require('../auth/role-policy');

const ADMIN_ROLES = ADMINISTRATOR_ROLES;
const DASHBOARD_ROLES = new Set([...ADMIN_ROLES, ...SELF_SERVICE_ROLES]);
const AFC_REASON_LABELS = Object.freeze({
  university_travel: 'University Travel',
  vacation: 'Vacation',
  rsl: 'RSL',
  medical: 'Medical',
  mat: 'MAT',
  special: 'Special',
  other: 'Other'
});
const AFC_REASON_CODES = new Set(Object.keys(AFC_REASON_LABELS));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AFC_BATCH_MAX_ROWS = 20;
const FACULTY_UPDATE_FIELDS = Object.freeze({
  preferredFirstName: 128, preferredLastName: 128, displayName: 260, ucid: 64, email: 256,
  recordType: 32, stream: 128, rank: 128
});
const FACULTY_PROFILE_FIELDS = Object.freeze({
  teachingArea: 512, professionalCategory: 256, dvmEarnedDate: 64, dvmType: 256,
  mastersEarnedDate: 64, mastersArea: 4000, phdEarnedDate: 64, phdArea: 4000,
  boardCertifiedDate: 64, boardCertification: 4000, abvmaLicenseNumber: 128, abvmaMemberType: 512
});
const FACULTY_RECORD_TYPES = new Set(['faculty', 'other_pool', 'sessional_pool', 'vacancy']);

const result = (status, body) => ({ status, body });
const error = (status, code, message) => result(status, { error: { code, message } });
const text = value => (value === null || value === undefined ? '' : String(value).trim());

function roleOf(profile) {
  return normalizeBaseRole(profile && profile.baseRole) || '';
}

function isAdministrator(role) {
  return isAdministratorRole(role);
}

function isSelfService(role) {
  return SELF_SERVICE_ROLES.has(role);
}

function validUuid(value) {
  return typeof value === 'string' && UUID.test(value.trim());
}

// SQL rowversion is exactly eight bytes. Older API clients can supply either
// SQL's 0x-prefixed text, bare hexadecimal, or a JSON-serialized SQL Buffer.
// Keep the complete version: never replace an invalid token with null.
function canonicalRoleVersion(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const match = /^(?:0x)?([0-9a-f]{16})$/i.exec(value.trim());
    return match ? '0x' + match[1].toUpperCase() : undefined;
  }
  if (value && value.type === 'Buffer' && Array.isArray(value.data) &&
      value.data.length === 8 && value.data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return '0x' + value.data.map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return undefined;
}

function strictUtcVersion(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(raw) || !Number.isFinite(Date.parse(raw))) return null;
  const wholeSeconds = raw.slice(0, 19);
  if (new Date(`${wholeSeconds}.000Z`).toISOString().slice(0, 19) !== wholeSeconds) return null;
  return raw;
}

function validateFacultyUpdate(payload, facultyId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: error(400, 'INVALID_JSON', 'Faculty update JSON must be an object.') };
  const allowed = new Set(['expectedUpdatedAtUtc', 'expectedProfileVersion', 'preferredFirstName', 'preferredLastName', 'displayName', 'ucid', 'email', 'recordType', 'stream', 'rank', 'fte', 'reportsToFacultyId', 'professionalProfile']);
  if (Object.keys(payload).some(key => !allowed.has(key))) return { error: error(400, 'INVALID_FACULTY_FIELDS', 'Faculty update contains unsupported fields.') };
  const expectedUpdatedAtUtc = strictUtcVersion(payload.expectedUpdatedAtUtc);
  if (!expectedUpdatedAtUtc) {
    return { error: error(400, 'FACULTY_VERSION_REQUIRED', 'Reload Faculty before saving this record.') };
  }
  const expectedProfileVersion = payload.expectedProfileVersion === null ? null : typeof payload.expectedProfileVersion === 'string' && /^0x[0-9a-f]{16}$/i.test(payload.expectedProfileVersion) ? payload.expectedProfileVersion : undefined;
  if (expectedProfileVersion === undefined) return { error: error(400, 'FACULTY_VERSION_REQUIRED', 'Reload Faculty before saving this record.') };
  const faculty = {};
  for (const [field, max] of Object.entries(FACULTY_UPDATE_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return { error: error(400, 'INVALID_FACULTY_FIELDS', `Faculty field '${field}' is required in the save form.`) };
    const raw = payload[field];
    if (raw !== null && typeof raw !== 'string') return { error: error(400, 'INVALID_FACULTY_FIELDS', `Faculty field '${field}' must be text.`) };
    const value = raw === null ? null : raw.trim() || null;
    if (value !== null && value.length > max) return { error: error(400, 'INVALID_FACULTY_FIELDS', `Faculty field '${field}' is too long.`) };
    faculty[field] = value;
  }
  if (!faculty.displayName || !FACULTY_RECORD_TYPES.has(String(faculty.recordType || '').toLowerCase())) return { error: error(400, 'INVALID_FACULTY_FIELDS', 'Display name and a supported record type are required.') };
  if (faculty.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(faculty.email)) return { error: error(400, 'INVALID_FACULTY_FIELDS', 'Enter a valid email address.') };
  if (payload.fte !== null && (!Number.isFinite(Number(payload.fte)) || Number(payload.fte) < 0 || Number(payload.fte) > 9.9999)) {
    return { error: error(400, 'INVALID_FACULTY_FIELDS', 'FTE must be a non-negative value supported by the Faculty schema.') };
  }
  faculty.fte = payload.fte === null ? null : Number(payload.fte);
  faculty.reportsToFacultyId = payload.reportsToFacultyId === null || payload.reportsToFacultyId === '' ? null : text(payload.reportsToFacultyId);
  if (faculty.reportsToFacultyId && (!validUuid(faculty.reportsToFacultyId) || faculty.reportsToFacultyId.toLowerCase() === facultyId.toLowerCase())) {
    return { error: error(400, 'INVALID_FACULTY_FIELDS', 'Reports-To must be another valid Faculty record.') };
  }

  const sourceProfile = payload.professionalProfile;
  if (!sourceProfile || typeof sourceProfile !== 'object' || Array.isArray(sourceProfile)) return { error: error(400, 'INVALID_FACULTY_FIELDS', 'Professional profile fields are required.') };
  const allowedProfile = new Set([...Object.keys(FACULTY_PROFILE_FIELDS), 'serviceDate', 'priorYearsExperience', 'boardCertificationCount']);
  if (Object.keys(sourceProfile).some(key => !allowedProfile.has(key))) return { error: error(400, 'INVALID_FACULTY_FIELDS', 'Professional profile contains unsupported fields.') };
  const professionalProfile = {};
  for (const [field, max] of Object.entries(FACULTY_PROFILE_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(sourceProfile, field)) return { error: error(400, 'INVALID_FACULTY_FIELDS', `Professional profile field '${field}' is required in the save form.`) };
    const raw = sourceProfile[field];
    if (raw !== null && typeof raw !== 'string') return { error: error(400, 'INVALID_FACULTY_FIELDS', `Professional profile field '${field}' must be text.`) };
    const value = raw === null ? null : raw.trim() || null;
    if (value !== null && value.length > max) return { error: error(400, 'INVALID_FACULTY_FIELDS', `Professional profile field '${field}' is too long.`) };
    professionalProfile[field] = value;
  }
  for (const field of ['serviceDate']) {
    if (!Object.prototype.hasOwnProperty.call(sourceProfile, field)) return { error: error(400, 'INVALID_FACULTY_FIELDS', `Professional profile field '${field}' is required in the save form.`) };
    professionalProfile[field] = sourceProfile[field] === null || sourceProfile[field] === '' ? null : strictDate(sourceProfile[field]);
    if (sourceProfile[field] !== null && sourceProfile[field] !== '' && !professionalProfile[field]) return { error: error(400, 'INVALID_FACULTY_FIELDS', `Professional profile field '${field}' must be a valid date.`) };
  }
  for (const [field, max] of [['priorYearsExperience', 999.99], ['boardCertificationCount', 999.99]]) {
    if (!Object.prototype.hasOwnProperty.call(sourceProfile, field)) return { error: error(400, 'INVALID_FACULTY_FIELDS', `Professional profile field '${field}' is required in the save form.`) };
    const raw = sourceProfile[field];
    if (raw === null || raw === '') professionalProfile[field] = null;
    else if (!Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > max) return { error: error(400, 'INVALID_FACULTY_FIELDS', `Professional profile field '${field}' is outside the Faculty schema range.`) };
    else professionalProfile[field] = Number(raw);
  }
  return { value: { expectedUpdatedAtUtc, expectedProfileVersion, ...faculty, professionalProfile } };
}

function facultyWriteFailure(caught) {
  if ((caught && caught.code === 'FACULTY_REVISION_CONFLICT') || Number(caught && caught.number) === 52305) return error(409, 'FACULTY_REVISION_CONFLICT', 'This Faculty record changed after you opened it. Reload it before saving.');
  if ((caught && caught.code === 'FACULTY_IDENTITY_CONFLICT') || Number(caught && caught.number) === 52304) return error(409, 'FACULTY_IDENTITY_CONFLICT', 'This UCID or email already belongs to a Faculty record, possibly an inactive one. Find and restore that record instead.');
  if ([2601, 2627].includes(Number(caught && caught.number))) return error(409, 'FACULTY_IDENTITY_CONFLICT', 'This UCID or email already belongs to a Faculty record, possibly an inactive one. Find and restore that record instead.');
  if (Number(caught && caught.number) === 52303) return error(404, 'FACULTY_NOT_FOUND', 'Faculty record was not found.');
  if (Number(caught && caught.number) === 52306) return error(400, 'INVALID_FACULTY_FIELDS', 'Faculty data failed SQL validation.');
  return error(503, 'SQL_UNAVAILABLE', 'The Faculty write service is temporarily unavailable.');
}

function strictDate(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : raw;
}

function validateAfcInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return error(400, 'INVALID_JSON', 'AFC request JSON must be an object.');
  }
  const facultyId = text(payload.facultyId);
  if (!validUuid(facultyId)) return error(400, 'INVALID_FACULTY_ID', 'Faculty id is not a valid identifier.');
  const startDate = strictDate(payload.startDate);
  const endDate = strictDate(payload.endDate);
  if (!startDate || !endDate) return error(400, 'INVALID_DATE', 'AFC dates must use YYYY-MM-DD calendar dates.');
  if (endDate < startDate) return error(400, 'INVALID_DATE_RANGE', 'End date must be on or after start date.');
  const reasonCode = text(payload.reasonCode);
  if (!AFC_REASON_CODES.has(reasonCode)) return error(400, 'INVALID_REASON', 'Reason is not recognised.');
  const notes = payload.notes === null || payload.notes === undefined ? null : String(payload.notes).trim();
  if(payload.documentId!==undefined&&payload.documentId!==null&&!validUuid(payload.documentId))return error(400,'INVALID_DOCUMENT_ID','Choose a valid archived PDF.');
  if (notes && notes.length > 1000) return error(400, 'NOTES_TOO_LONG', 'Notes must be 1000 characters or fewer.');
  if ((reasonCode === 'special' || reasonCode === 'other') && !notes) {
    return error(400, 'NOTES_REQUIRED', 'Notes are required for Special and Other.');
  }
  return { facultyId, startDate, endDate, reasonCode, notes: notes || null,...(payload.documentId?{documentId:payload.documentId}:{}) };
}

function validateAfcBatchInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return error(400, 'INVALID_JSON', 'AFC batch JSON must be an object.');
  }
  const requestId = text(payload.requestId);
  if (!validUuid(requestId)) return error(400, 'INVALID_REQUEST_ID', 'AFC batch request id must be a UUID.');
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
    return error(400, 'AFC_BATCH_EMPTY', 'Add at least one AFC row.');
  }
  if (payload.rows.length > AFC_BATCH_MAX_ROWS) {
    return error(400, 'AFC_BATCH_TOO_LARGE', `AFC batches may contain at most ${AFC_BATCH_MAX_ROWS} rows.`);
  }
  const rows = [];
  const invalid = [];
  const seen = new Set();
  const duplicates = [];
  payload.rows.forEach((item, rowIndex) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
    const facultyId = text(row.facultyId);
    const startDate = strictDate(row.startDate);
    const endDate = strictDate(row.endDate);
    const purpose = typeof row.purpose === 'string' ? row.purpose : '';
    const errors = [];
    if (!validUuid(facultyId)) errors.push('FACULTY_REQUIRED');
    if (!startDate || !endDate) errors.push('INVALID_DATE');
    else if (endDate < startDate) errors.push('END_BEFORE_START');
    if (!purpose.trim()) errors.push('PURPOSE_REQUIRED');
    else if (purpose.length > 1000) errors.push('PURPOSE_TOO_LONG');
    if (errors.length) {
      invalid.push({ rowIndex, status: 'INVALID', errors });
      return;
    }
    const normalized = { rowIndex, facultyId, startDate, endDate, purpose };
    const identity = JSON.stringify([facultyId, startDate, endDate, purpose]);
    if (seen.has(identity)) duplicates.push({ rowIndex, status: 'CONFLICT', errors: ['DUPLICATE_IN_BATCH'] });
    else seen.add(identity);
    rows.push(normalized);
  });
  if (invalid.length) {
    return { status: 400, body: { error: { code: 'AFC_BATCH_INVALID', message: 'Review the row errors before submitting.' }, rows: invalid } };
  }
  if (duplicates.length) {
    return { status: 409, body: { error: { code: 'AFC_BATCH_DUPLICATE', message: 'Remove duplicate rows before submitting.' }, rows: duplicates } };
  }
  return { requestId, rows };
}

function normalizeAfcRecord(row = {}) {
  const reasonCode = text(row.reasonCode);
  return {
    afcRecordId: row.afcRecordId,
    facultyId: row.facultyId,
    facultyName: text(row.facultyName),
    startDate: text(row.startDate),
    endDate: text(row.endDate),
    reasonCode: reasonCode || null,
    purpose: row.purpose === null || row.purpose === undefined ? null : String(row.purpose),
    reason: text(row.reason) || (reasonCode ? AFC_REASON_LABELS[reasonCode] || null : null),
    notes: row.notes === null || row.notes === undefined ? null : text(row.notes),
    legacyPurpose: row.legacyPurpose === null || row.legacyPurpose === undefined ? null : text(row.legacyPurpose),
    active: row.active !== false && row.active !== 0,
    sourceKind: text(row.sourceKind) || 'manual',
    recordKey: text(row.recordKey), versionToken: text(row.versionToken),documentId:row.documentId||null
  };
}

function mapAfcWriteError(caught) {
  const number = Number(caught && caught.number);
  if(number===55001)return error(403,'ROLE_DENIED','Current administrator permission is required.');
  if(number===55003)return error(409,'DOCUMENT_BINDING_CONFLICT','The archived PDF cannot be linked to this AFC record. Review its faculty and existing record binding.');
  const known = {
    51205: ['INVALID_DATE', 'AFC dates are required.'],
    51206: ['INVALID_DATE_RANGE', 'End date must be on or after start date.'],
    51207: ['INVALID_REASON', 'Reason is not recognised.'],
    51208: ['NOTES_REQUIRED', 'Notes are required for Special and Other.'],
    51209: ['NOTES_TOO_LONG', 'Notes must be 1000 characters or fewer.'],
    51210: ['FACULTY_NOT_FOUND', 'Active Faculty record was not found.']
  }[number];
  if (known) return error(number === 51210 ? 404 : 400, known[0], known[1]);
  if (caught && caught.code === 'FACULTY_NOT_FOUND') return error(404, 'FACULTY_NOT_FOUND', 'Active Faculty record was not found.');
  return error(503, 'SQL_UNAVAILABLE', 'The SQL write service is unavailable.');
}

// Resolves the caller's Dashboard scope. Returns either a denial `result` or an
// authorization descriptor.
function resolveScope(profile) {
  if (!profile || profile.active !== true) {
    return error(403, 'PROFILE_REQUIRED', 'An active SQL user profile is required.');
  }
  if (profile.mustChangePassword === true) {
    return error(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change is required before Dashboard access.');
  }

  const role = roleOf(profile);
  if (!DASHBOARD_ROLES.has(role)) {
    return error(403, 'ROLE_DENIED', 'This role cannot read Dashboard data.');
  }

  if (isAdministrator(role)) {
    return { role, administrator: true, facultyScoped: false, facultyId: null };
  }

  const facultyId = text(profile.facultyId);
  if (!facultyId) {
    return error(403, 'FACULTY_LINK_REQUIRED', 'A linked faculty profile is required.');
  }
  return { role, administrator: false, facultyScoped: true, facultyId };
}

// Resolves the effective academic year for a request query parameter. An
// explicitly supplied malformed value is a 400; an omitted value defaults.
function resolveYear(value) {
  const raw = value === null || value === undefined ? '' : String(value).trim();
  if (!raw) return { year: resolveAcademicYear(undefined) };
  try {
    return { year: resolveAcademicYear(raw) };
  } catch (caught) {
    if (caught instanceof InvalidAcademicYearError) {
      return { error: error(400, 'INVALID_ACADEMIC_YEAR', `Academic year '${raw}' is not a recognised academic year.`) };
    }
    throw caught;
  }
}

function createDashboardApi({ verifyToken, findUser, repository, writeRepository = repository, writeGates = {} }) {
  async function authorize(token) {
    let decoded;
    try {
      decoded = await verifyToken(token);
    } catch (_) {
      return error(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    let profile;
    try {
      profile = await findUser(decoded.uid);
    } catch (_) {
      return error(503, 'SERVICE_UNAVAILABLE', 'The SQL read service is temporarily unavailable.');
    }

    const scope = resolveScope(profile);
    if (scope.status) return scope;
    return { decoded, profile, scope };
  }

  async function guarded(token, run) {
    const auth = await authorize(token);
    if (auth.status) return auth;
    try {
      return await run(auth.scope, auth.decoded, auth.profile);
    } catch (_) {
      return error(503, 'SQL_UNAVAILABLE', 'The SQL read service is unavailable.');
    }
  }

  return {
    async afcRecordWriteCapabilities(token) {
      return guarded(token, scope => {
        if (!scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot manage AFC records.');
        return result(200, { writeCapabilities: { afcSingle: writeGates.afcSingle === true, afcBatch: writeGates.afcBatch === true, afcCancel: writeGates.afcCancel === true } });
      });
    },
    async cancelAfcRecord(token, afcRecordId, payload = {}) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!auth.scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot cancel AFC records.');
      if (writeGates.afcCancel !== true) return writeDisabled();
      if (!UUID.test(text(afcRecordId))) return error(400, 'INVALID_AFC_RECORD_ID', 'A valid AFC record is required.');
      const sourceKind = text(payload?.sourceKind), expectedVersion = text(payload?.expectedVersion);
      if (!['manual', 'import'].includes(sourceKind)) return error(400, 'INVALID_AFC_SOURCE', 'Select a manual or imported AFC record.');
      if (!/^[0-9a-f]{16}$/i.test(expectedVersion)) return error(400, 'INVALID_AFC_VERSION', 'Refresh the AFC records before deleting.');
      try {
        const row = await writeRepository.cancelAfcRecord({ afcRecordId: text(afcRecordId), sourceKind, expectedVersion, actorFirebaseUid: auth.decoded.uid, actorName: auth.profile.displayName, requestId: randomUUID() });
        if (!row) return error(503, 'SQL_UNAVAILABLE', 'The SQL write service is unavailable.');
        return result(200, { afcRecord: normalizeAfcRecord(row) });
      } catch (caught) {
        const known = { 53602: [403, 'ROLE_DENIED', 'Administrator permission is required.'], 53603: [404, 'AFC_RECORD_NOT_FOUND', 'This AFC record no longer exists.'], 53604: [409, 'AFC_RECORD_CHANGED', 'This AFC record changed. Refresh and review it before deleting.'] }[Number(caught?.number)];
        return known ? error(...known) : error(503, 'SQL_UNAVAILABLE', 'The SQL write service is unavailable.');
      }
    },
    async facultyAdminWriteCapabilities(token) {
      return guarded(token, scope => {
        if (!scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot administer Faculty records.');
        return result(200, { writeCapabilities: { facultyAdmin: writeGates.facultyAdmin === true } });
      });
    },

    // GET /api/v1/dashboard/summary — administrators only.
    async summary(token, { academicYear: year } = {}) {
      const resolved = resolveYear(year);
      if (resolved.error) return resolved.error;
      return guarded(token, scope => {
        if (!scope.administrator) {
          return error(403, 'ROLE_DENIED', 'This role cannot read the Dashboard summary.');
        }
        return repository
          .summary({ academicYear: resolved.year })
          .then(summary => result(200, { summary }));
      });
    },

    // GET /api/v1/dashboard/faculty
    // Administrators receive the full active roster. A faculty-scoped caller is
    // narrowed by its own FacultyId to exactly one row rather than denied.
    async faculty(token, { academicYear: year, search, limit, status = 'active' } = {}) {
      const resolved = resolveYear(year);
      if (resolved.error) return resolved.error;
      if (!['active', 'inactive', 'all'].includes(status)) return error(400, 'INVALID_FACULTY_STATUS', 'Faculty status must be active, inactive, or all.');
      return guarded(token, scope => {
        if (!scope.administrator && status !== 'active') return error(403, 'ROLE_DENIED', 'This role can only read its own active Faculty record.');
        return repository
        .faculty({
          academicYear: resolved.year,
          search,
          limit,
          status,
          facultyId: scope.facultyScoped ? scope.facultyId : null
        })
        .then(faculty => result(200, { faculty, count: faculty.length }));
      });
    },

    // GET /api/v1/dashboard/faculty/:facultyId
    // A faculty-scoped caller may read only its own record; any other id is
    // refused with 403 rather than 404 so the response never confirms that an
    // unrelated FacultyId exists.
    async facultyById(token, facultyId, { academicYear: year } = {}) {
      const resolved = resolveYear(year);
      if (resolved.error) return resolved.error;
      return guarded(token, scope => {
        if (scope.facultyScoped && text(facultyId).toLowerCase() !== scope.facultyId.toLowerCase()) {
          return error(403, 'ROLE_DENIED', 'This role cannot read another faculty record.');
        }
        return repository
          .facultyById({ facultyId, academicYear: resolved.year, includeInactive: scope.administrator })
          .then(record => {
            if (!record) return error(404, 'FACULTY_NOT_FOUND', 'Faculty record not found.');
            if (scope.facultyScoped && record.linkedRecords) {
              const { linkedRecords, ...selfView } = record;
              return result(200, selfView);
            }
            return result(200, record);
          });
      });
    },

    async updateRolePeriods(token, roleAssignmentId, payload) {
      return guarded(token, async (scope, decoded) => {
        if (!scope.administrator) return error(403,'ROLE_DENIED','This role cannot edit appointment effective periods.');
        if (writeGates.facultyAdmin !== true) return writeDisabled();
        if (!validUuid(roleAssignmentId) || !payload || !Array.isArray(payload.periods) || payload.periods.length > 12) return error(400,'INVALID_ROLE_PERIODS','Provide up to 12 effective periods.');
        const expectedVersion = canonicalRoleVersion(payload.expectedVersion);
        if (expectedVersion === undefined) return error(400,'INVALID_ROLE_VERSION','Reload this appointment before editing.');
        const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
        const periods = payload.periods.map(p=>({startDate:p?.startDate,endDate:p?.endDate||null})).sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate)));
        if (periods.some((p,i)=>!validDate(p.startDate) || (p.endDate!==null && (!validDate(p.endDate)||p.endDate<p.startDate)) || (i>0 && (!periods[i-1].endDate || periods[i-1].endDate>=p.startDate)))) return error(400,'INVALID_ROLE_PERIODS','Enter real start dates and non-overlapping periods; end dates are inclusive.');
        try { const schedule = await writeRepository.updateRolePeriods({roleAssignmentId,expectedVersion,periods,actorFirebaseUid:decoded.uid}); return result(200,{schedule}); }
        catch(caught) { const n=caught.number||caught.originalError?.info?.number; return n===53504?error(404,'ROLE_NOT_FOUND','Appointment not found.'):n===53509?error(409,'STALE_ROLE_PERIODS','Appointment changed. Reload before editing.'):n===53503?error(403,'ROLE_DENIED','Role edit denied.'):error(503,'ROLE_PERIOD_SAVE_FAILED','Effective periods could not be saved.'); }
      });
    },

    async updateFaculty(token, facultyId, payload) {
      return guarded(token, async (scope, decoded) => {
        if (!scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot edit Faculty records.');
        if (writeGates.facultyAdmin !== true) return writeDisabled();
        if (!validUuid(facultyId)) return error(400, 'INVALID_FACULTY_ID', 'Faculty id is not a valid identifier.');
        const validated = validateFacultyUpdate(payload, facultyId);
        if (validated.error) return validated.error;
        try {
          const faculty = await writeRepository.updateFaculty({
            facultyId,
            actorFirebaseUid: text(decoded && decoded.uid),
            ...validated.value
          });
          return result(200, { faculty });
        } catch (caught) {
          return facultyWriteFailure(caught);
        }
      });
    },

    async deactivateFaculty(token, facultyId, payload) {
      return guarded(token, async (scope, decoded) => {
        if (!scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot deactivate Faculty records.');
        if (writeGates.facultyAdmin !== true) return writeDisabled();
        if (!validUuid(facultyId)) return error(400, 'INVALID_FACULTY_ID', 'Faculty id is not a valid identifier.');
        const expectedUpdatedAtUtc = strictUtcVersion(payload && payload.expectedUpdatedAtUtc);
        if (!payload || payload.confirm !== true || !expectedUpdatedAtUtc) {
          return error(400, 'FACULTY_CONFIRMATION_REQUIRED', 'Confirm deactivation and reload the Faculty version before continuing.');
        }
        try {
          const faculty = await writeRepository.deactivateFaculty({
            facultyId, actorFirebaseUid: text(decoded && decoded.uid),
            expectedUpdatedAtUtc
          });
          return result(200, { faculty });
        } catch (caught) {
          return facultyWriteFailure(caught);
        }
      });
    },

    async restoreFaculty(token, facultyId, payload) {
      return guarded(token, async (scope, decoded) => {
        if (!scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot restore Faculty records.');
        if (writeGates.facultyAdmin !== true) return writeDisabled();
        if (!validUuid(facultyId)) return error(400, 'INVALID_FACULTY_ID', 'Faculty id is not a valid identifier.');
        const expectedUpdatedAtUtc = strictUtcVersion(payload && payload.expectedUpdatedAtUtc);
        if (!payload || !expectedUpdatedAtUtc) {
          return error(400, 'FACULTY_VERSION_REQUIRED', 'Reload Faculty before restoring this record.');
        }
        try {
          const faculty = await writeRepository.restoreFaculty({
            facultyId, actorFirebaseUid: text(decoded && decoded.uid),
            expectedUpdatedAtUtc
          });
          return result(200, { faculty });
        } catch (caught) {
          return facultyWriteFailure(caught);
        }
      });
    },

    // Administrator-only read aggregates used by the restored Dashboard tabs.
    async teachingSummary(token, { academicYear: year } = {}) {
      const resolved = resolveYear(year);
      if (resolved.error) return resolved.error;
      return guarded(token, scope => {
        if (!scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot read the Dashboard teaching summary.');
        return repository.teachingSummary({ academicYear: resolved.year })
          .then(teachingSummary => result(200, { academicYear: resolved.year, teachingSummary }));
      });
    },

    async roles(token, { academicYear: year } = {}) {
      const resolved = resolveYear(year);
      if (resolved.error) return resolved.error;
      return guarded(token, scope => {
        if (!scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot read the Dashboard roles.');
        return repository.roles({ academicYear: resolved.year })
          .then(roles => result(200, { academicYear: resolved.year, roles }));
      });
    },

    async doeOverview(token, { academicYear: year } = {}) {
      const resolved = resolveYear(year);
      if (resolved.error) return resolved.error;
      return guarded(token, scope => {
        if (!scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot read the Dashboard DOE overview.');
        return repository.doeOverview({ academicYear: resolved.year })
          .then(doeOverview => result(200, { doeOverview }));
      });
    },

    // GET /api/v1/dashboard/doe-targets — administrator-only contract DOE data.
    async doeTargets(token, { academicYear: year } = {}) {
      const resolved = resolveYear(year);
      if (resolved.error) return resolved.error;
      return guarded(token, scope => {
        if (!scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot read DOE target data.');
        return repository.doeTargets({ academicYear: resolved.year })
          .then(doeTargets => result(200, {
            academicYear: resolved.year,
            doeTargets,
            count: doeTargets.length
          }));
      });
    },

    // GET /api/v1/dashboard/afc-records — administrators only. Imported and
    // manual rows are returned one-for-one from the unified SQL view.
    async afcRecords(token, { search, reason, active, limit } = {}) {
      return guarded(token, scope => {
        if (!scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot read administrator AFC records.');
        return repository.listAfcRecords({ search, reason, active, limit })
          .then(records => result(200, { afcRecords: records.map(normalizeAfcRecord), count: records.length }));
      });
    },

    // POST /api/v1/dashboard/afc-records — administrators only. Identity and
    // request IDs are deliberately generated after server-side authorization.
    async createAfcRecord(token, payload) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!auth.scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot create AFC records.');
      if (writeGates.afcSingle !== true) return writeDisabled();
      const input = validateAfcInput(payload);
      if (input.status) return input;
      if(input.documentId&&writeGates.afcFormUpload!==true)return writeDisabled();
      try {
        const row = await writeRepository.createAfcRecord({
          ...input,
          afcRecordId: randomUUID(),
          requestId: randomUUID(),
          actorFirebaseUid: auth.decoded.uid,
          actorName: auth.profile.displayName
        });
        if (!row) return error(503, 'SQL_UNAVAILABLE', 'The SQL write service is unavailable.');
        return result(201, { afcRecord: normalizeAfcRecord(row) });
      } catch (caught) {
        return mapAfcWriteError(caught);
      }
    },
    // POST /api/v1/dashboard/afc-records/batch. Validate and authorize before
    // the single stored-procedure call; identity always comes from SQL profile.
    async createAfcManualBatch(token, payload) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!auth.scope.administrator) return error(403, 'ROLE_DENIED', 'This role cannot create AFC records.');
      if (writeGates.afcBatch !== true) return writeDisabled();
      const input = validateAfcBatchInput(payload);
      if (input.status) return input;
      try {
        const batch = await writeRepository.createAfcManualBatch({
          ...input,
          actorFirebaseUid: auth.decoded.uid,
          actorName: auth.profile.displayName
        });
        if (!batch) return error(503, 'SQL_UNAVAILABLE', 'The SQL write service is unavailable.');
        const replay = batch.status === 'ALREADY_APPLIED';
        const conflict = batch.status === 'CONFLICT';
        return result(conflict ? 409 : replay ? 200 : 201, {
          requestId: input.requestId,
          idempotentReplay: replay,
          rows: batch.rows || []
        });
      } catch (_) {
        if (Number(_ && _.number) === 51517) return error(404, 'FACULTY_NOT_FOUND', 'An active Faculty record was not found.');
        return error(503, 'SQL_UNAVAILABLE', 'The SQL write service is unavailable.');
      }
    }
  };
}

module.exports = {
  createDashboardApi,
  resolveScope,
  resolveYear,
  ADMIN_ROLES,
  SELF_SERVICE_ROLES,
  DASHBOARD_ROLES,
  AFC_REASON_LABELS,
  AFC_REASON_CODES,
  validateAfcInput,
  validateAfcBatchInput,
  normalizeAfcRecord,
  strictDate
};
