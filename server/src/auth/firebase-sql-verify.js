'use strict';

// Token verification for the ported PAWS domains.
//
// This is Beta's `auth/firebase-sql-auth.js` contract: verify the Firebase ID
// token and hand back the decoded claims. The caller then resolves the SQL
// profile through `findUser(uid)`.
//
// It lives beside `firebase-sql-auth.js` rather than replacing it because that
// module implements this repository's existing "verify and provision in one
// step" contract, which `server/src/server.js` and its tests depend on. The two
// are different shapes, not different versions of the same thing.

function createFirebaseSqlAuth({ verifyIdToken, expectedProjectId }) {
  if (typeof verifyIdToken !== 'function') throw Error('A verifyIdToken function is required.');
  if (!expectedProjectId) throw Error('FIREBASE_PROJECT_ID is required');
  return async token => {
    if (!token) throw Object.assign(Error('Authentication required'), { status: 401 });
    const decoded = await verifyIdToken(token);
    const audience = decoded.aud;
    const issuer = decoded.iss;
    if (audience !== expectedProjectId || issuer !== `https://securetoken.google.com/${expectedProjectId}`) {
      throw Object.assign(Error('Token project mismatch'), { status: 401 });
    }
    return decoded;
  };
}

module.exports = { createFirebaseSqlAuth };
