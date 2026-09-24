param(
    [string]$Server = 'ucvm-teaching-lab-xz-20260911.database.windows.net',
    [string]$Database = 'teaching-assignment-lab',
    [string]$TenantId = 'c609a0ec-a5e3-4631-9686-192280bd9151'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'azure_sql_migration/sql_access.ps1')

$accessToken = Get-PawsSqlAccessToken -TenantId $TenantId
$connection = Open-PawsSqlConnection -Server $Server -Database $Database -AccessToken $accessToken
try {
    Assert-PawsDatabase -Connection $connection -ExpectedDatabase $Database

    $cmd = $connection.CreateCommand()
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

    if (@($objects).Count -eq 0) {
        $canonical = '[]'
    }
    else {
        $canonical = @($objects) | ConvertTo-Json -Depth 6 -Compress
    }
    $inventorySha256 = Get-PawsSha256Text -Text $canonical
    [pscustomobject][ordered]@{
        server = $Server
        database = $Database
        objectCount = @($objects).Count
        inventorySha256 = $inventorySha256
        objects = @($objects)
    } | ConvertTo-Json -Depth 8
}
finally {
    $connection.Dispose()
    $accessToken = $null
}