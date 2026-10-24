/* Synthetic race fixtures only; executed exclusively in the inspected CI container. */
SET NOCOUNT ON;
CREATE TABLE dbo.CalendarActivityRaceBarrier(TestName varchar(64) NOT NULL PRIMARY KEY,ReleaseFlag bit NOT NULL DEFAULT 0);
CREATE TABLE dbo.CalendarActivityRaceCase(TestName varchar(64) NOT NULL PRIMARY KEY,FacultyId uniqueidentifier NOT NULL,SessionId uniqueidentifier NOT NULL,AssignmentId uniqueidentifier NOT NULL,RequestId uniqueidentifier NOT NULL,WriterSql nvarchar(max) NOT NULL,ReaderSql nvarchar(max) NOT NULL,ExpectedWait varchar(16) NOT NULL);
GO
CREATE PROCEDURE dbo.PrepareCalendarActivityRace @TestName varchar(64),@Kind varchar(32),@Row int,@ReaderFirst bit
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Source uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID(),@Outgoing uniqueidentifier=NEWID(),@Replacement uniqueidentifier=NEWID(),@Afc uniqueidentifier=NEWID(),@Raw uniqueidentifier=NEWID(),@Batch uniqueidentifier=NEWID(),@Session uniqueidentifier=NEWID(),@Assignment uniqueidentifier=NEWID(),@Request uniqueidentifier=NEWID(),@Key uniqueidentifier=NEWID();
 DECLARE @Name nvarchar(256)=CONCAT(N'Synthetic Race ',CONVERT(char(36),@Faculty)),@SessionDate date=IIF(@Kind='recovery' AND @ReaderFirst=1,'2026-12-04','2026-12-05');
 INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Source,SYSUTCDATETIME(),N'synthetic',REPLICATE('C',64),N'test',N'{}');
 INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',@Name,1,@Source),(@Outgoing,N'faculty',CONCAT(@Name,N' outgoing'),1,@Source),(@Replacement,N'faculty',CONCAT(@Name,N' replacement'),1,@Source);
 INSERT paws.SwapCandidate(FacultyId) VALUES(@Faculty),(@Outgoing),(@Replacement);
 DECLARE @Course uniqueidentifier=(SELECT CourseId FROM paws.Course WHERE CourseCode=N'CALTEST');
 INSERT paws.Session(SessionId,AcademicYear,CurriculumYear,CourseId,CourseCode,CourseName,Topic,SessionType,SessionDate,StartTime,EndTime,SourceImportBatchId)
  VALUES(@Session,N'2026-27',N'2',@Course,N'CALTEST',N'Synthetic Calendar Test',CONCAT(@Name,N' primary'),N'LEC',@SessionDate,'09:00','10:00',@Source);
 INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,SourceFacultyName,FacultyResolutionStatus,TeachingRole,SourceImportBatchId,SourceRow)
  VALUES(@Assignment,@Session,@Outgoing,CONCAT(@Name,N' outgoing'),N'resolved',N'Primary',@Source,1);
 DECLARE @Writer nvarchar(max),@Receipt uniqueidentifier,@Activity uniqueidentifier,@ActivityVersion varchar(16),@Version varchar(16),@Manifest char(64),@Response nvarchar(max);
 DECLARE @Reply TABLE(responseJson nvarchar(max));
 IF @Kind IN('migration','timing','recovery','duplicate')
 BEGIN
  INSERT staging.AfcRecordRaw(ImportBatchId,ImportRowId,SourceRowNumber,FacultySourceName,StartDate,EndDate,Purpose,RawJson,ValidationStatus,ValidationErrorsJson)
   VALUES(@Source,@Raw,@Row,@Name,'2026-12-05','2026-12-06',N'CCC Day',N'{}',N'valid',N'[]');
  INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow) VALUES(@Afc,@Faculty,'2026-12-05','2026-12-06',N'CCC Day',1,@Source,@Row);
  DECLARE @Rows nvarchar(max)=(SELECT @Row sourceRow,@Name facultySourceName,N'2026-12-05' startDate,N'2026-12-06' endDate,N'CCC Day' originalLabel,N'working_candidate' treatment,JSON_QUERY(N'[]') issues FOR JSON PATH);
  INSERT @Reply EXEC paws_api.StageCalendarActivityImport N'calendar-swap-admin',@Batch,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Rows;
  SELECT @Version=JSON_VALUE(responseJson,'$.previewVersion'),@Manifest=JSON_VALUE(responseJson,'$.manifestSha256') FROM @Reply;
  SET @Writer=CONCAT(N'EXEC paws_api.CommitCalendarActivityImport N''calendar-swap-admin'',''',CONVERT(char(36),@Batch),N''',''',@Version,N''',''',@Manifest,N''',''4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF'',''',CONVERT(char(36),@Key),N''',1;');
  IF @Kind NOT IN('migration','duplicate')
  BEGIN
   EXEC sys.sp_executesql @Writer;
   SELECT @Receipt=ReceiptId FROM paws.CalendarActivityImportReceipt WHERE ImportBatchId=@Batch;
   SELECT @Activity=ActivityId,@ActivityVersion=CONVERT(varchar(16),CONVERT(binary(8),ActivityVersion),2) FROM paws.CalendarActivity WHERE ImportBatchId=@Batch;
  END;
  IF @Kind='timing'
  BEGIN
   EXEC paws_api.ResolveCalendarActivityDayTime N'calendar-swap-admin',@Activity,@ActivityVersion,'2026-12-05','08:00','09:00',N'synthetic race evidence',N'private synthetic note';
   SELECT @ActivityVersion=CONVERT(varchar(16),CONVERT(binary(8),ActivityVersion),2) FROM paws.CalendarActivity WHERE ActivityId=@Activity;
   SET @Writer=CONCAT(N'EXEC paws_api.ResolveCalendarActivityDayTime N''calendar-swap-admin'',''',CONVERT(char(36),@Activity),N''',''',@ActivityVersion,N''',''2026-12-05'',''08:30'',''09:30'',N''synthetic race evidence'',N''private synthetic note'';');
  END;
  IF @Kind='recovery'
  BEGIN
   DECLARE @Recovery TABLE(recoveryJson nvarchar(max),recoverySha256 char(64));
   INSERT @Recovery EXEC paws_api.ExportCalendarActivityRecovery N'calendar-swap-admin',@Receipt;
   DECLARE @Hash char(64)=(SELECT recoverySha256 FROM @Recovery);
   SET @Writer=CONCAT(N'EXEC paws_api.RecoverCalendarActivityImport N''calendar-swap-admin'',''',CONVERT(char(36),@Receipt),N''',''',@Hash,N''',1;');
   IF @ReaderFirst=0
    INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,SourceFacultyName,FacultyResolutionStatus,TeachingRole,SourceImportBatchId,SourceRow)
     VALUES(NEWID(),@Session,@Faculty,@Name,N'resolved',N'Secondary',@Source,2);
  END;
 END;
 IF @Kind='duplicate'
 BEGIN
  -- Prepare raw lineage before either connection starts: the observed wait must
  -- be on the exact AFC match set, not on a raw-source insert or Faculty row.
  INSERT staging.AfcRecordRaw(ImportBatchId,ImportRowId,SourceRowNumber,FacultySourceName,StartDate,EndDate,Purpose,RawJson,ValidationStatus,ValidationErrorsJson)
   VALUES(@Source,NEWID(),@Row+9000,@Name,'2026-12-05','2026-12-06',N'CCC Day',N'{}',N'valid',N'[]');
  DECLARE @Migration nvarchar(max)=@Writer;
  SET @Writer=CONCAT(N'INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow) VALUES(NEWID(),''',CONVERT(char(36),@Faculty),N''',''2026-12-05'',''2026-12-06'',N''CCC Day'',1,''',CONVERT(char(36),@Source),N''',',CONVERT(varchar(12),@Row+9000),N');');
  DECLARE @MigrationReader nvarchar(max)=CASE WHEN @ReaderFirst=1 THEN @Migration ELSE
   N'DECLARE @Rejected bit=0;BEGIN TRY '+@Migration+N' END TRY BEGIN CATCH IF ERROR_NUMBER()=53804 SET @Rejected=1;ELSE THROW;END CATCH;IF @Rejected=0 THROW 53891,''Late duplicate did not invalidate the import.'',1;' END;
  INSERT dbo.CalendarActivityRaceBarrier(TestName) VALUES(@TestName);
  INSERT dbo.CalendarActivityRaceCase VALUES(@TestName,@Faculty,@Session,@Assignment,@Request,@Writer,@MigrationReader,'EXACT_AFC');
  RETURN;
 END;
 IF @Kind IN('afc_create','afc_cancel')
 BEGIN
  DECLARE @Manual uniqueidentifier=NEWID(),@ManualKey uniqueidentifier=NEWID();
  SET @Writer=CONCAT(N'EXEC paws_api.CreateAfcRecord ''',CONVERT(char(36),@Manual),N''',''',CONVERT(char(36),@Faculty),N''',''2026-12-05'',''2026-12-05'',N''vacation'',NULL,N''calendar-swap-admin'',N''Synthetic Swap Admin'',''',CONVERT(char(36),@ManualKey),N''';');
  IF @Kind='afc_cancel'
  BEGIN
   EXEC sys.sp_executesql @Writer;
   SELECT @Version=CONVERT(varchar(16),CONVERT(binary(8),AfcVersion),2) FROM paws.AfcManualRecord WHERE AfcRecordId=@Manual;
   SET @ManualKey=NEWID();
   SET @Writer=CONCAT(N'EXEC paws_api.CancelAfcRecord ''',CONVERT(char(36),@Manual),N''',N''manual'',''',@Version,N''',N''calendar-swap-admin'',N''Synthetic Swap Admin'',''',CONVERT(char(36),@ManualKey),N''';');
  END;
 END;
 IF @Kind='session'
 BEGIN
  DECLARE @OtherRequest uniqueidentifier=NEWID(),@OtherSession nvarchar(max)=(SELECT N'2026-27' academicYear,N'2' curriculumYear,N'CALTEST' courseCode,N'LEC' sessionType,N'2026-12-05' date,N'09:30' startTime,N'10:30' endTime,CONCAT(@Name,N' conflict') topic,
   JSON_QUERY((SELECT @Faculty facultyId,N'Primary' teachingRole FOR JSON PATH)) assignments FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SET @Writer=CONCAT(N'EXEC paws_api.CreateCalendarSession @SessionJson=N''',REPLACE(@OtherSession,N'''',N''''''),N''',@ActorFirebaseUid=N''calendar-swap-admin'',@RequestId=''',CONVERT(char(36),@OtherRequest),N''',@ReturnSession=0;');
 END;
 DELETE @Reply;INSERT @Reply EXEC paws_api.GetSessionSwapContext @Session,N'calendar-swap-admin';
 DECLARE @Snapshot varchar(64)=JSON_VALUE((SELECT responseJson FROM @Reply),'$.session.snapshotToken');
 DECLARE @Chosen uniqueidentifier=IIF(@Kind='recovery' AND @ReaderFirst=0,@Replacement,@Faculty),@Candidate uniqueidentifier;
 SELECT @Candidate=CandidateKey FROM paws.SwapCandidate WHERE FacultyId=@Chosen;
 DECLARE @Payload nvarchar(max)=(SELECT @Request requestId,@Session sessionId,@Assignment assignmentId,@Snapshot snapshotToken,CAST(0 AS bit) notifyReplacement,N'synthetic race request' note,
  JSON_QUERY((SELECT @Candidate replacementCandidateKey FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) changes FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC paws_api.SaveSessionSwap N'calendar-swap-admin',@Payload,0;
 DECLARE @Expected int=CASE WHEN @ReaderFirst=0 AND @Kind IN('migration','timing','recovery') THEN 53010 WHEN @ReaderFirst=0 AND @Kind IN('afc_create','session') THEN 53011 ELSE 0 END;
 DECLARE @Override nvarchar(64)=CASE WHEN @Kind='migration' AND @ReaderFirst=1 THEN N'synthetic AFC override' END;
 DECLARE @Decide nvarchar(max)=CONCAT(N'EXEC paws_api.DecideSessionSwap N''calendar-swap-admin'',''',CONVERT(char(36),@Request),N''',1,N''approve'',NULL,',CASE WHEN @Override IS NULL THEN N'NULL' ELSE N'N''synthetic AFC override''' END,N',1;');
 DECLARE @Reader nvarchar(max)=CASE WHEN @Expected=0 THEN @Decide+N' IF NOT EXISTS(SELECT 1 FROM paws.SwapRequest WHERE RequestId='''+CONVERT(char(36),@Request)+N''' AND Status=N''applied'') THROW 53891,''Race did not apply.'',1;' ELSE
  N'DECLARE @Rejected bit=0;BEGIN TRY '+@Decide+N' END TRY BEGIN CATCH IF ERROR_NUMBER()='+CONVERT(varchar(8),@Expected)+N' SET @Rejected=1;ELSE THROW;END CATCH;IF @Rejected=0 THROW 53891,''Race failed to reject stale/unavailable apply.'',1;' END;
 INSERT dbo.CalendarActivityRaceBarrier(TestName) VALUES(@TestName);
 INSERT dbo.CalendarActivityRaceCase VALUES(@TestName,@Faculty,@Session,@Assignment,@Request,@Writer,@Reader,IIF(@Kind IN('migration','timing','recovery'),'APPLICATION','BUSINESS'));
END;
