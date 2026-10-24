/* Preserve legacy assigned activities; add only source-backed CCC staffing slots. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws.MasterRefreshReceipt') IS NULL OR OBJECT_ID(N'paws.CccReplacementReceipt') IS NULL THROW 55300,'Accepted MASTER and CCC foundations required.',1;
IF COL_LENGTH(N'paws.CalendarActivity',N'StaffingKind') IS NOT NULL OR OBJECT_ID(N'staging.MasterCccSchemaBaseline') IS NOT NULL THROW 55300,'Inspect existing CCC slot upgrade.',1;
BEGIN TRANSACTION;
CREATE TABLE staging.MasterCccSchemaBaseline(ObjectName nvarchar(260) NOT NULL PRIMARY KEY,ObjectKind nvarchar(16) NOT NULL,BeforeDefinition nvarchar(max) NOT NULL,AfterSha256 char(64) NULL);
INSERT staging.MasterCccSchemaBaseline(ObjectName,ObjectKind,BeforeDefinition)
SELECT name,N'PROCEDURE',OBJECT_DEFINITION(OBJECT_ID(N'paws_api.'+name)) FROM(VALUES(N'ListCalendarActivities'),(N'ResolveCalendarActivityDayTime'),(N'LockCccReplacementScope'),(N'RecoverCccReplacement')) names(name)
UNION ALL SELECT N'CccScopeSnapshot',N'FUNCTION',OBJECT_DEFINITION(OBJECT_ID(N'paws_api.CccScopeSnapshot'));
INSERT staging.MasterCccSchemaBaseline(ObjectName,ObjectKind,BeforeDefinition)
SELECT name,kind,OBJECT_DEFINITION(OBJECT_ID(N'paws_api.'+name)) FROM(VALUES(N'CccReplacementRows',N'FUNCTION'),(N'CccReplacementSnapshot',N'FUNCTION'),(N'CommitCccReplacement',N'PROCEDURE')) names(name,kind);
ALTER TABLE staging.CccReplacement ADD FormatVersion tinyint NOT NULL CONSTRAINT DF_CccReplacement_FormatVersion DEFAULT 1 WITH VALUES,
 SourceManifestSha256 char(64) NULL,SourcePayloadManifestSha256 char(64) NULL,TrustedRowsSha256 char(64) NULL,
 SourceSlotCount int NULL,SourceAssignedCount int NULL,SourceUnassignedCount int NULL;
GO
ALTER TABLE staging.CccReplacement ADD CONSTRAINT CK_CccReplacement_MasterFormat CHECK(
 (FormatVersion=1 AND SourceManifestSha256 IS NULL AND SourcePayloadManifestSha256 IS NULL AND TrustedRowsSha256 IS NULL AND SourceSlotCount IS NULL AND SourceAssignedCount IS NULL AND SourceUnassignedCount IS NULL)
 OR(FormatVersion=2 AND SourceManifestSha256 IS NOT NULL AND SourcePayloadManifestSha256 IS NOT NULL AND TrustedRowsSha256 IS NOT NULL AND SourceSlotCount IS NOT NULL AND SourceAssignedCount IS NOT NULL AND SourceUnassignedCount IS NOT NULL AND SourceSlotCount BETWEEN 1 AND 5000 AND SourceAssignedCount>=0 AND SourceUnassignedCount>=0 AND SourceAssignedCount+SourceUnassignedCount=SourceSlotCount));
ALTER TABLE paws.CalendarActivity ADD StaffingKind nvarchar(16) NOT NULL CONSTRAINT DF_CalendarActivity_StaffingKind DEFAULT N'assigned' WITH VALUES,
 StaffingLabel nvarchar(32) NULL,BlockLabel nvarchar(1000) NULL,SourceColumn nvarchar(4) NULL,SourceSlotKey nvarchar(320) NULL;
GO
ALTER TABLE paws.CalendarActivity ALTER COLUMN FacultyId uniqueidentifier NULL;
ALTER TABLE paws.CalendarActivity ADD CONSTRAINT CK_CalendarActivity_Staffing CHECK(
 (StaffingKind COLLATE Latin1_General_100_BIN2=N'assigned' AND FacultyId IS NOT NULL AND StaffingLabel IS NULL)
 OR(Category=N'ccc' AND StaffingKind COLLATE Latin1_General_100_BIN2=N'unassigned' AND FacultyId IS NULL AND StaffingLabel IS NOT NULL AND StaffingLabel COLLATE Latin1_General_100_BIN2=N'Locum' AND SourceColumn IS NOT NULL));
ALTER TABLE paws.CalendarActivity ADD CONSTRAINT CK_CalendarActivity_SourceSlot CHECK(
 (SourceColumn IS NULL AND SourceSlotKey IS NULL) OR
 (Category=N'ccc' AND SourceColumn IS NOT NULL AND SourceColumn COLLATE Latin1_General_100_BIN2 IN(N'C',N'D',N'E') AND SourceSlotKey IS NOT NULL AND SourceSlotKey COLLATE Latin1_General_100_BIN2=CONCAT(SourceSheet,N'!',SourceColumn,SourceRow) COLLATE Latin1_General_100_BIN2));
ALTER TABLE paws.CalendarActivity DROP CONSTRAINT UQ_CalendarActivity_Source;
ALTER TABLE paws.CalendarActivity ADD CONSTRAINT UQ_CalendarActivity_Source UNIQUE(SourceSha256,SourceSheet,SourceRow,SourceColumn);
GO
CREATE PROCEDURE paws_api.AcquireCccCalendarYearLock @Date date
WITH EXECUTE AS OWNER
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 OR @Date IS NULL THROW 55309,'CCC transaction/date required.',1;
 DECLARE @Year int=YEAR(@Date)-IIF(MONTH(@Date)<5,1,0),@Result int,@Resource nvarchar(255);
 SET @Resource=CONCAT(N'paws:ccc-replacement:',@Year,N'-',RIGHT(CONVERT(varchar(4),@Year+1),2));
 EXEC @Result=sys.sp_getapplock @Resource=@Resource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=5000,@DbPrincipal=N'dbo';
 IF @Result<0 THROW 55309,'CCC year is busy.',1;
END;
GO
CREATE TRIGGER paws.ValidateMasterCccIdentity ON paws.CalendarActivity AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- Current identities are required for new MASTER source slots. Legacy
 -- historical rows retain their original faculty and recovery provenance.
 IF EXISTS(SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.ActivityId=i.ActivityId
  WHERE i.SourceColumn IS NOT NULL AND i.StaffingKind=N'assigned'
  AND(d.ActivityId IS NULL OR d.FacultyId IS NULL OR d.FacultyId<>i.FacultyId)
  AND NOT EXISTS(SELECT 1 FROM paws.Faculty f WITH(UPDLOCK,HOLDLOCK) WHERE f.FacultyId=i.FacultyId AND f.Active=1)) THROW 55306,'Active faculty required for MASTER staffing.',1;
END;
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
 INSERT @Page SELECT TOP(@Limit+1) a.ActivityId,a.StartDate FROM paws.CalendarActivity a LEFT JOIN paws.Faculty f ON f.FacultyId=a.FacultyId
  WHERE (f.Active=1 OR a.StaffingKind=N'unassigned') AND a.StartDate<@EndExclusive AND a.EndDate>=@StartDate AND (@FilterFaculty IS NULL OR a.FacultyId=@FilterFaculty)
   AND (@Category IS NULL OR a.Category=@Category) AND (@AfterDate IS NULL OR a.StartDate>@AfterDate OR a.StartDate=@AfterDate AND a.ActivityId>@AfterId)
  ORDER BY a.StartDate,a.ActivityId;
 DECLARE @HasMore bit=IIF((SELECT COUNT(*) FROM @Page)>@Limit,1,0),@LastDate date,@LastId uniqueidentifier;
 IF @HasMore=1 DELETE @Page WHERE ActivityId=(SELECT TOP(1) ActivityId FROM @Page ORDER BY StartDate DESC,ActivityId DESC);
 SELECT TOP(1) @LastDate=StartDate,@LastId=ActivityId FROM @Page ORDER BY StartDate DESC,ActivityId DESC;
 SELECT (SELECT JSON_QUERY(COALESCE((SELECT a.ActivityId activityId,c.CandidateKey facultyKey,
    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName,CASE WHEN a.StaffingKind=N'unassigned' THEN N'Locum' END) facultyDisplayName,
    a.StaffingKind staffingKind,a.StaffingLabel staffingLabel,a.BlockLabel blockLabel,
    a.Category category,a.OriginalLabel label,a.StartDate startDate,a.EndDate endDate,course.CourseCode courseCode,
    CASE WHEN times.TimeCount=0 THEN N'not_provided' WHEN times.TimeCount=DATEDIFF(day,a.StartDate,a.EndDate)+1 THEN N'verified' ELSE N'partial' END timeStatus,
    CONVERT(varchar(16),CONVERT(binary(8),a.ActivityVersion),2) version,
    JSON_QUERY((SELECT t.ActivityDate date,CONVERT(char(5),t.StartTime,108) startTime,CONVERT(char(5),t.EndTime,108) endTime
      FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId ORDER BY t.ActivityDate FOR JSON PATH)) timeEvidence
    FROM @Page page JOIN paws.CalendarActivity a ON a.ActivityId=page.ActivityId LEFT JOIN paws.Faculty f ON f.FacultyId=a.FacultyId
    LEFT JOIN paws.SwapCandidate c ON c.FacultyId=a.FacultyId LEFT JOIN paws.Course course ON course.CourseId=a.CourseId
    OUTER APPLY(SELECT COUNT(*) TimeCount FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId) times
    ORDER BY a.StartDate,a.ActivityId FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]')) activities,
    CASE WHEN @HasMore=1 THEN CONCAT(CONVERT(char(10),@LastDate,23),N'|',CONVERT(char(36),@LastId)) END nextCursor,
    JSON_QUERY(CASE WHEN @IncludeFacultyKeys=1 THEN (SELECT f.FacultyId facultyId,c.CandidateKey facultyKey FROM paws.SwapCandidate c JOIN paws.Faculty f ON f.FacultyId=c.FacultyId AND f.Active=1 ORDER BY f.FacultyId FOR JSON PATH) END) facultyKeys
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) responseJson;
END;
GO
ALTER PROCEDURE paws_api.ResolveCalendarActivityDayTime
 @ActorFirebaseUid nvarchar(128),@ActivityId uniqueidentifier,@ExpectedVersion varchar(64),@ActivityDate date,
 @StartTime time(0),@EndTime time(0),@EvidenceRef nvarchar(512),@EvidenceNote nvarchar(1000)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF paws_api.CalendarActivityAdmin(@ActorFirebaseUid)<>1 THROW 53801,'Administrator permission is required.',1;
 IF @ActivityDate IS NULL OR @StartTime IS NULL OR @EndTime IS NULL OR @StartTime>=@EndTime
  OR DATEPART(second,@StartTime)<>0 OR DATEPART(second,@EndTime)<>0 OR LEN(LTRIM(RTRIM(COALESCE(@EvidenceRef,N''))))=0
  OR LEN(LTRIM(RTRIM(COALESCE(@EvidenceNote,N''))))=0 THROW 53802,'Verified date, times and evidence are required.',1;
 BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @Faculty uniqueidentifier=(SELECT FacultyId FROM paws.CalendarActivity WHERE ActivityId=@ActivityId);
  IF NOT EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ActivityId=@ActivityId) THROW 53803,'Activity was not found.',1;
  IF EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ActivityId=@ActivityId AND Category=N'ccc') EXEC paws_api.AcquireCccCalendarYearLock @ActivityDate;
  DECLARE @FacultyJson nvarchar(max)=CONCAT(N'["',CONVERT(char(36),@Faculty),N'"]');
  IF @Faculty IS NOT NULL EXEC paws_api.AcquireCalendarActivityFacultyLocks @FacultyJson;
  DECLARE @Version binary(8),@StartDate date,@EndDate date;
  SELECT @Version=ActivityVersion,@StartDate=StartDate,@EndDate=EndDate FROM paws.CalendarActivity WITH(UPDLOCK,HOLDLOCK) WHERE ActivityId=@ActivityId AND (FacultyId=@Faculty OR FacultyId IS NULL AND @Faculty IS NULL);
  IF @Version IS NULL OR @ExpectedVersion IS NULL OR DATALENGTH(@ExpectedVersion)<>16 OR TRY_CONVERT(binary(8),@ExpectedVersion,2) IS NULL
   OR TRY_CONVERT(binary(8),@ExpectedVersion,2)<>@Version THROW 53804,'Activity changed.',1;
  IF @ActivityDate<@StartDate OR @ActivityDate>@EndDate THROW 53802,'Evidence date is outside the activity range.',1;
  IF EXISTS(SELECT 1 FROM paws.CalendarActivityDayTime WITH(UPDLOCK,HOLDLOCK) WHERE ActivityId=@ActivityId AND ActivityDate=@ActivityDate)
   UPDATE paws.CalendarActivityDayTime SET StartTime=@StartTime,EndTime=@EndTime,EvidenceRef=@EvidenceRef,EvidenceNote=@EvidenceNote,ActorUid=@ActorFirebaseUid,UpdatedAtUtc=SYSUTCDATETIME() WHERE ActivityId=@ActivityId AND ActivityDate=@ActivityDate;
  ELSE INSERT paws.CalendarActivityDayTime(ActivityId,ActivityDate,StartTime,EndTime,EvidenceRef,EvidenceNote,ActorUid)
   VALUES(@ActivityId,@ActivityDate,@StartTime,@EndTime,@EvidenceRef,@EvidenceNote,@ActorFirebaseUid);
  UPDATE paws.CalendarActivity SET UpdatedAtUtc=SYSUTCDATETIME() WHERE ActivityId=@ActivityId;
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson,ImportBatchId)
   SELECT NEWID(),N'calendar_activity_time_resolved',N'calendar_activity',CONVERT(nvarchar(36),@ActivityId),@ActorFirebaseUid,SYSUTCDATETIME(),
    (SELECT @ActivityDate activityDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),ImportBatchId FROM paws.CalendarActivity WHERE ActivityId=@ActivityId;
  COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION;THROW;END CATCH;
 SELECT (SELECT a.ActivityId activityId,c.CandidateKey facultyKey,COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName,CASE WHEN a.StaffingKind=N'unassigned' THEN N'Locum' END) facultyDisplayName,
  a.StaffingKind staffingKind,a.StaffingLabel staffingLabel,a.BlockLabel blockLabel,
  a.Category category,a.OriginalLabel label,a.StartDate startDate,a.EndDate endDate,course.CourseCode courseCode,
  CASE WHEN (SELECT COUNT(*) FROM paws.CalendarActivityDayTime WHERE ActivityId=a.ActivityId)=DATEDIFF(day,a.StartDate,a.EndDate)+1 THEN N'verified' ELSE N'partial' END timeStatus,
  CONVERT(varchar(16),CONVERT(binary(8),a.ActivityVersion),2) version,
  JSON_QUERY((SELECT ActivityDate date,CONVERT(char(5),StartTime,108) startTime,CONVERT(char(5),EndTime,108) endTime FROM paws.CalendarActivityDayTime WHERE ActivityId=a.ActivityId ORDER BY ActivityDate FOR JSON PATH)) timeEvidence
  FROM paws.CalendarActivity a LEFT JOIN paws.Faculty f ON f.FacultyId=a.FacultyId LEFT JOIN paws.SwapCandidate c ON c.FacultyId=a.FacultyId LEFT JOIN paws.Course course ON course.CourseId=a.CourseId
  WHERE a.ActivityId=@ActivityId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) responseJson;
END;
GO
ALTER FUNCTION paws_api.CccScopeSnapshot(@AcademicYear varchar(7)) RETURNS nvarchar(max)
AS
BEGIN
 DECLARE @Start date=TRY_CONVERT(date,LEFT(@AcademicYear,4)+'-05-01'),@End date=DATEADD(year,1,TRY_CONVERT(date,LEFT(@AcademicYear,4)+'-05-01'));
 DECLARE @Rows nvarchar(max)=(SELECT a.ActivityId activityId,a.FacultyId facultyId,a.Category category,a.OriginalLabel label,a.StartDate startDate,a.EndDate endDate,a.CourseId courseId,c.CourseCode courseCode,
 a.ImportBatchId importBatchId,a.ImportRowId importRowId,a.SourceSha256 sourceSha256,a.SourceSheet sourceSheet,a.SourceRow sourceRow,
 a.CreatedByUid createdByUid,a.CreatedAtUtc createdAtUtc,a.UpdatedAtUtc updatedAtUtc,CONVERT(varchar(16),CONVERT(binary(8),a.ActivityVersion),2) version,
 JSON_QUERY((SELECT ActivityDate date,StartTime startTime,EndTime endTime,EvidenceRef evidenceRef,EvidenceNote evidenceNote,ActorUid actorUid,UpdatedAtUtc updatedAtUtc,CONVERT(varchar(16),CONVERT(binary(8),TimeVersion),2) version FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId ORDER BY ActivityDate FOR JSON PATH,INCLUDE_NULL_VALUES)) timeEvidence
 FROM paws.CalendarActivity a LEFT JOIN paws.Course c ON c.CourseId=a.CourseId
 WHERE a.Category=N'ccc' AND a.StartDate<@End AND a.EndDate>=@Start ORDER BY a.StartDate,a.ActivityId FOR JSON PATH,INCLUDE_NULL_VALUES);
 DECLARE @Parts TABLE(n int PRIMARY KEY,RowJson nvarchar(max));
 INSERT @Parts SELECT TRY_CONVERT(int,j.[key]),CASE WHEN a.SourceColumn IS NOT NULL OR a.BlockLabel IS NOT NULL OR a.StaffingKind=N'unassigned' THEN
 JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(j.value,'$.staffingKind',a.StaffingKind),'$.staffingLabel',a.StaffingLabel),'$.blockLabel',a.BlockLabel),'$.sourceColumn',a.SourceColumn),'$.sourceSlotKey',a.SourceSlotKey)
 ELSE j.value END
 FROM OPENJSON(@Rows) j JOIN paws.CalendarActivity a ON a.ActivityId=TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.value,'$.activityId'));
 -- An explicit ordinal loop preserves legacy JSON ordering on SQL2017 and
 -- avoids ordered-aggregate scalar-UDF inlining conflicts on newer SQL.
 DECLARE @Result nvarchar(max)=N'[',@n int=0,@Last int=(SELECT COUNT(*) FROM @Parts);
 WHILE @n<@Last
 BEGIN
  SELECT @Result=@Result+CASE WHEN @n=0 THEN N'' ELSE N',' END+RowJson FROM @Parts WHERE n=@n;
  SET @n+=1;
 END;
 RETURN @Result+N']';
END;
GO
ALTER PROCEDURE paws_api.LockCccReplacementScope @AcademicYear varchar(7),@SourceRowsJson nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 54909,'CCC transaction required.',1;
 DECLARE @Result int,@Resource nvarchar(255)=CONCAT(N'paws:ccc-replacement:',@AcademicYear),@Faculty nvarchar(max),@Start date=TRY_CONVERT(date,LEFT(@AcademicYear,4)+'-05-01'),@End date=DATEADD(year,1,TRY_CONVERT(date,LEFT(@AcademicYear,4)+'-05-01'));
 EXEC @Result=sys.sp_getapplock @Resource=@Resource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=5000,@DbPrincipal=N'dbo';
 IF @Result<0 THROW 54909,'CCC scope is busy.',1;
 -- Read committed first: never hold activity row locks while waiting for SWAP's faculty locks.
 SELECT @Faculty=N'['+COALESCE(STUFF((SELECT N',"'+CONVERT(varchar(36),FacultyId)+N'"' FROM(
  SELECT FacultyId FROM paws_api.CccReplacementRows(@SourceRowsJson,@AcademicYear) WHERE FacultyId IS NOT NULL
  UNION SELECT FacultyId FROM paws.CalendarActivity WHERE FacultyId IS NOT NULL AND Category=N'ccc' AND StartDate<@End AND EndDate>=@Start) ids ORDER BY FacultyId FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),1,1,N''),N'')+N']';
 EXEC paws_api.AcquireCalendarActivityFacultyLocks @Faculty;
END;
GO
ALTER PROCEDURE paws_api.RecoverCccReplacement @ActorFirebaseUid nvarchar(128),@ReceiptId uniqueidentifier,@Confirm bit
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 BEGIN TRY
  BEGIN TRANSACTION;EXEC paws_api.AssertCccAdministrator @ActorFirebaseUid;
  IF @Confirm IS NULL OR @Confirm<>1 THROW 54902,'Explicit recovery confirmation required.',1;
  DECLARE @Year varchar(7),@Before nvarchar(max),@Expected nvarchar(max),@Status nvarchar(16),@Batch uniqueidentifier,@Rows nvarchar(max),@Protected bit,@Current nvarchar(max);
  SELECT @Year=AcademicYear,@Before=BeforeRowsJson,@Expected=AfterScopeJson,@Status=Status,@Batch=ImportBatchId FROM paws.CccReplacementReceipt WITH(UPDLOCK,HOLDLOCK) WHERE ReceiptId=@ReceiptId;
  IF @Year IS NULL THROW 54903,'CCC receipt not found.',1;
  IF @Status<>N'committed' THROW 54904,'CCC receipt is not recoverable.',1;
  -- Lock the batch before the year/faculty locks, matching commit ordering.
  SELECT @Rows=RowsJson FROM staging.CccReplacement WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@Batch;
  DECLARE @RecoveryRows nvarchar(max)=(SELECT JSON_VALUE(value,'$.facultyId') facultySourceId,CONVERT(int,[key])+2 sourceRow,N'[]' issues FROM OPENJSON(@Before) FOR JSON PATH);
  EXEC paws_api.LockCccReplacementScope @Year,@RecoveryRows;
  SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  EXEC paws_api.CalendarActivityProtectedReferences N'activity',@Protected OUTPUT;SET @Current=paws_api.CccScopeSnapshot(@Year);
  IF @Protected=1 OR @Current COLLATE Latin1_General_100_BIN2<>@Expected COLLATE Latin1_General_100_BIN2 OR EXISTS(SELECT 1 FROM OPENJSON(@Current) WITH(TimeEvidence nvarchar(max) '$.timeEvidence' AS JSON) WHERE TimeEvidence<>N'[]')
   OR EXISTS(SELECT 1 FROM paws.CalendarActivity a JOIN OPENJSON(@Before) WITH(ActivityId uniqueidentifier '$.activityId') b ON b.ActivityId=a.ActivityId) THROW 54908,'Newer or referenced CCC rows prevent recovery.',1;
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,BeforeJson,RequestId,ImportBatchId)
   SELECT NEWID(),N'ccc_activity_removed',N'calendar_activity',JSON_VALUE(value,'$.activityId'),@ActorFirebaseUid,SYSUTCDATETIME(),
    (SELECT JSON_VALUE(value,'$.facultyId') facultyId,JSON_VALUE(value,'$.label') label,N'ccc' category,JSON_VALUE(value,'$.startDate') startDate,JSON_VALUE(value,'$.endDate') endDate,JSON_VALUE(value,'$.courseCode') courseCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@ReceiptId,@Batch FROM OPENJSON(@Current);
  DELETE a FROM paws.CalendarActivity a JOIN OPENJSON(@Current) WITH(ActivityId uniqueidentifier '$.activityId') c ON c.ActivityId=a.ActivityId;
  INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,CourseId,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid,CreatedAtUtc,UpdatedAtUtc,StaffingKind,StaffingLabel,BlockLabel,SourceColumn,SourceSlotKey)
   SELECT ActivityId,FacultyId,N'ccc',Label,StartDate,EndDate,CourseId,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid,CreatedAtUtc,UpdatedAtUtc,COALESCE(StaffingKind,N'assigned'),StaffingLabel,BlockLabel,SourceColumn,SourceSlotKey FROM OPENJSON(@Before)
   WITH(ActivityId uniqueidentifier '$.activityId',FacultyId uniqueidentifier '$.facultyId',Label nvarchar(1000) '$.label',StartDate date '$.startDate',EndDate date '$.endDate',CourseId uniqueidentifier '$.courseId',ImportBatchId uniqueidentifier '$.importBatchId',ImportRowId uniqueidentifier '$.importRowId',SourceSha256 char(64) '$.sourceSha256',SourceSheet nvarchar(256) '$.sourceSheet',SourceRow int '$.sourceRow',CreatedByUid nvarchar(128) '$.createdByUid',CreatedAtUtc datetime2(7) '$.createdAtUtc',UpdatedAtUtc datetime2(7) '$.updatedAtUtc',StaffingKind nvarchar(16) '$.staffingKind',StaffingLabel nvarchar(32) '$.staffingLabel',BlockLabel nvarchar(1000) '$.blockLabel',SourceColumn nvarchar(4) '$.sourceColumn',SourceSlotKey nvarchar(320) '$.sourceSlotKey');
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,AfterJson,RequestId,ImportBatchId)
   SELECT NEWID(),N'ccc_activity_added',N'calendar_activity',JSON_VALUE(value,'$.activityId'),@ActorFirebaseUid,SYSUTCDATETIME(),
    (SELECT JSON_VALUE(value,'$.facultyId') facultyId,JSON_VALUE(value,'$.label') label,N'ccc' category,JSON_VALUE(value,'$.startDate') startDate,JSON_VALUE(value,'$.endDate') endDate,JSON_VALUE(value,'$.courseCode') courseCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@ReceiptId,@Batch FROM OPENJSON(@Before);
  UPDATE paws.CccReplacementReceipt SET Status=N'recovered' WHERE ReceiptId=@ReceiptId;UPDATE staging.CccReplacement SET Status=N'recovered' WHERE ImportBatchId=@Batch;
  COMMIT;SELECT(SELECT @ReceiptId receiptId,N'recovered' status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER FUNCTION paws_api.CccReplacementRows(@RowsJson nvarchar(max),@AcademicYear varchar(7))
RETURNS @Rows TABLE(SourceRow int,FacultySourceId nvarchar(100),FacultySourceName nvarchar(256),FacultyId uniqueidentifier,
 FacultyKey uniqueidentifier,DisplayName nvarchar(512),IdentityDigest varchar(64),StartDate date,EndDate date,CourseCode nvarchar(64),CourseId uniqueidentifier,Label nvarchar(300),Issues nvarchar(max),StaffingKind nvarchar(16),StaffingLabel nvarchar(32),BlockLabel nvarchar(1000),PhysicalSourceRow int,SourceColumn nvarchar(4),SlotKey nvarchar(320))
AS
BEGIN
 DECLARE @Start date=TRY_CONVERT(date,LEFT(@AcademicYear,4)+'-05-01'),@End date=DATEADD(year,1,TRY_CONVERT(date,LEFT(@AcademicYear,4)+'-05-01'));
 INSERT @Rows
 SELECT r.SourceRow,r.FacultySourceId,r.FacultySourceName,f.FacultyId,s.CandidateKey,CASE WHEN r.StaffingKind=N'unassigned' THEN N'Locum' ELSE f.DisplayName END,
 CONVERT(varchar(64),HASHBYTES('SHA2_256',CONCAT(CONVERT(char(36),f.FacultyId),N'|',f.DisplayName,N'|',f.PreferredFirstName,N'|',f.PreferredLastName,N'|',f.Active,N'|',CONVERT(nvarchar(33),f.UpdatedAtUtc,126),N'|',CONVERT(char(36),s.CandidateKey))),2),
 TRY_CONVERT(date,r.StartDate),TRY_CONVERT(date,r.EndDate),r.CourseCode,c.CourseId,COALESCE(NULLIF(r.Label,N''),N'CCC'),COALESCE(r.Issues,N'[]'),COALESCE(r.StaffingKind,N'assigned'),r.StaffingLabel,r.BlockLabel,r.PhysicalSourceRow,r.SourceColumn,r.SlotKey
 FROM OPENJSON(@RowsJson) WITH(SourceRow int '$.sourceRow',FacultySourceId nvarchar(100) '$.facultySourceId',FacultySourceName nvarchar(256) '$.facultySourceName',StartDate varchar(20) '$.startDate',EndDate varchar(20) '$.endDate',CourseCode nvarchar(64) '$.courseCode',Label nvarchar(300) '$.label',Issues nvarchar(max) '$.issues' AS JSON,StaffingKind nvarchar(16) '$.staffingKind',StaffingLabel nvarchar(32) '$.staffingLabel',BlockLabel nvarchar(1000) '$.blockLabel',PhysicalSourceRow int '$.sourceRef.row',SourceColumn nvarchar(4) '$.sourceRef.column',SlotKey nvarchar(320) '$.slotKey') r
 OUTER APPLY(SELECT COUNT(*) Matches,MIN(CONVERT(char(36),FacultyId)) FacultyText FROM paws.Faculty
 WHERE NULLIF(r.FacultySourceName,N'') IS NOT NULL AND (paws_api.CalendarActivityTextKey(DisplayName)=paws_api.CalendarActivityTextKey(r.FacultySourceName)
 OR paws_api.CalendarActivityTextKey(CONCAT(PreferredFirstName,N' ',PreferredLastName))=paws_api.CalendarActivityTextKey(r.FacultySourceName))) names
 LEFT JOIN paws.Faculty f ON f.FacultyId=CASE WHEN NULLIF(r.FacultySourceId,N'') IS NOT NULL THEN TRY_CONVERT(uniqueidentifier,r.FacultySourceId) WHEN names.Matches=1 THEN TRY_CONVERT(uniqueidentifier,names.FacultyText) END
 LEFT JOIN paws.SwapCandidate s ON s.FacultyId=f.FacultyId
 LEFT JOIN paws.Course c ON c.CourseCode COLLATE Latin1_General_100_BIN2=r.CourseCode COLLATE Latin1_General_100_BIN2;
 UPDATE r SET Issues=JSON_MODIFY(Issues,'append $',N'UNRESOLVED_FACULTY') FROM @Rows r WHERE StaffingKind=N'assigned' AND (FacultyId IS NULL OR FacultyKey IS NULL);
 UPDATE r SET Issues=JSON_MODIFY(Issues,'append $',N'INACTIVE_FACULTY') FROM @Rows r JOIN paws.Faculty f ON f.FacultyId=r.FacultyId WHERE f.Active<>1;
 UPDATE r SET Issues=JSON_MODIFY(Issues,'append $',N'IDENTITY_MISMATCH') FROM @Rows r
 WHERE NULLIF(FacultySourceName,N'') IS NOT NULL AND ((SELECT COUNT(*) FROM paws.Faculty f WHERE paws_api.CalendarActivityTextKey(f.DisplayName)=paws_api.CalendarActivityTextKey(r.FacultySourceName)
 OR paws_api.CalendarActivityTextKey(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))=paws_api.CalendarActivityTextKey(r.FacultySourceName))<>1
 OR NOT EXISTS(SELECT 1 FROM paws.Faculty f WHERE f.FacultyId=r.FacultyId AND (paws_api.CalendarActivityTextKey(f.DisplayName)=paws_api.CalendarActivityTextKey(r.FacultySourceName)
 OR paws_api.CalendarActivityTextKey(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))=paws_api.CalendarActivityTextKey(r.FacultySourceName))));
 UPDATE @Rows SET Issues=JSON_MODIFY(Issues,'append $',N'INVALID_FACULTY_ID') WHERE NULLIF(FacultySourceId,N'') IS NOT NULL AND (LEN(FacultySourceId)<>36 OR TRY_CONVERT(uniqueidentifier,FacultySourceId) IS NULL);
 UPDATE @Rows SET Issues=JSON_MODIFY(Issues,'append $',N'UNKNOWN_COURSE') WHERE NULLIF(CourseCode,N'') IS NOT NULL AND CourseId IS NULL;
 UPDATE @Rows SET Issues=JSON_MODIFY(Issues,'append $',N'INVALID_DATE_RANGE') WHERE StartDate IS NULL OR EndDate IS NULL OR EndDate<StartDate OR StartDate<@Start OR EndDate>=@End;
 UPDATE r SET Issues=JSON_MODIFY(r.Issues,'append $',N'DUPLICATE_RESOLVED_ROW') FROM @Rows r WHERE r.SourceColumn IS NULL AND EXISTS(SELECT 1 FROM @Rows d WHERE d.SourceColumn IS NULL AND d.SourceRow<>r.SourceRow AND d.FacultyId=r.FacultyId AND d.StartDate=r.StartDate AND d.EndDate=r.EndDate
 AND (d.CourseId=r.CourseId OR d.CourseId IS NULL AND r.CourseId IS NULL) AND paws_api.CalendarActivityTextKey(d.Label)=paws_api.CalendarActivityTextKey(r.Label));
 UPDATE @Rows SET IdentityDigest=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONCAT(N'unassigned|Locum|',SlotKey)),2) WHERE StaffingKind=N'unassigned';
 RETURN;
END;

GO
ALTER FUNCTION paws_api.CccReplacementSnapshot(@ImportBatchId uniqueidentifier,@Protected bit) RETURNS nvarchar(max)
AS
BEGIN
 DECLARE @Year varchar(7),@Rows nvarchar(max),@Targets nvarchar(max),@Issues nvarchar(max)=N'[]',@Start date,@End date;
 SELECT @Year=AcademicYear,@Rows=RowsJson FROM staging.CccReplacement WHERE ImportBatchId=@ImportBatchId;
 SET @Start=TRY_CONVERT(date,LEFT(@Year,4)+'-05-01');SET @End=DATEADD(year,1,@Start);SET @Targets=paws_api.CccScopeSnapshot(@Year);
 IF @Protected=1 SET @Issues=JSON_MODIFY(@Issues,'append $',N'PROTECTED_REFERENCE');
 IF EXISTS(SELECT 1 FROM OPENJSON(@Targets) WITH(StartDate date '$.startDate',EndDate date '$.endDate') WHERE StartDate<@Start OR EndDate>=@End) SET @Issues=JSON_MODIFY(@Issues,'append $',N'CROSS_YEAR_TARGET');
 IF EXISTS(SELECT 1 FROM OPENJSON(@Targets) WITH(TimeEvidence nvarchar(max) '$.timeEvidence' AS JSON) WHERE TimeEvidence<>N'[]') SET @Issues=JSON_MODIFY(@Issues,'append $',N'TARGET_HAS_TIME_EVIDENCE');
 DECLARE @Snapshot nvarchar(max)=(SELECT @Year academicYear,N'ccc-calendar' dataset,JSON_QUERY(@Issues) issues,JSON_QUERY(@Targets) targets,
 JSON_QUERY((SELECT SourceRow sourceRow,FacultySourceId facultySourceId,FacultySourceName facultySourceName,FacultyId facultyId,FacultyKey facultyKey,DisplayName displayName,IdentityDigest identityDigest,StartDate startDate,EndDate endDate,CourseCode courseCode,CourseId courseId,Label label,JSON_QUERY(Issues) issues
 FROM paws_api.CccReplacementRows(@Rows,@Year) ORDER BY SourceRow FOR JSON PATH,INCLUDE_NULL_VALUES)) rows FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @Format tinyint,@Expected int,@Assigned int,@Unassigned int,@TrustedHash char(64),@SourceManifest char(64),@PayloadManifest char(64);
 SELECT @Format=FormatVersion,@Expected=SourceSlotCount,@Assigned=SourceAssignedCount,@Unassigned=SourceUnassignedCount,@TrustedHash=TrustedRowsSha256,@SourceManifest=SourceManifestSha256,@PayloadManifest=SourcePayloadManifestSha256 FROM staging.CccReplacement WHERE ImportBatchId=@ImportBatchId;
 IF @Format=2
 BEGIN
  IF @TrustedHash<>CONVERT(varchar(64),HASHBYTES('SHA2_256',@Rows),2) OR @Expected<>(SELECT COUNT(*) FROM OPENJSON(@Rows))
   OR @Assigned<>(SELECT COUNT(*) FROM paws_api.CccReplacementRows(@Rows,@Year) WHERE StaffingKind=N'assigned') OR @Unassigned<>(SELECT COUNT(*) FROM paws_api.CccReplacementRows(@Rows,@Year) WHERE StaffingKind=N'unassigned') SET @Issues=JSON_MODIFY(@Issues,'append $',N'TRUSTED_SOURCE_CHANGED');
  SET @Snapshot=JSON_MODIFY(@Snapshot,'$.issues',JSON_QUERY(@Issues));
  SET @Snapshot=JSON_MODIFY(@Snapshot,'$.formatVersion',2);
  SET @Snapshot=JSON_MODIFY(@Snapshot,'$.sourceManifestSha256',@SourceManifest);
  SET @Snapshot=JSON_MODIFY(@Snapshot,'$.sourcePayloadManifestSha256',@PayloadManifest);
  SET @Snapshot=JSON_MODIFY(@Snapshot,'$.sourceRowsSha256',@TrustedHash);
  SET @Snapshot=JSON_MODIFY(@Snapshot,'$.slotCounts',JSON_QUERY((SELECT @Expected total,@Assigned assigned,@Unassigned unassigned FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)));
  SET @Snapshot=JSON_MODIFY(@Snapshot,'$.rows',JSON_QUERY((SELECT SourceRow sourceRow,FacultySourceId facultySourceId,FacultyId facultyId,FacultyKey facultyKey,DisplayName displayName,IdentityDigest identityDigest,StartDate startDate,EndDate endDate,CourseCode courseCode,CourseId courseId,Label label,StaffingKind staffingKind,StaffingLabel staffingLabel,BlockLabel blockLabel,SlotKey slotKey,
   JSON_QUERY((SELECT PhysicalSourceRow row,SourceColumn [column] FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) sourceRef,JSON_QUERY(Issues) issues FROM paws_api.CccReplacementRows(@Rows,@Year) ORDER BY SourceRow FOR JSON PATH,INCLUDE_NULL_VALUES)));
 END;
 RETURN @Snapshot;
END;

GO
ALTER PROCEDURE paws_api.CommitCccReplacement @ActorFirebaseUid nvarchar(128),@ImportBatchId uniqueidentifier,@AcademicYear varchar(32),@Dataset nvarchar(64),@ExpectedVersion varchar(64),@ManifestSha256 varchar(64),@SourceSha256 varchar(64),@IdempotencyKey uniqueidentifier,@Confirm bit,@CompleteDataset bit
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 BEGIN TRY
  BEGIN TRANSACTION;EXEC paws_api.AssertCccAdministrator @ActorFirebaseUid;
  IF @Dataset IS NULL OR @Dataset COLLATE Latin1_General_100_BIN2<>N'ccc-calendar' OR @Confirm IS NULL OR @Confirm<>1 OR @CompleteDataset IS NULL OR @CompleteDataset<>1 OR @IdempotencyKey IS NULL
   OR @ExpectedVersion IS NULL OR DATALENGTH(@ExpectedVersion)<>16 OR TRY_CONVERT(binary(8),@ExpectedVersion,2) IS NULL OR @ManifestSha256 IS NULL OR DATALENGTH(@ManifestSha256)<>64 OR TRY_CONVERT(binary(32),@ManifestSha256,2) IS NULL
   OR @SourceSha256 IS NULL OR DATALENGTH(@SourceSha256)<>64 OR TRY_CONVERT(binary(32),@SourceSha256,2) IS NULL THROW 54902,'Explicit CCC confirmation required.',1;
  DECLARE @Receipt uniqueidentifier,@Replay bit=0;
  SELECT @Receipt=ReceiptId FROM paws.CccReplacementReceipt WITH(UPDLOCK,HOLDLOCK) WHERE IdempotencyKey=@IdempotencyKey;
  IF @Receipt IS NOT NULL
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM paws.CccReplacementReceipt WHERE ReceiptId=@Receipt AND ImportBatchId=@ImportBatchId AND AcademicYear=@AcademicYear AND SourceSha256=UPPER(@SourceSha256) AND ManifestSha256=UPPER(@ManifestSha256) AND ExpectedVersion=CONVERT(binary(8),@ExpectedVersion,2) AND ActorUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND Status=N'committed') THROW 54907,'CCC replay mismatch.',1;
   SET @Replay=1;
  END
  ELSE
  BEGIN
   DECLARE @Version binary(8),@StoredYear varchar(7),@StoredSource char(64),@StoredManifest char(64),@Expires datetime2(7),@Status nvarchar(16),@Rows nvarchar(max),@Sheet uniqueidentifier,@Snapshot nvarchar(max),@Protected bit,@Before nvarchar(max),@After nvarchar(max),@Deleted int,@Inserted int;
   SELECT @Version=PreviewVersion,@StoredYear=AcademicYear,@StoredSource=SourceSha256,@StoredManifest=ManifestSha256,@Expires=ExpiresAtUtc,@Status=Status,@Rows=RowsJson,@Sheet=ImportSheetId FROM staging.CccReplacement WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@ImportBatchId;
   IF @Version IS NULL THROW 54903,'CCC batch not found.',1;
   IF @Status<>N'staged' OR CONVERT(binary(8),@ExpectedVersion,2)<>@Version OR @StoredYear<>@AcademicYear OR DATALENGTH(@AcademicYear)<>7 OR @AcademicYear IS NULL OR @StoredSource<>UPPER(@SourceSha256) OR @StoredManifest IS NULL OR @StoredManifest<>UPPER(@ManifestSha256) THROW 54904,'CCC preview changed.',1;
   IF @Expires IS NULL OR @Expires<=SYSUTCDATETIME() THROW 54905,'CCC preview expired.',1;
   EXEC paws_api.LockCccReplacementScope @StoredYear,@Rows;
   SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
   EXEC paws_api.CalendarActivityProtectedReferences N'activity',@Protected OUTPUT;
   SET @Snapshot=paws_api.CccReplacementSnapshot(@ImportBatchId,@Protected);
   IF CONVERT(varchar(64),HASHBYTES('SHA2_256',@Snapshot),2)<>@StoredManifest THROW 54904,'CCC source identity or target set changed.',1;
   IF @Protected=1 OR JSON_QUERY(@Snapshot,'$.issues')<>N'[]' THROW 54908,'Protected CCC target.',1;
   IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Snapshot,'$.rows')) OR EXISTS(SELECT 1 FROM OPENJSON(@Snapshot,'$.rows') WITH(Issues nvarchar(max) '$.issues' AS JSON) WHERE Issues<>N'[]' OR Issues IS NULL) THROW 54906,'Resolve all CCC source issues.',1;
   SET @Before=JSON_QUERY(@Snapshot,'$.targets');SET @Receipt=NEWID();
   -- Immutable per-person history; no receipt recovery JSON is delivered by history.
   INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,BeforeJson,RequestId,ImportBatchId)
    SELECT NEWID(),N'ccc_activity_removed',N'calendar_activity',JSON_VALUE(value,'$.activityId'),@ActorFirebaseUid,SYSUTCDATETIME(),
    (SELECT JSON_VALUE(value,'$.facultyId') facultyId,JSON_VALUE(value,'$.label') label,N'ccc' category,JSON_VALUE(value,'$.startDate') startDate,JSON_VALUE(value,'$.endDate') endDate,JSON_VALUE(value,'$.courseCode') courseCode,JSON_VALUE(value,'$.staffingKind') staffingKind,JSON_VALUE(value,'$.staffingLabel') staffingLabel,JSON_VALUE(value,'$.blockLabel') blockLabel FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@IdempotencyKey,@ImportBatchId FROM OPENJSON(@Before);
   DELETE a FROM paws.CalendarActivity a JOIN OPENJSON(@Before) WITH(ActivityId uniqueidentifier '$.activityId') b ON b.ActivityId=a.ActivityId;SET @Deleted=@@ROWCOUNT;
   INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,CourseId,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid,StaffingKind,StaffingLabel,BlockLabel,SourceColumn,SourceSlotKey)
    SELECT NEWID(),r.FacultyId,N'ccc',r.Label,r.StartDate,r.EndDate,r.CourseId,@ImportBatchId,raw.ImportRowId,@StoredSource,N'CCC',COALESCE(r.PhysicalSourceRow,r.SourceRow),@ActorFirebaseUid,r.StaffingKind,r.StaffingLabel,r.BlockLabel,r.SourceColumn,r.SlotKey
    FROM paws_api.CccReplacementRows(@Rows,@StoredYear) r JOIN staging.ImportRow raw ON raw.ImportSheetId=@Sheet AND raw.SourceRowNumber=r.SourceRow;SET @Inserted=@@ROWCOUNT;
   IF @Inserted<>(SELECT COUNT(*) FROM OPENJSON(@Snapshot,'$.rows')) OR @Deleted<>(SELECT COUNT(*) FROM OPENJSON(@Before)) THROW 54904,'CCC row set changed.',1;
   SET @After=paws_api.CccScopeSnapshot(@StoredYear);
   INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,AfterJson,RequestId,ImportBatchId)
    SELECT NEWID(),N'ccc_activity_added',N'calendar_activity',JSON_VALUE(value,'$.activityId'),@ActorFirebaseUid,SYSUTCDATETIME(),
    (SELECT JSON_VALUE(value,'$.facultyId') facultyId,JSON_VALUE(value,'$.label') label,N'ccc' category,JSON_VALUE(value,'$.startDate') startDate,JSON_VALUE(value,'$.endDate') endDate,JSON_VALUE(value,'$.courseCode') courseCode,JSON_VALUE(value,'$.staffingKind') staffingKind,JSON_VALUE(value,'$.staffingLabel') staffingLabel,JSON_VALUE(value,'$.blockLabel') blockLabel FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@IdempotencyKey,@ImportBatchId FROM OPENJSON(@After);
   INSERT paws.CccReplacementReceipt(ReceiptId,ImportBatchId,AcademicYear,SourceSha256,ManifestSha256,ExpectedVersion,IdempotencyKey,ActorUid,BeforeRowsJson,AfterScopeJson,DeletedCount,InsertedCount)
    VALUES(@Receipt,@ImportBatchId,@StoredYear,@StoredSource,@StoredManifest,@Version,@IdempotencyKey,@ActorFirebaseUid,@Before,@After,@Deleted,@Inserted);
   UPDATE staging.CccReplacement SET Status=N'committed' WHERE ImportBatchId=@ImportBatchId;
   UPDATE staging.ImportBatch SET Status=N'ccc_committed',CompletedAtUtc=SYSUTCDATETIME() WHERE ImportBatchId=@ImportBatchId;
  END;
  DECLARE @Response nvarchar(max)=(SELECT ReceiptId receiptId,DeletedCount deletedCount,InsertedCount insertedCount,CommittedAtUtc committedAtUtc,@Replay idempotentReplay FROM paws.CccReplacementReceipt WHERE ReceiptId=@Receipt FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  COMMIT;SELECT @Response responseJson;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;

GO
CREATE PROCEDURE paws_api.StageMasterCccReplacement
 @ActorFirebaseUid nvarchar(128),@RequestId uniqueidentifier,@FileName nvarchar(180),@ByteLength int,@PayloadJson nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC paws_api.AssertMasterRefreshOperator @ActorFirebaseUid;
  IF @RequestId IS NULL OR @ByteLength IS NULL OR @ByteLength NOT BETWEEN 1 AND 16777216 OR NULLIF(@FileName,N'') IS NULL OR @FileName LIKE N'%/%' OR @FileName LIKE N'%\%' OR @FileName NOT LIKE N'%.xlsx'
   OR ISNULL(ISJSON(@PayloadJson),0)<>1 OR DATALENGTH(@PayloadJson)>33554432 OR ISNULL(JSON_VALUE(@PayloadJson,'$.schemaVersion'),'')<>'2' THROW 54902,'Invalid trusted CCC payload.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@PayloadJson) WHERE [key] COLLATE Latin1_General_100_BIN2 NOT IN(N'schemaVersion',N'academicYear',N'sourceSha256',N'sourceManifestSha256',N'slotCounts',N'rows',N'manifestSha256')) THROW 54902,'Unexpected trusted CCC fields.',1;
  DECLARE @Year varchar(32)=JSON_VALUE(@PayloadJson,'$.academicYear'),@Source varchar(64)=JSON_VALUE(@PayloadJson,'$.sourceSha256'),@SourceManifest varchar(64)=JSON_VALUE(@PayloadJson,'$.sourceManifestSha256'),@PayloadManifest varchar(64)=JSON_VALUE(@PayloadJson,'$.manifestSha256'),@Rows nvarchar(max)=JSON_QUERY(@PayloadJson,'$.rows');
  DECLARE @Total int=TRY_CONVERT(int,JSON_VALUE(@PayloadJson,'$.slotCounts.total')),@Assigned int=TRY_CONVERT(int,JSON_VALUE(@PayloadJson,'$.slotCounts.assigned')),@Unassigned int=TRY_CONVERT(int,JSON_VALUE(@PayloadJson,'$.slotCounts.unassigned'));
  IF LEN(ISNULL(@Year,''))<>7 OR TRY_CONVERT(int,LEFT(@Year,4)) NOT BETWEEN 1900 AND 9998 OR @Year<>CONCAT(LEFT(@Year,4),'-',RIGHT(CONVERT(varchar(4),TRY_CONVERT(int,LEFT(@Year,4))+1),2))
   OR LEN(ISNULL(@Source,''))<>64 OR TRY_CONVERT(binary(32),@Source,2) IS NULL OR LEN(ISNULL(@SourceManifest,''))<>64 OR TRY_CONVERT(binary(32),@SourceManifest,2) IS NULL OR LEN(ISNULL(@PayloadManifest,''))<>64 OR TRY_CONVERT(binary(32),@PayloadManifest,2) IS NULL
   OR @Rows IS NULL OR LEFT(LTRIM(@Rows),1)<>N'[' OR @Total IS NULL OR @Assigned IS NULL OR @Unassigned IS NULL OR @Total NOT BETWEEN 1 AND 5000 OR @Assigned<0 OR @Unassigned<0 OR @Assigned+@Unassigned<>@Total OR @Total<>(SELECT COUNT(*) FROM OPENJSON(@Rows)) THROW 54902,'Incomplete trusted CCC source.',1;
  DECLARE @Items TABLE(n int PRIMARY KEY,Ordinal int,Kind int,FacultyId uniqueidentifier,RawFaculty nvarchar(100),StaffingKind nvarchar(16),StaffingLabel nvarchar(32),PhysicalRow int,SourceColumn nvarchar(4),SlotKey nvarchar(320),RowJson nvarchar(max));
  INSERT @Items SELECT TRY_CONVERT(int,j.[key]),TRY_CONVERT(int,JSON_VALUE(j.value,'$.sourceRow')),j.type,TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.value,'$.facultySourceId')),JSON_VALUE(j.value,'$.facultySourceId'),JSON_VALUE(j.value,'$.staffingKind'),JSON_VALUE(j.value,'$.staffingLabel'),TRY_CONVERT(int,JSON_VALUE(j.value,'$.sourceRef.row')),JSON_VALUE(j.value,'$.sourceRef.column'),JSON_VALUE(j.value,'$.slotKey'),j.value FROM OPENJSON(@Rows) j;
  IF @Assigned<>(SELECT COUNT(*) FROM @Items WHERE StaffingKind COLLATE Latin1_General_100_BIN2=N'assigned') OR @Unassigned<>(SELECT COUNT(*) FROM @Items WHERE StaffingKind COLLATE Latin1_General_100_BIN2=N'unassigned') THROW 54902,'Trusted CCC staffing counts changed.',1;
  IF EXISTS(SELECT 1 FROM @Items WHERE Kind<>5 OR Ordinal IS NULL OR Ordinal<>n+2 OR PhysicalRow IS NULL OR PhysicalRow<2 OR SourceColumn IS NULL OR SourceColumn COLLATE Latin1_General_100_BIN2 NOT IN(N'C',N'D',N'E') OR SlotKey IS NULL OR SlotKey COLLATE Latin1_General_100_BIN2<>CONCAT(N'CCC!',SourceColumn,PhysicalRow) COLLATE Latin1_General_100_BIN2
   OR ISNULL(UPPER(JSON_VALUE(RowJson,'$.sourceRef.sha256')),'')<>UPPER(@Source) OR ISNULL(JSON_VALUE(RowJson,'$.sourceRef.sheet'),'') COLLATE Latin1_General_100_BIN2<>N'CCC'
   OR ISNULL(JSON_QUERY(RowJson,'$.issues'),'')<>N'[]' OR JSON_VALUE(RowJson,'$.facultySourceName') IS NOT NULL
   OR(StaffingKind=N'assigned' AND(FacultyId IS NULL OR LEN(RawFaculty)<>36 OR StaffingLabel IS NOT NULL))
   OR(StaffingKind=N'unassigned' AND(RawFaculty IS NOT NULL OR StaffingLabel IS NULL OR StaffingLabel COLLATE Latin1_General_100_BIN2<>N'Locum' OR ISNULL(JSON_VALUE(RowJson,'$.sourceEvidence.sourceName'),'') COLLATE Latin1_General_100_BIN2<>N'Locum')))
   OR EXISTS(SELECT 1 FROM @Items a JOIN @Items b ON a.n<b.n AND a.SlotKey=b.SlotKey)
   OR EXISTS(SELECT 1 FROM @Items i CROSS APPLY OPENJSON(i.RowJson) p WHERE p.[key] COLLATE Latin1_General_100_BIN2 NOT IN(N'sourceRow',N'facultySourceId',N'facultySourceName',N'startDate',N'endDate',N'courseCode',N'label',N'staffingKind',N'staffingLabel',N'blockLabel',N'slotKey',N'sourceRef',N'sourceEvidence',N'issues')) THROW 54902,'Invalid trusted CCC staffing rows.',1;
  IF EXISTS(SELECT 1 FROM paws_api.CccReplacementRows(@Rows,@Year) WHERE Issues<>N'[]') THROW 54906,'Trusted CCC source identities or dates require review.',1;
  IF EXISTS(SELECT 1 FROM staging.CccReplacement WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@RequestId)
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM staging.CccReplacement WHERE ImportBatchId=@RequestId AND FormatVersion=2 AND AcademicYear=@Year AND SourceSha256=UPPER(@Source) AND SourceManifestSha256=UPPER(@SourceManifest) AND SourcePayloadManifestSha256=UPPER(@PayloadManifest) AND RowsJson COLLATE Latin1_General_100_BIN2=@Rows COLLATE Latin1_General_100_BIN2 AND ActorFirebaseUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2) THROW 54907,'Trusted CCC request key conflict.',1;
   COMMIT;EXEC paws_api.GetCccReplacement @ActorFirebaseUid,@RequestId;RETURN;
  END;
  DECLARE @Workbook uniqueidentifier=NEWID(),@Sheet uniqueidentifier=NEWID();
  INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@RequestId,SYSUTCDATETIME(),N'ccc_staged',UPPER(@Source),N'ccc-master-v2',N'{}');
  INSERT staging.ImportWorkbook(ImportWorkbookId,ImportBatchId,FileName,FileSha256,FileByteLength) VALUES(@Workbook,@RequestId,@FileName,UPPER(@Source),@ByteLength);
  INSERT staging.ImportSheet(ImportSheetId,ImportWorkbookId,SheetName,SheetIndex,MaxRow,MaxColumn,NonEmptyRowCount) VALUES(@Sheet,@Workbook,N'CCC',1,@Total+1,5,@Total);
  INSERT staging.ImportRow(ImportRowId,ImportSheetId,SourceRowNumber,RawJson,ValidationStatus,ValidationErrorsJson) SELECT NEWID(),@Sheet,Ordinal,RowJson,N'ccc_staged',N'[]' FROM @Items;
  INSERT staging.CccReplacement(ImportBatchId,ImportSheetId,AcademicYear,SourceSha256,RowsJson,ActorFirebaseUid,FormatVersion,SourceManifestSha256,SourcePayloadManifestSha256,TrustedRowsSha256,SourceSlotCount,SourceAssignedCount,SourceUnassignedCount)
   VALUES(@RequestId,@Sheet,@Year,UPPER(@Source),@Rows,@ActorFirebaseUid,2,UPPER(@SourceManifest),UPPER(@PayloadManifest),CONVERT(varchar(64),HASHBYTES('SHA2_256',@Rows),2),@Total,@Assigned,@Unassigned);
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson,RequestId,ImportBatchId) VALUES(NEWID(),N'ccc_replacement_staged',N'ccc_replacement',CONVERT(nvarchar(36),@RequestId),@ActorFirebaseUid,SYSUTCDATETIME(),(SELECT CAST(0 AS bit) businessWrites,@Total total,@Assigned assigned,@Unassigned unassigned,ORIGINAL_LOGIN() operatorLogin FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@RequestId,@RequestId);
  COMMIT;EXEC paws_api.GetCccReplacement @ActorFirebaseUid,@RequestId;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON OBJECT::paws_api.StageMasterCccReplacement TO paws_master_refresh_operator;

UPDATE staging.MasterCccSchemaBaseline SET AfterSha256=CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'paws_api.'+ObjectName))),2);
COMMIT;
GO
