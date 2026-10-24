/* Existing 030 state machine plus activity availability and revision snapshots. */
:ON ERROR EXIT
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws.CalendarActivity') IS NULL OR OBJECT_ID(N'paws.SwapRevision') IS NULL THROW 53800,'Calendar and SWAP foundations are required.',1;
IF OBJECT_ID(N'paws.SwapCalendarActivitySnapshot') IS NOT NULL THROW 53800,'Inspect existing activity SWAP objects before applying.',1;
BEGIN TRANSACTION;
GO
CREATE TABLE paws.SwapCalendarActivitySnapshot(
 RequestId uniqueidentifier NOT NULL,Revision int NOT NULL,FacultyId uniqueidentifier NOT NULL REFERENCES paws.Faculty(FacultyId),
 ProposedDate date NOT NULL,ProposedStart time(0) NOT NULL,ProposedEnd time(0) NOT NULL,ActivityDigest binary(32) NOT NULL,
 PRIMARY KEY(RequestId,Revision,FacultyId),FOREIGN KEY(RequestId,Revision) REFERENCES paws.SwapRevision(RequestId,Revision),
 CHECK(ProposedStart<ProposedEnd)
);
GO
CREATE FUNCTION paws_api.CalendarActivityAvailability(@FacultyId uniqueidentifier,@Date date,@StartTime time(0),@EndTime time(0),@ExcludeSessionId uniqueidentifier=NULL) RETURNS nvarchar(16)
AS
BEGIN
 IF @FacultyId IS NULL OR @Date IS NULL OR @StartTime IS NULL OR @EndTime IS NULL OR @StartTime>=@EndTime
  OR NOT EXISTS(SELECT 1 FROM paws.Faculty WHERE FacultyId=@FacultyId AND Active=1) RETURN N'Unavailable';
 -- Unverified working time must not be hidden by a separately overridable known conflict.
 IF EXISTS(SELECT 1 FROM paws.CalendarActivity a WHERE a.FacultyId=@FacultyId AND @Date BETWEEN a.StartDate AND a.EndDate
  AND NOT EXISTS(SELECT 1 FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId AND t.ActivityDate=@Date)) RETURN N'Needs Review';
 IF EXISTS(SELECT 1 FROM paws.vAfcRecordUnified WHERE FacultyId=@FacultyId AND Active=1 AND @Date BETWEEN StartDate AND EndDate) RETURN N'Unavailable';
 IF EXISTS(SELECT 1 FROM paws.SessionAssignment a JOIN paws.Session s ON s.SessionId=a.SessionId WHERE a.FacultyId=@FacultyId AND (@ExcludeSessionId IS NULL OR s.SessionId<>@ExcludeSessionId)
  AND (s.SessionDate IS NULL OR s.SessionDate=@Date AND (s.StartTime IS NULL OR s.EndTime IS NULL OR s.StartTime>=s.EndTime OR s.StartTime<@EndTime AND s.EndTime>@StartTime))) RETURN N'Unavailable';
 IF EXISTS(SELECT 1 FROM paws.CalendarActivity a JOIN paws.CalendarActivityDayTime t ON t.ActivityId=a.ActivityId AND t.ActivityDate=@Date
  WHERE a.FacultyId=@FacultyId AND @Date BETWEEN a.StartDate AND a.EndDate AND t.StartTime<@EndTime AND t.EndTime>@StartTime) RETURN N'Unavailable';
 RETURN N'Available';
END;
GO
CREATE FUNCTION paws_api.CalendarActivityVersionDigest(@FacultyId uniqueidentifier,@Date date,@StartTime time(0),@EndTime time(0)) RETURNS binary(32)
AS
BEGIN
 DECLARE @State nvarchar(max)=(SELECT a.ActivityId,a.StartDate,a.EndDate,CONVERT(varchar(16),CONVERT(binary(8),a.ActivityVersion),2) activityVersion,
  t.ActivityDate,t.StartTime,t.EndTime,CONVERT(varchar(16),CONVERT(binary(8),t.TimeVersion),2) timeVersion
  FROM paws.CalendarActivity a LEFT JOIN paws.CalendarActivityDayTime t ON t.ActivityId=a.ActivityId AND t.ActivityDate=@Date
  WHERE a.FacultyId=@FacultyId AND @Date BETWEEN a.StartDate AND a.EndDate ORDER BY a.ActivityId FOR JSON PATH,INCLUDE_NULL_VALUES);
 RETURN HASHBYTES('SHA2_256',CONCAT(CONVERT(char(36),@FacultyId),N'|',CONVERT(char(10),@Date,23),N'|',CONVERT(char(8),@StartTime,108),N'|',CONVERT(char(8),@EndTime,108),N'|',COALESCE(@State,N'[]')));
END;
GO

CREATE OR ALTER PROCEDURE paws_api.GetSessionSwapContext @SessionId uniqueidentifier,@ActorFirebaseUid nvarchar(128) AS
BEGIN
 SET NOCOUNT ON;
 IF paws_api.CanActOnSessionSwap(@SessionId,@ActorFirebaseUid,N'read')<>1 THROW 53003,'Session is outside your SWAP scope.',1;
 DECLARE @Snapshot nvarchar(max)=paws_api.SessionSwapSnapshot(@SessionId),@Role nvarchar(128),@Faculty uniqueidentifier,@Type nvarchar(128),@Date date,@Start time(0),@End time(0);
 SELECT @Role=LOWER(BaseRole),@Faculty=FacultyId FROM paws.UserProfile WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
 SELECT @Type=SessionType,@Date=SessionDate,@Start=StartTime,@End=EndTime FROM paws.Session WHERE SessionId=@SessionId;
 SELECT (SELECT JSON_QUERY((SELECT s.SessionId sessionId,s.AcademicYear academicYear,s.CurriculumYear curriculumYear,s.CourseCode courseCode,s.CourseName courseName,s.SessionType sessionType,CONVERT(varchar(10),s.SessionDate,23) date,CONVERT(varchar(8),s.StartTime,108) startTime,CONVERT(varchar(8),s.EndTime,108) endTime,s.Topic topic,s.Room room,CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),@Snapshot)),2) snapshotToken FROM paws.Session s WHERE s.SessionId=@SessionId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) session,
 JSON_QUERY((SELECT a.SessionAssignmentId assignmentId,c.CandidateKey candidateKey,REPLACE(COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName,a.SourceFacultyName),N',',N'') displayName,CAST(IIF(a.FacultyId IS NOT NULL AND (a.FacultyId=@Faculty OR paws_api.CanActOnSessionSwap(@SessionId,@ActorFirebaseUid,N'visc')=1 OR paws_api.CanActOnSessionSwap(@SessionId,@ActorFirebaseUid,N'adfa')=1 OR @Role IN(N'adc',N'lab')),1,0) AS bit) canReplace FROM paws.SessionAssignment a LEFT JOIN paws.Faculty f ON f.FacultyId=a.FacultyId LEFT JOIN paws.SwapCandidate c ON c.FacultyId=a.FacultyId WHERE a.SessionId=@SessionId FOR JSON PATH)) assignments,
 JSON_QUERY((SELECT c.CandidateKey candidateKey,REPLACE(COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName),N',',N'') displayName,
 paws_api.CalendarActivityAvailability(f.FacultyId,@Date,@Start,@End,@SessionId) availabilityStatus,
 CAST(IIF(paws_api.CalendarActivityAvailability(f.FacultyId,@Date,@Start,@End,@SessionId)=N'Available',1,0) AS bit) available,
 CAST(IIF((SELECT COUNT(*) FROM paws.UserProfile u WHERE u.FacultyId=f.FacultyId AND u.Active=1 AND u.MustChangePassword=0)=1,1,0) AS bit) notifyAvailable,
 CASE WHEN (SELECT COUNT(*) FROM paws.UserProfile u WHERE u.FacultyId=f.FacultyId AND u.Active=1 AND u.MustChangePassword=0)<>1 THEN N'One active linked account is required.' END notifyUnavailableReason FROM paws.SwapCandidate c JOIN paws.Faculty f ON f.FacultyId=c.FacultyId AND f.Active=1 WHERE NOT EXISTS(SELECT 1 FROM paws.SessionAssignment a WHERE a.SessionId=@SessionId AND a.FacultyId=f.FacultyId) FOR JSON PATH,INCLUDE_NULL_VALUES)) candidates,
 JSON_QUERY((SELECT v.[key],CAST(paws_api.CanEditSessionSwapField(@SessionId,@ActorFirebaseUid,v.[key],@Type) AS bit) editable,v.office,CASE WHEN paws_api.CanActOnSessionSwap(@SessionId,@ActorFirebaseUid,v.office)=0 AND paws_api.CanActOnSessionSwap(@SessionId,@ActorFirebaseUid,N'adfa')=0 AND v.[key]<>N'replacementCandidateKey' THEN CONCAT(N'Only ',UPPER(v.office),N' may revise this field.') END reason FROM (VALUES(N'replacementCandidateKey',N'adfa'),(N'courseCode',N'adc'),(N'date',N'adc'),(N'startTime',N'adc'),(N'endTime',N'adc'),(N'sessionType',N'adc'),(N'room',N'adc'),(N'topic',CASE WHEN @Type=N'LAB' THEN N'lab' ELSE N'adc' END))v([key],office) FOR JSON PATH,INCLUDE_NULL_VALUES)) fields,
 JSON_QUERY((SELECT JSON_QUERY((SELECT CourseCode courseCode,CourseName courseName FROM paws.Course ORDER BY CourseCode FOR JSON PATH)) courses,JSON_QUERY(N'["LEC","LAB","SRL","Quiz/Midterm","OSCE","Exam"]') sessionTypes FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) options,
 CAST(1 AS bit) canCreate,JSON_QUERY((SELECT reason FROM (VALUES (CASE WHEN NOT EXISTS(SELECT 1 FROM paws.UserProfile WHERE Active=1 AND MustChangePassword=0 AND LOWER(BaseRole)=N'adc') THEN N'No ADC/DVM reviewer is assigned for schedule changes.' END),(CASE WHEN NOT EXISTS(SELECT 1 FROM paws.UserProfile WHERE Active=1 AND MustChangePassword=0 AND LOWER(BaseRole)=N'lab') THEN N'No LAB reviewer is assigned for LAB topic changes.' END),(CASE WHEN NOT EXISTS(SELECT 1 FROM paws.UserProfile u WHERE u.Active=1 AND u.MustChangePassword=0 AND paws_api.CanActOnSessionSwap(@SessionId,u.FirebaseUid,N'visc')=1) THEN N'No scoped VISC reviewer: an unnotified faculty suggestion cannot be routed.' END)) missing(reason) WHERE reason IS NOT NULL FOR JSON PATH)) unavailableReasons,
 JSON_QUERY((SELECT stage,available FROM (SELECT N'visc' stage,CAST(IIF(EXISTS(SELECT 1 FROM paws.TeachingSessionOwnership o JOIN paws.UserProfile u ON u.Active=1 AND u.MustChangePassword=0 WHERE o.SessionId=@SessionId AND paws_api.CanActOnTeachingAssignmentPackage(o.TeachingAssignmentPackageId,u.FirebaseUid,N'visc')=1),1,0) AS bit) available UNION ALL SELECT N'adc',CAST(IIF(EXISTS(SELECT 1 FROM paws.UserProfile WHERE Active=1 AND MustChangePassword=0 AND LOWER(BaseRole)=N'adc'),1,0) AS bit) UNION ALL SELECT N'lab',CAST(IIF(EXISTS(SELECT 1 FROM paws.UserProfile WHERE Active=1 AND MustChangePassword=0 AND LOWER(BaseRole)=N'lab'),1,0) AS bit) ) routed FOR JSON PATH)) routing
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
END;
GO
CREATE OR ALTER PROCEDURE paws_api.SaveSessionSwap @ActorFirebaseUid nvarchar(128),@PayloadJson nvarchar(max),@Revise bit=0 AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISJSON(@PayloadJson)<>1 THROW 53001,'Invalid request JSON.',1;
 DECLARE @Id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.requestId')),@Session uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.sessionId')),
 @Assignment uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.assignmentId')),@Expected int=TRY_CONVERT(int,JSON_VALUE(@PayloadJson,'$.expectedRevision')),
 @Changes nvarchar(max)=JSON_QUERY(@PayloadJson,'$.changes'),@Notify bit=IIF(JSON_VALUE(@PayloadJson,'$.notifyReplacement')=N'true',1,0),@Note nvarchar(2000)=JSON_VALUE(@PayloadJson,'$.note'),
 @Snapshot nvarchar(max),@Hash varchar(64),@OldRevision int,@OldStatus nvarchar(32),@Creator nvarchar(128),@Role nvarchar(128),@OriginRole nvarchar(128),@OldChanges nvarchar(max)=N'{}',@Faculty uniqueidentifier,@Target uniqueidentifier,@TargetUid nvarchar(128),
 @Adc bit=0,@Lab bit=0,@Visc bit=0,@Stage nvarchar(16),@CurrentType nvarchar(128),@Date date,@Start time,@End time,@Course nvarchar(32),@Type nvarchar(128),@Topic nvarchar(4000),@Room nvarchar(256),@Validation nvarchar(max),@Incoming uniqueidentifier;
 SELECT @Role=LOWER(LTRIM(RTRIM(BaseRole))),@Faculty=FacultyId FROM paws.UserProfile WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
 IF @Role IS NULL THROW 53003,'Active SQL profile required.',1;
 IF @Id IS NULL OR ISJSON(@Changes)<>1 OR NOT EXISTS(SELECT 1 FROM OPENJSON(@Changes)) OR EXISTS(SELECT 1 FROM OPENJSON(@Changes) WHERE [key] NOT IN(N'replacementCandidateKey',N'courseCode',N'date',N'startTime',N'endTime',N'sessionType',N'room',N'topic') OR type<>1) OR EXISTS(SELECT [key] FROM OPENJSON(@Changes) GROUP BY [key] HAVING COUNT(*)>1) THROW 53001,'Unsupported change fields.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF @Revise=1
 BEGIN
  SELECT @Session=SessionId,@Creator=CreatorUid,@OldRevision=Revision,@OldStatus=Status,@Snapshot=SnapshotJson,@Hash=SnapshotToken,@OriginRole=CreatorRole,@OldChanges=ChangesJson FROM paws.SwapRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@Id;
  IF @Session IS NULL THROW 53004,'Request not found.',1;
  IF @Expected<>@OldRevision OR @Expected IS NULL THROW 53009,'Revision changed; reload before revising.',1;
  IF @OldStatus NOT IN(N'pending',N'changes_requested') THROW 53011,'Request is closed.',1;
  IF @Creator<>@ActorFirebaseUid AND paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'visc')=0 AND paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'adfa')=0 AND @Role NOT IN(N'adc',N'lab') THROW 53003,'Revision is outside your authority.',1;
 END;
 IF paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'read')=0 THROW 53003,'Session is outside your scope.',1;
 IF @Revise=0 AND EXISTS(SELECT 1 FROM paws.SwapRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@Id)
 BEGIN
  IF EXISTS(SELECT 1 FROM paws.SwapRequest WHERE RequestId=@Id AND CreatorUid=@ActorFirebaseUid AND SessionId=@Session AND ISNULL(AssignmentId,'00000000-0000-0000-0000-000000000000')=ISNULL(@Assignment,'00000000-0000-0000-0000-000000000000') AND EXISTS(SELECT 1 FROM paws.SwapRevision v WHERE v.RequestId=@Id AND v.Revision=1 AND v.PayloadJson COLLATE Latin1_General_100_BIN2=@PayloadJson COLLATE Latin1_General_100_BIN2)) BEGIN COMMIT;EXEC paws_api.GetSessionSwap @Id,@ActorFirebaseUid;RETURN;END;
  THROW 53009,'Request identifier already used with different content.',1;
 END;
 -- Lock the full canonical facts before snapshotting and reject updates to any source line.
 SELECT @Incoming=SessionId FROM paws.Session WITH(UPDLOCK,HOLDLOCK) WHERE SessionId=@Session;
 SELECT @Incoming=SessionAssignmentId FROM paws.SessionAssignment WITH(UPDLOCK,HOLDLOCK) WHERE SessionId=@Session;
 IF @Revise=0 BEGIN SET @Snapshot=paws_api.SessionSwapSnapshot(@Session);SET @Hash=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),@Snapshot)),2);IF @Hash<>JSON_VALUE(@PayloadJson,'$.snapshotToken') THROW 53010,'Session changed; reload before requesting.',1;END;
 IF @Hash<>CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),paws_api.SessionSwapSnapshot(@Session))),2) THROW 53010,'Session changed; withdraw and recreate the request.',1;
 SELECT @Date=SessionDate,@Start=StartTime,@End=EndTime,@Course=CourseCode,@Type=SessionType,@CurrentType=SessionType,@Topic=Topic,@Room=Room FROM paws.Session WHERE SessionId=@Session;
 IF TRY_CONVERT(time,JSON_VALUE(@Changes,'$.startTime'))=@Start AND TRY_CONVERT(time,JSON_VALUE(@Changes,'$.endTime'))=@End BEGIN SET @Changes=JSON_MODIFY(JSON_MODIFY(@Changes,'$.startTime',NULL),'$.endTime',NULL); END;
 IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Changes)) THROW 53001,'The request does not change the session.',1;
 IF JSON_VALUE(@Changes,'$.replacementCandidateKey') IS NOT NULL
 BEGIN
  SELECT @Target=c.FacultyId FROM paws.SwapCandidate c JOIN paws.Faculty f ON f.FacultyId=c.FacultyId AND f.Active=1 WHERE c.CandidateKey=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@Changes,'$.replacementCandidateKey'));
  IF @Target IS NULL OR NOT EXISTS(SELECT 1 FROM paws.SessionAssignment WHERE SessionAssignmentId=@Assignment AND SessionId=@Session AND FacultyId IS NOT NULL AND FacultyResolutionStatus=N'resolved') OR EXISTS(SELECT 1 FROM paws.SessionAssignment WHERE SessionId=@Session AND FacultyId=@Target) THROW 53001,'Replacement and outgoing assignment must be distinct resolved canonical records.',1;
  IF paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'visc')=0 AND paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'adfa')=0 AND @Role NOT IN(N'adc',N'lab') AND (@Role NOT IN(N'faculty',N'hicc',N'visc') OR NOT EXISTS(SELECT 1 FROM paws.SessionAssignment WHERE SessionAssignmentId=@Assignment AND FacultyId=@Faculty)) THROW 53003,'Faculty may replace only their own assignment.',1;
  IF EXISTS(SELECT 1 FROM paws.Faculty WHERE FacultyId=@Target AND LOWER(RecordType) IN(N'sessional',N'other')) AND NULLIF(LTRIM(RTRIM(@Note)),N'') IS NULL THROW 53001,'Sessional / Other replacement requires a reason.',1;
 END ELSE IF @Notify=1 OR @Assignment IS NOT NULL THROW 53001,'Notification and outgoing assignment require a replacement.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Changes) WHERE [key] IN(N'courseCode',N'date',N'startTime',N'endTime',N'sessionType',N'room')) SET @Adc=1;
 IF JSON_VALUE(@Changes,'$.topic') IS NOT NULL BEGIN IF @CurrentType=N'LAB' OR JSON_VALUE(@Changes,'$.sessionType')=N'LAB' SET @Lab=1;ELSE SET @Adc=1;END;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Changes) n FULL JOIN OPENJSON(@OldChanges) old ON old.[key]=n.[key] WHERE (n.value IS NULL OR old.value IS NULL OR n.value<>old.value) AND paws_api.CanEditSessionSwapField(@Session,@ActorFirebaseUid,COALESCE(n.[key],old.[key]),CASE WHEN @CurrentType=N'LAB' OR JSON_VALUE(@Changes,'$.sessionType')=N'LAB' THEN N'LAB' ELSE @CurrentType END)=0) THROW 53003,'A changed field belongs to another office.',1;
 IF @Notify=1
 BEGIN
  IF (SELECT COUNT(*) FROM paws.UserProfile WHERE FacultyId=@Target AND Active=1 AND MustChangePassword=0)<>1 THROW 53001,'Notification requires exactly one active linked account.',1;
  SELECT @TargetUid=FirebaseUid FROM paws.UserProfile WHERE FacultyId=@Target AND Active=1 AND MustChangePassword=0;
 END;
 IF @Target IS NOT NULL AND @Notify=0 AND COALESCE(@OriginRole,@Role) IN(N'faculty',N'hicc',N'visc') SET @Visc=1;
 IF @Visc=1 AND NOT EXISTS(SELECT 1 FROM paws.UserProfile u WHERE u.Active=1 AND u.MustChangePassword=0 AND paws_api.CanActOnSessionSwap(@Session,u.FirebaseUid,N'visc')=1) THROW 53001,'No scoped VISC reviewer is assigned; request routing is unavailable.',1;
 IF @Adc=1 AND NOT EXISTS(SELECT 1 FROM paws.UserProfile WHERE Active=1 AND MustChangePassword=0 AND LOWER(BaseRole)=N'adc') THROW 53001,'No ADC reviewer is assigned; request routing is unavailable.',1;
 IF @Lab=1 AND NOT EXISTS(SELECT 1 FROM paws.UserProfile WHERE Active=1 AND MustChangePassword=0 AND LOWER(BaseRole)=N'lab') THROW 53001,'No LAB reviewer is assigned; request routing is unavailable.',1;
 IF NOT EXISTS(SELECT 1 FROM paws.UserProfile u WHERE u.Active=1 AND u.MustChangePassword=0 AND paws_api.CanActOnSessionSwap(@Session,u.FirebaseUid,N'adfa')=1) THROW 53001,'No ADFA reviewer is assigned.',1;
 SET @Date=COALESCE(TRY_CONVERT(date,JSON_VALUE(@Changes,'$.date'),23),@Date);SET @Start=COALESCE(TRY_CONVERT(time,JSON_VALUE(@Changes,'$.startTime')),@Start);SET @End=COALESCE(TRY_CONVERT(time,JSON_VALUE(@Changes,'$.endTime')),@End);SET @Course=COALESCE(JSON_VALUE(@Changes,'$.courseCode'),@Course);SET @Type=COALESCE(JSON_VALUE(@Changes,'$.sessionType'),@Type);SET @Topic=COALESCE(JSON_VALUE(@Changes,'$.topic'),@Topic);SET @Room=COALESCE(JSON_VALUE(@Changes,'$.room'),@Room);
 SELECT @Validation=(SELECT s.AcademicYear academicYear,s.CurriculumYear curriculumYear,@Course courseCode,@Type sessionType,CONVERT(varchar(10),@Date,23) date,CONVERT(varchar(8),@Start,108) startTime,CONVERT(varchar(8),@End,108) endTime,@Topic topic,@Room room FROM paws.Session s WHERE SessionId=@Session FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC paws_api.ValidateCalendarSessionJson @SessionJson=@Validation;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Changes) WHERE ([key]=N'date' AND TRY_CONVERT(date,value,23) IS NULL) OR ([key] IN(N'startTime',N'endTime') AND TRY_CONVERT(time,value) IS NULL)) THROW 53001,'Invalid proposed date/time.',1;
 IF EXISTS(SELECT 1 FROM paws.SessionAssignment a LEFT JOIN paws.Faculty f ON f.FacultyId=CASE WHEN a.SessionAssignmentId=@Assignment THEN @Target ELSE a.FacultyId END WHERE a.SessionId=@Session AND (f.FacultyId IS NULL OR f.Active<>1 OR a.FacultyResolutionStatus<>N'resolved')) THROW 53011,'Active resolved faculty identities are required.',1;
 DECLARE @ActivityFaculty TABLE(FacultyId uniqueidentifier NOT NULL PRIMARY KEY);
 INSERT @ActivityFaculty SELECT DISTINCT CASE WHEN SessionAssignmentId=@Assignment THEN @Target ELSE FacultyId END FROM paws.SessionAssignment WHERE SessionId=@Session;
 DECLARE @ActivityFacultyJson nvarchar(max)=(SELECT COALESCE(CONCAT(N'[',STRING_AGG(CONVERT(nvarchar(max),CONCAT(N'"',CONVERT(char(36),FacultyId),N'"')),N','),N']'),N'[]') FROM @ActivityFaculty);
 EXEC paws_api.AcquireCalendarActivityFacultyLocks @ActivityFacultyJson;
 IF @Target IS NOT NULL AND paws_api.CalendarActivityAvailability(@Target,@Date,@Start,@End,@Session)=N'Needs Review' THROW 53011,'Replacement activity timing needs review; verify the time before saving.',1;
 SET @Stage=CASE WHEN @Notify=1 THEN N'target' WHEN @Visc=1 THEN N'visc' WHEN @Adc=1 THEN N'adc' WHEN @Lab=1 THEN N'lab' ELSE N'adfa' END;
 IF @Revise=0 INSERT paws.SwapRequest(RequestId,SessionId,AssignmentId,CreatorUid,CreatorRole,Revision,Status,NextStage,SnapshotJson,SnapshotToken,ChangesJson,TargetFacultyId,NotifyReplacement,Note,NeedsAdc,NeedsLab,NeedsVisc) VALUES(@Id,@Session,@Assignment,@ActorFirebaseUid,@Role,1,N'pending',@Stage,@Snapshot,@Hash,@Changes,@Target,@Notify,COALESCE(@Note,N''),@Adc,@Lab,@Visc);
 ELSE BEGIN UPDATE paws.SwapNotification SET Status=N'superseded' WHERE RequestId=@Id AND Status=N'pending';UPDATE paws.SwapRequest SET AssignmentId=@Assignment,Revision=Revision+1,Status=N'pending',NextStage=@Stage,ChangesJson=@Changes,TargetFacultyId=@Target,NotifyReplacement=@Notify,Note=COALESCE(@Note,N''),NeedsAdc=@Adc,NeedsLab=@Lab,NeedsVisc=@Visc,UpdatedAtUtc=SYSUTCDATETIME() WHERE RequestId=@Id;END;
 SELECT @OldRevision=Revision FROM paws.SwapRequest WHERE RequestId=@Id;
 INSERT paws.SwapRevision(RequestId,Revision,PayloadJson,ActorUid) VALUES(@Id,@OldRevision,@PayloadJson,@ActorFirebaseUid);
 INSERT paws.SwapCalendarActivitySnapshot(RequestId,Revision,FacultyId,ProposedDate,ProposedStart,ProposedEnd,ActivityDigest)
  SELECT @Id,@OldRevision,FacultyId,@Date,@Start,@End,paws_api.CalendarActivityVersionDigest(FacultyId,@Date,@Start,@End) FROM @ActivityFaculty;
 IF @Notify=1 INSERT paws.SwapNotification(RequestId,Revision,TargetUid,Status) VALUES(@Id,@OldRevision,@TargetUid,N'pending');
 INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,AfterJson,RequestId) VALUES(NEWID(),IIF(@Revise=1,N'swap_revised',N'swap_created'),N'session_swap',CONVERT(nvarchar(36),@Id),@ActorFirebaseUid,SYSUTCDATETIME(),@PayloadJson,@Id);
 COMMIT;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
 EXEC paws_api.GetSessionSwap @Id,@ActorFirebaseUid;
END;
GO
CREATE OR ALTER PROCEDURE paws_api.DecideSessionSwap @ActorFirebaseUid nvarchar(128),@RequestId uniqueidentifier,@ExpectedRevision int,@Decision nvarchar(32),@Comment nvarchar(2000)=NULL,@OverrideReason nvarchar(2000)=NULL,@ApplyEnabled bit=0 AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Session uniqueidentifier,@Assignment uniqueidentifier,@Target uniqueidentifier,@Revision int,@Stage nvarchar(16),@Status nvarchar(32),@Changes nvarchar(max),@Hash varchar(64),@Before nvarchar(max),@After nvarchar(max),@Lock uniqueidentifier,@Adc bit,@Lab bit,@Visc bit,@Next nvarchar(16),@Override bit=0,
 @Date date,@Start time,@End time,@Course nvarchar(32),@Type nvarchar(128),@Room nvarchar(256),@Duration decimal(12,4),@OldDuration decimal(12,4),@Blocked bit=0;
 IF @Decision NOT IN(N'approve',N'reject',N'push_back') OR (@Decision<>N'approve' AND NULLIF(LTRIM(RTRIM(@Comment)),N'') IS NULL) THROW 53001,'A valid decision and reason are required.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT @Session=SessionId,@Assignment=AssignmentId,@Target=TargetFacultyId,@Revision=Revision,@Stage=NextStage,@Status=Status,@Changes=ChangesJson,@Hash=SnapshotToken,@Adc=NeedsAdc,@Lab=NeedsLab,@Visc=NeedsVisc FROM paws.SwapRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@RequestId;
 IF @Session IS NULL THROW 53004,'Request not found.',1;
 IF @Revision<>@ExpectedRevision OR @ExpectedRevision IS NULL THROW 53009,'Revision changed; reload before deciding.',1;
 IF @Status<>N'pending' THROW 53011,'Request is not pending.',1;
 IF NULLIF(LTRIM(RTRIM(@OverrideReason)),N'') IS NOT NULL BEGIN IF paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'override')<>1 THROW 53003,'Only Owner/Developer may override with a recorded reason.',1;SET @Override=1;END;
 IF @Override=0 AND NOT ((@Stage=N'target' AND EXISTS(SELECT 1 FROM paws.SwapNotification n JOIN paws.UserProfile u ON u.FirebaseUid=n.TargetUid AND u.FacultyId=@Target AND u.Active=1 AND u.MustChangePassword=0 WHERE n.RequestId=@RequestId AND n.Revision=@Revision AND n.TargetUid=@ActorFirebaseUid AND n.Status=N'pending')) OR (@Stage<>N'target' AND paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,@Stage)=1)) THROW 53003,'This actor cannot decide the current stage.',1;
 -- Even privileged actors cannot fabricate target consent. Overrides are explicit office/conflict bypasses only.
 IF @Override=1 AND @Stage=N'target' THROW 53003,'Target consent must come from the linked replacement account.',1;
 SELECT @Lock=SessionId FROM paws.Session WITH(UPDLOCK,HOLDLOCK) WHERE SessionId=@Session;
 SELECT @Lock=SessionAssignmentId FROM paws.SessionAssignment WITH(UPDLOCK,HOLDLOCK) WHERE SessionId=@Session;
 SET @Before=paws_api.SessionSwapSnapshot(@Session);
 IF @Hash<>CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),@Before)),2) THROW 53010,'Canonical session or assignment source changed; withdraw and recreate.',1;
 IF @Stage=N'target' UPDATE paws.SwapNotification SET Status=CASE @Decision WHEN N'approve' THEN N'accepted' WHEN N'reject' THEN N'rejected' ELSE N'changes_requested' END WHERE RequestId=@RequestId AND Revision=@Revision;
 IF @Decision<>N'approve'
 BEGIN
  INSERT paws.SwapDecision(RequestId,Revision,Stage,Decision,Comment,OverrideReason,ActorUid) VALUES(@RequestId,@Revision,@Stage,@Decision,@Comment,@OverrideReason,@ActorFirebaseUid);
  UPDATE paws.SwapRequest SET Status=IIF(@Decision=N'reject',N'rejected',N'changes_requested'),NextStage=NULL,UpdatedAtUtc=SYSUTCDATETIME() WHERE RequestId=@RequestId;
  UPDATE paws.SwapNotification SET Status=N'closed' WHERE RequestId=@RequestId AND Revision=@Revision AND Status=N'pending';
 END
 ELSE
 BEGIN
  SET @Next=CASE WHEN @Stage=N'target' AND @Visc=1 THEN N'visc' WHEN @Stage IN(N'target',N'visc') AND @Adc=1 THEN N'adc' WHEN @Stage IN(N'target',N'visc',N'adc') AND @Lab=1 THEN N'lab' WHEN @Stage<>N'adfa' THEN N'adfa' END;
  IF @Override=1 SET @Next=NULL;
  IF @Next IS NULL
  BEGIN
   IF @ApplyEnabled<>1 THROW 53001,'Final SWAP application is disabled.',1;
   -- Serializable range checks protect target availability and all untouched co-instructors.
   SELECT @Date=COALESCE(TRY_CONVERT(date,JSON_VALUE(@Changes,'$.date'),23),SessionDate),@Start=COALESCE(TRY_CONVERT(time,JSON_VALUE(@Changes,'$.startTime')),StartTime),@End=COALESCE(TRY_CONVERT(time,JSON_VALUE(@Changes,'$.endTime')),EndTime),@Course=COALESCE(JSON_VALUE(@Changes,'$.courseCode'),CourseCode),@Type=COALESCE(JSON_VALUE(@Changes,'$.sessionType'),SessionType),@Room=COALESCE(JSON_VALUE(@Changes,'$.room'),Room),@OldDuration=CONVERT(decimal(12,4),DATEDIFF(second,StartTime,EndTime)/3600.0) FROM paws.Session WHERE SessionId=@Session;
   SET @Duration=CONVERT(decimal(12,4),DATEDIFF(second,@Start,@End)/3600.0);
   IF @Date IS NULL OR @Start IS NULL OR @End IS NULL OR @Start>=@End THROW 53011,'Application requires a known valid session date and time.',1;
   DECLARE @ActivityFaculty TABLE(FacultyId uniqueidentifier NOT NULL PRIMARY KEY);
   IF EXISTS(SELECT 1 FROM paws.SessionAssignment WHERE SessionId=@Session AND CASE WHEN SessionAssignmentId=@Assignment THEN @Target ELSE FacultyId END IS NULL) THROW 53011,'Active resolved faculty identities are required.',1;
   INSERT @ActivityFaculty SELECT DISTINCT CASE WHEN SessionAssignmentId=@Assignment THEN @Target ELSE FacultyId END FROM paws.SessionAssignment WHERE SessionId=@Session;
   DECLARE @ActivityFacultyJson nvarchar(max)=(SELECT COALESCE(CONCAT(N'[',STRING_AGG(CONVERT(nvarchar(max),CONCAT(N'"',CONVERT(char(36),FacultyId),N'"')),N','),N']'),N'[]') FROM @ActivityFaculty);
   EXEC paws_api.AcquireCalendarActivityFacultyLocks @ActivityFacultyJson;
   DECLARE @ActivityLock uniqueidentifier;
   SELECT @ActivityLock=a.ActivityId FROM paws.CalendarActivity a WITH(UPDLOCK,HOLDLOCK) JOIN @ActivityFaculty f ON f.FacultyId=a.FacultyId WHERE @Date BETWEEN a.StartDate AND a.EndDate;
   SELECT @ActivityLock=t.ActivityId FROM paws.CalendarActivityDayTime t WITH(UPDLOCK,HOLDLOCK) JOIN paws.CalendarActivity a ON a.ActivityId=t.ActivityId JOIN @ActivityFaculty f ON f.FacultyId=a.FacultyId WHERE t.ActivityDate=@Date;
   IF EXISTS(SELECT 1 FROM @ActivityFaculty f WHERE NOT EXISTS(SELECT 1 FROM paws.SwapCalendarActivitySnapshot snapshot WITH(UPDLOCK,HOLDLOCK)
    WHERE snapshot.RequestId=@RequestId AND snapshot.Revision=@Revision AND snapshot.FacultyId=f.FacultyId AND snapshot.ProposedDate=@Date AND snapshot.ProposedStart=@Start AND snapshot.ProposedEnd=@End AND snapshot.ActivityDigest=paws_api.CalendarActivityVersionDigest(f.FacultyId,@Date,@Start,@End)))
    OR EXISTS(SELECT 1 FROM paws.SwapCalendarActivitySnapshot WHERE RequestId=@RequestId AND Revision=@Revision AND FacultyId NOT IN(SELECT FacultyId FROM @ActivityFaculty)) THROW 53010,'Calendar activity state changed or is not snapshotted; save a fresh revision.',1;
   IF EXISTS(SELECT 1 FROM @ActivityFaculty WHERE paws_api.CalendarActivityAvailability(FacultyId,@Date,@Start,@End,@Session)=N'Needs Review') THROW 53011,'Activity timing needs review; it cannot be overridden.',1;
   IF EXISTS(SELECT 1 FROM @ActivityFaculty WHERE paws_api.CalendarActivityAvailability(FacultyId,@Date,@Start,@End,@Session)=N'Unavailable') SET @Blocked=1;
   IF EXISTS(SELECT 1 FROM paws.SessionAssignment a LEFT JOIN paws.Faculty f WITH(UPDLOCK,HOLDLOCK) ON f.FacultyId=CASE WHEN a.SessionAssignmentId=@Assignment THEN @Target ELSE a.FacultyId END WHERE a.SessionId=@Session AND (f.FacultyId IS NULL OR f.Active=0 OR a.FacultyResolutionStatus<>N'resolved')) THROW 53011,'Application requires active resolved faculty identities.',1;
   IF @Target IS NOT NULL AND EXISTS(SELECT 1 FROM paws.SessionAssignment WITH(UPDLOCK,HOLDLOCK) WHERE SessionId=@Session AND FacultyId=@Target) THROW 53011,'Replacement is already assigned.',1;
   IF EXISTS(SELECT 1 FROM paws.SessionAssignment currentAssignment CROSS APPLY(SELECT CASE WHEN currentAssignment.SessionAssignmentId=@Assignment THEN @Target ELSE currentAssignment.FacultyId END FacultyId) candidate JOIN paws.AfcRecord af WITH(UPDLOCK,HOLDLOCK) ON af.FacultyId=candidate.FacultyId AND af.Active=1 AND @Date BETWEEN af.StartDate AND af.EndDate WHERE currentAssignment.SessionId=@Session)
    OR EXISTS(SELECT 1 FROM paws.SessionAssignment currentAssignment CROSS APPLY(SELECT CASE WHEN currentAssignment.SessionAssignmentId=@Assignment THEN @Target ELSE currentAssignment.FacultyId END FacultyId) candidate JOIN paws.AfcManualRecord af WITH(UPDLOCK,HOLDLOCK) ON af.FacultyId=candidate.FacultyId AND af.Active=1 AND @Date BETWEEN af.StartDate AND af.EndDate WHERE currentAssignment.SessionId=@Session) SET @Blocked=1;
   IF EXISTS(SELECT 1 FROM paws.SessionAssignment currentAssignment CROSS APPLY(SELECT CASE WHEN currentAssignment.SessionAssignmentId=@Assignment THEN @Target ELSE currentAssignment.FacultyId END FacultyId) candidate JOIN paws.SessionAssignment otherAssignment WITH(UPDLOCK,HOLDLOCK) ON otherAssignment.FacultyId=candidate.FacultyId JOIN paws.Session otherSession WITH(UPDLOCK,HOLDLOCK) ON otherSession.SessionId=otherAssignment.SessionId WHERE currentAssignment.SessionId=@Session AND otherSession.SessionId<>@Session AND (otherSession.SessionDate IS NULL OR (otherSession.SessionDate=@Date AND (otherSession.StartTime IS NULL OR otherSession.EndTime IS NULL OR (otherSession.StartTime<@End AND otherSession.EndTime>@Start))))) SET @Blocked=1;
   IF NULLIF(LTRIM(RTRIM(@Room)),N'') IS NOT NULL AND EXISTS(SELECT 1 FROM paws.Session WITH(UPDLOCK,HOLDLOCK) WHERE SessionId<>@Session AND Room=@Room AND SessionDate=@Date AND (StartTime IS NULL OR EndTime IS NULL OR (StartTime<@End AND EndTime>@Start))) SET @Blocked=1;
   IF @Blocked=1 AND @Override=0 THROW 53011,'Application blocked by unresolved identity, unknown schedule, AFC availability, or timetable conflict.',1;
   -- Source DOE cannot silently inherit an incompatible course/type rate. Such changes require reviewed source evidence.
   IF EXISTS(SELECT 1 FROM paws.Session s JOIN paws.SessionAssignment a ON a.SessionId=s.SessionId WHERE s.SessionId=@Session AND (s.CourseCode<>@Course OR s.SessionType<>@Type) AND (a.DoeCredit IS NOT NULL OR a.DoeRate IS NOT NULL OR a.DoeQuantity IS NOT NULL)) THROW 53011,'DOE source preview requires a compatible course/type rule; application remains blocked pending reviewed evidence.',1;
   IF @Duration<>@OldDuration AND EXISTS(SELECT 1 FROM paws.SessionAssignment WHERE SessionId=@Session AND (DoeCredit IS NOT NULL OR DoeRate IS NOT NULL OR DoeQuantity IS NOT NULL) AND (LOWER(COALESCE(DoeUnit,N'')) NOT IN(N'hour',N'hours',N'hr',N'hrs') OR DoeRate IS NULL OR DoeQuantity IS NULL OR DoeCredit IS NULL OR ABS(DoeCredit-DoeRate*DoeQuantity)>0.00001 OR ABS(DoeQuantity-@OldDuration)>0.0001)) THROW 53011,'DOE source preview cannot reconcile the proposed duration with authoritative units and rate.',1;
   IF @Target IS NOT NULL UPDATE paws.SessionAssignment SET FacultyId=@Target,FacultyResolutionStatus=N'resolved' WHERE SessionAssignmentId=@Assignment AND SessionId=@Session;
   IF @Duration<>@OldDuration UPDATE paws.SessionAssignment SET DoeQuantity=@Duration,DoeCredit=ROUND(DoeRate*@Duration,6),CreditedHours=CASE WHEN CreditedHours=@OldDuration THEN @Duration ELSE CreditedHours END WHERE SessionId=@Session AND LOWER(DoeUnit) IN(N'hour',N'hours',N'hr',N'hrs') AND DoeRate IS NOT NULL;
   -- The existing session procedure validates canonical course/date/type and duplicate sessions. Its nested transaction is part of this atomic apply.
   DECLARE @Patch nvarchar(max)=(SELECT [key],value,type FROM OPENJSON(@Changes) WHERE [key]<>N'replacementCandidateKey' FOR JSON PATH);
   DECLARE @SessionPatch nvarchar(max)=N'{}',@Key nvarchar(128),@Value nvarchar(4000);
   DECLARE patchCursor CURSOR LOCAL FAST_FORWARD FOR SELECT [key],value FROM OPENJSON(@Changes) WHERE [key]<>N'replacementCandidateKey';
   OPEN patchCursor;FETCH NEXT FROM patchCursor INTO @Key,@Value;WHILE @@FETCH_STATUS=0 BEGIN SET @SessionPatch=JSON_MODIFY(@SessionPatch,CONCAT(N'$.',@Key),@Value);FETCH NEXT FROM patchCursor INTO @Key,@Value;END;CLOSE patchCursor;DEALLOCATE patchCursor;
   IF @SessionPatch<>N'{}'
   BEGIN
    DECLARE @Discard TABLE(id uniqueidentifier,academicYear nvarchar(32),curriculumYear nvarchar(64),courseCode nvarchar(32),courseName nvarchar(512),topic nvarchar(max),sessionType nvarchar(128),date varchar(10),startTime varchar(8),endTime varchar(8),room nvarchar(256),instructorNames nvarchar(max));
    INSERT @Discard EXEC paws_api.UpdateCalendarSession @SessionId=@Session,@PatchJson=@SessionPatch,@ActorFirebaseUid=@ActorFirebaseUid;
   END;
   SET @After=paws_api.SessionSwapSnapshot(@Session);
   UPDATE paws.SwapRequest SET Status=N'applied',NextStage=NULL,UpdatedAtUtc=SYSUTCDATETIME() WHERE RequestId=@RequestId;
   INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson,RequestId) VALUES(NEWID(),N'swap_applied',N'session_swap',CONVERT(nvarchar(36),@RequestId),@ActorFirebaseUid,SYSUTCDATETIME(),@Before,@After,(SELECT @OverrideReason overrideReason,@Revision revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@RequestId);
  END ELSE UPDATE paws.SwapRequest SET NextStage=@Next,UpdatedAtUtc=SYSUTCDATETIME() WHERE RequestId=@RequestId;
  INSERT paws.SwapDecision(RequestId,Revision,Stage,Decision,Comment,OverrideReason,ActorUid) VALUES(@RequestId,@Revision,@Stage,@Decision,@Comment,@OverrideReason,@ActorFirebaseUid);
 END;
 INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson,RequestId) VALUES(NEWID(),N'swap_decision',N'session_swap',CONVERT(nvarchar(36),@RequestId),@ActorFirebaseUid,SYSUTCDATETIME(),(SELECT @Stage stage,@Decision decision,@Revision revision,@Comment comment,@OverrideReason overrideReason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@RequestId);
 COMMIT;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
 EXEC paws_api.GetSessionSwap @RequestId,@ActorFirebaseUid;
END;
GO
COMMIT TRANSACTION;
