'use strict';

const { SUPPORTED_ROLES, ADMINISTRATOR_ROLES, SELF_SERVICE_ROLES, normalizeBaseRole } = require('../auth/role-policy');

// Only roles that represent a canonical Faculty person are Faculty-scoped.
const FACULTY_SCOPED_ROLES = SELF_SERVICE_ROLES;
const SESSION_EDIT_ROLES = ADMINISTRATOR_ROLES;
const SESSION_TYPES = new Set(['LEC', 'LAB', 'SRL', 'Quiz/Midterm', 'OSCE', 'Exam']);
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_EDIT_FIELDS = new Set(['date', 'startTime', 'endTime', 'courseCode', 'sessionType', 'topic', 'room']);
const SESSION_CREATE_FIELDS = new Set(['academicYear', 'curriculumYear', 'courseCode', 'sessionType', 'date', 'startTime', 'endTime', 'topic', 'room', 'assignments']);
const SESSION_ASSIGNMENT_FIELDS = new Set(['facultyId', 'teachingRole']);
const SESSION_CREATE_TYPES = new Set(['LEC', 'LAB', 'SRL', 'Quiz/Midterm', 'OSCE', 'Exam']);
const SESSION_BATCH_MAX_ROWS = 200;
const SESSION_CREATE_SQL_ERRORS = new Map([
  [51250, { status: 400, code: 'INVALID_SESSION_VALUES' }],
  [51251, { status: 400, code: 'COURSE_NOT_FOUND' }],
  [51252, { status: 400, code: 'SESSION_DATE_OUTSIDE_ACADEMIC_YEAR' }],
  [51253, { status: 409, code: 'DUPLICATE_SESSION_CONFLICT' }],
  [51254, { status: 400, code: 'SESSION_FACULTY_INVALID' }],
  [51255, { status: 409, code: 'DUPLICATE_REQUEST_CONFLICT' }]
]);
const SESSION_ASSIGNMENT_SQL_ERRORS = new Map([
  [51260, { status: 404, code: 'SESSION_NOT_FOUND' }],
  [51261, { status: 400, code: 'SESSION_FACULTY_INVALID' }],
  [51262, { status: 409, code: 'ASSIGNMENT_HAS_RECORDED_DATA' }],
  [51263, { status: 409, code: 'ASSIGNMENT_HAS_RECORDED_DOE' }]
]);
const { writeDisabled } = require('./write-gates');

const result = (status, body) => ({ status, body });
const text = value => (value === null || value === undefined ? '' : String(value).trim());
const SESSION_EDIT_SQL_ERRORS = new Map([
  [51242, { status: 400, code: 'INVALID_SESSION_VALUES', message: 'The session values are invalid.' }],
  [51243, { status: 400, code: 'COURSE_NOT_FOUND', message: 'The course code was not found.' }],
  [51244, { status: 409, code: 'SESSION_ACADEMIC_YEAR_INVALID', message: 'The session academic year is invalid.' }],
  [51245, { status: 400, code: 'SESSION_DATE_OUTSIDE_ACADEMIC_YEAR', message: 'The date does not match the session academic year.' }],
  [51246, { status: 409, code: 'DUPLICATE_SESSION_CONFLICT', message: 'The edit conflicts with an existing session.' }]
]);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
  !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

function validateSessionEdit(sessionId, patch) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return 'INVALID_SESSION_ID';
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'INVALID_SESSION_PATCH';
  const keys = Object.keys(patch);
  if (!keys.length || keys.some(key => !SESSION_EDIT_FIELDS.has(key))) return 'UNSUPPORTED_SESSION_FIELDS';
  if (Object.prototype.hasOwnProperty.call(patch, 'date') && !validDate(patch.date)) return 'INVALID_SESSION_DATE';
  const hasStart = Object.prototype.hasOwnProperty.call(patch, 'startTime');
  const hasEnd = Object.prototype.hasOwnProperty.call(patch, 'endTime');
  if (hasStart !== hasEnd) return 'INVALID_SESSION_INTERVAL';
  if (hasStart) {
    const { startTime: start, endTime: end } = patch;
    if (start === null || end === null) {
      if (start !== null || end !== null) return 'INVALID_SESSION_INTERVAL';
    } else if (typeof start !== 'string' || typeof end !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(start) ||
      !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(end) || start >= end) {
      return 'INVALID_SESSION_INTERVAL';
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'courseCode') &&
      (typeof patch.courseCode !== 'string' || !patch.courseCode.trim() || patch.courseCode.trim().length > 32)) return 'INVALID_COURSE_CODE';
  if (Object.prototype.hasOwnProperty.call(patch, 'sessionType') && !SESSION_TYPES.has(patch.sessionType)) return 'INVALID_SESSION_TYPE';
  if (Object.prototype.hasOwnProperty.call(patch, 'topic') && patch.topic !== null && typeof patch.topic !== 'string') return 'INVALID_SESSION_TOPIC';
  if (Object.prototype.hasOwnProperty.call(patch, 'room') && patch.room !== null && typeof patch.room !== 'string') return 'INVALID_SESSION_ROOM';
  if (patch.topic != null && patch.topic.length > 4000) return 'INVALID_SESSION_TOPIC';
  if (patch.room != null && patch.room.length > 256) return 'INVALID_SESSION_ROOM';
  return null;
}

function academicYearMatchesDate(academicYear, date) {
  if (typeof academicYear !== 'string' || !/^(\d{4})-(\d{2})$/.test(academicYear)) return false;
  const match = /^(\d{4})-(\d{2})$/.exec(academicYear);
  const startYear = Number(match[1]);
  if (Number(match[2]) !== ((startYear + 1) % 100)) return false;
  return date >= `${match[1]}-05-01` && date < `${String(startYear + 1).padStart(4, '0')}-05-01`;
}

function validateSessionCreate(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) return 'INVALID_SESSION';
  const keys = Object.keys(session);
  if (keys.some(key => !SESSION_CREATE_FIELDS.has(key))) return 'UNSUPPORTED_SESSION_FIELDS';
  if (!academicYearMatchesDate(session.academicYear, session.date)) return 'INVALID_SESSION_ACADEMIC_YEAR';
  if (!['1', '2', '3', '4'].includes(String(session.curriculumYear))) return 'INVALID_CURRICULUM_YEAR';
  if (typeof session.courseCode !== 'string' || !session.courseCode.trim() || session.courseCode.trim().length > 32) return 'INVALID_COURSE_CODE';
  if (!SESSION_CREATE_TYPES.has(session.sessionType)) return 'INVALID_SESSION_TYPE';
  if (!validDate(session.date) || !academicYearMatchesDate(session.academicYear, session.date)) return 'INVALID_SESSION_DATE';
  if (typeof session.startTime !== 'string' || typeof session.endTime !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(session.startTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(session.endTime) || session.startTime >= session.endTime) return 'INVALID_SESSION_INTERVAL';
  if (typeof session.topic !== 'string' || !session.topic.trim() || session.topic.length > 4000) return 'INVALID_SESSION_TOPIC';
  if (session.room !== undefined && session.room !== null && (typeof session.room !== 'string' || session.room.length > 256)) return 'INVALID_SESSION_ROOM';
  if (session.assignments !== undefined && !Array.isArray(session.assignments)) return 'INVALID_SESSION_ASSIGNMENTS';
  const assignments = Array.isArray(session.assignments) ? session.assignments : [];
  if (assignments.length > 30) return 'INVALID_SESSION_ASSIGNMENTS';
  const seen = new Set();
  for (const assignment of assignments) {
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment) ||
        Object.keys(assignment).some(key => !SESSION_ASSIGNMENT_FIELDS.has(key))) return 'INVALID_SESSION_ASSIGNMENTS';
    const facultyId = text(assignment.facultyId);
    if (!SESSION_ID.test(facultyId)) return 'INVALID_SESSION_ASSIGNMENTS';
    if (seen.has(facultyId.toLowerCase())) return 'DUPLICATE_SESSION_ASSIGNMENT';
    seen.add(facultyId.toLowerCase());
    if (assignment.teachingRole !== undefined && (typeof assignment.teachingRole !== 'string' || assignment.teachingRole.trim().length > 256)) return 'INVALID_SESSION_ASSIGNMENTS';
  }
  return null;
}

function sessionDuplicateKey(session) {
  const timeKey = value => {
    const [hour, minute, second = '00'] = value.split(':');
    return `${hour.padStart(2, '0')}:${minute}:${second.padStart(2, '0')}`;
  };
  return [session.academicYear, session.courseCode.trim().toUpperCase(), session.date, timeKey(session.startTime),
    timeKey(session.endTime), session.sessionType, session.topic.trim().toLocaleLowerCase('en')].join('\u001f');
}

function validateSessionBatch(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { code: 'INVALID_SESSION_BATCH' };
  if (Object.keys(payload).some(key => !['requestId', 'sessions'].includes(key))) return { code: 'UNSUPPORTED_SESSION_FIELDS' };
  if (typeof payload.requestId !== 'string' || !SESSION_ID.test(payload.requestId.trim())) return { code: 'INVALID_REQUEST_ID' };
  if (!Array.isArray(payload.sessions) || payload.sessions.length < 1) return { code: 'SESSION_BATCH_EMPTY' };
  if (payload.sessions.length > SESSION_BATCH_MAX_ROWS) return { code: 'SESSION_BATCH_TOO_LARGE' };
  const seen = new Map();
  const errors = [];
  payload.sessions.forEach((session, index) => {
    const invalid = validateSessionCreate(session);
    if (invalid) errors.push({ row: index + 1, code: invalid });
    else {
      const key = sessionDuplicateKey(session);
      if (seen.has(key)) errors.push({ row: index + 1, code: 'DUPLICATE_SESSION_IN_BATCH', duplicateOfRow: seen.get(key) });
      else seen.set(key, index + 1);
    }
  });
  return errors.length ? { code: 'SESSION_BATCH_INVALID', errors } : { requestId: payload.requestId.trim(), sessions: payload.sessions };
}

function validateSessionAssignmentReplacement(sessionId, payload) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return 'INVALID_SESSION_ID';
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'assignments')) return 'UNSUPPORTED_SESSION_FIELDS';
  if (!Array.isArray(payload.assignments) || payload.assignments.length > 30) return 'INVALID_SESSION_ASSIGNMENTS';
  const seen = new Set();
  for (const assignment of payload.assignments) {
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment) ||
        Object.keys(assignment).some(key => !SESSION_ASSIGNMENT_FIELDS.has(key))) return 'INVALID_SESSION_ASSIGNMENTS';
    const facultyId = text(assignment.facultyId);
    if (!SESSION_ID.test(facultyId)) return 'INVALID_SESSION_ASSIGNMENTS';
    if (seen.has(facultyId.toLowerCase())) return 'DUPLICATE_SESSION_ASSIGNMENT';
    seen.add(facultyId.toLowerCase());
    if (assignment.teachingRole !== undefined && (typeof assignment.teachingRole !== 'string' || assignment.teachingRole.trim().length > 256)) return 'INVALID_SESSION_ASSIGNMENTS';
  }
  return null;
}

function validateAuthorizedProfile(profile) {
  if (!profile || profile.active !== true) {
    return result(403, { error: { code: 'PROFILE_REQUIRED', message: 'An active SQL user profile is required.' } });
  }
  if (profile.mustChangePassword === true) {
    return result(403, { error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Password change is required before timetable access.' } });
  }
  const role = normalizeBaseRole(profile.baseRole);
  if (!role) {
    return result(403, { error: { code: 'ROLE_DENIED', message: 'This role cannot read SQL timetable data.' } });
  }
  const facultyScoped = FACULTY_SCOPED_ROLES.has(role);
  const facultyId = text(profile.facultyId);
  if (facultyScoped && !facultyId) {
    return result(403, { error: { code: 'FACULTY_LINK_REQUIRED', message: 'A linked faculty profile is required.' } });
  }
  return { profile: { ...profile, baseRole: role }, role, facultyScoped, facultyId: facultyScoped ? facultyId : null };
}

function normalizedRange(range = {}) {
  const start = text(range.start);
  const end = text(range.end);
  if (!start && !end) return { start: null, end: null };
  if (!validDate(start) || !validDate(end) || start >= end) return null;
  const days = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (days > 550) return null;
  return { start, end };
}

function createDataApi({
  verifyToken,
  findUser,
  listSessions,
  updateSession = async () => null,
  createSession: insertSession = async () => null,
  createSessionBatch: insertSessionBatch = async () => [],
  replaceSessionAssignments: saveSessionAssignments = async () => null,
  recalculateSessionDoe = null,
  health = async () => true,
  writeGates = {}
}) {
  async function recalculateDoeAfterSessionWrite(sessionId, auth, trigger) {
    if (typeof recalculateSessionDoe !== 'function') return null;
    try {
      return await recalculateSessionDoe({
        sessionId,
        actor: { uid: auth.decoded.uid, name: text(auth.profile.displayName) || null },
        trigger
      });
    } catch (_) {
      return { status: 'needs_review', issueCodes: ['DOE_RECALCULATION_FAILED'] };
    }
  }

  async function authorize(token, timing) {
    let decoded;
    const verifyStarted = timing ? timing.start('firebase_verify') : null;
    try {
      decoded = await verifyToken(token);
    } catch (_) {
      return result(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
    } finally {
      if (timing) timing.end('firebase_verify', verifyStarted);
    }
    if (timing) timing.markEligible();

    let profile;
    try {
      profile = await findUser(decoded.uid, timing);
    } catch (_) {
      return result(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'The SQL read service is temporarily unavailable.' } });
    }

    let validated;
    const validationStarted = timing ? timing.start('profile_validate') : null;
    try {
      validated = validateAuthorizedProfile(profile);
    } finally {
      if (timing) timing.end('profile_validate', validationStarted);
    }
    if (validated.status) return validated;
    return { decoded, ...validated };
  }

  return {
    async health() {
      try {
        await health();
        return result(200, { status: 'ok', service: 'paws-beta-sql-runtime' });
      } catch (_) {
        return result(503, { error: { code: 'SQL_UNAVAILABLE', message: 'The SQL read service is unavailable.' } });
      }
    },

    async currentUser(token, timing) {
      const totalStarted = timing ? timing.start('me_total') : null;
      try {
        const auth = await authorize(token, timing);
        if (auth.status) return auth;
        return result(200, {
          profile: {
            email: auth.profile.email || null,
            displayName: auth.profile.displayName,
            role: auth.profile.baseRole,
            facultyId: auth.profile.facultyId || null,
            active: true,
            mustChangePassword: false
          }
        });
      } finally {
        if (timing) timing.end('me_total', totalStarted);
      }
    },

    async sessions(token, range) {
      const auth = await authorize(token);
      if (auth.status) return auth;

      const normalized = normalizedRange(range);
      if (!normalized) {
        return result(400, { error: { code: 'INVALID_RANGE', message: 'Provide both start and end dates, or neither, within the Beta academic-year window.' } });
      }

      try {
        const sessions = await listSessions({
          start: normalized.start,
          end: normalized.end,
          facultyId: auth.facultyId,
          includeAssignmentTargets: SESSION_EDIT_ROLES.has(auth.role)
        });
        return result(200, { sessions });
      } catch (_) {
        return result(503, { error: { code: 'SQL_UNAVAILABLE', message: 'The SQL read service is unavailable.' } });
      }
    }
    ,
    async updateExistingSession(token, sessionId, patch) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!SESSION_EDIT_ROLES.has(auth.role)) {
        return result(403, { error: { code: 'ROLE_DENIED', message: 'This role cannot edit canonical timetable sessions.' } });
      }
      if (writeGates.sessionEdit !== true) return writeDisabled();
      const invalid = validateSessionEdit(sessionId, patch);
      if (invalid) return result(400, { error: { code: invalid, message: 'The session edit is invalid.' } });
      try {
        const session = await updateSession({ sessionId, patch, actorFirebaseUid: auth.decoded.uid, actorName: text(auth.profile.displayName) || null });
        if (session) {
          const doe = await recalculateDoeAfterSessionWrite(sessionId, auth, 'session_edit');
          return result(200, { session, ...(doe ? { doe } : {}) });
        }
        return result(404, { error: { code: 'SESSION_NOT_FOUND', message: 'The timetable session was not found.' } });
      } catch (error) {
        const sqlNumber = Number(error?.number ?? error?.originalError?.info?.number);
        const known = SESSION_EDIT_SQL_ERRORS.get(sqlNumber);
        if (known) return result(known.status, { error: { code: known.code, message: known.message } });
        return result(503, { error: { code: 'SQL_UNAVAILABLE', message: 'The SQL write service is temporarily unavailable.' } });
      }
    },

    async createSession(token, session) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!SESSION_EDIT_ROLES.has(auth.role)) return result(403, { error: { code: 'ROLE_DENIED', message: 'This role cannot create canonical timetable sessions.' } });
      if (writeGates.sessionCreate !== true) return writeDisabled();
      const invalid = validateSessionCreate(session);
      if (invalid) return result(400, { error: { code: invalid, message: 'The session creation request is invalid.' } });
      try {
        const created = await insertSession({
          session: { ...session, courseCode: session.courseCode.trim(), topic: session.topic.trim(), room: session.room == null ? null : session.room.trim(), assignments: Array.isArray(session.assignments) ? session.assignments : [] },
          actorFirebaseUid: auth.decoded.uid,
          actorName: text(auth.profile.displayName) || null
        });
        const doe = created?.id ? await recalculateDoeAfterSessionWrite(created.id, auth, 'session_create') : null;
        return result(201, { session: created, ...(doe ? { doe } : {}) });
      } catch (failure) {
        const sqlNumber = Number(failure?.number ?? failure?.originalError?.info?.number);
        const known = SESSION_CREATE_SQL_ERRORS.get(sqlNumber);
        if (known) return result(known.status, { error: { code: known.code, message: 'The session could not be created with those values.' } });
        return result(503, { error: { code: 'SQL_UNAVAILABLE', message: 'The SQL write service is temporarily unavailable.' } });
      }
    },

    async createSessionBatch(token, payload) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!SESSION_EDIT_ROLES.has(auth.role)) return result(403, { error: { code: 'ROLE_DENIED', message: 'This role cannot create canonical timetable sessions.' } });
      if (writeGates.sessionCreate !== true) return writeDisabled();
      const validated = validateSessionBatch(payload);
      if (validated.code) {
        const conflict = validated.code === 'SESSION_BATCH_INVALID' && validated.errors.some(item => item.code === 'DUPLICATE_SESSION_IN_BATCH');
        return result(conflict ? 409 : 400, { error: { code: validated.code, message: conflict ? 'The batch contains duplicate sessions.' : 'The session batch is invalid.', details: validated.errors || undefined } });
      }
      try {
        const created = await insertSessionBatch({
          requestId: validated.requestId,
          sessions: validated.sessions.map(session => ({ ...session, courseCode: session.courseCode.trim(), topic: session.topic.trim(), room: session.room == null ? null : session.room.trim(), assignments: Array.isArray(session.assignments) ? session.assignments : [] })),
          actorFirebaseUid: auth.decoded.uid,
          actorName: text(auth.profile.displayName) || null
        });
        const idempotentReplay = created.some(row => row.idempotentReplay === true || row.idempotentReplay === 1);
        const doe = !idempotentReplay && typeof recalculateSessionDoe === 'function'
          ? await Promise.all(created.filter(row => row.id || row.sessionId).map(row => recalculateDoeAfterSessionWrite(row.id || row.sessionId, auth, 'session_create')))
          : null;
        return result(idempotentReplay ? 200 : 201, { sessions: created, idempotentReplay, ...(doe ? { doe } : {}) });
      } catch (failure) {
        const sqlNumber = Number(failure?.number ?? failure?.originalError?.info?.number);
        const known = SESSION_CREATE_SQL_ERRORS.get(sqlNumber);
        if (known) {
          const rowMatch = known.code === 'DUPLICATE_SESSION_CONFLICT' && String(failure?.message || '').match(/\brow\s+(\d+)\b/i);
          return result(known.status, { error: {
            code: known.code,
            message: 'The session batch conflicts with canonical schedule data or a prior request.',
            ...(rowMatch ? { details: [{ row: Number(rowMatch[1]), code: known.code }] } : {})
          } });
        }
        return result(503, { error: { code: 'SQL_UNAVAILABLE', message: 'The SQL write service is temporarily unavailable.' } });
      }
    },

    async replaceSessionAssignments(token, sessionId, payload) {
      const auth = await authorize(token);
      if (auth.status) return auth;
      if (!SESSION_EDIT_ROLES.has(auth.role)) return result(403, { error: { code: 'ROLE_DENIED', message: 'This role cannot edit timetable assignments.' } });
      if (writeGates.sessionEdit !== true) return writeDisabled();
      const invalid = validateSessionAssignmentReplacement(sessionId, payload);
      if (invalid) return result(400, { error: { code: invalid, message: 'The session assignment request is invalid.' } });
      try {
        const session = await saveSessionAssignments({
          sessionId,
          assignments: payload.assignments.map(row => ({ facultyId: text(row.facultyId), teachingRole: row.teachingRole == null ? null : row.teachingRole.trim() || null })),
          actorFirebaseUid: auth.decoded.uid,
          actorName: text(auth.profile.displayName) || null
        });
        if (session) {
          const doe = await recalculateDoeAfterSessionWrite(sessionId, auth, 'session_assignment_replacement');
          return result(200, { session, ...(doe ? { doe } : {}) });
        }
        return result(404, { error: { code: 'SESSION_NOT_FOUND', message: 'The timetable session was not found.' } });
      } catch (failure) {
        const sqlNumber = Number(failure?.number ?? failure?.originalError?.info?.number);
        const known = SESSION_ASSIGNMENT_SQL_ERRORS.get(sqlNumber);
        if (known) return result(known.status, { error: { code: known.code, message: 'The assignment request could not be applied.' } });
        return result(503, { error: { code: 'SQL_UNAVAILABLE', message: 'The SQL write service is temporarily unavailable.' } });
      }
    }
  };
}

module.exports = {
  createDataApi,
  validateAuthorizedProfile,
  SUPPORTED_ROLES,
  FACULTY_SCOPED_ROLES,
  normalizedRange,
  validateSessionEdit,
  validateSessionCreate,
  validateSessionBatch,
  validateSessionAssignmentReplacement,
  SESSION_EDIT_ROLES
};
