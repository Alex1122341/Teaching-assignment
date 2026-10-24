/* Explicit whole-year CCC replacement. No memberships or business cutover. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws.AfcFormDocument') IS NULL OR OBJECT_ID(N'paws_api.AcquireCalendarActivityFacultyLocks') IS NULL THROW 54900,'CCC prerequisites are missing.',1;
IF OBJECT_ID(N'staging.CccReplacement') IS NOT NULL THROW 54900,'Inspect existing CCC replacement objects.',1;
BEGIN TRANSACTION;
CREATE TABLE staging.CccReplacement(
 ImportBatchId uniqueidentifier NOT NULL PRIMARY KEY REFERENCES staging.ImportBatch(ImportBatchId),
 ImportSheetId uniqueidentifier NOT NULL REFERENCES staging.ImportSheet(ImportSheetId),
 AcademicYear varchar(7) NOT NULL,SourceSha256 char(64) NOT NULL,RowsJson nvarchar(max) NOT NULL CHECK(ISJSON(RowsJson)=1),
 ActorFirebaseUid nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
 Status nvarchar(16) NOT NULL DEFAULT N'staged' CHECK(Status IN(N'staged',N'committed',N'recovered')),
 PreviewJson nvarchar(max) NULL CHECK(PreviewJson IS NULL OR ISJSON(PreviewJson)=1),ManifestSha256 char(64) NULL,ExpiresAtUtc datetime2(7) NULL,
 PreviewVersion rowversion NOT NULL
);
CREATE TABLE paws.CccReplacementReceipt(
 ReceiptId uniqueidentifier NOT NULL PRIMARY KEY,ImportBatchId uniqueidentifier NOT NULL UNIQUE REFERENCES staging.CccReplacement(ImportBatchId),
 AcademicYear varchar(7) NOT NULL,SourceSha256 char(64) NOT NULL,ManifestSha256 char(64) NOT NULL,ExpectedVersion binary(8) NOT NULL,
 IdempotencyKey uniqueidentifier NOT NULL UNIQUE,ActorUid nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
 BeforeRowsJson nvarchar(max) NOT NULL CHECK(ISJSON(BeforeRowsJson)=1),AfterScopeJson nvarchar(max) NOT NULL CHECK(ISJSON(AfterScopeJson)=1),
 DeletedCount int NOT NULL,InsertedCount int NOT NULL,CommittedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 Status nvarchar(16) NOT NULL DEFAULT N'committed' CHECK(Status IN(N'committed',N'recovered'))
);
GO
CREATE FUNCTION paws_api.CccReplacementRows(@RowsJson nvarchar(max),@AcademicYear varchar(7))
RETURNS @Rows TABLE(SourceRow int,FacultySourceId nvarchar(100),FacultySourceName nvarchar(256),FacultyId uniqueidentifier,
 FacultyKey uniqueidentifier,DisplayName nvarchar(512),IdentityDigest varchar(64),StartDate date,EndDate date,CourseCode nvarchar(64),CourseId uniqueidentifier,Label nvarchar(300),Issues nvarchar(max))
AS
BEGIN
 DECLARE @Start date=TRY_CONVERT(date,LEFT(@AcademicYear,4)+'-05-01'),@End date=DATEADD(year,1,TRY_CONVERT(date,LEFT(@AcademicYear,4)+'-05-01'));
 INSERT @Rows
 SELECT r.SourceRow,r.FacultySourceId,r.FacultySourceName,f.FacultyId,s.CandidateKey,f.DisplayName,
 CONVERT(varchar(64),HASHBYTES('SHA2_256',CONCAT(CONVERT(char(36),f.FacultyId),N'|',f.DisplayName,N'|',f.PreferredFirstName,N'|',f.PreferredLastName,N'|',f.Active,N'|',CONVERT(nvarchar(33),f.UpdatedAtUtc,126),N'|',CONVERT(char(36),s.CandidateKey))),2),
 TRY_CONVERT(date,r.StartDate),TRY_CONVERT(date,r.EndDate),r.CourseCode,c.CourseId,COALESCE(NULLIF(r.Label,N''),N'CCC'),COALESCE(r.Issues,N'[]')
 FROM OPENJSON(@RowsJson) WITH(SourceRow int '$.sourceRow',FacultySourceId nvarchar(100) '$.facultySourceId',FacultySourceName nvarchar(256) '$.facultySourceName',StartDate varchar(20) '$.startDate',EndDate varchar(20) '$.endDate',CourseCode nvarchar(64) '$.courseCode',Label nvarchar(300) '$.label',Issues nvarchar(max) '$.issues' AS JSON) r
 OUTER APPLY(SELECT COUNT(*) Matches,MIN(CONVERT(char(36),FacultyId)) FacultyText FROM paws.Faculty
 WHERE NULLIF(r.FacultySourceName,N'') IS NOT NULL AND (paws_api.CalendarActivityTextKey(DisplayName)=paws_api.CalendarActivityTextKey(r.FacultySourceName)
 OR paws_api.CalendarActivityTextKey(CONCAT(PreferredFirstName,N' ',PreferredLastName))=paws_api.CalendarActivityTextKey(r.FacultySourceName))) names
 LEFT JOIN paws.Faculty f ON f.FacultyId=CASE WHEN NULLIF(r.FacultySourceId,N'') IS NOT NULL THEN TRY_CONVERT(uniqueidentifier,r.FacultySourceId) WHEN names.Matches=1 THEN TRY_CONVERT(uniqueidentifier,names.FacultyText) END
 LEFT JOIN paws.SwapCandidate s ON s.FacultyId=f.FacultyId
 LEFT JOIN paws.Course c ON c.CourseCode COLLATE Latin1_General_100_BIN2=r.CourseCode COLLATE Latin1_General_100_BIN2;
 UPDATE r SET Issues=JSON_MODIFY(Issues,'append $',N'UNRESOLVED_FACULTY') FROM @Rows r WHERE FacultyId IS NULL OR FacultyKey IS NULL;
 UPDATE r SET Issues=JSON_MODIFY(Issues,'append $',N'INACTIVE_FACULTY') FROM @Rows r JOIN paws.Faculty f ON f.FacultyId=r.FacultyId WHERE f.Active<>1;
 UPDATE r SET Issues=JSON_MODIFY(Issues,'append $',N'IDENTITY_MISMATCH') FROM @Rows r
 WHERE NULLIF(FacultySourceName,N'') IS NOT NULL AND ((SELECT COUNT(*) FROM paws.Faculty f WHERE paws_api.CalendarActivityTextKey(f.DisplayName)=paws_api.CalendarActivityTextKey(r.FacultySourceName)
 OR paws_api.CalendarActivityTextKey(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))=paws_api.CalendarActivityTextKey(r.FacultySourceName))<>1
 OR NOT EXISTS(SELECT 1 FROM paws.Faculty f WHERE f.FacultyId=r.FacultyId AND (paws_api.CalendarActivityTextKey(f.DisplayName)=paws_api.CalendarActivityTextKey(r.FacultySourceName)
 OR paws_api.CalendarActivityTextKey(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))=paws_api.CalendarActivityTextKey(r.FacultySourceName))));
 UPDATE @Rows SET Issues=JSON_MODIFY(Issues,'append $',N'INVALID_FACULTY_ID') WHERE NULLIF(FacultySourceId,N'') IS NOT NULL AND (LEN(FacultySourceId)<>36 OR TRY_CONVERT(uniqueidentifier,FacultySourceId) IS NULL);
 UPDATE @Rows SET Issues=JSON_MODIFY(Issues,'append $',N'UNKNOWN_COURSE') WHERE NULLIF(CourseCode,N'') IS NOT NULL AND CourseId IS NULL;
 UPDATE @Rows SET Issues=JSON_MODIFY(Issues,'append $',N'INVALID_DATE_RANGE') WHERE StartDate IS NULL OR EndDate IS NULL OR EndDate<StartDate OR StartDate<@Start OR EndDate>=@End;
 UPDATE r SET Issues=JSON_MODIFY(r.Issues,'append $',N'DUPLICATE_RESOLVED_ROW') FROM @Rows r WHERE EXISTS(SELECT 1 FROM @Rows d WHERE d.SourceRow<>r.SourceRow AND d.FacultyId=r.FacultyId AND d.StartDate=r.StartDate AND d.EndDate=r.EndDate
 AND (d.CourseId=r.CourseId OR d.CourseId IS NULL AND r.CourseId IS NULL) AND paws_api.CalendarActivityTextKey(d.Label)=paws_api.CalendarActivityTextKey(r.Label));
 RETURN;
END;
GO
CREATE FUNCTION paws_api.CccScopeSnapshot(@AcademicYear varchar(7)) RETURNS nvarchar(max)
AS
BEGIN
 DECLARE @Start date=TRY_CONVERT(date,LEFT(@AcademicYear,4)+'-05-01'),@End date=DATEADD(year,1,TRY_CONVERT(date,LEFT(@AcademicYear,4)+'-05-01'));
 RETURN(SELECT a.ActivityId activityId,a.FacultyId facultyId,a.Category category,a.OriginalLabel label,a.StartDate startDate,a.EndDate endDate,a.CourseId courseId,c.CourseCode courseCode,
 a.ImportBatchId importBatchId,a.ImportRowId importRowId,a.SourceSha256 sourceSha256,a.SourceSheet sourceSheet,a.SourceRow sourceRow,
 a.CreatedByUid createdByUid,a.CreatedAtUtc createdAtUtc,a.UpdatedAtUtc updatedAtUtc,CONVERT(varchar(16),CONVERT(binary(8),a.ActivityVersion),2) version,
 JSON_QUERY((SELECT ActivityDate date,StartTime startTime,EndTime endTime,EvidenceRef evidenceRef,EvidenceNote evidenceNote,ActorUid actorUid,UpdatedAtUtc updatedAtUtc,CONVERT(varchar(16),CONVERT(binary(8),TimeVersion),2) version FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId ORDER BY ActivityDate FOR JSON PATH,INCLUDE_NULL_VALUES)) timeEvidence
 FROM paws.CalendarActivity a LEFT JOIN paws.Course c ON c.CourseId=a.CourseId
 WHERE a.Category=N'ccc' AND a.StartDate<@End AND a.EndDate>=@Start ORDER BY a.StartDate,a.ActivityId FOR JSON PATH,INCLUDE_NULL_VALUES);
END;
GO
CREATE FUNCTION paws_api.CccReplacementSnapshot(@ImportBatchId uniqueidentifier,@Protected bit) RETURNS nvarchar(max)
AS
BEGIN
 DECLARE @Year varchar(7),@Rows nvarchar(max),@Targets nvarchar(max),@Issues nvarchar(max)=N'[]',@Start date,@End date;
 SELECT @Year=AcademicYear,@Rows=RowsJson FROM staging.CccReplacement WHERE ImportBatchId=@ImportBatchId;
 SET @Start=TRY_CONVERT(date,LEFT(@Year,4)+'-05-01');SET @End=DATEADD(year,1,@Start);SET @Targets=paws_api.CccScopeSnapshot(@Year);
 IF @Protected=1 SET @Issues=JSON_MODIFY(@Issues,'append $',N'PROTECTED_REFERENCE');
 IF EXISTS(SELECT 1 FROM OPENJSON(@Targets) WITH(StartDate date '$.startDate',EndDate date '$.endDate') WHERE StartDate<@Start OR EndDate>=@End) SET @Issues=JSON_MODIFY(@Issues,'append $',N'CROSS_YEAR_TARGET');
 IF EXISTS(SELECT 1 FROM OPENJSON(@Targets) WITH(TimeEvidence nvarchar(max) '$.timeEvidence' AS JSON) WHERE TimeEvidence<>N'[]') SET @Issues=JSON_MODIFY(@Issues,'append $',N'TARGET_HAS_TIME_EVIDENCE');
 RETURN(SELECT @Year academicYear,N'ccc-calendar' dataset,JSON_QUERY(@Issues) issues,JSON_QUERY(@Targets) targets,
 JSON_QUERY((SELECT SourceRow sourceRow,FacultySourceId facultySourceId,FacultySourceName facultySourceName,FacultyId facultyId,FacultyKey facultyKey,DisplayName displayName,IdentityDigest identityDigest,StartDate startDate,EndDate endDate,CourseCode courseCode,CourseId courseId,Label label,JSON_QUERY(Issues) issues
 FROM paws_api.CccReplacementRows(@Rows,@Year) ORDER BY SourceRow FOR JSON PATH,INCLUDE_NULL_VALUES)) rows FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END;
GO
CREATE PROCEDURE paws_api.AssertCccAdministrator @ActorFirebaseUid nvarchar(128)
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 OR NOT EXISTS(SELECT 1 FROM paws.UserProfile WITH(HOLDLOCK) WHERE FirebaseUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND Active=1 AND MustChangePassword=0
 AND LOWER(BaseRole) COLLATE Latin1_General_100_BIN2 IN(N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin')) THROW 54901,'CCC administrator required.',1;
END;
GO
CREATE PROCEDURE paws_api.GetCccReplacement @ActorFirebaseUid nvarchar(128),@ImportBatchId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 BEGIN TRY
  BEGIN TRANSACTION;EXEC paws_api.AssertCccAdministrator @ActorFirebaseUid;
  IF NOT EXISTS(SELECT 1 FROM staging.CccReplacement WHERE ImportBatchId=@ImportBatchId) THROW 54903,'CCC batch not found.',1;
  DECLARE @Protected bit;EXEC paws_api.CalendarActivityProtectedReferences N'activity',@Protected OUTPUT;
  DECLARE @Response nvarchar(max)=(SELECT ImportBatchId batchId,AcademicYear academicYear,N'ccc-calendar' dataset,SourceSha256 sourceSha256,Status status,CONVERT(varchar(16),CONVERT(binary(8),PreviewVersion),2) previewVersion,ManifestSha256 manifestSha256,ExpiresAtUtc expiresAtUtc,
   JSON_QUERY(COALESCE(PreviewJson,paws_api.CccReplacementSnapshot(@ImportBatchId,@Protected))) preview
   FROM staging.CccReplacement WHERE ImportBatchId=@ImportBatchId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
  COMMIT;SELECT @Response responseJson;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE paws_api.StageCccReplacement @ActorFirebaseUid nvarchar(128),@RequestId uniqueidentifier,@SourceSha256 varchar(64),@AcademicYear varchar(32),@FileName nvarchar(180),@ByteLength int,@RowsJson nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 BEGIN TRY
  BEGIN TRANSACTION;EXEC paws_api.AssertCccAdministrator @ActorFirebaseUid;
  DECLARE @Year int=TRY_CONVERT(int,LEFT(@AcademicYear,4));
  IF @Year NOT BETWEEN 1900 AND 9998 OR @Year IS NULL OR DATALENGTH(@AcademicYear)<>7 OR @AcademicYear<>CONCAT(@Year,'-',RIGHT(CONVERT(varchar(4),@Year+1),2))
   OR @RequestId IS NULL OR @SourceSha256 IS NULL OR DATALENGTH(@SourceSha256)<>64 OR TRY_CONVERT(binary(32),@SourceSha256,2) IS NULL
   OR @ByteLength IS NULL OR @ByteLength NOT BETWEEN 1 AND 524288 OR @FileName IS NULL OR LEN(@FileName)=0 OR LOWER(RIGHT(@FileName,5))<>N'.xlsx' OR @FileName LIKE N'%[/\:*?"<>|]%' OR CHARINDEX(NCHAR(10),@FileName)>0 OR CHARINDEX(NCHAR(13),@FileName)>0
   OR ISJSON(@RowsJson)<>1 OR LEFT(LTRIM(@RowsJson),1)<>N'[' OR DATALENGTH(@RowsJson)>8388608 THROW 54902,'Invalid CCC source envelope.',1;
  IF (SELECT COUNT(*) FROM OPENJSON(@RowsJson)) NOT BETWEEN 1 AND 5000 OR EXISTS(SELECT 1 FROM OPENJSON(@RowsJson) WHERE type<>5)
   OR EXISTS(SELECT 1 FROM OPENJSON(@RowsJson) j CROSS APPLY OPENJSON(j.value) p WHERE p.[key] COLLATE Latin1_General_100_BIN2 NOT IN(N'sourceRow',N'facultySourceId',N'facultySourceName',N'startDate',N'endDate',N'courseCode',N'label',N'issues'))
   OR EXISTS(SELECT 1 FROM OPENJSON(@RowsJson) WITH(SourceRow int '$.sourceRow',Issues nvarchar(max) '$.issues' AS JSON) WHERE SourceRow IS NULL OR SourceRow<2 OR Issues IS NULL OR LEFT(LTRIM(Issues),1)<>N'[')
   OR EXISTS(SELECT 1 FROM OPENJSON(@RowsJson) WITH(SourceRow int '$.sourceRow') GROUP BY SourceRow HAVING COUNT(*)>1) THROW 54902,'Invalid CCC source rows.',1;
  IF EXISTS(SELECT 1 FROM staging.CccReplacement WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@RequestId)
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM staging.CccReplacement r JOIN staging.ImportSheet s ON s.ImportSheetId=r.ImportSheetId JOIN staging.ImportWorkbook w ON w.ImportWorkbookId=s.ImportWorkbookId
    WHERE r.ImportBatchId=@RequestId AND r.ActorFirebaseUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND r.AcademicYear=@AcademicYear AND r.SourceSha256=UPPER(@SourceSha256)
    AND r.RowsJson COLLATE Latin1_General_100_BIN2=@RowsJson COLLATE Latin1_General_100_BIN2 AND w.FileName COLLATE Latin1_General_100_BIN2=@FileName COLLATE Latin1_General_100_BIN2 AND w.FileByteLength=@ByteLength) THROW 54907,'CCC request key mismatch.',1;
   COMMIT;EXEC paws_api.GetCccReplacement @ActorFirebaseUid,@RequestId;RETURN;
  END;
  DECLARE @Workbook uniqueidentifier=NEWID(),@Sheet uniqueidentifier=NEWID();
  INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@RequestId,SYSUTCDATETIME(),N'ccc_staged',UPPER(@SourceSha256),N'ccc-replacement-v1',N'{}');
  INSERT staging.ImportWorkbook(ImportWorkbookId,ImportBatchId,FileName,FileSha256,FileByteLength) VALUES(@Workbook,@RequestId,@FileName,UPPER(@SourceSha256),@ByteLength);
  INSERT staging.ImportSheet(ImportSheetId,ImportWorkbookId,SheetName,SheetIndex,MaxRow,MaxColumn,NonEmptyRowCount) SELECT @Sheet,@Workbook,N'CCC',1,MAX(TRY_CONVERT(int,JSON_VALUE(value,'$.sourceRow'))),6,COUNT(*) FROM OPENJSON(@RowsJson);
  INSERT staging.ImportRow(ImportRowId,ImportSheetId,SourceRowNumber,RawJson,ValidationStatus,ValidationErrorsJson)
   SELECT NEWID(),@Sheet,TRY_CONVERT(int,JSON_VALUE(value,'$.sourceRow')),value,N'ccc_staged',JSON_QUERY(value,'$.issues') FROM OPENJSON(@RowsJson);
  INSERT staging.CccReplacement(ImportBatchId,ImportSheetId,AcademicYear,SourceSha256,RowsJson,ActorFirebaseUid) VALUES(@RequestId,@Sheet,@AcademicYear,UPPER(@SourceSha256),@RowsJson,@ActorFirebaseUid);
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson,RequestId,ImportBatchId) VALUES(NEWID(),N'ccc_replacement_staged',N'ccc_replacement',CONVERT(nvarchar(36),@RequestId),@ActorFirebaseUid,SYSUTCDATETIME(),N'{"businessWrites":false}',@RequestId,@RequestId);
  COMMIT;EXEC paws_api.GetCccReplacement @ActorFirebaseUid,@RequestId;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE paws_api.PreviewCccReplacement @ActorFirebaseUid nvarchar(128),@ImportBatchId uniqueidentifier,@ExpectedVersion varchar(64)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 BEGIN TRY
  BEGIN TRANSACTION;EXEC paws_api.AssertCccAdministrator @ActorFirebaseUid;
  DECLARE @Version binary(8),@Status nvarchar(16),@Snapshot nvarchar(max),@Protected bit;
  SELECT @Version=PreviewVersion,@Status=Status FROM staging.CccReplacement WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@ImportBatchId;
  IF @Version IS NULL THROW 54903,'CCC batch not found.',1;
  IF @ExpectedVersion IS NULL OR DATALENGTH(@ExpectedVersion)<>16 OR TRY_CONVERT(binary(8),@ExpectedVersion,2)<>@Version OR TRY_CONVERT(binary(8),@ExpectedVersion,2) IS NULL OR @Status<>N'staged' THROW 54904,'CCC preview changed.',1;
  EXEC paws_api.CalendarActivityProtectedReferences N'activity',@Protected OUTPUT;SET @Snapshot=paws_api.CccReplacementSnapshot(@ImportBatchId,@Protected);
  UPDATE staging.CccReplacement SET PreviewJson=@Snapshot,ManifestSha256=CONVERT(varchar(64),HASHBYTES('SHA2_256',@Snapshot),2),ExpiresAtUtc=DATEADD(minute,15,SYSUTCDATETIME()) WHERE ImportBatchId=@ImportBatchId;
  COMMIT;EXEC paws_api.GetCccReplacement @ActorFirebaseUid,@ImportBatchId;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE paws_api.LockCccReplacementScope @AcademicYear varchar(7),@SourceRowsJson nvarchar(max)
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
  UNION SELECT FacultyId FROM paws.CalendarActivity WHERE Category=N'ccc' AND StartDate<@End AND EndDate>=@Start) ids ORDER BY FacultyId FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),1,1,N''),N'')+N']';
 EXEC paws_api.AcquireCalendarActivityFacultyLocks @Faculty;
END;
GO
CREATE PROCEDURE paws_api.CommitCccReplacement @ActorFirebaseUid nvarchar(128),@ImportBatchId uniqueidentifier,@AcademicYear varchar(32),@Dataset nvarchar(64),@ExpectedVersion varchar(64),@ManifestSha256 varchar(64),@SourceSha256 varchar(64),@IdempotencyKey uniqueidentifier,@Confirm bit,@CompleteDataset bit
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
    (SELECT JSON_VALUE(value,'$.facultyId') facultyId,JSON_VALUE(value,'$.label') label,N'ccc' category,JSON_VALUE(value,'$.startDate') startDate,JSON_VALUE(value,'$.endDate') endDate,JSON_VALUE(value,'$.courseCode') courseCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@IdempotencyKey,@ImportBatchId FROM OPENJSON(@Before);
   DELETE a FROM paws.CalendarActivity a JOIN OPENJSON(@Before) WITH(ActivityId uniqueidentifier '$.activityId') b ON b.ActivityId=a.ActivityId;SET @Deleted=@@ROWCOUNT;
   INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,CourseId,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid)
    SELECT NEWID(),r.FacultyId,N'ccc',r.Label,r.StartDate,r.EndDate,r.CourseId,@ImportBatchId,raw.ImportRowId,@StoredSource,N'CCC',r.SourceRow,@ActorFirebaseUid
    FROM paws_api.CccReplacementRows(@Rows,@StoredYear) r JOIN staging.ImportRow raw ON raw.ImportSheetId=@Sheet AND raw.SourceRowNumber=r.SourceRow;SET @Inserted=@@ROWCOUNT;
   IF @Inserted<>(SELECT COUNT(*) FROM OPENJSON(@Snapshot,'$.rows')) OR @Deleted<>(SELECT COUNT(*) FROM OPENJSON(@Before)) THROW 54904,'CCC row set changed.',1;
   SET @After=paws_api.CccScopeSnapshot(@StoredYear);
   INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,AfterJson,RequestId,ImportBatchId)
    SELECT NEWID(),N'ccc_activity_added',N'calendar_activity',JSON_VALUE(value,'$.activityId'),@ActorFirebaseUid,SYSUTCDATETIME(),
    (SELECT JSON_VALUE(value,'$.facultyId') facultyId,JSON_VALUE(value,'$.label') label,N'ccc' category,JSON_VALUE(value,'$.startDate') startDate,JSON_VALUE(value,'$.endDate') endDate,JSON_VALUE(value,'$.courseCode') courseCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@IdempotencyKey,@ImportBatchId FROM OPENJSON(@After);
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
CREATE PROCEDURE paws_api.RecoverCccReplacement @ActorFirebaseUid nvarchar(128),@ReceiptId uniqueidentifier,@Confirm bit
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
  INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,CourseId,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid,CreatedAtUtc,UpdatedAtUtc)
   SELECT ActivityId,FacultyId,N'ccc',Label,StartDate,EndDate,CourseId,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid,CreatedAtUtc,UpdatedAtUtc FROM OPENJSON(@Before)
   WITH(ActivityId uniqueidentifier '$.activityId',FacultyId uniqueidentifier '$.facultyId',Label nvarchar(1000) '$.label',StartDate date '$.startDate',EndDate date '$.endDate',CourseId uniqueidentifier '$.courseId',ImportBatchId uniqueidentifier '$.importBatchId',ImportRowId uniqueidentifier '$.importRowId',SourceSha256 char(64) '$.sourceSha256',SourceSheet nvarchar(256) '$.sourceSheet',SourceRow int '$.sourceRow',CreatedByUid nvarchar(128) '$.createdByUid',CreatedAtUtc datetime2(7) '$.createdAtUtc',UpdatedAtUtc datetime2(7) '$.updatedAtUtc');
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,AfterJson,RequestId,ImportBatchId)
   SELECT NEWID(),N'ccc_activity_added',N'calendar_activity',JSON_VALUE(value,'$.activityId'),@ActorFirebaseUid,SYSUTCDATETIME(),
    (SELECT JSON_VALUE(value,'$.facultyId') facultyId,JSON_VALUE(value,'$.label') label,N'ccc' category,JSON_VALUE(value,'$.startDate') startDate,JSON_VALUE(value,'$.endDate') endDate,JSON_VALUE(value,'$.courseCode') courseCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@ReceiptId,@Batch FROM OPENJSON(@Before);
  UPDATE paws.CccReplacementReceipt SET Status=N'recovered' WHERE ReceiptId=@ReceiptId;UPDATE staging.CccReplacement SET Status=N'recovered' WHERE ImportBatchId=@Batch;
  COMMIT;SELECT(SELECT @ReceiptId receiptId,N'recovered' status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE ROLE paws_runtime_ccc_stage AUTHORIZATION dbo;
CREATE ROLE paws_runtime_ccc_commit AUTHORIZATION dbo;
CREATE ROLE paws_ccc_recovery_admin AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::paws_api.StageCccReplacement TO paws_runtime_ccc_stage;
GRANT EXECUTE ON OBJECT::paws_api.GetCccReplacement TO paws_runtime_ccc_stage;
GRANT EXECUTE ON OBJECT::paws_api.PreviewCccReplacement TO paws_runtime_ccc_stage;
GRANT EXECUTE ON OBJECT::paws_api.CommitCccReplacement TO paws_runtime_ccc_commit;
GRANT EXECUTE ON OBJECT::paws_api.RecoverCccReplacement TO paws_ccc_recovery_admin;
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::staging.CccReplacement TO paws_runtime_ccc_stage,paws_runtime_ccc_commit,paws_ccc_recovery_admin;
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::paws.CccReplacementReceipt TO paws_runtime_ccc_stage,paws_runtime_ccc_commit,paws_ccc_recovery_admin;
GO
CREATE OR ALTER PROCEDURE paws_api.ListChangeHistoryEvents
 @ActorFirebaseUid nvarchar(128),@Scope nvarchar(16),@StartUtc datetime2(7),@EndExclusiveUtc datetime2(7)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Role nvarchar(128),@Faculty uniqueidentifier,@Admin bit=0;
 SELECT @Role=LOWER(LTRIM(RTRIM(BaseRole))),@Faculty=FacultyId FROM paws.UserProfile
 WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
 IF @Role IS NULL OR @Role NOT IN(N'owner',N'administrator',N'admin',N'developer',N'adfa_general',N'adfa_regular',N'faculty',N'hicc',N'visc',N'adc',N'lab')
 OR (@Role IN(N'faculty',N'hicc',N'visc') AND @Faculty IS NULL) THROW 54701,'History role denied.',1;
 IF @Scope NOT IN(N'mine',N'timetable',N'dashboard') OR @StartUtc IS NULL OR @EndExclusiveUtc IS NULL OR @StartUtc>=@EndExclusiveUtc
 OR DATEDIFF(day,@StartUtc,@EndExclusiveUtc)>3660 THROW 54702,'Invalid history range or scope.',1;
 IF @Scope=N'mine' AND @Faculty IS NULL THROW 54703,'My history requires a faculty link.',1;
 IF @Role IN(N'owner',N'administrator',N'admin',N'developer',N'adfa_general',N'adfa_regular') SET @Admin=1;
 SELECT TOP(10001) * INTO #HistoryEvents FROM (
 SELECT N'audit' source,CONVERT(nvarchar(36),e.AuditEventId) eventId,e.EventType eventType,e.EntityType entityType,e.EntityId entityId,
 e.OccurredAtUtc occurredAtUtc,e.BeforeJson beforeJson,e.AfterJson afterJson,e.MetadataJson metadataJson,c.ContextJson contextJson,
 CASE WHEN @Admin=1 THEN e.ActorName END actorName,CAST(NULL AS nvarchar(32)) academicYear,CAST(NULL AS uniqueidentifier) facultyId
 FROM paws.AuditEvent e LEFT JOIN paws.ChangeHistoryContext c ON c.AuditEventId=e.AuditEventId
 WHERE e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc AND (
 (@Scope IN(N'mine',N'timetable') AND e.EventType IN(N'session_updated',N'session_created',N'session_assignments_replaced',N'swap_applied',N'session_deleted')
 AND (@Scope=N'timetable' OR EXISTS(SELECT 1 FROM paws_api.HistoryAffectedFaculty(e.BeforeJson,e.AfterJson,c.ContextJson) af WHERE af.FacultyId=@Faculty)))
 OR (@Scope=N'dashboard' AND e.EventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored',N'role_periods_updated',N'afc_form_uploaded',N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected')
 AND (@Admin=1 OR EXISTS(SELECT 1 FROM paws_api.HistoryAffectedFaculty(e.BeforeJson,e.AfterJson,c.ContextJson) af WHERE af.FacultyId=@Faculty)
 OR(e.EventType IN(N'afc_form_uploaded',N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected') AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(e.MetadataJson,'$.facultyId'))=@Faculty)
 OR(e.EventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored') AND TRY_CONVERT(uniqueidentifier,e.EntityId)=@Faculty)))
 )
 UNION ALL
 SELECT N'doe',CONVERT(nvarchar(36),e.AuditEventId),e.Action,e.EntityType,e.EntityId,e.ChangedAtUtc,e.BeforeJson,e.AfterJson,NULL,
 (SELECT CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM paws.DoePolicyPublication p WHERE p.PolicyVersionId=e.PolicyVersionId) THEN 1 ELSE 0 END) wasPublished FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),
 CASE WHEN @Admin=1 THEN e.ActorName END,e.AcademicYear,e.FacultyId
 FROM paws.DoeAuditEvent e WHERE @Scope=N'dashboard' AND e.ChangedAtUtc>=@StartUtc AND e.ChangedAtUtc<@EndExclusiveUtc
 AND ((e.EntityType=N'doe_policy_version' AND e.Action IN(N'draft_created',N'draft_updated',N'working_draft_created',N'published',N'archived')
 AND (@Admin=1 OR e.Action=N'published' OR(e.Action=N'archived' AND EXISTS(SELECT 1 FROM paws.DoePolicyPublication p WHERE p.PolicyVersionId=e.PolicyVersionId AND p.PublishedAtUtc<=e.ChangedAtUtc))))
 OR(e.EntityType IN(N'doe_assignment',N'faculty_doe_target',N'manual_doe_assignment') AND (@Admin=1 OR e.FacultyId=@Faculty)))
 UNION ALL
 -- Receipt/recovery bindings prove historical membership without inferring it
 -- from today's assignments. Only immutable source activity facts are selected;
 -- confidential AFC recovery before-images never leave this read procedure.
 SELECT N'work',CONCAT(CONVERT(nvarchar(36),e.AuditEventId),N':',CONVERT(nvarchar(36),recovery.ActivityId)),e.EventType,N'calendar_activity',CONVERT(nvarchar(256),recovery.ActivityId),e.OccurredAtUtc,
 CASE WHEN e.EventType=N'calendar_activity_import_recovered' THEN(SELECT item.FacultyId facultyId,item.OriginalLabel label,item.Category category,item.StartDate startDate,item.EndDate endDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END,
 CASE WHEN e.EventType=N'calendar_activity_import_committed' THEN(SELECT item.FacultyId facultyId,item.OriginalLabel label,item.Category category,item.StartDate startDate,item.EndDate endDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END,NULL,NULL,
 CASE WHEN @Admin=1 THEN e.ActorName END,NULL,item.FacultyId
 FROM paws.AuditEvent e JOIN paws.CalendarActivityImportReceipt receipt ON receipt.ReceiptId=TRY_CONVERT(uniqueidentifier,e.EntityId)
 JOIN paws.CalendarActivityRecoveryRow recovery ON recovery.ReceiptId=receipt.ReceiptId
 JOIN staging.CalendarActivityImportItem item ON item.ImportBatchId=receipt.ImportBatchId AND item.AfcRecordId=recovery.OriginalAfcRecordId
 WHERE @Scope IN(N'mine',N'dashboard') AND e.EventType IN(N'calendar_activity_import_committed',N'calendar_activity_import_recovered')
 AND e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc
 AND ((@Scope=N'dashboard' AND @Admin=1) OR item.FacultyId=@Faculty)
 UNION ALL
 SELECT N'work',CONVERT(nvarchar(36),e.AuditEventId),e.EventType,e.EntityType,e.EntityId,e.OccurredAtUtc,e.BeforeJson,JSON_QUERY(c.ContextJson,'$.workActivity'),NULL,c.ContextJson,
 CASE WHEN @Admin=1 THEN e.ActorName END,NULL,TRY_CONVERT(uniqueidentifier,JSON_VALUE(c.ContextJson,'$.facultyId'))
 FROM paws.AuditEvent e LEFT JOIN paws.ChangeHistoryContext c ON c.AuditEventId=e.AuditEventId
 WHERE e.EventType=N'calendar_activity_time_resolved' AND @Scope IN(N'mine',N'dashboard')
 AND e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc
 AND ((@Scope=N'dashboard' AND @Admin=1) OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(c.ContextJson,'$.facultyId'))=@Faculty)
 UNION ALL
 SELECT N'work',CONVERT(nvarchar(36),e.AuditEventId),e.EventType,e.EntityType,e.EntityId,e.OccurredAtUtc,e.BeforeJson,e.AfterJson,NULL,NULL,
 CASE WHEN @Admin=1 THEN e.ActorName END,NULL,COALESCE(TRY_CONVERT(uniqueidentifier,JSON_VALUE(e.AfterJson,'$.facultyId')),TRY_CONVERT(uniqueidentifier,JSON_VALUE(e.BeforeJson,'$.facultyId')))
 FROM paws.AuditEvent e WHERE e.EventType IN(N'ccc_activity_added',N'ccc_activity_removed') AND @Scope IN(N'mine',N'dashboard')
 AND e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc
 AND ((@Scope=N'dashboard' AND @Admin=1) OR EXISTS(SELECT 1 FROM paws_api.HistoryAffectedFaculty(e.BeforeJson,e.AfterJson,NULL) affected WHERE affected.FacultyId=@Faculty))
 ) events ORDER BY occurredAtUtc DESC,source,eventId;
 IF (SELECT COUNT(*) FROM #HistoryEvents)>10000 OR (SELECT COALESCE(SUM(CONVERT(bigint,COALESCE(DATALENGTH(beforeJson),0))+COALESCE(DATALENGTH(afterJson),0)+COALESCE(DATALENGTH(contextJson),0)+COALESCE(DATALENGTH(metadataJson),0)),0) FROM #HistoryEvents)>12582912
 THROW 54704,'Narrow the history range before reading.',1;
 -- Resolve only proven historical IDs to opaque filter keys. Today's roster is
 -- never evidence of affected membership; current names label the filter only.
 SELECT events.*,(
 SELECT candidate.FacultyId facultyId,candidate.CandidateKey facultyKey,
 COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName) displayName
 FROM paws.SwapCandidate candidate JOIN paws.Faculty f ON f.FacultyId=candidate.FacultyId
 WHERE candidate.FacultyId IN(
 SELECT FacultyId FROM paws_api.HistoryAffectedFaculty(events.beforeJson,events.afterJson,events.contextJson)
 UNION SELECT events.facultyId WHERE events.facultyId IS NOT NULL
 UNION SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(events.metadataJson,'$.facultyId')) WHERE events.eventType IN(N'afc_form_uploaded',N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected')
 UNION SELECT TRY_CONVERT(uniqueidentifier,events.entityId) WHERE events.eventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored')
 ) FOR JSON PATH) directoryFacultyJson
 FROM #HistoryEvents events ORDER BY occurredAtUtc DESC,source,eventId;
END;
GO
COMMIT;
