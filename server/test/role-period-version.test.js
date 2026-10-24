'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDashboardApi } = require('../src/data/dashboard-api');

const ROLE_ID = '11111111-1111-4111-8111-111111111111';
const PERIODS = [{ startDate: '2026-11-01', endDate: '2027-04-30' }];
const HEX = '0x00000000000000AF';

function setup({ role = 'administrator', active = true, gate = true, conflict = false } = {}) {
  const calls = [];
  const api = createDashboardApi({
    verifyToken: async () => ({ uid: 'synthetic-admin' }),
    findUser: async () => ({ baseRole: role, active, mustChangePassword: false }),
    repository: {},
    writeRepository: {
      updateRolePeriods: async input => {
        calls.push(input);
        if (conflict) throw Object.assign(new Error('changed'), { number: 53509 });
        return { scheduleVersion: '0x00000000000000B0' };
      }
    },
    writeGates: { facultyAdmin: gate }
  });
  return { calls, save: version => api.updateRolePeriods('synthetic-token', ROLE_ID, { expectedVersion: version, periods: PERIODS }) };
}

test('SQL style-1 rowversion remains unchanged and preserves dates and verified actor', async () => {
  const h = setup();
  const res = await h.save(HEX);
  assert.equal(res.status, 200);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].expectedVersion, HEX);
  assert.deepEqual(h.calls[0].periods, PERIODS);
  assert.equal(h.calls[0].actorFirebaseUid, 'synthetic-admin');
});

test('unprefixed 16-digit hexadecimal role version is normalized, not rejected', async () => {
  const h = setup();
  const res = await h.save(' 00000000000000af ');
  assert.equal(res.status, 200);
  assert.equal(h.calls[0].expectedVersion, HEX);
});

test('JSON-serialized SQL rowversion Buffer is normalized to the same eight bytes', async () => {
  const h = setup();
  const res = await h.save({ type: 'Buffer', data: [0, 0, 0, 0, 0, 0, 0, 175] });
  assert.equal(res.status, 200);
  assert.equal(h.calls[0].expectedVersion, HEX);
});

test('malformed role versions never become null or reach SQL', async () => {
  for (const version of ['not-a-version', '0x123', { type: 'Buffer', data: [255, 128] }, { data: [0, 0, 0, 0, 0, 0, 0, 175] }, -1]) {
    const h = setup();
    const res = await h.save(version);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_ROLE_VERSION');
    assert.equal(h.calls.length, 0);
  }
});

test('a null version still only creates a schedule through the SQL concurrency guard', async () => {
  const h = setup();
  assert.equal((await h.save(null)).status, 200);
  assert.equal(h.calls[0].expectedVersion, null);
});

test('real concurrent modification stays HTTP 409 and does not change the supplied token', async () => {
  const h = setup({ conflict: true });
  const res = await h.save(HEX);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'STALE_ROLE_PERIODS');
  assert.equal(h.calls[0].expectedVersion, HEX);
});

test('ordinary faculty and disabled write gate still cannot edit appointments', async () => {
  for (const opts of [{ role: 'faculty' }, { gate: false }]) {
    const h = setup(opts);
    const res = await h.save('00000000000000af');
    assert.notEqual(res.status, 200);
    assert.equal(h.calls.length, 0);
  }
});
