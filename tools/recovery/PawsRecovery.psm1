Set-StrictMode -Version Latest
function Get-PawsFileSha256([string]$Path){
 $stream=[IO.File]::OpenRead($Path);$sha=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')}finally{$sha.Dispose();$stream.Dispose()}
}
function Assert-PawsRecoveryConfig($Config){
 $required=@('Identity','ReleaseSha','TrustAnchor','ApiPort','ApiLauncherPath','ApiLauncherSha256','ApiServerRoot','ApiManifestPath','ApiManifestSha256','CloudflaredPath','CloudflaredSha256','TunnelMode','PublishedOrigin','LogDirectory','ExpectedGates')
 $allowed=$required+@('TunnelConfigPath','TunnelConfigSha256','ExistingTunnelLogPath')
 foreach($key in $required){if(-not $Config.PSObject.Properties[$key] -or [string]::IsNullOrWhiteSpace([string]$Config.$key)){throw 'RECOVERY_CONFIG_REQUIRED'}}
 foreach($key in $Config.PSObject.Properties.Name){if($key -notin $allowed){throw 'RECOVERY_CONFIG_UNKNOWN_FIELD'}}
 if($Config.ReleaseSha -cnotmatch '^[a-f0-9]{40}$' -or $Config.TrustAnchor -cnotmatch '^[a-f0-9]{40}$'){throw 'RECOVERY_CONFIG_RELEASE'}
 foreach($key in @('ApiLauncherSha256','ApiManifestSha256','CloudflaredSha256')){if($Config.$key -notmatch '^[a-fA-F0-9]{64}$'){throw 'RECOVERY_CONFIG_HASH'}}
 if([int]$Config.ApiPort -ne 18787 -or $Config.TunnelMode -notin @('quick','named')){throw 'RECOVERY_CONFIG_MODE'}
 if(@($Config.ExpectedGates.PSObject.Properties).Count -eq 0){throw 'RECOVERY_CONFIG_GATES'}
 foreach($gate in $Config.ExpectedGates.PSObject.Properties){if($gate.Value -isnot [bool]){throw 'RECOVERY_CONFIG_GATES'}}
 $uri=$null;if(-not [uri]::TryCreate($Config.PublishedOrigin,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -cne 'https' -or $uri.UserInfo -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment){throw 'RECOVERY_CONFIG_ORIGIN'}
 foreach($key in @('ApiLauncherPath','ApiServerRoot','ApiManifestPath','CloudflaredPath','LogDirectory')){if(-not [IO.Path]::IsPathRooted($Config.$key) -or $Config.$key -match '["\r\n]'){throw 'RECOVERY_CONFIG_PATH'}}
 if($Config.TunnelMode -eq 'named'){
  if(-not $Config.PSObject.Properties['TunnelConfigPath'] -or -not $Config.PSObject.Properties['TunnelConfigSha256'] -or -not [IO.Path]::IsPathRooted($Config.TunnelConfigPath) -or $Config.TunnelConfigPath -match '["\r\n]' -or $Config.TunnelConfigSha256 -notmatch '^[a-fA-F0-9]{64}$'){throw 'RECOVERY_CONFIG_NAMED_TUNNEL'}
 }
}
function Assert-PawsRecoveryFiles($Config){
 if((Get-PawsFileSha256 $Config.ApiManifestPath) -ine $Config.ApiManifestSha256){throw 'RECOVERY_MANIFEST_DRIFT'}
 $records=Get-Content -LiteralPath $Config.ApiManifestPath -Raw|ConvertFrom-Json
 if(@($records).Count -lt 3 -or @($records.path|Select-Object -Unique).Count -ne @($records).Count){throw 'RECOVERY_MANIFEST_INVENTORY'}
 $root=[IO.Path]::GetFullPath($Config.ApiServerRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
 $prefix=$root+[IO.Path]::DirectorySeparatorChar
 $src=Join-Path $root 'src'
 if(((Get-Item -LiteralPath $src -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'RECOVERY_RUNTIME_REPARSE_POINT'}
 $items=@(Get-ChildItem -LiteralPath $src -Recurse -Force -ErrorAction Stop)
 if(@($items|Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0}).Count){throw 'RECOVERY_RUNTIME_REPARSE_POINT'}
 $actual=@($items|Where-Object {-not $_.PSIsContainer}|ForEach-Object {$_.FullName.Substring($prefix.Length).Replace('\','/')})+@('package.json','package-lock.json')
 if((($actual|Sort-Object) -join ',') -cne (($records.path|Sort-Object) -join ',')){throw 'RECOVERY_RUNTIME_INVENTORY'}
 $latin=[Text.Encoding]::GetEncoding(28591)
 foreach($file in $records){
  if($file.path -cnotmatch '^(?:src/[a-zA-Z0-9_./-]+|package(?:-lock)?\.json)$' -or $file.sha256 -notmatch '^[a-fA-F0-9]{64}$'){throw 'RECOVERY_MANIFEST_FIELD'}
  $target=[IO.Path]::GetFullPath((Join-Path $root $file.path));if(-not $target.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'RECOVERY_RUNTIME_PATH'}
  $bytes=$latin.GetBytes($latin.GetString([IO.File]::ReadAllBytes($target)).Replace("`r`n","`n"))
  $sha=[Security.Cryptography.SHA256]::Create();try{$hash=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','')}finally{$sha.Dispose()}
  if($hash -ine $file.sha256){throw 'RECOVERY_RUNTIME_SOURCE_DRIFT'}
 }
}
function Assert-PawsRecoveryRuntime($Health,$Config){
 if($null -eq $Health -or $Health.status -cne 'ok' -or $Health.service -cne 'paws-university-api' -or $Health.authority -cne 'vetmed-ops-sql' -or $Health.releaseSha -cne $Config.ReleaseSha -or $Health.runtimeTrustAnchor -cne $Config.TrustAnchor){throw 'RECOVERY_RUNTIME_IDENTITY'}
 if(@($Health.writeGates.PSObject.Properties).Count -ne @($Config.ExpectedGates.PSObject.Properties).Count){throw 'RECOVERY_RUNTIME_GATES'}
 foreach($gate in $Config.ExpectedGates.PSObject.Properties){if(-not $Health.writeGates.PSObject.Properties[$gate.Name] -or $Health.writeGates.($gate.Name) -isnot [bool] -or $Health.writeGates.($gate.Name) -ne $gate.Value){throw 'RECOVERY_RUNTIME_GATES'}}
}
function Get-PawsRecoveryDecision([bool]$ApiListening,[bool]$ApiHealthy,[bool]$TunnelRunning,[string]$ActiveOrigin,[string]$PublishedOrigin){
 if($ApiListening -and -not $ApiHealthy){return [pscustomobject]@{action='blocked';reason='API_OCCUPIED_UNVERIFIED';frontendUpdateRequired=$false}}
 if(-not $ApiListening){return [pscustomobject]@{action='start_api';reason='API_ABSENT';frontendUpdateRequired=$false}}
 if(-not $TunnelRunning){return [pscustomobject]@{action='start_tunnel';reason='TUNNEL_ABSENT';frontendUpdateRequired=$false}}
 if([string]::IsNullOrWhiteSpace($ActiveOrigin) -or $ActiveOrigin.TrimEnd('/') -cne $PublishedOrigin.TrimEnd('/')){return [pscustomobject]@{action='manual_ingress';reason='FRONTEND_ORIGIN_UPDATE_REQUIRED';frontendUpdateRequired=$true}}
 return [pscustomobject]@{action='healthy';reason='RUNTIME_AND_ORIGIN_MATCH';frontendUpdateRequired=$false}
}
function New-PawsRecoveryTaskXml([string]$ConfigPath,[string]$ScriptPath,[string]$Identity,[datetime]$StartTime){
 foreach($path in @($ConfigPath,$ScriptPath)){if(-not [IO.Path]::IsPathRooted($path) -or $path -match '["\r\n]'){throw 'RECOVERY_TASK_PATH'}}
 $user=[Security.SecurityElement]::Escape($Identity)
 $arguments=[Security.SecurityElement]::Escape('-NoProfile -File "'+$ScriptPath+'" -ConfigPath "'+$ConfigPath+'"')
 $work=[Security.SecurityElement]::Escape([IO.Path]::GetDirectoryName($ScriptPath))
 $start=$StartTime.ToString('yyyy-MM-ddTHH:mm:ss')
 return @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <RegistrationInfo><Description>Recover reviewed PAWS runtime and check ingress; never change business data or Hosting.</Description></RegistrationInfo>
 <Triggers>
  <BootTrigger><Enabled>true</Enabled><Delay>PT2M</Delay></BootTrigger>
  <LogonTrigger><Enabled>true</Enabled><UserId>$user</UserId></LogonTrigger>
  <CalendarTrigger><Repetition><Interval>PT2M</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$start</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>
 </Triggers>
 <Principals><Principal id="Runtime"><UserId>$user</UserId><LogonType>Password</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT5M</ExecutionTimeLimit><Enabled>true</Enabled><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>
 <Actions Context="Runtime"><Exec><Command>C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</Command><Arguments>$arguments</Arguments><WorkingDirectory>$work</WorkingDirectory></Exec></Actions>
</Task>
"@
}
Export-ModuleMember -Function Get-PawsFileSha256,Assert-PawsRecoveryConfig,Assert-PawsRecoveryFiles,Assert-PawsRecoveryRuntime,Get-PawsRecoveryDecision,New-PawsRecoveryTaskXml
