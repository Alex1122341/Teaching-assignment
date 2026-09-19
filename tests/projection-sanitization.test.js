'use strict';
// Guards the sanitized projections that ordinary faculty accounts are allowed to
// read. Firestore rules can pin a document envelope but cannot iterate a list,
// so the per-entry field allowlist is enforced in code and asserted here.
//
// Closes audit finding F13 (faculty_swap_index had no field allowlist) and
// supports F3 (the sanitized people index that replaces /users enumeration).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dataIndex = require(path.resolve(__dirname, '../data-index.js'));
const {buildDataset} = require(path.resolve(__dirname, '../tools/seed/dataset.js'));

const keyFactory = (() => {
  let n = 0;
  return () => `key-${String(++n).padStart(3, '0')}`;
})();

function facultyRow(overrides = {}) {
  return {
    __id: 'fac-900',
    firstName: 'Test',
    lastName: 'Person',
    active: true,
    awayFromCampusRecords: [{startDate: '2027-02-01', endDate: '2027-02-05', reason: 'private reason'}],
    ...overrides
  };
}

test('swap index entries contain only the allowlisted projection fields', () => {
  const built = dataIndex.buildFacultySwapIndexes([facultyRow()], {}, keyFactory);
  assert.equal(built.publicIndex.schemaVersion, 'ucvm-faculty-swap-index-v1');
  for (const entry of built.publicIndex.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['aliases', 'key', 'name', 'unavailableRanges']);
  }
});

test('swap index never carries an address, identifier, DOE value or availability reason', () => {
  const built = dataIndex.buildFacultySwapIndexes([
    facultyRow({
      email: 'private@example.test',
      ucid: '30009999',
      doe: 42,
      doeOverride2026_27: {value: 25, reason: 'RSL'},
      facultySummary2026_27: {assignedTeachingDOE: 12.5}
    })
  ], {}, keyFactory);
  const serialized = JSON.stringify(built.publicIndex);
  for (const secret of ['private@example.test', '30009999', 'RSL', '42', '12.5', 'private reason']) {
    assert.equal(serialized.includes(secret), false, `swap index leaked ${secret}`);
  }
  // Availability is reduced to coarse dates only.
  for (const entry of built.publicIndex.entries) {
    for (const range of entry.unavailableRanges) {
      assert.deepEqual(Object.keys(range).sort(), ['endDate', 'startDate']);
    }
  }
});

test('a swap entry with a field outside the projection is rejected rather than published', () => {
  const previousMap = {entries: []};
  // Force a private field into the entry by making the name look like an address.
  assert.throws(
    () => dataIndex.buildFacultySwapIndexes([facultyRow({firstName: 'a@b', lastName: 'c'})], previousMap, keyFactory),
    /sanitized projection/i
  );
});

test('the private swap map is the only place a faculty identifier appears', () => {
  const built = dataIndex.buildFacultySwapIndexes([facultyRow()], {}, keyFactory);
  assert.equal(built.privateMap.schemaVersion, 'ucvm-faculty-swap-map-v1');
  for (const entry of built.privateMap.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['facultyId', 'key']);
    assert.equal(entry.facultyId, 'fac-900');
  }
  // The key is opaque: it must not be the faculty identifier.
  assert.notEqual(built.privateMap.entries[0].key, built.privateMap.entries[0].facultyId);
});

test('seeded projections match the shapes the rules pin', () => {
  const dataset = buildDataset();
  const byPath = new Map(dataset.documents.map(document => [document.path, document.data]));

  const swap = byPath.get('settings/faculty_swap_index');
  assert.equal(swap.schemaVersion, 'ucvm-faculty-swap-index-v1');
  assert.deepEqual(Object.keys(swap).sort(), ['entries', 'generatedAt', 'schemaVersion']);
  for (const entry of swap.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['aliases', 'key', 'name', 'unavailableRanges']);
    for (const range of entry.unavailableRanges) {
      assert.deepEqual(Object.keys(range).sort(), ['endDate', 'startDate']);
    }
  }

  const people = byPath.get('settings/people_index');
  assert.equal(people.schemaVersion, 'ucvm-people-index-v1');
  assert.deepEqual(Object.keys(people).sort(), ['entries', 'generatedAt', 'schemaVersion']);
  for (const entry of people.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['aliases', 'facultyId', 'name', 'role', 'uid']);
    // The people projection exists so /users does not have to be listed; it must
    // never carry the fields that made listing /users a privacy problem.
    for (const forbidden of ['email', 'active', 'mustChangePassword', 'officeName', 'officeEmail', 'facultyRoles']) {
      assert.equal(forbidden in entry, false, `people_index leaked ${forbidden}`);
    }
  }
});

test('the seeded swap map resolves every published candidate key', () => {
  const dataset = buildDataset();
  const byPath = new Map(dataset.documents.map(document => [document.path, document.data]));
  const published = new Set(byPath.get('settings/faculty_swap_index').entries.map(entry => entry.key));
  const resolved = new Set(byPath.get('settings/faculty_swap_map').entries.map(entry => entry.key));
  assert.deepEqual([...published].sort(), [...resolved].sort());
});
