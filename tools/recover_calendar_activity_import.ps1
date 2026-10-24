[CmdletBinding()]
param([Parameter(Mandatory)][string]$ActorFirebaseUid,[Parameter(Mandatory)][guid]$ReceiptId,[Parameter(Mandatory)][string]$Path,
 [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedSha256,[switch]$ConfirmRecovery)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'calendar-activity-recovery.psm1') -Force
$full=Get-PrivateCalendarRecoveryPath $Path
if(-not $ConfirmRecovery){throw 'Explicit ConfirmRecovery is required.'}
if(-not (Test-Path -LiteralPath $full -PathType Leaf) -or (Get-Item -LiteralPath $full).Length -gt 16777216){throw 'A bounded private recovery artifact is required.'}
$bytes=[IO.File]::ReadAllBytes($full)
if((Get-CalendarRecoveryHash $bytes) -ne $ExpectedSha256){throw 'Recovery artifact hash does not match.'}
$content=[Text.Encoding]::Unicode.GetString($bytes) | ConvertFrom-Json
if([guid]$content.receiptId -ne $ReceiptId){throw 'Recovery artifact receipt does not match.'}
$table=Invoke-TrustedCalendarRecovery 'RecoverCalendarActivityImport' $ActorFirebaseUid $ReceiptId $ExpectedSha256
if($table.Rows.Count -ne 1){throw 'Recovery did not return an exact receipt.'}
Write-Output ($table.Rows[0].responseJson | ConvertFrom-Json)
