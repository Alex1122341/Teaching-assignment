param([Parameter(Mandatory)][string]$ContainerName,[switch]$HelpersOnly)
$ErrorActionPreference='Stop'
function Fail-Disposable {throw 'DISPOSABLE_SQL_REQUIRED: only the labeled local synthetic test container is allowed.'}
if($ContainerName -notmatch '^paws-calendar-[a-z0-9-]+$' -or -not(Get-Command docker -ErrorAction SilentlyContinue)){Fail-Disposable}
$contextName=& docker context show
if($LASTEXITCODE -ne 0){Fail-Disposable}
$contextData=(& docker context inspect $contextName | ConvertFrom-Json)
if($contextData[0].Endpoints.docker.Host -notmatch '^unix://' -and $contextData[0].Endpoints.docker.Host -notmatch '^npipe:///*\./pipe/'){Fail-Disposable}
$containerData=(& docker inspect $ContainerName | ConvertFrom-Json)
if($LASTEXITCODE -ne 0 -or $containerData[0].Config.Labels.'paws.calendar-test' -ne '1' -or -not $containerData[0].State.Running){Fail-Disposable}
if(-not $env:PAWS_SQL_TEST_PASSWORD){throw 'Synthetic SQL password is missing.'}
function Start-RaceSql([string]$Sql,[string]$Label='calendar-race-control'){
 if($Label -notmatch '^calendar-race-[a-z0-9-]+$' -or $Label.Length -gt 128){throw 'Invalid synthetic connection label.'}
 $info=[Diagnostics.ProcessStartInfo]::new('docker');$info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 foreach($argument in @('exec','-e',"SQLCMDPASSWORD=$env:PAWS_SQL_TEST_PASSWORD",'-i',$ContainerName,'/opt/mssql-tools18/bin/sqlcmd','-S','localhost','-U','sa','-C','-I','-b','-d','VetMed-Ops','-H',$Label,'-h','-1','-y','4000','-w','65535','-i','/dev/stdin','-f','65001')){$info.ArgumentList.Add($argument)}
 $process=[Diagnostics.Process]::new();$process.StartInfo=$info;[void]$process.Start()
 $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
 $process.StandardInput.WriteLine(":ON ERROR EXIT`nSET NOCOUNT ON;`n"+$Sql);$process.StandardInput.Close()
 return @{Process=$process;Stdout=$stdout;Stderr=$stderr}
}
function Finish-RaceSql($Running,[int]$Timeout=30000){
 if(-not $Running.Process.WaitForExit($Timeout)){$Running.Process.Kill($true);throw 'Synthetic race SQL timed out.'}
 $output=$Running.Stdout.GetAwaiter().GetResult();$errorText=$Running.Stderr.GetAwaiter().GetResult()
 if($Running.Process.ExitCode -ne 0){throw "Synthetic SQL failed: $output $errorText"}
 return $output.Trim()
}
function Invoke-RaceSql([string]$Sql){$run=Start-RaceSql $Sql;try{return Finish-RaceSql $run}finally{$run.Process.Dispose()}}
function Wait-RaceCondition([string]$Sql,[string]$Label){
 $deadline=[DateTime]::UtcNow.AddSeconds(20);$sampled=$false
 while([DateTime]::UtcNow -lt $deadline){
  if((Invoke-RaceSql $Sql).Trim() -eq '1'){return}
  if(-not $sampled -and $Label -match 'observed-'){
   $sampled=$true
   $sample=Invoke-RaceSql "SELECT TOP(8) sessions.session_id,DATALENGTH(sessions.context_info) contextBytes,LEFT(CONVERT(varchar(256),sessions.context_info,2),100) contextPrefix,requests.wait_type,requests.blocking_session_id,locks.resource_type,locks.request_status FROM sys.dm_exec_sessions sessions LEFT JOIN sys.dm_exec_requests requests ON requests.session_id=sessions.session_id LEFT JOIN sys.dm_tran_locks locks ON locks.request_session_id=sessions.session_id AND locks.request_status IN(N'WAIT',N'CONVERT') WHERE sessions.is_user_process=1 AND sessions.session_id<>@@SPID ORDER BY sessions.session_id DESC FOR JSON PATH,INCLUDE_NULL_VALUES;"
   Write-Output "RACE_ACTIVE_WAIT_DIAGNOSTIC $Label $sample"
  }
  Start-Sleep -Milliseconds 100
 }
 throw "Race barrier or expected wait was not observed: $Label"
}
if($HelpersOnly){return}
$setup=Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'server/test/fixtures/calendar-activity-race-setup.sql') -Raw
[void](Invoke-RaceSql $setup)
$row=3000
foreach($kind in @('migration','timing','recovery','afc_create','afc_cancel','session','duplicate')){
 foreach($readerFirst in @($false,$true)){
  if($kind -eq 'afc_cancel' -and $readerFirst){continue}
  $row++;$name=$kind+$(if($readerFirst){'-swap-first'}else{'-writer-first'})
  if($kind -eq 'duplicate'){$name='duplicate-'+$(if($readerFirst){'commit-first'}else{'insert-first'})}
  $first=if($readerFirst){1}else{0}
  [void](Invoke-RaceSql "EXEC dbo.PrepareCalendarActivityRace '$name','$kind',$row,$first;")
  $case=(Invoke-RaceSql "SELECT (SELECT * FROM dbo.CalendarActivityRaceCase WHERE TestName='$name' FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);") | ConvertFrom-Json
  $body=if($readerFirst){$case.ReaderSql}else{$case.WriterSql}
  $other=if($readerFirst){$case.WriterSql}else{$case.ReaderSql}
  $ready='paws:test:calendar-ready:'+$name
  $holderSql=@"
SET XACT_ABORT ON;
BEGIN TRANSACTION;
$body
DECLARE @ReadyResult int;
EXEC @ReadyResult=sys.sp_getapplock @Resource=N'$ready',@LockMode=N'Exclusive',@LockOwner=N'Session',@DbPrincipal=N'dbo',@LockTimeout=5000;
IF @ReadyResult<0 THROW 53891,'Race ready signal failed.',1;
DECLARE @Deadline datetime2=DATEADD(second,30,SYSUTCDATETIME());
WHILE (SELECT ReleaseFlag FROM dbo.CalendarActivityRaceBarrier WHERE TestName='$name')=0
BEGIN
 IF SYSUTCDATETIME()>@Deadline THROW 53891,'Race holder timed out.',1;
 WAITFOR DELAY '00:00:00.100';
END;
COMMIT TRANSACTION;
EXEC sys.sp_releaseapplock @Resource=N'$ready',@LockOwner=N'Session',@DbPrincipal=N'dbo';
PRINT 'RACE_HOLDER_OK';
"@
  $holderName='calendar-race-holder-'+$name.Replace('_','-');$waiterName='calendar-race-waiter-'+$name.Replace('_','-')
  $holder=Start-RaceSql $holderSql $holderName;$waiter=$null
  try{
   Wait-RaceCondition "SELECT CASE WHEN APPLOCK_TEST(N'dbo',N'$ready',N'Shared',N'Session')=0 THEN 1 ELSE 0 END;" "$name holder-ready"
   $holderSession=[int](Invoke-RaceSql "SELECT session_id FROM sys.dm_exec_sessions WHERE host_name=N'$holderName';")
   if($holderSession -le 0){throw 'Synthetic holder session was not identified.'}
   $waiter=Start-RaceSql "$other PRINT 'RACE_WAITER_OK';" $waiterName
   $type=if($case.ExpectedWait -eq 'APPLICATION'){" AND locks.resource_type=N'APPLICATION'"}else{" AND locks.resource_type<>N'APPLICATION'"}
   if($case.ExpectedWait -eq 'EXACT_AFC'){$type=" AND locks.resource_type<>N'APPLICATION' AND (locks.resource_associated_entity_id=OBJECT_ID(N'paws.AfcRecord') OR locks.resource_associated_entity_id IN(SELECT hobt_id FROM sys.partitions WHERE object_id=OBJECT_ID(N'paws.AfcRecord')))"}
   Wait-RaceCondition "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.dm_tran_locks locks JOIN sys.dm_exec_sessions sessions ON sessions.session_id=locks.request_session_id JOIN sys.dm_exec_requests requests ON requests.session_id=sessions.session_id WHERE sessions.host_name=N'$waiterName' AND requests.blocking_session_id=$holderSession AND locks.request_status IN(N'WAIT',N'CONVERT') $type) THEN 1 ELSE 0 END;" "$name observed-$($case.ExpectedWait)-wait"
   [void](Invoke-RaceSql "UPDATE dbo.CalendarActivityRaceBarrier SET ReleaseFlag=1 WHERE TestName='$name';")
   $holderOutput=Finish-RaceSql $holder;$waiterOutput=Finish-RaceSql $waiter
   if($holderOutput -notmatch 'RACE_HOLDER_OK' -or $waiterOutput -notmatch 'RACE_WAITER_OK'){throw 'Race did not reach both durable outcomes.'}
   if($kind -eq 'migration'){
    [void](Invoke-RaceSql "IF (SELECT COUNT(*) FROM paws.CalendarActivity WHERE FacultyId='$($case.FacultyId)')<>1 OR EXISTS(SELECT 1 FROM paws.AfcRecord WHERE FacultyId='$($case.FacultyId)' AND Active=1) THROW 53891,'Migration race left mixed AFC/activity state.',1;")
   }
   if($kind -eq 'recovery'){
    [void](Invoke-RaceSql "IF EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE FacultyId='$($case.FacultyId)') OR (SELECT COUNT(*) FROM paws.AfcRecord WHERE FacultyId='$($case.FacultyId)' AND Active=1)<>1 THROW 53891,'Recovery race left mixed AFC/activity state.',1;")
   }
   if($kind -eq 'duplicate'){
    $expectedActivities=if($readerFirst){1}else{0};$expectedAfc=if($readerFirst){1}else{2}
    [void](Invoke-RaceSql "IF (SELECT COUNT(*) FROM paws.CalendarActivity WHERE FacultyId='$($case.FacultyId)')<>$expectedActivities OR (SELECT COUNT(*) FROM paws.AfcRecord WHERE FacultyId='$($case.FacultyId)' AND Active=1)<>$expectedAfc THROW 53891,'Duplicate race violated the serialized match-set outcome.',1; IF $expectedActivities=0 AND (EXISTS(SELECT 1 FROM paws.CalendarActivityImportReceipt receipt JOIN staging.CalendarActivityImportItem item ON item.ImportBatchId=receipt.ImportBatchId WHERE item.FacultyId='$($case.FacultyId)') OR EXISTS(SELECT 1 FROM paws.AuditEvent audit JOIN staging.CalendarActivityImportItem item ON item.ImportBatchId=audit.ImportBatchId WHERE item.FacultyId='$($case.FacultyId)' AND audit.EventType=N'calendar_activity_import_committed')) THROW 53891,'Refused duplicate created a receipt or commit audit.',1;")
   }
   Write-Output "CALENDAR_RACE_OK $name actual-$($case.ExpectedWait)-wait"
  }catch{
   $diagnostic=Invoke-RaceSql "SELECT TOP(10) sessions.session_id,DATALENGTH(sessions.context_info) contextBytes,LEFT(CONVERT(varchar(256),sessions.context_info,2),100) contextPrefix,requests.wait_type,requests.blocking_session_id,locks.resource_type,locks.request_status FROM sys.dm_exec_sessions sessions LEFT JOIN sys.dm_exec_requests requests ON requests.session_id=sessions.session_id LEFT JOIN sys.dm_tran_locks locks ON locks.request_session_id=sessions.session_id AND locks.request_status IN(N'WAIT',N'CONVERT') WHERE sessions.program_name LIKE N'%SQLCMD%' AND sessions.session_id<>@@SPID FOR JSON PATH,INCLUDE_NULL_VALUES;"
   Write-Output "RACE_WAIT_DIAGNOSTIC $name $diagnostic"
   if($waiter -and $waiter.Process.HasExited){Write-Output ('RACE_WAITER_EXIT '+$waiter.Process.ExitCode+' '+$waiter.Stdout.GetAwaiter().GetResult()+' '+$waiter.Stderr.GetAwaiter().GetResult())}
   throw
  }finally{
   [void](Invoke-RaceSql "UPDATE dbo.CalendarActivityRaceBarrier SET ReleaseFlag=1 WHERE TestName='$name';")
   foreach($run in @($holder,$waiter)){
    if($run){if(-not $run.Process.HasExited){$run.Process.Kill($true)};$run.Process.Dispose()}
   }
  }
 }
}
[void](Invoke-RaceSql 'DROP PROCEDURE dbo.PrepareCalendarActivityRace;DROP TABLE dbo.CalendarActivityRaceCase;DROP TABLE dbo.CalendarActivityRaceBarrier;')
Write-Output 'CALENDAR_ACTIVITY_SWAP_SERIALIZED_OK'
