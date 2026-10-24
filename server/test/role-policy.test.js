'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeBaseRole,
  isAdministratorRole,
  isGeneralRole,
  isSelfServiceRole,
  isSupportedRole
} = require('../src/auth/role-policy');

test('developer is a supported first-class administrator and high-trust role', () => {
  assert.equal(normalizeBaseRole(' Developer '), 'developer');
  assert.equal(isSupportedRole('developer'), true);
  assert.equal(isAdministratorRole('developer'), true);
  assert.equal(isGeneralRole('developer'), true);
  assert.equal(isSelfServiceRole('developer'), false);
});

test('legacy administrator aliases normalize without promoting regular administrators', () => {
  assert.equal(normalizeBaseRole('owner'), 'adfa_general');
  assert.equal(normalizeBaseRole('adfa_general'), 'adfa_general');
  assert.equal(normalizeBaseRole('administrator'), 'adfa_regular');
  assert.equal(normalizeBaseRole('admin'), 'adfa_regular');
  assert.equal(normalizeBaseRole('adfa_regular'), 'adfa_regular');
  assert.equal(isAdministratorRole('adfa_regular'), true);
  assert.equal(isGeneralRole('adfa_regular'), false);
});

test('faculty-facing roles stay self-service and unknown roles fail closed', () => {
  for (const role of ['faculty', 'hicc', 'visc']) {
    assert.equal(isSupportedRole(role), true, role);
    assert.equal(isSelfServiceRole(role), true, role);
    assert.equal(isAdministratorRole(role), false, role);
    assert.equal(isGeneralRole(role), false, role);
  }
  // `other_office` is a real identity in this repository but carries no business
  // capability in the ported APIs. `isSupportedRole` is used as the authorization
  // predicate by those APIs, so recognising the role would GRANT it access. It
  // therefore stays unsupported and fails closed. See role-policy.js header note.
  for (const role of ['other_office', 'viewer', 'editor', 'unknown_role', '']) {
    assert.equal(isSupportedRole(role), false, role);
    assert.equal(isAdministratorRole(role), false, role);
    assert.equal(isGeneralRole(role), false, role);
  }
});
