param([Parameter(Mandatory=$true)][string]$ContainerName)
$ErrorActionPreference='Stop'
# This inherited launcher refuses remote Docker, unlabeled containers and any Server parameter.
. (Join-Path $PSScriptRoot 'test-calendar-activity-sql.ps1') -ContainerName $ContainerName -Through '041'
Invoke-TestSql @'
SELECT o.name,HASHBYTES('SHA2_256',CONVERT(varbinary(max),m.definition)) digest INTO dbo.SwapApproval059WriteBaseline
FROM sys.objects o JOIN sys.sql_modules m ON m.object_id=o.object_id
WHERE o.schema_id=SCHEMA_ID(N'paws_api') AND o.name IN(N'SaveSessionSwap',N'DecideSessionSwap',N'WithdrawSessionSwap',N'CanActOnSessionSwap',N'CanEditSessionSwapField');
SELECT p.* INTO dbo.SwapApproval059PermissionBaseline FROM sys.database_permissions p;
'@ 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/059_swap_approval_read.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/059_swap_approval_read_acceptance.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql @'
IF EXISTS(SELECT b.name FROM dbo.SwapApproval059WriteBaseline b JOIN sys.objects o ON o.name=b.name AND o.schema_id=SCHEMA_ID(N'paws_api') JOIN sys.sql_modules m ON m.object_id=o.object_id WHERE b.digest<>HASHBYTES('SHA2_256',CONVERT(varbinary(max),m.definition))) THROW 53059,'059 changed a write/authorization procedure.',1;
IF EXISTS(SELECT * FROM dbo.SwapApproval059PermissionBaseline EXCEPT SELECT * FROM sys.database_permissions) OR EXISTS(SELECT * FROM sys.database_permissions EXCEPT SELECT * FROM dbo.SwapApproval059PermissionBaseline) THROW 53059,'059 changed SQL grants.',1;
PRINT 'SWAP_APPROVAL_READ_059_WRITE_GRANTS_UNCHANGED';
'@ 'VetMed-Ops'
Invoke-TestSql (Get-Content -LiteralPath (Join-Path $repoPath 'database/azure-sql/rollback_059_swap_approval_read.sql') -Raw) 'VetMed-Ops'
Invoke-TestSql "IF OBJECT_DEFINITION(OBJECT_ID(N'paws_api.GetSessionSwap')) LIKE N'%PAWS_SWAP_APPROVAL_READ_059%' THROW 53059,'059 rollback was not restored.',1;PRINT 'SWAP_APPROVAL_READ_059_ROLLBACK_OK';" 'VetMed-Ops'
