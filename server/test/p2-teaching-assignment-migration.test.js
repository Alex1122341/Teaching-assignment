'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '../../database/azure-sql/020_teaching_assignment_workflow.sql');
const proceduresPath = path.join(__dirname, '../../database/azure-sql/021_teaching_assignment_workflow_api.sql');
const rollbackPath = path.join(__dirname, '../../database/azure-sql/rollback_020_teaching_assignment_workflow.sql');
const rollbackProceduresPath = path.join(__dirname, '../../database/azure-sql/rollback_021_teaching_assignment_workflow_api.sql');
const permissionsPath = path.join(__dirname, '../../database/azure-sql/022_teaching_assignment_workflow_permissions.sql');
const rollbackPermissionsPath = path.join(__dirname, '../../database/azure-sql/rollback_022_teaching_assignment_workflow_permissions.sql');

test('P2 workflow migration is guarded, transactional, normalized, auditable, and publishes snapshots separately', () => {
  assert.ok(fs.existsSync(migrationPath), 'migration 020 must exist');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /DB_NAME\(\)\s*<>\s*N'VetMed-Ops'/i);
  assert.match(sql, /SET\s+XACT_ABORT\s+ON/i);
  assert.match(sql, /BEGIN\s+TRANSACTION/i);
  assert.match(sql, /TeachingAssignmentRevision/i);
  assert.match(sql, /TeachingAssignmentReview/i);
  assert.match(sql, /CandidateKey\s+nvarchar\s*\(128\)/i);
  assert.match(sql, /TeachingAssignmentContribution[\s\S]{0,1400}SuggestedDisplayName/i);
  assert.doesNotMatch(sql.match(/CREATE TABLE paws\.TeachingAssignmentContribution \([\s\S]*?\n    \);/i)?.[0] || '', /FacultyId|TeachingRole/i);
  assert.match(sql, /TeachingAssignmentFinalization/i);
  assert.match(sql, /TeachingAssignmentCurrentFinalization/i);
  assert.match(sql, /TeachingAssignmentPublicationRelease/i);
  assert.match(sql, /TeachingAssignmentPublicationState/i);
  assert.match(sql, /TeachingAssignmentPublishedSession/i);
  assert.match(sql, /THROW\s+52\d{3}/i);
  assert.doesNotMatch(sql, /\b(GRANT|DENY|REVOKE)\b/i);
  assert.ok(fs.existsSync(rollbackPath), 'migration 020 rollback strategy must exist');
  const rollback = fs.readFileSync(rollbackPath, 'utf8');
  assert.match(rollback, /DB_NAME\(\)\s*<>\s*N'VetMed-Ops'/i);
  assert.match(rollback, /workflow records exist; preserve them and roll forward instead/i);
  assert.match(rollback, /ExpirationDate IS NULL/i);
  assert.ok(fs.existsSync(proceduresPath), 'migration 021 must exist');
  assert.ok(fs.existsSync(rollbackProceduresPath), 'migration 021 rollback strategy must exist');
  const rollbackProcedures = fs.readFileSync(rollbackProceduresPath, 'utf8');
  assert.match(rollbackProcedures, /DB_NAME\(\)\s*<>\s*N'VetMed-Ops'/i);
  assert.match(rollbackProcedures, /BEGIN\s+TRANSACTION/i);
  assert.doesNotMatch(rollbackProcedures, /\b(GRANT|DENY|REVOKE)\b/i);
  const procedures = fs.readFileSync(proceduresPath, 'utf8');
  assert.doesNotMatch(procedures, /\b(GRANT|DENY|REVOKE)\b/i);
  assert.doesNotMatch(procedures, /EXEC\s*\(\s*N?'\s*\+/i);
});

test('migration 020 bootstraps the unapplied authority foundation atomically when it is wholly absent', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const table of [
    'Subject',
    'TeachingResponsibility',
    'TeachingResponsibilityScope',
    'TeachingResponsibilityAssignee',
    'TeachingAssignmentGroup',
    'TeachingAssignmentGroupHicc',
    'TeachingAssignmentPackage',
    'TeachingSessionOwnership'
  ]) assert.match(sql, new RegExp(`CREATE\\s+TABLE\\s+paws\\.${table}\\b`, 'i'));
  assert.match(sql, /CREATE\s+TABLE\s+staging\.ImportBatch\b/i);
  assert.doesNotMatch(sql, /THROW\s+52001,[\s\S]*requires the accepted Beta SQL foundation and migration 019/i);
  assert.match(sql, /TeachingResponsibilityAssignee[\s\S]*AssignmentMode[\s\S]*IF\s+EXISTS[\s\S]*THROW/i);
  assert.match(sql, /BEGIN\s+TRY[\s\S]*BEGIN\s+TRANSACTION[\s\S]*CREATE\s+TABLE\s+paws\.TeachingResponsibility[\s\S]*COMMIT\s+TRANSACTION/i);
  assert.match(sql, /partial authority foundation[\s\S]*THROW/i);
  const rollback = fs.readFileSync(rollbackPath, 'utf8');
  assert.match(rollback, /authority foundation and staging\.ImportBatch are shared[\s\S]*intentionally remain/i);
});

test('P2 workflow procedures expose only explicit, audited lifecycle operations', () => {
  assert.ok(fs.existsSync(proceduresPath), 'migration 021 must exist');
  const sql = fs.readFileSync(proceduresPath, 'utf8');
  for (const procedure of [
    'SaveTeachingAssignmentDraft',
    'AddTeachingAssignmentContribution',
    'SubmitTeachingAssignmentRevision',
    'RecordTeachingAssignmentReview',
    'FinalSubmitTeachingAssignment',
    'SaveTeachingAssignmentFinalization',
    'PublishTeachingAssignmentRelease'
  ]) assert.match(sql, new RegExp(`CREATE\\s+OR\\s+ALTER\\s+PROCEDURE\\s+paws_api\\.${procedure}`, 'i'));
  assert.match(sql, /AuditEvent/i);
  assert.match(sql, /WorkingRevision/i);
  assert.match(sql, /SubmittedWorkingRevision/i);
  assert.match(sql, /ViscApprovedWorkingRevision/i);
  assert.match(sql, /THROW\s+52\d{3}[^;]*(stale|revision|conflict)/i);
  assert.match(sql, /TeachingAssignmentCurrentFinalization/i);
  assert.match(sql, /TeachingAssignmentPublicationState/i);
  assert.match(sql, /TeachingAssignmentFinalizationLine/i);
  assert.match(sql, /TeachingAssignmentPublishedInstructor/i);
  const contribution = sql.slice(sql.indexOf('CREATE OR ALTER PROCEDURE paws_api.AddTeachingAssignmentContribution'),sql.indexOf('CREATE OR ALTER PROCEDURE paws_api.SubmitTeachingAssignmentRevision'));
  assert.match(contribution,/p\.Status IN\(N'draft',N'changes_requested'\)/);
  assert.match(sql, /BEGIN\s+TRANSACTION/i);
  assert.match(sql, /COMMIT\s+TRANSACTION/i);
  assert.doesNotMatch(sql, /\b(GRANT|DENY|REVOKE)\b/i);
  assert.doesNotMatch(sql, /EXEC\s*\(\s*N?['"]\s*\+/i);
});

test('P2 permissions are guarded, transactional, exact-procedure only, and narrowly reversible', () => {
  assert.ok(fs.existsSync(permissionsPath), 'migration 022 must exist');
  assert.ok(fs.existsSync(rollbackPermissionsPath), 'migration 022 rollback must exist');
  const sql = fs.readFileSync(permissionsPath, 'utf8');
  const rollback = fs.readFileSync(rollbackPermissionsPath, 'utf8');
  assert.match(sql, /DB_NAME\(\)\s*<>\s*N'VetMed-Ops'/i);
  assert.match(sql, /BEGIN\s+TRANSACTION[\s\S]*?COMMIT\s+TRANSACTION/i);
  assert.match(sql, /sys\.database_role_members/i);
  assert.match(sql, /sys\.database_permissions/i);
  assert.doesNotMatch(sql, /GRANT\s+(?:INSERT|UPDATE|DELETE)\s+ON\s+(?:OBJECT|SCHEMA)::/i);
  assert.doesNotMatch(sql, /GRANT\s+EXECUTE\s+ON\s+SCHEMA::/i);
  assert.doesNotMatch(sql, /CREATE\s+USER\s+\[|ADD\s+MEMBER|ALTER\s+ROLE/i);
  assert.match(rollback, /DB_NAME\(\)\s*<>\s*N'VetMed-Ops'/i);
  assert.match(rollback, /BEGIN\s+TRANSACTION[\s\S]*?COMMIT\s+TRANSACTION/i);
  assert.match(rollback, /P2 permission roles have members; remove them/i);
  assert.doesNotMatch(rollback, /DROP\s+TABLE|DROP\s+PROCEDURE/i);
  assert.doesNotMatch(rollback, /DROP\s+ROLE/i);
});

test('migration 022 safely creates the empty read-role container when absent', () => {
  const sql = fs.readFileSync(permissionsPath, 'utf8');
  assert.match(sql, /IF\s+DATABASE_PRINCIPAL_ID\(N'paws_runtime_read'\)[\s\S]*?<>\s*'R'[\s\S]*?THROW\s+52202/i);
  assert.match(sql, /BEGIN\s+TRANSACTION[\s\S]*DATABASE_PRINCIPAL_ID\(N'paws_runtime_read'\)\s+IS\s+NULL[\s\S]*CREATE ROLE \[paws_runtime_read\][\s\S]*GRANT SELECT[\s\S]*COMMIT\s+TRANSACTION/i);
  assert.match(sql, /membership remains intentionally unmanaged/i);
});
