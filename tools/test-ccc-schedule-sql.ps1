param([Parameter(Mandatory=$true)][string]$ContainerName)
$ErrorActionPreference='Stop'
# The shared reset helper accepts only a labeled local synthetic Docker container and
# never accepts a Server argument, so this harness cannot be pointed at production.
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041' -SkipAcceptance

foreach($file in @(
 '045_calendar_away_classification.sql','046_calendar_commit_preflight.sql','047_change_history.sql',
 '048_afc_form_upload.sql','049_ccc_full_replacement.sql','050_afc_record_documents.sql',
 '051_record_document_history.sql','052_master_source_refresh.sql','053_ccc_master_slots.sql',
 '054_trainee_source_evidence.sql','055_trainee_empty_results.sql','056_faculty_availability_read.sql',
 '057_ccc_schedule_read.sql')){
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath ('database/azure-sql/'+$file)) -Raw) 'VetMed-Ops'
}
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/057_ccc_schedule_read_acceptance.sql') -Raw) 'VetMed-Ops'

function Get-CccScalar([string]$Sql){
 $value=$Sql | & docker exec -e "SQLCMDPASSWORD=$env:PAWS_SQL_TEST_PASSWORD" -i $ContainerName /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -I -b -h -1 -W -d 'VetMed-Ops' -i /dev/stdin -f 65001
 if($LASTEXITCODE -ne 0){throw 'DISPOSABLE_SQL_ACCEPTANCE_FAILED'}
 return ([string]($value | Where-Object { $_.Trim() -ne '' } | Select-Object -First 1)).Trim()
}
function Invoke-CccRollback([string]$Sql,[string]$DefinitionHash,[switch]$ExpectSuccess){
 $output=$Sql | & docker exec -e "SQLCMDPASSWORD=$env:PAWS_SQL_TEST_PASSWORD" -i $ContainerName /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -I -b -v PAWS_API_PRINCIPAL=paws-calendar-test-runtime -v "PAWS_CCC_SCHEDULE_DEFINITION_SHA256=$DefinitionHash" -d 'VetMed-Ops' -i /dev/stdin -f 65001 2>&1
 $code=$LASTEXITCODE
 if($ExpectSuccess){
  if($code -ne 0){$output | Write-Output;throw 'CCC rollback did not succeed with the accepted definition hash.'}
  Write-Output 'CCC_ROLLBACK_ACCEPTED'
 }else{
  if($code -eq 0){throw "CCC rollback was not refused for definition hash $DefinitionHash."}
  Write-Output 'CCC_ROLLBACK_REFUSED'
 }
}

$rollbackSql=Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_057_ccc_schedule_read.sql') -Raw
$migrationSql=Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/057_ccc_schedule_read.sql') -Raw
$accepted=Get-CccScalar "SET NOCOUNT ON;SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'paws_api.ListCccSchedule'))),2);"
if($accepted -notmatch '^[0-9A-Fa-f]{64}$'){throw 'The accepted CCC reader definition hash was not captured.'}
Write-Output "CCC_DEFINITION_SHA256 $accepted"

# A. A definition hash that was never installed must be refused.
Invoke-CccRollback $rollbackSql ('0'*64)

# B. Any grant beyond the single paws_runtime_read EXECUTE must be refused.
Invoke-TestSql 'CREATE USER ccc_rollback_extra WITHOUT LOGIN;GRANT EXECUTE ON OBJECT::paws_api.ListCccSchedule TO ccc_rollback_extra;' 'VetMed-Ops'
Invoke-CccRollback $rollbackSql $accepted
Invoke-TestSql 'REVOKE EXECUTE ON OBJECT::paws_api.ListCccSchedule FROM ccc_rollback_extra;DROP USER ccc_rollback_extra;' 'VetMed-Ops'

# C. A modified definition must be refused even with the accepted hash.
$altered=@'
ALTER PROCEDURE paws_api.ListCccSchedule
 @ActorFirebaseUid nvarchar(128),
 @AcademicYear varchar(7)
AS
BEGIN
 SET NOCOUNT ON;
 SELECT (SELECT JSON_QUERY(N'[]') entries FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
END;
'@
Invoke-TestSql $altered 'VetMed-Ops'
Invoke-CccRollback $rollbackSql $accepted

# D. A missing procedure must be refused rather than reported as success.
Invoke-TestSql 'DROP PROCEDURE paws_api.ListCccSchedule;' 'VetMed-Ops'
Invoke-CccRollback $rollbackSql $accepted

# Reinstall from the reviewed migration and prove the definition is byte-stable.
Invoke-TestSql $migrationSql 'VetMed-Ops'
$reinstalled=Get-CccScalar "SET NOCOUNT ON;SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'paws_api.ListCccSchedule'))),2);"
if($reinstalled -ne $accepted){throw 'The reinstalled CCC reader definition differs from the accepted one.'}

# E. The accepted hash removes only the reader and leaves every business row intact.
Invoke-CccRollback $rollbackSql $accepted -ExpectSuccess
Invoke-TestSql @'
IF OBJECT_ID(N'paws_api.ListCccSchedule',N'P') IS NOT NULL THROW 55790,'CCC rollback left the reader installed.',1;
IF (SELECT COUNT(*) FROM paws.CalendarActivity)<>(SELECT ActivityCount FROM dbo.CccScheduleContext) THROW 55790,'CCC rollback changed business rows.',1;
IF (SELECT COUNT(*) FROM paws.Faculty)<>(SELECT FacultyCount FROM dbo.CccScheduleContext) THROW 55790,'CCC rollback changed faculty rows.',1;
IF (SELECT COUNT(*) FROM paws.UserProfile)<>(SELECT ProfileCount FROM dbo.CccScheduleContext) THROW 55790,'CCC rollback changed user profiles.',1;
IF EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE SourceRow=2 AND BlockLabel<>N'Block 5') THROW 55790,'CCC rollback changed a CCC source row.',1;
PRINT 'CCC_SCHEDULE_ROLLBACK_OK';
'@ 'VetMed-Ops'
