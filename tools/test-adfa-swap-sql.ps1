param([Parameter(Mandatory=$true)][string]$ContainerName)
$ErrorActionPreference='Stop'
# Reuse the inspected, labeled, local synthetic-container boundary and baseline.
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/042_adfa_swap_preview.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/042_adfa_swap_preview_acceptance.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_042_adfa_swap_preview.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql "IF OBJECT_ID(N'paws_api.GetAdfaSwapFacultyPreview') IS NOT NULL THROW 53990,'Preview rollback left its procedure.',1;PRINT 'ADFA_SWAP_PREVIEW_ROLLBACK_OK';" 'VetMed-Ops'
