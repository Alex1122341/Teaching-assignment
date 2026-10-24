/* PAWS_CCC_SCHEDULE_READ_V1
   Sanitized cross-faculty CCC schedule for authenticated active PAWS accounts.
   Reads only authoritative CalendarActivity; no staging, DOE, AFC, or business writes.
*/
IF DB_NAME()<>N'VetMed-Ops' THROW 55700,'The CCC reader requires VetMed-Ops.',1;
SET XACT_ABORT ON;
IF OBJECT_ID(N'paws_api.ListCccSchedule',N'P') IS NOT NULL
 THROW 55700,'Inspect the existing CCC reader before applying this migration.',1;
IF OBJECT_ID(N'paws.CalendarActivity',N'U') IS NULL OR OBJECT_ID(N'paws.CalendarActivityDayTime',N'U') IS NULL
 OR OBJECT_ID(N'paws.Faculty',N'U') IS NULL OR OBJECT_ID(N'paws.Course',N'U') IS NULL
 OR OBJECT_ID(N'paws.UserProfile',N'U') IS NULL
 OR DATABASE_PRINCIPAL_ID(N'paws_runtime_read') IS NULL
 THROW 55700,'CCC reader prerequisites are missing.',1;
BEGIN TRANSACTION;
GO
CREATE PROCEDURE paws_api.ListCccSchedule
 @ActorFirebaseUid nvarchar(128),
 @AcademicYear varchar(7)
AS
BEGIN
 SET NOCOUNT ON;
 -- PAWS_CCC_SCHEDULE_READ_V1. Revalidate the actor in SQL, independently of the API.
 DECLARE @Role nvarchar(128),@OwnFaculty uniqueidentifier;
 SELECT @Role=LOWER(LTRIM(RTRIM(BaseRole))),@OwnFaculty=FacultyId
 FROM paws.UserProfile
 WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
 IF @Role IS NULL OR @Role NOT IN(N'developer',N'owner',N'administrator',N'admin',
       N'adfa_general',N'adfa_regular',N'adc',N'lab',N'faculty',N'hicc',N'visc')
  OR (@Role IN(N'faculty',N'hicc',N'visc') AND @OwnFaculty IS NULL)
 THROW 55701,'The account is not authorized for CCC schedule.',1;

 DECLARE @Year int=TRY_CONVERT(int,LEFT(@AcademicYear,4));
 IF @AcademicYear IS NULL OR LEN(@AcademicYear)<>7 OR SUBSTRING(@AcademicYear,5,1)<>'-'
  OR @Year IS NULL OR @Year NOT BETWEEN 2020 AND 2097
  OR RIGHT(@AcademicYear,2)<>RIGHT(CONVERT(varchar(4),@Year+1),2)
 THROW 55702,'Invalid CCC academic year.',1;

 DECLARE @Start date=DATEFROMPARTS(@Year,5,1),
         @EndExclusive date=DATEFROMPARTS(@Year+1,5,1);
 IF (SELECT COUNT_BIG(*) FROM paws.CalendarActivity a
     LEFT JOIN paws.Faculty f ON f.FacultyId=a.FacultyId
     WHERE a.Category=N'ccc' AND a.StartDate<@EndExclusive AND a.EndDate>=@Start
       AND (f.Active=1 OR a.StaffingKind=N'unassigned'))>2500
 THROW 55703,'CCC year exceeds the bounded schedule view.',1;

 SELECT (
   SELECT JSON_QUERY(COALESCE((
     SELECT CONVERT(char(10),a.StartDate,23) date,
       CONVERT(char(10),a.EndDate,23) endDate,
       NULLIF(a.BlockLabel,N'') blockLabel,
       c.CourseCode courseCode,
       CASE WHEN a.StaffingKind=N'unassigned' THEN N'Locum'
            ELSE COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),
                 NULLIF(f.DisplayName,N''),N'Faculty name unavailable') END facultyName,
       CONVERT(bit,CASE WHEN a.StartDate=a.EndDate AND
         (LOWER(a.OriginalLabel) LIKE N'%half day%'
          OR LOWER(a.OriginalLabel) LIKE N'%half-day%'
          OR (tm.EvidenceCount=1 AND tm.DurationMinutes BETWEEN 1 AND 300))
         THEN 1 ELSE 0 END) halfDay
     FROM paws.CalendarActivity a
     LEFT JOIN paws.Faculty f ON f.FacultyId=a.FacultyId
     LEFT JOIN paws.Course c ON c.CourseId=a.CourseId
     OUTER APPLY(
       SELECT COUNT(*) EvidenceCount,MAX(DATEDIFF(minute,t.StartTime,t.EndTime)) DurationMinutes
       FROM paws.CalendarActivityDayTime t
       WHERE t.ActivityId=a.ActivityId AND t.ActivityDate=a.StartDate
         AND t.StartTime<t.EndTime
     ) tm
     WHERE a.Category=N'ccc' AND a.StartDate<@EndExclusive AND a.EndDate>=@Start
       AND (f.Active=1 OR a.StaffingKind=N'unassigned')
     ORDER BY a.StartDate,a.SourceSheet,a.SourceRow,a.SourceColumn,a.ActivityId
     FOR JSON PATH,INCLUDE_NULL_VALUES
   ),N'[]')) entries
   FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES
 ) responseJson;
END;
GO
GRANT EXECUTE ON OBJECT::paws_api.ListCccSchedule TO paws_runtime_read;
COMMIT TRANSACTION;
GO
