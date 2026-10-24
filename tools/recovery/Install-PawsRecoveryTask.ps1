param([Parameter(Mandatory)][string]$ConfigPath,[switch]$Install,[Management.Automation.PSCredential]$Credential)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'PawsRecovery.psm1') -Force
$config=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json
Assert-PawsRecoveryConfig $config
$script=Join-Path $PSScriptRoot 'Invoke-PawsRecovery.ps1'
$xml=New-PawsRecoveryTaskXml ([IO.Path]::GetFullPath($ConfigPath)) $script $config.Identity ((Get-Date).AddMinutes(2))
New-Item -ItemType Directory -Path $config.LogDirectory -Force|Out-Null
$xmlPath=Join-Path $config.LogDirectory 'paws-recovery-task.xml'
$xml|Set-Content -LiteralPath $xmlPath -Encoding Unicode
if(-not $Install){[pscustomobject]@{exported=$true;installed=$false;path=$xmlPath}|ConvertTo-Json -Compress;exit 0}
if(@(Get-ScheduledTask -ErrorAction Stop|Where-Object TaskName -eq 'PAWS Runtime Recovery').Count){throw 'Recovery task already exists; inspect before replacing'}
if(-not $Credential){$Credential=Get-Credential -UserName $config.Identity -Message 'Enter the existing approved runtime account locally; never send its password in chat.'}
if(-not $Credential -or $Credential.UserName -ine $config.Identity){throw 'Existing approved runtime identity required'}
# Password remains in this process and Windows Task Scheduler credential storage; never arguments, JSON, XML or logs.
$plain=$null
try{$plain=$Credential.GetNetworkCredential().Password;Register-ScheduledTask -TaskName 'PAWS Runtime Recovery' -Xml $xml -User $Credential.UserName -Password $plain|Out-Null}finally{$plain=$null;$Credential=$null}
[pscustomobject]@{installed=$true;taskName='PAWS Runtime Recovery'}|ConvertTo-Json -Compress
