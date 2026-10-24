param([Parameter(Mandatory=$true)][string]$ContainerName)
$ErrorActionPreference='Stop'
# Reuse the existing local-context/name/label guards and fresh synthetic baseline.
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/045_calendar_away_classification.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_045_calendar_away_classification.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql "IF paws_api.CalendarActivityPurposeCategory(N'Remote Work (approved)')<>N'remote_work' THROW 54590,'Classification rollback failed.',1;PRINT 'CALENDAR_AWAY_ROLLBACK_OK';" 'VetMed-Ops'
# Applying again verifies that rollback restored all five exact module definitions.
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/045_calendar_away_classification.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/045_calendar_away_acceptance.sql') -Raw) 'VetMed-Ops'
$rollback=(Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_045_calendar_away_classification.sql') -Raw).Replace("`r`n","`n")
$rollback=[regex]::Replace($rollback,'(?m)^:[^\r\n]+\r?\n','')
$guard=(($rollback -split '(?m)^GO[ \t]*$')[0]).Replace("'","''")
Invoke-TestSql "DECLARE @Rejected bit=0;BEGIN TRY EXEC(N'$guard');END TRY BEGIN CATCH DECLARE @Error int=ERROR_NUMBER();IF XACT_STATE()<>0 ROLLBACK;IF @Error=54508 SET @Rejected=1;ELSE THROW;END CATCH;IF XACT_STATE()<>0 ROLLBACK;IF @Rejected=0 THROW 54590,'Committed v2 rollback was not refused.',1;PRINT 'CALENDAR_AWAY_COMMITTED_ROLLBACK_REFUSED_OK';" 'VetMed-Ops'
