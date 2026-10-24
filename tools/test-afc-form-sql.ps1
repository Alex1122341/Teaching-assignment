param([Parameter(Mandatory=$true)][string]$ContainerName)
$ErrorActionPreference='Stop'
# The shared runner rejects remote/nonlocal/unlabeled Docker contexts before resetting anything.
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041' -SkipAcceptance
foreach($file in @('045_calendar_away_classification.sql','046_calendar_commit_preflight.sql','047_change_history.sql','048_afc_form_upload.sql','048_afc_form_upload_acceptance.sql')){
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath ('database/azure-sql/'+$file)) -Raw) 'VetMed-Ops'
}
Invoke-TestSql 'DELETE paws.AfcFormDocument;' 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_048_afc_form_upload.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql "IF OBJECT_ID(N'paws.AfcFormDocument') IS NOT NULL OR OBJECT_ID(N'paws_api.ListChangeHistoryEvents') IS NULL THROW 54890,'AFC form rollback failed.',1; PRINT 'AFC_FORM_ROLLBACK_OK';" 'VetMed-Ops'
