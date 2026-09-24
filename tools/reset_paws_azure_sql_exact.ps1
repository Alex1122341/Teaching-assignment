param(
    [string]$Server = 'ucvm-teaching-lab-xz-20260911.database.windows.net',
    [string]$Database = 'teaching-assignment-lab',
    [string]$TenantId = 'c609a0ec-a5e3-4631-9686-192280bd9151',
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'azure_sql_migration/sql_access.ps1')

$expectedServer = 'ucvm-teaching-lab-xz-20260911.database.windows.net'
$expectedDatabase = 'teaching-assignment-lab'
$expectedInventorySha256 = '6130f81fd01bac166c0b8578d9c79fe255463a440e0123b363e8dc4edf35e603'
$requiredConfirmation = 'RESET teaching-assignment-lab'

if ($Server -ne $expectedServer) {
    throw "Refusing reset: server '$Server' does not match reviewed server '$expectedServer'."
}
if ($Database -ne $expectedDatabase) {
    throw "Refusing reset: database '$Database' does not match reviewed database '$expectedDatabase'."
}

function Get-ReviewedInventory {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [System.Data.SqlClient.SqlTransaction]$Transaction = $null
    )

    $cmd = $Connection.CreateCommand()
    if ($null -ne $Transaction) { $cmd.Transaction = $Transaction }
    $cmd.CommandText = @'
SELECT ObjectKind, SchemaName, ObjectName
FROM (
    SELECT CAST('SCHEMA' AS nvarchar(60)) AS ObjectKind,
           s.name AS SchemaName,
           CAST('' AS nvarchar(256)) AS ObjectName
    FROM sys.schemas AS s
    WHERE s.name IN (N'paws', N'staging')

    UNION ALL

    SELECT o.type_desc AS ObjectKind,
           s.name AS SchemaName,
           o.name AS ObjectName
    FROM sys.objects AS o
    INNER JOIN sys.schemas AS s ON s.schema_id = o.schema_id
    WHERE o.is_ms_shipped = 0
      AND s.name NOT IN (N'sys', N'INFORMATION_SCHEMA')
      AND o.type IN ('U','V','P','FN','IF','TF')
) AS inventory
ORDER BY SchemaName, ObjectKind, ObjectName;
'@

    $reader = $cmd.ExecuteReader()
    $objects = @()
    while ($reader.Read()) {
        $objects += [pscustomobject][ordered]@{
            objectKind = [string]$reader.GetString(0)
            schemaName = [string]$reader.GetString(1)
            objectName = [string]$reader.GetString(2)
        }
    }
    $reader.Close()
    return @($objects)
}

$accessToken = Get-PawsSqlAccessToken -TenantId $TenantId
$connection = Open-PawsSqlConnection -Server $Server -Database $Database -AccessToken $accessToken
try {
    Assert-PawsDatabase -Connection $connection -ExpectedDatabase $Database

    $inventory = Get-ReviewedInventory -Connection $connection
    $canonical = @($inventory) | ConvertTo-Json -Depth 6 -Compress
    $inventorySha256 = Get-PawsSha256Text -Text $canonical

    if ($inventorySha256 -ne $expectedInventorySha256) {
        throw "Refusing reset: inventory mismatch. Expected $expectedInventorySha256 but found $inventorySha256. Re-run the read-only planner and review the new inventory."
    }

    if (-not $Apply) {
        [pscustomobject][ordered]@{
            mode = 'preview'
            server = $Server
            database = $Database
            objectCount = @($inventory).Count
            inventorySha256 = $inventorySha256
            message = 'Inventory matches the reviewed 18-object reset scope. Re-run with -Apply to request the destructive reset.'
        } | ConvertTo-Json -Depth 6
        return
    }

    $confirmation = Read-Host "Type '$requiredConfirmation' to delete only the reviewed 18 application objects"
    if ($confirmation -ne $requiredConfirmation) {
        throw 'Confirmation text did not match. No objects were changed.'
    }

    $transaction = $connection.BeginTransaction()
    try {
        $dropStatements = @(
            'DROP VIEW [dbo].[vw_SessionSchedule];',
            'DROP VIEW [dbo].[vw_FirestoreCollectionSummary];',
            'DROP VIEW [dbo].[vw_FirestoreSessionAssignmentMirror];',
            'DROP VIEW [dbo].[vw_FirestoreSessionMirror];',
            'DROP VIEW [dbo].[vw_FirestoreFacultyMirror];',
            'DROP PROCEDURE [dbo].[usp_UpsertFirestoreDocument];'
        )

        foreach ($statement in $dropStatements) {
            $cmd = $connection.CreateCommand()
            $cmd.Transaction = $transaction
            $cmd.CommandText = $statement
            [void]$cmd.ExecuteNonQuery()
        }

        $fkCmd = $connection.CreateCommand()
        $fkCmd.Transaction = $transaction
        $fkCmd.CommandText = @'
SELECT
    N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id)) + N'.' +
    QUOTENAME(OBJECT_NAME(fk.parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';'
FROM sys.foreign_keys AS fk
WHERE OBJECT_SCHEMA_NAME(fk.parent_object_id) = N'dbo'
  AND OBJECT_NAME(fk.parent_object_id) IN (
      N'AppSetting', N'AppUser', N'AuditEvent', N'ChangeRequest', N'Faculty',
      N'FacultyGroup', N'FacultyGroupCourse', N'FacultyGroupMember',
      N'FirestoreDocument', N'FirestoreImportRun', N'SessionAssignment', N'TeachingSession'
  )
  AND OBJECT_SCHEMA_NAME(fk.referenced_object_id) = N'dbo'
  AND OBJECT_NAME(fk.referenced_object_id) IN (
      N'AppSetting', N'AppUser', N'AuditEvent', N'ChangeRequest', N'Faculty',
      N'FacultyGroup', N'FacultyGroupCourse', N'FacultyGroupMember',
      N'FirestoreDocument', N'FirestoreImportRun', N'SessionAssignment', N'TeachingSession'
  );
'@
        $fkReader = $fkCmd.ExecuteReader()
        $fkDrops = @()
        while ($fkReader.Read()) {
            $fkDrops += [string]$fkReader.GetString(0)
        }
        $fkReader.Close()

        foreach ($statement in $fkDrops) {
            $cmd = $connection.CreateCommand()
            $cmd.Transaction = $transaction
            $cmd.CommandText = $statement
            [void]$cmd.ExecuteNonQuery()
        }

        $tableDrops = @(
            'DROP TABLE [dbo].[FacultyGroupCourse];',
            'DROP TABLE [dbo].[FacultyGroupMember];',
            'DROP TABLE [dbo].[SessionAssignment];',
            'DROP TABLE [dbo].[ChangeRequest];',
            'DROP TABLE [dbo].[AuditEvent];',
            'DROP TABLE [dbo].[FirestoreDocument];',
            'DROP TABLE [dbo].[FirestoreImportRun];',
            'DROP TABLE [dbo].[FacultyGroup];',
            'DROP TABLE [dbo].[TeachingSession];',
            'DROP TABLE [dbo].[Faculty];',
            'DROP TABLE [dbo].[AppUser];',
            'DROP TABLE [dbo].[AppSetting];'
        )

        foreach ($statement in $tableDrops) {
            $cmd = $connection.CreateCommand()
            $cmd.Transaction = $transaction
            $cmd.CommandText = $statement
            [void]$cmd.ExecuteNonQuery()
        }

        $remaining = Get-ReviewedInventory -Connection $connection -Transaction $transaction
        if (@($remaining).Count -ne 0) {
            $remainingText = @($remaining) | ConvertTo-Json -Depth 6 -Compress
            throw "Post-reset verification failed: reviewed inventory is not empty: $remainingText"
        }

        $transaction.Commit()

        [pscustomobject][ordered]@{
            mode = 'applied'
            server = $Server
            database = $Database
            deletedObjectCount = 18
            reviewedInventorySha256 = $inventorySha256
            remainingApplicationObjectCount = 0
        } | ConvertTo-Json -Depth 6
    }
    catch {
        try { $transaction.Rollback() } catch {}
        throw
    }
    finally {
        $transaction.Dispose()
    }
}
finally {
    $connection.Dispose()
    $accessToken = $null
}
