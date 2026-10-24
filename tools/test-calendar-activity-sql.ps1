param(
 [Parameter(Mandatory=$true)][string]$ContainerName,
 [ValidateSet('038','039','040','041')][string]$Through='038',
 [string[]]$FeatureMigrations,
 [switch]$CheckRollback,
 [switch]$SkipAcceptance
)
$ErrorActionPreference='Stop'
if($SkipAcceptance -and $CheckRollback){throw 'Schema-only setup cannot perform rollback acceptance.'}
function Fail-Disposable { throw 'DISPOSABLE_SQL_REQUIRED: use an explicitly labeled local synthetic test container.' }
if($ContainerName -notmatch '^paws-calendar-[a-z0-9-]+$'){Fail-Disposable}
if(-not(Get-Command docker -ErrorAction SilentlyContinue)){Fail-Disposable}
$contextName=& docker context show
if($LASTEXITCODE -ne 0){Fail-Disposable}
$contextData=(& docker context inspect $contextName | ConvertFrom-Json)
$hostEndpoint=$contextData[0].Endpoints.docker.Host
if($hostEndpoint -notmatch '^unix://' -and $hostEndpoint -notmatch '^npipe:///*\./pipe/'){Fail-Disposable}
$containerData=(& docker inspect $ContainerName | ConvertFrom-Json)
if($LASTEXITCODE -ne 0 -or $containerData[0].Config.Labels.'paws.calendar-test' -ne '1' -or -not $containerData[0].State.Running){Fail-Disposable}
if(-not $env:PAWS_SQL_TEST_PASSWORD){throw 'Synthetic container password is required through PAWS_SQL_TEST_PASSWORD.'}
$repoPath=Split-Path $PSScriptRoot -Parent
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'calendar-activity-sql-test-manifest.json') -Raw | ConvertFrom-Json
$OutputEncoding=New-Object System.Text.UTF8Encoding($false)
function Invoke-TestSql([string]$Sql,[string]$Database='master'){
 $Sql | & docker exec -e "SQLCMDPASSWORD=$env:PAWS_SQL_TEST_PASSWORD" -i $ContainerName /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -I -b -v PAWS_API_PRINCIPAL=paws-calendar-test-runtime -d $Database -i /dev/stdin -f 65001
 if($LASTEXITCODE -ne 0){throw 'DISPOSABLE_SQL_ACCEPTANCE_FAILED'}
}
# Reset is confined to the inspected synthetic container. Never accept a Server argument.
Invoke-TestSql "IF DB_ID(N'VetMed-Ops') IS NOT NULL BEGIN ALTER DATABASE [VetMed-Ops] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [VetMed-Ops]; END; CREATE DATABASE [VetMed-Ops];"
Invoke-TestSql 'CREATE USER [paws_swa_beta] WITHOUT LOGIN; CREATE USER [paws-sql-beta-mi] WITHOUT LOGIN; CREATE USER [paws-calendar-test-runtime] WITHOUT LOGIN;' 'VetMed-Ops'
Invoke-TestSql 'REVOKE VIEW ANY COLUMN ENCRYPTION KEY DEFINITION FROM public; REVOKE VIEW ANY COLUMN MASTER KEY DEFINITION FROM public;' 'VetMed-Ops'
foreach($relativePath in $manifest.baseline){
 Write-Output "SQL_BASELINE $relativePath"
 if($relativePath -eq 'database/azure-sql/026_annual_doe_engine.sql'){
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'server/test/fixtures/calendar-activity-doe-prerequisite.sql') -Raw) 'VetMed-Ops'
 }
 $baselineSql=Get-Content -LiteralPath (Join-Path $repoPath $relativePath) -Raw
 # Preserve one synthetic principal across historical default-name changes.
 $baselineSql=[regex]::Replace($baselineSql,'(?m)^:setvar PAWS_API_PRINCIPAL [^\r\n]+\r?\n','')
 if($relativePath -eq 'database/azure-sql/006_teaching_responsibility_concurrent_assignees.sql'){
  # On an empty schema SQL compiles the CHECK before the new column exists.
  # Only a batch boundary is added; the source DDL and guards are unchanged.
  $baselineSql=$baselineSql.Replace('IF NOT EXISTS (',"GO"+[Environment]::NewLine+'IF NOT EXISTS (')
  Write-Output 'SQL_TEST_COMPILE_BOUNDARY_ADAPTER 006'
 }
 if($relativePath -eq 'database/azure-sql/015_afc_manual_batch.sql'){
  # Linux SQL cannot provision a Windows domain name. Adapt only the test copy
  # of this deployment-principal prerequisite; procedure logic/source stay intact.
  $baselineSql=$baselineSql.Replace("N'UC\sa-xinyu.zhu1'","N'paws-calendar-test-runtime'")
  Write-Output 'SQL_TEST_PRINCIPAL_ADAPTER 015'
 }
 Invoke-TestSql $baselineSql 'VetMed-Ops'
}
$selected=if($FeatureMigrations){@($FeatureMigrations -split ',')}else{@($manifest.features.PSObject.Properties.Name | Where-Object { [int]$_ -le [int]$Through })}
if($CheckRollback){
 if(($selected -join ',') -ne '038,039,040,041'){throw 'Rollback rehearsal requires every feature migration through041.'}
 Invoke-TestSql @'
CREATE TABLE dbo.CalendarActivityRollbackBaseline(ObjectName sysname PRIMARY KEY,DefinitionHash binary(32),UsesAnsiNulls bit,UsesQuotedIdentifier bit);
INSERT dbo.CalendarActivityRollbackBaseline
SELECT o.name,HASHBYTES('SHA2_256',CONVERT(varbinary(max),TRIM(CHAR(9)+CHAR(10)+CHAR(13)+CHAR(32) FROM STUFF(REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)),1,CHARINDEX(N'PROCEDURE',m.definition)-1,N'CREATE ')))),m.uses_ansi_nulls,m.uses_quoted_identifier
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id=m.object_id WHERE o.schema_id=SCHEMA_ID(N'paws_api') AND o.name IN(N'GetSessionSwapContext',N'SaveSessionSwap',N'DecideSessionSwap');
IF (SELECT COUNT(*) FROM dbo.CalendarActivityRollbackBaseline)<>3 THROW 53891,'Rollback baseline is incomplete.',1;
'@ 'VetMed-Ops'
}
foreach($number in $selected){
 if($number -notin @('038','039','040','041')){throw 'Unsupported feature migration.'}
 $feature=$manifest.features.$number
 if(-not $feature){throw 'Feature migration manifest is incomplete.'}
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath $feature.migration) -Raw) 'VetMed-Ops'
}
# Exercise the current read contract at every supported foundation depth.
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/044_calendar_empty_activity_array.sql') -Raw) 'VetMed-Ops'
if($CheckRollback){
 function Assert-RollbackRefuses([string]$RelativePath){
  $body=(Get-Content -LiteralPath (Join-Path $repoPath $RelativePath) -Raw).Replace("`r`n","`n")
  $body=[regex]::Replace($body,'(?m)^:[^\r\n]+\r?\n','')
  $firstBatch=($body -split '(?m)^GO[ \t]*$')[0]
  $escaped=$firstBatch.Replace("'","''")
  Invoke-TestSql "DECLARE @Rejected bit=0;BEGIN TRY EXEC(N'$escaped');END TRY BEGIN CATCH DECLARE @Error int=ERROR_NUMBER();IF XACT_STATE()<>0 ROLLBACK;IF @Error=53808 SET @Rejected=1;ELSE THROW;END CATCH;IF XACT_STATE()<>0 ROLLBACK;IF @Rejected=0 THROW 53891,'Populated or bound rollback was not refused.',1;" 'VetMed-Ops'
 }
 Invoke-TestSql 'CREATE USER calendar_rollback_bound WITHOUT LOGIN;ALTER ROLE paws_runtime_calendar_read ADD MEMBER calendar_rollback_bound;' 'VetMed-Ops'
 Assert-RollbackRefuses 'database/azure-sql/rollback_041_calendar_activity_permissions.sql'
 Invoke-TestSql 'ALTER ROLE paws_runtime_calendar_read DROP MEMBER calendar_rollback_bound;DROP USER calendar_rollback_bound;' 'VetMed-Ops'
 Invoke-TestSql @'
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,Active,MustChangePassword) VALUES(N'calendar-rollback-admin',N'rollback@example.test',N'Synthetic Rollback Admin',N'owner',1,0);
DECLARE @Batch uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID(),@Row uniqueidentifier;
DECLARE @Rows nvarchar(max)=N'[{"sourceRow":2,"facultySourceName":"Synthetic rollback faculty","startDate":"2026-11-05","endDate":"2026-11-06","originalLabel":"OPA","treatment":"retain_afc","issues":[]}]';
EXEC paws_api.StageCalendarActivityImport N'calendar-rollback-admin',@Batch,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Rows;
SELECT @Row=ImportRowId FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@Batch AND SourceRow=2;
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',N'Synthetic rollback faculty',1,@Batch);
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid)
VALUES(NEWID(),@Faculty,N'ccc',N'CCC Day','2026-11-05','2026-11-06',@Batch,@Row,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',N'synthetic',2,N'calendar-rollback-admin');
'@ 'VetMed-Ops'
 foreach($number in @('038','039','040')){
  $name=@{'038'='foundation';'039'='swap';'040'='commands'}[$number]
  Assert-RollbackRefuses "database/azure-sql/rollback_${number}_calendar_activity_${name}.sql"
 }
 Invoke-TestSql @'
DECLARE @Batch uniqueidentifier=(SELECT ImportBatchId FROM staging.CalendarActivityImport WHERE ActorFirebaseUid=N'calendar-rollback-admin');
DELETE paws.CalendarActivity WHERE ImportBatchId=@Batch;
DELETE paws.Faculty WHERE SourceImportBatchId=@Batch;
DELETE paws.AuditEvent WHERE ImportBatchId=@Batch;
DELETE staging.CalendarActivityImportItem WHERE ImportBatchId=@Batch;
DELETE staging.CalendarActivityImport WHERE ImportBatchId=@Batch;
DELETE row FROM staging.ImportRow row JOIN staging.ImportSheet sheet ON sheet.ImportSheetId=row.ImportSheetId JOIN staging.ImportWorkbook book ON book.ImportWorkbookId=sheet.ImportWorkbookId WHERE book.ImportBatchId=@Batch;
DELETE sheet FROM staging.ImportSheet sheet JOIN staging.ImportWorkbook book ON book.ImportWorkbookId=sheet.ImportWorkbookId WHERE book.ImportBatchId=@Batch;
DELETE staging.ImportWorkbook WHERE ImportBatchId=@Batch;
DELETE staging.ImportBatch WHERE ImportBatchId=@Batch;
DELETE paws.UserProfile WHERE FirebaseUid=N'calendar-rollback-admin';
PRINT 'CALENDAR_ACTIVITY_POPULATED_ROLLBACK_REFUSED_OK';
'@ 'VetMed-Ops'
 foreach($relativePath in @('database/azure-sql/rollback_041_calendar_activity_permissions.sql','database/azure-sql/rollback_039_calendar_activity_swap.sql','database/azure-sql/rollback_040_calendar_activity_commands.sql','database/azure-sql/rollback_038_calendar_activity_foundation.sql')){
  Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath $relativePath) -Raw) 'VetMed-Ops'
 }
 Invoke-TestSql @'
SELECT b.ObjectName,CONVERT(varchar(64),b.DefinitionHash,2) originalHash,
CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),TRIM(CHAR(9)+CHAR(10)+CHAR(13)+CHAR(32) FROM STUFF(REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)),1,CHARINDEX(N'PROCEDURE',m.definition)-1,N'CREATE ')))),2) restoredHash,
b.UsesAnsiNulls originalAnsi,m.uses_ansi_nulls restoredAnsi,b.UsesQuotedIdentifier originalQuoted,m.uses_quoted_identifier restoredQuoted
FROM dbo.CalendarActivityRollbackBaseline b JOIN sys.objects o ON o.schema_id=SCHEMA_ID(N'paws_api') AND o.name=b.ObjectName JOIN sys.sql_modules m ON m.object_id=o.object_id
ORDER BY b.ObjectName FOR JSON PATH;
IF EXISTS(SELECT 1 FROM dbo.CalendarActivityRollbackBaseline b LEFT JOIN sys.objects o ON o.schema_id=SCHEMA_ID(N'paws_api') AND o.name=b.ObjectName LEFT JOIN sys.sql_modules m ON m.object_id=o.object_id
WHERE m.object_id IS NULL OR b.DefinitionHash<>HASHBYTES('SHA2_256',CONVERT(varbinary(max),TRIM(CHAR(9)+CHAR(10)+CHAR(13)+CHAR(32) FROM STUFF(REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)),1,CHARINDEX(N'PROCEDURE',m.definition)-1,N'CREATE ')))) OR b.UsesAnsiNulls<>m.uses_ansi_nulls OR b.UsesQuotedIdentifier<>m.uses_quoted_identifier) THROW 53891,'Rollback changed the original SWAP definitions or SET metadata.',1;
IF EXISTS(SELECT 1 FROM sys.objects WHERE schema_id IN(SCHEMA_ID(N'paws'),SCHEMA_ID(N'paws_api'),SCHEMA_ID(N'staging')) AND name LIKE N'%CalendarActivity%')
 OR EXISTS(SELECT 1 FROM sys.database_principals WHERE name IN(N'paws_runtime_calendar_read',N'paws_runtime_calendar_stage',N'paws_runtime_calendar_commit',N'paws_runtime_calendar_time',N'paws_calendar_recovery_admin')) THROW 53891,'Rollback left feature objects or roles.',1;
DROP TABLE dbo.CalendarActivityRollbackBaseline;
PRINT 'CALENDAR_ACTIVITY_EMPTY_ROLLBACK_OK';
'@ 'VetMed-Ops'
 exit 0
}
if($SkipAcceptance){return}
foreach($number in $selected){
 $acceptance=$manifest.features.$number.acceptance
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath $acceptance) -Raw) 'VetMed-Ops'
}
