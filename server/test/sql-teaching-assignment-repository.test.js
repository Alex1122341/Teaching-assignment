'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSqlTeachingAssignmentRepository } = require('../foundation/sql-teaching-assignment-repository');

function capture() {
  let seen = [];
  const query = async (sql, params) => { seen.push({sql, params}); return []; };
  return {repository: createSqlTeachingAssignmentRepository({query}), seen};
}

test('repository exposes only read methods and parameterizes actor scope', async () => {
  const {repository, seen} = capture();
  await repository.getActorResponsibilities({facultyId: 'faculty-1', academicYear: '2026-27', asOfDate: '2026-09-08'});
  assert.equal(seen.length, 1);
  assert.match(seen[0].sql, /FROM paws\.TeachingResponsibility/);
  assert.match(seen[0].sql, /@facultyId/);
  assert.doesNotMatch(seen[0].sql, /faculty-1/);
  assert.deepEqual(seen[0].params, {facultyId: 'faculty-1', academicYear: '2026-27', asOfDate: '2026-09-08'});
});

test('repository methods read only paws authority objects and never staging', async () => {
  const {repository, seen} = capture();
  await repository.getResponsibility('r1');
  await repository.getResponsibilityScopes('r1');
  await repository.getResponsibilityAssignees('r1', '2026-27');
  await repository.getGroupsForResponsibility('r1');
  await repository.getPackage('2026-27', 'g1', 'r1');
  await repository.listPackagesForActor('faculty-1', '2026-27', '2026-09-08');
  await repository.getWorkingSessionOwnership('s1');
  await repository.getGroupHiccResponsibilities('g1');
  assert.equal(seen.length, 8);
  for (const row of seen) {
    assert.doesNotMatch(row.sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP)\b/i);
    assert.doesNotMatch(row.sql, /staging\./i);
    assert.doesNotMatch(row.sql, /\b(FirebaseUid|BaseRole)\b/i);
    assert.match(row.sql, /paws\./);
  }
});

test('repository/schema contract uses the canonical authority column names', async () => {
  const {repository, seen} = capture();
  await repository.getResponsibilityScopes('hicc-surgery');
  await repository.getResponsibilityAssignees('hicc-surgery', '2026-27');
  await repository.listPackagesForActor('faculty-1', '2026-27', '2026-09-08');
  await repository.getWorkingSessionOwnership('session-1');
  const migration = fs.readFileSync(path.join(__dirname, '../../database/azure-sql/005_teaching_assignment_authority_foundation.sql'), 'utf8');
  const scopeSql = seen[0].sql;
  assert.match(scopeSql, /trs\.HiccResponsibilityId/);
  assert.match(scopeSql, /trs\.HiccResponsibilityKind/);
  const assigneeSql = seen[1].sql;
  assert.match(assigneeSql, /AssignmentMode\s+AS\s+assignmentMode/i);
  assert.doesNotMatch(scopeSql, /trs\.ResponsibilityId/);
  assert.match(seen[1].sql, /ResponsibilityId AS responsibilityId/);
  assert.match(seen[1].sql, /CONVERT\(varchar\(10\), ActiveDate, 23\) AS activeDate/);
  assert.match(seen[1].sql, /CONVERT\(varchar\(10\), ExpirationDate, 23\) AS expirationDate/);
  assert.match(seen[2].sql, /p\.PackageIdentity AS packageIdentity/);
  assert.match(seen[2].sql, /p\.GroupId AS groupId/);
  assert.match(seen[2].sql, /p\.HiccResponsibilityId AS hiccResponsibilityId/);
  assert.match(seen[2].sql, /p\.TeachingAssignmentPackageId AS packageId/);
  assert.doesNotMatch(seen[2].sql, /AS teachingAssignmentPackageId/i);
  assert.match(migration, /HiccResponsibilityId nvarchar\(64\)/);
  assert.match(migration, /ResponsibilityId nvarchar\(64\)/);
  assert.match(migration, /GroupId nvarchar\(64\)/);
  assert.match(migration, /ReviewFingerprint varchar\(64\) NULL/);
  assert.match(migration, /ViscApprovedFingerprint varchar\(64\) NULL/);
  assert.match(migration, /FK_TeachingAssignmentPackage_GroupHicc/);
  assert.match(migration, /FK_TeachingSessionOwnership_PackageTuple/);
  assert.match(migration, /CK_TeachingAssignmentGroup_LeaderKind/);
  assert.match(migration, /CK_TeachingResponsibilityAssignee_AcademicYear/);
  assert.match(migration, /CK_TeachingAssignmentPackage_AcademicYear/);
  assert.match(migration, /CK_TeachingSessionOwnership_AcademicYear/);
  assert.doesNotMatch(migration, /ResponsibilityKey|GroupKey/);
  assert.doesNotMatch(migration, /UQ_TeachingAssignmentGroup_IdKind/);
  assert.match(seen[2].sql, /gh\.GroupId = p\.GroupId/);
  assert.match(seen[2].sql, /tr\.Active = 1/);
  assert.match(seen[2].sql, /g\.Active = 1/);
  assert.match(seen[3].sql, /p\.AcademicYear = tso\.AcademicYear/);
  assert.match(seen[3].sql, /p\.GroupId = tso\.TeachingAssignmentGroupId/);
  assert.match(seen[3].sql, /p\.HiccResponsibilityId = tso\.ResponsibleHiccResponsibilityId/);
  assert.match(seen[3].sql, /tso\.SessionOwnershipId AS sessionOwnershipId/);
  assert.match(seen[3].sql, /tso\.TeachingAssignmentPackageId AS packageId/);
  assert.doesNotMatch(seen[3].sql, /AS teachingAssignmentPackageId/i);
});

test('repository exposes direct canonical group HICC membership evidence', async () => {
  const {repository, seen} = capture();
  await repository.getGroupHiccResponsibilities('bovine');
  assert.match(seen[0].sql, /FROM paws\.TeachingAssignmentGroupHicc gh/);
  assert.match(seen[0].sql, /gh\.GroupId AS groupId/);
  assert.match(seen[0].sql, /gh\.HiccResponsibilityId AS hiccResponsibilityId/);
  assert.match(seen[0].sql, /gh\.HiccResponsibilityKind = N'hicc'/);
  assert.deepEqual(seen[0].params, {groupId: 'bovine'});
});

test('repository stays dormant and is not mounted into API runtime', () => {
  const repoSource = fs.readFileSync(path.join(__dirname, '../foundation/sql-teaching-assignment-repository.js'), 'utf8');
  assert.doesNotMatch(repoSource, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP)\b/i);
  const serverSource = fs.readFileSync(path.join(__dirname, '../src/runtime/swa-sql-runtime.js'), 'utf8');
  assert.doesNotMatch(serverSource, /sql-teaching-assignment-repository/);
  assert.doesNotMatch(repoSource, /staging\./i);
});
