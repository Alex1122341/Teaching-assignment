const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('timetable exposes AFC navigation and loads its scripts in dependency order', () => {
  const html = read('index.html');
  for (const id of ['my-teaching-btn', 'afc-request-btn', 'my-change-history-btn', 'afc-panel']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const actions = html.indexOf('afc-actions.js');
  const closures = html.indexOf('university-closures.js');
  const timetable = html.indexOf('timetable.js');
  const workflow = html.indexOf('afc-workflow.js');
  const panel = html.indexOf('afc-timetable-panel.js');
  assert.ok(actions >= 0 && actions < workflow, 'AFC actions load before the workflow');
  assert.ok(closures >= 0 && closures < timetable, 'University closures load before timetable');
  assert.ok(closures < workflow, 'University closures load before AFC workflow');
  assert.ok(workflow < panel, 'AFC workflow loads before the timetable panel');

  const loader = read('asset-loader.js');
  const bundles = JSON.parse(read('tools/runtime-bundles.json'));
  const lazy = bundles.lazyBundles.find(bundle => bundle.output === 'bundles/afc-pdf.lazy.bundle.js');
  assert.deepEqual(lazy.sources, ['afc-form-values.js','afc-pdf-browser.js']);
  assert.match(loader, /loadScriptOnce\('bundles\/afc-pdf\.lazy\.bundle\.js','UCVM_AFC_PDF'\)/);
});

test('AFC runtime delegates workday policy to the shared University closure calendar',()=>{
  const source=read('afc-workflow.js');
  assert.match(source,/UCVM_UNIVERSITY_CLOSURES/);
  assert.match(source,/countWorkingDays/);
  assert.doesNotMatch(source,/const holidays=new Set/);
});

test('AFC timetable mount subscribes once and renders teaching sessions as sorted rows', () => {
  let subscriptions = 0;
  const listeners = new Map();
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Blob,
    URL,
    Uint8Array,
    FormData: class {},
    document: { getElementById: () => null, createElement: () => ({}) },
    addEventListener: (name, callback) => listeners.set(name, callback),
    firebase: {
      auth: () => ({ currentUser: null }),
      firestore: { FieldValue: { serverTimestamp: () => 'timestamp' } }
    },
    UCVM: {
      esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
      init: () => ({ db: {} }),
      role: value => value
    }
  };
  context.window = context;
  context.window.UCVM_PAGE_DATA = {
    profile: () => ({ role: 'faculty' }),
    faculty: () => ({ id: 'f1' }),
    sessions: () => [],
    ensureSessionsForRange: async () => [],
    subscribe: () => { subscriptions += 1; return () => {}; }
  };

  vm.runInNewContext(read('university-closures.js'), context);
  vm.runInNewContext(read('afc-workflow.js'), context);
  context.window.UCVM_AFC.mount({ panelId: 'afc-panel-content', mode: 'timetable' });
  context.window.UCVM_AFC.mount({ panelId: 'afc-panel-content', mode: 'timetable' });
  assert.equal(subscriptions, 1, 'mounting the AFC view must not create a second page-data subscription');

  const output = context.window.UCVM_AFC.teachingListHtml([
    { date: '2026-10-08', start: '09:30', end: '10:30', course: 'VETM 305', topic: 'Zebra' },
    { date: '2026-10-07', start: '10:30', end: '11:30', course: 'VETM 204', topic: 'Later' },
    { date: '2026-10-07', start: '08:30', end: '09:30', course: 'VETM 204', topic: 'Passports 1' }
  ]);
  assert.match(output, /^<ul class="afc-teaching-list">/);
  assert.equal((output.match(/<li>/g) || []).length, 3);
  assert.match(output, /<li><time>2026-10-07<\/time><span>08:30-09:30<\/span><strong>VETM 204<\/strong><span>Passports 1<\/span><\/li>/);
  assert.ok(output.indexOf('Passports 1') < output.indexOf('Later'));
  assert.ok(output.indexOf('Later') < output.indexOf('Zebra'));
});

function submissionHarness(ensureSessionsForRange, initialSessions = []) {
  let sessions = initialSessions;
  const form = { values: {
    startDate: '2026-10-07', endDate: '2026-10-07', reason: 'vacation',
    purposeDestination: '', coverage: '', contactAddress: '2500 University Drive NW', contactPhone: '403-555-1212', termsAccepted: 'on'
  } };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Blob,
    URL,
    Uint8Array,
    FormData: class { constructor(target) { this.values = target.values; } get(name) { return this.values[name] || ''; } },
    document: { getElementById: () => null, createElement: () => ({}) },
    addEventListener() {},
    firebase: {
      auth: () => ({ currentUser: { uid: 'faculty-user', email: 'faculty@ucalgary.ca' } }),
      firestore: { FieldValue: { serverTimestamp: () => 'timestamp' } }
    },
    UCVM: {
      esc: value => String(value),
      init: () => ({ db: {} }),
      role: value => value
    }
  };
  context.window = context;
  context.window.UCVM_PAGE_DATA = {
    profile: () => ({ role: 'faculty', facultyId: 'f1', name: 'Faculty One' }),
    faculty: () => ({ id: 'f1', ucid: 'f1', preferredFullName: 'Faculty One' }),
    sessions: () => sessions,
    ensureSessionsForRange: async (start, end) => {
      const loaded = await ensureSessionsForRange(start, end);
      if (loaded) sessions = loaded;
      return loaded;
    },
    subscribe: () => () => {}
  };
  vm.runInNewContext(read('university-closures.js'), context);
  vm.runInNewContext(read('afc-workflow.js'), context);
  context.window.UCVM_AFC.mount({ panelId: 'afc-panel-content', mode: 'timetable' });
  return { api: context.window.UCVM_AFC, form };
}

test('AFC submission waits for the submitted range before enforcing teaching coverage', async () => {
  let resolveRange;
  let requestedRange;
  const delayed = new Promise(resolve => { resolveRange = resolve; });
  const { api, form } = submissionHarness((start, end) => {
    requestedRange = [start, end];
    return delayed;
  });

  const submission = api.submit(form);
  let settled = false;
  submission.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, 'submission remains pending while the exact range loads');
  assert.deepEqual(requestedRange, ['2026-10-07', '2026-10-07']);

  resolveRange([{ id: 's1', date: '2026-10-07', start: '08:30', end: '09:30', course: 'VETM 204', topic: 'Passports 1', assignments: [{ ucid: 'f1' }] }]);
  await assert.rejects(submission, /Coverage is required because teaching assignments were found/);
});

test('AFC submission reports a rejected timetable range read and does not use stale sessions', async () => {
  const stale = [{ id: 'stale', date: '2026-10-07', start: '08:30', end: '09:30', course: 'VETM 204', topic: 'Old result', assignments: [{ ucid: 'f1' }] }];
  const { api, form } = submissionHarness(async () => { throw new Error('Range unavailable'); }, stale);
  await assert.rejects(api.submit(form), /Teaching assignments could not be loaded: Range unavailable/);
});

test('timetable AFC panel opens requests, shows self-filtered history, and restores teaching', () => {
  const events = [];
  const elements = new Map();
  let documentRef;
  const element = id => {
    const value = {
      id,
      hidden: id === 'afc-panel',
      attributes: {},
      classList: { toggle() {} },
      setAttribute(name, setting) { this.attributes[name] = setting; },
      focus() { this.focused = true; documentRef.activeElement = this; }
    };
    elements.set(id, value);
    return value;
  };
  for (const id of ['my-teaching-btn', 'afc-request-btn', 'my-change-history-btn', 'afc-panel', 'afc-panel-content', 'afc-panel-title', 'afc-panel-close']) element(id);
  const formField = element('afc-start-date');
  const submitButton = element('afc-submit');
  const background = { inert: false };
  const alreadyInert = { inert: true };
  elements.get('afc-panel').querySelectorAll = () => [elements.get('afc-panel-close'), formField, submitButton];
  elements.get('afc-panel').contains = target => [elements.get('afc-panel-close'), formField, submitButton].includes(target);
  let mounts = 0;
  let historyOptions = null;
  let keydown;
  documentRef = {
    getElementById: id => elements.get(id) || null,
    activeElement: elements.get('afc-request-btn'),
    body: { children: [background, elements.get('afc-panel'), alreadyInert] },
    addEventListener: (name, callback) => { if (name === 'keydown') keydown = callback; }
  };
  const context = {
    window: null,
    document: documentRef,
    Event: class { constructor(type) { this.type = type; } },
    dispatchEvent: event => events.push(event),
    addEventListener() {},
    UCVM: { logs: (_target, options) => { historyOptions = options; } }
  };
  context.window = context;
  context.window.UCVM_PAGE_DATA = { profile: () => ({ uid: 'faculty-1', role: 'faculty' }) };
  context.window.UCVM_AFC = { mount: options => { mounts += 1; context.mountOptions = options; } };

  vm.runInNewContext(read('afc-timetable-panel.js'), context);
  assert.equal(mounts, 1);
  assert.equal(context.mountOptions.panelId, 'afc-panel-content');
  assert.equal(context.mountOptions.mode, 'timetable');

  elements.get('afc-request-btn').onclick();
  assert.equal(elements.get('afc-panel').hidden, false);
  assert.equal(background.inert, true);
  assert.equal(alreadyInert.inert, true);
  assert.ok(events.some(event => event.type === 'ucvm:afc-open'));
  assert.equal(events.find(event => event.type === 'ucvm:afc-open').ucvmForce, true);

  documentRef.activeElement = submitButton;
  const forwardTab = { key: 'Tab', shiftKey: false, preventDefault() { this.prevented = true; } };
  keydown(forwardTab);
  assert.equal(forwardTab.prevented, true);
  assert.equal(documentRef.activeElement, elements.get('afc-panel-close'));

  const reverseTab = { key: 'Tab', shiftKey: true, preventDefault() { this.prevented = true; } };
  keydown(reverseTab);
  assert.equal(reverseTab.prevented, true);
  assert.equal(documentRef.activeElement, submitButton);

  elements.get('my-change-history-btn').onclick();
  assert.equal(historyOptions.includeFaculty, true);
  assert.equal(historyOptions.profile.uid, 'faculty-1');
  assert.equal(historyOptions.profile.role, 'faculty');

  elements.get('my-teaching-btn').onclick();
  assert.equal(elements.get('afc-panel').hidden, true);
  assert.equal(background.inert, false);
  assert.equal(alreadyInert.inert, true);
  assert.equal(documentRef.activeElement, elements.get('afc-request-btn'));
  assert.ok(events.some(event => event.type === 'ucvm:show-teaching'));
});

test('AFC focus trap cycles only through visible controls when the request details are collapsed', () => {
  let documentRef;
  let keydown;
  const makeElement = (id, { tagName = 'BUTTON', visible = true, hiddenByDetails = false } = {}) => ({
    id,
    tagName,
    hidden: id === 'afc-panel',
    inert: false,
    tabIndex: 0,
    classList: { toggle() {} },
    setAttribute() {},
    getClientRects: () => visible ? [{}] : [],
    closest: selector => selector === 'details:not([open])' && hiddenByDetails ? {} : null,
    focus() { documentRef.activeElement = this; }
  });
  const elements = new Map();
  const add = (id, options) => { const item = makeElement(id, options); elements.set(id, item); return item; };
  const teaching = add('my-teaching-btn');
  const request = add('afc-request-btn');
  const history = add('my-change-history-btn');
  const panel = add('afc-panel');
  add('afc-panel-content');
  add('afc-panel-title');
  const close = add('afc-panel-close');
  const summary = add('afc-summary', { tagName: 'SUMMARY' });
  const hiddenInput = add('afc-start-date', { tagName: 'INPUT', visible: false, hiddenByDetails: true });
  const hiddenSubmit = add('afc-submit', { visible: false, hiddenByDetails: true });
  panel.querySelectorAll = selector => [close, ...(selector.includes('summary') ? [summary] : []), hiddenInput, hiddenSubmit];
  panel.contains = target => [close, summary, hiddenInput, hiddenSubmit].includes(target);
  documentRef = {
    getElementById: id => elements.get(id) || null,
    activeElement: request,
    body: { children: [panel] },
    addEventListener: (name, callback) => { if (name === 'keydown') keydown = callback; }
  };
  const context = {
    window: null,
    document: documentRef,
    Event: class { constructor(type) { this.type = type; } },
    dispatchEvent() {},
    addEventListener() {},
    UCVM: { logs() {} }
  };
  context.window = context;
  context.window.UCVM_PAGE_DATA = { profile: () => ({ role: 'faculty' }) };
  context.window.UCVM_AFC = { mount() {} };
  vm.runInNewContext(read('afc-timetable-panel.js'), context);

  request.onclick();
  documentRef.activeElement = summary;
  const forward = { key: 'Tab', shiftKey: false, preventDefault() { this.prevented = true; } };
  keydown(forward);
  assert.equal(forward.prevented, true);
  assert.equal(documentRef.activeElement, close);

  const reverse = { key: 'Tab', shiftKey: true, preventDefault() { this.prevented = true; } };
  keydown(reverse);
  assert.equal(reverse.prevented, true);
  assert.equal(documentRef.activeElement, summary);

  teaching.onclick();
  assert.equal(panel.hidden, true);
  assert.equal(documentRef.activeElement, request);
  assert.equal(history.inert, false);
});
