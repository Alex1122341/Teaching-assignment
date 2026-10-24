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
  // Deliberate divergence from the Beta source.
  //
  // Beta's policy returns null for `other_office`, `editor` and `viewer`. That
  // contradicts Beta's own AGENTS.md, which lists `other_office` as a formal
  // role, and it would silently demote every such account to "no role" in this
  // repository, which issues all three. They are therefore recognised inputs
  // here, while still holding no administrator or general capability.
  // See docs/migration/phase-a-foundation.md sections 3.1 and 3.2.
  for (const role of ['other_office', 'viewer', 'editor']) {
    assert.equal(isSupportedRole(role), true, role);
    assert.equal(isAdministratorRole(role), false, role);
    assert.equal(isGeneralRole(role), false, role);
  }
  for (const role of ['unknown_role', '']) {
    assert.equal(isSupportedRole(role), false, role);
    assert.equal(isAdministratorRole(role), false, role);
    assert.equal(isGeneralRole(role), false, role);
  }
});
