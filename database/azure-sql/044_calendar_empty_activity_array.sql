/* Preserve an explicit empty Calendar array on University SQL. No business writes or grants. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws_api.ListCalendarActivities',N'P') IS NULL
 THROW 54400,'The reviewed Calendar activity foundation is required.',1;
BEGIN TRANSACTION;
GO
ALTER PROCEDURE paws_api.ListCalendarActivities
 @ActorFirebaseUid nvarchar(128),@StartDate date,@EndExclusive date,@FacultyKey uniqueidentifier=NULL,@Category nvarchar(64)=NULL,@Cursor nvarchar(64)=NULL,@Limit int=100,@IncludeFacultyKeys bit=0
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Role nvarchar(128),@OwnFaculty uniqueidentifier,@FilterFaculty uniqueidentifier,@AfterDate date,@AfterId uniqueidentifier;
 SELECT @Role=LOWER(LTRIM(RTRIM(BaseRole))),@OwnFaculty=FacultyId FROM paws.UserProfile WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
 IF @Role IS NULL OR @Role NOT IN(N'developer',N'owner',N'administrator',N'admin',N'adfa_general',N'adfa_regular',N'adc',N'lab',N'faculty',N'hicc',N'visc')
  OR (@Role IN(N'faculty',N'hicc',N'visc') AND @OwnFaculty IS NULL) THROW 53801,'Timetable authorization is required.',1;
 IF @IncludeFacultyKeys=1 AND paws_api.CalendarActivityAdmin(@ActorFirebaseUid)<>1 THROW 53801,'Administrator key mapping permission is required.',1;
 IF @IncludeFacultyKeys=1 AND (SELECT COUNT(*) FROM paws.SwapCandidate c JOIN paws.Faculty f ON f.FacultyId=c.FacultyId WHERE f.Active=1)>500 THROW 53802,'Faculty key mapping exceeds its bounded scope.',1;
 IF @StartDate IS NULL OR @EndExclusive IS NULL OR @EndExclusive<=@StartDate OR DATEDIFF(day,@StartDate,@EndExclusive)>550 OR @Limit NOT BETWEEN 1 AND 100
  OR (@Category IS NOT NULL AND @Category NOT IN(N'ccc',N'rotation_participant',N'clinical_day',N'vetm581_rounds',N'vetm571_clinical_pharmacology',N'vetm591_presentations',N'teaching_excellence',N'remote_work'))
  THROW 53802,'A bounded valid activity range is required.',1;
 IF @FacultyKey IS NOT NULL
 BEGIN
  SELECT @FilterFaculty=FacultyId FROM paws.SwapCandidate WHERE CandidateKey=@FacultyKey;
  IF @FilterFaculty IS NULL THROW 53803,'Faculty key was not found.',1;
 END;
 IF @Role IN(N'faculty',N'hicc',N'visc')
 BEGIN
  IF @FilterFaculty IS NOT NULL AND @FilterFaculty<>@OwnFaculty THROW 53801,'Only your own activity scope is available.',1;
  SET @FilterFaculty=@OwnFaculty;
 END;
 IF @Cursor IS NOT NULL
 BEGIN
  IF LEN(@Cursor)<>47 OR SUBSTRING(@Cursor,11,1)<>N'|' THROW 53802,'Activity cursor is invalid.',1;
  SET @AfterDate=TRY_CONVERT(date,LEFT(@Cursor,10),23);SET @AfterId=TRY_CONVERT(uniqueidentifier,SUBSTRING(@Cursor,12,36));
  IF @AfterDate IS NULL OR @AfterId IS NULL THROW 53802,'Activity cursor is invalid.',1;
 END;
 DECLARE @Page TABLE(ActivityId uniqueidentifier,StartDate date);
 INSERT @Page SELECT TOP(@Limit+1) a.ActivityId,a.StartDate FROM paws.CalendarActivity a JOIN paws.Faculty f ON f.FacultyId=a.FacultyId AND f.Active=1
  WHERE a.StartDate<@EndExclusive AND a.EndDate>=@StartDate AND (@FilterFaculty IS NULL OR a.FacultyId=@FilterFaculty)
   AND (@Category IS NULL OR a.Category=@Category) AND (@AfterDate IS NULL OR a.StartDate>@AfterDate OR a.StartDate=@AfterDate AND a.ActivityId>@AfterId)
  ORDER BY a.StartDate,a.ActivityId;
 DECLARE @HasMore bit=IIF((SELECT COUNT(*) FROM @Page)>@Limit,1,0),@LastDate date,@LastId uniqueidentifier;
 IF @HasMore=1 DELETE @Page WHERE ActivityId=(SELECT TOP(1) ActivityId FROM @Page ORDER BY StartDate DESC,ActivityId DESC);
 SELECT TOP(1) @LastDate=StartDate,@LastId=ActivityId FROM @Page ORDER BY StartDate DESC,ActivityId DESC;
 SELECT (SELECT JSON_QUERY(COALESCE((SELECT a.ActivityId activityId,c.CandidateKey facultyKey,
    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName) facultyDisplayName,
    a.Category category,a.OriginalLabel label,a.StartDate startDate,a.EndDate endDate,course.CourseCode courseCode,
    CASE WHEN times.TimeCount=0 THEN N'not_provided' WHEN times.TimeCount=DATEDIFF(day,a.StartDate,a.EndDate)+1 THEN N'verified' ELSE N'partial' END timeStatus,
    CONVERT(varchar(16),CONVERT(binary(8),a.ActivityVersion),2) version,
    JSON_QUERY((SELECT t.ActivityDate date,CONVERT(char(5),t.StartTime,108) startTime,CONVERT(char(5),t.EndTime,108) endTime
      FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId ORDER BY t.ActivityDate FOR JSON PATH)) timeEvidence
    FROM @Page page JOIN paws.CalendarActivity a ON a.ActivityId=page.ActivityId JOIN paws.Faculty f ON f.FacultyId=a.FacultyId
    LEFT JOIN paws.SwapCandidate c ON c.FacultyId=a.FacultyId LEFT JOIN paws.Course course ON course.CourseId=a.CourseId
    OUTER APPLY(SELECT COUNT(*) TimeCount FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId) times
    ORDER BY a.StartDate,a.ActivityId FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]')) activities,
    CASE WHEN @HasMore=1 THEN CONCAT(CONVERT(char(10),@LastDate,23),N'|',CONVERT(char(36),@LastId)) END nextCursor,
    JSON_QUERY(CASE WHEN @IncludeFacultyKeys=1 THEN (SELECT f.FacultyId facultyId,c.CandidateKey facultyKey FROM paws.SwapCandidate c JOIN paws.Faculty f ON f.FacultyId=c.FacultyId AND f.Active=1 ORDER BY f.FacultyId FOR JSON PATH) END) facultyKeys
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) responseJson;
END;
GO
COMMIT TRANSACTION;
