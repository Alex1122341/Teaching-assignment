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

test('My Change History is relationship-scoped rather than actor-only', () => {
  const source = read('faculty-access.js');
  assert.match(source, /personalOnly=false/);
  assert.match(source, /session_change_log','session','changedBy'/);
  assert.match(source, /session_change_log','session','sessionId'/);
  assert.match(source, /faculty_change_log','faculty','facultyId'/);
  assert.match(source, /account_audit','account','targetUid'/);
  assert.match(source, /afc_audit','afc','requesterUid'/);
  assert.match(source, /afc_audit','afc','reportToUid'/);
  assert.match(source, /change_request_audit','workflow','changedBy'/);
  assert.match(source, /sessions, AFC and changes related to you/);
});

test('personal timetable panel explicitly requests personal rather than admin-wide history', () => {
  const source = read('afc-timetable-panel.js');
  assert.match(source, /UCVM\.logs\(content,[\s\S]*personalOnly:\s*true/);
});

test('Firestore personal history rules include actor, linked session, faculty, account, AFC and workflow relationships', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /function sessionHistoryReader\(d\)/);
  assert.match(rules, /exists\(sessionPath\(sid\)\)/);
  assert.match(rules, /get\(sessionPath\(sid\)\)\.data\.facultyIds/);
  assert.match(rules, /function facultyHistoryReader\(d\)/);
  assert.match(rules, /function accountHistoryReader\(d\)/);
  assert.match(rules, /function afcHistoryReader\(d\)/);
  assert.match(rules, /match \/change_request_audit\/\{id\}[\s\S]*historyActor\(resource\.data\)/);
});

test('restricted office personal session history remains sanitized', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /function safeOfficeSessionHistory\(d\)/);
  assert.match(rules, /!restrictedOffice\(\) \|\| safeOfficeSessionHistory\(d\)/);
  assert.match(rules, /studentIds.*studentNames.*roster.*rosters.*assignments.*facultyIds/);
});
