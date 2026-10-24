param([Parameter(Mandatory=$true)][string]$ContainerName)
$ErrorActionPreference='Stop'
function Fail-Disposable {throw 'DISPOSABLE_SQL_REQUIRED: use the labeled local synthetic container.'}
if($ContainerName -notmatch '^paws-calendar-[a-z0-9-]+$' -or -not(Get-Command docker -ErrorAction SilentlyContinue)){Fail-Disposable}
$contextName=& docker context show
if($LASTEXITCODE -ne 0){Fail-Disposable}
$contextData=(& docker context inspect $contextName | ConvertFrom-Json)
if($contextData[0].Endpoints.docker.Host -notmatch '^unix://' -and $contextData[0].Endpoints.docker.Host -notmatch '^npipe:///*\./pipe/'){Fail-Disposable}
$containerData=(& docker inspect $ContainerName | ConvertFrom-Json)
if($LASTEXITCODE -ne 0 -or $containerData[0].Config.Labels.'paws.calendar-test' -ne '1' -or -not $containerData[0].State.Running){Fail-Disposable}
if(-not $env:PAWS_SQL_TEST_PASSWORD){throw 'Synthetic password is required.'}
function Start-TaskSql([string]$Sql,[string]$Label='scheduling-task-control'){
 if($Label -notmatch '^scheduling-task-[a-z0-9-]+$' -or $Label.Length -gt 128){throw 'Invalid synthetic connection label.'}
 $info=[Diagnostics.ProcessStartInfo]::new('docker');$info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 foreach($argument in @('exec','-e',"SQLCMDPASSWORD=$env:PAWS_SQL_TEST_PASSWORD",'-i',$ContainerName,'/opt/mssql-tools18/bin/sqlcmd','-S','localhost','-U','sa','-C','-I','-b','-y','4000','-h','-1','-w','65535','-d','VetMed-Ops','-H',$Label,'-i','/dev/stdin','-f','65001')){[void]$info.ArgumentList.Add($argument)}
 $process=[Diagnostics.Process]::new();$process.StartInfo=$info;[void]$process.Start()
 $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
 $process.StandardInput.WriteLine(":ON ERROR EXIT`nSET NOCOUNT ON;`n"+$Sql);$process.StandardInput.Close()
 return @{Process=$process;Stdout=$stdout;Stderr=$stderr}
}
function Finish-TaskSql($Running){
 try{
  if(-not $Running.Process.WaitForExit(45000)){$Running.Process.Kill($true);throw 'Synthetic scheduling race timed out.'}
  $output=$Running.Stdout.GetAwaiter().GetResult();$errorText=$Running.Stderr.GetAwaiter().GetResult()
  if($Running.Process.ExitCode -ne 0){throw "Synthetic scheduling SQL failed: $output $errorText"}
  return $output.Trim()
 }finally{$Running.Process.Dispose()}
}
function Invoke-TaskSql([string]$Sql){return Finish-TaskSql (Start-TaskSql $Sql)}
function Wait-TaskCondition([string]$Sql,[string]$Label){
 $deadline=[DateTime]::UtcNow.AddSeconds(25)
 while([DateTime]::UtcNow -lt $deadline){if((Invoke-TaskSql $Sql).Trim() -eq '1'){return};Start-Sleep -Milliseconds 100}
 throw "Scheduling race wait not observed: $Label"
}
$repoPath=Split-Path $PSScriptRoot -Parent
[void](Invoke-TaskSql (Get-Content -LiteralPath (Join-Path $repoPath 'server/test/fixtures/scheduling-task-race-setup.sql') -Raw))
$cases=@(@{Kind='session';FirstReview=$false},@{Kind='assignment_insert';FirstReview=$false},@{Kind='assignment_delete';FirstReview=$false},@{Kind='afc';FirstReview=$false},@{Kind='calendar';FirstReview=$false},@{Kind='session';FirstReview=$true},@{Kind='reviewer';FirstReview=$true})
foreach($case in $cases){
 $name=$case.Kind+$(if($case.FirstReview){'-review-first'}else{'-writer-first'})
 [void](Invoke-TaskSql "EXEC dbo.PrepareSchedulingTaskRace N'$name',N'$($case.Kind)';")
 $record=(Invoke-TaskSql "SET NOCOUNT ON;SELECT (SELECT * FROM dbo.SchedulingTaskRaceCase WHERE Name=N'$name' FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);") | ConvertFrom-Json
 if($record.IssueKey -notmatch '^[A-F0-9]{64}$' -or $record.EvidenceVersion -notmatch '^[A-F0-9]{64}$' -or $record.ReviewVersion -notmatch '^[A-F0-9]{16}$'){throw 'Invalid synthetic race keys.'}
 $review="EXEC paws_api.ReviewSchedulingTask N'task-race-admin','$($record.IssueKey)',N'RACE-TASK','$($record.EvidenceVersion)','$($record.ReviewVersion)',N'Reviewed';"
 $firstBody=if($case.FirstReview){$review}else{$record.SourceSql}
 $secondBody=if($case.Kind -eq 'reviewer' -or -not $case.FirstReview){"BEGIN TRY $review PRINT 'TASK_REVIEW_COMMITTED';END TRY BEGIN CATCH IF ERROR_NUMBER()=54310 PRINT 'EXPECTED_STALE';ELSE THROW;END CATCH;"}else{$record.SourceSql+"PRINT 'TASK_SOURCE_COMMITTED';"}
 $ready="paws:test:scheduling:$name";$holderName='scheduling-task-holder-'+$name.Replace('_','-');$waiterName='scheduling-task-waiter-'+$name.Replace('_','-')
 $first=Start-TaskSql "SET NOCOUNT ON;SET XACT_ABORT ON;BEGIN TRANSACTION;$firstBody DECLARE @ReadyResult int;EXEC @ReadyResult=sys.sp_getapplock @Resource=N'$ready',@LockMode=N'Exclusive',@LockOwner=N'Session',@DbPrincipal=N'dbo',@LockTimeout=5000;IF @ReadyResult<0 THROW 54390,'Race ready lock failed.',1;DECLARE @Deadline datetime2=DATEADD(second,30,SYSUTCDATETIME());WHILE NOT EXISTS(SELECT 1 FROM dbo.SchedulingTaskRaceSignal WITH(NOLOCK) WHERE Name=N'$name' AND Released=1) BEGIN IF SYSUTCDATETIME()>@Deadline THROW 54390,'Race barrier timeout.',1;WAITFOR DELAY '00:00:00.100';END;COMMIT;EXEC sys.sp_releaseapplock @Resource=N'$ready',@LockOwner=N'Session',@DbPrincipal=N'dbo';PRINT 'FIRST_COMMITTED';" $holderName
 $second=$null
 try{
  Wait-TaskCondition "SELECT IIF(APPLOCK_TEST(N'dbo',N'$ready',N'Shared',N'Session')=0,1,0);" "$name-ready"
  $holderSession=[int](Invoke-TaskSql "SELECT session_id FROM sys.dm_exec_sessions WHERE host_name=N'$holderName';")
  if($holderSession -le 0){throw 'Synthetic holder session not found.'}
  $second=Start-TaskSql $secondBody $waiterName
  Wait-TaskCondition "SELECT IIF(EXISTS(SELECT 1 FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id=r.session_id JOIN sys.dm_tran_locks l ON l.request_session_id=r.session_id WHERE s.host_name=N'$waiterName' AND r.blocking_session_id=$holderSession AND l.request_status IN(N'WAIT',N'CONVERT')),1,0);" "$name-blocked"
  Write-Output "SCHEDULING_TASK_WAIT_OBSERVED $name"
  [void](Invoke-TaskSql "UPDATE dbo.SchedulingTaskRaceSignal SET Released=1 WHERE Name=N'$name';")
  [void](Finish-TaskSql $first);$first=$null
  $result=Finish-TaskSql $second;$second=$null
  if(($case.Kind -eq 'reviewer' -or -not $case.FirstReview) -and $result -notmatch 'EXPECTED_STALE'){throw 'Stale review was not rejected.'}
  $count=(Invoke-TaskSql "SET NOCOUNT ON;SELECT COUNT(*) FROM paws.AuditEvent WHERE EntityId='$($record.IssueKey)' AND EventType=N'SchedulingTaskReviewed';").Trim()
  if($count -ne $(if($case.FirstReview){'1'}else{'0'})){throw 'Race review audit count incorrect.'}
 }finally{
  [void](Invoke-TaskSql "UPDATE dbo.SchedulingTaskRaceSignal SET Released=1 WHERE Name=N'$name';")
  foreach($running in @($first,$second)){if($null -ne $running){if(-not $running.Process.HasExited){$running.Process.Kill($true)}else{Write-Output ('SCHEDULING_TASK_CHILD_OUTPUT '+$running.Stdout.GetAwaiter().GetResult()+' '+$running.Stderr.GetAwaiter().GetResult())};$running.Process.Dispose()}}
 }
}
Write-Output 'SCHEDULING_TASK_RACES_OK'
