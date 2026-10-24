'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');
const sql=fs.readFileSync(path.join(root,'database/azure-sql/026_annual_doe_engine.sql'),'utf8');
const rollback=fs.readFileSync(path.join(root,'database/azure-sql/026_annual_doe_engine_rollback.sql'),'utf8');
const permissions=fs.readFileSync(path.join(root,'database/azure-sql/027_doe_runtime_permissions.sql'),'utf8');

test('026 is transactional, restart-safe, and leaves ambiguous historical RoleAssignment rows untouched',()=>{
  assert.match(sql,/BEGIN\s+TRANSACTION/i);
  assert.match(sql,/SET\s+XACT_ABORT\s+ON/i);
  assert.match(sql,/IF\s+OBJECT_ID\([^\n]+\)\s+IS\s+NULL[\s\S]+CREATE\s+TABLE\s+paws\.DoePolicyRule/i);
  assert.match(sql,/IF\s+COL_LENGTH\(N'paws\.DoePolicyVersion',\s*N'Status'\)\s+IS\s+NULL/i);
  assert.match(sql,/EXEC\s+sys\.sp_executesql\s+N'[\s\S]*UPDATE\s+paws\.DoePolicyVersion[\s\S]*?Status/i,
    'new policy-version columns must be referenced in a batch compiled after ALTER TABLE');
  const deferredPolicyBatch=sql.match(/EXEC\s+sys\.sp_executesql\s+N'([\s\S]*?)',\s*N'@p4SeedPolicy uniqueidentifier'/i)?.[1];
  assert.ok(deferredPolicyBatch,'the initial policy seed must defer references to its newly-added columns');
  assert.match(deferredPolicyBatch,/INSERT\s+INTO\s+paws\.DoePolicyVersion\([^)]*Status[^)]*Revision[^)]*UpdatedBy/i);
  assert.match(deferredPolicyBatch,/Status=N''draft''/i);
  assert.match(sql,/BeforeJson\s+nvarchar\(max\)/i);
  assert.match(sql,/AfterJson\s+nvarchar\(max\)/i);
  assert.doesNotMatch(sql,/BeforeJson\s+nvarchar\(8000\)|AfterJson\s+nvarchar\(8000\)/i);
  assert.doesNotMatch(sql,/UPDATE\s+paws\.RoleAssignment|INSERT\s+paws\.RoleAssignment|DELETE\s+FROM\s+paws\.RoleAssignment/i);
  assert.doesNotMatch(sql,/DROP\s+TABLE|TRUNCATE\s+TABLE/i);
});

test('026 keeps policy rules, selectors, parameters, tiers, inputs and references relational',()=>{
  for(const table of ['DoePolicyRule','DoeRuleSelector','DoeRuleParameter','DoeRuleTier','DoeRuleInput','DoeReferenceSource','DoeCourseMapping','DoeSubjectMapping','DoeCalculationRecord','DoeAssignmentFact','DoeAssignmentFactInput','DoeImpactRun','DoeImpactRunRow','DoeAuditEvent','DoePolicyPublication']){
    assert.match(sql,new RegExp(`CREATE\\s+TABLE\\s+paws\\.${table}\\b`,'i'),`${table} table is required`);
  }
  assert.match(sql,/FactsSnapshotJson\s+nvarchar\(max\)/i);
  assert.match(sql,/RuleSnapshotJson\s+nvarchar\(max\)/i);
  assert.match(sql,/CHECK\s*\(\s*ISJSON\(FactsSnapshotJson\)\s*=\s*1\s*\)/i);
  assert.match(sql,/CK_DoeRuleParameter_Value\s+CHECK\s*\([\s\S]*ValueNumber IS NULL AND ValueText IS NOT NULL[\s\S]*ValueNumber IS NOT NULL AND ValueText IS NULL/i);
  assert.match(sql,/CK_DoeRuleTier_Value\s+CHECK\s*\([\s\S]*Rate IS NULL AND FixedCredit IS NOT NULL[\s\S]*Rate IS NOT NULL AND FixedCredit IS NULL/i);
  assert.match(sql,/ResultDoe decimal\(12,6\) NULL/i);
  assert.match(sql,/CalculationTrigger nvarchar\(64\) NOT NULL/i);
  assert.doesNotMatch(sql,/(?:\bTrigger\b|\[Trigger\])\s+nvarchar\(64\)/i);
  assert.match(sql,/CK_DoeCalculationRecord_Result CHECK\([\s\S]*CalculationStatus=N'calculated' AND ResultDoe IS NOT NULL[\s\S]*CalculationStatus<>N'calculated' AND ResultDoe IS NULL/i);
  assert.match(sql,/TR_DoeCalculationRecord_Immutable[\s\S]+AFTER UPDATE, DELETE/i);
  assert.match(sql,/FOREIGN KEY\(ReferenceId,PolicyVersionId,AcademicYear\) REFERENCES paws\.DoeReferenceSource\(ReferenceId,PolicyVersionId,AcademicYear\)/i);
});

test('026 seeds an unpublished 2026-27 Rule Book only from explicitly authoritative inputs',()=>{
  assert.match(sql,/2026-27 P4 normalized Rule Book seed \(Draft\)/i);
  assert.match(sql,/VALUES\(@p4SeedPolicy,N''2026-27'',[\s\S]*?0,N''draft'',0,N''p4-migration''\)/i);
  assert.match(sql,/Reviewed 2026-27 authoritative teaching seeds do not match/i);
  assert.match(sql,/seed\.AuthoritativeInExcel LIKE N'Yes%'/i);
  assert.match(sql,/Reviewed 2026-27 VISC subject rule seed is missing or has changed/i);
  assert.match(sql,/AcademicYearOrStage=N'2026-27'\s+AND\s+Category=N'Development'\s+AND\s+RuleLabel=N'VISC'/i,
    'the P4 VISC rule must map to the accepted Beta seed category');
  assert.match(sql,/N'visc_subject_2026_27'[\s\S]*?N'subject'[\s\S]*?N'approved'/i);
  assert.match(sql,/Reserve policy parameters · 2026-27'[\s\S]*?N'fixed',[\s\S]*?0,N'needs_review'/i);
  assert.doesNotMatch(sql,/N'reserve_policy_2026_27'[\s\S]*?DoeRuleParameter/);
  assert.doesNotMatch(sql,/UPDATE\s+paws\.DoePolicyVersion\s+SET\s+Status\s*=\s*N'active'/i);
});

test('026 rollback refuses to drop edited policies or persisted DOE evidence',()=>{
  assert.match(rollback,/BEGIN\s+TRANSACTION/i);
  assert.match(rollback,/THROW\s+52551[\s\S]+P4 edits or lifecycle state/i);
  assert.match(rollback,/THROW\s+52552[\s\S]+contain evidence or business data/i);
  assert.match(rollback,/DROP\s+COLUMN\s+Status,\s*Revision,\s*UpdatedBy/i);
});

test('P4 migrations follow AUTH-1 025 with one canonical forward migration per sequence',()=>{
  const migrationNames=fs.readdirSync(path.join(root,'database/azure-sql')).filter(name=>/^\d{3}_.+\.sql$/i.test(name));
  assert.ok(migrationNames.includes('025_auth1_developer_role_authorization.sql'));
  assert.ok(migrationNames.includes('026_annual_doe_engine.sql'));
  assert.ok(migrationNames.includes('026_annual_doe_engine_rollback.sql'));
  assert.ok(migrationNames.includes('027_doe_runtime_permissions.sql'));
  assert.equal(migrationNames.filter(name=>/^025_(?!auth1_).*\.sql$/i.test(name)).length,0);
  assert.equal(migrationNames.filter(name=>name.startsWith('026_doe_runtime_permissions')).length,0);
  assert.match(permissions,/paws_runtime_doe_admin_write/);
});
