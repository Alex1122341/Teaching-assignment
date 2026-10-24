param([Parameter(Mandatory=$true)][string]$ContainerName,[switch]$WithMasterSlots)
$ErrorActionPreference='Stop'
$cccMasterSlots=$WithMasterSlots.IsPresent
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041' -SkipAcceptance
foreach($file in @('045_calendar_away_classification.sql','046_calendar_commit_preflight.sql','047_change_history.sql','048_afc_form_upload.sql','049_ccc_full_replacement.sql')){
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath ('database/azure-sql/'+$file)) -Raw) 'VetMed-Ops'
}
if($cccMasterSlots){foreach($file in @('050_afc_record_documents.sql','051_record_document_history.sql','052_master_source_refresh.sql','053_ccc_master_slots.sql')){Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath ('database/azure-sql/'+$file)) -Raw) 'VetMed-Ops'}}
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/049_ccc_full_replacement_acceptance.sql') -Raw) 'VetMed-Ops'
. (Join-Path $PSScriptRoot 'test-ccc-replacement-races.ps1') -ContainerName $ContainerName
$cccRollback=Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_049_ccc_full_replacement.sql') -Raw
$cccRollbackQuoted=$cccRollback.Replace(':ON ERROR EXIT','').Replace("'","''")
Invoke-TestSql "BEGIN TRY EXEC(N'$cccRollbackQuoted'); THROW 54990,'Populated CCC rollback succeeded.',1; END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>54908 THROW;END CATCH; PRINT 'CCC_POPULATED_ROLLBACK_REFUSED_OK';" 'VetMed-Ops'
# A second freshly reset disposable database proves actual empty rollback.
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041' -SkipAcceptance
foreach($file in @('045_calendar_away_classification.sql','046_calendar_commit_preflight.sql','047_change_history.sql','048_afc_form_upload.sql','049_ccc_full_replacement.sql')){
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath ('database/azure-sql/'+$file)) -Raw) 'VetMed-Ops'
}
if($cccMasterSlots){
 foreach($file in @('050_afc_record_documents.sql','051_record_document_history.sql','052_master_source_refresh.sql','053_ccc_master_slots.sql','rollback_053_ccc_master_slots.sql')){Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath ('database/azure-sql/'+$file)) -Raw) 'VetMed-Ops'}
}
Invoke-TestSql $cccRollback 'VetMed-Ops'
Invoke-TestSql "IF OBJECT_ID(N'staging.CccReplacement') IS NOT NULL OR OBJECT_ID(N'paws_api.ListChangeHistoryEvents') IS NULL OR OBJECT_ID(N'paws.CalendarActivity') IS NULL THROW 54990,'CCC empty rollback damaged existing features.',1; PRINT 'CCC_EMPTY_ROLLBACK_OK';" 'VetMed-Ops'
