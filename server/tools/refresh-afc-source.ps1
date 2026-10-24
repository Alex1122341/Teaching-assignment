[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('DryRun','Apply')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$SourcePath,
    [string]$Server = 'ITAPPVETOPSDB01.uc.ucalgary.ca',
    [string]$Database = 'VetMed-Ops'
)

$ErrorActionPreference = 'Stop'
$expectedHash = '73E49045F4565E3A77E1D5A2A775F152061F64287E4C2962103912F56A041E58'
$expectedSourceName = 'PAWS_AFC_Latest_Import_2026-10-04.csv'
$importerVersion = 'paws-afc-latest-refresh-v1'
$applicationLock = 'PAWS_AFC_LATEST_SOURCE_REFRESH'

function Add-Parameter {
    param($Command,[string]$Name,[System.Data.SqlDbType]$Type,[int]$Size,$Value)
    $parameter = $Command.Parameters.Add($Name,$Type)
    if ($Size -ne 0) { $parameter.Size = $Size }
    $parameter.Value = if ($null -eq $Value) { [DBNull]::Value } else { $Value }
    return $parameter
}

function Read-SqlRows {
    param([System.Data.SqlClient.SqlConnection]$Connection,[System.Data.SqlClient.SqlTransaction]$Transaction,[string]$Sql)
    $command = $Connection.CreateCommand()
    if ($Transaction) { $command.Transaction = $Transaction }
    $command.CommandTimeout = 120
    $command.CommandText = $Sql
    $reader = $command.ExecuteReader()
    $items = [Collections.Generic.List[object]]::new()
    try {
        while ($reader.Read()) {
            $row = [ordered]@{}
            for ($i=0; $i -lt $reader.FieldCount; $i++) {
                $row[$reader.GetName($i)] = if ($reader.IsDBNull($i)) { $null } else { $reader.GetValue($i) }
            }
            $items.Add([pscustomobject]$row)
        }
    } finally { $reader.Dispose(); $command.Dispose() }
    return $items.ToArray()
}

function Invoke-SqlNonQuery {
    param([System.Data.SqlClient.SqlConnection]$Connection,[System.Data.SqlClient.SqlTransaction]$Transaction,[string]$Sql,[object[]]$Parameters=@())
    $command = $Connection.CreateCommand()
    if ($Transaction) { $command.Transaction = $Transaction }
    $command.CommandTimeout = 120
    $command.CommandText = $Sql
    foreach ($parameter in $Parameters) { [void]$command.Parameters.Add($parameter) }
    try { return $command.ExecuteNonQuery() } finally { $command.Dispose() }
}

function Get-AfcPlan {
    param([System.Data.SqlClient.SqlConnection]$Connection,[System.Data.SqlClient.SqlTransaction]$Transaction)
    $faculty = @(Read-SqlRows $Connection $Transaction @'
SELECT CONVERT(nvarchar(36),FacultyId) AS facultyId,DisplayName AS displayName,
       PreferredFirstName AS preferredFirstName,PreferredLastName AS preferredLastName,Active AS active
FROM paws.Faculty WHERE Active=1;
'@)
    $aliases = @(Read-SqlRows $Connection $Transaction @'
SELECT CONVERT(nvarchar(36),FacultyId) AS facultyId,AliasName AS aliasName,
       TargetPreferredSourceName AS targetPreferredSourceName,TargetDisplayName AS targetDisplayName,Active AS active
FROM paws.FacultyAlias WHERE Active=1;
'@)
    $mappings = @(Read-SqlRows $Connection $Transaction @'
SELECT DISTINCT raw.FacultySourceName AS sourceName,CONVERT(nvarchar(36),afc.FacultyId) AS facultyId
FROM staging.AfcRecordRaw AS raw
JOIN paws.AfcRecord AS afc ON afc.SourceImportBatchId=raw.ImportBatchId AND afc.SourceRow=raw.SourceRowNumber
JOIN paws.Faculty AS f ON f.FacultyId=afc.FacultyId AND f.Active=1
WHERE NULLIF(LTRIM(RTRIM(raw.FacultySourceName)),N'') IS NOT NULL AND afc.Active=1;
'@)
    $existing = @(Read-SqlRows $Connection $Transaction @'
SELECT CONVERT(nvarchar(36),AfcRecordId) AS afcRecordId,CONVERT(nvarchar(36),FacultyId) AS facultyId,
       CONVERT(char(10),StartDate,23) AS startDate,CONVERT(char(10),EndDate,23) AS endDate,
       Purpose AS purpose,Active AS active
FROM paws.AfcRecord WHERE Active=1;
'@)
    $inputObject = @{ directory=@{faculty=$faculty;aliases=$aliases;mappings=$mappings}; existingRecords=$existing }
    $inputJson = ConvertTo-Json -InputObject $inputObject -Depth 12 -Compress
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $planScript = Join-Path $PSScriptRoot 'afc-import-plan.js'
    if (-not (Test-Path -LiteralPath $planScript)) { throw 'AFC plan module missing from staged runtime.' }
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $node
    $psi.Arguments = '"' + $planScript + '" "' + [IO.Path]::GetFullPath($SourcePath) + '"'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $psi
    if (-not $process.Start()) { throw 'Unable to start the local AFC reconciliation planner.' }
    try {
        $process.StandardInput.Write($inputJson)
        $process.StandardInput.Close()
        $output = $process.StandardOutput.ReadToEnd()
        $errorText = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw ('AFC reconciliation planning failed: ' + $errorText.Trim()) }
        return ($output | ConvertFrom-Json)
    } finally { $process.Dispose() }
}

function Get-BaseCounts {
    param([System.Data.SqlClient.SqlConnection]$Connection,[System.Data.SqlClient.SqlTransaction]$Transaction)
    $rows = @(Read-SqlRows $Connection $Transaction @'
SELECT COUNT(AfcRecordId) AS importedRows,
       SUM(CASE WHEN Active=1 THEN 1 ELSE 0 END) AS activeRows
FROM paws.AfcRecord;
'@)
    $duplicates = @(Read-SqlRows $Connection $Transaction @'
WITH d AS (
  SELECT FacultyId,StartDate,EndDate,Purpose,COUNT_BIG(*) AS n
  FROM paws.AfcRecord WHERE Active=1
  GROUP BY FacultyId,StartDate,EndDate,Purpose HAVING COUNT_BIG(*)>1
)
SELECT COUNT_BIG(*) AS duplicateGroups,COALESCE(SUM(n-1),0) AS duplicateExtraRows FROM d;
'@)
    return [pscustomobject]@{
        importedRows=[int]$rows[0].importedRows; activeRows=[int]$rows[0].activeRows
        duplicateGroups=[int]$duplicates[0].duplicateGroups; duplicateExtraRows=[int]$duplicates[0].duplicateExtraRows
    }
}

function Add-ImportRow {
    param([System.Data.SqlClient.SqlConnection]$Connection,[System.Data.SqlClient.SqlTransaction]$Transaction,[Guid]$BatchId,$Row)
    $raw = [ordered]@{
        sourceRowNumber=$Row.sourceRowNumber; facultyMember=$Row.facultySourceName
        start=$Row.rawStartDate; end=$Row.rawEndDate; purpose=$Row.rawPurpose
    } | ConvertTo-Json -Depth 6 -Compress
    $evidence = [ordered]@{
        issues=@($Row.rawIssues); status=$Row.status; correction=$Row.correction
        facultyResolutionMethod=$Row.facultyResolutionMethod; facultyId=$Row.facultyId
    } | ConvertTo-Json -Depth 6 -Compress
    $validationStatus = if ($Row.status -eq 'SOURCE_ROW_REQUIRES_REVIEW') { 'needs_review' } elseif ($Row.correction) { 'resolved' } else { 'valid' }
    $sourceName = if ($Row.facultySourceName -and $Row.facultySourceName.Length -le 256) { [string]$Row.facultySourceName } else { $null }
    $purpose = if ($Row.purpose -and $Row.purpose.Length -le 1000) { [string]$Row.purpose } else { $null }
    $start = if ($Row.startDate) { [DateTime]::ParseExact([string]$Row.startDate,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture) } else { $null }
    $end = if ($Row.endDate) { [DateTime]::ParseExact([string]$Row.endDate,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture) } else { $null }
    $command=$Connection.CreateCommand();$command.Transaction=$Transaction;$command.CommandTimeout=120
    $command.CommandText='INSERT staging.AfcRecordRaw (ImportBatchId,ImportRowId,SourceRowNumber,FacultySourceName,StartDate,EndDate,Purpose,RawJson,ValidationStatus,ValidationErrorsJson) VALUES (@batch,@row,@sourceRow,@name,@start,@end,@purpose,@raw,@status,@evidence);'
    [void](Add-Parameter $command '@batch' ([System.Data.SqlDbType]::UniqueIdentifier) 0 $BatchId)
    [void](Add-Parameter $command '@row' ([System.Data.SqlDbType]::UniqueIdentifier) 0 ([Guid]::NewGuid()))
    [void](Add-Parameter $command '@sourceRow' ([System.Data.SqlDbType]::Int) 0 ([int]$Row.sourceRowNumber))
    [void](Add-Parameter $command '@name' ([System.Data.SqlDbType]::NVarChar) 256 $sourceName)
    [void](Add-Parameter $command '@start' ([System.Data.SqlDbType]::Date) 0 $start)
    [void](Add-Parameter $command '@end' ([System.Data.SqlDbType]::Date) 0 $end)
    [void](Add-Parameter $command '@purpose' ([System.Data.SqlDbType]::NVarChar) 1000 $purpose)
    [void](Add-Parameter $command '@raw' ([System.Data.SqlDbType]::NVarChar) -1 $raw)
    [void](Add-Parameter $command '@status' ([System.Data.SqlDbType]::NVarChar) 32 $validationStatus)
    [void](Add-Parameter $command '@evidence' ([System.Data.SqlDbType]::NVarChar) -1 $evidence)
    try { [void]$command.ExecuteNonQuery() } finally { $command.Dispose() }
}

function Add-ReconciliationEntity {
    param([System.Data.SqlClient.SqlConnection]$Connection,[System.Data.SqlClient.SqlTransaction]$Transaction,[Guid]$BatchId,[string]$SourceName,$Row)
    $payload = [ordered]@{
        sourceRowNumber=$Row.sourceRowNumber;status=$Row.status;correction=$Row.correction
        facultyId=$Row.facultyId;facultyResolutionMethod=$Row.facultyResolutionMethod
        issues=@($Row.rawIssues);existingRecordIds=@($Row.existingRecordIds)
    } | ConvertTo-Json -Depth 8 -Compress
    $command=$Connection.CreateCommand();$command.Transaction=$Transaction;$command.CommandTimeout=120
    $command.CommandText='INSERT staging.PackageEntity (PackageEntityId,ImportBatchId,EntityKind,SourceFileName,SourceRowNumber,PayloadJson) VALUES (@id,@batch,@kind,@file,@row,@payload);'
    [void](Add-Parameter $command '@id' ([System.Data.SqlDbType]::UniqueIdentifier) 0 ([Guid]::NewGuid()))
    [void](Add-Parameter $command '@batch' ([System.Data.SqlDbType]::UniqueIdentifier) 0 $BatchId)
    [void](Add-Parameter $command '@kind' ([System.Data.SqlDbType]::NVarChar) 128 'afc_source_row_reconciliation')
    [void](Add-Parameter $command '@file' ([System.Data.SqlDbType]::NVarChar) 512 $SourceName)
    [void](Add-Parameter $command '@row' ([System.Data.SqlDbType]::Int) 0 ([int]$Row.sourceRowNumber))
    [void](Add-Parameter $command '@payload' ([System.Data.SqlDbType]::NVarChar) -1 $payload)
    try { [void]$command.ExecuteNonQuery() } finally { $command.Dispose() }
}

function Add-ImportedRecord {
    param([System.Data.SqlClient.SqlConnection]$Connection,[System.Data.SqlClient.SqlTransaction]$Transaction,[Guid]$BatchId,$Row)
    $command=$Connection.CreateCommand();$command.Transaction=$Transaction;$command.CommandTimeout=120
    $command.CommandText=@'
IF NOT EXISTS (
  SELECT 1 FROM paws.AfcRecord WITH (UPDLOCK,HOLDLOCK)
  WHERE Active=1 AND FacultyId=@faculty AND StartDate=@start AND EndDate=@end
    AND Purpose COLLATE Latin1_General_100_BIN2 = @purpose COLLATE Latin1_General_100_BIN2
    AND DATALENGTH(Purpose)=DATALENGTH(@purpose)
)
BEGIN
  INSERT paws.AfcRecord (AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow)
  VALUES (@id,@faculty,@start,@end,@purpose,1,@batch,@row);
  SELECT 1;
END
ELSE SELECT 0;
'@
    [void](Add-Parameter $command '@id' ([System.Data.SqlDbType]::UniqueIdentifier) 0 ([Guid]::NewGuid()))
    [void](Add-Parameter $command '@batch' ([System.Data.SqlDbType]::UniqueIdentifier) 0 $BatchId)
    [void](Add-Parameter $command '@row' ([System.Data.SqlDbType]::Int) 0 ([int]$Row.sourceRowNumber))
    [void](Add-Parameter $command '@faculty' ([System.Data.SqlDbType]::UniqueIdentifier) 0 ([Guid]$Row.facultyId))
    [void](Add-Parameter $command '@start' ([System.Data.SqlDbType]::Date) 0 ([DateTime]::ParseExact([string]$Row.startDate,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)))
    [void](Add-Parameter $command '@end' ([System.Data.SqlDbType]::Date) 0 ([DateTime]::ParseExact([string]$Row.endDate,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)))
    [void](Add-Parameter $command '@purpose' ([System.Data.SqlDbType]::NVarChar) 1000 ([string]$Row.purpose))
    try { return ([int]$command.ExecuteScalar() -eq 1) } finally { $command.Dispose() }
}

if ([IO.Path]::GetFileName($SourcePath) -cne $expectedSourceName) { throw 'Unexpected AFC source filename.' }
if ($Server -cne 'ITAPPVETOPSDB01.uc.ucalgary.ca' -or $Database -cne 'VetMed-Ops') { throw 'The AFC refresh target must be the authorized VetMed-Ops SQL host and database.' }
if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) { throw 'AFC source file is missing.' }
$actualHash = (Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actualHash -cne $expectedHash) { throw 'AFC source SHA-256 does not match the approved file.' }
$fileInfo = Get-Item -LiteralPath $SourcePath
$sourceName = [IO.Path]::GetFileName($SourcePath)
$actor = ($env:USERDOMAIN + '\' + $env:USERNAME)
$connectionString = "Server=tcp:$Server,1433;Initial Catalog=$Database;Integrated Security=SSPI;Encrypt=True;TrustServerCertificate=False;Connect Timeout=20;Application Name=PAWS-AFC-Source-Refresh;"
$connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
$transaction = $null
try {
    $connection.Open()
    $base = Get-BaseCounts $connection $null
    $plan = Get-AfcPlan $connection $null
    if ([int]$plan.source.sourceRows -ne 810) { throw 'AFC source row count does not match the approved 810-row manifest.' }
    if ($Mode -eq 'DryRun') {
        $report = [ordered]@{
            mode='DRY_RUN';sourceFileName=$sourceName;sourceSha256=$actualHash;sourceRows=$plan.summary.sourceRows
            validRows=$plan.summary.validRows;exactExisting=$plan.summary.exactExisting;plannedInserts=$plan.summary.inserts
            corrected=$plan.summary.corrected;intentionalDuplicates=$plan.summary.intentionalDuplicates
            duplicateGroups=$plan.source.duplicateGroups;duplicateExtraRows=$plan.summary.duplicateExtraRows
            skippedInvalid=$plan.summary.skippedInvalid;unresolved=$plan.summary.unresolved
            sourceCurrent=$plan.summary.sourceCurrent;sourceNew=$plan.summary.sourceNew;sourceChanged=$plan.summary.sourceChanged
            representedBeforeApply=$plan.summary.represented;dbOnlyHistory=$plan.summary.dbOnlyHistory
            databaseImportedRows=$base.importedRows;databaseActiveRows=$base.activeRows
            databaseDuplicateGroups=$base.duplicateGroups;databaseDuplicateExtraRows=$base.duplicateExtraRows
            correctedSourceRows=@($plan.rows | Where-Object status -eq 'SOURCE_ERROR_DETERMINISTICALLY_RESOLVED' | ForEach-Object { [int]$_.sourceRowNumber })
            unresolvedSourceRows=@($plan.rows | Where-Object status -eq 'SOURCE_ROW_REQUIRES_REVIEW' | ForEach-Object { [pscustomobject]@{sourceRowNumber=[int]$_.sourceRowNumber;issues=@($_.rawIssues)} })
        }
        ConvertTo-Json -InputObject $report -Depth 8 -Compress
        return
    }

    $transaction = $connection.BeginTransaction([System.Data.IsolationLevel]::Serializable)
    $lock = $connection.CreateCommand();$lock.Transaction=$transaction
    $lock.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'$applicationLock',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=15000; IF @r<0 THROW 51401,'AFC source refresh lock unavailable.',1;"
    try { [void]$lock.ExecuteNonQuery() } finally { $lock.Dispose() }
    $prior = @(Read-SqlRows $connection $transaction "SELECT ImportBatchId,Status FROM staging.ImportBatch WHERE SourceManifestSha256='$actualHash' AND ImporterVersion='$importerVersion' AND Status IN (N'complete',N'complete_with_review');")
    if ($prior.Count) {
        $transaction.Rollback();$transaction=$null
        $latest = Get-AfcPlan $connection $null
        $report = [ordered]@{mode='ALREADY_IMPORTED';sourceFileName=$sourceName;sourceSha256=$actualHash;existingBatchCount=$prior.Count;sourceRows=$latest.summary.sourceRows;represented=$latest.summary.represented;unresolved=$latest.summary.unresolved;databaseImportedRows=$base.importedRows}
        ConvertTo-Json -InputObject $report -Depth 6 -Compress
        return
    }
    $plan = Get-AfcPlan $connection $transaction
    $batchId = [Guid]::NewGuid()
    $startingSummary = ConvertTo-Json -InputObject ([ordered]@{sourceRows=$plan.summary.sourceRows;status='applying';sourceSha256=$actualHash}) -Compress
    $insertBatch = $connection.CreateCommand();$insertBatch.Transaction=$transaction
    $insertBatch.CommandText='INSERT staging.ImportBatch (ImportBatchId,StartedAtUtc,CompletedAtUtc,Status,SourceManifestSha256,ImporterVersion,ActorUpn,ValidationSummaryJson) VALUES (@id,SYSUTCDATETIME(),NULL,N''applying'',@hash,@version,@actor,@summary);'
    [void](Add-Parameter $insertBatch '@id' ([System.Data.SqlDbType]::UniqueIdentifier) 0 $batchId)
    [void](Add-Parameter $insertBatch '@hash' ([System.Data.SqlDbType]::Char) 64 $actualHash)
    [void](Add-Parameter $insertBatch '@version' ([System.Data.SqlDbType]::NVarChar) 64 $importerVersion)
    [void](Add-Parameter $insertBatch '@actor' ([System.Data.SqlDbType]::NVarChar) 512 $actor)
    [void](Add-Parameter $insertBatch '@summary' ([System.Data.SqlDbType]::NVarChar) -1 $startingSummary)
    try { [void]$insertBatch.ExecuteNonQuery() } finally { $insertBatch.Dispose() }

    $manifest = ConvertTo-Json -InputObject ([ordered]@{sourceFileName=$sourceName;sourceSha256=$actualHash;fileByteLength=[long]$fileInfo.Length;sourceRows=$plan.summary.sourceRows;importerVersion=$importerVersion}) -Compress
    $manifestCommand=$connection.CreateCommand();$manifestCommand.Transaction=$transaction
    $manifestCommand.CommandText='INSERT staging.PackageEntity (PackageEntityId,ImportBatchId,EntityKind,SourceFileName,SourceRowNumber,PayloadJson) VALUES (@id,@batch,N''afc_source_manifest'',@file,NULL,@payload);'
    [void](Add-Parameter $manifestCommand '@id' ([System.Data.SqlDbType]::UniqueIdentifier) 0 ([Guid]::NewGuid()))
    [void](Add-Parameter $manifestCommand '@batch' ([System.Data.SqlDbType]::UniqueIdentifier) 0 $batchId)
    [void](Add-Parameter $manifestCommand '@file' ([System.Data.SqlDbType]::NVarChar) 512 $sourceName)
    [void](Add-Parameter $manifestCommand '@payload' ([System.Data.SqlDbType]::NVarChar) -1 $manifest)
    try { [void]$manifestCommand.ExecuteNonQuery() } finally { $manifestCommand.Dispose() }

    foreach ($row in @($plan.rows)) {
        Add-ImportRow $connection $transaction $batchId $row
        Add-ReconciliationEntity $connection $transaction $batchId $sourceName $row
    }
    $inserted = 0
    foreach ($row in @($plan.rows | Where-Object writeAction -eq 'INSERT')) {
        if (Add-ImportedRecord $connection $transaction $batchId $row) { $inserted += 1 }
    }
    $verified = Get-AfcPlan $connection $transaction
    if ([int]$verified.summary.represented -ne [int]$plan.summary.validRows) { throw 'Post-import exact-key verification did not represent every valid source row.' }
    $finalSummary = [ordered]@{
        sourceRows=$plan.summary.sourceRows;validRows=$plan.summary.validRows;exactExisting=$plan.summary.exactExisting
        inserted=$inserted;corrected=$plan.summary.corrected;intentionalDuplicates=0
        duplicateGroups=$plan.source.duplicateGroups;duplicateExtraRows=$plan.summary.duplicateExtraRows
        skippedInvalid=$plan.summary.skippedInvalid;unresolved=$plan.summary.unresolved
        sourceCurrent=$plan.summary.sourceCurrent;sourceNew=$plan.summary.sourceNew;sourceChanged=$plan.summary.sourceChanged
        representedAfterApply=$verified.summary.represented;dbOnlyHistory=$verified.summary.dbOnlyHistory
    }
    $summaryJson = ConvertTo-Json -InputObject $finalSummary -Depth 8 -Compress
    $batchStatus = if ([int]$plan.summary.unresolved -gt 0) { 'complete_with_review' } else { 'complete' }
    $update = $connection.CreateCommand();$update.Transaction=$transaction
    $update.CommandText='UPDATE staging.ImportBatch SET CompletedAtUtc=SYSUTCDATETIME(),Status=@status,ValidationSummaryJson=@summary WHERE ImportBatchId=@id;'
    [void](Add-Parameter $update '@status' ([System.Data.SqlDbType]::NVarChar) 32 $batchStatus)
    [void](Add-Parameter $update '@summary' ([System.Data.SqlDbType]::NVarChar) -1 $summaryJson)
    [void](Add-Parameter $update '@id' ([System.Data.SqlDbType]::UniqueIdentifier) 0 $batchId)
    try { [void]$update.ExecuteNonQuery() } finally { $update.Dispose() }
    $transaction.Commit();$transaction=$null
    $finalCounts=Get-BaseCounts $connection $null
    $report = [ordered]@{
        mode='APPLIED';sourceFileName=$sourceName;sourceSha256=$actualHash;importBatchId=$batchId
        sourceRows=$finalSummary.sourceRows;validRows=$finalSummary.validRows;exactExisting=$finalSummary.exactExisting
        inserted=$finalSummary.inserted;corrected=$finalSummary.corrected;intentionalDuplicates=0
        duplicateGroups=$finalSummary.duplicateGroups;duplicateExtraRows=$finalSummary.duplicateExtraRows
        skippedInvalid=$finalSummary.skippedInvalid;unresolved=$finalSummary.unresolved
        sourceCurrent=$finalSummary.sourceCurrent;sourceNew=$finalSummary.sourceNew;sourceChanged=$finalSummary.sourceChanged
        represented=$verified.summary.represented;dbOnlyHistory=$verified.summary.dbOnlyHistory
        databaseImportedRows=$finalCounts.importedRows;databaseActiveRows=$finalCounts.activeRows
        databaseDuplicateGroups=$finalCounts.duplicateGroups;databaseDuplicateExtraRows=$finalCounts.duplicateExtraRows
        correctedSourceRows=@($plan.rows | Where-Object status -eq 'SOURCE_ERROR_DETERMINISTICALLY_RESOLVED' | ForEach-Object { [int]$_.sourceRowNumber })
        unresolvedSourceRows=@($plan.rows | Where-Object status -eq 'SOURCE_ROW_REQUIRES_REVIEW' | ForEach-Object { [pscustomobject]@{sourceRowNumber=[int]$_.sourceRowNumber;issues=@($_.rawIssues)} })
    }
    ConvertTo-Json -InputObject $report -Depth 8 -Compress
} catch {
    if ($transaction) { try { $transaction.Rollback() } catch {} }
    throw
} finally {
    if ($transaction) { $transaction.Dispose() }
    $connection.Dispose()
}
