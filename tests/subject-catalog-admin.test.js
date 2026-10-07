'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../subject-catalog-admin.js');

test('admin catalog drafts keep stable key identity and contain no DOE fields', () => {
  const stamp = {server: true};
  assert.deepEqual(admin.newRecord(' Surgery ', 'Surgery', 'owner', stamp), {
    key: 'surgery', label: 'Surgery', active: true, updatedBy: 'owner', updatedAt: stamp
  });
  assert.deepEqual(admin.updatedRecord({key: 'surgery', label: 'Surgery', active: true},
    'Surgical Medicine', false, 'owner', stamp), {
    key: 'surgery', label: 'Surgical Medicine', active: false, updatedBy: 'owner', updatedAt: stamp
  });
  assert.throws(() => admin.newRecord('surgery/other', 'Other', 'owner', stamp));
  assert.throws(() => admin.updatedRecord({key: 'surgery'}, ' ', true, 'owner', stamp));
});

test('only existing administrator roles see catalog management controls', () => {
  for (const role of ['developer','owner','administrator','admin','adfa_general','adfa_regular'])
    assert.equal(admin.canManage({role, active: true}), true, role);
  for (const role of ['adc','lab','hicc','visc','faculty','other_office'])
    assert.equal(admin.canManage({role, active: true}), false, role);
  assert.equal(admin.canManage({role: 'owner', active: false}), false);
});
