param(
    [Parameter(Mandatory = $true)][string]$PackagePath,
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
$expectedSourceManifestSha256 = 'e549a5d5aed4846a3f4860284049e77d258e1a5c236f80d4ea858cec5eab1cc4'
$expectedEmptyInventorySha256 = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
$importerVersion = 'paws-empty-loader-v1'

$expectedTypedCounts = [ordered]@{
    account_role_raw = 14
    afc_record_raw = 798
    course_raw = 43
    doe_rule_raw = 24
    faculty_overview_raw = 118
    faculty_professional_raw = 116
    faculty_raw = 116
    joint_appointment_raw = 14
    role_assignment_raw = 162
    teaching_assignment_raw = 4974
}
$expectedNormalizedCounts = [ordered]@{
    afc_record = 791
    course = 43
    doe_rule_seed = 24
    faculty = 120
    faculty_alias = 5
    faculty_professional_profile = 116
    joint_appointment = 14
    role_assignment = 162
    role_definition = 14
    session = 1937
    session_assignment = 4970
}
$expectedValidationIssues = [ordered]@{
    TEACHING_FORMER_FACULTY_EXCLUDED = 4
    AFC_FORMER_FACULTY_EXCLUDED = 4
    AFC_END_BEFORE_START = 2
    AFC_FACULTY_MISSING = 1
    AFC_PURPOSE_MISSING = 1
    FACULTY_EMAIL_INVALID = 2
}
$expectedValidationIssueCount = 14
$expectedRawRowCount = 6838

if ($Server -ne $expectedServer) {
    throw "Refusing load: server '$Server' does not match reviewed server '$expectedServer'."
}
if ($Database -ne $expectedDatabase) {
    throw "Refusing load: database '$Database' does not match reviewed database '$expectedDatabase'."
}

$PackagePath = (Resolve-Path -LiteralPath $PackagePath).Path
$manifestPath = Join-Path $PackagePath 'manifest.json'
$summaryPath = Join-Path $PackagePath 'normalization_summary.json'
$issuesPath = Join-Path $PackagePath 'validation_issues.jsonl'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Package manifest is missing: $manifestPath" }
if (-not (Test-Path -LiteralPath $summaryPath -PathType Leaf)) { throw "Normalization summary is missing: $summaryPath" }
if (-not (Test-Path -LiteralPath $issuesPath -PathType Leaf)) { throw "Validation issue file is missing: $issuesPath" }

function Get-PawsJsonLines {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required package file is missing: $Path"
    }
    $items = @()
    foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
        if (-not [string]::IsNullOrWhiteSpace($line)) {
            $items += ($line | ConvertFrom-Json)
        }
    }
    return @($items)
}

function Get-PawsPropertyValue {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string[]]$Names
    )
    if ($null -eq $Object) { return $null }
    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties[$name]
        if ($null -ne $property) { return $property.Value }
    }
    return $null
}

function Convert-PawsGuid {
    param($Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    return [Guid]::Parse([string]$Value)
}

function Convert-PawsInt {
    param($Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    return [Convert]::ToInt32($Value, [Globalization.CultureInfo]::InvariantCulture)
}

function Convert-PawsDecimal {
    param($Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    return [Convert]::ToDecimal($Value, [Globalization.CultureInfo]::InvariantCulture)
}

function Convert-PawsBool {
    param($Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    if ($Value -is [bool]) { return [bool]$Value }
    return [bool]::Parse([string]$Value)
}

function Convert-PawsDate {
    param($Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    return [DateTime]::ParseExact(([string]$Value).Substring(0, 10), 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
}

function Convert-PawsTime {
    param($Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    return [TimeSpan]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture)
}

function Convert-PawsText {
    param($Value)
    if ($null -eq $Value) { return $null }
    return [string]$Value
}

function New-PawsDataTable {
    param([Parameter(Mandatory = $true)]$Definitions)
    $table = New-Object System.Data.DataTable
    foreach ($definition in $Definitions) {
        $column = New-Object System.Data.DataColumn
        $column.ColumnName = [string]$definition.Name
        $column.DataType = $definition.Type
        $column.AllowDBNull = $true
        [void]$table.Columns.Add($column)
    }
    return ,$table
}

function Add-PawsDataRow {
    param(
        [Parameter(Mandatory = $true)][System.Data.DataTable]$Table,
        [Parameter(Mandatory = $true)]
        [AllowNull()]
        [AllowEmptyString()]
        [object[]]$Values
    )
    if ($Values.Count -ne $Table.Columns.Count) {
        throw "Data row has $($Values.Count) values for $($Table.Columns.Count) columns."
    }
    $row = $Table.NewRow()
    for ($i = 0; $i -lt $Values.Count; $i++) {
        if ($null -eq $Values[$i]) {
            $row[$i] = [DBNull]::Value
        }
        else {
            $row[$i] = $Values[$i]
        }
    }
    [void]$Table.Rows.Add($row)
}

function Write-PawsBulkCopy {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlTransaction]$Transaction,
        [Parameter(Mandatory = $true)][string]$DestinationTable,
        [Parameter(Mandatory = $true)][System.Data.DataTable]$Table
    )
    if ($Table.Rows.Count -eq 0) { return }
    $options = [System.Data.SqlClient.SqlBulkCopyOptions]::CheckConstraints -bor [System.Data.SqlClient.SqlBulkCopyOptions]::KeepNulls
    $bulk = [System.Data.SqlClient.SqlBulkCopy]::new($Connection, $options, $Transaction)
    try {
        $bulk.DestinationTableName = $DestinationTable
        $bulk.BatchSize = 1000
        $bulk.BulkCopyTimeout = 120
        foreach ($column in $Table.Columns) {
            [void]$bulk.ColumnMappings.Add($column.ColumnName, $column.ColumnName)
        }
        $bulk.WriteToServer($Table)
    }
    finally {
        $bulk.Dispose()
    }
}

function Invoke-PawsSql {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlTransaction]$Transaction,
        [Parameter(Mandatory = $true)][string]$Sql
    )
    $cmd = $Connection.CreateCommand()
    $cmd.Transaction = $Transaction
    $cmd.CommandTimeout = 120
    $cmd.CommandText = $Sql
    [void]$cmd.ExecuteNonQuery()
}

function Get-PawsSqlScalar {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlTransaction]$Transaction,
        [Parameter(Mandatory = $true)][string]$Sql
    )
    $cmd = $Connection.CreateCommand()
    $cmd.Transaction = $Transaction
    $cmd.CommandTimeout = 120
    $cmd.CommandText = $Sql
    return $cmd.ExecuteScalar()
}

function Get-PawsInventory {
    param([Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection)
    $cmd = $Connection.CreateCommand()
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
    return [pscustomobject]@{
        objectCount = @($objects).Count
        inventorySha256 = (Get-PawsSha256Text -Text $canonical)
        objects = @($objects)
    }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ([string]$manifest.sourceManifestSha256 -ne $expectedSourceManifestSha256) {
    throw "Package source manifest SHA-256 mismatch. Expected $expectedSourceManifestSha256 but found $($manifest.sourceManifestSha256)."
}
if ([int]$manifest.totals.nonEmptyRows -ne $expectedRawRowCount) {
    throw "Raw package row count mismatch. Expected $expectedRawRowCount but found $($manifest.totals.nonEmptyRows)."
}
foreach ($key in $expectedTypedCounts.Keys) {
    $actual = [int](Get-PawsPropertyValue -Object $summary.typedCounts -Names @($key))
    if ($actual -ne [int]$expectedTypedCounts[$key]) {
        throw "Typed count mismatch for $key. Expected $($expectedTypedCounts[$key]) but found $actual."
    }
}
foreach ($key in $expectedNormalizedCounts.Keys) {
    $actual = [int](Get-PawsPropertyValue -Object $summary.normalizedCounts -Names @($key))
    if ($actual -ne [int]$expectedNormalizedCounts[$key]) {
        throw "Normalized count mismatch for $key. Expected $($expectedNormalizedCounts[$key]) but found $actual."
    }
}
if ([int]$summary.validationIssueCount -ne $expectedValidationIssueCount) {
    throw "validationIssueCount mismatch. Expected $expectedValidationIssueCount but found $($summary.validationIssueCount)."
}

$typedFiles = [ordered]@{
    account_role_raw = 'account_role_raw.jsonl'
    afc_record_raw = 'afc_record_raw.jsonl'
    course_raw = 'course_raw.jsonl'
    doe_rule_raw = 'doe_rule_raw.jsonl'
    faculty_overview_raw = 'faculty_overview_raw.jsonl'
    faculty_professional_raw = 'faculty_professional_raw.jsonl'
    faculty_raw = 'faculty_raw.jsonl'
    joint_appointment_raw = 'joint_appointment_raw.jsonl'
    role_assignment_raw = 'role_assignment_raw.jsonl'
    teaching_assignment_raw = 'teaching_assignment_raw.jsonl'
}
$normalizedFiles = [ordered]@{
    afc_record = 'afc_record.jsonl'
    course = 'course.jsonl'
    doe_rule_seed = 'doe_rule_seed.jsonl'
    faculty = 'faculty.jsonl'
    faculty_alias = 'faculty_alias.jsonl'
    faculty_professional_profile = 'faculty_professional_profile.jsonl'
    joint_appointment = 'joint_appointment.jsonl'
    role_assignment = 'role_assignment.jsonl'
    role_definition = 'role_definition.jsonl'
    session = 'session.jsonl'
    session_assignment = 'session_assignment.jsonl'
}

$rawRows = @(Get-PawsJsonLines -Path (Join-Path $PackagePath 'raw_rows.jsonl'))
if ($rawRows.Count -ne $expectedRawRowCount) { throw "raw_rows.jsonl line count mismatch." }

foreach ($key in $typedFiles.Keys) {
    $rows = @(Get-PawsJsonLines -Path (Join-Path $PackagePath $typedFiles[$key]))
    if ($rows.Count -ne [int]$expectedTypedCounts[$key]) {
        throw "$($typedFiles[$key]) line count mismatch."
    }
}
foreach ($key in $normalizedFiles.Keys) {
    $rows = @(Get-PawsJsonLines -Path (Join-Path $PackagePath $normalizedFiles[$key]))
    if ($rows.Count -ne [int]$expectedNormalizedCounts[$key]) {
        throw "$($normalizedFiles[$key]) line count mismatch."
    }
}

$validationIssues = @(Get-PawsJsonLines -Path $issuesPath)
if ($validationIssues.Count -ne $expectedValidationIssueCount) {
    throw "validation_issues.jsonl line count mismatch."
}
$actualIssueCounts = @{}
foreach ($issue in $validationIssues) {
    $code = [string]$issue.code
    if (-not $actualIssueCounts.ContainsKey($code)) { $actualIssueCounts[$code] = 0 }
    $actualIssueCounts[$code] = [int]$actualIssueCounts[$code] + 1
}
if ($actualIssueCounts.Count -ne $expectedValidationIssues.Count) {
    throw "Unexpected validation issue codes are present."
}
foreach ($code in $expectedValidationIssues.Keys) {
    if (-not $actualIssueCounts.ContainsKey($code) -or [int]$actualIssueCounts[$code] -ne [int]$expectedValidationIssues[$code]) {
        throw "Validation issue count mismatch for $code."
    }
}

$schemaRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'database\azure-sql'
$foundationSqlPath = Join-Path $schemaRoot '001_foundation.sql'
$calendarSqlPath = Join-Path $schemaRoot '002_calendar_view.sql'
if (-not (Test-Path -LiteralPath $foundationSqlPath -PathType Leaf)) { throw "Missing schema file: $foundationSqlPath" }
if (-not (Test-Path -LiteralPath $calendarSqlPath -PathType Leaf)) { throw "Missing schema file: $calendarSqlPath" }

$accessToken = Get-PawsSqlAccessToken -TenantId $TenantId
$connection = Open-PawsSqlConnection -Server $Server -Database $Database -AccessToken $accessToken
try {
    Assert-PawsDatabase -Connection $connection -ExpectedDatabase $expectedDatabase
    $inventory = Get-PawsInventory -Connection $connection
    if ([int]$inventory.objectCount -ne 0) {
        throw "Refusing load: database is not empty. objectCount=$($inventory.objectCount)."
    }
    if ([string]$inventory.inventorySha256 -ne $expectedEmptyInventorySha256) {
        throw "Refusing load: empty inventory SHA mismatch. Expected $expectedEmptyInventorySha256 but found $($inventory.inventorySha256)."
    }

    if (-not $Apply) {
        [pscustomobject][ordered]@{
            mode = 'preview'
            server = $Server
            database = $Database
            objectCount = [int]$inventory.objectCount
            inventorySha256 = [string]$inventory.inventorySha256
            sourceManifestSha256 = [string]$manifest.sourceManifestSha256
            rawRows = $expectedRawRowCount
            sessionAssignments = $expectedNormalizedCounts.session_assignment
            validationIssueCount = $expectedValidationIssueCount
            message = 'Package and empty database preflight passed. Re-run with -Apply to create the PAWS schemas and load the reviewed package.'
        } | ConvertTo-Json -Depth 6
        return
    }

    $transaction = $connection.BeginTransaction()
    try {
        $foundationSql = Get-Content -LiteralPath $foundationSqlPath -Raw -Encoding UTF8
        $calendarSql = Get-Content -LiteralPath $calendarSqlPath -Raw -Encoding UTF8
        Invoke-PawsSql -Connection $connection -Transaction $transaction -Sql $foundationSql
        Invoke-PawsSql -Connection $connection -Transaction $transaction -Sql $calendarSql

        $batchId = [Guid]::NewGuid()
        $startedAt = [DateTime]::UtcNow
        $summaryJson = $summary | ConvertTo-Json -Depth 20 -Compress

        $importBatchTable = New-PawsDataTable @(
            @{Name='ImportBatchId';Type=[Guid]},
            @{Name='StartedAtUtc';Type=[DateTime]},
            @{Name='CompletedAtUtc';Type=[DateTime]},
            @{Name='Status';Type=[string]},
            @{Name='SourceManifestSha256';Type=[string]},
            @{Name='ImporterVersion';Type=[string]},
            @{Name='ActorUpn';Type=[string]},
            @{Name='ValidationSummaryJson';Type=[string]}
        )
        Add-PawsDataRow $importBatchTable @($batchId,$startedAt,$null,'loading',$expectedSourceManifestSha256,$importerVersion,$null,$summaryJson)
        Write-PawsBulkCopy $connection $transaction 'staging.ImportBatch' $importBatchTable

        $workbookIds = @{}
        $sheetIds = @{}
        $workbookTable = New-PawsDataTable @(
            @{Name='ImportWorkbookId';Type=[Guid]},
            @{Name='ImportBatchId';Type=[Guid]},
            @{Name='FileName';Type=[string]},
            @{Name='FileSha256';Type=[string]},
            @{Name='FileByteLength';Type=[long]}
        )
        $sheetTable = New-PawsDataTable @(
            @{Name='ImportSheetId';Type=[Guid]},
            @{Name='ImportWorkbookId';Type=[Guid]},
            @{Name='SheetName';Type=[string]},
            @{Name='SheetIndex';Type=[int]},
            @{Name='MaxRow';Type=[int]},
            @{Name='MaxColumn';Type=[int]},
            @{Name='NonEmptyRowCount';Type=[int]}
        )
        foreach ($file in @($manifest.files)) {
            $workbookId = [Guid]::NewGuid()
            $workbookIds[[string]$file.fileName] = $workbookId
            Add-PawsDataRow $workbookTable @($workbookId,$batchId,[string]$file.fileName,[string]$file.fileSha256,[long]$file.fileByteLength)
            foreach ($sheet in @($file.sheets)) {
                $sheetId = [Guid]::NewGuid()
                $sheetName = [string]$sheet.sheet
                $sheetIds["$($file.fileName)|$sheetName"] = $sheetId
                Add-PawsDataRow $sheetTable @(
                    $sheetId,$workbookId,$sheetName,[int]$sheet.sheetIndex,[int]$sheet.maxRow,[int]$sheet.maxColumn,[int]$sheet.nonEmptyRows
                )
            }
        }
        Write-PawsBulkCopy $connection $transaction 'staging.ImportWorkbook' $workbookTable
        Write-PawsBulkCopy $connection $transaction 'staging.ImportSheet' $sheetTable

        $rawRowIds = @{}
        $rawTable = New-PawsDataTable @(
            @{Name='ImportRowId';Type=[Guid]},
            @{Name='ImportSheetId';Type=[Guid]},
            @{Name='SourceRowNumber';Type=[int]},
            @{Name='RawJson';Type=[string]},
            @{Name='FormulaJson';Type=[string]},
            @{Name='ValidationStatus';Type=[string]},
            @{Name='ValidationErrorsJson';Type=[string]}
        )
        foreach ($raw in $rawRows) {
            $rowId = [Guid]::NewGuid()
            $key = "$($raw.workbook)|$($raw.sheet)|$($raw.sourceRow)"
            $rawRowIds[$key] = $rowId
            $sheetKey = "$($raw.workbook)|$($raw.sheet)"
            if (-not $sheetIds.ContainsKey($sheetKey)) { throw "No ImportSheet mapping for $sheetKey." }
            $formulas = @()
            foreach ($cell in @($raw.cells)) {
                if (-not [string]::IsNullOrWhiteSpace([string]$cell.formula)) {
                    $formulas += [pscustomobject]@{ coordinate=[string]$cell.coordinate; formula=[string]$cell.formula }
                }
            }
            $formulaJson = $null
            if ($formulas.Count -gt 0) { $formulaJson = @($formulas) | ConvertTo-Json -Depth 6 -Compress }
            $rawJson = $raw | ConvertTo-Json -Depth 30 -Compress
            Add-PawsDataRow $rawTable @($rowId,$sheetIds[$sheetKey],[int]$raw.sourceRow,$rawJson,$formulaJson,'raw','[]')
        }
        Write-PawsBulkCopy $connection $transaction 'staging.ImportRow' $rawTable

        function Get-TypedContext {
            param($Row)
            $key = "$($Row.sourceWorkbook)|$($Row.sourceSheet)|$($Row.sourceRow)"
            if (-not $rawRowIds.ContainsKey($key)) { throw "No generic raw row mapping for $key." }
            $errors = @($Row.validationErrors)
            $errorsJson = @($errors) | ConvertTo-Json -Depth 10 -Compress
            if ([string]::IsNullOrWhiteSpace($errorsJson)) { $errorsJson = '[]' }
            return [pscustomobject]@{
                ImportRowId = $rawRowIds[$key]
                SourceRow = [int]$Row.sourceRow
                Fields = $Row.fields
                RawJson = ($Row | ConvertTo-Json -Depth 30 -Compress)
                Status = [string]$Row.validationStatus
                ErrorsJson = $errorsJson
            }
        }

        $facultyRawRows = @(Get-PawsJsonLines (Join-Path $PackagePath 'faculty_raw.jsonl'))
        $table = New-PawsDataTable @(
            @{Name='ImportBatchId';Type=[Guid]},@{Name='ImportRowId';Type=[Guid]},@{Name='SourceRowNumber';Type=[int]},
            @{Name='PreferredSourceName';Type=[string]},@{Name='Ucid';Type=[string]},@{Name='Email';Type=[string]},
            @{Name='RawJson';Type=[string]},@{Name='ValidationStatus';Type=[string]},@{Name='ValidationErrorsJson';Type=[string]}
        )
        foreach ($row in $facultyRawRows) {
            $c = Get-TypedContext $row
            Add-PawsDataRow $table @($batchId,$c.ImportRowId,$c.SourceRow,(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('preferred_full_name_last_first'))),(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('ucid'))),(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('email'))),$c.RawJson,$c.Status,$c.ErrorsJson)
        }
        Write-PawsBulkCopy $connection $transaction 'staging.FacultyRaw' $table

        $table = New-PawsDataTable @(
            @{Name='ImportBatchId';Type=[Guid]},@{Name='ImportRowId';Type=[Guid]},@{Name='SourceRowNumber';Type=[int]},
            @{Name='PreferredSourceName';Type=[string]},@{Name='RawJson';Type=[string]},@{Name='ValidationStatus';Type=[string]},@{Name='ValidationErrorsJson';Type=[string]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'faculty_professional_raw.jsonl'))) {
            $c = Get-TypedContext $row
            Add-PawsDataRow $table @($batchId,$c.ImportRowId,$c.SourceRow,(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('preferred_full_name_last_first'))),$c.RawJson,$c.Status,$c.ErrorsJson)
        }
        Write-PawsBulkCopy $connection $transaction 'staging.FacultyProfessionalRaw' $table

        $table = New-PawsDataTable @(
            @{Name='ImportBatchId';Type=[Guid]},@{Name='ImportRowId';Type=[Guid]},@{Name='SourceRowNumber';Type=[int]},
            @{Name='PreferredSourceName';Type=[string]},@{Name='RawJson';Type=[string]},@{Name='ValidationStatus';Type=[string]},@{Name='ValidationErrorsJson';Type=[string]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'joint_appointment_raw.jsonl'))) {
            $c = Get-TypedContext $row
            Add-PawsDataRow $table @($batchId,$c.ImportRowId,$c.SourceRow,(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('preferred_full_name_last_first'))),$c.RawJson,$c.Status,$c.ErrorsJson)
        }
        Write-PawsBulkCopy $connection $transaction 'staging.JointAppointmentRaw' $table

        $table = New-PawsDataTable @(
            @{Name='ImportBatchId';Type=[Guid]},@{Name='ImportRowId';Type=[Guid]},@{Name='SourceRowNumber';Type=[int]},
            @{Name='FacultySourceName';Type=[string]},@{Name='RawJson';Type=[string]},@{Name='ValidationStatus';Type=[string]},@{Name='ValidationErrorsJson';Type=[string]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'faculty_overview_raw.jsonl'))) {
            $c = Get-TypedContext $row
            Add-PawsDataRow $table @($batchId,$c.ImportRowId,$c.SourceRow,(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('faculty_name'))),$c.RawJson,$c.Status,$c.ErrorsJson)
        }
        Write-PawsBulkCopy $connection $transaction 'staging.FacultyOverviewRaw' $table

        $table = New-PawsDataTable @(
            @{Name='ImportBatchId';Type=[Guid]},@{Name='ImportRowId';Type=[Guid]},@{Name='SourceRowNumber';Type=[int]},
            @{Name='FacultySourceName';Type=[string]},@{Name='AcademicYear';Type=[string]},@{Name='CourseCode';Type=[string]},
            @{Name='SessionDate';Type=[DateTime]},@{Name='StartTime';Type=[TimeSpan]},@{Name='EndTime';Type=[TimeSpan]},
            @{Name='RawJson';Type=[string]},@{Name='ValidationStatus';Type=[string]},@{Name='ValidationErrorsJson';Type=[string]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'teaching_assignment_raw.jsonl'))) {
            $c = Get-TypedContext $row
            Add-PawsDataRow $table @(
                $batchId,$c.ImportRowId,$c.SourceRow,
                (Convert-PawsText (Get-PawsPropertyValue $c.Fields @('faculty_name'))),
                (Convert-PawsText (Get-PawsPropertyValue $c.Fields @('academic_year'))),
                (Convert-PawsText (Get-PawsPropertyValue $c.Fields @('course'))),
                (Convert-PawsDate (Get-PawsPropertyValue $c.Fields @('date'))),
                (Convert-PawsTime (Get-PawsPropertyValue $c.Fields @('start'))),
                (Convert-PawsTime (Get-PawsPropertyValue $c.Fields @('end'))),
                $c.RawJson,$c.Status,$c.ErrorsJson
            )
        }
        Write-PawsBulkCopy $connection $transaction 'staging.TeachingAssignmentRaw' $table

        $table = New-PawsDataTable @(
            @{Name='ImportBatchId';Type=[Guid]},@{Name='ImportRowId';Type=[Guid]},@{Name='SourceRowNumber';Type=[int]},
            @{Name='FacultySourceName';Type=[string]},@{Name='AcademicYear';Type=[string]},@{Name='RoleType';Type=[string]},@{Name='CourseCode';Type=[string]},
            @{Name='RawJson';Type=[string]},@{Name='ValidationStatus';Type=[string]},@{Name='ValidationErrorsJson';Type=[string]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'role_assignment_raw.jsonl'))) {
            $c = Get-TypedContext $row
            Add-PawsDataRow $table @($batchId,$c.ImportRowId,$c.SourceRow,(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('faculty_name'))),(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('academic_year'))),(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('role_type'))),(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('course'))),$c.RawJson,$c.Status,$c.ErrorsJson)
        }
        Write-PawsBulkCopy $connection $transaction 'staging.RoleAssignmentRaw' $table

        $table = New-PawsDataTable @(
            @{Name='ImportBatchId';Type=[Guid]},@{Name='ImportRowId';Type=[Guid]},@{Name='SourceRowNumber';Type=[int]},
            @{Name='CourseCode';Type=[string]},@{Name='CourseName';Type=[string]},@{Name='RawJson';Type=[string]},@{Name='ValidationStatus';Type=[string]},@{Name='ValidationErrorsJson';Type=[string]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'course_raw.jsonl'))) {
            $c = Get-TypedContext $row
            Add-PawsDataRow $table @($batchId,$c.ImportRowId,$c.SourceRow,(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('course'))),(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('course_name'))),$c.RawJson,$c.Status,$c.ErrorsJson)
        }
        Write-PawsBulkCopy $connection $transaction 'staging.CourseRaw' $table

        $table = New-PawsDataTable @(
            @{Name='ImportBatchId';Type=[Guid]},@{Name='ImportRowId';Type=[Guid]},@{Name='SourceRowNumber';Type=[int]},
            @{Name='Category';Type=[string]},@{Name='RuleLabel';Type=[string]},@{Name='RawJson';Type=[string]},@{Name='ValidationStatus';Type=[string]},@{Name='ValidationErrorsJson';Type=[string]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'doe_rule_raw.jsonl'))) {
            $c = Get-TypedContext $row
            Add-PawsDataRow $table @($batchId,$c.ImportRowId,$c.SourceRow,(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('category'))),(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('rule_label','doe_rule','rule','label'))),$c.RawJson,$c.Status,$c.ErrorsJson)
        }
        Write-PawsBulkCopy $connection $transaction 'staging.DoeRuleRaw' $table

        $table = New-PawsDataTable @(
            @{Name='ImportBatchId';Type=[Guid]},@{Name='ImportRowId';Type=[Guid]},@{Name='SourceRowNumber';Type=[int]},
            @{Name='DatabaseRole';Type=[string]},@{Name='RawJson';Type=[string]},@{Name='ValidationStatus';Type=[string]},@{Name='ValidationErrorsJson';Type=[string]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'account_role_raw.jsonl'))) {
            $c = Get-TypedContext $row
            Add-PawsDataRow $table @($batchId,$c.ImportRowId,$c.SourceRow,(Convert-PawsText (Get-PawsPropertyValue $c.Fields @('database_role'))),$c.RawJson,$c.Status,$c.ErrorsJson)
        }
        Write-PawsBulkCopy $connection $transaction 'staging.AccountRoleRaw' $table

        $table = New-PawsDataTable @(
            @{Name='ImportBatchId';Type=[Guid]},@{Name='ImportRowId';Type=[Guid]},@{Name='SourceRowNumber';Type=[int]},
            @{Name='FacultySourceName';Type=[string]},@{Name='StartDate';Type=[DateTime]},@{Name='EndDate';Type=[DateTime]},@{Name='Purpose';Type=[string]},
            @{Name='RawJson';Type=[string]},@{Name='ValidationStatus';Type=[string]},@{Name='ValidationErrorsJson';Type=[string]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'afc_record_raw.jsonl'))) {
            $c = Get-TypedContext $row
            Add-PawsDataRow $table @(
                $batchId,$c.ImportRowId,$c.SourceRow,
                (Convert-PawsText (Get-PawsPropertyValue $c.Fields @('faculty_member'))),
                (Convert-PawsDate (Get-PawsPropertyValue $c.Fields @('start'))),
                (Convert-PawsDate (Get-PawsPropertyValue $c.Fields @('end'))),
                (Convert-PawsText (Get-PawsPropertyValue $c.Fields @('purpose'))),
                $c.RawJson,$c.Status,$c.ErrorsJson
            )
        }
        Write-PawsBulkCopy $connection $transaction 'staging.AfcRecordRaw' $table

        $packageEntityTable = New-PawsDataTable @(
            @{Name='PackageEntityId';Type=[Guid]},@{Name='ImportBatchId';Type=[Guid]},@{Name='EntityKind';Type=[string]},
            @{Name='SourceFileName';Type=[string]},@{Name='SourceRowNumber';Type=[int]},@{Name='PayloadJson';Type=[string]}
        )
        foreach ($issue in $validationIssues) {
            Add-PawsDataRow $packageEntityTable @([Guid]::NewGuid(),$batchId,'validation_issue',$null,(Convert-PawsInt $issue.sourceRow),($issue | ConvertTo-Json -Depth 15 -Compress))
        }
        Write-PawsBulkCopy $connection $transaction 'staging.PackageEntity' $packageEntityTable

        $facultyRows = @(Get-PawsJsonLines (Join-Path $PackagePath 'faculty.jsonl'))
        $table = New-PawsDataTable @(
            @{Name='FacultyId';Type=[Guid]},@{Name='RecordType';Type=[string]},@{Name='PreferredFirstName';Type=[string]},@{Name='PreferredLastName';Type=[string]},
            @{Name='DisplayName';Type=[string]},@{Name='Ucid';Type=[string]},@{Name='Email';Type=[string]},@{Name='Stream';Type=[string]},@{Name='Rank';Type=[string]},
            @{Name='Fte';Type=[decimal]},@{Name='ReportsToFacultyId';Type=[Guid]},@{Name='ReportsToRaw';Type=[string]},@{Name='Active';Type=[bool]},
            @{Name='SourceImportBatchId';Type=[Guid]},@{Name='SourceRow';Type=[int]}
        )
        foreach ($row in $facultyRows) {
            Add-PawsDataRow $table @(
                (Convert-PawsGuid $row.facultyId),(Convert-PawsText $row.recordType),(Convert-PawsText $row.preferredFirstName),(Convert-PawsText $row.preferredLastName),
                (Convert-PawsText $row.displayName),(Convert-PawsText $row.ucid),(Convert-PawsText $row.email),(Convert-PawsText $row.stream),(Convert-PawsText $row.rank),
                (Convert-PawsDecimal $row.fte),$null,(Convert-PawsText $row.reportsToRaw),(Convert-PawsBool $row.active),$batchId,(Convert-PawsInt $row.sourceRow)
            )
        }
        Write-PawsBulkCopy $connection $transaction 'paws.Faculty' $table

        $table = New-PawsDataTable @(
            @{Name='FacultyAliasId';Type=[Guid]},@{Name='FacultyId';Type=[Guid]},@{Name='AliasName';Type=[string]},@{Name='TargetPreferredSourceName';Type=[string]},
            @{Name='TargetDisplayName';Type=[string]},@{Name='Active';Type=[bool]},@{Name='SourceImportBatchId';Type=[Guid]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'faculty_alias.jsonl'))) {
            Add-PawsDataRow $table @((Convert-PawsGuid $row.facultyAliasId),(Convert-PawsGuid $row.facultyId),(Convert-PawsText $row.aliasName),(Convert-PawsText $row.targetPreferredSourceName),(Convert-PawsText $row.targetDisplayName),(Convert-PawsBool $row.active),$batchId)
        }
        Write-PawsBulkCopy $connection $transaction 'paws.FacultyAlias' $table

        $table = New-PawsDataTable @(
            @{Name='FacultyId';Type=[Guid]},@{Name='TeachingArea';Type=[string]},@{Name='ProfessionalCategory';Type=[string]},@{Name='ServiceDate';Type=[DateTime]},
            @{Name='PriorYearsExperience';Type=[decimal]},@{Name='DvmEarnedDate';Type=[string]},@{Name='DvmType';Type=[string]},@{Name='MastersEarnedDate';Type=[string]},
            @{Name='MastersArea';Type=[string]},@{Name='PhdEarnedDate';Type=[string]},@{Name='PhdArea';Type=[string]},@{Name='BoardCertifiedDate';Type=[string]},
            @{Name='BoardCertification';Type=[string]},@{Name='BoardCertificationCount';Type=[decimal]},@{Name='AbvmaLicenseNumber';Type=[string]},
            @{Name='AbvmaMemberType';Type=[string]},@{Name='SourceImportBatchId';Type=[Guid]},@{Name='SourceRow';Type=[int]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'faculty_professional_profile.jsonl'))) {
            Add-PawsDataRow $table @(
                (Convert-PawsGuid $row.facultyId),(Convert-PawsText $row.teachingArea),(Convert-PawsText $row.professionalCategory),(Convert-PawsDate $row.serviceDate),
                (Convert-PawsDecimal $row.priorYearsExperience),(Convert-PawsText $row.dvmEarnedDate),(Convert-PawsText $row.dvmType),(Convert-PawsText $row.mastersEarnedDate),
                (Convert-PawsText $row.mastersArea),(Convert-PawsText $row.phdEarnedDate),(Convert-PawsText $row.phdArea),(Convert-PawsText $row.boardCertifiedDate),
                (Convert-PawsText $row.boardCertification),(Convert-PawsDecimal $row.boardCertificationCount),(Convert-PawsText $row.abvmaLicenseNumber),
                (Convert-PawsText $row.abvmaMemberType),$batchId,(Convert-PawsInt $row.sourceRow)
            )
        }
        Write-PawsBulkCopy $connection $transaction 'paws.FacultyProfessionalProfile' $table

        $table = New-PawsDataTable @(
            @{Name='JointAppointmentId';Type=[Guid]},@{Name='FacultyId';Type=[Guid]},@{Name='HomeFaculty';Type=[string]},@{Name='JointFaculty';Type=[string]},
            @{Name='FteUcvm';Type=[decimal]},@{Name='FteOtherFaculty';Type=[decimal]},@{Name='ExpiryDate';Type=[DateTime]},@{Name='Notes';Type=[string]},
            @{Name='SourceImportBatchId';Type=[Guid]},@{Name='SourceRow';Type=[int]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'joint_appointment.jsonl'))) {
            Add-PawsDataRow $table @((Convert-PawsGuid $row.jointAppointmentId),(Convert-PawsGuid $row.facultyId),(Convert-PawsText $row.homeFaculty),(Convert-PawsText $row.jointFaculty),(Convert-PawsDecimal $row.fteUcvm),(Convert-PawsDecimal $row.fteOtherFaculty),(Convert-PawsDate $row.expiryDate),(Convert-PawsText $row.notes),$batchId,(Convert-PawsInt $row.sourceRow))
        }
        Write-PawsBulkCopy $connection $transaction 'paws.JointAppointment' $table

        $courseRows = @(Get-PawsJsonLines (Join-Path $PackagePath 'course.jsonl'))
        $courseIdByCode = @{}
        $table = New-PawsDataTable @(
            @{Name='CourseId';Type=[Guid]},@{Name='CourseCode';Type=[string]},@{Name='CourseName';Type=[string]},@{Name='NameStatus';Type=[string]},
            @{Name='Source';Type=[string]},@{Name='SourceUrl';Type=[string]},@{Name='SourceImportBatchId';Type=[Guid]},@{Name='SourceRow';Type=[int]}
        )
        foreach ($row in $courseRows) {
            $courseId = Convert-PawsGuid $row.courseId
            $courseCode = Convert-PawsText $row.courseCode
            if (-not [string]::IsNullOrWhiteSpace($courseCode)) { $courseIdByCode[$courseCode] = $courseId }
            Add-PawsDataRow $table @($courseId,$courseCode,(Convert-PawsText $row.courseName),(Convert-PawsText $row.nameStatus),(Convert-PawsText $row.source),(Convert-PawsText $row.sourceUrl),$batchId,(Convert-PawsInt $row.sourceRow))
        }
        Write-PawsBulkCopy $connection $transaction 'paws.Course' $table

        $table = New-PawsDataTable @(
            @{Name='SessionId';Type=[Guid]},@{Name='AcademicYear';Type=[string]},@{Name='CurriculumYear';Type=[string]},@{Name='CourseId';Type=[Guid]},
            @{Name='CourseCode';Type=[string]},@{Name='CourseName';Type=[string]},@{Name='Topic';Type=[string]},@{Name='SessionType';Type=[string]},
            @{Name='SessionDate';Type=[DateTime]},@{Name='StartTime';Type=[TimeSpan]},@{Name='EndTime';Type=[TimeSpan]},@{Name='Room';Type=[string]},@{Name='SourceImportBatchId';Type=[Guid]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'session.jsonl'))) {
            $courseId = $null
            $code = Convert-PawsText $row.courseCode
            if ($null -ne $code -and $courseIdByCode.ContainsKey($code)) { $courseId = $courseIdByCode[$code] }
            Add-PawsDataRow $table @((Convert-PawsGuid $row.sessionId),(Convert-PawsText $row.academicYear),(Convert-PawsText $row.curriculumYear),$courseId,$code,(Convert-PawsText $row.courseName),(Convert-PawsText $row.topic),(Convert-PawsText $row.sessionType),(Convert-PawsDate $row.date),(Convert-PawsTime $row.start),(Convert-PawsTime $row.end),$null,$batchId)
        }
        Write-PawsBulkCopy $connection $transaction 'paws.Session' $table

        $table = New-PawsDataTable @(
            @{Name='SessionAssignmentId';Type=[Guid]},@{Name='SessionId';Type=[Guid]},@{Name='FacultyId';Type=[Guid]},@{Name='SourceFacultyName';Type=[string]},
            @{Name='FacultyResolutionStatus';Type=[string]},@{Name='TeachingRole';Type=[string]},@{Name='LabLead';Type=[string]},@{Name='CreditedHours';Type=[decimal]},
            @{Name='DoeRate';Type=[decimal]},@{Name='DoeQuantity';Type=[decimal]},@{Name='DoeUnit';Type=[string]},@{Name='DoeCredit';Type=[decimal]},
            @{Name='DoeStatus';Type=[string]},@{Name='SourceImportBatchId';Type=[Guid]},@{Name='SourceRow';Type=[int]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'session_assignment.jsonl'))) {
            Add-PawsDataRow $table @(
                (Convert-PawsGuid $row.sessionAssignmentId),(Convert-PawsGuid $row.sessionId),(Convert-PawsGuid $row.facultyId),(Convert-PawsText $row.sourceFacultyName),
                (Convert-PawsText $row.facultyResolutionStatus),(Convert-PawsText $row.teachingRole),(Convert-PawsText $row.labLead),(Convert-PawsDecimal $row.creditedHours),
                (Convert-PawsDecimal $row.doeRate),(Convert-PawsDecimal $row.doeQuantity),(Convert-PawsText $row.doeUnit),(Convert-PawsDecimal $row.doeCredit),
                (Convert-PawsText $row.doeStatus),$batchId,(Convert-PawsInt $row.sourceRow)
            )
        }
        Write-PawsBulkCopy $connection $transaction 'paws.SessionAssignment' $table

        $table = New-PawsDataTable @(
            @{Name='AfcRecordId';Type=[Guid]},@{Name='FacultyId';Type=[Guid]},@{Name='StartDate';Type=[DateTime]},@{Name='EndDate';Type=[DateTime]},
            @{Name='Purpose';Type=[string]},@{Name='Active';Type=[bool]},@{Name='SourceImportBatchId';Type=[Guid]},@{Name='SourceRow';Type=[int]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'afc_record.jsonl'))) {
            Add-PawsDataRow $table @((Convert-PawsGuid $row.afcRecordId),(Convert-PawsGuid $row.facultyId),(Convert-PawsDate $row.startDate),(Convert-PawsDate $row.endDate),(Convert-PawsText $row.purpose),(Convert-PawsBool $row.active),$batchId,(Convert-PawsInt $row.sourceRow))
        }
        Write-PawsBulkCopy $connection $transaction 'paws.AfcRecord' $table

        $table = New-PawsDataTable @(
            @{Name='RoleAssignmentId';Type=[Guid]},@{Name='FacultyId';Type=[Guid]},@{Name='SourceFacultyName';Type=[string]},@{Name='FacultyResolutionStatus';Type=[string]},
            @{Name='AcademicYear';Type=[string]},@{Name='RoleCategory';Type=[string]},@{Name='RoleType';Type=[string]},@{Name='CourseId';Type=[Guid]},
            @{Name='CourseOrSubjectOrRotation';Type=[string]},@{Name='CourseName';Type=[string]},@{Name='Details';Type=[string]},@{Name='EffectiveDate';Type=[DateTime]},
            @{Name='ExpirationDate';Type=[DateTime]},@{Name='DoeMappedValue';Type=[decimal]},@{Name='DoeOverrideValue';Type=[decimal]},@{Name='DoeOverrideReason';Type=[string]},
            @{Name='SpecialNotes';Type=[string]},@{Name='SourceImportBatchId';Type=[Guid]},@{Name='SourceRow';Type=[int]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'role_assignment.jsonl'))) {
            $courseId = $null
            $code = Convert-PawsText $row.courseCode
            if ($null -ne $code -and $courseIdByCode.ContainsKey($code)) { $courseId = $courseIdByCode[$code] }
            Add-PawsDataRow $table @(
                (Convert-PawsGuid $row.roleAssignmentId),(Convert-PawsGuid $row.facultyId),(Convert-PawsText $row.sourceFacultyName),(Convert-PawsText $row.facultyResolutionStatus),
                (Convert-PawsText $row.academicYear),$null,(Convert-PawsText $row.roleType),$courseId,(Convert-PawsText $row.courseOrSubjectOrRotation),
                (Convert-PawsText $row.courseName),(Convert-PawsText $row.details),(Convert-PawsDate $row.effectiveDate),(Convert-PawsDate $row.expirationDate),
                (Convert-PawsDecimal $row.doeMappedValue),(Convert-PawsDecimal $row.doeOverrideValue),(Convert-PawsText $row.doeOverrideReason),
                (Convert-PawsText $row.specialNotes),$batchId,(Convert-PawsInt $row.sourceRow)
            )
        }
        Write-PawsBulkCopy $connection $transaction 'paws.RoleAssignment' $table

        $table = New-PawsDataTable @(
            @{Name='DoeRuleSeedId';Type=[Guid]},@{Name='Category';Type=[string]},@{Name='RuleLabel';Type=[string]},@{Name='AcademicYearOrStage';Type=[string]},
            @{Name='RateOrTierPct';Type=[string]},@{Name='Basis';Type=[string]},@{Name='RequiredInput';Type=[string]},@{Name='CalculationOrNote';Type=[string]},
            @{Name='AuthoritativeInExcel';Type=[string]},@{Name='SourceUrl';Type=[string]},@{Name='RawJson';Type=[string]},@{Name='SourceImportBatchId';Type=[Guid]},@{Name='SourceRow';Type=[int]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'doe_rule_seed.jsonl'))) {
            Add-PawsDataRow $table @(
                (Convert-PawsGuid $row.doeRuleSeedId),
                (Convert-PawsText (Get-PawsPropertyValue $row @('category'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('rule_label','doe_rule','rule','label'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('academic_year_or_stage','academic_year_stage','year_or_stage'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('rate_or_tier_pct','rate_tier_pct','rate_or_tier','rate_tier'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('basis'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('required_input'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('calculation_or_note','calculation_note','calculation','note'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('authoritative_in_excel','authoritative'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('source_url'))),
                ($row | ConvertTo-Json -Depth 20 -Compress),$batchId,(Convert-PawsInt $row.sourceRow)
            )
        }
        Write-PawsBulkCopy $connection $transaction 'paws.DoeRuleSeed' $table

        $table = New-PawsDataTable @(
            @{Name='RoleDefinitionId';Type=[Guid]},@{Name='DatabaseRole';Type=[string]},@{Name='Category';Type=[string]},@{Name='FacultyLinked';Type=[string]},
            @{Name='FacultyRolesAllowed';Type=[string]},@{Name='DefaultOfficeAccess';Type=[string]},@{Name='OfficeAccessNotes';Type=[string]},
            @{Name='CurrentStatusNotes';Type=[string]},@{Name='SourceUrl';Type=[string]},@{Name='SourceImportBatchId';Type=[Guid]},@{Name='SourceRow';Type=[int]}
        )
        foreach ($row in @(Get-PawsJsonLines (Join-Path $PackagePath 'role_definition.jsonl'))) {
            Add-PawsDataRow $table @(
                (Convert-PawsGuid $row.roleDefinitionId),
                (Convert-PawsText (Get-PawsPropertyValue $row @('database_role'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('category'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('faculty_linked'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('faculty_roles_allowed'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('default_office_access'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('office_access_notes'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('current_status_notes'))),
                (Convert-PawsText (Get-PawsPropertyValue $row @('source_url'))),
                $batchId,(Convert-PawsInt $row.sourceRow)
            )
        }
        Write-PawsBulkCopy $connection $transaction 'paws.RoleDefinition' $table

        $countChecks = [ordered]@{
            'staging.ImportRow' = 6838
            'staging.FacultyRaw' = 116
            'staging.FacultyProfessionalRaw' = 116
            'staging.JointAppointmentRaw' = 14
            'staging.FacultyOverviewRaw' = 118
            'staging.TeachingAssignmentRaw' = 4974
            'staging.RoleAssignmentRaw' = 162
            'staging.CourseRaw' = 43
            'staging.DoeRuleRaw' = 24
            'staging.AccountRoleRaw' = 14
            'staging.AfcRecordRaw' = 798
            'staging.PackageEntity' = 14
            'paws.Faculty' = 120
            'paws.FacultyAlias' = 5
            'paws.FacultyProfessionalProfile' = 116
            'paws.JointAppointment' = 14
            'paws.Course' = 43
            'paws.Session' = 1937
            'paws.SessionAssignment' = 4970
            'paws.AfcRecord' = 791
            'paws.RoleAssignment' = 162
            'paws.DoeRuleSeed' = 24
            'paws.RoleDefinition' = 14
            'paws.vCalendarSession' = 1937
        }
        foreach ($tableName in $countChecks.Keys) {
            $actual = [long](Get-PawsSqlScalar $connection $transaction "SELECT COUNT_BIG(*) FROM $tableName;")
            if ($actual -ne [long]$countChecks[$tableName]) {
                throw "Post-load count mismatch for $tableName. Expected $($countChecks[$tableName]) but found $actual."
            }
        }

        $erinAssignments = [long](Get-PawsSqlScalar $connection $transaction "SELECT COUNT_BIG(*) FROM paws.SessionAssignment WHERE SourceFacultyName = N'Zachar, Erin';")
        if ($erinAssignments -ne 0) { throw 'Former faculty Erin Zachar is present in canonical SessionAssignment.' }
        $erinRoles = [long](Get-PawsSqlScalar $connection $transaction "SELECT COUNT_BIG(*) FROM paws.RoleAssignment WHERE SourceFacultyName = N'Zachar, Erin';")
        if ($erinRoles -ne 0) { throw 'Former faculty Erin Zachar is present in canonical RoleAssignment.' }
        $erinFaculty = [long](Get-PawsSqlScalar $connection $transaction "SELECT COUNT_BIG(*) FROM paws.Faculty WHERE PreferredFirstName = N'Erin' AND PreferredLastName = N'Zachar';")
        if ($erinFaculty -ne 0) { throw 'Former faculty Erin Zachar is present in canonical Faculty.' }

        $constraintCmd = $connection.CreateCommand()
        $constraintCmd.Transaction = $transaction
        $constraintCmd.CommandTimeout = 120
        $constraintCmd.CommandText = 'DBCC CHECKCONSTRAINTS WITH ALL_CONSTRAINTS;'
        $constraintReader = $constraintCmd.ExecuteReader()
        $violationCount = 0
        while ($constraintReader.Read()) { $violationCount += 1 }
        $constraintReader.Close()
        if ($violationCount -ne 0) { throw "Constraint verification reported $violationCount violations." }

        $completeCmd = $connection.CreateCommand()
        $completeCmd.Transaction = $transaction
        $completeCmd.CommandText = @'
UPDATE staging.ImportBatch
SET CompletedAtUtc = SYSUTCDATETIME(),
    Status = N'complete'
WHERE ImportBatchId = @ImportBatchId;

SELECT CAST(@@ROWCOUNT AS int);
'@

[void]$completeCmd.Parameters.Add(
    '@ImportBatchId',
    [System.Data.SqlDbType]::UniqueIdentifier
)

$completeCmd.Parameters['@ImportBatchId'].Value = $batchId

$completedRows = [int]$completeCmd.ExecuteScalar()

if ($completedRows -ne 1) {
    throw "ImportBatch completion update failed. Rows affected: $completedRows; ImportBatchId: $batchId"
}

        $transaction.Commit()

        [pscustomobject][ordered]@{
            mode = 'applied'
            server = $Server
            database = $Database
            importBatchId = [string]$batchId
            sourceManifestSha256 = $expectedSourceManifestSha256
            inventorySha256BeforeLoad = $expectedEmptyInventorySha256
            rawRows = 6838
            teachingAssignmentRaw = 4974
            canonicalSessions = 1937
            canonicalSessionAssignments = 4970
            afcRaw = 798
            canonicalAfcRecords = 791
            validationIssueCount = 14
            formerFacultyExcluded = @{
                teachingAssignments = 4
                afcRecords = 4
            }
        } | ConvertTo-Json -Depth 8
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
