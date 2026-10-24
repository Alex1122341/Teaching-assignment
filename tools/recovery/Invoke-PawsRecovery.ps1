param([Parameter(Mandatory)][string]$ConfigPath,[switch]$CheckOnly)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'PawsRecovery.psm1') -Force
$config=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json
Assert-PawsRecoveryConfig $config
if([Security.Principal.WindowsIdentity]::GetCurrent().Name -ine $config.Identity){throw 'RECOVERY_WRONG_IDENTITY'}
Assert-PawsRecoveryFiles $config
foreach($entry in @(@($config.ApiLauncherPath,$config.ApiLauncherSha256),@($config.CloudflaredPath,$config.CloudflaredSha256))){if((Get-PawsFileSha256 $entry[0]) -ine $entry[1]){throw 'RECOVERY_FILE_DRIFT'}}
if($config.TunnelMode -eq 'named' -and (Get-PawsFileSha256 $config.TunnelConfigPath) -ine $config.TunnelConfigSha256){throw 'RECOVERY_TUNNEL_CONFIG_DRIFT'}
$mutex=New-Object Threading.Mutex($false,'Global\PAWS-Runtime-Recovery')
$owned=$false
function Read-Health([string]$Uri){try{return Invoke-RestMethod $Uri -TimeoutSec 5}catch{return $null}}
function Write-Status($Status){
 $Status|ConvertTo-Json -Depth 6 -Compress|Write-Output
 if(-not $CheckOnly){
  New-Item -ItemType Directory -Path $config.LogDirectory -Force|Out-Null
  $log=Join-Path $config.LogDirectory 'recovery.jsonl'
  if((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 1048576){Move-Item -LiteralPath $log -Destination (Join-Path $config.LogDirectory ('recovery-'+[datetime]::UtcNow.ToString('yyyyMMddTHHmmssfff')+'.jsonl'))}
  $Status|ConvertTo-Json -Depth 6 -Compress|Add-Content -LiteralPath $log -Encoding UTF8
 }
}
try{
 try{$owned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true}
 if(-not $owned){Write-Status ([pscustomobject]@{status='already_running'});exit 0}
 $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop)
 $api=@($listeners|Where-Object LocalPort -eq $config.ApiPort)
 if($api.Count -gt 1 -or ($api.Count -eq 1 -and $api[0].LocalAddress -cne '127.0.0.1')){throw 'RECOVERY_UNEXPECTED_LISTENER'}
 $runtime=$null;if($api.Count){$runtime=Read-Health ('http://127.0.0.1:'+$config.ApiPort+'/api/health/runtime');Assert-PawsRecoveryRuntime $runtime $config}
 $startedApi=$false;$startedTunnel=$false
 if(-not $api.Count){
  if($CheckOnly){Write-Status ([pscustomobject]@{status='api_absent';siteReady=$false});exit 2}
  Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -ArgumentList '-NoProfile','-File',('"'+$config.ApiLauncherPath+'"') -WindowStyle Hidden|Out-Null
  $startedApi=$true;$timer=[Diagnostics.Stopwatch]::StartNew()
  do{Start-Sleep -Milliseconds 500;$runtime=Read-Health ('http://127.0.0.1:'+$config.ApiPort+'/api/health/runtime')}while($null -eq $runtime -and $timer.Elapsed.TotalSeconds -lt 45)
  Assert-PawsRecoveryRuntime $runtime $config
  $confirmed=@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object LocalPort -eq $config.ApiPort)
  if($confirmed.Count -ne 1 -or $confirmed[0].LocalAddress -cne '127.0.0.1'){throw 'RECOVERY_UNEXPECTED_LISTENER'}
 }
 $sql=Read-Health ('http://127.0.0.1:'+$config.ApiPort+'/api/health/sql')
 if($null -eq $sql -or $sql.status -cne 'ok' -or $sql.service -cne 'paws-beta-sql-runtime'){throw 'RECOVERY_SQL_UNAVAILABLE'}
 $tunnels=@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object {$_.ExecutablePath -and $_.ExecutablePath -ieq $config.CloudflaredPath})
 if($tunnels.Count -gt 1){throw 'RECOVERY_DUPLICATE_TUNNEL'}
 $stateFile=Join-Path $config.LogDirectory 'tunnel-state.json'
 $tunnelLog=$null
 if($config.PSObject.Properties['ExistingTunnelLogPath']){$tunnelLog=$config.ExistingTunnelLogPath}
 if(Test-Path -LiteralPath $stateFile){$state=Get-Content -LiteralPath $stateFile -Raw|ConvertFrom-Json;if($tunnels.Count -eq 1 -and $state.pid -eq $tunnels[0].ProcessId){$tunnelLog=$state.logPath}}
 if(-not $tunnels.Count){
  if($CheckOnly){Write-Status ([pscustomobject]@{status='tunnel_absent';siteReady=$false});exit 2}
  New-Item -ItemType Directory -Path $config.LogDirectory -Force|Out-Null
  $tag=[datetime]::UtcNow.ToString('yyyyMMddTHHmmssfff');$tunnelLog=Join-Path $config.LogDirectory ('tunnel-'+$tag+'.stderr.log')
  $tunnelArguments=@('tunnel','--no-autoupdate','--protocol','http2','--url',('http://127.0.0.1:'+$config.ApiPort))
  if($config.TunnelMode -eq 'named'){$tunnelArguments=@('tunnel','--config',('"'+$config.TunnelConfigPath+'"'),'run')}
  $process=Start-Process -FilePath $config.CloudflaredPath -ArgumentList $tunnelArguments -WindowStyle Hidden -RedirectStandardOutput (Join-Path $config.LogDirectory ('tunnel-'+$tag+'.stdout.log')) -RedirectStandardError $tunnelLog -PassThru
  [pscustomobject]@{pid=$process.Id;logPath=$tunnelLog}|ConvertTo-Json|Set-Content -LiteralPath $stateFile -Encoding UTF8
  $startedTunnel=$true
 }
 $activeOrigin=$config.PublishedOrigin
 if($config.TunnelMode -eq 'quick'){
  $activeOrigin='';if($tunnelLog -and (Test-Path -LiteralPath $tunnelLog)){
   $text=(Get-Content -LiteralPath $tunnelLog -Tail 80) -join "`n"
   $matches=[regex]::Matches($text,'https://[a-z0-9-]+\.trycloudflare\.com')
   if($matches.Count){$activeOrigin=$matches[$matches.Count-1].Value}
  }
 }
 $decision=Get-PawsRecoveryDecision $true $true $true $activeOrigin $config.PublishedOrigin
 $public=$null;if($decision.action -eq 'healthy'){$public=Read-Health ($config.PublishedOrigin.TrimEnd('/')+'/api/health/runtime');Assert-PawsRecoveryRuntime $public $config}
 $ready=$decision.action -eq 'healthy'
 Write-Status ([pscustomobject]@{status=$decision.reason;siteReady=$ready;apiReady=$true;startedApi=$startedApi;startedTunnel=$startedTunnel;frontendUpdateRequired=$decision.frontendUpdateRequired;activeOrigin=$activeOrigin;checkedAtUtc=[datetime]::UtcNow.ToString('o')})
 if(-not $ready){exit 3}
}catch{
 # Fixed error identifiers only; never serialize credentials, command lines or exception details.
 Write-Status ([pscustomobject]@{status='recovery_failed';siteReady=$false;checkedAtUtc=[datetime]::UtcNow.ToString('o')})
 exit 1
}finally{if($owned){$mutex.ReleaseMutex()};$mutex.Dispose()}
