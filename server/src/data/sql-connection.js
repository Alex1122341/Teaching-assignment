'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

// Shared, long-lived Azure SQL connection for the ported PAWS domains.
//
// Two concerns are separated deliberately:
//
//   1. HOW the pool is configured. Two credential models are supported:
//        - `tokenProvider` (this repository's deployment): an
//          `azure-active-directory-access-token` from the App Service local
//          identity endpoint. The token is bound at pool construction, so the
//          pool is rebuilt before it expires.
//        - `connectionString` / `config` (the Beta model): either
//          `azure-active-directory-default` with a managed-identity client id,
//          or `msnodesqlv8` Windows integrated auth. These build a static
//          configuration, so there is nothing to refresh.
//
//   2. HOW the ported repositories expect to call us. They call
//      `db.query(text, params)` and `db.transaction(() => ...)`, relying on
//      AsyncLocalStorage so a query issued anywhere inside the callback joins the
//      open transaction. That convention is preserved exactly, because rewriting
//      it across ~40 repository modules would be far larger and riskier than
//      adapting this one file.
//
// Added on top of Beta's behaviour and tested:
//   - One connection attempt even under concurrency, so a burst of parallel
//     requests produces one pool rather than one per request.
//   - The pool is rebuilt before a token-provider credential expires.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_KEYS = new Map([
  ['server', 'server'],
  ['datasource', 'server'],
  ['address', 'server'],
  ['addr', 'server'],
  ['networkaddress', 'server'],
  ['port', 'port'],
  ['database', 'database'],
  ['initialcatalog', 'database'],
  ['encrypt', 'encrypt'],
  ['trustservercertificate', 'trustServerCertificate']
]);

const DEFAULT_PORT = 1433;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_TOKEN_REFRESH_MS = 45 * 60 * 1000;
const MIN_TOKEN_REFRESH_MS = 60 * 1000;
const MAX_TOKEN_REFRESH_MS = 60 * 60 * 1000;

const text = value => String(value ?? '').trim();

// ---------------------------------------------------------------------------
// Connection-string credential model (Beta parity)
// ---------------------------------------------------------------------------

function normalizeKey(key) {
  return key.toLowerCase().replace(/\s+/g, '');
}

function resolveSqlDriver(value) {
  const driver = value === undefined || value === null ? '' : String(value).trim().toLowerCase();
  if (!driver || driver === 'tedious') return 'tedious';
  if (driver === 'msnodesqlv8') return 'msnodesqlv8';
  throw Error('Unsupported PAWS_SQL_DRIVER: choose empty, tedious, or msnodesqlv8');
}

function parseBooleanFlag(value, name) {
  if (value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw Error(`${name} must be true or false`);
}

function parseConnectionString(connectionString) {
  const values = {};
  for (const segment of connectionString.split(';')) {
    if (!segment.trim()) continue;
    const separator = segment.indexOf('=');
    if (separator < 1) throw Error('PAWS_SQL_CONNECTION_STRING contains an invalid segment');
    const key = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    const logicalKey = ALLOWED_KEYS.get(normalizeKey(key));
    if (!logicalKey) throw Error(`SQL connection option is not allowed: ${key}`);
    if (values[logicalKey] !== undefined && values[logicalKey] !== value) {
      throw Error(`Conflicting values supplied for ${logicalKey}`);
    }
    values[logicalKey] = value;
  }
  return values;
}

function parseServer(serverValue) {
  const server = serverValue.replace(/^tcp:/i, '');
  const comma = server.lastIndexOf(',');
  if (comma > -1 && /^\d+$/.test(server.slice(comma + 1))) {
    return { server: server.slice(0, comma), port: Number(server.slice(comma + 1)) };
  }
  return { server };
}

function buildWindowsConnectionConfig({ connectionString, allowSelfSigned }) {
  const values = parseConnectionString(connectionString);
  const serverValue = values.server;
  const database = values.database;
  if (!serverValue || !database) throw Error('Windows SQL configuration requires server and database');

  if (values.encrypt !== undefined && values.encrypt.toLowerCase() !== 'true') {
    throw Error('Encrypt must be true in Windows SQL mode');
  }
  if (values.trustServerCertificate !== undefined && !['true', 'false'].includes(values.trustServerCertificate.toLowerCase())) {
    throw Error('TrustServerCertificate must be true or false');
  }
  const trustServerCertificate = values.trustServerCertificate === undefined
    ? false
    : values.trustServerCertificate.toLowerCase() === 'true';
  if (trustServerCertificate && !allowSelfSigned) {
    throw Error('TrustServerCertificate=true requires PAWS_SQL_ALLOW_SELF_SIGNED=true for test-only use');
  }

  const endpoint = parseServer(serverValue);
  if (values.port !== undefined) {
    if (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535) {
      throw Error('SQL port must be an integer from 1 to 65535');
    }
    if (endpoint.port !== undefined && endpoint.port !== Number(values.port)) {
      throw Error('Conflicting values supplied for port');
    }
    endpoint.port = Number(values.port);
  }
  if (endpoint.port !== undefined && (endpoint.port < 1 || endpoint.port > 65535)) {
    throw Error('SQL port must be an integer from 1 to 65535');
  }
  const odbcValue = value => String(value).replace(/}/g, '}}');
  const server = endpoint.port === undefined ? endpoint.server : endpoint.server + ',' + endpoint.port;
  const odbcConnectionString = [
    'Driver={ODBC Driver 18 for SQL Server}',
    'Server={' + odbcValue(server) + '}',
    'Database={' + odbcValue(database) + '}',
    'Trusted_Connection=Yes',
    'Encrypt=Yes',
    'TrustServerCertificate=' + (trustServerCertificate ? 'Yes' : 'No')
  ].join(';') + ';';
  return {
    ...endpoint,
    database,
    connectionString: odbcConnectionString,
    options: {
      encrypt: true,
      trustServerCertificate,
      trustedConnection: true
    }
  };
}

function buildSqlConnectionConfig({ connectionString, miClientId, driver, allowSelfSigned = false } = {}) {
  const selectedDriver = resolveSqlDriver(driver);
  if (!connectionString) throw Error('PAWS_SQL_CONNECTION_STRING is required');
  if (typeof allowSelfSigned !== 'boolean') throw Error('allowSelfSigned must be a boolean');
  if (allowSelfSigned && selectedDriver !== 'msnodesqlv8') {
    throw Error('PAWS_SQL_ALLOW_SELF_SIGNED is only valid in msnodesqlv8 test mode');
  }
  if (selectedDriver === 'msnodesqlv8' && miClientId) {
    throw Error('PAWS_SQL_DRIVER=msnodesqlv8 cannot be combined with PAWS_SQL_MI_CLIENT_ID');
  }
  if (selectedDriver === 'msnodesqlv8') {
    return buildWindowsConnectionConfig({ connectionString, allowSelfSigned });
  }
  if (!miClientId) return connectionString;
  if (!UUID.test(miClientId)) throw Error('PAWS_SQL_MI_CLIENT_ID must be a UUID');

  const values = parseConnectionString(connectionString);
  const serverValue = values.server;
  const database = values.database;
  if (!serverValue || !database) throw Error('Managed identity configuration requires server and database');
  if (values.encrypt !== undefined && values.encrypt.toLowerCase() !== 'true') {
    throw Error('Encrypt must be true in managed identity mode');
  }
  if (values.trustServerCertificate !== undefined && values.trustServerCertificate.toLowerCase() !== 'false') {
    throw Error('TrustServerCertificate must be false in managed identity mode');
  }

  return {
    ...parseServer(serverValue),
    database,
    authentication: {
      type: 'azure-active-directory-default',
      options: { clientId: miClientId }
    },
    options: {
      encrypt: true,
      trustServerCertificate: false
    }
  };
}

// ---------------------------------------------------------------------------
// Token credential model (this repository's deployment)
// ---------------------------------------------------------------------------

function normalizeTokenResult(result, fallbackRefreshMs, nowMs) {
  if (typeof result === 'string') {
    const token = text(result);
    if (!token) throw Object.assign(Error('Managed identity returned no SQL access token.'), { code: 'SQL_IDENTITY_TOKEN_MISSING' });
    return { token, expiresAt: nowMs + fallbackRefreshMs };
  }
  if (!result || typeof result !== 'object') {
    throw Object.assign(Error('Managed identity token provider returned an unsupported value.'), { code: 'SQL_IDENTITY_TOKEN_INVALID' });
  }
  const token = text(result.token ?? result.access_token);
  if (!token) throw Object.assign(Error('Managed identity returned no SQL access token.'), { code: 'SQL_IDENTITY_TOKEN_MISSING' });
  const expiresOn = Number(result.expiresOn ?? result.expires_on);
  const expiresAt = Number.isFinite(expiresOn) && expiresOn > 0
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

// A repository deployed before its business database exists must still start,
// render, and answer honestly. This connection represents "no database
// configured": every read and write fails closed with a typed
// `DATABASE_NOT_CONFIGURED` error that the API layer maps to a clear
// unconfigured state, and nothing is ever attempted on the wire.
//
// It is deliberately NOT a silent empty-data source. An empty list and an
// unconfigured database must be distinguishable, or the UI will report
// "no teaching sessions" for a system that has never been connected.
function createNotConfiguredConnection() {
  const notConfigured = () => Object.assign(
    Error('The business database is not configured.'),
    // `status` is the shape the ported API layer reads; `statusCode` is the shape
    // this repository's older error mapping reads. Both are set so the same
    // failure is a 503 either way, never a 500.
    { code: 'DATABASE_NOT_CONFIGURED', status: 503, statusCode: 503 }
  );
  return {
    isConfigured: false,
    // Async so every caller sees a rejected promise, matching the configured
    // connection. A synchronous throw here would be an easy-to-miss difference.
    async query() { throw notConfigured(); },
    async transaction() { throw notConfigured(); },
    isTransactionActive: () => false,
    async health() { return false; },
    async close() {},
    get isConnected() { return false; }
  };
}

function createSqlConnection(options = {}) {
  const {
    sqlModule = null,
    sql = null,
    tokenProvider,
    connectionString,
    miClientId,
    driver,
    allowSelfSigned = false,
    config,
    server,
    database,
    port = DEFAULT_PORT,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    tokenRefreshMs = DEFAULT_TOKEN_REFRESH_MS,
    now = () => Date.now()
  } = options;

  const injectedSql = sqlModule || sql;
  const usesTokenProvider = typeof tokenProvider === 'function';
  const usesStaticConfig = Boolean(config) || Boolean(connectionString);

  if (!usesTokenProvider && !usesStaticConfig) return createNotConfiguredConnection();
  if (usesTokenProvider && usesStaticConfig) {
    throw Object.assign(Error('Supply either a token provider or a connection configuration, not both.'), { code: 'SQL_CONFIG_INVALID' });
  }
  if (usesTokenProvider) {
    // Validate the endpoint at composition time: deferring this to the first
    // query would turn a deployment misconfiguration into a live 500.
    if (!text(server)) throw Object.assign(Error('A SQL server is required.'), { code: 'SQL_CONFIG_INVALID' });
    if (!text(database)) throw Object.assign(Error('A SQL database is required.'), { code: 'SQL_CONFIG_INVALID' });
  }
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 120000) {
    throw Object.assign(Error('SQL request timeout must be an integer from 1000 to 120000 milliseconds.'), { code: 'SQL_CONFIG_INVALID' });
  }
  if (!Number.isSafeInteger(tokenRefreshMs) || tokenRefreshMs < MIN_TOKEN_REFRESH_MS || tokenRefreshMs > MAX_TOKEN_REFRESH_MS) {
    throw Object.assign(Error(`SQL token refresh must be an integer from ${MIN_TOKEN_REFRESH_MS} to ${MAX_TOKEN_REFRESH_MS} milliseconds.`), { code: 'SQL_CONFIG_INVALID' });
  }

  const transactions = new AsyncLocalStorage();
  // A static configuration carries no refreshable credential, so its expiry is
  // treated as infinite.
  const staticConfig = config || (connectionString
    ? buildSqlConnectionConfig({ connectionString, miClientId, driver, allowSelfSigned })
    : null);

  let pool = null;
  let expiresAt = Number.POSITIVE_INFINITY;
  let pending = null;
  let closed = false;

  function loadSql() {
    return injectedSql || require('mssql');
  }

  async function discard() {
    const current = pool;
    pool = null;
    expiresAt = Number.POSITIVE_INFINITY;
    if (current) {
      try { await current.close(); } catch { /* a broken pool must not mask its replacement */ }
    }
  }

  function connectOnce() {
    if (pending) return pending;
    const created = (async () => {
      const sqlClient = loadSql();
      let poolConfig;
      if (staticConfig) {
        // Clone rather than mutate: the ordinary pool and the import pool share
        // one static configuration object, so writing a longer budget onto it
        // would silently raise the timeout for every page read as well.
        poolConfig = typeof staticConfig === 'object' && requestTimeoutMs !== DEFAULT_REQUEST_TIMEOUT_MS
          ? { ...staticConfig, requestTimeout: requestTimeoutMs }
          : staticConfig;
      } else {
        const tokenResult = await tokenProvider();
        const normalized = normalizeTokenResult(tokenResult, tokenRefreshMs, now());
        poolConfig = buildPoolConfig({ server, database, token: normalized.token, requestTimeoutMs, port });
        expiresAt = normalized.expiresAt;
      }
      const candidate = new sqlClient.ConnectionPool(poolConfig);
      // A connection string is parsed by the driver into a private config object
      // per pool, so the budget can be applied there before connecting. Only this
      // pool is touched.
      if (requestTimeoutMs !== DEFAULT_REQUEST_TIMEOUT_MS
        && typeof poolConfig === 'string'
        && candidate.config
        && typeof candidate.config === 'object') {
        candidate.config.requestTimeout = requestTimeoutMs;
      }
      const connected = await candidate.connect();
      pool = connected;
      return connected;
    })();
    pending = created;
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

  async function runQuery(statement, params = {}, queryOptions = {}) {
    if (!text(statement)) throw Object.assign(Error('A SQL statement is required.'), { code: 'SQL_STATEMENT_REQUIRED' });
    const state = transactions.getStore();
    if (state && !queryOptions.transactionQueued) {
      const queued = state.chain.then(() => runQuery(statement, params, { ...queryOptions, transactionQueued: true }));
      state.chain = queued.catch(error => { state.error = state.error || error; });
      return queued;
    }
    const timing = queryOptions.timing;
    const queryMetric = queryOptions.queryMetric;
    const sqlClient = loadSql();
    let request;
    if (state) {
      request = new sqlClient.Request(state.transaction);
    } else {
      // A warm pool costs nothing to obtain, so it records a zero-duration
      // `warm` entry; a cold one is measured around the real handshake. The
      // connect metric is recorded even when the handshake fails, because "could
      // not connect" and "connected and then failed" are different diagnoses.
      const wasConnected = pool !== null;
      const connectStarted = timing && !wasConnected ? timing.start('sql_connect') : null;
      try {
        const active = await acquire();
        request = active.request();
      } finally {
        if (timing) {
          if (wasConnected) timing.record('sql_connect', 0, 'warm');
          else timing.end('sql_connect', connectStarted, 'cold');
        }
      }
    }
    bind(request, params);
    const queryStarted = timing && queryMetric ? timing.start(queryMetric) : null;
    try {
      const result = await request.query(statement);
      return result?.recordset || [];
    } finally {
      if (timing && queryMetric) timing.end(queryMetric, queryStarted);
    }
  }

  async function transaction(callback, { supportOperationId = null } = {}) {
    if (typeof callback !== 'function') throw Object.assign(Error('A transaction body is required.'), { code: 'SQL_TRANSACTION_REQUIRED' });
    if (transactions.getStore()) throw Object.assign(Error('Nested request transaction is unsupported.'), { code: 'SQL_TRANSACTION_NESTED' });
    const sqlClient = loadSql();
    if (typeof sqlClient.Transaction !== 'function' || !sqlClient.ISOLATION_LEVEL) {
      throw Object.assign(Error('The configured SQL driver does not support transactions.'), { code: 'SQL_TRANSACTION_UNSUPPORTED' });
    }
    const active = await acquire();
    const instance = new sqlClient.Transaction(active);
    let rolledBack = false;
    instance.on?.('rollback', () => { rolledBack = true; });
    await instance.begin(sqlClient.ISOLATION_LEVEL.SERIALIZABLE);
    const state = { transaction: instance, operationId: supportOperationId, error: null, chain: Promise.resolve() };
    try {
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
    isConfigured: true,
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
  buildSqlConnectionConfig,
  createSqlConnection,
  normalizeTokenResult,
  parseBooleanFlag,
  resolveSqlDriver
};
