'use strict';

// Shared, long-lived Azure SQL connection.
//
// Why this exists: the previous repositories opened a `ConnectionPool`, ran one
// query, and closed it inside the same call. Every request therefore paid a full
// TCP + TLS + Azure AD handshake, and a page that issued five reads paid for
// five handshakes. It also meant no statement could participate in a
// transaction, because the pool that owned it was torn down on return.
//
// This module owns exactly one pool and hands out requests and transactions from
// it. Two properties matter and are both tested:
//
//   1. Concurrent first callers share one connection attempt. Without that,
//      a burst of parallel requests would each create a pool and the "fix"
//      would be worse than the original.
//
//   2. The managed-identity access token is bound to the pool when the pool is
//      created, so a pool that outlives its token starts failing every query.
//      The connection therefore tracks the token's expiry and rebuilds the pool
//      before that expiry, rather than waiting for the first failure.

const DEFAULT_TOKEN_REFRESH_MS = 45 * 60 * 1000;
const MIN_TOKEN_REFRESH_MS = 60 * 1000;
const MAX_TOKEN_REFRESH_MS = 60 * 60 * 1000;
const DEFAULT_PORT = 1433;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

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

  let pool = null;
  let expiresAt = 0;
  let pending = null;
  let closed = false;

  function loadSql() {
    return sqlModule || require('mssql');
  }

  function expired(atMs) {
    return pool !== null && atMs >= expiresAt;
  }

  async function discard() {
    const current = pool;
    pool = null;
    expiresAt = 0;
    if (current) {
      try { await current.close(); } catch { /* a broken pool must not mask the replacement */ }
    }
  }

  // One shared connection attempt. Concurrent callers await the same promise, so
  // a burst of requests produces exactly one pool.
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
    if (pool && expired(now())) await discard();
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

  return {
    async query(statement, params = {}) {
      if (!text(statement)) throw Object.assign(Error('A SQL statement is required.'), { code: 'SQL_STATEMENT_REQUIRED' });
      const active = await acquire();
      const result = await bind(active.request(), params).query(statement);
      return result?.recordset || [];
    },

    async transaction(work) {
      if (typeof work !== 'function') throw Object.assign(Error('A transaction body is required.'), { code: 'SQL_TRANSACTION_REQUIRED' });
      const active = await acquire();
      const sql = loadSql();
      if (typeof sql.Transaction !== 'function' || !sql.ISOLATION_LEVEL) {
        throw Object.assign(Error('The configured SQL driver does not support transactions.'), { code: 'SQL_TRANSACTION_UNSUPPORTED' });
      }
      const transaction = new sql.Transaction(active);
      let settled = false;
      transaction.on?.('rollback', () => { settled = true; });
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const result = await work({
          query: async (statement, params = {}) => {
            const request = new sql.Request(transaction);
            const response = await bind(request, params).query(statement);
            return response?.recordset || [];
          }
        });
        await transaction.commit();
        settled = true;
        return result;
      } catch (error) {
        if (!settled) await transaction.rollback().catch(() => {});
        throw error;
      }
    },

    async health() {
      await this.query('SELECT TOP (1) 1 AS ok FROM paws.Session;');
      return true;
    },

    async close() {
      closed = true;
      await discard();
    },

    // Test/diagnostic surface: how many times a pool was actually created.
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
