param([Parameter(Mandatory=$true)][string]$ContainerName)
$ErrorActionPreference='Stop'
# Reuse validated local-container connections/barriers without running old fixtures.
. (Join-Path $PSScriptRoot 'test-calendar-activity-races.ps1') -ContainerName $ContainerName -HelpersOnly
[void](Invoke-RaceSql 'CREATE TABLE dbo.CccRaceBarrier(TestName nvarchar(64) PRIMARY KEY,ReleaseFlag bit NOT NULL);')
foreach($kind in @('reader-first','writer-first','phantom-first','commit-first','same-key','different-key')){
 $prepare=@"
DECLARE @Batch uniqueidentifier=NEWID(),@Rows nvarchar(max),@Faculty uniqueidentifier=(SELECT FacultyId FROM dbo.CccTestContext),@Key uniqueidentifier=NEWID(),@Source char(64)=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(16),NEWID())),2),@Version varchar(16),@Manifest varchar(64);
SET @Rows=(SELECT 2 sourceRow,CONVERT(varchar(36),@Faculty) facultySourceId,N'2026-11-10' startDate,N'2026-11-12' endDate,N'CCC' label,JSON_QUERY(N'[]') issues FOR JSON PATH);
DECLARE @Result TABLE(responseJson nvarchar(max));
INSERT @Result EXEC paws_api.StageCccReplacement N'ccc-test-admin',@Batch,@Source,'2026-27',N'Race.xlsx',200,@Rows;
SET @Version=JSON_VALUE((SELECT TOP(1) responseJson FROM @Result),'$.previewVersion');DELETE @Result;
INSERT @Result EXEC paws_api.PreviewCccReplacement N'ccc-test-admin',@Batch,@Version;
SET @Version=JSON_VALUE((SELECT TOP(1) responseJson FROM @Result),'$.previewVersion');SET @Manifest=JSON_VALUE((SELECT TOP(1) responseJson FROM @Result),'$.manifestSha256');
SELECT(SELECT @Batch batch,@Faculty faculty,@Key requestKey,NEWID() otherKey,@Source source,@Version version,@Manifest manifest FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
INSERT dbo.CccRaceBarrier VALUES(N'$kind',0);
"@
 $case=(Invoke-RaceSql $prepare)|ConvertFrom-Json
 $commit="EXEC paws_api.CommitCccReplacement N'ccc-test-admin','$($case.batch)','2026-27',N'ccc-calendar','$($case.version)','$($case.manifest)','$($case.source)','$($case.requestKey)',1,1;"
 $faculty="EXEC paws_api.AcquireCalendarActivityFacultyLocks N'[`"$($case.faculty)`"]';"
 $phantom=@"
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid)
SELECT NEWID(),c.FacultyId,N'ccc',N'Race phantom','2026-11-15','2026-11-15',c.Seed,r.ImportRowId,'$($case.source)',N'Race',6,N'synthetic' FROM dbo.CccTestContext c JOIN staging.ImportRow r ON r.ImportSheetId=c.SheetId AND r.SourceRowNumber=6;
"@
 $body=$commit;$other="BEGIN TRANSACTION;$faculty COMMIT;";$expected='APPLICATION'
 if($kind -eq 'reader-first'){$body=$faculty;$other=$commit}
 if($kind -eq 'phantom-first'){$body=$phantom;$other="BEGIN TRY $commit THROW 54990,'Phantom race committed.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54904 THROW;END CATCH;";$expected='ROW'}
 if($kind -eq 'commit-first'){$other=$phantom;$expected='ROW'}
 if($kind -eq 'same-key'){$other=$commit;$expected='ROW'}
 if($kind -eq 'different-key'){$different=$commit.Replace("'$($case.requestKey)'","'$($case.otherKey)'");$other="BEGIN TRY $different THROW 54990,'Different-key race committed twice.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54904 THROW;END CATCH;";$expected='ROW'}
 $ready='paws:test:ccc-ready:'+$kind;$holderName='calendar-race-ccc-holder-'+$kind;$waiterName='calendar-race-ccc-waiter-'+$kind
 $holderSql=@"
SET XACT_ABORT ON;
BEGIN TRANSACTION;
$body
DECLARE @Ready int;EXEC @Ready=sys.sp_getapplock @Resource=N'$ready',@LockMode=N'Exclusive',@LockOwner=N'Session',@DbPrincipal=N'dbo',@LockTimeout=5000;
IF @Ready<0 THROW 54990,'CCC barrier failed.',1;
DECLARE @Deadline datetime2=DATEADD(second,30,SYSUTCDATETIME());
WHILE (SELECT ReleaseFlag FROM dbo.CccRaceBarrier WHERE TestName=N'$kind')=0 BEGIN IF SYSUTCDATETIME()>@Deadline THROW 54990,'CCC holder timed out.',1;WAITFOR DELAY '00:00:00.100';END;
COMMIT;
EXEC sys.sp_releaseapplock @Resource=N'$ready',@LockOwner=N'Session',@DbPrincipal=N'dbo';PRINT 'CCC_HOLDER_OK';
"@
 $holder=Start-RaceSql $holderSql $holderName;$waiter=$null
 try{
  Wait-RaceCondition "SELECT CASE WHEN APPLOCK_TEST(N'dbo',N'$ready',N'Shared',N'Session')=0 THEN 1 ELSE 0 END;" "$kind CCC-holder-ready"
  $holderSession=[int](Invoke-RaceSql "SELECT session_id FROM sys.dm_exec_sessions WHERE host_name=N'$holderName';")
  $waiter=Start-RaceSql "$other PRINT 'CCC_WAITER_OK';" $waiterName
  $type=if($expected -eq 'APPLICATION'){" AND locks.resource_type=N'APPLICATION'"}else{" AND locks.resource_type<>N'APPLICATION'"}
  Wait-RaceCondition "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.dm_tran_locks locks JOIN sys.dm_exec_sessions sessions ON sessions.session_id=locks.request_session_id JOIN sys.dm_exec_requests requests ON requests.session_id=sessions.session_id WHERE sessions.host_name=N'$waiterName' AND requests.blocking_session_id=$holderSession AND locks.request_status IN(N'WAIT',N'CONVERT') $type) THEN 1 ELSE 0 END;" "$kind CCC-observed-$expected"
  [void](Invoke-RaceSql "UPDATE dbo.CccRaceBarrier SET ReleaseFlag=1 WHERE TestName=N'$kind';")
  $h=Finish-RaceSql $holder;$w=Finish-RaceSql $waiter;if($h -notmatch 'CCC_HOLDER_OK' -or $w -notmatch 'CCC_WAITER_OK'){throw 'CCC durable race outcomes missing.'}
  $count=if($kind -eq 'phantom-first'){0}else{1}
  [void](Invoke-RaceSql "IF (SELECT COUNT(*) FROM paws.CccReplacementReceipt WHERE ImportBatchId='$($case.batch)')<>$count THROW 54990,'CCC race receipt count invalid.',1;")
  Write-Output "CCC_RACE_OK $kind actual-$expected-wait"
 }finally{
  [void](Invoke-RaceSql "UPDATE dbo.CccRaceBarrier SET ReleaseFlag=1 WHERE TestName=N'$kind';")
  foreach($run in @($holder,$waiter)){if($run){if(-not $run.Process.HasExited){$run.Process.Kill($true)};$run.Process.Dispose()}}
 }
}
[void](Invoke-RaceSql 'DROP TABLE dbo.CccRaceBarrier;')
Write-Output 'CCC_REPLACEMENT_SERIALIZATION_OK'
