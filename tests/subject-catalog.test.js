'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../subject-catalog.js');

test('canonical key normalization is stable and bounded', () => {
  assert.equal(catalog.normalizeKey(' Surgery '), 'surgery');
  assert.equal(catalog.normalizeKey('surgery-core'), 'surgery-core');
  assert.equal(catalog.normalizeKey(' surgery '), catalog.normalizeKey('Surgery'));
  for (const input of ['', ' ', 'surgery core', 'surgery/core', 'surgery|core', 'a'.repeat(65), null, {}]) {
    assert.equal(catalog.normalizeKey(input), '', String(input));
  }
});

test('catalog record requires a matching document identity, label, and active flag', () => {
  assert.equal(catalog.validateRecord({key: 'surgery', label: 'Surgery', active: true}, 'surgery'), true);
  for (const [record, id] of [
    [{key: 'surgery', label: 'Surgery', active: true}, 'anesthesia'],
    [{key: '', label: 'Surgery', active: true}, 'surgery'],
    [{key: '', label: 'Surgery', active: true}, ''],
    [{key: 'surgery', label: ' ', active: true}, 'surgery'],
    [{key: 'surgery', label: 'Surgery', active: 'true'}, 'surgery'],
    [{key: 'surgery', label: 'Surgery', active: true, doeRate: 25}, 'surgery']
  ]) assert.throws(() => catalog.validateRecord(record, id));
});

test('active options ignore inactive, malformed, mismatched, duplicate, and Topic-only rows', () => {
  const rows = [
    {id: 'surgery', key: 'surgery', label: 'Surgery', active: true},
    {id: 'anesthesia', key: 'anesthesia', label: 'Anesthesia', active: false},
    {id: 'surgery', key: 'surgery', label: 'Surgery', active: true},
    {id: 'wrong', key: 'surgery', label: 'Wrong', active: true},
    {id: 'topic', topic: 'Surgery', label: 'Topic', active: true},
    {id: 'medicine', key: 'medicine', label: 'Medicine', active: true}
  ];
  assert.deepEqual(catalog.activeOptions(rows), [
    {key: 'medicine', label: 'Medicine'},
    {key: 'surgery', label: 'Surgery'}
  ]);
});
