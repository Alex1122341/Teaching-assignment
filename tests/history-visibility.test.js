const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('only ADFA administrators can see everyone history', () => {
  const {historyAll} = require('../test-support/policy');
  assert.equal(historyAll({role:'adfa_general'}), true);
  assert.equal(historyAll({role:'adfa_regular'}), true);
  assert.equal(historyAll({role:'owner'}), true);
  assert.equal(historyAll({role:'administrator'}), true);
  assert.equal(historyAll({role:'other_office'}), false);
  assert.equal(historyAll({role:'faculty'}), false);
});

test('timetable My Changes forces self-only scope even for administrators', () => {
  const panel = read('afc-timetable-panel.js');
  assert.match(panel, /UCVM\.logs\(content,[\s\S]*?scope:\s*'self'/);
  const access = read('faculty-access.js');
  assert.match(access, /selfOnly=scope==='self'/);
  assert.match(access, /canReadAll=!selfOnly&&historyAll\(profile\)/);
});

test('self history aggregates actor account AFC request and related teaching records', () => {
  const source = read('faculty-access.js');
  assert.match(source, /where\('changedBy','==',user\.uid\)/);
  assert.match(source, /queryField\('account_audit','targetUid',uid,'account'\)/);
  assert.match(source, /queryField\('afc_audit',field,uid,'afc'\)/);
  assert.match(source, /queryField\('change_request_audit','changedBy',uid,'request'\)/);
  assert.match(source, /where\('requesterUid','==',uid\)/);
  assert.match(source, /queryField\('session_change_log','relatedFacultyIds',facultyId,'session','array-contains'\)/);
  assert.match(source, /action:\`request_\$\{request\.status\|\|'changed'\}\`/);
  assert.match(source, /queryField\('faculty_change_log','facultyId',facultyId,'faculty'\)/);
});

test('Firestore self history permits own actors and related records without granting global history', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /function historyAll\(\)/);
  assert.match(rules, /function historyReader\(d\)\{return historyAll\(\) \|\| \(ready\(\) && d\.changedBy == request\.auth\.uid\);\}/);
  assert.match(rules, /function selfSessionHistory\(d\)[\s\S]*relatedFacultyIds/);
  assert.match(rules, /function selfFacultyHistory\(d\)/);
  assert.match(rules, /resource\.data\.targetUid == request\.auth\.uid/);
  assert.match(rules, /match \/afc_audit\/\{id\} \{allow read: if ready\(\)/);
  assert.match(rules, /match \/change_request_audit\/\{id\}[\s\S]*resource\.data\.changedBy == request\.auth\.uid/);
});
