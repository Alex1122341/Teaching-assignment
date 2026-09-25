param(
    [string]$SubscriptionId = 'd81fa2f8-5115-49c9-80c5-51accac46bed',
    [string]$TenantId = 'c609a0ec-a5e3-4631-9686-192280bd9151',
    [string]$ResourceGroup = 'rg-ucvm-teaching-lab',
    [string]$StaticWebAppName = 'ucvm-teaching-lab-web',
    [string]$SqlServer = 'ucvm-teaching-lab-xz-20260911.database.windows.net',
    [string]$Database = 'teaching-assignment-lab',
    [string]$FirebaseProjectId = 'tester-teaching',
    [string]$FirebaseServiceAccountPath = '',
    [string]$BootstrapEmail = '',
    [ValidateSet('developer','owner','administrator','adfa_general','adfa_regular','adc','lab','other_office','hicc','visc','faculty')]
    [string]$BootstrapRole = 'developer',
    [string]$BootstrapDisplayName = '',
    [string]$BootstrapOfficeName = 'ADFA',
    [switch]$PromptForSqlPassword,
    [switch]$Preview,
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'azure_sql_migration\sql_access.ps1')

$expectedSubscriptionId = 'd81fa2f8-5115-49c9-80c5-51accac46bed'
$expectedResourceGroup = 'rg-ucvm-teaching-lab'
$expectedStaticWebAppName = 'ucvm-teaching-lab-web'
$expectedSqlServer = 'ucvm-teaching-lab-xz-20260911.database.windows.net'
$expectedDatabase = 'teaching-assignment-lab'
$principalName = 'paws_swa_beta'
$permissionsPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'database\azure-sql\004_swa_beta_permissions.sql'
$requiredSettingNames = @(
    'PAWS_SQL_CONNECTION_STRING',
    'PAWS_SQL_READS',
    'PAWS_SQL_AUTH',
    'PAWS_ACCOUNT_BOOTSTRAP_JSON',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_SERVICE_ACCOUNT_JSON'
)

if ($SubscriptionId -ne $expectedSubscriptionId) {
    throw "Refusing configuration: subscription '$SubscriptionId' does not match reviewed subscription '$expectedSubscriptionId'."
}
if ($ResourceGroup -ne $expectedResourceGroup) {
    throw "Refusing configuration: resource group '$ResourceGroup' does not match reviewed resource group '$expectedResourceGroup'."
}
if ($StaticWebAppName -ne $expectedStaticWebAppName) {
    throw "Refusing configuration: Static Web App '$StaticWebAppName' does not match reviewed app '$expectedStaticWebAppName'."
}
if ($SqlServer -ne $expectedSqlServer) {
    throw "Refusing configuration: SQL server '$SqlServer' does not match reviewed server '$expectedSqlServer'."
}
if ($Database -ne $expectedDatabase) {
    throw "Refusing configuration: database '$Database' does not match reviewed database '$expectedDatabase'."
}
if ($Preview -and $Apply) {
    throw 'Choose either -Preview or -Apply, not both.'
}
if (-not $Preview -and -not $Apply) {
    throw 'Choose -Preview for read-only validation or -Apply for the reviewed live configuration.'
}
if (-not (Test-Path -LiteralPath $permissionsPath -PathType Leaf)) {
    throw "Required SQL permission file is missing: $permissionsPath"
}

function Add-PortableCommandToPath {
    param([Parameter(Mandatory = $true)][string]$CommandPath)
    $directory = Split-Path -Parent $CommandPath
    if (-not (($env:PATH -split ';') -contains $directory)) {
        $env:PATH = "$directory;$env:PATH"
    }
}

function Ensure-PawsAzureCli {
    if (Get-Command az -ErrorAction SilentlyContinue) { return }

    $portableRoot = Join-Path $env:LOCALAPPDATA 'PAWS\portable-tools\azure-cli'
    $portable = Get-ChildItem -LiteralPath $portableRoot -Recurse -Filter 'az.cmd' -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($portable) {
        Add-PortableCommandToPath -CommandPath $portable.FullName
        return
    }

    throw 'Azure CLI is not available. Install Azure CLI or keep the PAWS portable Azure CLI under %LOCALAPPDATA%\PAWS\portable-tools\azure-cli.'
}

function Invoke-Az {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& az @Arguments --only-show-errors 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw ("Azure CLI command failed: az " + ($Arguments -join ' ') + [Environment]::NewLine + ($output -join [Environment]::NewLine))
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Text = ($output -join [Environment]::NewLine).Trim()
    }
}

function New-PawsBetaSqlPassword {
    $required = 'Aa1!'
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^&*_-+='
    $bytes = New-Object byte[] 28
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    }
    finally {
        $rng.Dispose()
    }
    $tail = -join ($bytes | ForEach-Object { $alphabet[[int]$_ % $alphabet.Length] })
    return ($required + $tail)
}

function Convert-PawsSecureStringInMemory {
    param([Parameter(Mandatory = $true)][Security.SecureString]$SecureValue)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Invoke-PawsSqlNonQuery {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [Parameter(Mandatory = $true)][string]$Sql
    )
    $command = $Connection.CreateCommand()
    try {
        $command.CommandTimeout = 120
        $command.CommandText = $Sql
        [void]$command.ExecuteNonQuery()
    }
    finally {
        $command.Dispose()
    }
}

Ensure-PawsAzureCli

$account = Invoke-Az -Arguments @('account','show','-o','json') -AllowFailure
if ($account.ExitCode -ne 0) {
    Write-Host 'Azure CLI is not signed in. Starting sign-in...'
    [void](Invoke-Az -Arguments @('login','--tenant',$TenantId,'-o','none'))
}
[void](Invoke-Az -Arguments @('account','set','--subscription',$SubscriptionId))

$swa = Invoke-Az -Arguments @(
    'staticwebapp','show',
    '--resource-group',$ResourceGroup,
    '--name',$StaticWebAppName,
    '-o','json'
)
$swaObject = $swa.Text | ConvertFrom-Json
if ([string]$swaObject.name -ne $StaticWebAppName) {
    throw "Static Web App verification returned unexpected resource '$($swaObject.name)'."
}

$sqlDb = Invoke-Az -Arguments @(
    'sql','db','show',
    '--resource-group',$ResourceGroup,
    '--server',($SqlServer -replace '\.database\.windows\.net$',''),
    '--name',$Database,
    '-o','json'
)
$sqlDbObject = $sqlDb.Text | ConvertFrom-Json
if ([string]$sqlDbObject.name -ne $Database) {
    throw "Azure SQL verification returned unexpected database '$($sqlDbObject.name)'."
}

if ($Preview) {
    [pscustomobject][ordered]@{
        mode = 'preview'
        subscriptionId = $SubscriptionId
        resourceGroup = $ResourceGroup
        staticWebApp = $StaticWebAppName
        sqlServer = $SqlServer
        database = $Database
        firebaseProjectId = $FirebaseProjectId
        sqlPrincipal = $principalName
        applicationSettingNames = $requiredSettingNames
        message = 'Reviewed SWA beta targets are present. No database principal or app setting was changed.'
    } | ConvertTo-Json -Depth 6
    return
}

if ([string]::IsNullOrWhiteSpace($FirebaseServiceAccountPath)) {
    $FirebaseServiceAccountPath = Read-Host 'Path to the local Firebase service-account JSON file'
}
$FirebaseServiceAccountPath = (Resolve-Path -LiteralPath $FirebaseServiceAccountPath).Path
$firebaseServiceAccountJson = Get-Content -LiteralPath $FirebaseServiceAccountPath -Raw -Encoding UTF8
try {
    $firebaseServiceAccount = $firebaseServiceAccountJson | ConvertFrom-Json
}
catch {
    throw 'Firebase service-account file must contain valid JSON.'
}
if ([string]::IsNullOrWhiteSpace([string]$firebaseServiceAccount.client_email) -or
    [string]::IsNullOrWhiteSpace([string]$firebaseServiceAccount.private_key)) {
    throw 'Firebase service-account JSON must include client_email and private_key.'
}
if ([string]$firebaseServiceAccount.project_id -ne $FirebaseProjectId) {
    throw "Firebase service-account project does not match FirebaseProjectId '$FirebaseProjectId'."
}

if ([string]::IsNullOrWhiteSpace($BootstrapEmail)) {
    $BootstrapEmail = Read-Host 'Approved PAWS bootstrap account email'
}
$BootstrapEmail = $BootstrapEmail.Trim().ToLowerInvariant()
if ($BootstrapEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
    throw 'BootstrapEmail must be a valid email address.'
}
if ([string]::IsNullOrWhiteSpace($BootstrapDisplayName)) {
    $BootstrapDisplayName = Read-Host 'Bootstrap account display name'
}
if ([string]::IsNullOrWhiteSpace($BootstrapDisplayName)) {
    throw 'BootstrapDisplayName is required.'
}

$bootstrap = [ordered]@{}
$bootstrap[$BootstrapEmail] = [ordered]@{
    role = $BootstrapRole
    displayName = $BootstrapDisplayName
    officeName = $BootstrapOfficeName
}
$bootstrapJson = $bootstrap | ConvertTo-Json -Depth 5 -Compress

$passwordPlain = $null
$connectionString = $null
$securePassword = $null
$operatorConnection = $null
try {
    if ($PromptForSqlPassword) {
        $securePassword = Read-Host 'PAWS SWA beta SQL password' -AsSecureString
        $passwordPlain = Convert-PawsSecureStringInMemory -SecureValue $securePassword
    }
    else {
        $passwordPlain = New-PawsBetaSqlPassword
    }

    $accessToken = Get-PawsSqlAccessToken -TenantId $TenantId
    $operatorConnection = Open-PawsSqlConnection -Server $SqlServer -Database $Database -AccessToken $accessToken
    try {
        Assert-PawsDatabase -Connection $operatorConnection -ExpectedDatabase $Database

        $escapedPassword = $passwordPlain.Replace("'", "''")
        $userSql = @"
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name=N'$principalName')
    ALTER USER [$principalName] WITH PASSWORD = N'$escapedPassword';
ELSE
    CREATE USER [$principalName] WITH PASSWORD = N'$escapedPassword';
"@
        Invoke-PawsSqlNonQuery -Connection $operatorConnection -Sql $userSql

        $permissionsSql = Get-Content -LiteralPath $permissionsPath -Raw -Encoding UTF8
        Invoke-PawsSqlNonQuery -Connection $operatorConnection -Sql $permissionsSql
    }
    finally {
        if ($null -ne $operatorConnection) {
            $operatorConnection.Dispose()
            $operatorConnection = $null
        }
    }

    $builder = [System.Data.SqlClient.SqlConnectionStringBuilder]::new()
    $builder.DataSource = "tcp:$SqlServer,1433"
    $builder.InitialCatalog = $Database
    $builder.PersistSecurityInfo = $false
    $builder.UserID = $principalName
    $builder.Password = $passwordPlain
    $builder.Encrypt = $true
    $builder.TrustServerCertificate = $false
    $builder.ConnectTimeout = 30
    $connectionString = $builder.ConnectionString

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $settingOutput = @(
            az staticwebapp appsettings set `
                --name $StaticWebAppName `
                --resource-group $ResourceGroup `
                --setting-names `
                "PAWS_SQL_CONNECTION_STRING=$connectionString" `
                'PAWS_SQL_READS=on' `
                'PAWS_SQL_AUTH=on' `
                "PAWS_ACCOUNT_BOOTSTRAP_JSON=$bootstrapJson" `
                "FIREBASE_PROJECT_ID=$FirebaseProjectId" `
                "FIREBASE_SERVICE_ACCOUNT_JSON=$firebaseServiceAccountJson" `
                --only-show-errors `
                -o none 2>&1
        )
        $settingExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($settingExitCode -ne 0) {
        throw 'Azure Static Web Apps application-setting update failed. Secret-bearing command arguments were intentionally omitted from this error.'
    }

    $settingsResult = Invoke-Az -Arguments @(
        'staticwebapp','appsettings','list',
        '--name',$StaticWebAppName,
        '--resource-group',$ResourceGroup,
        '-o','json'
    )
    $settingsObject = $settingsResult.Text | ConvertFrom-Json
    $presentNames = @()
    if ($settingsObject.PSObject.Properties['properties']) {
        $presentNames = @($settingsObject.properties.PSObject.Properties.Name)
    }
    else {
        $presentNames = @($settingsObject.PSObject.Properties.Name)
    }
    $missing = @($requiredSettingNames | Where-Object { $_ -notin $presentNames })
    if ($missing.Count -gt 0) {
        throw ('Static Web Apps setting verification is missing: ' + ($missing -join ', '))
    }

    [pscustomobject][ordered]@{
        mode = 'applied'
        staticWebApp = $StaticWebAppName
        database = $Database
        sqlPrincipal = $principalName
        verifiedApplicationSettingNames = @($requiredSettingNames)
        message = 'SWA beta SQL principal and server-side setting names were configured. Secret values were not printed.'
    } | ConvertTo-Json -Depth 5
}
finally {
    if ($null -ne $operatorConnection) { $operatorConnection.Dispose() }
    $securePassword = $null
    $passwordPlain = $null
    $connectionString = $null
    $bootstrapJson = $null
    $firebaseServiceAccountJson = $null
    $firebaseServiceAccount = $null
}