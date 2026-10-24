:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @Batch uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID(),@Course uniqueidentifier=NEWID(),@A uniqueidentifier=NEWID(),@B uniqueidentifier=NEWID();
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Batch,SYSUTCDATETIME(),N'synthetic',REPLICATE('C',64),N'test',N'{}');
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',N'Synthetic Task Faculty',1,@Batch);
INSERT paws.SwapCandidate(FacultyId) VALUES(@Faculty);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,Active,MustChangePassword) VALUES(N'task-admin',N'task-admin@example.test',N'Synthetic ADFA',N'adfa_regular',1,0);
INSERT paws.Course(CourseId,CourseCode,CourseName,SourceImportBatchId) VALUES(@Course,N'TASK_TEST',N'Synthetic task course',@Batch);
INSERT paws.Session(SessionId,AcademicYear,CourseId,CourseCode,Topic,SessionType,SessionDate,StartTime,EndTime,SourceImportBatchId)
VALUES(@A,N'TASK-TEST',@Course,N'TASK_TEST',N'A',N'LEC','2026-11-05','09:00','10:00',@Batch),(@B,N'TASK-TEST',@Course,N'TASK_TEST',N'B',N'LEC','2026-11-05','09:30','10:30',@Batch);
INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,FacultyResolutionStatus,SourceImportBatchId,SourceRow)
VALUES(NEWID(),@A,@Faculty,N'resolved',@Batch,1),(NEWID(),@B,@Faculty,N'resolved',@Batch,2);
DECLARE @Reply TABLE(responseJson nvarchar(max));
INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST"}';
DECLARE @Json nvarchar(max)=(SELECT responseJson FROM @Reply);
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 OR COALESCE(JSON_VALUE(@Json,'$.tasks[0].type'),N'')<>N'instructor_overlap' OR COALESCE(JSON_VALUE(@Json,'$.tasks[0].severity'),N'')<>N'Conflict'
 THROW 54390,'Overlapping assignments must produce exactly one confirmed pair.',1;
-- Either course must discover the single pair, independent of GUID ordering.
DECLARE @Related uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@Json,'$.tasks[0].relatedSessions[0].id'));
UPDATE paws.Session SET CourseCode=N'RELATED_TEST' WHERE SessionId=@Related;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST","courseCode":"RELATED_TEST"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1
 OR NOT EXISTS(SELECT 1 FROM OPENJSON(@Json,'$.filters.courses') WITH(courseCode nvarchar(32)) WHERE courseCode=N'RELATED_TEST')
 THROW 54390,'Related course filtering or facets omitted the overlap.',1;
UPDATE paws.Session SET CourseCode=N'TASK_TEST' WHERE SessionId=@Related;
PRINT 'SCHEDULING_TASK_RELATED_COURSE_OK';
UPDATE paws.Session SET StartTime='10:00',EndTime='11:00' WHERE SessionId=@B;
DELETE @Reply;
INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST"}';
SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>0 THROW 54390,'Adjacent sessions must not conflict.',1;
PRINT 'SCHEDULING_TASK_OVERLAP_OK';

-- A duplicate assignment is an independent problem, not a self-overlap.
DECLARE @Extra uniqueidentifier=NEWID();
INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,FacultyResolutionStatus,SourceImportBatchId,SourceRow) VALUES(@Extra,@A,@Faculty,N'resolved',@Batch,3);
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(JSON_VALUE(@Json,'$.tasks[0].type'),N'')<>N'duplicate_assignment' OR COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 THROW 54390,'Duplicate assignment must produce one issue.',1;
DELETE paws.SessionAssignment WHERE SessionAssignmentId=@Extra;
UPDATE paws.Session SET StartTime='09:00',EndTime='10:00',Topic=N'A' WHERE SessionId=@B;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(JSON_VALUE(@Json,'$.tasks[0].type'),N'')<>N'duplicate_session_assignment' OR COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 THROW 54390,'Duplicate sessions must replace the generic pair issue.',1;
UPDATE paws.Session SET StartTime=NULL WHERE SessionId=@B;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(JSON_VALUE(@Json,'$.tasks[0].severity'),N'')<>N'Needs Review' OR COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 THROW 54390,'Missing time is review evidence, not a confirmed overlap.',1;
UPDATE paws.Session SET StartTime='12:00',EndTime='11:00' WHERE SessionId=@B;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST","type":"invalid_schedule"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 THROW 54390,'Invalid interval must be a quality issue.',1;
UPDATE paws.Session SET SessionDate=NULL WHERE SessionId=@B;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST","undated":"only"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 OR JSON_VALUE(@Json,'$.tasks[0].date') IS NOT NULL THROW 54390,'Undated schedule disappeared.',1;
UPDATE paws.Session SET SessionDate='2026-11-06',StartTime='09:00',EndTime='10:00' WHERE SessionId=@B;
PRINT 'SCHEDULING_TASK_QUALITY_OK';
UPDATE paws.Session SET CourseCode=NULL WHERE SessionId=@A;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST","type":"missing_schedule"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 THROW 54390,'Missing course was not reviewed.',1;
UPDATE paws.Session SET CourseCode=N'TASK_TEST' WHERE SessionId=@A;
DELETE paws.SessionAssignment WHERE SessionId=@B;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST","type":"missing_schedule"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 OR COALESCE(JSON_VALUE(@Json,'$.tasks[0].displayName'),N'')<>N'Not provided' THROW 54390,'Unassigned session was not reviewed safely.',1;
INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,FacultyResolutionStatus,SourceImportBatchId,SourceRow) VALUES(NEWID(),@B,@Faculty,N'resolved',@Batch,2);
INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,SourceFacultyName,FacultyResolutionStatus,SourceImportBatchId,SourceRow) VALUES(@Extra,@A,NULL,N'PRIVATE UNRESOLVED NAME',N'unresolved',@Batch,8);
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST","type":"missing_schedule"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 OR @Json LIKE N'%PRIVATE UNRESOLVED%' THROW 54390,'Unresolved assignment was missed or exposed.',1;
DELETE paws.SessionAssignment WHERE SessionAssignmentId=@Extra;
DECLARE @Undated uniqueidentifier=NEWID();
INSERT paws.Session(SessionId,AcademicYear,CourseId,CourseCode,Topic,SessionType,SourceImportBatchId) VALUES(@Undated,N'ONLY-UNDATED',@Course,N'TASK_TEST',N'Undated',N'LEC',@Batch);
INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,FacultyResolutionStatus,SourceImportBatchId,SourceRow) VALUES(NEWID(),@Undated,@Faculty,N'resolved',@Batch,9);
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"ONLY-UNDATED"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 OR COALESCE(JSON_VALUE(@Json,'$.tasks[0].severity'),N'')<>N'Needs Review' THROW 54390,'Undated-only academic year disappeared.',1;
PRINT 'SCHEDULING_TASK_IDENTITY_QUALITY_OK';

-- Ordinary faculty must not learn a co-instructor's AFC evidence.
DECLARE @Other uniqueidentifier=NEWID(),@Absence uniqueidentifier=NEWID();
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Other,N'faculty',N'Synthetic Other Faculty',1,@Batch);
INSERT paws.SwapCandidate(FacultyId) VALUES(@Other);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword)
VALUES(N'task-faculty',N'task-faculty@example.test',N'Synthetic Faculty',N'faculty',@Faculty,1,0),(N'task-other',N'task-other@example.test',N'Synthetic Other',N'faculty',@Other,1,0);
INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,FacultyResolutionStatus,SourceImportBatchId,SourceRow) VALUES(NEWID(),@A,@Other,N'resolved',@Batch,4);
INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow) VALUES(@Absence,@Other,'2026-11-01','2026-11-10',N'PRIVATE AFC REASON',1,@Batch,5);
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-faculty',N'{"academicYear":"TASK-TEST"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>0 OR @Json LIKE N'%Synthetic Other%' THROW 54390,'Co-instructor confidential issue leaked.',1;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-other',N'{"academicYear":"TASK-TEST"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(JSON_VALUE(@Json,'$.tasks[0].type'),N'')<>N'afc_unavailable' OR @Json LIKE N'%PRIVATE AFC%' OR @Json LIKE N'%2026-11-01%' OR @Json LIKE N'%@example.test%' OR @Json LIKE N'%'+CONVERT(nvarchar(36),@Other)+N'%' THROW 54390,'Own availability missing or private metadata leaked.',1;
UPDATE paws.AfcRecord SET Active=0 WHERE AfcRecordId=@Absence;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-other',N'{"academicYear":"TASK-TEST"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>0 THROW 54390,'Cancelled absence still creates a conflict.',1;
PRINT 'SCHEDULING_TASK_AFC_PRIVACY_OK';

-- Calendar working activity time is evidence, never inferred from a date range.
DECLARE @Activity uniqueidentifier=NEWID();
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid)
SELECT TOP(1) @Activity,@Faculty,N'ccc',N'PRIVATE ACTIVITY LABEL','2026-11-05','2026-11-05',ImportBatchId,ImportRowId,SourceSha256,N'synthetic-task',9991,N'task-admin' FROM paws.CalendarActivity;
IF @@ROWCOUNT<>1 THROW 54390,'Calendar synthetic prerequisite missing.',1;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(JSON_VALUE(@Json,'$.tasks[0].type'),N'')<>N'calendar_time_unknown' OR COALESCE(JSON_VALUE(@Json,'$.tasks[0].severity'),N'')<>N'Needs Review' OR @Json LIKE N'%PRIVATE ACTIVITY%' THROW 54390,'Unknown working time classified or disclosed incorrectly.',1;
INSERT paws.CalendarActivityDayTime(ActivityId,ActivityDate,StartTime,EndTime,EvidenceRef,EvidenceNote,ActorUid) VALUES(@Activity,'2026-11-05','09:30','10:30',N'synthetic',N'PRIVATE evidence',N'task-admin');
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(JSON_VALUE(@Json,'$.tasks[0].type'),N'')<>N'calendar_activity_overlap' OR COALESCE(JSON_VALUE(@Json,'$.tasks[0].severity'),N'')<>N'Conflict' OR @Json LIKE N'%PRIVATE%' THROW 54390,'Verified working overlap missed or private evidence leaked.',1;
PRINT 'SCHEDULING_TASK_CALENDAR_OK';

-- Filters and cursor operate on scoped findings, never on confidential directory data.
UPDATE paws.AfcRecord SET Active=1 WHERE AfcRecordId=@Absence;
DECLARE @FacultyKey uniqueidentifier=(SELECT CandidateKey FROM paws.SwapCandidate WHERE FacultyId=@Faculty),@Query nvarchar(max);
SET @Query=CONCAT(N'{"academicYear":"TASK-TEST","facultyKey":"',@FacultyKey,N'","limit":1}');
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',@Query;SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 OR COALESCE(JSON_VALUE(@Json,'$.tasks[0].type'),N'')<>N'calendar_activity_overlap' THROW 54390,'Faculty filtering ignored.',1;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST","type":"afc_unavailable"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>1 OR COALESCE(JSON_VALUE(@Json,'$.tasks[0].type'),N'')<>N'afc_unavailable' THROW 54390,'Type filtering ignored.',1;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST","courseCode":"NO_SUCH_COURSE"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>0 THROW 54390,'Course filtering ignored.',1;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST","start":"2026-11-06","end":"2026-11-07"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>0 THROW 54390,'Date filtering ignored.',1;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST","reviewStatus":"Reviewed"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>0 THROW 54390,'Review status filtering ignored.',1;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',N'{"academicYear":"TASK-TEST","limit":1}';SELECT @Json=responseJson FROM @Reply;
DECLARE @Cursor nvarchar(512)=JSON_VALUE(@Json,'$.nextCursor'),@FirstKey varchar(64)=JSON_VALUE(@Json,'$.tasks[0].issueKey');
IF @Cursor IS NULL OR COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),-1)<>2 OR (SELECT COUNT(*) FROM OPENJSON(@Json,'$.tasks'))<>1 THROW 54390,'Bounded paging/count missing.',1;
SET @Query=CONCAT(N'{"academicYear":"TASK-TEST","limit":1,"cursor":"',STRING_ESCAPE(@Cursor,'json'),N'"}');
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-admin',@Query;SELECT @Json=responseJson FROM @Reply;
IF JSON_VALUE(@Json,'$.tasks[0].issueKey')=@FirstKey OR JSON_VALUE(@Json,'$.nextCursor') IS NOT NULL THROW 54390,'Cursor repeated or lost a page.',1;
DECLARE @Rejected bit=0;
-- Expected read rejection must not poison the synthetic fixture transaction.
SET XACT_ABORT OFF;
BEGIN TRY EXEC paws_api.ListSchedulingTasks N'task-faculty',@Query;END TRY BEGIN CATCH IF ERROR_NUMBER()=54310 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 THROW 54390,'Cursor crossed actor scope.',1;
UPDATE paws.Session SET Room=N'Synthetic changed' WHERE SessionId=@A;
SET @Rejected=0;
BEGIN TRY EXEC paws_api.ListSchedulingTasks N'task-admin',@Query;END TRY BEGIN CATCH IF ERROR_NUMBER()=54310 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 THROW 54390,'Cursor ignored source changes.',1;
PRINT 'SCHEDULING_TASK_FILTER_PAGING_OK';
ROLLBACK;
PRINT 'SCHEDULING_TASK_DETECTION_OK';
