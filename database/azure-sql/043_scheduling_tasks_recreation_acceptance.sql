:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
DECLARE @Batch uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID(),@Session uniqueidentifier=NEWID(),@Context uniqueidentifier=NEWID(),@Operation uniqueidentifier=NEWID();
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Batch,SYSUTCDATETIME(),N'synthetic',REPLICATE('F',64),N'test',N'{}');
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',N'Synthetic Assignment History',1,@Batch);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,Active,MustChangePassword) VALUES(N'task-history-admin',N'history@example.test',N'Synthetic Developer',N'developer',1,0);
INSERT paws.Session(SessionId,AcademicYear,CourseCode,Topic,SessionType,SessionDate,StartTime,EndTime,SourceImportBatchId) VALUES(@Session,N'HISTORY-TEST',N'HISTORY',N'Synthetic',N'LEC','2026-11-05','09:00','10:00',@Batch);
DECLARE @Reply TABLE(responseJson nvarchar(max));
INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-history-admin',N'{"academicYear":"HISTORY-TEST"}';
DECLARE @Json nvarchar(max)=(SELECT responseJson FROM @Reply),@Key varchar(64),@Evidence varchar(64),@Review varchar(16),@Rejected bit=0,@Assignments nvarchar(max);
SELECT @Key=JSON_VALUE(@Json,'$.tasks[0].issueKey'),@Evidence=JSON_VALUE(@Json,'$.tasks[0].evidenceVersion'),@Review=JSON_VALUE(@Json,'$.tasks[0].reviewVersion');
DELETE @Reply;INSERT @Reply EXEC paws_api.ReviewSchedulingTask N'task-history-admin',@Key,N'HISTORY-TEST',@Evidence,@Review,N'Reviewed';
SELECT @Review=JSON_VALUE(responseJson,'$.reviewVersion') FROM @Reply;
SET @Assignments=(SELECT @Faculty facultyId FOR JSON PATH);
-- Use the same mutation as the existing Manage Instructors command.
EXEC paws_api.ReplaceCalendarSessionAssignments @Session,@Assignments,N'task-history-admin';
IF EXISTS(SELECT 1 FROM paws_api.SchedulingTaskIssues(N'HISTORY-TEST')) THROW 54390,'Assigned session stayed incomplete.',1;
EXEC paws_api.ReplaceCalendarSessionAssignments @Session,N'[]',N'task-history-admin';
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-history-admin',N'{"academicYear":"HISTORY-TEST"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(JSON_VALUE(@Json,'$.tasks[0].reviewStatus'),N'')<>N'Unreviewed' OR JSON_VALUE(@Json,'$.tasks[0].evidenceVersion')=@Evidence THROW 54390,'Empty assignment recreation inherited its previous review.',1;
BEGIN TRY EXEC paws_api.ReviewSchedulingTask N'task-history-admin',@Key,N'HISTORY-TEST',@Evidence,@Review,N'Reviewed';END TRY BEGIN CATCH IF ERROR_NUMBER()=54310 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 THROW 54390,'Recreated empty assignment accepted old review evidence.',1;
PRINT 'SCHEDULING_TASK_EMPTY_RECREATION_OK';
-- A supported Undo returns to the same empty collection, but must not restore its review token.
SET @Evidence=JSON_VALUE(@Json,'$.tasks[0].evidenceVersion');
DELETE @Reply;INSERT @Reply EXEC paws_api.ReviewSchedulingTask N'task-history-admin',@Key,N'HISTORY-TEST',@Evidence,@Review,N'Reviewed';SELECT @Review=JSON_VALUE(responseJson,'$.reviewVersion') FROM @Reply;
INSERT paws.SupportContext(ContextId,ActorUid,TargetUid,Reason,ExpiresAtUtc) VALUES(@Context,N'task-history-admin',N'task-history-admin',N'Synthetic assignment recovery',DATEADD(hour,1,SYSUTCDATETIME()));
INSERT paws.SupportOperation(OperationId,ContextId,ActorUid,TargetUid,Route) VALUES(@Operation,@Context,N'task-history-admin',N'task-history-admin',N'/synthetic/assignments');
EXEC sys.sp_set_session_context @key=N'paws_support_operation',@value=@Operation;
EXEC paws_api.ReplaceCalendarSessionAssignments @Session,@Assignments,N'task-history-admin';
EXEC sys.sp_set_session_context @key=N'paws_support_operation',@value=NULL;
EXEC paws_api.UndoSupportOperation @Operation,N'task-history-admin';
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-history-admin',N'{"academicYear":"HISTORY-TEST"}';SELECT @Json=responseJson FROM @Reply;
IF COALESCE(JSON_VALUE(@Json,'$.tasks[0].reviewStatus'),N'')<>N'Unreviewed' OR JSON_VALUE(@Json,'$.tasks[0].evidenceVersion')=@Evidence THROW 54390,'Support Undo recreated an already reviewed empty assignment issue.',1;
SET @Rejected=0;
BEGIN TRY EXEC paws_api.ReviewSchedulingTask N'task-history-admin',@Key,N'HISTORY-TEST',@Evidence,@Review,N'Reviewed';END TRY BEGIN CATCH IF ERROR_NUMBER()=54310 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 THROW 54390,'Support Undo accepted an obsolete review.',1;
PRINT 'SCHEDULING_TASK_UNDO_RECREATION_OK';
-- Unresolved-only edits must change evidence without disclosing source names.
DECLARE @Assignment uniqueidentifier=NEWID();
INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,SourceFacultyName,FacultyResolutionStatus,SourceImportBatchId,SourceRow) VALUES(@Assignment,@Session,NULL,N'PRIVATE first name',N'unresolved',@Batch,1);
SELECT @Evidence=EvidenceVersion FROM paws_api.SchedulingTaskIssues(N'HISTORY-TEST') WHERE IssueKey=@Key;
UPDATE paws.SessionAssignment SET SourceFacultyName=N'PRIVATE corrected name' WHERE SessionAssignmentId=@Assignment;
IF EXISTS(SELECT 1 FROM paws_api.SchedulingTaskIssues(N'HISTORY-TEST') WHERE IssueKey=@Key AND EvidenceVersion=@Evidence) THROW 54390,'Unresolved assignment changes did not invalidate evidence.',1;
DELETE @Reply;INSERT @Reply EXEC paws_api.ListSchedulingTasks N'task-history-admin',N'{"academicYear":"HISTORY-TEST"}';SELECT @Json=responseJson FROM @Reply;
IF @Json LIKE N'%PRIVATE%' THROW 54390,'Unresolved source identity leaked.',1;
-- Failed business transactions must roll back version metadata too.
SELECT @Evidence=EvidenceVersion FROM paws_api.SchedulingTaskIssues(N'HISTORY-TEST') WHERE IssueKey=@Key;
BEGIN TRANSACTION;
DELETE paws.SessionAssignment WHERE SessionId=@Session;
ROLLBACK;
IF NOT EXISTS(SELECT 1 FROM paws_api.SchedulingTaskIssues(N'HISTORY-TEST') WHERE IssueKey=@Key AND EvidenceVersion=@Evidence) THROW 54390,'Rolled back assignment changed durable evidence.',1;
PRINT 'SCHEDULING_TASK_UNRESOLVED_AND_TRANSACTION_OK';
-- Retain no fixture history; the rollback lane deliberately requires empty review history.
DECLARE @CreatedBatches TABLE(ImportBatchId uniqueidentifier);
INSERT @CreatedBatches SELECT DISTINCT ImportBatchId FROM paws.AuditEvent WHERE ActorFirebaseUid=N'task-history-admin' AND ImportBatchId IS NOT NULL;
DELETE paws.SupportChange WHERE OperationId=@Operation;
DELETE paws.SupportOperation WHERE OperationId=@Operation;
DELETE paws.SupportContext WHERE ContextId=@Context;
DELETE paws.SchedulingTaskReview WHERE IssueKey=@Key;
DELETE paws.AuditEvent WHERE ActorFirebaseUid=N'task-history-admin';
DELETE paws.SessionAssignment WHERE SessionId=@Session;
DELETE paws.Session WHERE SessionId=@Session;
DELETE paws.UserProfile WHERE FirebaseUid=N'task-history-admin';
DELETE paws.Faculty WHERE FacultyId=@Faculty;
DELETE staging.ImportBatch WHERE ImportBatchId=@Batch OR ImportBatchId IN(SELECT ImportBatchId FROM @CreatedBatches);
