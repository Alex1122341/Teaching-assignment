'use strict';

// One explicitly selected Firebase App for both Auth and Firestore.
//
// These used to diverge: the verifier lazily created a named app ('paws-beta-sql')
// while the runtime called `admin.firestore()` with no argument, which resolves to
// the *default* app. If nothing had initialised a default app, Firestore used
// ambient credentials and could bind to a different project than the one being
// verified — the token would be checked against one project while the data came
// from another. Both now receive the same app object.

const APP_NAME = 'paws-lab';

function ensureFirebaseApp({ admin, projectId, serviceAccountJson, appName = APP_NAME } = {}) {
  const id = String(projectId || '').trim();
  if (!id) throw Error('FIREBASE_PROJECT_ID is required');

  // Reuse an app already created under this name so repeated composition does not
  // throw "app already exists".
  try {
    const existing = admin.app(appName);
    if (existing) return existing;
  } catch {
    // Not created yet — fall through and create it.
  }

  const options = { projectId: id };
  if (serviceAccountJson) options.credential = admin.credential.cert(JSON.parse(serviceAccountJson));
  return admin.initializeApp(options, appName);
}

function createFirebaseVerifier({ admin, projectId, serviceAccountJson, app = null, appName = APP_NAME } = {}) {
  let resolved = app;
  const getApp = () => {
    if (resolved) return resolved;
    resolved = ensureFirebaseApp({ admin, projectId, serviceAccountJson, appName });
    return resolved;
  };
  // `true` makes the SDK check revocation, which is the behaviour the ported
  // authentication path already relied on.
  return token => admin.auth(getApp()).verifyIdToken(token, true);
}

// Returns null rather than throwing when the SDK has no Firestore support, so the
// caller can report FIRESTORE_NOT_CONFIGURED instead of crashing at composition.
function createFirebaseFirestore({ admin, projectId, serviceAccountJson, app = null, appName = APP_NAME } = {}) {
  if (!admin || typeof admin.firestore !== 'function') return null;
  const resolved = app || ensureFirebaseApp({ admin, projectId, serviceAccountJson, appName });
  return admin.firestore(resolved);
}

// The project an app is actually bound to. Used by health so a mismatch between
// configuration and the live client is detected instead of assumed away.
function appProjectId(app) {
  const options = app && app.options;
  return options && typeof options.projectId === 'string' ? options.projectId : '';
}

module.exports = { APP_NAME, appProjectId, createFirebaseFirestore, createFirebaseVerifier, ensureFirebaseApp };
