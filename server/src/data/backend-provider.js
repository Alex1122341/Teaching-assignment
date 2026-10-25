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
  sessions: firestore => createFirestoreSessionRepository(firestore)
});

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
  SUPPORTED_BACKENDS,
  createFirestoreRepositories,
  firestoreCoverage,
  resolveDataBackend,
  unimplementedRepository
};
