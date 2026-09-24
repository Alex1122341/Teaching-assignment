Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PawsSqlAccessToken {
    param([string]$TenantId = 'c609a0ec-a5e3-4631-9686-192280bd9151')

    $clientId = '04b07795-8ddb-461a-bbee-02f9e1bf7b46'
    $deviceEndpoint = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/devicecode"
    $tokenEndpoint = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
    $scope = 'https://database.windows.net/.default openid profile offline_access'

    $device = Invoke-RestMethod -Method Post -Uri $deviceEndpoint -ContentType 'application/x-www-form-urlencoded' -Body @{
        client_id = $clientId
        scope = $scope
    }
    Write-Host $device.message

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds([int]$device.expires_in)
    $interval = [Math]::Max(5, [int]$device.interval)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds $interval
        try {
            $token = Invoke-RestMethod -Method Post -Uri $tokenEndpoint -ContentType 'application/x-www-form-urlencoded' -Body @{
                grant_type = 'urn:ietf:params:oauth:grant-type:device_code'
                client_id = $clientId
                device_code = $device.device_code
            }
            return [string]$token.access_token
        }
        catch {
            $detail = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($detail.error -eq 'authorization_pending') { continue }
            if ($detail.error -eq 'slow_down') { $interval += 5; continue }
            throw
        }
    }
    throw 'Microsoft Entra device authorization expired.'
}

function Open-PawsSqlConnection {
    param(
        [Parameter(Mandatory = $true)][string]$Server,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$AccessToken
    )
    $connectionString = "Server=tcp:$Server,1433;Initial Catalog=$Database;Encrypt=True;TrustServerCertificate=False;Connection Timeout=120;"
    $connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
    $connection.AccessToken = $AccessToken
    $connection.Open()
    return $connection
}

function Assert-PawsDatabase {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [Parameter(Mandatory = $true)][string]$ExpectedDatabase
    )
    $cmd = $Connection.CreateCommand()
    $cmd.CommandText = 'SELECT DB_NAME();'
    $actual = [string]$cmd.ExecuteScalar()
    if ($actual -ne $ExpectedDatabase) {
        throw "Connected database '$actual' does not match expected '$ExpectedDatabase'."
    }
}

function Get-PawsSha256Text {
    param([Parameter(Mandatory = $true)][string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    }
    finally { $sha.Dispose() }
}