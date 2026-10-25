'use strict';

// Firestore implementation of the Faculty read path.
//
// Contract source: `server/src/data/sql-dashboard-repository.js` `faculty()`
// (line 376) and `facultyById()`. The row shape is kept identical so the API and
// the browser cannot tell which backend answered.
//
// Field mapping and the gaps behind it are recorded in
// docs/migration/PAWS_FACULTY_FIELD_MAPPING.md. Three decisions carried over:
//
//   1. A missing `active` field is treated as inactive. The live lab documents do
//      not carry `active`, and a record whose employment status was never
//      established must not appear as current staff. The count is reported so the
//      gap is visible rather than turning the roster silently empty.
//   2. `facultyId` is the Firestore document id, used verbatim. It is not a UUID
//      and is never coerced into one.
//   3. Counts (sessions, roles, AFC) are derived per faculty. They are computed
//      from the collections that own them, never stored on the faculty document,
//      so they cannot drift.

const { unsupported } = require('./firestore-session-repository');

// The SQL API validates Faculty ids as UUIDs. The lab uses document ids such as
// `fac-001`. Both are legitimate; what is not legitimate is accepting either one
// everywhere. Each backend validates against its own identifier contract.
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

function toNumber(value) {
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

// "Last Name, First Name" — the display rule the whole product uses. Applied here
// so every backend produces the same string and the browser never composes names.
function displayNameOf(document) {
  const last = text(document.lastName);
  const first = text(document.firstName);
  if (last && first) return `${last}, ${first}`;
  return last || first;
}

function toRow(id, document) {
  return {
    facultyId: id,
    preferredFirstName: text(document.firstName),
    preferredLastName: text(document.lastName),
    displayName: displayNameOf(document),
    ucid: text(document.ucid),
    email: text(document.email),
    // No source in the lab. Reported empty rather than fabricated.
    recordType: '',
    stream: '',
    rank: text(document.rank),
    fte: toNumber(document.fte),
    reportsToFacultyId: '',
    reportsToName: '',
    // See the header note: absent means not established, which fails closed.
    active: document.active === true,
    activeEstablished: document.active === true || document.active === false,
    updatedAtUtc: isoFromTimestamp(document.updatedAt),
    teachingArea: '',
    professionalCategory: '',
    // Counts are filled in by the caller, which owns the other collections.
    sessionCount: 0,
    roleCount: 0,
    afcCount: 0,
    jointAppointmentCount: 0
  };
}

function matchesSearch(row, needle) {
  if (!needle) return true;
  const haystack = [row.displayName, row.email, row.ucid, row.preferredFirstName, row.preferredLastName]
    .map(value => String(value || '').toLowerCase())
    .join(' ');
  return haystack.includes(needle.toLowerCase());
}

async function countWhere(firestore, collectionName, field, value) {
  try {
    const snapshot = await firestore.collection(collectionName).where(field, 'array-contains', value).get();
    return snapshot.docs.length;
  } catch {
    // A missing collection or index is not a reason to fail the roster; the count
    // is reported as zero and the row is still usable.
    return 0;
  }
}

function createFirestoreFacultyRepository(firestore) {
  if (!firestore || typeof firestore.collection !== 'function') {
    throw Object.assign(Error('A Firestore instance is required.'), { code: 'BACKEND_CONFIG_INVALID' });
  }

  async function loadAll() {
    const snapshot = await firestore.collection('faculty').get();
    return snapshot.docs.map(doc => toRow(doc.id, doc.data() || {}));
  }

  const repository = {
    // Mirrors the SQL signature so the Dashboard API needs no branch.
    async faculty({ search = null, limit = 200, facultyId = null, status = 'active' } = {}) {
      if (!['active', 'inactive', 'all'].includes(status)) {
        throw Object.assign(Error('Invalid Faculty status filter'), { code: 'INVALID_STATUS', status: 400 });
      }
      let rows = await loadAll();

      if (status === 'active') rows = rows.filter(row => row.active === true);
      else if (status === 'inactive') rows = rows.filter(row => row.active !== true);

      if (facultyId) {
        const wanted = text(facultyId);
        rows = rows.filter(row => row.facultyId === wanted);
      }
      if (search) rows = rows.filter(row => matchesSearch(row, text(search)));

      rows.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.facultyId.localeCompare(b.facultyId));
      const bounded = Number.isInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows;

      // Derived counts. Session links live on the session document, AFC and roles
      // live in their own collections, so the faculty document stays authoritative
      // only for the person.
      await Promise.all(bounded.map(async row => {
        row.sessionCount = await countWhere(firestore, 'sessions', 'facultyIds', row.facultyId);
        row.afcCount = await countWhere(firestore, 'afc_requests', 'facultyIds', row.facultyId);
        row.roleCount = await countWhere(firestore, 'role_assignments', 'facultyIds', row.facultyId);
      }));

      const missingActive = (await loadAll()).filter(row => row.activeEstablished !== true).length;
      // Attached non-enumerably so the array still serialises as a plain list for
      // the existing contract, while the caller can read the data-quality signal.
      Object.defineProperty(bounded, 'dataQuality', {
        value: { missingActive }, enumerable: false
      });
      return bounded;
    },

    async facultyById({ facultyId, includeInactive = false } = {}) {
      const id = text(facultyId);
      if (!id) return null;
      const snapshot = await firestore.collection('faculty').doc(id).get();
      if (!snapshot.exists) return null;
      const row = toRow(snapshot.id, snapshot.data() || {});
      if (row.active !== true && !includeInactive) return null;
      row.sessionCount = await countWhere(firestore, 'sessions', 'facultyIds', row.facultyId);
      row.afcCount = await countWhere(firestore, 'afc_requests', 'facultyIds', row.facultyId);
      row.roleCount = await countWhere(firestore, 'role_assignments', 'facultyIds', row.facultyId);
      return row;
    }
  };

  // Writes are not implemented yet. They need the identifier-format decision
  // (lab document id vs SQL UUID) settled for the API's own validation first, and
  // a revision + audit design. Refusing is honest; accepting would be a lie.
  for (const operation of ['updateFaculty', 'deactivateFaculty', 'restoreFaculty', 'updateRolePeriods']) {
    repository[operation] = () => { throw unsupported(`dashboard.${operation}`); };
  }
  return repository;
}

module.exports = {
  LAB_DOCUMENT_ID,
  UUID,
  createFirestoreFacultyRepository,
  displayNameOf,
  toRow,
  validLabFacultyId
};
