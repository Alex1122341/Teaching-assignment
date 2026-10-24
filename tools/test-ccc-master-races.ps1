param([Parameter(Mandatory=$true)][string]$ContainerName)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'test-calendar-activity-races.ps1') -ContainerName $ContainerName -HelpersOnly
[void](Invoke-RaceSql 'CREATE TABLE dbo.CccMasterRaceBarrier(TestName nvarchar(32) PRIMARY KEY,ReleaseFlag bit NOT NULL);')
foreach($kind in @('same-key','different-key','manual-first','phantom-first')){
 [void](Invoke-RaceSql "UPDATE dbo.CccMasterContext SET BatchId=NEWID(),RequestKey=NEWID();EXEC dbo.StageCccMasterTest;INSERT dbo.CccMasterRaceBarrier VALUES(N'$kind',0);")
 $body='EXEC dbo.ApplyCccMasterTest;'
 $other='EXEC dbo.ApplyCccMasterTest;'
 if($kind -eq 'different-key'){$other="DECLARE @Key uniqueidentifier=NEWID();BEGIN TRY EXEC dbo.ApplyCccMasterTest @Key;THROW 55390,'Different key applied twice.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54904 THROW;END CATCH;"}
 if($kind -eq 'manual-first'){$body="UPDATE paws.CalendarActivity SET BlockLabel=N'concurrent manual edit' WHERE ActivityId=(SELECT OldId FROM dbo.CccSlotContext);"}
 if($kind -eq 'phantom-first'){$body="INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid) SELECT NEWID(),OtherFaculty,N'ccc',N'Phantom CCC','2026-11-10','2026-11-10',Seed,RawId,REPLICATE('F',64),N'Phantom',50,N'synthetic' FROM dbo.CccSlotContext;"}
 if($kind -in @('manual-first','phantom-first')){$other="BEGIN TRY EXEC dbo.ApplyCccMasterTest;THROW 55390,'Concurrent before-state change accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54904 THROW;END CATCH;"}
 $ready='paws:test:ccc-master-ready:'+$kind;$holderName='calendar-race-ccc-master-holder-'+$kind;$waiterName='calendar-race-ccc-master-waiter-'+$kind
 $holderSql=@"
SET XACT_ABORT ON;BEGIN TRANSACTION;
$body
DECLARE @Ready int;EXEC @Ready=sys.sp_getapplock @Resource=N'$ready',@LockMode=N'Exclusive',@LockOwner=N'Session',@DbPrincipal=N'dbo',@LockTimeout=5000;
IF @Ready<0 THROW 55390,'MASTER ready barrier failed.',1;
DECLARE @Deadline datetime2=DATEADD(second,30,SYSUTCDATETIME());
WHILE (SELECT ReleaseFlag FROM dbo.CccMasterRaceBarrier WHERE TestName=N'$kind')=0 BEGIN IF SYSUTCDATETIME()>@Deadline THROW 55390,'MASTER holder timed out.',1;WAITFOR DELAY '00:00:00.100';END;
COMMIT;EXEC sys.sp_releaseapplock @Resource=N'$ready',@LockOwner=N'Session',@DbPrincipal=N'dbo';PRINT 'CCC_MASTER_HOLDER_OK';
"@
 $holder=Start-RaceSql $holderSql $holderName;$waiter=$null
 try{
  Wait-RaceCondition "SELECT CASE WHEN APPLOCK_TEST(N'dbo',N'$ready',N'Shared',N'Session')=0 THEN 1 ELSE 0 END;" "$kind master-ready"
  $holderSession=[int](Invoke-RaceSql "SELECT session_id FROM sys.dm_exec_sessions WHERE host_name=N'$holderName';")
  $waiter=Start-RaceSql "$other PRINT 'CCC_MASTER_WAITER_OK';" $waiterName
  Wait-RaceCondition "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.dm_tran_locks l JOIN sys.dm_exec_sessions s ON s.session_id=l.request_session_id JOIN sys.dm_exec_requests r ON r.session_id=s.session_id WHERE s.host_name=N'$waiterName' AND r.blocking_session_id=$holderSession AND l.request_status IN(N'WAIT',N'CONVERT')) THEN 1 ELSE 0 END;" "$kind master-observed-wait"
  [void](Invoke-RaceSql "UPDATE dbo.CccMasterRaceBarrier SET ReleaseFlag=1 WHERE TestName=N'$kind';")
  $h=Finish-RaceSql $holder;$w=Finish-RaceSql $waiter
  if($h -notmatch 'CCC_MASTER_HOLDER_OK' -or $w -notmatch 'CCC_MASTER_WAITER_OK'){throw 'MASTER durable race outcome missing.'}
  if($kind -in @('same-key','different-key')){
   [void](Invoke-RaceSql "DECLARE @Batch uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE((SELECT PreviewJson FROM dbo.CccMasterContext),'$.batchId'));IF (SELECT COUNT(*) FROM paws.CccReplacementReceipt WHERE ImportBatchId=@Batch)<>1 THROW 55390,'MASTER duplicate receipt.',1;DECLARE @Receipt uniqueidentifier=(SELECT ReceiptId FROM paws.CccReplacementReceipt WHERE ImportBatchId=@Batch);EXEC paws_api.RecoverCccReplacement N'ccc-slots-admin',@Receipt,1;")
  }
  Write-Output "CCC_MASTER_RACE_OK $kind observed-blocking-and-durable-outcome"
 }finally{
  [void](Invoke-RaceSql "UPDATE dbo.CccMasterRaceBarrier SET ReleaseFlag=1 WHERE TestName=N'$kind';")
  foreach($run in @($holder,$waiter)){if($run){if(-not $run.Process.HasExited){$run.Process.Kill($true)};$run.Process.Dispose()}}
 }
}
Write-Output 'CCC_MASTER_SERIALIZATION_OK'
