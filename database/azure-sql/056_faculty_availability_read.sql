/* PAWS Faculty Availability: read-only, source-derived, one faculty per query.
   Source authority: paws.vCalendarSession/SessionAssignment, CalendarActivity/DayTime,
   vAfcRecordUnified, pending AfcRequest, RoleAssignment/RoleAppointmentSchedule,
   TeachingResponsibilityAssignee/TeachingResponsibility effective windows.
   No materialized availability data or business writes.
*/
IF DB_NAME()<>N'VetMed-Ops' THROW 55600,'Faculty availability migration requires VetMed-Ops.',1;
SET XACT_ABORT ON;
IF OBJECT_ID(N'paws_api.ListFacultyAvailability',N'P') IS NOT NULL
 THROW 55600,'Faculty availability procedure already exists; inspect before applying.',1;
IF OBJECT_ID(N'paws.vCalendarSession',N'V') IS NULL OR OBJECT_ID(N'paws.SessionAssignment',N'U') IS NULL
 OR OBJECT_ID(N'paws.CalendarActivity',N'U') IS NULL OR OBJECT_ID(N'paws.CalendarActivityDayTime',N'U') IS NULL
 OR OBJECT_ID(N'paws.vAfcRecordUnified',N'V') IS NULL
 OR OBJECT_ID(N'paws.AfcRequest',N'U') IS NULL OR OBJECT_ID(N'paws.RoleAppointmentSchedule',N'U') IS NULL
 OR OBJECT_ID(N'paws.TeachingResponsibilityAssignee',N'U') IS NULL OR OBJECT_ID(N'paws.TeachingResponsibility',N'U') IS NULL
 OR DATABASE_PRINCIPAL_ID(N'paws_runtime_read') IS NULL
 THROW 55600,'Accepted Faculty Availability source/schema/role prerequisite is missing.',1;
BEGIN TRANSACTION;
GO
CREATE PROCEDURE paws_api.ListFacultyAvailability
 @ActorFirebaseUid nvarchar(128),
 @FacultyId uniqueidentifier,
 @Mode nvarchar(12)=N'upcoming',
 @StartDate date=NULL,
 @EndDate date=NULL,
 @Kind nvarchar(16)=N'all',
 @Cursor int=0,
 @Limit int=50
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Role nvarchar(128),@OwnFaculty uniqueidentifier;
 SELECT @Role=LOWER(LTRIM(RTRIM(BaseRole))),@OwnFaculty=FacultyId
 FROM paws.UserProfile
 WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
 IF @Role IS NULL OR @Role NOT IN(N'developer',N'owner',N'administrator',N'admin',
       N'adfa_general',N'adfa_regular',N'faculty',N'hicc',N'visc')
 THROW 55603,'The account is not authorized for Faculty Availability.',1;
 IF @Role IN(N'faculty',N'hicc',N'visc') AND (@OwnFaculty IS NULL OR @OwnFaculty<>@FacultyId)
 THROW 55603,'Only the linked Faculty availability may be read.',1;
 IF @FacultyId IS NULL OR NOT EXISTS(SELECT 1 FROM paws.Faculty WHERE FacultyId=@FacultyId)
 THROW 55604,'Faculty is not found.',1;
 IF @Mode NOT IN(N'upcoming',N'from',N'range')
 OR @Kind NOT IN(N'all',N'teaching',N'work',N'afc',N'pending',N'role')
 OR (@Mode=N'upcoming' AND (@StartDate IS NOT NULL OR @EndDate IS NOT NULL))
 OR (@Mode=N'from' AND (@StartDate IS NULL OR @EndDate IS NOT NULL))
 OR (@Mode=N'range' AND (@StartDate IS NULL OR @EndDate IS NULL OR @EndDate<@StartDate))
 OR @Limit NOT BETWEEN 1 AND 100 OR @Cursor IS NULL OR @Cursor<0 OR @Cursor>100000
 THROW 55601,'Invalid availability filters.',1;
 DECLARE @NowLocal datetimeoffset=SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Mountain Standard Time';
 DECLARE @Today date=CONVERT(date,@NowLocal),@Clock time(0)=CONVERT(time(0),@NowLocal);
 DECLARE @Floor date=CASE WHEN @Mode=N'upcoming' THEN @Today ELSE @StartDate END;
 DECLARE @Ceiling date=CASE WHEN @Mode=N'range' THEN @EndDate ELSE NULL END;

 CREATE TABLE #Events (
  Kind nvarchar(16) NOT NULL,
  SourceKey nvarchar(100) NOT NULL,
  Label nvarchar(520) NOT NULL,
  StartDate date NOT NULL,
  EndDate date NULL,
  StartTime time(0) NULL,
  EndTime time(0) NULL,
  Availability nvarchar(24) NOT NULL,
  TimeStatus nvarchar(24) NOT NULL,
  CourseCode nvarchar(32) NULL,
  SessionId uniqueidentifier NULL,
  Detail nvarchar(500) NULL,
  TimeEvidence nvarchar(max) NULL
 );

 IF @Kind IN(N'all',N'teaching')
 INSERT #Events(Kind,SourceKey,Label,StartDate,EndDate,StartTime,EndTime,
                Availability,TimeStatus,CourseCode,SessionId,Detail)
 SELECT N'teaching',CONCAT(N'teaching:',CONVERT(nvarchar(36),s.SessionId)),
        CONCAT(COALESCE(NULLIF(s.CourseCode,N''),N'Teaching session'),N' · ',COALESCE(NULLIF(s.SessionType,N''),N'Session')),
        s.SessionDate,s.SessionDate,s.StartTime,s.EndTime,
        CASE WHEN s.StartTime IS NULL OR s.EndTime IS NULL OR s.StartTime>=s.EndTime
             THEN N'time_unconfirmed' ELSE N'busy' END,
        CASE WHEN s.StartTime IS NULL OR s.EndTime IS NULL OR s.StartTime>=s.EndTime
             THEN N'unknown' ELSE N'verified' END,
        s.CourseCode,s.SessionId,LEFT(NULLIF(LTRIM(RTRIM(s.Topic)),N''),500)
 FROM paws.vCalendarSession s
 WHERE s.SessionDate IS NOT NULL
   AND s.SessionDate>=@Floor AND (@Ceiling IS NULL OR s.SessionDate<=@Ceiling)
   AND EXISTS(SELECT 1 FROM paws.SessionAssignment a
              WHERE a.SessionId=s.SessionId AND a.FacultyId=@FacultyId)
   AND (@Mode<>N'upcoming' OR s.SessionDate>@Today
       OR s.EndTime IS NULL OR s.StartTime IS NULL OR s.StartTime>=s.EndTime OR s.EndTime>@Clock);

 IF @Kind IN(N'all',N'work')
 INSERT #Events(Kind,SourceKey,Label,StartDate,EndDate,Availability,TimeStatus,CourseCode,Detail,TimeEvidence)
 SELECT N'work',CONCAT(N'work:',CONVERT(nvarchar(36),a.ActivityId)),
        COALESCE(NULLIF(LEFT(LTRIM(RTRIM(a.OriginalLabel)),520),N''),N'Working activity'),
        a.StartDate,a.EndDate,
        CASE WHEN a.Category=N'remote_work' THEN N'informational'
             WHEN missing.MissingDays>0 THEN N'time_unconfirmed' ELSE N'busy' END,
        CASE WHEN missing.MissingDays>0 AND evidence.EvidenceDays>0 THEN N'partial'
             WHEN missing.MissingDays>0 THEN N'unknown' ELSE N'verified' END,
        c.CourseCode,CONCAT(N'Work beyond teaching · ',a.Category),
        COALESCE((SELECT CONVERT(char(10),t.ActivityDate,23) date,
                         CONVERT(char(5),t.StartTime,108) startTime,
                         CONVERT(char(5),t.EndTime,108) endTime
                  FROM paws.CalendarActivityDayTime t
                  WHERE t.ActivityId=a.ActivityId AND t.ActivityDate BETWEEN a.StartDate AND a.EndDate
                  ORDER BY t.ActivityDate FOR JSON PATH),N'[]')
 FROM paws.CalendarActivity a
 LEFT JOIN paws.Course c ON c.CourseId=a.CourseId
 OUTER APPLY(SELECT COUNT_BIG(*) EvidenceDays FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId AND t.ActivityDate BETWEEN a.StartDate AND a.EndDate) evidence
 OUTER APPLY(SELECT DATEDIFF(day,a.StartDate,a.EndDate)+1-evidence.EvidenceDays MissingDays) missing
 WHERE a.FacultyId=@FacultyId AND a.StartDate<=COALESCE(@Ceiling,'9999-12-31')
   AND a.EndDate>=@Floor
   AND (@Mode<>N'upcoming' OR a.EndDate>@Today
        OR NOT EXISTS(SELECT 1 FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId AND t.ActivityDate=@Today)
        OR EXISTS(SELECT 1 FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId
                  AND t.ActivityDate=@Today AND t.EndTime>@Clock));

 IF @Kind IN(N'all',N'afc')
 INSERT #Events(Kind,SourceKey,Label,StartDate,EndDate,Availability,TimeStatus,Detail)
 SELECT N'afc',CONCAT(N'afc:',a.RecordKey),N'Away from campus',
        a.StartDate,a.EndDate,N'away',N'all_day',N'Approved or recorded AFC'
 FROM paws.vAfcRecordUnified a
 WHERE a.FacultyId=@FacultyId AND a.Active=1
   AND a.EndDate>=@Floor AND (@Ceiling IS NULL OR a.StartDate<=@Ceiling);

 -- Some accepted historical unified views contain only imported/manual AFC.
 -- Include approved requests exactly once using their canonical request identity.
 IF @Kind IN(N'all',N'afc')
 INSERT #Events(Kind,SourceKey,Label,StartDate,EndDate,Availability,TimeStatus,Detail)
 SELECT N'afc',CONCAT(N'afc:request:',CONVERT(nvarchar(36),r.AfcRequestId)),N'Away from campus',
        r.StartDate,r.EndDate,N'away',N'all_day',N'Approved or recorded AFC'
 FROM paws.AfcRequest r
 WHERE r.FacultyId=@FacultyId AND r.Status=N'approved'
   AND r.EndDate>=@Floor AND (@Ceiling IS NULL OR r.StartDate<=@Ceiling)
   AND NOT EXISTS(SELECT 1 FROM paws.vAfcRecordUnified a WHERE a.RecordKey=CONCAT(N'request:',CONVERT(nvarchar(36),r.AfcRequestId)) AND a.Active=1);

 IF @Kind IN(N'all',N'pending')
 INSERT #Events(Kind,SourceKey,Label,StartDate,EndDate,Availability,TimeStatus,Detail)
 SELECT N'pending',CONCAT(N'pending:',CONVERT(nvarchar(36),r.AfcRequestId)),N'Pending absence request',
        r.StartDate,r.EndDate,N'tentative',N'all_day',N'Pending approval; not confirmed leave'
 FROM paws.AfcRequest r
 WHERE r.FacultyId=@FacultyId AND r.Status IN(N'pending_report_to',N'pending_admin')
   AND r.EndDate>=@Floor AND (@Ceiling IS NULL OR r.StartDate<=@Ceiling);

 IF @Kind IN(N'all',N'role')
 BEGIN
  INSERT #Events(Kind,SourceKey,Label,StartDate,EndDate,Availability,TimeStatus,Detail)
  SELECT N'role',CONCAT(N'role:',CONVERT(nvarchar(36),r.RoleAssignmentId),N':',j.[key]),
         COALESCE(NULLIF(r.RoleType,N''),N'Role / appointment'),
         dates.StartDate,dates.EndDate,N'ongoing',N'not_applicable',
         LEFT(COALESCE(NULLIF(r.CourseOrSubjectOrRotation,N''),NULLIF(r.CourseName,N''),N'Ongoing responsibility'),500)
  FROM paws.RoleAssignment r
  JOIN paws.RoleAppointmentSchedule p ON p.RoleAssignmentId=r.RoleAssignmentId
  CROSS APPLY OPENJSON(p.PeriodsJson) j
  CROSS APPLY (SELECT CASE WHEN j.type=5 THEN j.value ELSE N'{}' END PeriodJson) safe
  CROSS APPLY (SELECT TRY_CONVERT(date,JSON_VALUE(safe.PeriodJson,'$.startDate'),23) StartDate,
                      TRY_CONVERT(date,JSON_VALUE(safe.PeriodJson,'$.endDate'),23) EndDate) dates
  WHERE r.FacultyId=@FacultyId AND dates.StartDate IS NOT NULL AND (dates.EndDate IS NULL OR dates.EndDate>=dates.StartDate)
    AND dates.StartDate<=COALESCE(@Ceiling,'9999-12-31')
    AND (dates.EndDate IS NULL OR dates.EndDate>=@Floor);

  INSERT #Events(Kind,SourceKey,Label,StartDate,EndDate,Availability,TimeStatus,Detail)
  SELECT N'role',CONCAT(N'role:',CONVERT(nvarchar(36),r.RoleAssignmentId),N':legacy'),
         COALESCE(NULLIF(r.RoleType,N''),N'Role / appointment'),
         r.EffectiveDate,
         CASE WHEN r.ExpirationDate IS NULL THEN NULL ELSE DATEADD(day,-1,r.ExpirationDate) END,
         N'ongoing',N'not_applicable',
         LEFT(COALESCE(NULLIF(r.CourseOrSubjectOrRotation,N''),NULLIF(r.CourseName,N''),N'Ongoing responsibility'),500)
  FROM paws.RoleAssignment r
  WHERE r.FacultyId=@FacultyId AND NOT EXISTS
       (SELECT 1 FROM paws.RoleAppointmentSchedule p WHERE p.RoleAssignmentId=r.RoleAssignmentId)
    AND r.EffectiveDate IS NOT NULL
    AND (r.ExpirationDate IS NULL OR r.ExpirationDate>r.EffectiveDate)
    AND (r.EffectiveDate IS NULL OR r.EffectiveDate<=COALESCE(@Ceiling,'9999-12-31'))
    AND (r.ExpirationDate IS NULL OR r.ExpirationDate>@Floor);

  -- Authority assignments are independent of imported RoleAssignment rows.
  -- Their expiration is exclusive; retain source identity without guessed deduplication.
  INSERT #Events(Kind,SourceKey,Label,StartDate,EndDate,Availability,TimeStatus,Detail)
  SELECT N'role',CONCAT(N'responsibility:',CONVERT(nvarchar(36),a.ResponsibilityAssigneeId)),
         CONCAT(UPPER(r.Kind),N' responsibility'),a.ActiveDate,DATEADD(day,-1,a.ExpirationDate),
         N'ongoing',N'not_applicable',r.Label
  FROM paws.TeachingResponsibilityAssignee a
  JOIN paws.TeachingResponsibility r ON r.ResponsibilityId=a.ResponsibilityId
  WHERE a.FacultyId=@FacultyId AND a.ActiveDate<=COALESCE(@Ceiling,'9999-12-31')
    AND (a.ExpirationDate IS NULL OR a.ExpirationDate>@Floor);
 END;

 DECLARE @Total int=(SELECT COUNT(*) FROM #Events);
 DECLARE @UndatedSessions int=(SELECT COUNT(DISTINCT s.SessionId) FROM paws.vCalendarSession s
   JOIN paws.SessionAssignment a ON a.SessionId=s.SessionId
   WHERE a.FacultyId=@FacultyId AND s.SessionDate IS NULL);
 DECLARE @UndatedRoles int=(SELECT COUNT(*) FROM paws.RoleAssignment r
   WHERE r.FacultyId=@FacultyId AND (
    ((r.EffectiveDate IS NULL OR r.ExpirationDate<=r.EffectiveDate) AND NOT EXISTS(SELECT 1 FROM paws.RoleAppointmentSchedule p WHERE p.RoleAssignmentId=r.RoleAssignmentId))
    OR EXISTS(SELECT 1 FROM paws.RoleAppointmentSchedule p WHERE p.RoleAssignmentId=r.RoleAssignmentId AND (
      LEFT(LTRIM(p.PeriodsJson),1)<>N'[' OR EXISTS(SELECT 1 FROM OPENJSON(p.PeriodsJson) j
      CROSS APPLY (SELECT CASE WHEN j.type=5 THEN j.value ELSE N'{}' END PeriodJson) safe
      WHERE j.type<>5 OR TRY_CONVERT(date,JSON_VALUE(safe.PeriodJson,'$.startDate'),23) IS NULL
       OR (JSON_VALUE(safe.PeriodJson,'$.endDate') IS NOT NULL AND (TRY_CONVERT(date,JSON_VALUE(safe.PeriodJson,'$.endDate'),23) IS NULL
           OR TRY_CONVERT(date,JSON_VALUE(safe.PeriodJson,'$.endDate'),23)<TRY_CONVERT(date,JSON_VALUE(safe.PeriodJson,'$.startDate'),23))))))));
 SELECT (SELECT JSON_QUERY(COALESCE((
   SELECT e.SourceKey eventKey,e.Kind kind,e.Label label,
          CONVERT(char(10),e.StartDate,23) startDate,
          CONVERT(char(10),e.EndDate,23) endDate,
          CONVERT(char(5),e.StartTime,108) startTime,
          CONVERT(char(5),e.EndTime,108) endTime,
          e.Availability availability,e.TimeStatus timeStatus,
          e.CourseCode courseCode,CONVERT(nvarchar(36),e.SessionId) sessionId,
          e.Detail detail,JSON_QUERY(e.TimeEvidence) timeEvidence
   FROM #Events e
   ORDER BY e.StartDate,ISNULL(e.StartTime,'00:00:00'),e.Kind,e.SourceKey
   OFFSET @Cursor ROWS FETCH NEXT @Limit ROWS ONLY
   FOR JSON PATH,INCLUDE_NULL_VALUES
 ),N'[]')) items,
 @Total total,
 CASE WHEN @Total>@Cursor+@Limit THEN CONVERT(varchar(20),@Cursor+@Limit) END nextCursor,
 CONVERT(char(10),@Today,23) today,
 JSON_QUERY((SELECT @UndatedSessions undatedSessions,@UndatedRoles undatedRoles
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) coverage
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) responseJson;
END;
GO
GRANT EXECUTE ON OBJECT::paws_api.ListFacultyAvailability TO paws_runtime_read;
COMMIT TRANSACTION;
GO
