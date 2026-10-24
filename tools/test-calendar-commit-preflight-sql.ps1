param([Parameter(Mandatory=$true)][string]$ContainerName)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041' -SkipAcceptance
# Historical040 retains source row30 after its deliberate recovery refusal.
# Build its schema without fixtures, then execute each unchanged fixture once.
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/045_calendar_away_classification.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/046_calendar_commit_preflight.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_046_calendar_commit_preflight.sql') -Raw) 'VetMed-Ops'
# The second application proves rollback restored the exact accepted045 definition.
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/046_calendar_commit_preflight.sql') -Raw) 'VetMed-Ops'
foreach($number in @('038','039','040','041')){
 Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath $manifest.features.$number.acceptance) -Raw) 'VetMed-Ops'
}
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/045_calendar_away_acceptance.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/046_calendar_commit_preflight_acceptance.sql') -Raw) 'VetMed-Ops'
& (Join-Path $PSScriptRoot 'test-calendar-activity-races.ps1') -ContainerName $ContainerName
