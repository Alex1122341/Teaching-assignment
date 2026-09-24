param(
    [string]$SubscriptionId = 'd81fa2f8-5115-49c9-80c5-51accac46bed',
    [string]$TenantId = 'c609a0ec-a5e3-4631-9686-192280bd9151',
    [string]$ResourceGroup = 'rg-ucvm-teaching-lab',
    [string]$AppName = '',
    [string]$PlanName = 'asp-ucvm-paws-api',
    [string]$Location = 'eastus2',
    [ValidateSet('F1','B1','B2','B3','S1')]
    [string]$Sku = 'F1',
    [switch]$CreateIfMissing,
    [string]$SqlServer = 'ucvm-teaching-lab-xz-20260911.database.windows.net',
    [string]$Database = 'teaching-assignment-lab',
    [string]$FirebaseProjectId = 'tester-teaching',
    [string]$BootstrapEmail = '',
    [ValidateSet('developer','owner','administrator','adfa_general','adfa_regular','adc','lab','other_office','hicc','visc','faculty')]
    [string]$BootstrapRole = 'developer',
    [string]$BootstrapDisplayName = 'PAWS bootstrap account',
    [string]$BootstrapOfficeName = 'ADFA',
    [string]$GitHubRepository = 'Alex1122341/Teaching-assignment',
    [string]$AllowedOrigins = 'https://red-cliff-04871ca0f.5.azurestaticapps.net,https://alex1122341.github.io',
    [switch]$AllowAzureServicesToSql,
    [switch]$SkipGitHubConfiguration,
    [switch]$SkipDeployment
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Add-PortableCommandToPath {
    param([Parameter(Mandatory = $true)][string]$CommandPath)
    $directory = Split-Path -Parent $CommandPath
    if (-not (($env:PATH -split ';') -contains $directory)) {
        $env:PATH = "$directory;$env:PATH"
    }
}

function Invoke-PortableDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    $previousProgress = $ProgressPreference
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $Uri -OutFile $Destination -UseBasicParsing
    }
    finally {
        $ProgressPreference = $previousProgress
    }
}

function Ensure-PortableAzureCli {
    if (Get-Command az -ErrorAction SilentlyContinue) { return }

    $root = Join-Path $env:LOCALAPPDATA 'PAWS\portable-tools\azure-cli'
    $azCommand = Get-ChildItem -LiteralPath $root -Recurse -Filter 'az.cmd' -File -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if (-not $azCommand) {
        Write-Host 'Azure CLI is missing. Downloading the official no-admin ZIP package...'
        $toolRoot = Split-Path -Parent $root
        New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
        $zip = Join-Path $toolRoot 'azure-cli-x64.zip'
        Invoke-PortableDownload -Uri 'https://aka.ms/installazurecliwindowszipx64' -Destination $zip
        if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        Expand-Archive -LiteralPath $zip -DestinationPath $root -Force
        Remove-Item -LiteralPath $zip -Force
        $azCommand = Get-ChildItem -LiteralPath $root -Recurse -Filter 'az.cmd' -File -ErrorAction Stop |
            Select-Object -First 1
    }

    if (-not $azCommand) { throw 'Portable Azure CLI download did not contain az.cmd.' }
    Add-PortableCommandToPath -CommandPath $azCommand.FullName
}

function Ensure-PortableGitHubCli {
    if (Get-Command gh -ErrorAction SilentlyContinue) { return }

    $root = Join-Path $env:LOCALAPPDATA 'PAWS\portable-tools\github-cli'
    $ghCommand = Get-ChildItem -LiteralPath $root -Recurse -Filter 'gh.exe' -File -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if (-not $ghCommand) {
        Write-Host 'GitHub CLI is missing. Downloading the official portable Windows binary...'
        $release = Invoke-RestMethod -Method Get -Uri 'https://api.github.com/repos/cli/cli/releases/latest' -Headers @{
            'User-Agent' = 'PAWS-runtime-bootstrap'
            'Accept' = 'application/vnd.github+json'
        }
        $asset = @($release.assets) |
            Where-Object { [string]$_.name -match '^gh_.*_windows_amd64\.zip$' } |
            Select-Object -First 1
        if (-not $asset -or [string]::IsNullOrWhiteSpace([string]$asset.browser_download_url)) {
            throw 'Latest GitHub CLI release does not contain a Windows amd64 ZIP asset.'
        }

        $toolRoot = Split-Path -Parent $root
        New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
        $zip = Join-Path $toolRoot 'github-cli-windows-amd64.zip'
        Invoke-PortableDownload -Uri ([string]$asset.browser_download_url) -Destination $zip
        if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        Expand-Archive -LiteralPath $zip -DestinationPath $root -Force
        Remove-Item -LiteralPath $zip -Force
        $ghCommand = Get-ChildItem -LiteralPath $root -Recurse -Filter 'gh.exe' -File -ErrorAction Stop |
            Select-Object -First 1
    }

    if (-not $ghCommand) { throw 'Portable GitHub CLI download did not contain gh.exe.' }
    Add-PortableCommandToPath -CommandPath $ghCommand.FullName
}

function Assert-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is not installed or is not on PATH."
    }
}

function Invoke-Az {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    $output = @(& az @Arguments --only-show-errors 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw ("az " + ($Arguments -join ' ') + " failed." + [Environment]::NewLine + ($output -join [Environment]::NewLine))
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Text = ($output -join [Environment]::NewLine).Trim()
    }
}

function Invoke-Gh {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    $output = @(& gh @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw ("gh " + ($Arguments -join ' ') + " failed." + [Environment]::NewLine + ($output -join [Environment]::NewLine))
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Text = ($output -join [Environment]::NewLine).Trim()
    }
}

function Get-AppNames {
    $result = Invoke-Az -Arguments @(
        'webapp','list',
        '--resource-group',$ResourceGroup,
        '--query','[].name',
        '-o','tsv'
    )
    if ([string]::IsNullOrWhiteSpace($result.Text)) { return @() }
    return @($result.Text -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

Ensure-PortableAzureCli
Assert-Command -Name 'az'

$account = Invoke-Az -Arguments @('account','show','-o','json') -AllowFailure
if ($account.ExitCode -ne 0) {
    Write-Host 'Azure CLI is not signed in. Starting sign-in...'
    [void](Invoke-Az -Arguments @('login','--tenant',$TenantId,'-o','none'))
}
[void](Invoke-Az -Arguments @('account','set','--subscription',$SubscriptionId))
Write-Host "Azure subscription selected: $SubscriptionId"

$appNames = @(Get-AppNames)
if ([string]::IsNullOrWhiteSpace($AppName)) {
    if ($appNames.Count -eq 1) {
        $AppName = $appNames[0]
        Write-Host "Using the only App Service in ${ResourceGroup}: $AppName"
    }
    else {
        $candidates = @($appNames | Where-Object { $_ -match '(?i)(paws|doe|api)' })
        if ($candidates.Count -eq 1) {
            $AppName = $candidates[0]
            Write-Host "Using API-like App Service: $AppName"
        }
        elseif ($appNames.Count -eq 0 -and $CreateIfMissing) {
            $AppName = 'ucvm-teaching-lab-paws-api'
        }
        else {
            $display = if ($appNames.Count) { $appNames -join ', ' } else { '(none)' }
            throw "Could not choose an App Service safely. Existing apps: $display. Re-run with -AppName <name>, or add -CreateIfMissing when no API app exists."
        }
    }
}

$appCheck = Invoke-Az -Arguments @(
    'webapp','show',
    '--resource-group',$ResourceGroup,
    '--name',$AppName,
    '-o','json'
) -AllowFailure

if ($appCheck.ExitCode -ne 0) {
    if (-not $CreateIfMissing) {
        throw "App Service '$AppName' does not exist in '$ResourceGroup'. Re-run with -CreateIfMissing to create it."
    }

    Write-Host "Creating App Service plan '$PlanName' ($Sku) if needed..."
    $planCheck = Invoke-Az -Arguments @(
        'appservice','plan','show',
        '--resource-group',$ResourceGroup,
        '--name',$PlanName,
        '-o','json'
    ) -AllowFailure
    if ($planCheck.ExitCode -ne 0) {
        [void](Invoke-Az -Arguments @(
            'appservice','plan','create',
            '--resource-group',$ResourceGroup,
            '--name',$PlanName,
            '--location',$Location,
            '--sku',$Sku,
            '--is-linux',
            '-o','none'
        ))
    }

    Write-Host "Creating Node 22 App Service '$AppName'..."
    [void](Invoke-Az -Arguments @(
        'webapp','create',
        '--resource-group',$ResourceGroup,
        '--plan',$PlanName,
        '--name',$AppName,
        '--runtime','NODE:22-lts',
        '-o','none'
    ))
}

$identity = Invoke-Az -Arguments @(
    'webapp','identity','assign',
    '--resource-group',$ResourceGroup,
    '--name',$AppName,
    '-o','json'
)
$identityObject = $identity.Text | ConvertFrom-Json
$principalId = [string]$identityObject.principalId
if ([string]::IsNullOrWhiteSpace($principalId)) {
    throw 'The App Service system-assigned managed identity has no principalId.'
}
Write-Host "Managed identity ready: $principalId"

if ([string]::IsNullOrWhiteSpace($BootstrapEmail)) {
    $BootstrapEmail = Read-Host 'Firebase sign-in email to bootstrap in PAWS SQL'
}
$BootstrapEmail = $BootstrapEmail.Trim().ToLowerInvariant()
if ($BootstrapEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
    throw 'BootstrapEmail must be a valid email address.'
}

$bootstrap = [ordered]@{}
$bootstrap[$BootstrapEmail] = [ordered]@{
    role = $BootstrapRole
    displayName = $BootstrapDisplayName
    officeName = $BootstrapOfficeName
}
$bootstrapJson = $bootstrap | ConvertTo-Json -Depth 5 -Compress

Write-Host 'Configuring App Service runtime settings...'
$appSettings = @(
    "FIREBASE_PROJECT_ID=$FirebaseProjectId",
    "PAWS_SQL_READS=on",
    "PAWS_SQL_AUTH=on",
    "PAWS_ACCOUNT_BOOTSTRAP_JSON=$bootstrapJson",
    "AZURE_SQL_SERVER=$SqlServer",
    "AZURE_SQL_DATABASE=$Database",
    "ALLOWED_ORIGINS=$AllowedOrigins",
    'DOE_REPOSITORY=firestore',
    'WEBSITE_NODE_DEFAULT_VERSION=~22'
)
[void](Invoke-Az -Arguments (@(
    'webapp','config','appsettings','set',
    '--resource-group',$ResourceGroup,
    '--name',$AppName,
    '--settings'
) + $appSettings + @('-o','none')))

if ($AllowAzureServicesToSql) {
    Write-Warning 'Enabling the Azure SQL special 0.0.0.0 firewall rule because -AllowAzureServicesToSql was explicitly supplied.'
    $sqlServerName = $SqlServer.Split('.')[0]
    [void](Invoke-Az -Arguments @(
        'sql','server','firewall-rule','create',
        '--resource-group',$ResourceGroup,
        '--server',$sqlServerName,
        '--name','AllowAzureServices',
        '--start-ip-address','0.0.0.0',
        '--end-ip-address','0.0.0.0',
        '-o','none'
    ))
}

. (Join-Path $PSScriptRoot 'azure_sql_migration\sql_access.ps1')
Write-Host 'Requesting an operator token for Azure SQL permission setup...'
$sqlToken = Get-PawsSqlAccessToken -TenantId $TenantId
$connection = Open-PawsSqlConnection -Server $SqlServer -Database $Database -AccessToken $sqlToken
try {
    Assert-PawsDatabase -Connection $connection -ExpectedDatabase $Database
    $principalLiteral = $AppName.Replace("'", "''")
    $permissionCommand = $connection.CreateCommand()
    $permissionCommand.CommandTimeout = 120
    $permissionCommand.CommandText = @"
DECLARE @principal sysname = N'$principalLiteral';
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @principal)
BEGIN
    DECLARE @createSql nvarchar(max) = N'CREATE USER ' + QUOTENAME(@principal) + N' FROM EXTERNAL PROVIDER;';
    EXEC sys.sp_executesql @createSql;
END;

DECLARE @grantSql nvarchar(max) =
    N'GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::paws TO ' + QUOTENAME(@principal) + N';' +
    N'GRANT EXECUTE ON SCHEMA::paws TO ' + QUOTENAME(@principal) + N';' +
    N'DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::staging TO ' + QUOTENAME(@principal) + N';';
EXEC sys.sp_executesql @grantSql;
"@
    [void]$permissionCommand.ExecuteNonQuery()

    $verifyCommand = $connection.CreateCommand()
    $verifyCommand.CommandText = @"
SELECT
    CASE WHEN EXISTS (
        SELECT 1
        FROM sys.database_permissions p
        INNER JOIN sys.database_principals dp ON dp.principal_id = p.grantee_principal_id
        INNER JOIN sys.schemas s ON s.schema_id = p.major_id
        WHERE dp.name = N'$principalLiteral'
          AND p.class_desc = 'SCHEMA'
          AND s.name = N'paws'
          AND p.permission_name = 'SELECT'
          AND p.state IN ('G','W')
    ) THEN 1 ELSE 0 END;
"@
    if ([int]$verifyCommand.ExecuteScalar() -ne 1) {
        throw "Managed identity '$AppName' does not have SELECT on schema paws after permission setup."
    }
}
finally {
    $connection.Dispose()
}
Write-Host "Azure SQL principal ready: $AppName"

$hostName = (Invoke-Az -Arguments @(
    'webapp','show',
    '--resource-group',$ResourceGroup,
    '--name',$AppName,
    '--query','defaultHostName',
    '-o','tsv'
)).Text.Trim()
if ([string]::IsNullOrWhiteSpace($hostName)) {
    throw 'Could not resolve the App Service default hostname.'
}
$baseUrl = "https://$hostName"

if (-not $SkipGitHubConfiguration) {
    Ensure-PortableGitHubCli
    Assert-Command -Name 'gh'
    $ghStatus = Invoke-Gh -Arguments @('auth','status') -AllowFailure
    if ($ghStatus.ExitCode -ne 0) {
        Write-Host 'GitHub CLI is not signed in. Starting browser sign-in...'
        & gh auth login --hostname github.com --git-protocol https --web
        if ($LASTEXITCODE -ne 0) {
            throw 'GitHub CLI browser sign-in failed.'
        }
        $ghStatus = Invoke-Gh -Arguments @('auth','status') -AllowFailure
        if ($ghStatus.ExitCode -ne 0) {
            throw 'GitHub CLI is still not authenticated after browser sign-in.'
        }
    }

    Write-Host 'Configuring GitHub production variables and publish profile...'
    [void](Invoke-Gh -Arguments @('variable','set','DOE_API_APP_NAME','--repo',$GitHubRepository,'--body',$AppName))
    [void](Invoke-Gh -Arguments @('variable','set','PRODUCTION_DOE_API_BASE_URL','--repo',$GitHubRepository,'--body',$baseUrl))
    [void](Invoke-Gh -Arguments @('api','--method','PUT',"repos/$GitHubRepository/environments/production"))

    $publishProfile = (Invoke-Az -Arguments @(
        'webapp','deployment','list-publishing-profiles',
        '--resource-group',$ResourceGroup,
        '--name',$AppName,
        '--xml'
    )).Text
    if ([string]::IsNullOrWhiteSpace($publishProfile)) {
        throw 'Azure returned an empty publish profile.'
    }
    $publishProfile | & gh secret set AZURE_DOE_API_PUBLISH_PROFILE --repo $GitHubRepository --env production
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to set AZURE_DOE_API_PUBLISH_PROFILE in the GitHub production environment.'
    }

    $mainSha = (Invoke-Gh -Arguments @('api',"repos/$GitHubRepository/commits/main",'--jq','.sha')).Text.Trim()
    Write-Host "GitHub main SHA: $mainSha"

    if (-not $SkipDeployment) {
        Write-Host 'Triggering exact-main Azure DOE API production deployment...'
        [void](Invoke-Gh -Arguments @(
            'workflow','run','azure-doe-api-production-deploy.yml',
            '--repo',$GitHubRepository,
            '-f',"commit_sha=$mainSha"
        ))
        Start-Sleep -Seconds 5

        $apiRunsRaw = (Invoke-Gh -Arguments @(
            'run','list',
            '--repo',$GitHubRepository,
            '--workflow','azure-doe-api-production-deploy.yml',
            '--limit','10',
            '--json','databaseId,headSha,event,status,conclusion'
        )).Text
        $apiRuns = @($apiRunsRaw | ConvertFrom-Json)
        $apiRun = $apiRuns | Where-Object { $_.event -eq 'workflow_dispatch' } | Select-Object -First 1
        if (-not $apiRun) {
            throw 'Could not locate the workflow_dispatch run that was just started.'
        }
        & gh run watch ([string]$apiRun.databaseId) --repo $GitHubRepository --exit-status
        if ($LASTEXITCODE -ne 0) {
            throw "Azure DOE API production deployment failed. Run ID: $($apiRun.databaseId)"
        }

        Write-Host 'Rerunning the current-main Azure Static Web Apps build if it previously failed...'
        $staticRunsRaw = (Invoke-Gh -Arguments @(
            'run','list',
            '--repo',$GitHubRepository,
            '--workflow','azure-static-web-apps.yml',
            '--branch','main',
            '--limit','20',
            '--json','databaseId,headSha,status,conclusion'
        )).Text
        $staticRuns = @($staticRunsRaw | ConvertFrom-Json)
        $staticRun = $staticRuns | Where-Object { $_.headSha -eq $mainSha } | Select-Object -First 1
        if ($staticRun -and $staticRun.conclusion -eq 'failure') {
            [void](Invoke-Gh -Arguments @('run','rerun',([string]$staticRun.databaseId),'--repo',$GitHubRepository))
        }
    }
}
elseif (-not $SkipDeployment) {
    Write-Warning '-SkipGitHubConfiguration prevents the exact-main GitHub deployment. No API package was deployed by this script.'
}

Write-Host "Checking API health at $baseUrl/api/health ..."
try {
    $health = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/health" -TimeoutSec 30
    if ($health.ok -ne $true) {
        throw 'Health payload did not contain ok=true.'
    }
    Write-Host 'PAWS API health: PASS'
    $sqlHealth = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/health/sql" -TimeoutSec 30
    if ($sqlHealth.ok -ne $true -or $sqlHealth.dependency -ne 'azure-sql') {
        throw 'Azure SQL health payload did not report a healthy azure-sql dependency.'
    }
    Write-Host 'PAWS App Service -> Azure SQL health: PASS'
}
catch {
    if ($SkipDeployment -or $SkipGitHubConfiguration) {
        Write-Warning "API health is not ready yet: $($_.Exception.Message)"
    }
    else {
        throw
    }
}

[pscustomobject][ordered]@{
    appName = $AppName
    appServiceUrl = $baseUrl
    sqlServer = $SqlServer
    database = $Database
    managedIdentityPrincipalId = $principalId
    sqlAuth = 'on'
    sqlReads = 'on'
    githubConfigured = (-not $SkipGitHubConfiguration)
    deploymentTriggered = (-not $SkipGitHubConfiguration -and -not $SkipDeployment)
}
