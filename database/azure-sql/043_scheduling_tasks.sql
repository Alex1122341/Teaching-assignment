/* Scoped current scheduling findings. No memberships or live write-gate changes. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws_api.GetAdfaSwapFacultyPreview') IS NULL
 THROW 54300,'Scheduling tasks require the reviewed Beta prerequisites.',1;
IF OBJECT_ID(N'paws_api.SchedulingTaskIssues') IS NOT NULL OR OBJECT_ID(N'paws_api.ListSchedulingTasks') IS NOT NULL
 OR OBJECT_ID(N'paws.SchedulingAssignmentRevision') IS NOT NULL OR OBJECT_ID(N'paws.SchedulingAssignmentChanged') IS NOT NULL
 THROW 54300,'Inspect existing scheduling task objects before applying.',1;
IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id IN(OBJECT_ID(N'paws.Session'),OBJECT_ID(N'paws.SessionAssignment')) AND system_type_id=189)
 THROW 54300,'Inspect existing scheduling source versions before applying.',1;
IF EXISTS(SELECT 1 FROM sys.schemas WHERE name IN(N'paws',N'paws_api') AND USER_NAME(principal_id)<>N'dbo')
 OR EXISTS(SELECT 1 FROM sys.objects WHERE object_id IN(OBJECT_ID(N'paws.Session'),OBJECT_ID(N'paws.SessionAssignment'),OBJECT_ID(N'paws.UserProfile'),OBJECT_ID(N'paws.AuditEvent'),OBJECT_ID(N'paws.Faculty'),OBJECT_ID(N'paws.AfcRecord'),OBJECT_ID(N'paws.AfcManualRecord'),OBJECT_ID(N'paws.CalendarActivity'),OBJECT_ID(N'paws.CalendarActivityDayTime')) AND principal_id IS NOT NULL AND USER_NAME(principal_id)<>N'dbo')
 THROW 54300,'Scheduling tasks require the existing dbo ownership chain.',1;
BEGIN TRANSACTION;
ALTER TABLE paws.Session ADD SchedulingVersion rowversion NOT NULL;
ALTER TABLE paws.SessionAssignment ADD SchedulingVersion rowversion NOT NULL;
-- Retained even when the last child is deleted. This is derived version metadata,
-- deliberately absent from the business-support capture/Undo registry.
CREATE TABLE paws.SchedulingAssignmentRevision(
 SessionId uniqueidentifier NOT NULL PRIMARY KEY REFERENCES paws.Session(SessionId) ON DELETE CASCADE,
 TouchedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),AssignmentVersion rowversion NOT NULL
);
INSERT paws.SchedulingAssignmentRevision(SessionId) SELECT SessionId FROM paws.Session;
CREATE TABLE paws.SchedulingTaskReview(
 IssueKey varchar(64) NOT NULL PRIMARY KEY,EvidenceVersion varchar(64) NOT NULL,
 ReviewStatus nvarchar(16) NOT NULL CHECK(ReviewStatus IN(N'Unreviewed',N'Reviewed')),
 ActorFirebaseUid nvarchar(128) NOT NULL,UpdatedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 ReviewVersion rowversion NOT NULL
);
GO
CREATE TRIGGER paws.SchedulingAssignmentChanged ON paws.SessionAssignment
AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Changed TABLE(SessionId uniqueidentifier PRIMARY KEY);
 INSERT @Changed SELECT SessionId FROM inserted UNION SELECT SessionId FROM deleted;
 -- Metadata changes are in the caller's transaction, including support Undo.
 UPDATE v WITH(UPDLOCK,HOLDLOCK) SET TouchedAtUtc=SYSUTCDATETIME()
 FROM paws.SchedulingAssignmentRevision v JOIN @Changed c ON c.SessionId=v.SessionId;
 INSERT paws.SchedulingAssignmentRevision(SessionId)
 SELECT c.SessionId FROM @Changed c
 WHERE NOT EXISTS(SELECT 1 FROM paws.SchedulingAssignmentRevision v WITH(UPDLOCK,HOLDLOCK) WHERE v.SessionId=c.SessionId);
END;
GO
CREATE FUNCTION paws_api.SchedulingTaskIssues(@AcademicYear nvarchar(32))
RETURNS TABLE AS RETURN
WITH assigned AS (
 SELECT a.SessionId,a.FacultyId,COUNT(*) AssignmentCount,
  STRING_AGG(CONVERT(nvarchar(max),CONCAT(a.SessionAssignmentId,N':',CONVERT(varchar(16),CONVERT(binary(8),a.SchedulingVersion),2))),N'|') WITHIN GROUP(ORDER BY a.SessionAssignmentId) AssignmentVersions
 FROM paws.SessionAssignment a WHERE a.FacultyId IS NOT NULL GROUP BY a.SessionId,a.FacultyId
), pairs AS (
 SELECT a.FacultyId,s.SessionId,t.SessionId RelatedSessionId,
  CONVERT(nvarchar(40),CASE WHEN s.CourseCode=t.CourseCode AND s.StartTime=t.StartTime AND s.EndTime=t.EndTime AND s.SessionType=t.SessionType
   AND LOWER(LTRIM(RTRIM(COALESCE(s.Topic,N''))))=LOWER(LTRIM(RTRIM(COALESCE(t.Topic,N'')))) THEN N'duplicate_session_assignment' ELSE N'instructor_overlap' END) IssueType,
  CONVERT(nvarchar(16),N'Conflict') Severity,
  CONVERT(nvarchar(max),CONCAT(CONVERT(varchar(16),CONVERT(binary(8),s.SchedulingVersion),2),N'|',CONVERT(varchar(16),CONVERT(binary(8),t.SchedulingVersion),2),N'|',a.AssignmentVersions,N'|',b.AssignmentVersions)) Evidence
 FROM assigned a JOIN assigned b ON b.FacultyId=a.FacultyId AND b.SessionId>a.SessionId
 JOIN paws.Session s ON s.SessionId=a.SessionId JOIN paws.Session t ON t.SessionId=b.SessionId
 WHERE s.AcademicYear=@AcademicYear AND t.AcademicYear=@AcademicYear AND s.SessionDate=t.SessionDate
 AND s.StartTime<s.EndTime AND t.StartTime<t.EndTime AND s.StartTime<t.EndTime AND t.StartTime<s.EndTime
), duplicateAssignments AS (
 SELECT a.FacultyId,s.SessionId,CAST(NULL AS uniqueidentifier) RelatedSessionId,N'duplicate_assignment' IssueType,N'Conflict' Severity,
 CONVERT(nvarchar(max),CONCAT(CONVERT(varchar(16),CONVERT(binary(8),s.SchedulingVersion),2),N'|',a.AssignmentVersions)) Evidence
 FROM assigned a JOIN paws.Session s ON s.SessionId=a.SessionId WHERE s.AcademicYear=@AcademicYear AND a.AssignmentCount>1
), quality AS (
 SELECT a.FacultyId,s.SessionId,CAST(NULL AS uniqueidentifier) RelatedSessionId,
 CASE WHEN s.StartTime IS NOT NULL AND s.EndTime IS NOT NULL AND s.StartTime>=s.EndTime THEN N'invalid_schedule' ELSE N'missing_schedule' END IssueType,N'Needs Review' Severity,
 CONVERT(nvarchar(max),CONCAT(CONVERT(varchar(16),CONVERT(binary(8),s.SchedulingVersion),2),N'|',a.AssignmentVersions)) Evidence
 FROM paws.Session s LEFT JOIN assigned a ON a.SessionId=s.SessionId
 WHERE s.AcademicYear=@AcademicYear AND (s.SessionDate IS NULL OR s.StartTime IS NULL OR s.EndTime IS NULL OR s.StartTime>=s.EndTime OR NULLIF(LTRIM(RTRIM(s.CourseCode)),N'') IS NULL OR a.FacultyId IS NULL)
 UNION ALL
 SELECT CAST(NULL AS uniqueidentifier),s.SessionId,CAST(NULL AS uniqueidentifier),N'missing_schedule',N'Needs Review',
 CONVERT(nvarchar(max),CONCAT(CONVERT(varchar(16),CONVERT(binary(8),s.SchedulingVersion),2),N'|',STRING_AGG(CONVERT(nvarchar(max),CONCAT(a.SessionAssignmentId,N':',CONVERT(varchar(16),CONVERT(binary(8),a.SchedulingVersion),2))),N'|') WITHIN GROUP(ORDER BY a.SessionAssignmentId)))
 FROM paws.Session s JOIN paws.SessionAssignment a ON a.SessionId=s.SessionId AND a.FacultyId IS NULL
 WHERE s.AcademicYear=@AcademicYear AND EXISTS(SELECT 1 FROM assigned own WHERE own.SessionId=s.SessionId)
 GROUP BY s.SessionId,s.SchedulingVersion
), absences AS (
 SELECT AfcRecordId,FacultyId,StartDate,EndDate,CONVERT(varchar(16),CONVERT(binary(8),AfcVersion),2) SourceVersion,N'import' SourceKind FROM paws.AfcRecord WHERE Active=1
 UNION ALL
 SELECT AfcRecordId,FacultyId,StartDate,EndDate,CONVERT(varchar(16),CONVERT(binary(8),AfcVersion),2),N'manual' FROM paws.AfcManualRecord WHERE Active=1
), afc AS (
 SELECT a.FacultyId,s.SessionId,CAST(NULL AS uniqueidentifier) RelatedSessionId,N'afc_unavailable' IssueType,N'Conflict' Severity,
 CONVERT(nvarchar(max),CONCAT(CONVERT(varchar(16),CONVERT(binary(8),s.SchedulingVersion),2),N'|',a.AssignmentVersions,N'|',STRING_AGG(CONVERT(nvarchar(max),CONCAT(x.SourceKind,N':',x.AfcRecordId,N':',x.SourceVersion)),N'|') WITHIN GROUP(ORDER BY x.SourceKind,x.AfcRecordId))) Evidence
 FROM assigned a JOIN paws.Session s ON s.SessionId=a.SessionId JOIN absences x ON x.FacultyId=a.FacultyId AND s.SessionDate BETWEEN x.StartDate AND x.EndDate
 WHERE s.AcademicYear=@AcademicYear GROUP BY a.FacultyId,s.SessionId,s.SchedulingVersion,a.AssignmentVersions
), activities AS (
 SELECT a.FacultyId,s.SessionId,CAST(NULL AS uniqueidentifier) RelatedSessionId,k.IssueType,
 CASE WHEN k.IssueType=N'calendar_time_unknown' THEN N'Needs Review' ELSE N'Conflict' END Severity,
 CONVERT(nvarchar(max),CONCAT(CONVERT(varchar(16),CONVERT(binary(8),s.SchedulingVersion),2),N'|',a.AssignmentVersions,N'|',STRING_AGG(CONVERT(nvarchar(max),CONCAT(x.ActivityId,N':',CONVERT(varchar(16),CONVERT(binary(8),x.ActivityVersion),2),N':',CONVERT(varchar(16),CONVERT(binary(8),t.TimeVersion),2))),N'|') WITHIN GROUP(ORDER BY x.ActivityId))) Evidence
 FROM assigned a JOIN paws.Session s ON s.SessionId=a.SessionId
 JOIN paws.CalendarActivity x ON x.FacultyId=a.FacultyId AND s.SessionDate BETWEEN x.StartDate AND x.EndDate
 LEFT JOIN paws.CalendarActivityDayTime t ON t.ActivityId=x.ActivityId AND t.ActivityDate=s.SessionDate
 CROSS APPLY(SELECT CASE WHEN t.ActivityId IS NULL THEN N'calendar_time_unknown' ELSE N'calendar_activity_overlap' END IssueType) k
 WHERE s.AcademicYear=@AcademicYear AND (t.ActivityId IS NULL OR s.StartTime<s.EndTime AND s.StartTime<t.EndTime AND t.StartTime<s.EndTime)
 GROUP BY a.FacultyId,s.SessionId,s.SchedulingVersion,a.AssignmentVersions,k.IssueType
), findings AS (
 SELECT * FROM pairs UNION ALL SELECT * FROM duplicateAssignments UNION ALL SELECT * FROM quality UNION ALL SELECT * FROM afc UNION ALL SELECT * FROM activities
)
SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),CONCAT(i.IssueType,N'|',i.SessionId,N'|',i.RelatedSessionId,N'|',i.FacultyId))),2) IssueKey,
 i.FacultyId,i.SessionId,i.RelatedSessionId,i.IssueType,i.Severity,
 CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),CONCAT(Evidence,N'|',CONVERT(varchar(16),CONVERT(binary(8),v.AssignmentVersion),2),N'|',CONVERT(varchar(16),CONVERT(binary(8),r.AssignmentVersion),2),N'|',allAssignments.Versions))),2) EvidenceVersion
FROM findings i
LEFT JOIN paws.SchedulingAssignmentRevision v ON v.SessionId=i.SessionId
LEFT JOIN paws.SchedulingAssignmentRevision r ON r.SessionId=i.RelatedSessionId
OUTER APPLY(SELECT STRING_AGG(CONVERT(nvarchar(max),CONCAT(a.SessionAssignmentId,N':',CONVERT(varchar(16),CONVERT(binary(8),a.SchedulingVersion),2))),N'|') WITHIN GROUP(ORDER BY a.SessionAssignmentId) Versions
 FROM paws.SessionAssignment a WHERE a.SessionId=i.SessionId OR a.SessionId=i.RelatedSessionId) allAssignments;
GO
CREATE PROCEDURE paws_api.ListSchedulingTasks @ActorFirebaseUid nvarchar(128),@QueryJson nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Role nvarchar(128),@Faculty uniqueidentifier,@Year nvarchar(32),@Start date,@End date,@Undated nvarchar(8),@Type nvarchar(40),@Status nvarchar(16),@Course nvarchar(32),@FacultyKey uniqueidentifier,@Limit int,@Cursor nvarchar(512),@Offset int=0;
 SELECT @Role=LOWER(LTRIM(RTRIM(BaseRole))),@Faculty=FacultyId FROM paws.UserProfile WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
 IF @Role IS NULL OR @Role NOT IN(N'owner',N'administrator',N'admin',N'adfa_general',N'adfa_regular',N'developer',N'adc',N'lab',N'faculty',N'hicc',N'visc')
  OR (@Role IN(N'faculty',N'hicc',N'visc') AND @Faculty IS NULL) THROW 54303,'Scheduling task access denied.',1;
 IF ISJSON(@QueryJson)<>1 OR LEFT(LTRIM(@QueryJson),1)<>N'{' THROW 54301,'Invalid scheduling task query.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@QueryJson) WHERE [key] NOT IN(N'academicYear',N'start',N'end',N'undated',N'facultyKey',N'courseCode',N'type',N'reviewStatus',N'cursor',N'limit') OR type NOT IN(1,2))
  OR EXISTS(SELECT [key] FROM OPENJSON(@QueryJson) GROUP BY [key] HAVING COUNT(*)>1) THROW 54301,'Invalid scheduling task fields.',1;
 SET @Year=JSON_VALUE(@QueryJson,'$.academicYear');
 IF @Year IS NULL OR LEN(LTRIM(RTRIM(@Year)))=0 OR LEN(JSON_VALUE(@QueryJson,'$.academicYear'))>32 THROW 54301,'Academic year is required.',1;
 SELECT @Start=TRY_CONVERT(date,JSON_VALUE(@QueryJson,'$.start'),23),@End=TRY_CONVERT(date,JSON_VALUE(@QueryJson,'$.end'),23),
 @Undated=COALESCE(JSON_VALUE(@QueryJson,'$.undated'),N'include'),@Type=JSON_VALUE(@QueryJson,'$.type'),@Status=JSON_VALUE(@QueryJson,'$.reviewStatus'),
 @Course=JSON_VALUE(@QueryJson,'$.courseCode'),@FacultyKey=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@QueryJson,'$.facultyKey')),
 @Limit=COALESCE(TRY_CONVERT(int,JSON_VALUE(@QueryJson,'$.limit')),50),@Cursor=JSON_VALUE(@QueryJson,'$.cursor');
 IF (@Start IS NULL AND JSON_VALUE(@QueryJson,'$.start') IS NOT NULL) OR (@End IS NULL AND JSON_VALUE(@QueryJson,'$.end') IS NOT NULL)
 OR (@Start IS NULL AND @End IS NOT NULL) OR (@Start IS NOT NULL AND @End IS NULL) OR @Start>=@End OR DATEDIFF(day,@Start,@End)>550
 OR (@Start IS NOT NULL AND (CONVERT(char(10),@Start,23)<>JSON_VALUE(@QueryJson,'$.start') OR CONVERT(char(10),@End,23)<>JSON_VALUE(@QueryJson,'$.end')))
 OR @Undated NOT IN(N'include',N'only',N'exclude') OR @Limit NOT BETWEEN 1 AND 100
 OR (JSON_VALUE(@QueryJson,'$.limit') IS NOT NULL AND TRY_CONVERT(int,JSON_VALUE(@QueryJson,'$.limit')) IS NULL)
 OR (JSON_VALUE(@QueryJson,'$.facultyKey') IS NOT NULL AND @FacultyKey IS NULL)
 OR LEN(JSON_VALUE(@QueryJson,'$.courseCode'))>32 OR LEN(JSON_VALUE(@QueryJson,'$.type'))>40 OR LEN(JSON_VALUE(@QueryJson,'$.reviewStatus'))>16
 OR (@Type IS NOT NULL AND @Type NOT IN(N'instructor_overlap',N'afc_unavailable',N'duplicate_assignment',N'duplicate_session_assignment',N'invalid_schedule',N'missing_schedule',N'calendar_activity_overlap',N'calendar_time_unknown'))
 OR (@Status IS NOT NULL AND @Status NOT IN(N'Unreviewed',N'Reviewed')) THROW 54301,'Invalid scheduling task filters.',1;
 SELECT i.*,c.CandidateKey FacultyKey,COALESCE(f.DisplayName,N'Not provided') DisplayName,s.CourseCode,s.SessionDate,s.StartTime,s.EndTime,
 CONVERT(nvarchar(16),CASE WHEN r.EvidenceVersion=i.EvidenceVersion THEN r.ReviewStatus ELSE N'Unreviewed' END) ReviewStatus,
 COALESCE(CONVERT(varchar(16),CONVERT(binary(8),r.ReviewVersion),2),'0000000000000000') ReviewVersion
 INTO #Issues FROM paws_api.SchedulingTaskIssues(@Year) i JOIN paws.Session s ON s.SessionId=i.SessionId
 LEFT JOIN paws.Faculty f ON f.FacultyId=i.FacultyId LEFT JOIN paws.SwapCandidate c ON c.FacultyId=i.FacultyId
 LEFT JOIN paws.SchedulingTaskReview r ON r.IssueKey=i.IssueKey
 WHERE @Role NOT IN(N'faculty',N'hicc',N'visc') OR i.FacultyId=@Faculty;
 DECLARE @Years nvarchar(max)=(SELECT DISTINCT s.AcademicYear academicYear FROM paws.Session s WHERE @Role NOT IN(N'faculty',N'hicc',N'visc') OR EXISTS(SELECT 1 FROM paws.SessionAssignment a WHERE a.SessionId=s.SessionId AND a.FacultyId=@Faculty) ORDER BY s.AcademicYear DESC FOR JSON PATH);
 DECLARE @Snapshot varchar(64)=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),CONCAT(@ActorFirebaseUid,N'|',@Role,N'|',@Faculty,N'|',@Year,N'|',@Start,N'|',@End,N'|',@Undated,N'|',@Type,N'|',@Status,N'|',@Course,N'|',@FacultyKey,N'|',@Limit,N'|',@Years,N'|',(SELECT * FROM #Issues ORDER BY IssueKey FOR JSON PATH,INCLUDE_NULL_VALUES)))),2);
 IF @Cursor IS NOT NULL
 BEGIN
  SET @Offset=TRY_CONVERT(int,SUBSTRING(@Cursor,66,20));
  IF LEFT(@Cursor,65)<>@Snapshot+':' OR @Offset IS NULL OR @Offset<1 OR LEN(@Cursor)>85 THROW 54310,'Scheduling tasks changed; refresh the queue.',1;
 END;
 SELECT *,ROW_NUMBER() OVER(ORDER BY CASE Severity WHEN N'Conflict' THEN 0 ELSE 1 END,SessionDate,IssueKey) Position INTO #Filtered FROM #Issues
 WHERE (@FacultyKey IS NULL OR FacultyKey=@FacultyKey) AND (@Course IS NULL OR CourseCode=@Course OR EXISTS(SELECT 1 FROM paws.Session related WHERE related.SessionId=#Issues.RelatedSessionId AND related.CourseCode=@Course)) AND (@Type IS NULL OR IssueType=@Type) AND (@Status IS NULL OR ReviewStatus=@Status)
 AND ((SessionDate IS NULL AND @Undated<>N'exclude') OR (SessionDate IS NOT NULL AND @Undated<>N'only' AND (@Start IS NULL OR SessionDate>=@Start AND SessionDate<@End)));
 DECLARE @Total int=(SELECT COUNT(*) FROM #Filtered);
 IF @Cursor IS NOT NULL AND @Offset>=@Total THROW 54310,'Scheduling tasks changed; refresh the queue.',1;
 SELECT (SELECT @Total total,@Snapshot snapshotVersion,
 CASE WHEN @Offset+@Limit<@Total THEN CONCAT(@Snapshot,':',@Offset+@Limit) END nextCursor,
 JSON_QUERY(@Years) academicYears,JSON_QUERY((SELECT CAST(IIF(@Role IN(N'owner',N'administrator',N'admin',N'adfa_general',N'adfa_regular',N'developer'),1,0) AS bit) canReview FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) capabilities,
 JSON_QUERY((SELECT JSON_QUERY((SELECT DISTINCT FacultyKey facultyKey,DisplayName displayName FROM #Issues WHERE FacultyKey IS NOT NULL FOR JSON PATH)) faculty,
 JSON_QUERY((SELECT courseCode FROM (SELECT CourseCode courseCode FROM #Issues WHERE CourseCode IS NOT NULL UNION SELECT s.CourseCode FROM #Issues i JOIN paws.Session s ON s.SessionId=i.RelatedSessionId WHERE s.CourseCode IS NOT NULL) courses FOR JSON PATH)) courses FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) filters,
 JSON_QUERY((SELECT i.IssueKey issueKey,i.FacultyKey facultyKey,i.DisplayName displayName,i.CourseCode courseCode,
  i.SessionId sessionId,i.SessionDate date,CONVERT(char(5),i.StartTime,108) startTime,CONVERT(char(5),i.EndTime,108) endTime,
  i.IssueType type,i.Severity severity,i.ReviewStatus reviewStatus,i.EvidenceVersion evidenceVersion,i.ReviewVersion reviewVersion,
  CAST(IIF(@Role IN(N'owner',N'administrator',N'admin',N'adfa_general',N'adfa_regular',N'developer'),1,0) AS bit) canReview,
  JSON_QUERY((SELECT t.SessionId id,t.CourseCode courseCode,t.SessionDate date,CONVERT(char(5),t.StartTime,108) startTime,CONVERT(char(5),t.EndTime,108) endTime
   FROM paws.Session t WHERE t.SessionId=i.RelatedSessionId FOR JSON PATH,INCLUDE_NULL_VALUES)) relatedSessions
 FROM #Filtered i WHERE Position>@Offset AND Position<=@Offset+@Limit ORDER BY Position FOR JSON PATH,INCLUDE_NULL_VALUES)) tasks
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
END;
GO
CREATE PROCEDURE paws_api.ReviewSchedulingTask
 @ActorFirebaseUid nvarchar(128),@IssueKey varchar(64),@AcademicYear nvarchar(32),
 @ExpectedEvidenceVersion varchar(64),@ExpectedReviewVersion varchar(16),@ReviewStatus nvarchar(16)
AS
BEGIN
 SET NOCOUNT ON;
 SET XACT_ABORT ON;
 DECLARE @Role nvarchar(128),@ActorName nvarchar(260),@CurrentEvidence varchar(64),@CurrentReview varchar(16),@Before nvarchar(16),@Response nvarchar(max),@Locks bigint;
 BEGIN TRY
  BEGIN TRANSACTION;
  SELECT @Role=LOWER(LTRIM(RTRIM(BaseRole))),@ActorName=DisplayName FROM paws.UserProfile WITH(UPDLOCK,HOLDLOCK)
  WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
  IF @Role IS NULL OR @Role NOT IN(N'owner',N'administrator',N'admin',N'adfa_general',N'adfa_regular',N'developer') THROW 54303,'Scheduling review requires administrator permission.',1;
  IF @ReviewStatus IS NULL OR @ReviewStatus NOT IN(N'Unreviewed',N'Reviewed') OR @IssueKey IS NULL OR LEN(@IssueKey)<>64 OR @AcademicYear IS NULL OR LEN(LTRIM(RTRIM(@AcademicYear)))=0
   OR @ExpectedEvidenceVersion IS NULL OR LEN(@ExpectedEvidenceVersion)<>64 OR @ExpectedReviewVersion IS NULL OR LEN(@ExpectedReviewVersion)<>16 THROW 54301,'Invalid scheduling review command.',1;
  -- Protect source ranges including absent rows, not just the finding currently displayed.
  SELECT @Locks=COUNT_BIG(*) FROM paws.Session WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@AcademicYear;
  SELECT @Locks=COUNT_BIG(*) FROM paws.SessionAssignment a WITH(UPDLOCK,HOLDLOCK) JOIN paws.Session s ON s.SessionId=a.SessionId WHERE s.AcademicYear=@AcademicYear;
  SELECT DISTINCT a.FacultyId INTO #Faculty FROM paws.SessionAssignment a JOIN paws.Session s ON s.SessionId=a.SessionId WHERE s.AcademicYear=@AcademicYear AND a.FacultyId IS NOT NULL;
  SELECT @Locks=COUNT_BIG(*) FROM paws.AfcRecord WITH(UPDLOCK,HOLDLOCK) WHERE FacultyId IN(SELECT FacultyId FROM #Faculty);
  SELECT @Locks=COUNT_BIG(*) FROM paws.AfcManualRecord WITH(UPDLOCK,HOLDLOCK) WHERE FacultyId IN(SELECT FacultyId FROM #Faculty);
  SELECT @Locks=COUNT_BIG(*) FROM paws.CalendarActivity WITH(UPDLOCK,HOLDLOCK) WHERE FacultyId IN(SELECT FacultyId FROM #Faculty);
  SELECT @Locks=COUNT_BIG(*) FROM paws.CalendarActivityDayTime WITH(UPDLOCK,HOLDLOCK) WHERE ActivityId IN(SELECT ActivityId FROM paws.CalendarActivity WHERE FacultyId IN(SELECT FacultyId FROM #Faculty));
  SELECT * INTO #CurrentIssue FROM paws_api.SchedulingTaskIssues(@AcademicYear) WHERE IssueKey=@IssueKey;
  SELECT @CurrentEvidence=EvidenceVersion FROM #CurrentIssue;
  SELECT @CurrentReview=CONVERT(varchar(16),CONVERT(binary(8),ReviewVersion),2),@Before=ReviewStatus FROM paws.SchedulingTaskReview WITH(UPDLOCK,HOLDLOCK) WHERE IssueKey=@IssueKey;
  SET @CurrentReview=COALESCE(@CurrentReview,'0000000000000000');
  IF @CurrentEvidence IS NULL OR @CurrentEvidence<>@ExpectedEvidenceVersion OR @CurrentReview<>@ExpectedReviewVersion THROW 54310,'Scheduling task changed; refresh before reviewing.',1;
  IF @CurrentReview='0000000000000000'
   INSERT paws.SchedulingTaskReview(IssueKey,EvidenceVersion,ReviewStatus,ActorFirebaseUid) VALUES(@IssueKey,@CurrentEvidence,@ReviewStatus,@ActorFirebaseUid);
  ELSE UPDATE paws.SchedulingTaskReview SET EvidenceVersion=@CurrentEvidence,ReviewStatus=@ReviewStatus,ActorFirebaseUid=@ActorFirebaseUid,UpdatedAtUtc=SYSUTCDATETIME() WHERE IssueKey=@IssueKey;
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson)
  VALUES(NEWID(),N'SchedulingTaskReviewed',N'SchedulingTask',@IssueKey,@ActorFirebaseUid,@ActorName,SYSUTCDATETIME(),
   (SELECT @Before reviewStatus FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES),
   (SELECT @ReviewStatus reviewStatus,@CurrentEvidence evidenceVersion FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  SELECT @Response=(SELECT i.IssueKey issueKey,c.CandidateKey facultyKey,COALESCE(f.DisplayName,N'Not provided') displayName,s.CourseCode courseCode,
   i.SessionId sessionId,s.SessionDate date,CONVERT(char(5),s.StartTime,108) startTime,CONVERT(char(5),s.EndTime,108) endTime,
   i.IssueType type,i.Severity severity,r.ReviewStatus reviewStatus,i.EvidenceVersion evidenceVersion,CONVERT(varchar(16),CONVERT(binary(8),r.ReviewVersion),2) reviewVersion,CAST(1 AS bit) canReview,
   JSON_QUERY((SELECT t.SessionId id,t.CourseCode courseCode,t.SessionDate date,CONVERT(char(5),t.StartTime,108) startTime,CONVERT(char(5),t.EndTime,108) endTime FROM paws.Session t WHERE t.SessionId=i.RelatedSessionId FOR JSON PATH,INCLUDE_NULL_VALUES)) relatedSessions
   FROM #CurrentIssue i JOIN paws.SchedulingTaskReview r ON r.IssueKey=i.IssueKey JOIN paws.Session s ON s.SessionId=i.SessionId
   LEFT JOIN paws.Faculty f ON f.FacultyId=i.FacultyId LEFT JOIN paws.SwapCandidate c ON c.FacultyId=i.FacultyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
  COMMIT;
  SELECT @Response responseJson;
 END TRY
 BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK;
  THROW;
 END CATCH;
END;
GO
IF DATABASE_PRINCIPAL_ID(N'paws_scheduling_task_review') IS NOT NULL THROW 54300,'Inspect the existing scheduling review role.',1;
CREATE ROLE paws_scheduling_task_review AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::paws_api.ListSchedulingTasks TO paws_runtime_read;
GRANT EXECUTE ON OBJECT::paws_api.ReviewSchedulingTask TO paws_scheduling_task_review;
GO
COMMIT;
