[CmdletBinding()]
param(
    [string]$ManifestPath = (Join-Path $PSScriptRoot 'azure_sql_migration\session_time_corrections.json'),
    [string]$BackupPath = (Join-Path (Get-Location) 'PAWS_BETA_R4D9J_SQL_TIME_BACKUP.csv'),
    [string]$RollbackFrom,
    [string]$Server = 'ucvm-teaching-lab-xz-20260911.database.windows.net',
    [string]$Database = 'teaching-assignment-lab',
    [switch]$ValidateManifestOnly,
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'azure_sql_migration\sql_access.ps1')

function ConvertTo-CanonicalTime {
    param([Parameter(Mandatory = $true)][object]$Value, [Parameter(Mandatory = $true)][string]$Field)
    $parsed = [TimeSpan]::Zero
    if (-not [TimeSpan]::TryParse([string]$Value, [ref]$parsed)) {
        throw "$Field is not a valid SQL time: $Value"
    }
    return ('{0:00}:{1:00}:{2:00}' -f $parsed.Hours, $parsed.Minutes, $parsed.Seconds)
}

function Read-CorrectionManifest {
    param([Parameter(Mandatory = $true)][string]$Path)
    $document = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ($document.format -ne 'paws-session-time-corrections-v1') {
        throw 'Unexpected correction manifest format.'
    }
    $seen = @{}
    $rows = @()
    foreach ($item in @($document.corrections)) {
        $id = ([string]$item.sessionId).Trim().ToLowerInvariant()
        if (-not $id) { throw 'Correction manifest contains an empty SessionId.' }
        if ($seen.ContainsKey($id)) { throw "Correction manifest contains duplicate SessionId $id." }
        $seen[$id] = $true
        $oldStart = ConvertTo-CanonicalTime $item.oldStart "${id}.oldStart"
        $oldEnd = ConvertTo-CanonicalTime $item.oldEnd "${id}.oldEnd"
        $newStart = ConvertTo-CanonicalTime $item.newStart "${id}.newStart"
        $newEnd = ConvertTo-CanonicalTime $item.newEnd "${id}.newEnd"
        if ([TimeSpan]::Compare([TimeSpan]::Parse($newStart), [TimeSpan]::Parse($newEnd)) -ge 0) {
            throw "Correction $id has a non-forward new interval."
        }
        $rows += [pscustomobject]@{ SessionId = $id; OldStart = $oldStart; OldEnd = $oldEnd; NewStart = $newStart; NewEnd = $newEnd }
    }
    if ($rows.Count -eq 0) { throw 'Correction manifest contains no corrections.' }
    return @($rows)
}

function Get-Scalar {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [Parameter(Mandatory = $true)][string]$Sql,
        [System.Data.SqlClient.SqlTransaction]$Transaction
    )
    $command = $Connection.CreateCommand()
    if ($Transaction) { $command.Transaction = $Transaction }
    $command.CommandText = $Sql
    return $command.ExecuteScalar()
}

function Open-PawsSqlConnectionWithRetry {
    param(
        [Parameter(Mandatory = $true)][string]$Server,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$AccessToken,
        [int]$MaximumAttempts = 5
    )
    for ($attempt = 1; $attempt -le $MaximumAttempts; $attempt++) {
        try {
            return Open-PawsSqlConnection -Server $Server -Database $Database -AccessToken $AccessToken
        }
        catch {
            if ($attempt -eq $MaximumAttempts) { throw }
            Write-Warning "Azure SQL connection attempt $attempt failed; retrying after 15 seconds."
            Start-Sleep -Seconds 15
        }
    }
}

function Get-SessionIdHash {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [System.Data.SqlClient.SqlTransaction]$Transaction
    )
    $command = $Connection.CreateCommand()
    if ($Transaction) { $command.Transaction = $Transaction }
    $command.CommandText = 'SELECT LOWER(CONVERT(varchar(36), SessionId)) FROM paws.Session ORDER BY SessionId;'
    $reader = $command.ExecuteReader()
    try {
        $ids = [System.Collections.Generic.List[string]]::new()
        while ($reader.Read()) { $ids.Add($reader.GetString(0)) }
    }
    finally { $reader.Dispose() }
    return Get-PawsSha256Text ($ids -join "`n")
}

function Get-AffectedSessions {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [Parameter(Mandatory = $true)][object[]]$Corrections,
        [System.Data.SqlClient.SqlTransaction]$Transaction
    )
    $command = $Connection.CreateCommand()
    if ($Transaction) { $command.Transaction = $Transaction }
    $names = [System.Collections.Generic.List[string]]::new()
    for ($index = 0; $index -lt $Corrections.Count; $index++) {
        $name = "@id$index"
        $names.Add($name)
        $parameter = $command.Parameters.Add($name, [System.Data.SqlDbType]::UniqueIdentifier)
        $parameter.Value = [Guid]$Corrections[$index].SessionId
    }
    $command.CommandText = @"
SELECT
    LOWER(CONVERT(varchar(36), SessionId)) AS SessionId,
    CONVERT(varchar(10), SessionDate, 23) AS SessionDate,
    CourseCode,
    SessionType,
    Topic,
    CONVERT(varchar(8), StartTime, 108) AS StartTime,
    CONVERT(varchar(8), EndTime, 108) AS EndTime
FROM paws.Session
WHERE SessionId IN ($($names -join ','))
ORDER BY SessionId;
"@
    $table = [System.Data.DataTable]::new()
    $adapter = [System.Data.SqlClient.SqlDataAdapter]::new($command)
    try { [void]$adapter.Fill($table) }
    finally { $adapter.Dispose(); $command.Dispose() }
    return ,$table
}

function Convert-DataTableRows {
    param([Parameter(Mandatory = $true)][System.Data.DataTable]$Table)
    $rows = @()
    foreach ($row in $Table.Rows) {
        $rows += [pscustomobject]@{
            SessionId = [string]$row.SessionId
            SessionDate = [string]$row.SessionDate
            CourseCode = [string]$row.CourseCode
            SessionType = [string]$row.SessionType
            Topic = [string]$row.Topic
            StartTime = [string]$row.StartTime
            EndTime = [string]$row.EndTime
        }
    }
    return @($rows)
}

$manifest = Read-CorrectionManifest (Resolve-Path -LiteralPath $ManifestPath)
$manifest = @($manifest)
if ($ValidateManifestOnly) {
    [pscustomobject]@{
        manifestValid = $true
        correctionCount = $manifest.Count
        applyRequested = $Apply.IsPresent
        writesPerformed = $false
    } | ConvertTo-Json
    return
}
$rollbackRows = @{}
if ($RollbackFrom) {
    foreach ($row in @(Import-Csv -LiteralPath (Resolve-Path -LiteralPath $RollbackFrom))) {
        $rollbackRows[([string]$row.SessionId).ToLowerInvariant()] = $row
    }
    if ($rollbackRows.Count -ne $manifest.Count) {
        throw "Rollback backup row count $($rollbackRows.Count) does not match manifest count $($manifest.Count)."
    }
}

$accessToken = Get-PawsSqlAccessToken
$connection = Open-PawsSqlConnectionWithRetry -Server $Server -Database $Database -AccessToken $accessToken
try {
    Assert-PawsDatabase -Connection $connection -ExpectedDatabase $Database
    $sessionCountBefore = [int](Get-Scalar $connection 'SELECT COUNT_BIG(*) FROM paws.Session;')
    $assignmentCountBefore = [int](Get-Scalar $connection 'SELECT COUNT_BIG(*) FROM paws.SessionAssignment;')
    $sessionIdHashBefore = Get-SessionIdHash $connection
    $currentTable = Get-AffectedSessions -Connection $connection -Corrections $manifest
    $currentRows = Convert-DataTableRows $currentTable
    if ($currentRows.Count -ne $manifest.Count) {
        throw "Matched SQL row count $($currentRows.Count) does not equal correction count $($manifest.Count)."
    }
    $currentById = @{}
    foreach ($row in $currentRows) { $currentById[$row.SessionId.ToLowerInvariant()] = $row }

    $operations = @()
    foreach ($correction in $manifest) {
        $id = $correction.SessionId
        if (-not $currentById.ContainsKey($id)) { throw "SQL row missing for SessionId $id." }
        $current = $currentById[$id]
        if ($RollbackFrom) {
            if (-not $rollbackRows.ContainsKey($id)) { throw "Rollback backup missing SessionId $id." }
            $expectedStart = $correction.NewStart
            $expectedEnd = $correction.NewEnd
            $targetStart = ConvertTo-CanonicalTime $rollbackRows[$id].StartTime "${id}.backup.StartTime"
            $targetEnd = ConvertTo-CanonicalTime $rollbackRows[$id].EndTime "${id}.backup.EndTime"
        }
        else {
            $expectedStart = $correction.OldStart
            $expectedEnd = $correction.OldEnd
            $targetStart = $correction.NewStart
            $targetEnd = $correction.NewEnd
        }
        if ($current.StartTime -ne $expectedStart -or $current.EndTime -ne $expectedEnd) {
            throw "Old time mismatch for SessionId $id. Expected $expectedStart-$expectedEnd; found $($current.StartTime)-$($current.EndTime)."
        }
        $operations += [pscustomobject]@{ SessionId = $id; OldStart = $expectedStart; OldEnd = $expectedEnd; NewStart = $targetStart; NewEnd = $targetEnd }
    }

    $mode = if ($RollbackFrom) { 'rollback' } else { 'repair' }
    $operations | Format-Table SessionId, OldStart, OldEnd, NewStart, NewEnd -AutoSize
    if (-not $Apply) {
        [pscustomobject]@{
            mode = $mode
            applied = $false
            correctionCount = $operations.Count
            sessionCount = $sessionCountBefore
            assignmentCount = $assignmentCountBefore
            sessionIdSha256 = $sessionIdHashBefore
            writesPerformed = $false
        } | ConvertTo-Json
        return
    }

    if (-not $RollbackFrom) {
        $resolvedBackup = [System.IO.Path]::GetFullPath($BackupPath)
        if (Test-Path -LiteralPath $resolvedBackup) { throw "Backup path already exists: $resolvedBackup" }
        $currentRows | Export-Csv -LiteralPath $resolvedBackup -NoTypeInformation -Encoding UTF8
        $backupSha256 = (Get-FileHash -LiteralPath $resolvedBackup -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    else {
        $resolvedBackup = [System.IO.Path]::GetFullPath($RollbackFrom)
        $backupSha256 = (Get-FileHash -LiteralPath $resolvedBackup -Algorithm SHA256).Hash.ToLowerInvariant()
    }

    $transaction = $connection.BeginTransaction()
    try {
        $updated = 0
        foreach ($operation in $operations) {
            $command = $connection.CreateCommand()
            $command.Transaction = $transaction
            $command.CommandText = @'
UPDATE paws.Session
SET StartTime = @newStart,
    EndTime = @newEnd
WHERE SessionId = @sessionId
  AND StartTime = @oldStart
  AND EndTime = @oldEnd;
'@
            [void]$command.Parameters.Add('@newStart', [System.Data.SqlDbType]::Time)
            [void]$command.Parameters.Add('@newEnd', [System.Data.SqlDbType]::Time)
            [void]$command.Parameters.Add('@sessionId', [System.Data.SqlDbType]::UniqueIdentifier)
            [void]$command.Parameters.Add('@oldStart', [System.Data.SqlDbType]::Time)
            [void]$command.Parameters.Add('@oldEnd', [System.Data.SqlDbType]::Time)
            $command.Parameters['@newStart'].Value = [TimeSpan]::Parse($operation.NewStart)
            $command.Parameters['@newEnd'].Value = [TimeSpan]::Parse($operation.NewEnd)
            $command.Parameters['@sessionId'].Value = [Guid]$operation.SessionId
            $command.Parameters['@oldStart'].Value = [TimeSpan]::Parse($operation.OldStart)
            $command.Parameters['@oldEnd'].Value = [TimeSpan]::Parse($operation.OldEnd)
            $affected = $command.ExecuteNonQuery()
            $command.Dispose()
            if ($affected -ne 1) { throw "Update affected $affected rows for SessionId $($operation.SessionId)." }
            $updated += $affected
        }
        if ($updated -ne $operations.Count) { throw "Updated row count $updated does not equal approved correction count $($operations.Count)." }
        $sessionCountAfter = [int](Get-Scalar $connection 'SELECT COUNT_BIG(*) FROM paws.Session;' $transaction)
        $assignmentCountAfter = [int](Get-Scalar $connection 'SELECT COUNT_BIG(*) FROM paws.SessionAssignment;' $transaction)
        $sessionIdHashAfter = Get-SessionIdHash $connection $transaction
        if ($sessionCountAfter -ne $sessionCountBefore) { throw 'Session count changed inside repair transaction.' }
        if ($assignmentCountAfter -ne $assignmentCountBefore) { throw 'SessionAssignment count changed inside repair transaction.' }
        if ($sessionIdHashAfter -ne $sessionIdHashBefore) { throw 'SessionId set changed inside repair transaction.' }
        $transaction.Commit()
    }
    catch {
        try { $transaction.Rollback() } catch { }
        throw
    }
    finally { $transaction.Dispose() }

    [pscustomobject]@{
        mode = $mode
        applied = $true
        correctionCount = $operations.Count
        rowsUpdated = $updated
        rowsInserted = 0
        rowsDeleted = 0
        sessionCountBefore = $sessionCountBefore
        sessionCountAfter = $sessionCountAfter
        assignmentCountBefore = $assignmentCountBefore
        assignmentCountAfter = $assignmentCountAfter
        sessionIdSetIdentical = ($sessionIdHashBefore -eq $sessionIdHashAfter)
        backupPath = $resolvedBackup
        backupSha256 = $backupSha256
        transaction = 'COMMITTED'
    } | ConvertTo-Json
}
finally {
    if ($connection) { $connection.Dispose() }
}
