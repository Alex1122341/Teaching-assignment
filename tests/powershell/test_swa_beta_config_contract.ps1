$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$scriptPath = Join-Path $repoRoot 'tools\configure_paws_swa_beta.ps1'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw 'SWA beta configuration script must exist.'
}

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $scriptPath,
    [ref]$tokens,
    [ref]$errors
)
if ($errors.Count -gt 0) {
    throw 'SWA beta configuration script has PowerShell parse errors.'
}

$text = Get-Content -LiteralPath $scriptPath -Raw
foreach ($required in @(
    '[switch]$Preview',
    'Get-PawsSqlAccessToken',
    'Open-PawsSqlConnection',
    'Read-Host',
    '-AsSecureString',
    'az staticwebapp appsettings set',
    'PAWS_SQL_CONNECTION_STRING',
    'PAWS_SQL_READS',
    'PAWS_SQL_AUTH',
    'PAWS_ACCOUNT_BOOTSTRAP_JSON',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_SERVICE_ACCOUNT_JSON'
)) {
    if (-not $text.Contains($required)) {
        throw "Missing required SWA beta configuration contract: $required"
    }
}

if ($text -notmatch '(?s)if\s*\(\$Preview\).*?return') {
    throw 'Preview mode must return before live configuration writes.'
}

if ($text -match '(?im)^\s*Write-(?:Host|Output).*?(?:passwordPlain|connectionString|firebaseServiceAccountJson|bootstrapJson)') {
    throw 'SWA beta configuration script must never print secret-bearing variables.'
}

if ($text -match 'ConvertFrom-SecureString\s+-AsPlainText') {
    throw 'SWA beta configuration script must not use plaintext SecureString conversion helpers.'
}

Write-Host 'PASS: SWA beta configuration script keeps secrets server-side and preview-first.'
