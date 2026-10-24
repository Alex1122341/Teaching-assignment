/* Read-only ADFA assignment/candidate resolution. No live memberships or writes. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws_api.CalendarActivityAvailability') IS NULL OR DATABASE_PRINCIPAL_ID(N'paws_runtime_swap_read') IS NULL THROW 53900,'Reviewed Calendar-aware SWAP prerequisites are required.',1;
IF OBJECT_ID(N'paws_api.GetAdfaSwapFacultyPreview') IS NOT NULL THROW 53900,'Inspect the existing ADFA preview before applying.',1;
BEGIN TRANSACTION;
GO
CREATE PROCEDURE paws_api.GetAdfaSwapFacultyPreview
 @ActorFirebaseUid nvarchar(128),@SessionId uniqueidentifier,@AssignmentId uniqueidentifier,
 @CandidateKey uniqueidentifier=NULL,@ExpectedSnapshot varchar(64)=NULL
AS
BEGIN
 SET NOCOUNT ON;
 IF paws_api.CanActOnSessionSwap(@SessionId,@ActorFirebaseUid,N'adfa')<>1 THROW 53003,'ADFA permission is required.',1;
 DECLARE @Snapshot varchar(64)=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),paws_api.SessionSwapSnapshot(@SessionId))),2);
 IF @ExpectedSnapshot IS NULL OR LEN(@ExpectedSnapshot)<>64 OR @Snapshot IS NULL OR UPPER(@ExpectedSnapshot)<>@Snapshot THROW 53010,'Session changed; reload before previewing.',1;
 DECLARE @Outgoing uniqueidentifier,@Incoming uniqueidentifier,@Year nvarchar(32),@Date date,@Start time(0),@End time(0),@Role nvarchar(128),@Doe decimal(12,6),@OutName nvarchar(512),@InName nvarchar(512),@Status nvarchar(16)=N'Needs Review';
 SELECT @Outgoing=a.FacultyId,@Role=a.TeachingRole,@Doe=a.DoeCredit,@OutName=COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName,a.SourceFacultyName)
 FROM paws.SessionAssignment a JOIN paws.Faculty f ON f.FacultyId=a.FacultyId AND f.Active=1 WHERE a.SessionId=@SessionId AND a.SessionAssignmentId=@AssignmentId;
 SELECT @Year=AcademicYear,@Date=SessionDate,@Start=StartTime,@End=EndTime FROM paws.Session WHERE SessionId=@SessionId;
 IF @Outgoing IS NULL OR @Year IS NULL THROW 53004,'Assignment is unavailable.',1;
 IF @CandidateKey IS NOT NULL
 BEGIN
  SELECT @Incoming=f.FacultyId,@InName=COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName)
  FROM paws.SwapCandidate c JOIN paws.Faculty f ON f.FacultyId=c.FacultyId AND f.Active=1
  WHERE c.CandidateKey=@CandidateKey AND NOT EXISTS(SELECT 1 FROM paws.SessionAssignment a WHERE a.SessionId=@SessionId AND a.FacultyId=f.FacultyId);
  IF @Incoming IS NULL THROW 53004,'Candidate is unavailable.',1;
  SET @Status=paws_api.CalendarActivityAvailability(@Incoming,@Date,@Start,@End,@SessionId);
  IF @Date IS NULL OR @Start IS NULL OR @End IS NULL OR @Start>=@End OR EXISTS(
   SELECT 1 FROM paws.SessionAssignment a JOIN paws.Session s ON s.SessionId=a.SessionId WHERE a.FacultyId=@Incoming AND s.SessionId<>@SessionId
   AND (s.SessionDate IS NULL OR s.SessionDate=@Date AND (s.StartTime IS NULL OR s.EndTime IS NULL OR s.StartTime>=s.EndTime))) SET @Status=N'Needs Review';
 END;
 SELECT (SELECT @Year academicYear,@Outgoing outgoingFacultyId,@Incoming incomingFacultyId,@AssignmentId assignmentId,@CandidateKey candidateKey,
 @OutName outgoingDisplayName,@InName incomingDisplayName,@Role teachingRole,@Doe persistedDoeCredit,@Status availabilityStatus,@Snapshot snapshotToken,
 JSON_QUERY((SELECT TOP(20) s.CourseCode courseCode,CONVERT(char(10),s.SessionDate,23) date,CONVERT(char(8),s.StartTime,108) startTime,CONVERT(char(8),s.EndTime,108) endTime,s.Topic topic
 FROM paws.SessionAssignment a JOIN paws.Session s ON s.SessionId=a.SessionId WHERE a.FacultyId=@Incoming AND s.SessionId<>@SessionId AND s.SessionDate=@Date AND s.StartTime<@End AND s.EndTime>@Start
 GROUP BY s.SessionId,s.CourseCode,s.SessionDate,s.StartTime,s.EndTime,s.Topic ORDER BY s.StartTime,s.SessionId FOR JSON PATH)) conflicts
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) responseJson;
END;
GO
GRANT EXECUTE ON OBJECT::paws_api.GetAdfaSwapFacultyPreview TO paws_runtime_swap_read;
COMMIT TRANSACTION;
