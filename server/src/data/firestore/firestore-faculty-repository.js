'use strict';

// Firestore implementation of the Faculty read path.
//
// Contract source: `server/src/data/sql-dashboard-repository.js`
//   `faculty()`      line 376 — list rows
//   `facultyById()`  line 537 — a STRUCTURED detail object, not a flat row
//
// Corrections applied after review, each recorded because each was a real
// contract error in the previous revision:
//
//   1. `facultyById()` returned a flat row. The SQL contract and the browser
//      expect `{ faculty, academicYear, professionalProfile, jointAppointments,
//      roles, afcRecords, contractDoe }`. Sections with no source are `null` and
//      named in `unavailable` — never an empty array, which would read as "this
//      person genuinely has none".
//   2. AFC and role counts used `array-contains` on a `facultyIds` field that does
//      not exist on those collections. AFC stores a singular `facultyId`.
//   3. A failed count query returned 0. A zero is a claim about the data; when the
//      query fails we have no such claim, so it is reported as unknown.
//   4. Counting was N+1 — three queries per faculty. It is now three queries in
//      total, aggregated in memory.
//   5. `active` was collapsed to a boolean, which turned "status not established"
//      into a confirmed inactive. It is now three-valued.
//   6. FTE is a fraction (SQL: `decimal(6,4)`, seed writes 1 and 0.8). Percentages
//      are not the contract.

const { unsupported } = require('./firestore-session-repository');
const { createFirestoreRoleAssignmentRepository } = require('./firestore-role-assignment-repository');

// The lab uses document ids such as `fac-001`; the SQL API uses UUIDs. Each
// backend validates against its own contract — neither is loosened to accept the
// other's format.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAB_DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;

function validLabFacultyId(value) {
  const text = String(value ?? '').trim();
  return LAB_DOCUMENT_ID.test(text) && !text.includes('..');
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// FTE is a fraction of one full-time equivalent: 1 = full time, 0.8 = four days.
// SQL stores it as `decimal(6,4)` and the seed writes `1` / `0.8`. A value like 100
// is not "100 percent", it is invalid — scaling it would multiply every workload
// figure by a hundred.
function toFte(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoFromTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (typeof value.toDate === 'function') return value.toDate().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (typeof value === 'string') return value;
  return null;
}

// "Last Name, First Name" — composed server-side so every backend produces the
// same string and the browser never assembles a name itself.
function displayNameOf(document) {
  const last = text(document.lastName);
  const first = text(document.firstName);
  if (last && first) return `${last}, ${first}`;
  return last || first;
}

// Three-valued employment status. `unknown` means the record never established
// one, which is different from a confirmed `inactive`.
function statusOf(document) {
  if (document.active === true) return 'active';
  if (document.active === false) return 'inactive';
  return 'unknown';
}

function toRow(id, document) {
  return {
    facultyId: id,
    preferredFirstName: text(document.firstName),
    preferredLastName: text(document.lastName),
    displayName: displayNameOf(document),
    storedDisplayName: text(document.displayName),
    ucid: text(document.ucid),
    email: text(document.email),
    // No source in the lab. Reported empty rather than fabricated.
    recordType: '',
    stream: '',
    rank: text(document.rank),
    fte: toFte(document.fte),
    reportsToFacultyId: '',
    reportsToName: '',
    active: document.active === true,
    status: statusOf(document),
    updatedAtUtc: isoFromTimestamp(document.updatedAt),
    teachingArea: '',
    professionalCategory: '',
    sessionCount: null,
    roleCount: null,
    afcCount: null,
    jointAppointmentCount: null
  };
}

function matchesSearch(row, needle) {
  if (!needle) return true;
  const haystack = [row.displayName, row.email, row.ucid, row.preferredFirstName, row.preferredLastName]
    .map(value => String(value || '').toLowerCase())
    .join(' ');
  return haystack.includes(needle.toLowerCase());
}

// Academic year runs 1 May – 30 April, matching the SQL session API.
function academicYearForDate(date) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(date || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = month >= 5 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// Counts are gathered with ONE query per collection and aggregated in memory,
// instead of three queries per faculty. At reference scale (about 1,900 sessions)
// that is the difference between three round trips and six thousand.
//
// A failure is reported, not converted into zero: `null` means "not known", and
// the caller surfaces it rather than telling the browser this person has none.
async function countByFaculty(firestore, collectionName, field, { equals = false, academicYear = null, dated = false } = {}) {
  try {
    const snapshot = await firestore.collection(collectionName).get();
    const counts = new Map();
    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      // Session counts are per academic year, matching the SQL contract, which
      // filters `c.AcademicYear = @academicYear`. Counting every session ever
      // recorded would overstate a current roster.
      if (dated && academicYear && academicYearForDate(data.date) !== academicYear) continue;
      const value = data[field];
      if (equals) {
        const key = text(value);
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      } else if (Array.isArray(value)) {
        for (const entry of new Set(value.map(text).filter(Boolean))) {
          counts.set(entry, (counts.get(entry) || 0) + 1);
        }
      }
    }
    return { ok: true, counts };
  } catch (error) {
    // A stable code, not the raw gRPC number: the number means nothing to a client
    // and the point is simply that the count could not be established.
    return { ok: false, error: 'COUNT_QUERY_FAILED', detail: text(error && error.code) || null, counts: new Map() };
  }
}

function createFirestoreFacultyRepository(firestore) {
  if (!firestore || typeof firestore.collection !== 'function') {
    throw Object.assign(Error('A Firestore instance is required.'), { code: 'BACKEND_CONFIG_INVALID' });
  }
  const assignments = createFirestoreRoleAssignmentRepository(firestore);

  async function loadAll() {
    const snapshot = await firestore.collection('faculty').get();
    return snapshot.docs.map(doc => toRow(doc.id, doc.data() || {}));
  }

  // Three queries total, shared by the whole page of rows.
  async function gatherCounts(academicYear = null) {
    const sessions = await countByFaculty(firestore, 'sessions', 'facultyIds', { academicYear, dated: true });
    const afc = await countByFaculty(firestore, 'afc_requests', 'facultyId', { equals: true });
    const roles = await countByFaculty(firestore, 'role_assignments', 'facultyId', { equals: true });
    const problems = {};
    if (!sessions.ok) problems.sessionCount = sessions.error;
    if (!afc.ok) problems.afcCount = afc.error;
    if (!roles.ok) problems.roleCount = roles.error;
    return { sessions, afc, roles, problems };
  }

  function applyCounts(rows, gathered) {
    for (const row of rows) {
      row.sessionCount = gathered.sessions.ok ? (gathered.sessions.counts.get(row.facultyId) || 0) : null;
      row.afcCount = gathered.afc.ok ? (gathered.afc.counts.get(row.facultyId) || 0) : null;
      row.roleCount = gathered.roles.ok ? (gathered.roles.counts.get(row.facultyId) || 0) : null;
      // No joint-appointment collection exists in the lab.
      row.jointAppointmentCount = null;
    }
  }

  const repository = {
    async faculty({ search = null, limit = 200, facultyId = null, status = 'active', academicYear = null } = {}) {
      if (!['active', 'inactive', 'unknown', 'all'].includes(status)) {
        throw Object.assign(Error('Invalid Faculty status filter'), { code: 'INVALID_STATUS', status: 400 });
      }
      const all = await loadAll();
      let rows = all;

      // An unestablished status is its own bucket. Folding it into `inactive`
      // would report a confirmed employment decision that nobody made.
      if (status === 'active') rows = rows.filter(row => row.status === 'active');
      else if (status === 'inactive') rows = rows.filter(row => row.status === 'inactive');
      else if (status === 'unknown') rows = rows.filter(row => row.status === 'unknown');

      if (facultyId) {
        const wanted = text(facultyId);
        rows = rows.filter(row => row.facultyId === wanted);
      }
      if (search) rows = rows.filter(row => matchesSearch(row, text(search)));

      rows = [...rows].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.facultyId.localeCompare(b.facultyId));
      const bounded = Number.isInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows;

      const gathered = await gatherCounts(academicYear ? text(academicYear) : null);
      applyCounts(bounded, gathered);

      return {
        rows: bounded,
        dataQuality: {
          missingActive: all.filter(row => row.status === 'unknown').length,
          total: all.length,
          academicYear: academicYear ? text(academicYear) : null,
          countFailures: gathered.problems
        }
      };
    },

    async facultyById({ facultyId, academicYear = null, includeInactive = false } = {}) {
      const id = text(facultyId);
      if (!id) return null;
      const snapshot = await firestore.collection('faculty').doc(id).get();
      if (!snapshot.exists) return null;

      const row = toRow(snapshot.id, snapshot.data() || {});
      if (row.status !== 'active' && !includeInactive) return null;

      const gathered = await gatherCounts(academicYear ? text(academicYear) : null);
      applyCounts([row], gathered);

      // Roles now come from the authoritative collection. An empty array means the
      // person genuinely has no assignments; `null` is reserved for a source that
      // could not be read at all, so the two never look alike.
      let roles = null;
      const unavailable = ['professionalProfile', 'jointAppointments', 'afcRecords', 'contractDoe'];
      try {
        roles = await assignments.listByFaculty({
          facultyId: row.facultyId,
          academicYear: academicYear ? text(academicYear) : null
        });
        roles = roles.map(role => ({ ...role,
          validityPeriods: role.periods, scheduleVersion: role.revision,
          courseOrSubjectOrRotation: role.scopeCode || '',
          facultyName: row.displayName, displayName: row.displayName }));
      } catch (error) {
        roles = null;
        unavailable.push('roles');
      }

      return {
        faculty: row,
        academicYear: academicYear ? text(academicYear) : null,
        professionalProfile: null,
        jointAppointments: null,
        roles,
        afcRecords: null,
        contractDoe: null,
        unavailable,
        dataQuality: { countFailures: gathered.problems }
      };
    }
  };

  // ---------------------------------------------------------------------
  // Faculty writes
  //
  // Concurrency is a precondition on `updatedAt`, the field that actually changes,
  // rather than an invented integer revision. The caller passes the value it read
  // as `expectedUpdatedAtUtc`; a mismatch is a 409 and nothing is written.
  //
  // Deactivation never deletes. Historical teaching assignments, roles and AFC
  // records reference the Faculty id, so the document must survive; only the
  // status changes and an audit record is appended.
  // ---------------------------------------------------------------------
  const AUDIT = 'faculty_change_log';

  function requireActor(actorFirebaseUid) {
    const actor = text(actorFirebaseUid);
    if (!actor) throw Object.assign(Error('A verified actor is required.'), { code: 'ACTOR_REQUIRED', status: 500 });
    return actor;
  }

  async function applyFacultyWrite({ facultyId, expectedUpdatedAtUtc, mutate, action, actorFirebaseUid }) {
    const id = text(facultyId);
    if (!id) throw Object.assign(Error('A faculty id is required.'), { code: 'INVALID_FACULTY_ID', status: 400 });
    const actor = requireActor(actorFirebaseUid);
    const now = new Date();

    return firestore.runTransaction(async transaction => {
      const ref = firestore.collection('faculty').doc(id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw Object.assign(Error('Faculty record not found.'), { code: 'NOT_FOUND', status: 404 });

      const before = snapshot.data() || {};
      const currentVersion = isoFromTimestamp(before.updatedAt);
      // A stale precondition is a conflict, never a silent overwrite.
      if (text(expectedUpdatedAtUtc) && currentVersion && text(expectedUpdatedAtUtc) !== currentVersion) {
        throw Object.assign(Error('This record was changed by someone else. Reload and try again.'), {
          code: 'REVISION_CONFLICT', status: 409
        });
      }

      const after = { ...before, ...mutate(before), updatedAt: now, updatedBy: actor };
      transaction.set(ref, after);
      transaction.set(firestore.collection(AUDIT).doc(), {
        facultyId: id, action, actorFirebaseUid: actor, recordedAtUtc: now, before, after
      });
      return toRow(id, after);
    });
  }

  repository.updateFaculty = async ({ facultyId, expectedUpdatedAtUtc, actorFirebaseUid, ...changes } = {}) => {
    const allowed = ['firstName', 'lastName', 'email', 'rank', 'fte', 'ucid'];
    return applyFacultyWrite({
      facultyId, expectedUpdatedAtUtc, action: 'update', actorFirebaseUid,
      mutate: before => {
        const next = {};
        for (const key of allowed) {
          if (changes[key] === undefined) continue;
          if (key === 'fte') {
            const fte = toFte(changes.fte);
            if (fte === null || fte < 0 || fte > 1) {
              throw Object.assign(Error('FTE must be a fraction between 0 and 1.'), { code: 'INVALID_FTE', status: 400 });
            }
            next.fte = fte;
            continue;
          }
          next[key] = text(changes[key]);
        }
        // A write must never silently promote an unestablished status to active.
        if (next.active === undefined && before.active === undefined) {
          // leave it unset; status stays unknown
        }
        return next;
      }
    });
  };

  repository.deactivateFaculty = async ({ facultyId, expectedUpdatedAtUtc, actorFirebaseUid } = {}) =>
    applyFacultyWrite({ facultyId, expectedUpdatedAtUtc, action: 'deactivate', actorFirebaseUid, mutate: () => ({ active: false }) });

  repository.restoreFaculty = async ({ facultyId, expectedUpdatedAtUtc, actorFirebaseUid } = {}) =>
    applyFacultyWrite({ facultyId, expectedUpdatedAtUtc, action: 'restore', actorFirebaseUid, mutate: () => ({ active: true }) });

  // Role periods are not a Faculty write; keep the refusal explicit.
  repository.updateRolePeriods = () => { throw unsupported('dashboard.updateRolePeriods'); };
  return repository;
}

module.exports = {
  LAB_DOCUMENT_ID,
  UUID,
  academicYearForDate,
  createFirestoreFacultyRepository,
  displayNameOf,
  statusOf,
  toFte,
  toRow,
  validLabFacultyId
};
