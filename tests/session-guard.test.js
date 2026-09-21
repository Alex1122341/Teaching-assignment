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


function warningDocument() {
  const elements = new Map();
  const previous = { focused: false, focus() { this.focused = true; doc.activeElement = this; } };
  let doc;
  const make = tagName => {
    const children = new Map();
    const node = {
      tagName: String(tagName || '').toUpperCase(),
      id: '',
      attributes: {},
      style: { cssText: '' },
      parentNode: null,
      setAttribute(name, value) { this.attributes[name] = String(value); },
      appendChild(child) { child.parentNode = this; if (child.id) elements.set(child.id, child); return child; },
      remove() { if (this.id) elements.delete(this.id); this.removed = true; },
      querySelector(selector) { return children.get(selector) || null; },
      focus() { doc.activeElement = this; this.focused = true; },
    };
    Object.defineProperty(node, 'innerHTML', {
      set(value) {
        this._innerHTML = value;
        if (!String(value).includes('data-ucvm-stay-signed-in')) return;
        const label = make('span');
        label.id = 'ucvm-session-timeout-copy';
        label.textContent = '';
        const button = make('button');
        button.textContent = 'Stay signed in';
        children.set('[data-ucvm-session-countdown]', label);
        children.set('[data-ucvm-stay-signed-in]', button);
      },
      get() { return this._innerHTML || ''; },
    });
    return node;
  };
  const body = {
    appendChild(node) { node.parentNode = body; if (node.id) elements.set(node.id, node); return node; }
  };
  doc = {
    body,
    activeElement: previous,
    createElement: make,
    getElementById: id => elements.get(id) || null,
    addEventListener() {},
  };
  return { doc, previous };
}

test('idle warning begins five minutes before the one-hour timeout', () => {
  const { idleState, constants } = loadGuard();
  const start = 1_000;
  assert.equal(constants.IDLE_WARNING_MS, 5 * 60 * 1000);
  assert.deepEqual(idleState(start, start + 55 * 60 * 1000 - 1), {
    idle: false,
    warning: false,
    remainingMs: 5 * 60 * 1000 + 1,
  });
  assert.deepEqual(idleState(start, start + 55 * 60 * 1000), {
    idle: false,
    warning: true,
    remainingMs: 5 * 60 * 1000,
  });
  assert.deepEqual(idleState(start, start + 60 * 60 * 1000), {
    idle: true,
    warning: false,
    remainingMs: 0,
  });
});

test('Stay signed in is a real focused action that removes the warning and restores prior focus', () => {
  const { showIdleWarning } = loadGuard();
  const { doc, previous } = warningDocument();
  let stayed = 0;
  const warning = showIdleWarning(doc, 5 * 60 * 1000, () => { stayed += 1; });
  const button = warning.querySelector('[data-ucvm-stay-signed-in]');
  const label = warning.querySelector('[data-ucvm-session-countdown]');
  assert.equal(doc.activeElement, button);
  assert.match(label.textContent, /about 5 minutes/);
  button.onclick();
  assert.equal(stayed, 1);
  assert.equal(doc.getElementById('ucvm-session-timeout-warning'), null);
  assert.equal(doc.activeElement, previous);
  assert.equal(previous.focused, true);
});

test('storage activity from another tab dismisses the warning immediately and stop allows restart', () => {
  const { start, showIdleWarning, constants } = loadGuard();
  const { doc } = warningDocument();
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  localStorage.setItem(constants.ACTIVITY_KEY, String(Date.now()));
  const listeners = new Map();
  const windowObject = {
    document: doc,
    localStorage,
    sessionStorage,
    performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    location: { pathname: '/index.html', replace() {} },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    setInterval() { return 1; },
    clearInterval() {},
  };
  const auth = { currentUser: { uid: 'u1' }, signOut: async () => {} };
  const controller = start(auth, { window: windowObject, document: doc });
  showIdleWarning(doc, 5 * 60 * 1000, () => {});
  assert.ok(doc.getElementById('ucvm-session-timeout-warning'));
  listeners.get('storage')({ key: constants.ACTIVITY_KEY, newValue: String(Date.now()) });
  assert.equal(doc.getElementById('ucvm-session-timeout-warning'), null);
  controller.stop();
  assert.equal(windowObject.__ucvmSessionGuard, undefined);
  const restarted = start(auth, { window: windowObject, document: doc });
  assert.notEqual(restarted, controller);
  restarted.stop();
});

// ---------------------------------------------------------------------------
// Adversarial hardening regressions
// ---------------------------------------------------------------------------

function listenerDocument() {
  const { doc, previous } = warningDocument();
  const listeners = new Map();
  doc.visibilityState = 'visible';
  doc.addEventListener = (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
  };
  doc.removeEventListener = (name, fn) => {
    const list = listeners.get(name) || [];
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  };
  return { doc, previous, listeners, dispatch: name => (listeners.get(name) || []).slice().forEach(fn => fn()) };
}

function guardHarness({ activity = Date.now(), documentObject = null } = {}) {
  const { constants } = loadGuard();
  const calls = { signOut: 0, intervals: 0, cleared: 0 };
  const listeners = new Map();
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  if (activity !== null) localStorage.setItem(constants.ACTIVITY_KEY, String(activity));
  const doc = documentObject || listenerDocument().doc;
  const windowObject = {
    document: doc,
    localStorage,
    sessionStorage,
    performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    location: { pathname: '/index.html', replace() {} },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    removeEventListener(name, fn) {
      const list = listeners.get(name) || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    setInterval() { calls.intervals += 1; return 1; },
    clearInterval() { calls.cleared += 1; },
  };
  const auth = {
    currentUser: { uid: 'u1' },
    signOut: async () => { calls.signOut += 1; },
  };
  return { windowObject, doc, auth, calls, listeners, constants, localStorage };
}

test('an already-expired idle period is enforced at start, not after the first interval', () => {
  const { start, constants } = loadGuard();
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  const harness = guardHarness({ activity: twoHoursAgo });
  // Activity during the first interval window must not resurrect an expired session.
  const controller = start(harness.auth, { window: harness.windowObject, document: harness.doc });
  assert.equal(harness.calls.signOut, 1, 'signOut must fire immediately when the idle period already elapsed');
  controller.stop();
});

test('a visibility change re-evaluates idle state immediately instead of waiting for a throttled interval', () => {
  const { start, constants } = loadGuard();
  const harness = guardHarness({ activity: Date.now(), documentObject: listenerDocument().doc });
  const { doc, listeners } = (() => {
    const built = listenerDocument();
    harness.windowObject.document = built.doc;
    harness.doc = built.doc;
    return built;
  })();
  const controller = start(harness.auth, { window: harness.windowObject, document: doc });
  assert.equal(harness.calls.signOut, 0, 'no sign-out while the session is fresh');
  assert.ok((listeners.get('visibilitychange') || []).length === 1, 'visibilitychange must be registered');
  // Simulate a laptop sleeping well past the timeout, then waking.
  harness.localStorage.setItem(constants.ACTIVITY_KEY, String(Date.now() - 2 * 60 * 60 * 1000));
  (listeners.get('visibilitychange') || []).slice().forEach(fn => fn());
  assert.equal(harness.calls.signOut, 1, 'waking must enforce the timeout without waiting for the next interval');
  controller.stop();
});

test('timeout invokes signOut exactly once even when the idle check runs repeatedly', () => {
  const { start, constants } = loadGuard();
  const harness = guardHarness({ activity: Date.now() - 2 * 60 * 60 * 1000 });
  const controller = start(harness.auth, { window: harness.windowObject, document: harness.doc });
  controller.checkIdle();
  controller.checkIdle();
  controller.checkIdle();
  assert.equal(harness.calls.signOut, 1, 'signOut must not be invoked repeatedly');
  controller.stop();
});

test('stop then start leaves no duplicate timers, activity listeners or visibility listeners', () => {
  const { start } = loadGuard();
  const built = listenerDocument();
  const harness = guardHarness({ documentObject: built.doc });
  const first = start(harness.auth, { window: harness.windowObject, document: built.doc });
  first.stop();
  const second = start(harness.auth, { window: harness.windowObject, document: built.doc });
  for (const name of ['pointerdown', 'keydown', 'touchstart', 'scroll', 'storage']) {
    assert.equal((harness.listeners.get(name) || []).length, 1, `${name} must have exactly one listener after restart`);
  }
  assert.equal((built.listeners.get('visibilitychange') || []).length, 1, 'visibilitychange must have exactly one listener after restart');
  assert.equal(harness.calls.intervals, 2, 'exactly one interval per start');
  assert.equal(harness.calls.cleared, 1, 'the previous interval must have been cleared');
  second.stop();
  assert.equal((harness.listeners.get('keydown') || []).length, 0, 'stop must remove activity listeners');
  assert.equal((built.listeners.get('visibilitychange') || []).length, 0, 'stop must remove the visibility listener');
});

test('hiding a warning whose previous focus element is gone still removes it without throwing', () => {
  const { showIdleWarning, hideIdleWarning } = loadGuard();
  const { doc, previous } = warningDocument();
  const warning = showIdleWarning(doc, 5 * 60 * 1000, () => {});
  assert.ok(doc.getElementById('ucvm-session-timeout-warning'));
  // Simulate the previously focused element being removed from the document.
  previous.focus = undefined;
  assert.doesNotThrow(() => hideIdleWarning(doc));
  assert.equal(doc.getElementById('ucvm-session-timeout-warning'), null);
  assert.equal(warning.removed, true);
});

test('warning cycles repeat without duplicating the DOM node', () => {
  const { showIdleWarning, hideIdleWarning } = loadGuard();
  const { doc } = warningDocument();
  const first = showIdleWarning(doc, 5 * 60 * 1000, () => {});
  assert.match(first.querySelector('[data-ucvm-session-countdown]').textContent, /about 5 minutes/);
  // Re-showing while it is already present must refresh the countdown, not clone it.
  const same = showIdleWarning(doc, 60_000, () => {});
  assert.equal(same, first, 're-showing must reuse the existing node');
  assert.match(same.querySelector('[data-ucvm-session-countdown]').textContent, /about 1 minute/);
  // Dismiss, then warn again: a fresh node appears.
  assert.equal(hideIdleWarning(doc), true);
  assert.equal(doc.getElementById('ucvm-session-timeout-warning'), null);
  const again = showIdleWarning(doc, 2 * 60 * 1000, () => {});
  assert.notEqual(again, first);
  assert.ok(doc.getElementById('ucvm-session-timeout-warning'));
  assert.match(again.querySelector('[data-ucvm-session-countdown]').textContent, /about 2 minutes/);
});
