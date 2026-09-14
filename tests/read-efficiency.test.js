const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Firestore persistence is enabled through the shared initializer', () => {
  const source = read('faculty-access.js');
  assert.match(source, /enablePersistence\(\{\s*synchronizeTabs:\s*true\s*\}\)/);
});

test('the main timetable shares visible snapshots and the profile read with the approval workflow', () => {
  const page = read('timetable.js');
  const workflow = read('approval-workflow.js');
  assert.match(page, /UCVM_PAGE_DATA/);
  assert.match(page, /ucvm:sessions-updated/);
  assert.match(page, /ucvm:faculty-updated/);
  assert.match(page, /profileSnapshot/);
  assert.match(workflow, /UCVM_PAGE_DATA/);
  assert.match(workflow, /UCVM_PAGE_DATA\?\.profileSnapshot/);
  assert.doesNotMatch(workflow, /async function loadPeopleOnce/);
});

test('authenticated pages reuse the profile read when starting the role watcher', () => {
  for (const name of ['faculty-dashboard.js', 'user-management.js']) {
    const source = read(name);
    const reads = source.match(/db\.doc\(`users\/\$\{u\.uid\}`\)\.get\(\)/g) || [];
    assert.equal(reads.length, 1, `${name} should fetch the signed-in profile once`);
  }
});

test('the large auxiliary settings document is loaded only when the sessional tab is opened', () => {
  const source = read('faculty-admin.js');
  assert.match(source, /function loadAuxOnce/);
  assert.match(source, /tab==='sessional'.*loadAuxOnce\(\)/);
  assert.doesNotMatch(source, /subscribeAux\(\);subscribeSessions\(\)/);
});

test('the timetable subscribes only to the visible date range', () => {
  const source = read('timetable.js');
  assert.match(source, /where\('date','>=',range\.start\)/);
  assert.match(source, /where\('date','<=',range\.end\)/);
  assert.match(source, /where\('facultyIds','array-contains',facultyId\)/);
  assert.doesNotMatch(source, /db\.collection\(SESSION_COLLECTION\)\.onSnapshot/);
});

test('the timetable loads the faculty directory only when an admin tool needs it', () => {
  const source = read('timetable.js');
  assert.match(source, /function ensureFacultyDirectory/);
  assert.doesNotMatch(source, /if \(UCVM\.admin\(profile\)\) subscribeFacultyDirectory\(\)/);
});

test('faculty admin enhancements reuse the page snapshots', () => {
  const source = read('faculty-admin-enhancements.js');
  assert.match(source, /UCVM_ADMIN_DATA/);
  assert.doesNotMatch(source, /collection\('faculty'\)\.onSnapshot/);
  assert.doesNotMatch(source, /collection\('sessions'\)\.onSnapshot/);
  assert.doesNotMatch(source, /db\.doc\(`users\/\$\{u\.uid\}`\)\.get\(\)/);
});
