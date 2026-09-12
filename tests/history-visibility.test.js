const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('only ADFA administrators can see everyone history', () => {
  const {historyAll} = require('../functions/policy');
  assert.equal(historyAll({role:'adfa_general'}), true);
  assert.equal(historyAll({role:'adfa_regular'}), true);
  assert.equal(historyAll({role:'owner'}), true);
  assert.equal(historyAll({role:'administrator'}), true);
  assert.equal(historyAll({role:'other_office'}), false);
  assert.equal(historyAll({role:'faculty'}), false);
});

test('self-only history queries filter every collection by actor uid', () => {
  const source = read('faculty-access.js');
  assert.match(source, /historyAll/);
  assert.match(source, /where\('changedBy','==',user\.uid\)/);
  assert.match(source, /account_audit/);
});

test('Firestore history rules distinguish ADFA administrators from Other Office', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /function historyAll\(\)/);
  assert.match(rules, /historyAll\(\) \|\| resource\.data\.changedBy == request\.auth\.uid/);
});
