'use strict';

// Backend selection for the PAWS data layer.
//
//   PAWS_DATA_BACKEND=sql        (default) the ported Azure SQL repositories
//   PAWS_DATA_BACKEND=firestore  the Firestore lab backend
//
// The seam exists so the API, its services and the browser contracts stay
// identical while the storage behind them changes. Azure SQL remains the intended
// production database; Firestore is what the lab can actually run today.
//
// A repository that has no Firestore implementation yet is represented by a
// refusing proxy rather than an empty stub. An empty stub would answer "no rows"
// to a question nobody asked, which reads as "this faculty has no sessions" when
// the truth is "this domain is not wired". The proxy throws a typed 501 instead,
// so the browser shows an unimplemented state and the API reports it honestly.

const { createFirestoreSessionRepository, unsupported } = require('./firestore/firestore-session-repository');
const { createFirestoreUserRepository } = require('./firestore/firestore-user-repository');
const { createFirestoreDashboardRepository } = require('./firestore/firestore-dashboard-repository');

const SUPPORTED_BACKENDS = new Set(['sql', 'firestore']);

function resolveDataBackend(env = {}) {
  const raw = String(env.PAWS_DATA_BACKEND || '').trim().toLowerCase();
  if (!raw) return 'sql';
  if (!SUPPORTED_BACKENDS.has(raw)) {
    throw Object.assign(
      Error(`Unsupported PAWS_DATA_BACKEND: ${raw}. Choose sql or firestore.`),
      { code: 'BACKEND_CONFIG_INVALID', status: 500, statusCode: 500 }
    );
  }
  return raw;
}

// A total stand-in for a repository that has no Firestore implementation.
// Every method access yields a function that throws, and `then` stays undefined so
// the object is never mistaken for a promise.
function unimplementedRepository(name) {
  return new Proxy(Object.freeze({}), {
    get(_target, property) {
      if (property === 'then' || property === Symbol.toStringTag) return undefined;
      if (property === 'isImplemented') return false;
      return () => { throw unsupported(`${name}.${String(property)}`); };
    },
    has() { return false; }
  });
}

// Firestore implementations that exist today. Everything else is deliberately
// absent: this list is the honest measure of how much of the backend is done.
const FIRESTORE_REPOSITORIES = Object.freeze({
  sessions: firestore => createFirestoreSessionRepository(firestore),
  users: firestore => createFirestoreUserRepository(firestore),
  dashboard: firestore => createFirestoreDashboardRepository(firestore)
});

// Operations that work even though their wider domain does not. A domain is not
// all-or-nothing: the Dashboard has a working Faculty read path while DOE, AFC and
// the rest of it are unbuilt. Without this, exposing one Faculty endpoint would
// mean either exposing an entire unfinished domain or exposing nothing.
//
// Each entry names the HTTP method and path it covers. Everything else in a
// partially implemented domain keeps returning 501.
const IMPLEMENTED_OPERATIONS = Object.freeze([
  { method: 'GET', pattern: /^\/api\/v1\/dashboard\/faculty$/, domain: 'dashboard' },
  { method: 'GET', pattern: /^\/api\/v1\/dashboard\/faculty\/[^/]+$/, domain: 'dashboard' },
  { method: 'GET', pattern: /^\/api\/v1\/dashboard\/roles$/, domain: 'dashboard' },
  { method: 'PUT', pattern: /^\/api\/v1\/dashboard\/roles\/[^/]+\/periods$/, domain: 'dashboard' },
  // The leadership directory is readable by any authorised PAWS account, so it
  // must not be blocked by the dashboard-wide gate.
  { method: 'GET', pattern: /^\/api\/v1\/dashboard\/leadership-directory$/, domain: 'dashboard' },
  { method: 'PATCH', pattern: /^\/api\/v1\/dashboard\/faculty\/[^/]+$/, domain: 'dashboard' },
  { method: 'POST', pattern: /^\/api\/v1\/dashboard\/faculty\/[^/]+\/(restore|deactivate)$/, domain: 'dashboard' }
]);

// Domains that exist but are only partly built. Their repository is real, so a
// plain "is the repository registered?" test would wrongly declare the whole
// domain available. For these, only IMPLEMENTED_OPERATIONS may pass the gate.
const PARTIALLY_IMPLEMENTED = new Set(['dashboard']);

function isPartiallyImplemented(domain) {
  return PARTIALLY_IMPLEMENTED.has(domain);
}

function isImplementedOperation(method, pathname) {
  const verb = String(method || '').toUpperCase();
  return IMPLEMENTED_OPERATIONS.some(entry => entry.method === verb && entry.pattern.test(pathname));
}


// Spreading a refusing proxy yields an empty object, because its target has no own
// keys — the merged repository would then fail every "is this a function" guard
// with a confusing message. Merging therefore detects a refusing input first and
// stays refusing.
function mergeRepositories(...repositories) {
  if (repositories.some(repository => repository && repository.isImplemented === false)) {
    return unimplementedRepository('merged');
  }
  return Object.assign({}, ...repositories);
}

function createFirestoreRepositories(firestore, names) {
  if (!firestore) {
    throw Object.assign(
      Error('PAWS_DATA_BACKEND=firestore requires a Firestore instance.'),
      { code: 'BACKEND_CONFIG_INVALID', status: 500, statusCode: 500 }
    );
  }
  const repositories = {};
  for (const name of names) {
    const factory = FIRESTORE_REPOSITORIES[name];
    repositories[name] = factory ? factory(firestore) : unimplementedRepository(name);
  }
  return repositories;
}

function firestoreCoverage(names) {
  return {
    implemented: names.filter(name => Boolean(FIRESTORE_REPOSITORIES[name])),
    unimplemented: names.filter(name => !FIRESTORE_REPOSITORIES[name])
  };
}

module.exports = {
  FIRESTORE_REPOSITORIES,
  PARTIALLY_IMPLEMENTED,
  isPartiallyImplemented,
  IMPLEMENTED_OPERATIONS,
  isImplementedOperation,
  SUPPORTED_BACKENDS,
  createFirestoreRepositories,
  firestoreCoverage,
  mergeRepositories,
  resolveDataBackend,
  unimplementedRepository
};
