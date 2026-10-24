[CmdletBinding()]
param([Parameter(Mandatory)][string]$ActorFirebaseUid,[Parameter(Mandatory)][guid]$ReceiptId,[Parameter(Mandatory)][string]$Path)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'calendar-activity-recovery.psm1') -Force
$full=Get-PrivateCalendarRecoveryPath $Path
if(Test-Path -LiteralPath $full){throw 'Recovery export must not overwrite an existing file.'}
if(-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($full)) -PathType Container)){throw 'Create a restricted private export directory first.'}
$table=Invoke-TrustedCalendarRecovery 'ExportCalendarActivityRecovery' $ActorFirebaseUid $ReceiptId
if($table.Rows.Count -ne 1){throw 'Recovery export did not return one exact receipt.'}
$bytes=[Text.Encoding]::Unicode.GetBytes([string]$table.Rows[0].recoveryJson)
$hash=Get-CalendarRecoveryHash $bytes
if($hash -ne [string]$table.Rows[0].recoverySha256){throw 'Recovery artifact hash does not match SQL.'}
$content=[string]$table.Rows[0].recoveryJson | ConvertFrom-Json
if([guid]$content.receiptId -ne $ReceiptId){throw 'Recovery receipt mismatch.'}
Write-PrivateCalendarRecoveryFile $full $bytes
Write-Output ([pscustomobject]@{ReceiptId=$ReceiptId;Path=$full;Sha256=$hash;Encoding='UTF-16LE without BOM'})
