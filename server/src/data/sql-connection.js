'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

// Shared, long-lived Azure SQL connection for the ported PAWS domains.
//
// Two concerns are deliberately separated here:
//
//   1. HOW we authenticate. Beta resolves credentials through
//      `azure-active-directory-default` (managed-identity client id) or
//      `msnodesqlv8` (Windows integrated auth). This repository uses an
//      `azure-active-directory-access-token` fetched from the App Service local
//      identity endpoint. The credential path is not interchangeable, so it is
//      injected as a token provider.
//
//   2. HOW the ported repositories expect to call us. Beta's ~40 repository
//      modules call `db.query(text, params)` and `db.transaction(() => ...)`,
//      relying on AsyncLocalStorage so that a `db.query` issued anywhere inside
//      the callback joins the open transaction. That call convention is
//      preserved exactly, because rewriting it across every repository would be
//      a far larger and riskier change than adapting this one file.
//
// On top of Beta's behaviour this version adds two properties that matter in
// production and are tested:
//
//   - One connection attempt even under concurrency. A shared in-flight promise
//     means a burst of parallel requests produces one pool, not one per request.
//   - The pool is rebuilt before its bound token expires. The access token is
//     baked into the pool at construction, so a pool that outlives its token
//     fails every subsequent query.

const DEFAULT_PORT = 1433;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_TOKEN_REFRESH_MS = 45 * 60 * 1000;
const MIN_TOKEN_REFRESH_MS = 60 * 1000;
const MAX_TOKEN_REFRESH_MS = 60 * 60 * 1000;

const text = value => String(value ?? '').trim();

function normalizeTokenResult(result, fallbackRefreshMs, nowMs) {
  if (typeof result === 'string') {
    const token = text(result);
    if (!token) throw Object.assign(Error('Managed identity returned no SQL access token.'), { code: 'SQL_IDENTITY_TOKEN_MISSING' });
    // No expiry supplied: refresh conservatively rather than trusting the pool
    // indefinitely.
    return { token, expiresAt: nowMs + fallbackRefreshMs };
  }
  if (!result || typeof result !== 'object') {
    throw Object.assign(Error('Managed identity token provider returned an unsupported value.'), { code: 'SQL_IDENTITY_TOKEN_INVALID' });
  }
  const token = text(result.token ?? result.access_token);
  if (!token) throw Object.assign(Error('Managed identity returned no SQL access token.'), { code: 'SQL_IDENTITY_TOKEN_MISSING' });
  const expiresOn = Number(result.expiresOn ?? result.expires_on);
  const expiresAt = Number.isFinite(expiresOn) && expiresOn > 0
    // `expires_on` may arrive as epoch seconds or epoch milliseconds.
    ? (expiresOn > 1e12 ? expiresOn : expiresOn * 1000)
    : nowMs + fallbackRefreshMs;
  return { token, expiresAt };
}

function buildPoolConfig({ server, database, token, requestTimeoutMs, port = DEFAULT_PORT }) {
  const serverName = text(server);
  const databaseName = text(database);
  if (!serverName) throw Object.assign(Error('A SQL server is required.'), { code: 'SQL_CONFIG_INVALID' });
  if (!databaseName) throw Object.assign(Error('A SQL database is required.'), { code: 'SQL_CONFIG_INVALID' });
  return {
    server: serverName,
    database: databaseName,
    port,
    options: { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
    authentication: { type: 'azure-active-directory-access-token', options: { token } },
    requestTimeout: requestTimeoutMs
  };
}

function createSqlConnection({
  sqlModule = null,
  tokenProvider,
  server,
  database,
  port = DEFAULT_PORT,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  tokenRefreshMs = DEFAULT_TOKEN_REFRESH_MS,
  now = () => Date.now()
} = {}) {
  if (typeof tokenProvider !== 'function') throw Object.assign(Error('A SQL token provider is required.'), { code: 'SQL_CONFIG_INVALID' });
  // Validate the endpoint at composition time. Deferring this to the first query
  // would turn a deployment misconfiguration into a runtime 500 on a live read.
  if (!text(server)) throw Object.assign(Error('A SQL server is required.'), { code: 'SQL_CONFIG_INVALID' });
  if (!text(database)) throw Object.assign(Error('A SQL database is required.'), { code: 'SQL_CONFIG_INVALID' });
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 120000) {
    throw Object.assign(Error('SQL request timeout must be an integer from 1000 to 120000 milliseconds.'), { code: 'SQL_CONFIG_INVALID' });
  }
  if (!Number.isSafeInteger(tokenRefreshMs) || tokenRefreshMs < MIN_TOKEN_REFRESH_MS || tokenRefreshMs > MAX_TOKEN_REFRESH_MS) {
    throw Object.assign(Error(`SQL token refresh must be an integer from ${MIN_TOKEN_REFRESH_MS} to ${MAX_TOKEN_REFRESH_MS} milliseconds.`), { code: 'SQL_CONFIG_INVALID' });
  }

  const transactions = new AsyncLocalStorage();
  let pool = null;
  let expiresAt = 0;
  let pending = null;
  let closed = false;

  function loadSql() {
    return sqlModule || require('mssql');
  }

  async function discard() {
    const current = pool;
    pool = null;
    expiresAt = 0;
    if (current) {
      try { await current.close(); } catch { /* a broken pool must not mask its replacement */ }
    }
  }

  function connectOnce() {
    if (pending) return pending;
    const created = (async () => {
      const sql = loadSql();
      const tokenResult = await tokenProvider();
      const { token, expiresAt: tokenExpiry } = normalizeTokenResult(tokenResult, tokenRefreshMs, now());
      const candidate = new sql.ConnectionPool(buildPoolConfig({ server, database, token, requestTimeoutMs, port }));
      const connected = await candidate.connect();
      pool = connected;
      expiresAt = tokenExpiry;
      return connected;
    })();
    pending = created;
    // Clear the shared attempt without leaving an unhandled rejection behind:
    // the caller awaiting `created` is the one that reports the failure.
    const clear = () => { if (pending === created) pending = null; };
    created.then(clear, clear);
    return created;
  }

  async function acquire() {
    if (closed) throw Object.assign(Error('The SQL connection has been closed.'), { code: 'SQL_CONNECTION_CLOSED' });
    if (pool && now() >= expiresAt) await discard();
    if (pool) return pool;
    return connectOnce();
  }

  function bind(request, params) {
    for (const [name, value] of Object.entries(params || {})) {
      // An explicitly supplied `null` is a real SQL NULL and must be bound: a
      // statement may reference it in an `@p IS NULL OR ...` guard. Only
      // `undefined` means "not supplied".
      if (value !== undefined) request.input(name, value === null ? null : value);
    }
    return request;
  }

  // Executes one statement. Inside a transaction the statement is chained onto
  // the transaction's queue so that two `db.query` calls issued from the same
  // async context cannot interleave on one connection.
  async function runQuery(statement, params = {}, options = {}) {
    if (!text(statement)) throw Object.assign(Error('A SQL statement is required.'), { code: 'SQL_STATEMENT_REQUIRED' });
    const state = transactions.getStore();
    if (state && !options.transactionQueued) {
      const queued = state.chain.then(() => runQuery(statement, params, { ...options, transactionQueued: true }));
      state.chain = queued.catch(error => { state.error = state.error || error; });
      return queued;
    }
    const sql = loadSql();
    let request;
    if (state) request = new sql.Request(state.transaction);
    else request = (await acquire()).request();
    bind(request, params);
    const result = await request.query(statement);
    return result?.recordset || [];
  }

  async function transaction(callback, { supportOperationId = null } = {}) {
    if (typeof callback !== 'function') throw Object.assign(Error('A transaction body is required.'), { code: 'SQL_TRANSACTION_REQUIRED' });
    if (transactions.getStore()) throw Object.assign(Error('Nested request transaction is unsupported.'), { code: 'SQL_TRANSACTION_NESTED' });
    const sql = loadSql();
    if (typeof sql.Transaction !== 'function' || !sql.ISOLATION_LEVEL) {
      throw Object.assign(Error('The configured SQL driver does not support transactions.'), { code: 'SQL_TRANSACTION_UNSUPPORTED' });
    }
    const active = await acquire();
    const instance = new sql.Transaction(active);
    let rolledBack = false;
    instance.on?.('rollback', () => { rolledBack = true; });
    await instance.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const state = { transaction: instance, operationId: supportOperationId, error: null, chain: Promise.resolve() };
    try {
      // The callback receives a small handle for convenience, but the supported
      // convention (and the one the ported repositories use) is to call
      // `db.query` directly and let AsyncLocalStorage route it here.
      const result = await transactions.run(state, () => callback({
        query: (statement, params) => runQuery(statement, params)
      }));
      await state.chain;
      if (state.error) throw state.error;
      await instance.commit();
      return result;
    } catch (error) {
      if (!rolledBack) await instance.rollback().catch(() => {});
      throw error;
    }
  }

  return {
    query: runQuery,
    transaction,
    isTransactionActive: () => Boolean(transactions.getStore()),

    async health() {
      await runQuery('SELECT TOP (1) 1 AS ok FROM paws.Session;');
      return true;
    },

    async close() {
      closed = true;
      await discard();
    },

    get isConnected() { return pool !== null; }
  };
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_TOKEN_REFRESH_MS,
  buildPoolConfig,
  createSqlConnection,
  normalizeTokenResult
};
