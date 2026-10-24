'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqlConnection } = require('../src/data/sql-connection');
const { createSqlUserRepository } = require('../src/data/sql-user-repository');
const { createRequestTiming } = require('../src/perf/request-timing');

function fakeSql({ failConnect = false, failQueryAt = 0 } = {}) {
  let connects = 0, queries = 0;
  class ConnectionPool {
    async connect() { connects++; if (failConnect) throw Error('connect'); return this; }
    request() { return { input() {}, async query() { queries++; if (failQueryAt === queries) throw Error('query'); return { recordset: [{ firebaseUid: 'u' }] }; } }; }
  }
  return { sql: { ConnectionPool }, counts: () => ({ connects, queries }) };
}

test('cold then warm UserProfile lookup records connect and query separately without changing pool reuse', async () => {
  const f = fakeSql();
  const db = createSqlConnection({ connectionString: 'Server=x;Database=y;', sql: f.sql });
  const users = createSqlUserRepository(db);
  const cold = createRequestTiming({ now: (() => { const a = [0, 10, 20, 25]; return () => a.shift(); })() }); cold.markEligible();
  await users.findByUid('u', cold);
  assert.match(cold.serverTiming(), /sql_connect;dur=10;desc="cold"/);
  assert.match(cold.serverTiming(), /sql_user_query;dur=5/);
  const warm = createRequestTiming({ now: (() => { const a = [30, 37]; return () => a.shift(); })() }); warm.markEligible();
  await users.findByUid('u', warm);
  assert.match(warm.serverTiming(), /sql_connect;dur=0;desc="warm"/);
  assert.match(warm.serverTiming(), /sql_user_query;dur=7/);
  assert.deepEqual(f.counts(), { connects: 1, queries: 2 });
});

test('failed cold connect records sql_connect but does not fabricate query timing', async () => {
  const f = fakeSql({ failConnect: true });
  const db = createSqlConnection({ connectionString: 'Server=x;Database=y;', sql: f.sql });
  const users = createSqlUserRepository(db);
  const timing = createRequestTiming({ now: (() => { const a = [0, 11]; return () => a.shift(); })() }); timing.markEligible();
  await assert.rejects(users.findByUid('u', timing));
  assert.match(timing.serverTiming(), /sql_connect;dur=11;desc="cold"/);
  assert.doesNotMatch(timing.serverTiming(), /sql_user_query/);
});

test('warm query failure records warm connect and query duration', async () => {
  const f = fakeSql({ failQueryAt: 2 });
  const db = createSqlConnection({ connectionString: 'Server=x;Database=y;', sql: f.sql });
  const users = createSqlUserRepository(db);
  await users.findByUid('u');
  const timing = createRequestTiming({ now: (() => { const a = [5, 13]; return () => a.shift(); })() }); timing.markEligible();
  await assert.rejects(users.findByUid('u', timing));
  assert.match(timing.serverTiming(), /sql_connect;dur=0;desc="warm"/);
  assert.match(timing.serverTiming(), /sql_user_query;dur=8/);
});
