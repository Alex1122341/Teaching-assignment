'use strict';

// Firestore implementation of the HICC-CC / VISC leadership directory.
//
// Contract source: `server/src/roles/leadership-directory-api.js`. Its
// `buildDirectory()` lowercases `roleType` and looks it up in
// ROLE_LABELS = { hicc, 'course coordinator', visc }, so the rows produced here
// must use exactly that vocabulary. Anything else is silently dropped by the
// builder, which is the correct behaviour for an unverified legacy label: it must
// not appear in a published directory.
//
// The builder also derives status itself from `hasSchedule` / `periodsJson` /
// `effectiveDate` / `expirationDate`, using the same inclusive Calgary classifier.
// This repository therefore hands over raw periods and does not pre-classify —
// two classifiers would eventually disagree.

const { COLLECTION } = require('./firestore-role-assignment-repository');

// The only labels the directory recognises. A role type outside this set is not
// promoted: the builder drops it, and this list documents why.
const DIRECTORY_ROLE_TYPES = new Set(['hicc', 'course coordinator', 'visc']);

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toPeriods(document) {
  if (!Array.isArray(document.periods)) return null;
  return document.periods.map(period => ({
    startDate: text(period && period.startDate) || null,
    endDate: text(period && period.endDate) || null
  }));
}

function createFirestoreLeadershipDirectoryRepository(firestore) {
  if (!firestore || typeof firestore.collection !== 'function') {
    throw Object.assign(Error('A Firestore instance is required.'), { code: 'BACKEND_CONFIG_INVALID' });
  }

  return {
    async list({ academicYear = null } = {}) {
      const snapshot = await firestore.collection(COLLECTION).get();

      // Faculty are read once and joined in memory. Reading them per assignment
      // would be one round trip per row.
      const facultyById = new Map();
      const facultySnapshot = await firestore.collection('faculty').get();
      for (const doc of facultySnapshot.docs) {
        const data = doc.data() || {};
        facultyById.set(doc.id, {
          firstName: text(data.firstName),
          lastName: text(data.lastName),
          // An unestablished employment status must not appear in a published
          // directory. Only an explicit `active: true` qualifies.
          active: data.active === true
        });
      }

      const rows = [];
      for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        if (academicYear && text(data.academicYear) !== text(academicYear)) continue;

        const roleKey = text(data.roleType).toLowerCase();
        if (!DIRECTORY_ROLE_TYPES.has(roleKey)) continue;

        const person = facultyById.get(text(data.facultyId));
        if (!person || !person.active) continue;

        const periods = toPeriods(data);
        rows.push({
          roleType: text(data.roleType),
          facultyId: text(data.facultyId),
          facultyFirstName: person.firstName,
          facultyLastName: person.lastName,
          // The builder composes the display name itself; this is only a fallback.
          facultyName: '',
          courseCode: text(data.scopeCode),
          recordedScope: text(data.scopeCode),
          hasSchedule: periods !== null,
          periodsJson: periods === null ? null : JSON.stringify(periods),
          effectiveDate: text(data.effectiveDate) || null,
          expirationDate: text(data.expirationDate) || null
        });
      }
      return rows;
    }
  };
}

module.exports = { DIRECTORY_ROLE_TYPES, createFirestoreLeadershipDirectoryRepository };
