[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [ValidateSet('DryRun', 'Apply')][string]$Mode = 'DryRun'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$TargetHost = 'ITAPPVETOPSDB01'
$Database = 'VetMed-Ops'
$AcademicYear = '2026-27'
$VersionLabel = 'Faculty Master List DOE/FTE snapshot 2026-27'
$AcceptedWorkbookName = 'PAWS_DOE_FTE_Import_2026-27.csv'
$AcceptedWorkbookSha256 = '0FA2FC2F9A9BEEB071AD7ADDA918292183ACBA83656B4C3C16DA6722B70C3EA2'
$SourceReference = 'PAWS_DOE_FTE_Import_2026-27.csv | SHA256 0FA2FC2F9A9BEEB071AD7ADDA918292183ACBA83656B4C3C16DA6722B70C3EA2 | exact unique UCID'
$PolicySourceReference = "$SourceReference; UCVM Workload Guidelines; Leadership approved 2025-02-26; Faculty Council approved 2025-03-12; effective 2025-04-01; updated 2025-12-23"
$CategoryCodes = @('scholarly_activity', 'ppvm_cost_share', 'clinical_unsorted', 'clinical_teaching', 'clinical_activity_ppvm', 'research', 'contract_admin', 'service_admin', 'other', 'onboarding')

if ([System.Net.Dns]::GetHostName() -ne $TargetHost) { throw 'The DOE import must run locally on ITAPPVETOPSDB01.' }

function Normalize-Ucid([object]$Value) {
    if ($null -eq $Value) { return '' }
    return ([string]$Value).Trim()
}

function Normalize-Name([object]$Value) {
    if ($null -eq $Value) { return '' }
    $text = ([string]$Value).Normalize([System.Text.NormalizationForm]::FormKC).Trim()
    return [System.Text.RegularExpressions.Regex]::Replace($text, '\s+', ' ').ToLowerInvariant()
}

function Normalize-NameWithoutPunctuation([object]$Value) {
    $name = Normalize-Name $Value
    return [System.Text.RegularExpressions.Regex]::Replace($name, '[\p{P}\p{S}]', '')
}

function Reverse-CommaName([object]$Value) {
    $name = Normalize-Name $Value
    $parts = @($name.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($parts.Count -lt 2) { return '' }
    return Normalize-Name (($parts[1..($parts.Count - 1)] + $parts[0]) -join ' ')
}

function New-Connection {
    $connection = [System.Data.SqlClient.SqlConnection]::new("Server=tcp:ITAPPVETOPSDB01.uc.ucalgary.ca,1433;Initial Catalog=$Database;Integrated Security=SSPI;Encrypt=True;TrustServerCertificate=False;Connect Timeout=20;Application Name=PAWS-DOE-Snapshot-Import;")
    $connection.Open()
    return $connection
}

function Invoke-Query([System.Data.SqlClient.SqlConnection]$Connection, [string]$Sql) {
    $command = $Connection.CreateCommand()
    $command.CommandText = $Sql
    try {
        $reader = $command.ExecuteReader()
        $rows = [System.Collections.Generic.List[object]]::new()
        while ($reader.Read()) {
            $item = [ordered]@{}
            for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                $value = if ($reader.IsDBNull($i)) { $null } else { $reader.GetValue($i) }
                $item[$reader.GetName($i)] = $value
            }
            $rows.Add([pscustomobject]$item)
        }
        $reader.Dispose()
        return ,$rows.ToArray()
    } finally { $command.Dispose() }
}

# Import payloads are UTF-8 JSON, including Unicode range punctuation.
# Windows PowerShell 5.1 otherwise decodes BOM-less files as the ANSI code page.
$payload = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$payload.academicYear -ne $AcademicYear) { throw 'DOE source academic year is not 2026-27.' }
if ([string]$payload.sourceFileName -ne $AcceptedWorkbookName -or [string]$payload.sourceFileSha256 -ne $AcceptedWorkbookSha256) { throw 'DOE source file identity does not match the accepted sanitized CSV.' }
if (@($payload.sourceRows).Count -ne 115) { throw 'DOE source row count does not match the accepted 115-row snapshot.' }
$ruleRows = @($payload.doeRuleBook.rules)
$corruptedRangeDash = ([string][char]0x00e2) + ([char]0x20ac) + ([char]0x201c)
foreach ($ruleRow in $ruleRows) {
    if (([string]$ruleRow.ruleLabel).Contains($corruptedRangeDash) -or ([string]$ruleRow.academicYearOrStage).Contains($corruptedRangeDash)) {
        throw 'DOE rule ranges contain an incorrectly decoded UTF-8 dash. Regenerate the payload from the authoritative rule book.'
    }
}
if ($ruleRows.Count -lt 25 -or [string]$payload.doeRuleBook.sourceReference -notmatch 'UCVM Workload Guidelines') { throw 'Versioned UCVM DOE rule references are missing from the import payload.' }
$connection = New-Connection
try {
    $facultyRows = Invoke-Query $connection "SELECT FacultyId, Ucid, DisplayName, Active, Fte FROM paws.Faculty;"
    $databaseByUcid = @{}
    $activeFacultyCount = 0
    $ftePopulatedBefore = 0
    $activeFteIds = @{}
    foreach ($faculty in $facultyRows) {
        if ($faculty.Active -eq $true) {
            $activeFacultyCount++
            if ($null -ne $faculty.Fte) { $ftePopulatedBefore++; $activeFteIds[[string]$faculty.FacultyId] = $true }
        }
        $ucid = Normalize-Ucid $faculty.Ucid
        if (-not $ucid) { continue }
        if (-not $databaseByUcid.ContainsKey($ucid)) { $databaseByUcid[$ucid] = [System.Collections.Generic.List[object]]::new() }
        $databaseByUcid[$ucid].Add($faculty)
    }

    $exactActive = 0; $exactInactive = 0; $noMatch = 0; $conflicts = 0
    $duplicateDatabaseUcid = 0; $nameWarnings = 0; $invalidRows = 0; $inputErrors = 0
    $ftePopulatedAfter = $ftePopulatedBefore
    $targets = [System.Collections.Generic.List[object]]::new()
    $allocations = [System.Collections.Generic.List[object]]::new()
    $sourceCounts = @{}
    foreach ($source in @($payload.sourceRows)) {
        $sourceUcid = Normalize-Ucid $source.ucid
        if ($sourceUcid) { $sourceCounts[$sourceUcid] = 1 + [int]$sourceCounts[$sourceUcid] }
    }
    foreach ($source in @($payload.sourceRows)) {
        $ucid = Normalize-Ucid $source.ucid
        $rowInvalid = @($source.validationErrors).Count -gt 0 -or -not $ucid -or $ucid -notmatch '^\d+$'
        if ($sourceCounts[$ucid] -gt 1) { $conflicts++; $inputErrors++; continue }
        if ($rowInvalid) { $invalidRows++; $inputErrors += [Math]::Max(1, @($source.validationErrors).Count); continue }
        if ($null -ne $source.teachingDoe -and ([double]$source.teachingDoe -lt 0 -or [double]$source.teachingDoe -gt 100)) { $invalidRows++; $inputErrors++; continue }
        if ($null -ne $source.fte -and ([double]$source.fte -lt 0 -or [double]$source.fte -gt 1)) { $invalidRows++; $inputErrors++; continue }
        $badAllocation = $false
        foreach ($allocation in @($source.allocations)) {
            if ($allocation.categoryCode -notin $CategoryCodes -or [double]$allocation.allocationDoe -lt 0 -or [double]$allocation.allocationDoe -gt 100) { $badAllocation = $true; break }
        }
        if ($badAllocation) { $invalidRows++; $inputErrors++; continue }
        $candidates = @()
        if ($ucid -and $databaseByUcid.ContainsKey($ucid)) {
            $candidates = [object[]]$databaseByUcid[$ucid].ToArray()
        }
        if ($candidates.Count -eq 0) { $noMatch++; continue }
        if ($candidates.Count -ne 1) {
            if ($candidates.Count -gt 1) { $duplicateDatabaseUcid++ }
            $conflicts++
            continue
        }
        $faculty = $candidates[0]
        $sourceName = Normalize-Name $source.sourceName
        $databaseName = Normalize-Name $faculty.DisplayName
        if ($sourceName -and $databaseName -and $sourceName -ne $databaseName) {
            $nameWarnings++
        }
        if ($faculty.Active -ne $true) { $exactInactive++; continue }

        $exactActive++
        if ($null -ne $source.fte -and -not $activeFteIds.ContainsKey([string]$faculty.FacultyId)) {
            $ftePopulatedAfter++
            $activeFteIds[[string]$faculty.FacultyId] = $true
        }
        $targets.Add([pscustomobject]@{
            facultyId = ([guid]$faculty.FacultyId).ToString()
            academicYear = $AcademicYear
            teachingDoe = if ($null -eq $source.teachingDoe) { $null } else { [double]$source.teachingDoe }
            fte = if ($null -eq $source.fte) { $null } else { [double]$source.fte }
            sourceRowNumber = [int]$source.rowNumber
        })
        foreach ($allocation in @($source.allocations)) {
            $allocations.Add([pscustomobject]@{
                facultyId = ([guid]$faculty.FacultyId).ToString()
                academicYear = $AcademicYear
                categoryCode = [string]$allocation.categoryCode
                allocationDoe = [double]$allocation.allocationDoe
            })
        }
    }

    $nonTeachingCount = $allocations.Count
    $targetCount = @($targets | Where-Object { $null -ne $_.teachingDoe }).Count
    $fteUpdateCount = @($targets | Where-Object { $null -ne $_.fte }).Count
    $summary = [ordered]@{
        SOURCE_ROWS = @($payload.sourceRows).Count
        EXACT_ACTIVE_MATCHES = $exactActive
        EXACT_INACTIVE_MATCHES = $exactInactive
        NO_UCID_MATCH = $noMatch
        UCID_CONFLICT = $conflicts
        DUPLICATE_DATABASE_UCID = $duplicateDatabaseUcid
        EXACT_UCID_NAME_WARNING = $nameWarnings
        INVALID_SOURCE_ROWS_SKIPPED = $invalidRows
        TEACHING_TARGET_ROWS = $targetCount
        NON_TEACHING_ALLOCATION_ROWS = $nonTeachingCount
        VALIDATION_ERRORS = $inputErrors
        ACTIVE_FACULTY = $activeFacultyCount
        SOURCE_MATCHED_FACULTY = $exactActive
        FTE_POPULATED_BEFORE = $ftePopulatedBefore
        FTE_POPULATED_AFTER_DRY_RUN = $ftePopulatedAfter
        FTE_NULL_AFTER_DRY_RUN = [Math]::Max(0, $activeFacultyCount - $ftePopulatedAfter)
        FTE_SOURCE_NUMERIC_UPDATES = $fteUpdateCount
        EXPLICIT_ZERO_FTE_VALUES = @($targets | Where-Object { $null -ne $_.fte -and [double]$_.fte -eq 0 }).Count
        DOE_SOURCE_MISSING_ACTIVE = [Math]::Max(0, $activeFacultyCount - $exactActive)
    }
    $tables = Invoke-Query $connection "SELECT OBJECT_ID(N'paws.DoeFacultyAllocation', N'U') AS AllocationTableId, OBJECT_ID(N'paws.DoePolicyVersion', N'U') AS PolicyTableId, OBJECT_ID(N'paws.DoeFacultyTarget', N'U') AS TargetTableId, OBJECT_ID(N'paws.DoeRuleSeed', N'U') AS RuleTableId;"
    $provenanceColumns = Invoke-Query $connection "SELECT COL_LENGTH(N'paws.Faculty',N'FteSourceReference') AS FteSourceReferenceColumn, COL_LENGTH(N'paws.Faculty',N'FteSourceRow') AS FteSourceRowColumn, COL_LENGTH(N'paws.Faculty',N'FteSourceUpdatedAtUtc') AS FteSourceUpdatedColumn, COL_LENGTH(N'paws.DoeRuleSeed',N'PolicyVersionId') AS RulePolicyVersionColumn;"
    $migration014Applied = $null -ne $provenanceColumns[0].FteSourceReferenceColumn -and $null -ne $provenanceColumns[0].FteSourceRowColumn -and $null -ne $provenanceColumns[0].FteSourceUpdatedColumn -and $null -ne $provenanceColumns[0].RulePolicyVersionColumn
    $before = $null
    $existingVersion = @()
    if ($null -ne $tables[0].AllocationTableId -and $null -ne $tables[0].PolicyTableId -and $null -ne $tables[0].TargetTableId -and $null -ne $tables[0].RuleTableId) {
        $before = Invoke-Query $connection "SELECT (SELECT COUNT_BIG(PolicyVersionId) FROM paws.DoePolicyVersion WHERE AcademicYear=N'2026-27') AS PolicyVersions, (SELECT COUNT_BIG(DoeFacultyTargetId) FROM paws.DoeFacultyTarget WHERE AcademicYear=N'2026-27' AND Active=1) AS ActiveTeachingTargets, (SELECT COUNT_BIG(DoeFacultyAllocationId) FROM paws.DoeFacultyAllocation WHERE AcademicYear=N'2026-27' AND Active=1) AS ActiveAllocations;"
        $versionedRuleRows = 0
        if ($migration014Applied) {
            $versionedRuleResult = Invoke-Query $connection "SELECT COUNT_BIG(r.DoeRuleSeedId) AS VersionedRuleRows FROM paws.DoeRuleSeed r INNER JOIN paws.DoePolicyVersion p ON p.PolicyVersionId=r.PolicyVersionId WHERE p.AcademicYear=N'2026-27' AND p.Active=1;"
            $versionedRuleRows = [long]$versionedRuleResult[0].VersionedRuleRows
        }
        $existingVersion = Invoke-Query $connection "SELECT PolicyVersionId, SourceReference FROM paws.DoePolicyVersion WHERE AcademicYear = N'2026-27' AND VersionLabel = N'Faculty Master List DOE/FTE snapshot 2026-27';"
        $summary['POLICY_VERSIONS_BEFORE'] = [long]$before[0].PolicyVersions
        $summary['ACTIVE_TEACHING_TARGETS_BEFORE'] = [long]$before[0].ActiveTeachingTargets
        $summary['ACTIVE_NON_TEACHING_ALLOCATIONS_BEFORE'] = [long]$before[0].ActiveAllocations
        $summary['ACTIVE_VERSIONED_RULE_ROWS_BEFORE'] = $versionedRuleRows
        $summary['EXISTING_EXPECTED_POLICY_VERSION'] = $existingVersion.Count -eq 1
        $summary['EXISTING_POLICY_SOURCE_MATCHES'] = $existingVersion.Count -eq 1 -and [string]$existingVersion[0].SourceReference -eq $PolicySourceReference
    } else {
        $summary['POLICY_VERSIONS_BEFORE'] = $null
        $summary['ACTIVE_TEACHING_TARGETS_BEFORE'] = $null
        $summary['ACTIVE_NON_TEACHING_ALLOCATIONS_BEFORE'] = $null
        $summary['ACTIVE_VERSIONED_RULE_ROWS_BEFORE'] = $null
        $summary['EXISTING_EXPECTED_POLICY_VERSION'] = $false
        $summary['EXISTING_POLICY_SOURCE_MATCHES'] = $false
    }
    $summary['MIGRATION_014_APPLIED'] = $migration014Applied
    [pscustomobject]$summary | ConvertTo-Json -Compress

    if ($Mode -eq 'DryRun') { return }
    if ($conflicts -ne 0) { throw 'DOE import refused: duplicate source or database UCID conflicts must be resolved before writes.' }
    if ($targets.Count -eq 0) { throw 'DOE import refused: there are no valid exact active UCID matches to apply.' }
    if ($null -eq $tables[0].AllocationTableId -or $null -eq $tables[0].PolicyTableId -or $null -eq $tables[0].TargetTableId -or $null -eq $tables[0].RuleTableId -or -not $migration014Applied) { throw 'Required DOE migrations 008, 013, and 014 have not been applied.' }
    if ($existingVersion.Count -eq 0 -and ([long]$before[0].ActiveTeachingTargets -ne 0 -or [long]$before[0].ActiveAllocations -ne 0)) {
        throw 'DOE import refused: existing 2026-27 active DOE data requires a reviewed before-state reconciliation.'
    }
    if ($existingVersion.Count -gt 0 -and [string]$existingVersion[0].SourceReference -ne $PolicySourceReference) {
        throw 'DOE import refused: the snapshot version label already points to different source provenance.'
    }

    $importJson = [ordered]@{ targets = $targets.ToArray(); allocations = $allocations.ToArray() } | ConvertTo-Json -Depth 8 -Compress
    $ruleIndex = 0
    $rulesForImport = @($ruleRows | ForEach-Object {
        $ruleIndex++
        [ordered]@{
            ruleCode = [string]$_.ruleCode
            category = [string]$_.category
            ruleLabel = [string]$_.ruleLabel
            academicYearOrStage = $_.academicYearOrStage
            rateOrTierPct = $_.rateOrTierPct
            basis = $_.basis
            requiredInput = $_.requiredInput
            calculationOrNote = $_.calculationOrNote
            sourceReference = [string]$_.sourceReference
            rawJson = [string]$_.rawJson
            sourceRow = $ruleIndex
        }
    })
    $ruleJson = ConvertTo-Json -InputObject $rulesForImport -Depth 6 -Compress
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 120
    $command.CommandText = @"
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @PolicyVersionId uniqueidentifier;
  DECLARE @RuleImportBatchId uniqueidentifier = 'E0F9D463-3B20-4C44-96F9-3E0384EB3110';
  SELECT @PolicyVersionId = PolicyVersionId
    FROM paws.DoePolicyVersion WITH (UPDLOCK, HOLDLOCK)
   WHERE AcademicYear = @AcademicYear AND VersionLabel = @VersionLabel;
  IF @PolicyVersionId IS NULL
  BEGIN
    SET @PolicyVersionId = NEWID();
    INSERT paws.DoePolicyVersion (PolicyVersionId, AcademicYear, VersionLabel, SourceReference, Active)
    VALUES (@PolicyVersionId, @AcademicYear, @VersionLabel, @PolicySourceReference, 1);
  END
  ELSE
  BEGIN
    IF EXISTS (SELECT 1 FROM paws.DoePolicyVersion WHERE PolicyVersionId=@PolicyVersionId AND SourceReference<>@PolicySourceReference)
      THROW 51440, 'Existing policy version source reference differs.', 1;
    UPDATE paws.DoePolicyVersion SET Active=1, UpdatedAtUtc=SYSUTCDATETIME() WHERE PolicyVersionId=@PolicyVersionId;
  END;

  CREATE TABLE #Targets (FacultyId uniqueidentifier NOT NULL PRIMARY KEY, AcademicYear nvarchar(32) NOT NULL, TeachingDoe decimal(12,6) NULL, Fte decimal(6,4) NULL, SourceRow int NOT NULL);
  INSERT #Targets (FacultyId, AcademicYear, TeachingDoe, Fte, SourceRow)
  SELECT FacultyId, AcademicYear, TeachingDoe, Fte, SourceRow
    FROM OPENJSON(@ImportJson, '$.targets') WITH (
      FacultyId uniqueidentifier '$.facultyId', AcademicYear nvarchar(32) '$.academicYear', TeachingDoe decimal(12,6) '$.teachingDoe',
      Fte decimal(6,4) '$.fte', SourceRow int '$.sourceRowNumber'
    );
  CREATE TABLE #Allocations (FacultyId uniqueidentifier NOT NULL, AcademicYear nvarchar(32) NOT NULL, CategoryCode nvarchar(64) NOT NULL, AllocationDoe decimal(12,6) NOT NULL, PRIMARY KEY (FacultyId, AcademicYear, CategoryCode));
  INSERT #Allocations (FacultyId, AcademicYear, CategoryCode, AllocationDoe)
  SELECT FacultyId, AcademicYear, CategoryCode, AllocationDoe
    FROM OPENJSON(@ImportJson, '$.allocations') WITH (
      FacultyId uniqueidentifier '$.facultyId', AcademicYear nvarchar(32) '$.academicYear', CategoryCode nvarchar(64) '$.categoryCode', AllocationDoe decimal(12,6) '$.allocationDoe'
    );

  CREATE TABLE #Rules (RuleCode nvarchar(128) NOT NULL PRIMARY KEY, Category nvarchar(256) NULL, RuleLabel nvarchar(256) NOT NULL, AcademicYearOrStage nvarchar(128) NULL, RateOrTierPct nvarchar(256) NULL, Basis nvarchar(512) NULL, RequiredInput nvarchar(512) NULL, CalculationOrNote nvarchar(max) NULL, SourceReference nvarchar(2048) NOT NULL, RawJson nvarchar(max) NOT NULL, SourceRow int NOT NULL);
  INSERT #Rules (RuleCode, Category, RuleLabel, AcademicYearOrStage, RateOrTierPct, Basis, RequiredInput, CalculationOrNote, SourceReference, RawJson, SourceRow)
  SELECT RuleCode, Category, RuleLabel, AcademicYearOrStage, RateOrTierPct, Basis, RequiredInput, CalculationOrNote, SourceReference, RawJson, SourceRow
    FROM OPENJSON(@RuleJson) WITH (
      RuleCode nvarchar(128) '$.ruleCode', Category nvarchar(256) '$.category', RuleLabel nvarchar(256) '$.ruleLabel',
      AcademicYearOrStage nvarchar(128) '$.academicYearOrStage', RateOrTierPct nvarchar(256) '$.rateOrTierPct',
      Basis nvarchar(512) '$.basis', RequiredInput nvarchar(512) '$.requiredInput', CalculationOrNote nvarchar(max) '$.calculationOrNote',
      SourceReference nvarchar(2048) '$.sourceReference', RawJson nvarchar(max) '$.rawJson', SourceRow int '$.sourceRow'
    );

  UPDATE faculty SET Fte=source.Fte, FteSourceReference=@SourceReference, FteSourceRow=source.SourceRow, FteSourceUpdatedAtUtc=SYSUTCDATETIME()
    FROM paws.Faculty faculty JOIN #Targets source ON source.FacultyId=faculty.FacultyId
   WHERE source.Fte IS NOT NULL;

  UPDATE target SET ContractTeachingDoe=source.TeachingDoe, Source=@SourceReference, PolicyVersionId=@PolicyVersionId, UpdatedAtUtc=SYSUTCDATETIME()
    FROM paws.DoeFacultyTarget target JOIN #Targets source ON source.FacultyId=target.FacultyId AND source.AcademicYear=target.AcademicYear
   WHERE target.Active=1 AND source.TeachingDoe IS NOT NULL;
  INSERT paws.DoeFacultyTarget (DoeFacultyTargetId, FacultyId, AcademicYear, ContractTeachingDoe, Source, PolicyVersionId, Active)
  SELECT NEWID(), source.FacultyId, source.AcademicYear, source.TeachingDoe, @SourceReference, @PolicyVersionId, 1
    FROM #Targets source
   WHERE source.TeachingDoe IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM paws.DoeFacultyTarget target WHERE target.FacultyId=source.FacultyId AND target.AcademicYear=source.AcademicYear AND target.Active=1);
  UPDATE allocation SET AllocationDoe=source.AllocationDoe, SourceReference=@SourceReference, PolicyVersionId=@PolicyVersionId, UpdatedAtUtc=SYSUTCDATETIME()
    FROM paws.DoeFacultyAllocation allocation JOIN #Allocations source ON source.FacultyId=allocation.FacultyId AND source.AcademicYear=allocation.AcademicYear AND source.CategoryCode=allocation.CategoryCode
   WHERE allocation.Active=1;
  INSERT paws.DoeFacultyAllocation (DoeFacultyAllocationId, FacultyId, AcademicYear, CategoryCode, AllocationDoe, SourceReference, PolicyVersionId, Active)
  SELECT NEWID(), source.FacultyId, source.AcademicYear, source.CategoryCode, source.AllocationDoe, @SourceReference, @PolicyVersionId, 1
    FROM #Allocations source
   WHERE NOT EXISTS (SELECT 1 FROM paws.DoeFacultyAllocation allocation WHERE allocation.FacultyId=source.FacultyId AND allocation.AcademicYear=source.AcademicYear AND allocation.CategoryCode=source.CategoryCode AND allocation.Active=1);

  UPDATE ruleSeed SET Category=source.Category, AcademicYearOrStage=source.AcademicYearOrStage, RateOrTierPct=source.RateOrTierPct,
         Basis=source.Basis, RequiredInput=source.RequiredInput, CalculationOrNote=source.CalculationOrNote,
         SourceUrl=source.SourceReference, RawJson=source.RawJson, SourceImportBatchId=@RuleImportBatchId, SourceRow=source.SourceRow
    FROM paws.DoeRuleSeed ruleSeed
    JOIN #Rules source ON source.RuleLabel=ruleSeed.RuleLabel
      AND ISNULL(source.AcademicYearOrStage,N'')=ISNULL(ruleSeed.AcademicYearOrStage,N'')
   WHERE ruleSeed.PolicyVersionId=@PolicyVersionId;
  INSERT paws.DoeRuleSeed (DoeRuleSeedId, Category, RuleLabel, AcademicYearOrStage, RateOrTierPct, Basis, RequiredInput, CalculationOrNote, AuthoritativeInExcel, SourceUrl, RawJson, SourceImportBatchId, SourceRow, PolicyVersionId)
  SELECT NEWID(), source.Category, source.RuleLabel, source.AcademicYearOrStage, source.RateOrTierPct, source.Basis, source.RequiredInput,
         source.CalculationOrNote, NULL, source.SourceReference, source.RawJson, @RuleImportBatchId, source.SourceRow, @PolicyVersionId
    FROM #Rules source
   WHERE NOT EXISTS (SELECT 1 FROM paws.DoeRuleSeed ruleSeed WHERE ruleSeed.PolicyVersionId=@PolicyVersionId AND ruleSeed.RuleLabel=source.RuleLabel AND ISNULL(ruleSeed.AcademicYearOrStage,N'')=ISNULL(source.AcademicYearOrStage,N''));

  COMMIT TRANSACTION;
  SELECT @PolicyVersionId AS PolicyVersionId,
         (SELECT COUNT_BIG(DoeFacultyTargetId) FROM paws.DoeFacultyTarget WHERE AcademicYear=@AcademicYear AND Active=1 AND ContractTeachingDoe IS NOT NULL) AS ActiveTeachingTargets,
         (SELECT COUNT_BIG(DoeFacultyAllocationId) FROM paws.DoeFacultyAllocation WHERE AcademicYear=@AcademicYear AND Active=1) AS ActiveAllocations,
         (SELECT COUNT_BIG(DoeRuleSeedId) FROM paws.DoeRuleSeed WHERE PolicyVersionId=@PolicyVersionId) AS VersionedRuleCount,
         (SELECT COUNT_BIG(FacultyId) FROM paws.Faculty WHERE Active=1 AND Fte IS NOT NULL) AS ActiveFacultyFtePopulated,
         (SELECT COUNT_BIG(FacultyId) FROM paws.Faculty WHERE Active=1 AND Fte IS NULL) AS ActiveFacultyFteNull;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
"@
    foreach ($spec in @(
        @{ Name = '@AcademicYear'; Type = [System.Data.SqlDbType]::NVarChar; Size = 32; Value = $AcademicYear },
        @{ Name = '@VersionLabel'; Type = [System.Data.SqlDbType]::NVarChar; Size = 64; Value = $VersionLabel },
        @{ Name = '@SourceReference'; Type = [System.Data.SqlDbType]::NVarChar; Size = 512; Value = $SourceReference },
        @{ Name = '@PolicySourceReference'; Type = [System.Data.SqlDbType]::NVarChar; Size = 512; Value = $PolicySourceReference },
        @{ Name = '@ImportJson'; Type = [System.Data.SqlDbType]::NVarChar; Size = -1; Value = $importJson },
        @{ Name = '@RuleJson'; Type = [System.Data.SqlDbType]::NVarChar; Size = -1; Value = $ruleJson }
    )) {
        $parameter = $command.Parameters.Add($spec.Name, $spec.Type, $spec.Size)
        $parameter.Value = $spec.Value
    }
    try {
        $reader = $command.ExecuteReader()
        if ($reader.Read()) {
            [pscustomobject]@{
                IMPORT_STATUS = 'APPLIED'
                POLICY_VERSION_ID = [string]$reader['PolicyVersionId']
                ACTIVE_TEACHING_TARGETS = [long]$reader['ActiveTeachingTargets']
                ACTIVE_NON_TEACHING_ALLOCATIONS = [long]$reader['ActiveAllocations']
                VERSIONED_RULE_COUNT = [long]$reader['VersionedRuleCount']
                ACTIVE_FACULTY_FTE_POPULATED_AFTER = [long]$reader['ActiveFacultyFtePopulated']
                ACTIVE_FACULTY_FTE_NULL_AFTER = [long]$reader['ActiveFacultyFteNull']
                BEFORE_ACTIVE_TEACHING_TARGETS = [long]$before[0].ActiveTeachingTargets
                BEFORE_ACTIVE_NON_TEACHING_ALLOCATIONS = [long]$before[0].ActiveAllocations
            } | ConvertTo-Json -Compress
        }
        $reader.Dispose()
    } finally { $command.Dispose() }
} finally { $connection.Dispose() }
