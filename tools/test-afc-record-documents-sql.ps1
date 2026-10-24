param([Parameter(Mandatory=$true)][string]$ContainerName)
$ErrorActionPreference='Stop'
# The existing runner validates local labeled Docker context before any reset.
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041' -SkipAcceptance
foreach($file in @('045_calendar_away_classification.sql','046_calendar_commit_preflight.sql','047_change_history.sql','048_afc_form_upload.sql','049_ccc_full_replacement.sql','050_afc_record_documents.sql','051_record_document_history.sql')){
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath ('database/azure-sql/'+$file)) -Raw) 'VetMed-Ops'
}
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/050_afc_record_documents_acceptance.sql') -Raw) 'VetMed-Ops'
$refused=$false
try {Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_050_afc_record_documents.sql') -Raw) 'VetMed-Ops'} catch {$refused=$true}
if(-not $refused){throw 'Populated AFC originals rollback was not refused.'}
Invoke-TestSql "IF OBJECT_ID(N'paws.AfcRecordDocument') IS NULL OR (SELECT COUNT(*) FROM paws.AfcRecordDocument)<>1 OR (SELECT COUNT(*) FROM paws.AfcFormDocument)<>2 THROW 55090,'Refused rollback changed originals.',1; PRINT 'AFC_RECORD_DOCUMENT_POPULATED_ROLLBACK_REFUSED_OK';" 'VetMed-Ops'
# Remove only the synthetic fixtures in this disposable database, preserving its manual AFC rows.
Invoke-TestSql 'DELETE paws.AfcRecordDocument; DELETE paws.AfcFormDocument; ALTER ROLE paws_runtime_afc_record_document DROP MEMBER [paws-calendar-test-runtime];' 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_051_record_document_history.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_050_afc_record_documents.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql "IF OBJECT_ID(N'paws.AfcRecordDocument') IS NOT NULL OR OBJECT_ID(N'paws_api.CreateAfcRecordWithDocument') IS NOT NULL OR OBJECT_ID(N'paws.vAfcRecordOriginal') IS NOT NULL OR (SELECT COUNT(*) FROM paws.AfcManualRecord)<>1 OR OBJECT_ID(N'paws.AfcFormDocument') IS NULL OR OBJECT_ID(N'paws_api.ListChangeHistoryEvents') IS NULL THROW 55090,'Empty feature rollback removed prior records or left feature objects.',1; PRINT 'AFC_RECORD_DOCUMENT_EMPTY_ROLLBACK_OK';" 'VetMed-Ops'
