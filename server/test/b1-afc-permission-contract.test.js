'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  b1Permissions,
  evaluateContract,
  evaluatePublicContract,
  postB1Contract,
  preB1Contract
} = require('./fixtures/b1r2-permission-contract');

const root = path.join(__dirname, '..', '..');
const permissionsPath = path.join(root, 'database', 'azure-sql', '007_afc_manual_write_permissions.sql');
const proofPath = path.join(root, 'database', 'azure-sql', '007_afc_manual_write_least_privilege_proof.sql');

test('B1R2 SQL declares a normalized allowlist and verifies an exact post-state', () => {
  for (const source of [fs.readFileSync(permissionsPath, 'utf8'), fs.readFileSync(proofPath, 'utf8')]) {
    assert.match(source, /DECLARE\s+@(?:PreB1|PostB1|Allowed).*TABLE/i);
    assert.match(source, /@ActualPermissions/i);
    assert.match(source, /minor_id/i);
    assert.match(source, /EXCEPT/i);
    assert.match(source, /state\s*=\s*N?'W'/i);
  }
});

test('normalized fixtures accept the valid pre-B1 contract and idempotent post-B1 contract', () => {
  assert.equal(evaluateContract(preB1Contract, preB1Contract).ok, true);
  assert.equal(evaluateContract(postB1Contract, postB1Contract).ok, true);
  assert.equal(evaluateContract(preB1Contract, postB1Contract).ok, false);
});

test('legitimate class=1 SELECT and class=3 DENY rows are not database-level violations', () => {
  const result = evaluateContract(preB1Contract, preB1Contract);
  assert.equal(result.ok, true);
  assert.equal(result.unexpected.length, 0);
  assert.equal(result.missing.length, 0);
});

test('invalid permission fixtures fail the exact allowlist', () => {
  const invalidRows = [
    ['unexpected database grant', { class: 0, state: 'G', permission: 'CONTROL', schema: null, object: null, column: null, scope: 'DATABASE' }],
    ['schema SELECT', { class: 3, state: 'G', permission: 'SELECT', schema: 'paws', object: null, column: null, scope: 'SCHEMA' }],
    ['full Faculty SELECT', { class: 1, state: 'G', permission: 'SELECT', schema: 'paws', object: 'Faculty', column: null, scope: 'OBJECT' }],
    ['Faculty provenance column', { class: 1, state: 'G', permission: 'SELECT', schema: 'paws', object: 'Faculty', column: 'SourceImportBatchId', scope: 'COLUMN' }],
    ['AfcManualRecord SELECT', { class: 1, state: 'G', permission: 'SELECT', schema: 'paws', object: 'AfcManualRecord', column: null, scope: 'OBJECT' }],
    ['AuditEvent SELECT', { class: 1, state: 'G', permission: 'SELECT', schema: 'paws', object: 'AuditEvent', column: null, scope: 'OBJECT' }],
    ['extra procedure EXECUTE', { class: 1, state: 'G', permission: 'EXECUTE', schema: 'paws_api', object: 'OtherProcedure', column: null, scope: 'OBJECT' }],
    ['schema-wide paws_api EXECUTE', { class: 3, state: 'G', permission: 'EXECUTE', schema: 'paws_api', object: null, column: null, scope: 'SCHEMA' }],
    ['view SELECT with grant option', { class: 1, state: 'W', permission: 'SELECT', schema: 'paws', object: 'vAfcRecordUnified', column: null, scope: 'OBJECT' }],
    ['procedure EXECUTE with grant option', { class: 1, state: 'W', permission: 'EXECUTE', schema: 'paws_api', object: 'CreateAfcRecord', column: null, scope: 'OBJECT' }],
    ['unexpected object permission type', { class: 1, state: 'G', permission: 'REFERENCES', schema: 'paws', object: 'Faculty', column: null, scope: 'OBJECT' }]
  ];

  for (const [name, row] of invalidRows) {
    assert.equal(evaluateContract([...postB1Contract, row], postB1Contract).ok, false, name);
  }
  assert.equal(evaluateContract(postB1Contract.filter(row => !(row.class === 3 && row.schema === 'paws' && row.permission === 'EXECUTE')), postB1Contract).ok, false, 'missing paws DENY');
  assert.equal(evaluateContract(postB1Contract.filter(row => !(row.class === 3 && row.schema === 'staging' && row.permission === 'SELECT')), postB1Contract).ok, false, 'missing staging DENY');
  assert.equal(evaluatePublicContract([{ class: 3, state: 'G', permission: 'SELECT', schema: 'paws', object: null, column: null, scope: 'SCHEMA', grantee: 'public' }]).ok, false, 'public schema broadening fixture');
  assert.equal(evaluatePublicContract([{ class: 1, state: 'W', permission: 'SELECT', schema: 'paws_api', object: 'CreateAfcRecord', column: null, scope: 'OBJECT', grantee: 'public' }]).ok, false, 'public object broadening fixture');
});

test('B1 grants are exactly the unified view SELECT and procedure EXECUTE', () => {
  assert.deepEqual(b1Permissions, [
    { class: 1, state: 'G', permission: 'SELECT', schema: 'paws', object: 'vAfcRecordUnified', column: null, scope: 'OBJECT' },
    { class: 1, state: 'G', permission: 'EXECUTE', schema: 'paws_api', object: 'CreateAfcRecord', column: null, scope: 'OBJECT' }
  ]);
});
