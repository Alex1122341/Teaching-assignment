const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '..', 'session-guard.js');

function loadGuard() {
  assert.ok(fs.existsSync(modulePath), 'session-guard.js must exist');
  delete require.cache[modulePath];
  return require(modulePath);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('allows five reloads in one minute and blocks the sixth', () => {
  const { recordReload } = loadGuard();
  const storage = memoryStorage();
  for (let i = 0; i < 5; i++) {
    assert.equal(recordReload(storage, 1_000 + i, true).allowed, true);
  }
  const sixth = recordReload(storage, 2_000, true);
  assert.equal(sixth.allowed, false);
  assert.equal(sixth.retryAfterMs > 0, true);
});

test('does not count normal navigation as a refresh', () => {
  const { recordReload } = loadGuard();
  const storage = memoryStorage();
  for (let i = 0; i < 20; i++) {
    assert.equal(recordReload(storage, 1_000 + i, false).allowed, true);
  }
});

test('refresh allowance resets after one minute', () => {
  const { recordReload } = loadGuard();
  const storage = memoryStorage();
  for (let i = 0; i < 5; i++) recordReload(storage, 1_000 + i, true);
  assert.equal(recordReload(storage, 62_000, true).allowed, true);
});

test('one hour without activity is idle', () => {
  const { isIdle } = loadGuard();
  assert.equal(isIdle(1_000, 3_600_999), false);
  assert.equal(isIdle(1_000, 3_601_000), true);
});
