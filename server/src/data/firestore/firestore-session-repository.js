'use strict';

// Firestore implementation of the calendar session read path.
//
// The SQL repository answers this from `paws.vCalendarSession`; here it is
// answered from the `sessions` collection in vista-teaching-lab. The row shape is
// kept identical so the API layer and the browser cannot tell which backend is
// behind it — that is the whole point of the provider seam.
//
// Writes are NOT silently accepted. The SQL implementation delegates them to
// stored procedures that own audit, revision checks and assignment history;
// reimplementing that in Firestore is a separate, deliberate piece of work. Until
// it exists, a write throws a typed error so a caller can never be told a save
// succeeded when nothing was persisted.

const { canonicalAcademicYear } = require('../academic-year');

const WRITE_OPERATIONS = [
  'updateExisting',
  'createNew',
  'createBatch',
  'replaceAssignments'
];

function unsupported(operation) {
  return Object.assign(
    Error(`The ${operation} operation is not implemented for the Firestore backend yet.`),
    { code: 'BACKEND_OPERATION_UNSUPPORTED', status: 501, statusCode: 501, backend: 'firestore', operation }
  );
}

// A session dated 2027-01-12 belongs to academic year 2026-27: the academic year
// starts in September, so January is still the year that began the previous
// September. Kept as a pure function so it is directly testable.
function academicYearForDate(date) {
  const text = String(date || '').trim();
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const startYear = month >= 9 ? year : year - 1;
  return canonicalAcademicYear(`${startYear}-${startYear + 1}`);
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function listOf(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function displayNames(document) {
  const names = listOf(document.instructorNames).map(text).filter(Boolean);
  if (names.length) return names.join('; ');
  // The legacy shape stored a single delimited string; normalise the same way the
  // SQL view does so both backends produce identical text.
  return text(document.instructor).replace(/,/g, ' ').trim();
}

function toRow(id, document) {
  const assignments = listOf(document.assignments);
  return {
    id,
    academicYear: academicYearForDate(document.date),
    curriculumYear: Number.isFinite(Number(document.year)) ? Number(document.year) : null,
    courseCode: text(document.course),
    courseName: text(document.courseName),
    topic: text(document.topic),
    sessionType: text(document.type),
    date: text(document.date),
    startTime: text(document.start),
    endTime: text(document.end),
    room: text(document.room),
    instructorNames: displayNames(document),
    assignmentsJson: JSON.stringify(assignments),
    unresolvedAssignmentCount: 0
  };
}

function createFirestoreSessionRepository(firestore) {
  if (!firestore || typeof firestore.collection !== 'function') {
    throw Object.assign(Error('A Firestore instance is required.'), { code: 'BACKEND_CONFIG_INVALID' });
  }

  const repository = {
    async list({ start = null, end = null, facultyId = null } = {}) {
      let query = firestore.collection('sessions');
      // `date` is stored as an ISO calendar day, so a lexical range is also a
      // chronological range and Firestore can serve it from a single-field index.
      if (start) query = query.where('date', '>=', String(start));
      if (end) query = query.where('date', '<', String(end));
      if (facultyId) query = query.where('facultyIds', 'array-contains', String(facultyId));
      const snapshot = await query.orderBy('date').get();
      return snapshot.docs.map(doc => toRow(doc.id, doc.data() || {}));
    },

    async getById(sessionId) {
      const id = text(sessionId);
      if (!id) return null;
      const snapshot = await firestore.collection('sessions').doc(id).get();
      if (!snapshot.exists) return null;
      return toRow(snapshot.id, snapshot.data() || {});
    }
  };

  // Writes are present on the object so the composition is total, but every one of
  // them refuses. A missing method would surface as "undefined is not a function"
  // somewhere far from the cause.
  for (const operation of WRITE_OPERATIONS) {
    repository[operation] = () => { throw unsupported(operation); };
  }
  return repository;
}

module.exports = {
  WRITE_OPERATIONS,
  academicYearForDate,
  createFirestoreSessionRepository,
  toRow,
  unsupported
};
