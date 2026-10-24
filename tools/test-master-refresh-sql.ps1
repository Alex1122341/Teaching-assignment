param(
 [Parameter(Mandatory=$true)][string]$ContainerName,
 [ValidateSet('Appointments','CccSlots','CccMaster','Trainees')][string]$Mode='Appointments',
 [switch]$CheckRollback
)
$ErrorActionPreference='Stop'
$masterCheckRollback=$CheckRollback.IsPresent
$masterMode=$Mode
# The existing helper verifies local Docker context, exact container prefix and
# label before any reset. This runner deliberately accepts no server argument.
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041' -SkipAcceptance
foreach($file in @('045_calendar_away_classification.sql','046_calendar_commit_preflight.sql','047_change_history.sql','048_afc_form_upload.sql','049_ccc_full_replacement.sql','050_afc_record_documents.sql','051_record_document_history.sql','052_master_source_refresh.sql')){
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath ('database/azure-sql/'+$file)) -Raw) 'VetMed-Ops'
}
if($masterMode -eq 'Trainees'){
 foreach($file in @('053_ccc_master_slots.sql','054_trainee_source_evidence.sql','055_trainee_empty_results.sql')){Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath ('database/azure-sql/'+$file)) -Raw) 'VetMed-Ops'}
 if($masterCheckRollback){
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_055_trainee_empty_results.sql') -Raw) 'VetMed-Ops'
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_054_trainee_source_evidence.sql') -Raw) 'VetMed-Ops'
  Invoke-TestSql "IF OBJECT_ID(N'paws.TraineeSourceEvidence') IS NOT NULL OR OBJECT_ID(N'paws.MasterRefreshReceipt') IS NULL OR OBJECT_ID(N'paws_api.StageMasterCccReplacement') IS NULL THROW 55490,'Trainee rollback damaged existing authority.',1;PRINT 'MASTER_TRAINEES_EMPTY_ROLLBACK_OK';" 'VetMed-Ops'
 }else{
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/054_trainee_source_evidence_acceptance.sql') -Raw) 'VetMed-Ops'
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/055_trainee_empty_results_acceptance.sql') -Raw) 'VetMed-Ops'
  $emptyRollback=(Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_055_trainee_empty_results.sql') -Raw).Replace(':ON ERROR EXIT','').Replace("'","''")
  Invoke-TestSql @"
DECLARE @Definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'paws_api.ListTraineeSource')),@Alter nvarchar(max);
SET @Alter=N'ALTER '+SUBSTRING(@Definition,CHARINDEX(N'PROCEDURE',UPPER(@Definition)),LEN(@Definition))+CHAR(10)+N'-- synthetic drift';EXEC sys.sp_executesql @Alter;
BEGIN TRY EXEC(N'$emptyRollback');THROW 55590,'Edited-reader rollback accepted.',1;END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55508 THROW;END CATCH;
SET @Alter=N'ALTER '+SUBSTRING(@Definition,CHARINDEX(N'PROCEDURE',UPPER(@Definition)),LEN(@Definition));EXEC sys.sp_executesql @Alter;
PRINT 'MASTER_TRAINEE_EMPTY_ARRAY_EDITED_ROLLBACK_REFUSED_OK';
DECLARE @Encrypted nvarchar(max)=REPLACE(REPLACE(@Definition,CHAR(13),N''),CHAR(10)+N'AS'+CHAR(10)+N'BEGIN',CHAR(10)+N'WITH ENCRYPTION'+CHAR(10)+N'AS'+CHAR(10)+N'BEGIN');
IF @Encrypted=REPLACE(@Definition,CHAR(13),N'') THROW 55590,'Encrypted definition fixture was not generated.',1;
SET @Encrypted=N'ALTER '+SUBSTRING(@Encrypted,CHARINDEX(N'PROCEDURE',UPPER(@Encrypted)),LEN(@Encrypted));EXEC sys.sp_executesql @Encrypted;
IF OBJECT_ID(N'paws_api.ListTraineeSource') IS NULL OR OBJECT_DEFINITION(OBJECT_ID(N'paws_api.ListTraineeSource')) IS NOT NULL THROW 55590,'Encrypted definition fixture is not opaque.',1;
BEGIN TRY EXEC(N'$emptyRollback');THROW 55590,'Unreadable-reader rollback accepted.',1;END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55508 THROW;END CATCH;
IF OBJECT_ID(N'paws_api.ListTraineeSource') IS NULL OR OBJECT_DEFINITION(OBJECT_ID(N'paws_api.ListTraineeSource')) IS NOT NULL OR (SELECT COUNT(*) FROM staging.TraineeEmptyResultBaseline)<>1 THROW 55590,'Rejected opaque rollback changed reader or baseline.',1;
EXEC sys.sp_executesql @Alter;
PRINT 'MASTER_TRAINEE_EMPTY_ARRAY_OPAQUE_ROLLBACK_REFUSED_OK';
"@ 'VetMed-Ops'
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_055_trainee_empty_results.sql') -Raw) 'VetMed-Ops'
  Invoke-TestSql "IF OBJECT_ID(N'staging.TraineeEmptyResultBaseline') IS NOT NULL OR CHARINDEX(N'JSON_QUERY(@Rows) rows',OBJECT_DEFINITION(OBJECT_ID(N'paws_api.ListTraineeSource')))=0 OR OBJECT_ID(N'paws.TraineeSourceEvidence') IS NULL THROW 55590,'Reader rollback damaged source authority.',1;PRINT 'MASTER_TRAINEE_EMPTY_ARRAY_RESTORE_OK';" 'VetMed-Ops'
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/055_trainee_empty_results.sql') -Raw) 'VetMed-Ops'
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/055_trainee_empty_results_acceptance.sql') -Raw) 'VetMed-Ops'
  $traineeRollback=(Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_054_trainee_source_evidence.sql') -Raw).Replace(':ON ERROR EXIT','').Replace("'","''")
  Invoke-TestSql "BEGIN TRY EXEC(N'$traineeRollback');THROW 55490,'Populated trainee rollback accepted.',1;END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55408 THROW;END CATCH;PRINT 'MASTER_TRAINEES_POPULATED_ROLLBACK_REFUSED_OK';" 'VetMed-Ops'
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/052_master_source_refresh_acceptance.sql') -Raw) 'VetMed-Ops'
  . (Join-Path $PSScriptRoot 'test-master-refresh-races.ps1') -ContainerName $ContainerName
 }
}elseif($masterMode -in @('CccSlots','CccMaster')){
 if(-not $masterCheckRollback){Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'server/test/fixtures/ccc-master-slots-setup.sql') -Raw) 'VetMed-Ops'}
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/053_ccc_master_slots.sql') -Raw) 'VetMed-Ops'
 if($masterCheckRollback){
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_053_ccc_master_slots.sql') -Raw) 'VetMed-Ops'
  Invoke-TestSql "IF COL_LENGTH(N'paws.CalendarActivity',N'StaffingKind') IS NOT NULL OR OBJECT_ID(N'paws.MasterRefreshReceipt') IS NULL THROW 55390,'CCC rollback damaged existing authority.',1;PRINT 'MASTER_CCC_SLOTS_EMPTY_ROLLBACK_OK';" 'VetMed-Ops'
 }else{
  $acceptance=if($masterMode -eq 'CccMaster'){'053_ccc_master_replacement_acceptance.sql'}else{'053_ccc_master_slots_acceptance.sql'}
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath ('database/azure-sql/'+$acceptance)) -Raw) 'VetMed-Ops'
  if($masterMode -eq 'CccMaster'){. (Join-Path $PSScriptRoot 'test-ccc-master-races.ps1') -ContainerName $ContainerName}
  $slotRollback=(Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_053_ccc_master_slots.sql') -Raw).Replace(':ON ERROR EXIT','').Replace("'","''")
  Invoke-TestSql "BEGIN TRY EXEC(N'$slotRollback');THROW 55390,'Populated CCC rollback accepted.',1;END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55308 THROW;END CATCH;PRINT 'MASTER_CCC_SLOTS_POPULATED_ROLLBACK_REFUSED_OK';" 'VetMed-Ops'
 }
}elseif($masterCheckRollback){
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_052_master_source_refresh.sql') -Raw) 'VetMed-Ops'
 Invoke-TestSql "IF OBJECT_ID(N'staging.MasterRefresh') IS NOT NULL OR OBJECT_ID(N'paws.RoleAppointmentSchedule') IS NULL OR OBJECT_ID(N'paws.CalendarActivity') IS NULL THROW 55290,'MASTER rollback damaged prerequisites.',1;PRINT 'MASTER_EMPTY_ROLLBACK_OK';" 'VetMed-Ops'
}else{
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/052_master_source_refresh_acceptance.sql') -Raw) 'VetMed-Ops'
 . (Join-Path $PSScriptRoot 'test-master-refresh-races.ps1') -ContainerName $ContainerName
}
