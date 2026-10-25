'use strict';

// Firestore implementation of the identity lookup.
//
// The SQL repository reads `paws.UserProfile`; here the profile is the `users`
// document keyed by Firebase Auth uid. The returned shape is identical, because
// every authorization decision downstream reads `baseRole`, `active` and
// `facultyId` from this object.
//
// Deliberate difference from the SQL path: there is no auto-provisioning. The SQL
// `provision` performs a read-then-insert so a first sign-in creates a profile.
// That is a write performed on behalf of an unauthenticated-but-verified caller,
// and it is exactly how an unknown account could acquire a role by simply signing
// in. In the lab, profiles are seeded; an unknown uid is refused.

const { unsupported } = require('./firestore-session-repository');

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toProfile(uid, document) {
  return {
    firebaseUid: uid,
    email: text(document.email),
    displayName: text(document.name || document.displayName),
    baseRole: text(document.role || document.baseRole),
    facultyId: text(document.facultyId) || null,
    active: document.active === true,
    mustChangePassword: document.mustChangePassword === true
  };
}

function createFirestoreUserRepository(firestore) {
  if (!firestore || typeof firestore.collection !== 'function') {
    throw Object.assign(Error('A Firestore instance is required.'), { code: 'BACKEND_CONFIG_INVALID' });
  }

  return {
    async findByUid(uid) {
      const id = text(uid);
      if (!id) return null;
      const snapshot = await firestore.collection('users').doc(id).get();
      if (!snapshot.exists) return null;
      return toProfile(snapshot.id, snapshot.data() || {});
    },

    // Refuses rather than creating. See the note above.
    async provision() {
      throw Object.assign(
        Error('Profiles are seeded in the Firestore lab backend; automatic provisioning is disabled.'),
        { code: 'PROFILE_NOT_PROVISIONED', status: 403, statusCode: 403, backend: 'firestore' }
      );
    }
  };
}

module.exports = { createFirestoreUserRepository, toProfile, unsupported };
