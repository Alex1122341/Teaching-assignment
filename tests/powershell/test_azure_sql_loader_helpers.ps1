$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$loaderPath = Join-Path $repoRoot 'tools\load_paws_azure_sql_empty.ps1'

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $loaderPath,
    [ref]$tokens,
    [ref]$errors
)

if ($errors.Count -gt 0) {
    throw "Loader has PowerShell parse errors."
}

$requiredFunctions = @('New-PawsDataTable', 'Add-PawsDataRow')
foreach ($functionName in $requiredFunctions) {
    $functionAst = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq $functionName
    }, $true)

    if ($null -eq $functionAst) {
        throw "Could not find production function $functionName."
    }

    Invoke-Expression $functionAst.Extent.Text
}

$table = New-PawsDataTable @(
    @{Name='RequiredId';Type=[Guid]},
    @{Name='NullableValue';Type=[string]},
    @{Name='EmptyStringValue';Type=[string]}
)

$id = [Guid]::NewGuid()
Add-PawsDataRow -Table $table -Values @($id, $null, '')

if ($table.Rows.Count -ne 1) {
    throw "Expected exactly one DataRow."
}
if ($table.Rows[0]['RequiredId'] -ne $id) {
    throw "Required GUID was not preserved."
}
if ($table.Rows[0].IsNull('NullableValue') -ne $true) {
    throw "Null value was not converted to DBNull."
}
if ([string]$table.Rows[0]['EmptyStringValue'] -ne '') {
    throw "Empty string value was not preserved."
}

Write-Host 'PASS: Add-PawsDataRow accepts expected null and empty-string row values.'
