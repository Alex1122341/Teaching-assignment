[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $CandidateRoot,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string] $ExpectedPackageSha256,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string] $ExpectedLauncherSha256,

    [switch] $Apply
)

$ErrorActionPreference = 'Stop'
$expectedHost = 'ITAPPVETOPSDB01'
$expectedIdentity = 'UC\sa-xinyu.zhu1'
$expectedRepoHead = '4c01749458c3cf2e1b3b608803a2142b663ed038'
$runtimeRoot = 'C:\PAWS\Runtime'
$oldRepoRoot = 'C:\PAWS\Teaching-assignment-azure'
$oldServerRoot = Join-Path $oldRepoRoot 'server'
$oldLauncher = Join-Path $runtimeRoot 'Start-PAWSApi-Temporary.ps1'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$npmCli = 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js'

function Assert-Equal([string] $Actual, [string] $Expected, [string] $Label) {
    if ($Actual -cne $Expected) { throw "$Label mismatch; refusing Stage A activation." }
}

function Get-HttpStatus([string] $Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
        return [int] $response.StatusCode
    }
    catch {
        if ($_.Exception.Response) { return [int] $_.Exception.Response.StatusCode }
        throw
    }
}

function Wait-ForHealth([int] $ExpectedStatus, [int] $Seconds = 45) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $status = Get-HttpStatus 'http://127.0.0.1:18787/api/health/sql'
            if ($status -eq $ExpectedStatus) { return $status }
        }
        catch { }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "SQL health did not reach HTTP $ExpectedStatus within $Seconds seconds."
}

if ([Environment]::MachineName -cne $expectedHost) { throw 'Wrong target host; refusing Stage A activation.' }
Assert-Equal ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) $expectedIdentity 'Windows identity'

$candidate = (Resolve-Path -LiteralPath $CandidateRoot).Path
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Node 22 executable is missing.' }
$nodeVersion = (& $nodePath --version).Trim()
if ($nodeVersion -notmatch '^v22\.') { throw 'The target Node runtime is not Node 22.' }
$inventoryPath = Join-Path $candidate 'candidate-inventory.json'
$inventory = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json
$expectedPackage = $ExpectedPackageSha256.ToLowerInvariant()
Assert-Equal ([string] $inventory.packageSha256) $expectedPackage 'Candidate inventory SHA-256'
Assert-Equal ([string] $inventory.baseSha) 'b6e74ff5ff34ef5f3b2541f8a3528341ff38f943' 'Accepted product base SHA'
Assert-Equal ([string] $inventory.nodeVersion) '22.x' 'Candidate Node version'
Assert-Equal ([string] $inventory.pdfLibVersion) '1.17.1' 'Candidate PDF library version'
$inventoryDigest = & $nodePath -e "const fs=require('node:fs'),c=require('node:crypto');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const d=x.packageSha256;delete x.packageSha256;const h=c.createHash('sha256').update(JSON.stringify(x)+'\n').digest('hex');if(h!==d)process.exit(7);process.stdout.write(h)" $inventoryPath
if ($LASTEXITCODE -ne 0) { throw 'Candidate inventory canonical digest is invalid.' }
Assert-Equal $inventoryDigest.Trim() $expectedPackage 'Canonical candidate inventory digest'

$expectedFiles = @('candidate-inventory.json', 'server/package.json', 'server/package-lock.json') + @($inventory.files | ForEach-Object { [string] $_.path })
$actualFiles = @(Get-ChildItem -LiteralPath $candidate -File -Recurse | ForEach-Object {
    $_.FullName.Substring($candidate.Length + 1).Replace('\', '/')
})
if (@($actualFiles | Where-Object { $_ -match '(^|/)(\.env(?:\.[^/]*)?|node_modules|tests?|fixtures|secrets?|credentials?)(/|$)|\.(pem|pfx|p12|key)$' }).Count -gt 0) {
    throw 'Candidate contains a forbidden config, secret, dependency, or test path.'
}
if (@(Compare-Object ($expectedFiles | Sort-Object -Unique) ($actualFiles | Sort-Object -Unique)).Count -ne 0) {
    throw 'Candidate file inventory differs from the accepted inventory.'
}
foreach ($entry in $inventory.files) {
    $relative = [string] $entry.path
    if ($relative -match '(^/|(^|/)\.\.(?:/|$)|^[A-Za-z]:|^\\\\)') { throw 'Candidate inventory contains an unsafe path.' }
    $file = Join-Path $candidate $relative.Replace('/', '\')
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Candidate file is missing: $relative" }
    $actualHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Equal $actualHash ([string] $entry.sha256).ToLowerInvariant() "Candidate file hash: $relative"
}

$manifestPath = Join-Path $candidate 'server\package.json'
$lockPath = Join-Path $candidate 'server\package-lock.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
Assert-Equal ([string] $manifest.engines.node) '22.x' 'package.json Node engine'
Assert-Equal ([string] $manifest.dependencies.'pdf-lib') '1.17.1' 'package.json pdf-lib version'
& $nodePath -e "const fs=require('node:fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(x.packages[''].dependencies['pdf-lib']!=='1.17.1'||x.packages['node_modules/pdf-lib'].version!=='1.17.1')process.exit(8);process.stdout.write('LOCK_OK')" $lockPath
if ($LASTEXITCODE -ne 0) { throw 'package-lock does not pin pdf-lib@1.17.1.' }

if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Node 22 executable is missing.' }
$nodeVersion = (& $nodePath --version).Trim()
if ($nodeVersion -notmatch '^v22\.') { throw 'The target Node runtime is not Node 22.' }
if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { throw 'The Node 22 npm CLI is missing.' }

Assert-Equal ((& git -C $oldRepoRoot rev-parse HEAD).Trim()) $expectedRepoHead 'Previous runtime repository HEAD'
$repoStatus = @(& git -C $oldRepoRoot status --porcelain)
if ($repoStatus.Count -gt 0) { throw 'Previous runtime repository is not clean; refusing activation.' }
if (-not (Test-Path -LiteralPath $oldLauncher -PathType Leaf)) { throw 'Previous runtime launcher is missing.' }
$launcherHash = (Get-FileHash -LiteralPath $oldLauncher -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-Equal $launcherHash $ExpectedLauncherSha256.ToLowerInvariant() 'Existing launcher SHA-256'
$launcherText = [IO.File]::ReadAllText($oldLauncher)
if ($launcherText -notmatch "PAWS_SQL_ALLOW_SELF_SIGNED\s*=\s*'false'") {
    throw 'Existing launcher does not declare strict SQL certificate validation.'
}
$oldServerRootLine = '$serverRoot = ''C:\PAWS\Teaching-assignment-azure\server'''
if ([regex]::Matches($launcherText, [regex]::Escape($oldServerRootLine)).Count -ne 1) {
    throw 'Existing launcher source root is not the expected single line.'
}

$baselineHealth = Get-HttpStatus 'http://127.0.0.1:18787/api/health/sql'
if ($baselineHealth -ne 200) { throw 'Existing runtime SQL health is not HTTP 200; refusing replacement.' }
$versionRoot = Join-Path (Join-Path $runtimeRoot 'Versions') $expectedPackage
$deployServerRoot = Join-Path $versionRoot 'server'
if (Test-Path -LiteralPath $versionRoot) { throw 'Versioned candidate path already exists; refusing overwrite.' }

if (-not $Apply) {
    [pscustomobject]@{
        Result = 'PREFLIGHT PASS; no server files or process changed'
        Host = [Environment]::MachineName
        Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        NodeVersion = $nodeVersion
        BaseSha = $inventory.baseSha
        PackageSha256 = $expectedPackage
        ExistingSqlHealth = $baselineHealth
        Destination = $deployServerRoot
        ExistingLauncherSha256 = $launcherHash
    } | ConvertTo-Json -Depth 4
    return
}

$listener = @(Get-NetTCPConnection -LocalPort 18787 -State Listen -ErrorAction SilentlyContinue)
if ($listener.Count -ne 1 -or $listener[0].LocalAddress -cne '127.0.0.1') {
    throw 'Expected exactly one loopback listener on port 18787; refusing replacement.'
}
$oldPid = [int] $listener[0].OwningProcess
$oldProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $oldPid"
if ($oldProcess.ExecutablePath -cne $nodePath) { throw 'Port 18787 is not owned by the expected Node executable.' }
$oldOwner = Invoke-CimMethod -InputObject $oldProcess -MethodName GetOwner
Assert-Equal ("{0}\{1}" -f $oldOwner.Domain, $oldOwner.User) $expectedIdentity 'Current listener owner'

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$rollbackRoot = Join-Path (Join-Path $runtimeRoot 'Acceptance\2026-10-04\rollback') "pre-stage-a-$stamp"
if (Test-Path -LiteralPath $rollbackRoot) { throw 'Rollback destination already exists; refusing overwrite.' }
New-Item -ItemType Directory -Path $rollbackRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $rollbackRoot 'server') -Force | Out-Null
Copy-Item -LiteralPath $oldLauncher -Destination (Join-Path $rollbackRoot 'Start-PAWSApi-Temporary.ps1')
Copy-Item -LiteralPath (Join-Path $oldServerRoot 'src') -Destination (Join-Path $rollbackRoot 'server\src') -Recurse
Copy-Item -LiteralPath (Join-Path $oldServerRoot 'package.json') -Destination (Join-Path $rollbackRoot 'server\package.json')
Copy-Item -LiteralPath (Join-Path $oldServerRoot 'package-lock.json') -Destination (Join-Path $rollbackRoot 'server\package-lock.json')
@{
    createdUtc = (Get-Date).ToUniversalTime().ToString('o')
    previousRepoHead = $expectedRepoHead
    previousLauncherSha256 = $launcherHash
    previousServerRoot = $oldServerRoot
    previousListenerPid = $oldPid
    protectedConfiguration = 'Preserved in place under C:\PAWS\Runtime; no secret values copied or read.'
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $rollbackRoot 'rollback-manifest.json') -Encoding UTF8

New-Item -ItemType Directory -Path $deployServerRoot -Force | Out-Null
Copy-Item -Path (Join-Path $candidate 'server\*') -Destination $deployServerRoot -Recurse
& $nodePath $npmCli ci --omit=dev --prefix $deployServerRoot
if ($LASTEXITCODE -ne 0) { throw "Locked production dependency install failed with exit code $LASTEXITCODE." }
$installedPdf = Get-Content -LiteralPath (Join-Path $deployServerRoot 'node_modules\pdf-lib\package.json') -Raw | ConvertFrom-Json
Assert-Equal ([string] $installedPdf.version) '1.17.1' 'Installed pdf-lib version'
Push-Location $deployServerRoot
try { & $nodePath -e "require('msnodesqlv8'); console.log('Windows SQL driver module load OK')" }
finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'Windows SQL driver module failed to load.' }

$stageLauncher = Join-Path $runtimeRoot 'Acceptance\2026-10-04\Start-PAWSApi-StageA.ps1'
if (Test-Path -LiteralPath $stageLauncher) { throw 'Stage A launcher already exists; refusing overwrite.' }
$newServerRootLine = '$serverRoot = ''' + $deployServerRoot + ''''
$stageLauncherText = $launcherText.Replace($oldServerRootLine, $newServerRootLine)
[IO.File]::WriteAllText($stageLauncher, $stageLauncherText, (New-Object Text.UTF8Encoding($false)))
if ((Get-FileHash -LiteralPath $oldLauncher -Algorithm SHA256).Hash.ToLowerInvariant() -ne $launcherHash) {
    throw 'Existing launcher changed during staging; refusing process replacement.'
}

$rolledBack = $false
try {
    Stop-Process -Id $oldPid -Force
    try { Wait-Process -Id $oldPid -Timeout 10 -ErrorAction Stop } catch { }
    $powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $argumentLine = '-NoProfile -File "' + $stageLauncher + '"'
    Start-Process -FilePath $powershellExe -ArgumentList $argumentLine -WorkingDirectory $runtimeRoot -WindowStyle Hidden | Out-Null
    Wait-ForHealth 200 60 | Out-Null
    foreach ($route in @('/api/v1/me', '/api/v1/afc-requests', '/api/v1/afc-requests/00000000-0000-4000-8000-000000000001/approved-artifact')) {
        $status = Get-HttpStatus ("http://127.0.0.1:18787" + $route)
        if ($status -ne 401) { throw "Anonymous route $route returned HTTP $status instead of 401." }
    }
    [pscustomobject]@{
        Result = 'STAGE A RUNTIME ACTIVATED'
        NodeVersion = $nodeVersion
        PackageSha256 = $expectedPackage
        RuntimeRoot = $deployServerRoot
        TemporaryIdentity = $expectedIdentity
        SqlHealth = 200
        AnonymousMe = 401
        AnonymousAfcRequests = 401
        AnonymousArtifact = 401
        RollbackRoot = $rollbackRoot
        ProtectedConfiguration = 'Preserved in place; no secret values logged.'
    } | ConvertTo-Json -Depth 4
}
catch {
    $newListener = @(Get-NetTCPConnection -LocalPort 18787 -State Listen -ErrorAction SilentlyContinue)
    foreach ($entry in $newListener) {
        if ([int] $entry.OwningProcess -ne $oldPid) { Stop-Process -Id ([int] $entry.OwningProcess) -Force -ErrorAction SilentlyContinue }
    }
    $powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $rollbackArguments = '-NoProfile -File "' + $oldLauncher + '"'
    Start-Process -FilePath $powershellExe -ArgumentList $rollbackArguments -WorkingDirectory $runtimeRoot -WindowStyle Hidden | Out-Null
    try { Wait-ForHealth 200 60 | Out-Null; $rolledBack = $true } catch { }
    if ($rolledBack) { throw "Stage A smoke failed; old runtime health was restored. Cause: $($_.Exception.Message)" }
    throw "Stage A smoke failed and old runtime did not recover automatically. Preserve all files and inspect the exact rollback root. Cause: $($_.Exception.Message)"
}
