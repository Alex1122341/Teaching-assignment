'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(root, 'database/azure-sql/025_auth1_developer_role_authorization.sql'), 'utf8');

test('AUTH-1 SQL role migration targets every active admin policy boundary', () => {
  for (const object of [
    'RecommendAfcRequest', 'RejectAfcRequest', 'ApproveAfcRequest',
    'CreateOrGetApprovedAfcArtifact', 'GetApprovedAfcArtifact',
    'CanActOnTeachingAssignmentPackage', 'UpdateFaculty', 'DeactivateFaculty', 'RestoreFaculty'
  ]) {
    assert.match(migration, new RegExp(`paws_api\\.${object}`), object);
  }
  assert.match(migration, /N''developer''/);
  assert.match(migration, /@ExistingCount\s*<>\s*1/);
  assert.match(migration, /@DeveloperCount\s*<>\s*0/);
  assert.match(migration, /BEGIN TRANSACTION[\s\S]*COMMIT TRANSACTION/);
  assert.match(migration, /IF XACT_STATE\(\) <> 0 ROLLBACK TRANSACTION/);
});

test('AUTH-1 SQL migration is idempotent and fails closed on unexpected module drift', () => {
  assert.match(migration, /IF @DeveloperCount = 1 AND @ExistingCount = 0[\s\S]*CONTINUE;/);
  assert.match(migration, /An AUTH-1 SQL authorization predicate differs from its reviewed baseline/);
  assert.match(migration, /DB_NAME\(\) <> N'VetMed-Ops'/);
  assert.match(migration, /OBJECT_ID\(N'paws\.UserProfile', N'U'\)/);
  assert.doesNotMatch(migration, /CREATE\s+TABLE\s+paws\./i);
  assert.doesNotMatch(migration, /\bGRANT\s+/i);
  assert.doesNotMatch(migration, /\bUPDATE\s+paws\.UserProfile\b/i);
});

test('AUTH-1 SQL migration normalizes whitespace in inspected module headers', () => {
  assert.match(migration, /SET @Header = UPPER\(LTRIM\(REPLACE\(REPLACE\(REPLACE\(LEFT\(@Definition, 200\)/);
  assert.match(migration, /WHILE CHARINDEX\(N'  ', @Header\) > 0/);
  assert.match(migration, /LEFT\(@Header, 16\) = N'CREATE PROCEDURE'/);
  assert.match(migration, /LEFT\(@Header, 15\) = N'CREATE FUNCTION'/);
});
