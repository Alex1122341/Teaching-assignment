/* Disposable-container fixtures only. Never part of a deployment migration. */
SET NOCOUNT ON;
CREATE TABLE dbo.SchedulingTaskRaceSignal(Name nvarchar(64) PRIMARY KEY,Released bit NOT NULL);
CREATE TABLE dbo.SchedulingTaskRaceCase(Name nvarchar(64) PRIMARY KEY,IssueKey varchar(64),EvidenceVersion varchar(64),ReviewVersion varchar(16),SourceSql nvarchar(max));
DECLARE @Batch uniqueidentifier='D1000000-0000-4000-8000-000000000001',@Faculty uniqueidentifier='D1000000-0000-4000-8000-000000000002',@Course uniqueidentifier='D1000000-0000-4000-8000-000000000003';
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Batch,SYSUTCDATETIME(),N'synthetic',REPLICATE('E',64),N'test',N'{}');
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',N'Synthetic Race Faculty',1,@Batch);
INSERT paws.SwapCandidate(FacultyId) VALUES(@Faculty);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,Active,MustChangePassword) VALUES(N'task-race-admin',N'race@example.test',N'Synthetic Race Admin',N'owner',1,0);
INSERT paws.Course(CourseId,CourseCode,CourseName,SourceImportBatchId) VALUES(@Course,N'RACE_TASK',N'Synthetic race course',@Batch);
INSERT paws.Session(SessionId,AcademicYear,CourseId,CourseCode,Topic,SessionType,SessionDate,StartTime,EndTime,SourceImportBatchId)
VALUES('D1000000-0000-4000-8000-000000000004',N'RACE-TASK',@Course,N'RACE_TASK',N'A',N'LEC','2026-11-05','09:00','10:00',@Batch),('D1000000-0000-4000-8000-000000000005',N'RACE-TASK',@Course,N'RACE_TASK',N'B',N'LEC','2026-11-05','09:30','10:30',@Batch);
INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow) VALUES('D1000000-0000-4000-8000-000000000006',@Faculty,'2026-11-05','2026-11-05',N'PRIVATE synthetic',1,@Batch,6);
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid)
SELECT TOP(1) 'D1000000-0000-4000-8000-000000000007',@Faculty,N'ccc',N'PRIVATE synthetic','2026-11-05','2026-11-05',ImportBatchId,ImportRowId,SourceSha256,N'synthetic-task-race',9992,N'task-race-admin' FROM paws.CalendarActivity;
IF @@ROWCOUNT<>1 THROW 54390,'Missing Calendar race prerequisite.',1;
INSERT paws.CalendarActivityDayTime(ActivityId,ActivityDate,StartTime,EndTime,EvidenceRef,EvidenceNote,ActorUid) VALUES('D1000000-0000-4000-8000-000000000007','2026-11-05','09:20','10:20',N'synthetic',N'private',N'task-race-admin');
GO
CREATE PROCEDURE dbo.PrepareSchedulingTaskRace @Name nvarchar(64),@Kind nvarchar(32)
AS
BEGIN
 SET NOCOUNT ON;
 DELETE paws.SchedulingTaskReview WHERE IssueKey IN(SELECT IssueKey FROM dbo.SchedulingTaskRaceCase);
 DELETE paws.AuditEvent WHERE EventType=N'SchedulingTaskReviewed' AND ActorFirebaseUid=N'task-race-admin';
 UPDATE paws.Session SET Room=NULL WHERE AcademicYear=N'RACE-TASK';
 DELETE paws.SessionAssignment WHERE SessionId IN('D1000000-0000-4000-8000-000000000004','D1000000-0000-4000-8000-000000000005');
 INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,FacultyResolutionStatus,SourceImportBatchId,SourceRow)
 VALUES(NEWID(),'D1000000-0000-4000-8000-000000000004','D1000000-0000-4000-8000-000000000002',N'resolved','D1000000-0000-4000-8000-000000000001',1),(NEWID(),'D1000000-0000-4000-8000-000000000005','D1000000-0000-4000-8000-000000000002',N'resolved','D1000000-0000-4000-8000-000000000001',2);
 UPDATE paws.AfcRecord SET Active=1 WHERE AfcRecordId='D1000000-0000-4000-8000-000000000006';
 UPDATE paws.CalendarActivityDayTime SET StartTime='09:20',EndTime='10:20' WHERE ActivityId='D1000000-0000-4000-8000-000000000007';
 DECLARE @Type nvarchar(40)=CASE @Kind WHEN N'afc' THEN N'afc_unavailable' WHEN N'calendar' THEN N'calendar_activity_overlap' ELSE N'instructor_overlap' END,@SourceSql nvarchar(max),@Query nvarchar(max),@Json nvarchar(max);
 SET @Query=(SELECT N'RACE-TASK' academicYear,@Type type FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @Reply TABLE(responseJson nvarchar(max));
 INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-race-admin',@Query;
 SELECT @Json=responseJson FROM @Reply;
 IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@Json,'$.total')),0)<1 THROW 54390,'No race finding.',1;
 SET @SourceSql=CASE @Kind
 WHEN N'session' THEN N'UPDATE paws.Session SET Room=N''changed'' WHERE SessionId=''D1000000-0000-4000-8000-000000000004'';'
 WHEN N'assignment_insert' THEN N'INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,FacultyResolutionStatus,SourceImportBatchId,SourceRow) VALUES(NEWID(),''D1000000-0000-4000-8000-000000000004'',''D1000000-0000-4000-8000-000000000002'',N''resolved'',''D1000000-0000-4000-8000-000000000001'',3);'
 WHEN N'assignment_delete' THEN N'DELETE paws.SessionAssignment WHERE SessionId=''D1000000-0000-4000-8000-000000000004'';'
 WHEN N'afc' THEN N'UPDATE paws.AfcRecord SET Active=0 WHERE AfcRecordId=''D1000000-0000-4000-8000-000000000006'';'
 WHEN N'calendar' THEN N'UPDATE paws.CalendarActivityDayTime SET StartTime=''11:00'',EndTime=''12:00'' WHERE ActivityId=''D1000000-0000-4000-8000-000000000007'';'
 WHEN N'reviewer' THEN N'' END;
 IF @SourceSql IS NULL THROW 54390,'Invalid race kind.',1;
 INSERT dbo.SchedulingTaskRaceCase VALUES(@Name,JSON_VALUE(@Json,'$.tasks[0].issueKey'),JSON_VALUE(@Json,'$.tasks[0].evidenceVersion'),JSON_VALUE(@Json,'$.tasks[0].reviewVersion'),@SourceSql);
 INSERT dbo.SchedulingTaskRaceSignal VALUES(@Name,0);
END;
