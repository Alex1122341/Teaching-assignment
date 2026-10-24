'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'import-doe-faculty-snapshot.ps1'), 'utf8');

test('DOE importer is bound to the approved CSV hash and uses strict TLS to VetMed-Ops', () => {
  assert.match(script, /PAWS_DOE_FTE_Import_2026-27\.csv/);
  assert.match(script, /0FA2FC2F9A9BEEB071AD7ADDA918292183ACBA83656B4C3C16DA6722B70C3EA2/);
  assert.match(script, /Server=tcp:ITAPPVETOPSDB01\.uc\.ucalgary\.ca,1433/i);
  assert.match(script, /Encrypt=True/i);
  assert.match(script, /TrustServerCertificate=False/i);
  assert.doesNotMatch(script, /Encrypt=False|TrustServerCertificate=True|Server=lpc:/i);
  assert.match(script, /Required DOE migrations 008, 013, and 014/);
  assert.match(script, /\[System\.Net\.Dns\]::GetHostName\(\).*ITAPPVETOPSDB01/s);
});

test('DOE importer treats exact unique UCID as authoritative and name differences as warnings', () => {
  assert.match(script, /databaseByUcid/);
  assert.match(script, /EXACT_UCID_NAME_WARNING/);
  assert.match(script, /nameWarnings\+\+/);
  assert.doesNotMatch(script, /nameWarnings\+\+;\s*\$conflicts\+\+/);
  assert.match(script, /NO_UCID_MATCH\s*=\s*\$noMatch/);
  assert.match(script, /DOE import refused: duplicate source or database UCID conflicts/);
  assert.doesNotMatch(script, /every source row must have one exact active Faculty match/);
});

test('DOE import is one transaction, versioned and idempotent, with blank-vs-zero preservation', () => {
  assert.match(script, /BEGIN TRANSACTION;[\s\S]*?COMMIT TRANSACTION;[\s\S]*?ROLLBACK TRANSACTION;/);
  assert.match(script, /Parameters\.Add\(\$spec\.Name, \$spec\.Type, \$spec\.Size\)/);
  assert.match(script, /CREATE TABLE #Targets[\s\S]*?Fte decimal\(6,4\) NULL/);
  assert.match(script, /WHERE source\.Fte IS NOT NULL/);
  assert.match(script, /FteSourceReference=\@SourceReference/);
  assert.match(script, /WHERE target\.Active=1 AND source\.TeachingDoe IS NOT NULL/);
  assert.doesNotMatch(script, /UPDATE allocation SET Active=0/);
  assert.match(script, /UPDATE allocation SET AllocationDoe=source\.AllocationDoe/);
  assert.match(script, /NOT EXISTS \(SELECT 1 FROM paws\.DoeFacultyAllocation/);
  assert.match(script, /paws\.DoeRuleSeed/);
  assert.match(script, /PolicyVersionId=@PolicyVersionId/);
  assert.match(script, /VERSIONED_RULE_COUNT/);
  assert.match(script, /POLICY_VERSIONS_BEFORE/);
  assert.match(script, /ACTIVE_TEACHING_TARGETS_BEFORE/);
  assert.match(script, /MIGRATION_014_APPLIED/);
});
