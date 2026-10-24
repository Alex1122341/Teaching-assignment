'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestTiming, METRIC_NAMES } = require('../src/perf/request-timing');

test('request timing uses monotonic phase durations and approved names only', () => {
  const ticks = [10, 25];
  const timing = createRequestTiming({ now: () => ticks.shift() });
  const start = timing.start('firebase_verify');
  assert.equal(timing.end('firebase_verify', start), true);
  timing.markEligible();
  assert.equal(timing.serverTiming(), 'firebase_verify;dur=15');
  assert.deepEqual(METRIC_NAMES, ['firebase_verify', 'sql_connect', 'sql_user_query', 'profile_validate', 'me_total']);
});

test('unknown names and unsafe values cannot enter the timing header', () => {
  const timing = createRequestTiming();
  assert.equal(timing.record('uid', 12), false);
  assert.equal(timing.record('sql_connect', -1, 'cold'), false);
  assert.equal(timing.record('sql_connect', Number.POSITIVE_INFINITY, 'cold'), false);
  assert.equal(timing.record('sql_connect', 4.25, 'cold";uid="person'), true);
  timing.markEligible();
  const header = timing.serverTiming();
  assert.match(header, /^sql_connect;dur=4\.25$/);
  assert.doesNotMatch(header, /uid|person|token|email|faculty/i);
});

test('timing state is request-local and ineligible timing does not serialize', () => {
  const a = createRequestTiming();
  const b = createRequestTiming();
  a.record('firebase_verify', 2);
  b.record('sql_connect', 0, 'warm');
  assert.equal(a.serverTiming(), '');
  a.markEligible(); b.markEligible();
  assert.equal(a.serverTiming(), 'firebase_verify;dur=2');
  assert.equal(b.serverTiming(), 'sql_connect;dur=0;desc="warm"');
});
