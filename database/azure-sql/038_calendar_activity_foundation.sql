/* Calendar range activity foundation. No memberships, source deletion or DOE writes. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
IF DB_NAME()<>N'VetMed-Ops' THROW 53800,'Calendar activity migration requires VetMed-Ops.',1;
IF OBJECT_ID(N'paws.CalendarActivity') IS NOT NULL THROW 53800,'Inspect existing calendar activity objects before applying.',1;
IF OBJECT_ID(N'paws.Faculty') IS NULL OR OBJECT_ID(N'paws.SwapCandidate') IS NULL OR COL_LENGTH(N'paws.AfcRecord',N'AfcVersion') IS NULL
 OR OBJECT_ID(N'staging.ImportRow') IS NULL OR OBJECT_ID(N'paws.AuditEvent') IS NULL THROW 53800,'Calendar activity prerequisites are missing.',1;
IF EXISTS(SELECT 1 FROM sys.schemas WHERE name IN(N'paws',N'paws_api',N'staging') AND USER_NAME(principal_id)<>N'dbo') THROW 53800,'The dbo ownership chain is required.',1;
BEGIN TRANSACTION;
GO
CREATE TABLE paws.CalendarActivity(
 ActivityId uniqueidentifier NOT NULL PRIMARY KEY,
 FacultyId uniqueidentifier NOT NULL REFERENCES paws.Faculty(FacultyId),
 Category nvarchar(64) NOT NULL,
 OriginalLabel nvarchar(1000) NOT NULL,
 StartDate date NOT NULL,EndDate date NOT NULL,
 CourseId uniqueidentifier NULL REFERENCES paws.Course(CourseId),
 ImportBatchId uniqueidentifier NOT NULL REFERENCES staging.ImportBatch(ImportBatchId),
 ImportRowId uniqueidentifier NOT NULL REFERENCES staging.ImportRow(ImportRowId),
 SourceSha256 char(64) NOT NULL,SourceSheet nvarchar(256) NOT NULL,SourceRow int NOT NULL,
 CreatedByUid nvarchar(128) NOT NULL,CreatedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 UpdatedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),ActivityVersion rowversion NOT NULL,
 CONSTRAINT CK_CalendarActivity_Category CHECK(Category COLLATE Latin1_General_100_BIN2 IN(N'ccc',N'rotation_participant',N'clinical_day',N'vetm581_rounds',N'vetm571_clinical_pharmacology',N'vetm591_presentations',N'teaching_excellence',N'remote_work')),
 CONSTRAINT CK_CalendarActivity_Range CHECK(StartDate<=EndDate),
 CONSTRAINT CK_CalendarActivity_SourceRow CHECK(SourceRow>1),
 CONSTRAINT UQ_CalendarActivity_Source UNIQUE(SourceSha256,SourceSheet,SourceRow)
);
CREATE INDEX IX_CalendarActivity_FacultyRange ON paws.CalendarActivity(FacultyId,StartDate,EndDate);
CREATE INDEX IX_CalendarActivity_RangeCursor ON paws.CalendarActivity(StartDate,ActivityId);
CREATE TABLE paws.CalendarActivityDayTime(
 ActivityId uniqueidentifier NOT NULL REFERENCES paws.CalendarActivity(ActivityId),
 ActivityDate date NOT NULL,StartTime time(0) NOT NULL,EndTime time(0) NOT NULL,
 EvidenceRef nvarchar(512) NOT NULL,EvidenceNote nvarchar(1000) NOT NULL,ActorUid nvarchar(128) NOT NULL,
 UpdatedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),TimeVersion rowversion NOT NULL,
 PRIMARY KEY(ActivityId,ActivityDate),
 CONSTRAINT CK_CalendarActivityDayTime_Interval CHECK(StartTime<EndTime),
 CONSTRAINT CK_CalendarActivityDayTime_Evidence CHECK(LEN(LTRIM(RTRIM(EvidenceRef)))>0 AND LEN(LTRIM(RTRIM(EvidenceNote)))>0)
);
CREATE TABLE staging.CalendarActivityImport(
 ImportBatchId uniqueidentifier NOT NULL PRIMARY KEY REFERENCES staging.ImportBatch(ImportBatchId),
 SourceSha256 char(64) NOT NULL,Dataset nvarchar(64) NOT NULL,PolicyVersion nvarchar(64) NOT NULL,
 StartDate date NULL,EndDate date NULL,Status nvarchar(32) NOT NULL,SourceRowCount int NOT NULL,
 ManifestSha256 char(64) NULL,PreviewJson nvarchar(max) NULL,ExpiresAtUtc datetime2(7) NULL,
 ActorFirebaseUid nvarchar(128) NOT NULL,ImportVersion rowversion NOT NULL,
 CONSTRAINT CK_CalendarActivityImport_Status CHECK(Status IN(N'staged',N'committed',N'recovered')),
 CONSTRAINT CK_CalendarActivityImport_Preview CHECK(PreviewJson IS NULL OR ISJSON(PreviewJson)=1)
);
CREATE TABLE staging.CalendarActivityImportItem(
 ImportBatchId uniqueidentifier NOT NULL REFERENCES staging.CalendarActivityImport(ImportBatchId),
 SourceRow int NOT NULL,ImportRowId uniqueidentifier NOT NULL REFERENCES staging.ImportRow(ImportRowId),
 FacultySourceName nvarchar(256) NOT NULL,StartDate date NULL,EndDate date NULL,OriginalLabel nvarchar(1000) NOT NULL,
 ParserTreatment nvarchar(32) NOT NULL,ParsedIssuesJson nvarchar(max) NOT NULL,Category nvarchar(64) NULL,
 FacultyId uniqueidentifier NULL REFERENCES paws.Faculty(FacultyId),
 ResolutionMethod int NULL,IdentityDigest binary(32) NULL,
 AfcRecordId uniqueidentifier NULL,ExpectedAfcVersion binary(8) NULL,
 Status nvarchar(32) NOT NULL,IssueCode nvarchar(64) NULL,TargetCount int NOT NULL DEFAULT 0,
 PRIMARY KEY(ImportBatchId,SourceRow),
 CONSTRAINT CK_CalendarActivityImportItem_Issues CHECK(ISJSON(ParsedIssuesJson)=1),
 CONSTRAINT CK_CalendarActivityImportItem_Status CHECK(Status IN(N'accepted',N'retained',N'excluded',N'quarantined'))
);
CREATE TABLE paws.CalendarActivityImportReceipt(
 ReceiptId uniqueidentifier NOT NULL PRIMARY KEY,
 ImportBatchId uniqueidentifier NOT NULL REFERENCES staging.CalendarActivityImport(ImportBatchId),
 Dataset nvarchar(64) NOT NULL,SourceSha256 char(64) NOT NULL,ManifestSha256 char(64) NOT NULL,
 IdempotencyKey uniqueidentifier NOT NULL UNIQUE,
 InsertedCount int NOT NULL,DeletedAfcCount int NOT NULL,ActorUid nvarchar(128) NOT NULL,
 CommittedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 Status nvarchar(32) NOT NULL DEFAULT N'committed',
 CONSTRAINT UQ_CalendarActivityImportReceipt_Manifest UNIQUE(Dataset,SourceSha256,ManifestSha256),
 CONSTRAINT CK_CalendarActivityImportReceipt_Status CHECK(Status IN(N'committed',N'recovered'))
);
CREATE TABLE paws.CalendarActivityRecoveryRow(
 ReceiptId uniqueidentifier NOT NULL REFERENCES paws.CalendarActivityImportReceipt(ReceiptId),
 OriginalAfcRecordId uniqueidentifier NOT NULL,ActivityId uniqueidentifier NOT NULL,
 ImportedActivityVersion binary(8) NOT NULL,BeforeAfcJson nvarchar(max) NOT NULL,
 PRIMARY KEY(ReceiptId,OriginalAfcRecordId),
 CONSTRAINT CK_CalendarActivityRecoveryRow_Json CHECK(ISJSON(BeforeAfcJson)=1)
);
GO
CREATE FUNCTION paws_api.CalendarActivityTextKey(@Value nvarchar(max)) RETURNS nvarchar(max)
AS
BEGIN
 DECLARE @Key nvarchar(max)=COALESCE(@Value,N'');
 SET @Key=REPLACE(REPLACE(REPLACE(REPLACE(@Key,NCHAR(9),N' '),NCHAR(10),N' '),NCHAR(13),N' '),NCHAR(160),N' ');
 WHILE CHARINDEX(N'  ',@Key)>0 SET @Key=REPLACE(@Key,N'  ',N' ');
 SET @Key=REPLACE(REPLACE(LTRIM(RTRIM(@Key)),N' ,',N','),N',',N', ');
 WHILE CHARINDEX(N'  ',@Key)>0 SET @Key=REPLACE(@Key,N'  ',N' ');
 RETURN UPPER(LTRIM(RTRIM(@Key))) COLLATE Latin1_General_100_BIN2;
END;
GO
CREATE FUNCTION paws_api.CalendarActivityNameKey(@Value nvarchar(max)) RETURNS nvarchar(max)
AS BEGIN RETURN paws_api.CalendarActivityTextKey(@Value); END;
GO
CREATE FUNCTION paws_api.CalendarActivityPurposeCategory(@Value nvarchar(1000)) RETURNS nvarchar(64)
AS
BEGIN
 RETURN CASE paws_api.CalendarActivityTextKey(@Value)
 WHEN N'CCC DAY' THEN N'ccc' WHEN N'ROTATION PARTICIPANT' THEN N'rotation_participant'
 WHEN N'CLINICAL DAY / PPVM (EXTERNAL)' THEN N'clinical_day'
 WHEN N'VETM 581 CLINICAL ROUNDS (12:30 - 4:30PM): 9 SEP 2026, 6 JAN 2027, 8 APR 2027' THEN N'vetm581_rounds'
 WHEN N'571 - CLINICAL PHARMACOLOGY' THEN N'vetm571_clinical_pharmacology'
 WHEN N'VETM 591 IM PRESENTATIONS (ALL DAY): 5 APR 2027' THEN N'vetm591_presentations'
 WHEN N'TEACHING EXCELLENCE PROGRAM(8-12:30PM)' THEN N'teaching_excellence'
 WHEN N'REMOTE WORK (APPROVED)' THEN N'remote_work' END;
END;
GO
CREATE FUNCTION paws_api.CalendarActivityAdmin(@ActorFirebaseUid nvarchar(128)) RETURNS bit
AS
BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM paws.UserProfile WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0
 AND LOWER(LTRIM(RTRIM(BaseRole))) IN(N'developer',N'owner',N'administrator',N'admin',N'adfa_general',N'adfa_regular')) THEN 1 ELSE 0 END;
END;
GO
CREATE FUNCTION paws_api.CalendarActivityFacultyResolution(@Name nvarchar(256)) RETURNS TABLE
AS RETURN
 WITH candidates AS(
  SELECT f.FacultyId,1 AS Tier FROM paws.Faculty f
  WHERE LEN(paws_api.CalendarActivityNameKey(@Name))>0 AND
   (paws_api.CalendarActivityNameKey(f.DisplayName)=paws_api.CalendarActivityNameKey(@Name)
    OR paws_api.CalendarActivityNameKey(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))=paws_api.CalendarActivityNameKey(@Name))
  UNION ALL SELECT a.FacultyId,2 FROM paws.FacultyAlias a WHERE a.Active=1 AND paws_api.CalendarActivityNameKey(a.AliasName)=paws_api.CalendarActivityNameKey(@Name)
  UNION ALL SELECT a.FacultyId,3 FROM paws.AfcRecord a JOIN staging.AfcRecordRaw raw ON raw.ImportBatchId=a.SourceImportBatchId AND raw.SourceRowNumber=a.SourceRow
    WHERE paws_api.CalendarActivityNameKey(raw.FacultySourceName)=paws_api.CalendarActivityNameKey(@Name)
  UNION ALL SELECT a.FacultyId,3 FROM paws.CalendarActivity a JOIN staging.ImportRow raw ON raw.ImportRowId=a.ImportRowId
   JOIN paws.CalendarActivityImportReceipt receipt ON receipt.ImportBatchId=a.ImportBatchId AND receipt.Status=N'committed'
    WHERE paws_api.CalendarActivityNameKey(JSON_VALUE(raw.RawJson,'$.facultySourceName'))=paws_api.CalendarActivityNameKey(@Name)
 ),firstTier AS(SELECT MIN(Tier) Tier FROM candidates),
 matched AS(SELECT COUNT(DISTINCT c.FacultyId) CandidateCount,MIN(CONVERT(char(36),c.FacultyId)) FacultyText,MIN(c.Tier) Tier FROM candidates c JOIN firstTier t ON t.Tier=c.Tier)
 SELECT CASE WHEN m.CandidateCount=1 THEN f.FacultyId END FacultyId,m.CandidateCount,m.Tier,
  CASE WHEN m.CandidateCount=0 THEN N'NO_IDENTITY' WHEN m.CandidateCount>1 THEN N'AMBIGUOUS_IDENTITY' WHEN f.Active<>1 THEN N'INACTIVE_FACULTY' ELSE N'resolved' END ResolutionStatus,
  CASE WHEN m.CandidateCount=1 THEN HASHBYTES('SHA2_256',CONCAT(CONVERT(char(36),f.FacultyId),N'|',m.Tier,N'|',
   CONVERT(nvarchar(33),f.UpdatedAtUtc,126),N'|',paws_api.CalendarActivityNameKey(f.DisplayName),N'|',
   paws_api.CalendarActivityNameKey(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName)))) END IdentityDigest
 FROM matched m LEFT JOIN paws.Faculty f ON f.FacultyId=TRY_CONVERT(uniqueidentifier,m.FacultyText);
GO
CREATE PROCEDURE paws_api.GetCalendarActivityImport @ActorFirebaseUid nvarchar(128),@ImportBatchId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;
 IF paws_api.CalendarActivityAdmin(@ActorFirebaseUid)<>1 THROW 53801,'Administrator permission is required.',1;
 IF NOT EXISTS(SELECT 1 FROM staging.CalendarActivityImport WHERE ImportBatchId=@ImportBatchId) THROW 53803,'Import was not found.',1;
 SELECT (SELECT i.ImportBatchId batchId,i.SourceSha256 sourceSha256,i.Dataset dataset,i.StartDate startDate,i.EndDate endDate,
  CONVERT(varchar(16),CONVERT(binary(8),i.ImportVersion),2) previewVersion,i.ManifestSha256 manifestSha256,i.ExpiresAtUtc expiresAtUtc,
  JSON_QUERY((SELECT SUM(CASE WHEN Status=N'accepted' THEN 1 ELSE 0 END) accepted,SUM(CASE WHEN Status=N'retained' THEN 1 ELSE 0 END) retained,
   SUM(CASE WHEN Status=N'excluded' THEN 1 ELSE 0 END) excluded,SUM(CASE WHEN Status=N'quarantined' THEN 1 ELSE 0 END) quarantined
   FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@ImportBatchId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) counts,
  JSON_QUERY((SELECT item.SourceRow sourceRow,item.Status status,
   JSON_QUERY(CASE WHEN item.ParsedIssuesJson<>N'[]' THEN item.ParsedIssuesJson WHEN item.IssueCode IS NOT NULL THEN CONCAT(N'["',item.IssueCode,N'"]') ELSE N'[]' END) issues,
   COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName,item.FacultySourceName) displayName,
   item.StartDate startDate,item.EndDate endDate,item.Category category,item.TargetCount targetCount
   FROM staging.CalendarActivityImportItem item LEFT JOIN paws.Faculty f ON f.FacultyId=item.FacultyId
   WHERE item.ImportBatchId=@ImportBatchId ORDER BY item.SourceRow FOR JSON PATH,INCLUDE_NULL_VALUES)) items
  FROM staging.CalendarActivityImport i WHERE i.ImportBatchId=@ImportBatchId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) responseJson;
END;
GO
CREATE PROCEDURE paws_api.PreviewCalendarActivityImport @ActorFirebaseUid nvarchar(128),@ImportBatchId uniqueidentifier,@ExpectedVersion varchar(64)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF paws_api.CalendarActivityAdmin(@ActorFirebaseUid)<>1 THROW 53801,'Administrator permission is required.',1;
 BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @Version binary(8),@Status nvarchar(32);
  SELECT @Version=ImportVersion,@Status=Status FROM staging.CalendarActivityImport WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@ImportBatchId;
  IF @Version IS NULL THROW 53803,'Import was not found.',1;
  IF @Status<>N'staged' THROW 53804,'Import is no longer staged.',1;
  IF @ExpectedVersion IS NULL OR DATALENGTH(@ExpectedVersion)<>16 OR TRY_CONVERT(binary(8),@ExpectedVersion,2) IS NULL OR TRY_CONVERT(binary(8),@ExpectedVersion,2)<>@Version THROW 53804,'Import preview changed.',1;
  UPDATE item SET FacultyId=CASE WHEN resolution.ResolutionStatus=N'resolved' THEN resolution.FacultyId END,
    ResolutionMethod=resolution.Tier,IdentityDigest=resolution.IdentityDigest,TargetCount=targets.TargetCount,
    AfcRecordId=CASE WHEN resolution.ResolutionStatus=N'resolved' AND targets.TargetCount=1 THEN TRY_CONVERT(uniqueidentifier,targets.TargetText) END,
    ExpectedAfcVersion=CASE WHEN resolution.ResolutionStatus=N'resolved' AND targets.TargetCount=1 THEN TRY_CONVERT(binary(8),targets.TargetVersionText,2) END,
    Status=CASE WHEN resolution.ResolutionStatus=N'resolved' AND targets.TargetCount=1 THEN N'accepted' ELSE N'quarantined' END,
    IssueCode=CASE WHEN resolution.ResolutionStatus<>N'resolved' THEN resolution.ResolutionStatus WHEN targets.TargetCount<>1 THEN N'EXACT_AFC_TARGET_REQUIRED' END
  FROM staging.CalendarActivityImportItem item
  CROSS APPLY paws_api.CalendarActivityFacultyResolution(item.FacultySourceName) resolution
  OUTER APPLY(SELECT COUNT(*) TargetCount,MIN(CONVERT(char(36),a.AfcRecordId)) TargetText,MIN(CONVERT(varchar(16),CONVERT(binary(8),a.AfcVersion),2)) TargetVersionText
   FROM paws.AfcRecord a WITH(HOLDLOCK) WHERE a.Active=1 AND a.FacultyId=resolution.FacultyId AND a.StartDate=item.StartDate AND a.EndDate=item.EndDate
    AND paws_api.CalendarActivityTextKey(a.Purpose)=paws_api.CalendarActivityTextKey(item.OriginalLabel)) targets
  WHERE item.ImportBatchId=@ImportBatchId AND item.ParserTreatment=N'working_candidate' AND item.ParsedIssuesJson=N'[]'
    AND item.SourceRow NOT IN(267,297,563,773)
    AND LEN(item.FacultySourceName)>0 AND item.StartDate IS NOT NULL AND item.EndDate>=item.StartDate AND item.Category IS NOT NULL;
  DECLARE @Manifest nvarchar(max)=(SELECT SourceRow,FacultyId,ResolutionMethod,CONVERT(varchar(64),IdentityDigest,2) identityDigest,
    AfcRecordId,CONVERT(varchar(16),ExpectedAfcVersion,2) afcVersion,StartDate,EndDate,OriginalLabel,Category,Status
    FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@ImportBatchId ORDER BY SourceRow FOR JSON PATH,INCLUDE_NULL_VALUES);
  UPDATE staging.CalendarActivityImport SET ManifestSha256=CONVERT(varchar(64),HASHBYTES('SHA2_256',
    CONCAT(SourceSha256,N'|',Dataset,N'|',PolicyVersion,N'|',CONVERT(char(10),StartDate,23),N'|',CONVERT(char(10),EndDate,23),N'|',@Manifest)),2),
    ExpiresAtUtc=DATEADD(minute,15,SYSUTCDATETIME()) WHERE ImportBatchId=@ImportBatchId;
  COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION;THROW;END CATCH;
 EXEC paws_api.GetCalendarActivityImport @ActorFirebaseUid,@ImportBatchId;
END;
GO
CREATE PROCEDURE paws_api.StageCalendarActivityImport @ActorFirebaseUid nvarchar(128),@RequestId uniqueidentifier,@SourceSha256 char(64),@RowsJson nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF paws_api.CalendarActivityAdmin(@ActorFirebaseUid)<>1 THROW 53801,'Administrator permission is required.',1;
 IF @RequestId IS NULL OR @SourceSha256 IS NULL OR @SourceSha256<>'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF'
  OR ISJSON(@RowsJson)<>1 OR LEFT(LTRIM(@RowsJson),1)<>N'[' THROW 53802,'Approved source rows are required.',1;
 DECLARE @Rows TABLE(SourceRow int,FacultySourceName nvarchar(256),StartDate date,EndDate date,OriginalLabel nvarchar(1000),Treatment nvarchar(32),Issues nvarchar(max),RawJson nvarchar(max));
 INSERT @Rows SELECT r.SourceRow,COALESCE(r.FacultySourceName,N''),r.StartDate,r.EndDate,COALESCE(r.OriginalLabel,N''),r.Treatment,COALESCE(r.Issues,N'[]'),j.value
  FROM OPENJSON(@RowsJson) j CROSS APPLY OPENJSON(j.value) WITH(SourceRow int '$.sourceRow',FacultySourceName nvarchar(256) '$.facultySourceName',
    StartDate date '$.startDate',EndDate date '$.endDate',OriginalLabel nvarchar(1000) '$.originalLabel',Treatment nvarchar(32) '$.treatment',Issues nvarchar(max) '$.issues' AS JSON) r;
 IF NOT EXISTS(SELECT 1 FROM @Rows) OR (SELECT COUNT(*) FROM @Rows)>5000 OR EXISTS(SELECT SourceRow FROM @Rows GROUP BY SourceRow HAVING COUNT(*)>1)
  OR EXISTS(SELECT 1 FROM @Rows WHERE SourceRow IS NULL OR SourceRow<2 OR Treatment IS NULL OR Treatment NOT IN(N'working_candidate',N'retain_afc',N'quarantined',N'excluded') OR ISJSON(Issues)<>1 OR LEFT(LTRIM(Issues),1)<>N'[')
  THROW 53802,'Source row validation failed.',1;
 BEGIN TRY
  BEGIN TRANSACTION;
  IF EXISTS(SELECT 1 FROM staging.CalendarActivityImport WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@RequestId)
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM staging.CalendarActivityImport WHERE ImportBatchId=@RequestId AND SourceSha256=@SourceSha256)
    THROW 53807,'Import key belongs to another source.',1;
   COMMIT TRANSACTION;EXEC paws_api.GetCalendarActivityImport @ActorFirebaseUid,@RequestId;RETURN;
  END;
  DECLARE @Workbook uniqueidentifier=NEWID(),@Sheet uniqueidentifier=NEWID();
  INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ActorUpn,ValidationSummaryJson)
   VALUES(@RequestId,SYSUTCDATETIME(),N'calendar_staged',@SourceSha256,N'calendar-activity-v1',NULL,N'{}');
  INSERT staging.ImportWorkbook(ImportWorkbookId,ImportBatchId,FileName,FileSha256,FileByteLength)
   VALUES(@Workbook,@RequestId,N'AFC Tracker Lookup (2).xlsx',@SourceSha256,80154);
  INSERT staging.ImportSheet(ImportSheetId,ImportWorkbookId,SheetName,SheetIndex,MaxRow,MaxColumn,NonEmptyRowCount)
   SELECT @Sheet,@Workbook,N'AFC records',1,MAX(SourceRow),4,COUNT(*) FROM @Rows;
  INSERT staging.CalendarActivityImport(ImportBatchId,SourceSha256,Dataset,PolicyVersion,StartDate,EndDate,Status,SourceRowCount,ActorFirebaseUid)
   SELECT @RequestId,@SourceSha256,N'afc-working-activities',N'afc-working-activities-v1',
    MIN(CASE WHEN Treatment=N'working_candidate' AND EndDate>=StartDate THEN StartDate END),
    MAX(CASE WHEN Treatment=N'working_candidate' AND EndDate>=StartDate THEN EndDate END),N'staged',COUNT(*),@ActorFirebaseUid FROM @Rows;
  DECLARE @BoundRows TABLE(ImportRowId uniqueidentifier,SourceRow int);
  INSERT staging.ImportRow(ImportRowId,ImportSheetId,SourceRowNumber,RawJson,FormulaJson,ValidationStatus,ValidationErrorsJson)
   OUTPUT inserted.ImportRowId,inserted.SourceRowNumber INTO @BoundRows
   SELECT NEWID(),@Sheet,SourceRow,RawJson,NULL,Treatment,Issues FROM @Rows;
  INSERT staging.CalendarActivityImportItem(ImportBatchId,SourceRow,ImportRowId,FacultySourceName,StartDate,EndDate,OriginalLabel,ParserTreatment,ParsedIssuesJson,Category,Status,IssueCode)
   SELECT @RequestId,r.SourceRow,b.ImportRowId,r.FacultySourceName,r.StartDate,r.EndDate,r.OriginalLabel,r.Treatment,r.Issues,
    paws_api.CalendarActivityPurposeCategory(r.OriginalLabel),
    CASE WHEN r.SourceRow IN(267,297,563,773) THEN N'excluded'
     WHEN r.Treatment=N'retain_afc' AND paws_api.CalendarActivityTextKey(r.OriginalLabel) IN(N'OPA',N'UNIVERSITY TRAVEL',N'VACATION',N'VACATION/UNIVERSITY TRAVEL',N'RSL',N'SPECIAL LEAVE',N'MEDICAL',N'PARENTAL LEAVE',N'ADMINISTRATIVE LEAVE',N'STUDY LEAVE') AND r.Issues=N'[]' THEN N'retained' ELSE N'quarantined' END,
    CASE WHEN r.Treatment=N'working_candidate' AND (r.StartDate IS NULL OR r.EndDate IS NULL OR r.EndDate<r.StartDate OR LEN(r.FacultySourceName)=0) THEN N'INVALID_SOURCE_ROW'
     WHEN paws_api.CalendarActivityPurposeCategory(r.OriginalLabel) IS NULL AND r.Treatment=N'working_candidate' THEN N'UNCLASSIFIED_PURPOSE' END
   FROM @Rows r JOIN @BoundRows b ON b.SourceRow=r.SourceRow;
  DECLARE @Version varchar(16)=(SELECT CONVERT(varchar(16),CONVERT(binary(8),ImportVersion),2) FROM staging.CalendarActivityImport WHERE ImportBatchId=@RequestId);
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson,RequestId,ImportBatchId)
   VALUES(NEWID(),N'calendar_activity_import_staged',N'calendar_activity_import',CONVERT(nvarchar(36),@RequestId),@ActorFirebaseUid,SYSUTCDATETIME(),N'{"businessWrites":false}',@RequestId,@RequestId);
  COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION;THROW;END CATCH;
 EXEC paws_api.PreviewCalendarActivityImport @ActorFirebaseUid,@RequestId,@Version;
END;
GO
CREATE PROCEDURE paws_api.ListCalendarActivities
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
 SELECT (SELECT JSON_QUERY((SELECT a.ActivityId activityId,c.CandidateKey facultyKey,
    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName) facultyDisplayName,
    a.Category category,a.OriginalLabel label,a.StartDate startDate,a.EndDate endDate,course.CourseCode courseCode,
    CASE WHEN times.TimeCount=0 THEN N'not_provided' WHEN times.TimeCount=DATEDIFF(day,a.StartDate,a.EndDate)+1 THEN N'verified' ELSE N'partial' END timeStatus,
    CONVERT(varchar(16),CONVERT(binary(8),a.ActivityVersion),2) version,
    JSON_QUERY((SELECT t.ActivityDate date,CONVERT(char(5),t.StartTime,108) startTime,CONVERT(char(5),t.EndTime,108) endTime
      FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId ORDER BY t.ActivityDate FOR JSON PATH)) timeEvidence
    FROM @Page page JOIN paws.CalendarActivity a ON a.ActivityId=page.ActivityId JOIN paws.Faculty f ON f.FacultyId=a.FacultyId
    LEFT JOIN paws.SwapCandidate c ON c.FacultyId=a.FacultyId LEFT JOIN paws.Course course ON course.CourseId=a.CourseId
    OUTER APPLY(SELECT COUNT(*) TimeCount FROM paws.CalendarActivityDayTime t WHERE t.ActivityId=a.ActivityId) times
    ORDER BY a.StartDate,a.ActivityId FOR JSON PATH,INCLUDE_NULL_VALUES)) activities,
    CASE WHEN @HasMore=1 THEN CONCAT(CONVERT(char(10),@LastDate,23),N'|',CONVERT(char(36),@LastId)) END nextCursor,
    JSON_QUERY(CASE WHEN @IncludeFacultyKeys=1 THEN (SELECT f.FacultyId facultyId,c.CandidateKey facultyKey FROM paws.SwapCandidate c JOIN paws.Faculty f ON f.FacultyId=c.FacultyId AND f.Active=1 ORDER BY f.FacultyId FOR JSON PATH) END) facultyKeys
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) responseJson;
END;
GO
COMMIT TRANSACTION;
