:ON ERROR EXIT
SET NOCOUNT ON;
IF OBJECT_ID(N'paws_api.CalendarActivityAvailability') IS NULL THROW 53890,'Activity-aware SWAP is missing.',1;
DECLARE @Source uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID(),@Outgoing uniqueidentifier=NEWID(),@Co uniqueidentifier=NEWID(),@Afc uniqueidentifier=NEWID(),@Raw uniqueidentifier=NEWID(),@Batch uniqueidentifier=NEWID(),@Course uniqueidentifier=NEWID(),@Session uniqueidentifier=NEWID(),@Assignment uniqueidentifier=NEWID(),@CoAssignment uniqueidentifier=NEWID();
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,Active,MustChangePassword) VALUES(N'calendar-swap-admin',N'swap@example.test',N'Synthetic Swap Admin',N'owner',1,0);
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Source,SYSUTCDATETIME(),N'synthetic',REPLICATE('B',64),N'test',N'{}');
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',N'Synthetic Calendar Candidate',1,@Source),(@Outgoing,N'faculty',N'Synthetic Outgoing',1,@Source),(@Co,N'faculty',N'Synthetic Co-Instructor',1,@Source);
INSERT paws.SwapCandidate(FacultyId) VALUES(@Faculty),(@Outgoing),(@Co);
INSERT paws.Course(CourseId,CourseCode,CourseName,SourceImportBatchId) VALUES(@Course,N'CALTEST',N'Synthetic Calendar Test',@Source);
INSERT paws.Session(SessionId,AcademicYear,CurriculumYear,CourseId,CourseCode,CourseName,Topic,SessionType,SessionDate,StartTime,EndTime,SourceImportBatchId)
 VALUES(@Session,N'2026-27',N'2',@Course,N'CALTEST',N'Synthetic Calendar Test',N'Synthetic Topic',N'LEC','2026-11-05','09:00','10:00',@Source);
INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,SourceFacultyName,FacultyResolutionStatus,TeachingRole,SourceImportBatchId,SourceRow)
 VALUES(@Assignment,@Session,@Outgoing,N'Synthetic Outgoing',N'resolved',N'Primary',@Source,1),(@CoAssignment,@Session,@Co,N'Synthetic Co-Instructor',N'resolved',N'Secondary',@Source,2);
INSERT staging.AfcRecordRaw(ImportBatchId,ImportRowId,SourceRowNumber,FacultySourceName,StartDate,EndDate,Purpose,RawJson,ValidationStatus,ValidationErrorsJson)
 VALUES(@Source,@Raw,200,N'Synthetic Calendar Candidate','2026-11-05','2026-11-06',N'CCC Day',N'{}',N'valid',N'[]');
INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow) VALUES(@Afc,@Faculty,'2026-11-05','2026-11-06',N'CCC Day',1,@Source,200);
IF paws_api.CalendarActivityAvailability(@Faculty,'2026-11-05','09:00','10:00',@Session)<>N'Unavailable' THROW 53890,'Retained AFC did not block availability.',1;
DECLARE @Rows nvarchar(max)=N'[{"sourceRow":200,"facultySourceName":"Synthetic Calendar Candidate","startDate":"2026-11-05","endDate":"2026-11-06","originalLabel":"CCC Day","treatment":"working_candidate","issues":[]}]';
DECLARE @Reply TABLE(responseJson nvarchar(max));
INSERT @Reply EXEC paws_api.StageCalendarActivityImport N'calendar-swap-admin',@Batch,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Rows;
DECLARE @Version varchar(16),@Manifest char(64),@Key uniqueidentifier=NEWID();
SELECT @Version=JSON_VALUE(responseJson,'$.previewVersion'),@Manifest=JSON_VALUE(responseJson,'$.manifestSha256') FROM @Reply;
EXEC paws_api.CommitCalendarActivityImport N'calendar-swap-admin',@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;
IF paws_api.CalendarActivityAvailability(@Faculty,'2026-11-05','09:00','10:00',@Session)<>N'Needs Review'
 OR paws_api.CalendarActivityAvailability(@Faculty,'2026-11-06','09:00','10:00',@Session)<>N'Needs Review' THROW 53890,'Date-only activity was treated as known availability.',1;
DELETE @Reply;INSERT @Reply EXEC paws_api.GetSessionSwapContext @Session,N'calendar-swap-admin';
DECLARE @Context nvarchar(max)=(SELECT responseJson FROM @Reply),@Candidate uniqueidentifier=(SELECT CandidateKey FROM paws.SwapCandidate WHERE FacultyId=@Faculty),@Snapshot varchar(64)=JSON_VALUE((SELECT responseJson FROM @Reply),'$.session.snapshotToken');
IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Context,'$.candidates') WITH(candidateKey uniqueidentifier,available bit,availabilityStatus nvarchar(16)) WHERE candidateKey=@Candidate AND available=0 AND availabilityStatus=N'Needs Review')
 OR @Context LIKE N'%CCC Day%' OR @Context LIKE N'%private evidence note%' THROW 53890,'Actual candidate procedure did not return sanitized Needs Review.',1;
DECLARE @Request uniqueidentifier=NEWID(),@Payload nvarchar(max),@Rejected bit=0;
SET @Payload=(SELECT @Request requestId,@Session sessionId,@Assignment assignmentId,@Snapshot snapshotToken,CAST(0 AS bit) notifyReplacement,N'synthetic request' note,
 JSON_QUERY((SELECT @Candidate replacementCandidateKey FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) changes FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
BEGIN TRY EXEC paws_api.SaveSessionSwap N'calendar-swap-admin',@Payload,0; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53011 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 OR EXISTS(SELECT 1 FROM paws.SwapRequest WHERE RequestId=@Request) THROW 53890,'New Needs Review selection was saved.',1;
DECLARE @Activity uniqueidentifier,@ActivityVersion varchar(16);
SELECT @Activity=ActivityId,@ActivityVersion=CONVERT(varchar(16),CONVERT(binary(8),ActivityVersion),2) FROM paws.CalendarActivity WHERE ImportBatchId=@Batch;
EXEC paws_api.ResolveCalendarActivityDayTime N'calendar-swap-admin',@Activity,@ActivityVersion,'2026-11-05','08:00','09:00',N'synthetic evidence',N'private evidence note';
IF paws_api.CalendarActivityAvailability(@Faculty,'2026-11-05','09:00','10:00',@Session)<>N'Available'
 OR paws_api.CalendarActivityAvailability(@Faculty,'2026-11-06','09:00','10:00',@Session)<>N'Needs Review'
 OR paws_api.CalendarActivityAvailability(@Faculty,'2026-11-05',NULL,'10:00',@Session)<>N'Unavailable'
 OR paws_api.CalendarActivityAvailability(NULL,'2026-11-05','09:00','10:00',@Session)<>N'Unavailable' THROW 53890,'Adjacent timing, per-day missing evidence or malformed identity/time handling failed.',1;
EXEC paws_api.SaveSessionSwap N'calendar-swap-admin',@Payload,0;
IF (SELECT COUNT(*) FROM paws.SwapCalendarActivitySnapshot WHERE RequestId=@Request AND Revision=1)<>2 THROW 53890,'Every resulting co-instructor was not snapshotted.',1;
SELECT @ActivityVersion=CONVERT(varchar(16),CONVERT(binary(8),ActivityVersion),2) FROM paws.CalendarActivity WHERE ActivityId=@Activity;
EXEC paws_api.ResolveCalendarActivityDayTime N'calendar-swap-admin',@Activity,@ActivityVersion,'2026-11-05','08:30','09:30',N'synthetic evidence',N'private evidence note';
IF paws_api.CalendarActivityAvailability(@Faculty,'2026-11-05','09:00','10:00',@Session)<>N'Unavailable' THROW 53890,'Verified overlap did not block availability.',1;
SET @Rejected=0;
BEGIN TRY EXEC paws_api.DecideSessionSwap N'calendar-swap-admin',@Request,1,N'approve',NULL,N'synthetic override',1; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53010 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 OR EXISTS(SELECT 1 FROM paws.SessionAssignment WHERE SessionAssignmentId=@Assignment AND FacultyId=@Faculty) THROW 53890,'Changed activity snapshot was overridden.',1;
SELECT @ActivityVersion=CONVERT(varchar(16),CONVERT(binary(8),ActivityVersion),2) FROM paws.CalendarActivity WHERE ActivityId=@Activity;
EXEC paws_api.ResolveCalendarActivityDayTime N'calendar-swap-admin',@Activity,@ActivityVersion,'2026-11-05','08:00','09:00',N'synthetic evidence',N'private evidence note';
-- An untouched co-instructor has unknown timing; owners may not override it.
DECLARE @CoActivity uniqueidentifier=NEWID();
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid)
 SELECT @CoActivity,@Co,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,201,N'calendar-swap-admin' FROM paws.CalendarActivity WHERE ActivityId=@Activity;
DECLARE @CoManual uniqueidentifier=NEWID(),@CoManualRequest uniqueidentifier=NEWID(),@CoManualVersion varchar(16);
EXEC paws_api.CreateAfcRecord @CoManual,@Co,'2026-11-05','2026-11-05',N'vacation',NULL,N'calendar-swap-admin',N'Synthetic Swap Admin',@CoManualRequest;
IF paws_api.CalendarActivityAvailability(@Co,'2026-11-05','09:00','10:00',@Session)<>N'Needs Review'
 THROW 53890,'Retained AFC must not mask unresolved activity timing and enable an override.',1;
SET @Payload=JSON_MODIFY(@Payload,'$.expectedRevision',1);
EXEC paws_api.SaveSessionSwap N'calendar-swap-admin',@Payload,1;
SET @Rejected=0;
BEGIN TRY EXEC paws_api.DecideSessionSwap N'calendar-swap-admin',@Request,2,N'approve',NULL,N'synthetic override',1; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53011 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 OR EXISTS(SELECT 1 FROM paws.SessionAssignment WHERE SessionAssignmentId=@Assignment AND FacultyId=@Faculty) THROW 53890,'Unknown co-instructor timing was overridden.',1;
SELECT @CoManualVersion=CONVERT(varchar(16),CONVERT(binary(8),AfcVersion),2) FROM paws.AfcManualRecord WHERE AfcRecordId=@CoManual;
SET @CoManualRequest=NEWID();
EXEC paws_api.CancelAfcRecord @CoManual,N'manual',@CoManualVersion,N'calendar-swap-admin',N'Synthetic Swap Admin',@CoManualRequest;
SELECT @ActivityVersion=CONVERT(varchar(16),CONVERT(binary(8),ActivityVersion),2) FROM paws.CalendarActivity WHERE ActivityId=@CoActivity;
EXEC paws_api.ResolveCalendarActivityDayTime N'calendar-swap-admin',@CoActivity,@ActivityVersion,'2026-11-05','08:00','09:00',N'synthetic evidence',N'private co-instructor evidence';
SET @Payload=JSON_MODIFY(@Payload,'$.expectedRevision',2);EXEC paws_api.SaveSessionSwap N'calendar-swap-admin',@Payload,1;
DELETE paws.SwapCalendarActivitySnapshot WHERE RequestId=@Request AND Revision=3;
SET @Rejected=0;
BEGIN TRY EXEC paws_api.DecideSessionSwap N'calendar-swap-admin',@Request,3,N'approve',NULL,NULL,1; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53010 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 THROW 53890,'Legacy missing activity snapshots applied.',1;
SET @Payload=JSON_MODIFY(@Payload,'$.expectedRevision',3);EXEC paws_api.SaveSessionSwap N'calendar-swap-admin',@Payload,1;
EXEC paws_api.DecideSessionSwap N'calendar-swap-admin',@Request,4,N'approve',NULL,NULL,1;
IF NOT EXISTS(SELECT 1 FROM paws.SwapRequest WHERE RequestId=@Request AND Status=N'applied')
 OR NOT EXISTS(SELECT 1 FROM paws.SessionAssignment WHERE SessionAssignmentId=@Assignment AND FacultyId=@Faculty)
 OR NOT EXISTS(SELECT 1 FROM paws.SessionAssignment WHERE SessionAssignmentId=@CoAssignment AND FacultyId=@Co) THROW 53890,'Fresh verified SWAP did not preserve all co-instructors.',1;
PRINT 'CALENDAR_ACTIVITY_SWAP_SEMANTICS_OK';
