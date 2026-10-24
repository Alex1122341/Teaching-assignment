/* Source-bound owner v2 classification. No business migration, membership or grants. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;SET ANSI_WARNINGS ON;SET ARITHABORT ON;SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;
IF DB_NAME()<>N'VetMed-Ops' THROW 54500,'Calendar classification requires VetMed-Ops.',1;
DECLARE @Expected TABLE(ObjectName sysname PRIMARY KEY,DefinitionHash char(64),Kind nvarchar(16));
INSERT @Expected VALUES
(N'CalendarActivityPurposeCategory','B2CA798990616A592A22DAEE45E78F03282E67ED9F8043AA98CD9ED7DEBA6352',N'FUNCTION'),
(N'GetCalendarActivityImport','5DCA9E97836269E9BAB09FBE97F204D978BB0F327C81C434C7390768EC095760',N'PROCEDURE'),
(N'PreviewCalendarActivityImport','24997A67392C8C2267D214B522039FF116CC54D17E66DCBB667B66C2D8E0A0CA',N'PROCEDURE'),
(N'StageCalendarActivityImport','100F161A401AA438BF8B85DA5F495F7A5D84584D00A554324DB2534307AE317F',N'PROCEDURE'),
(N'CommitCalendarActivityImport','AA31F5AB66FBA1CA9F47C96A40CB62F3C37B71CA2886FA52A17B9E8B1FFE73DE',N'PROCEDURE');
IF EXISTS(SELECT 1 FROM @Expected e LEFT JOIN sys.objects o ON o.schema_id=SCHEMA_ID(N'paws_api') AND o.name=e.ObjectName
 LEFT JOIN sys.sql_modules m ON m.object_id=o.object_id WHERE m.object_id IS NULL OR m.uses_ansi_nulls<>1 OR m.uses_quoted_identifier<>1
 OR e.DefinitionHash<>CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),TRIM(CHAR(9)+CHAR(10)+CHAR(13)+CHAR(32) FROM
 STUFF(REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)),1,CHARINDEX(e.Kind,UPPER(REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10))))-1,N'')))),2))
 THROW 54500,'Calendar classification module drift; inspect before applying.',1;
BEGIN TRANSACTION;
GO
ALTER FUNCTION paws_api.CalendarActivityPurposeCategory(@Value nvarchar(1000)) RETURNS nvarchar(64)
AS
BEGIN
 RETURN CASE paws_api.CalendarActivityTextKey(@Value)
 WHEN N'CCC DAY' THEN N'ccc' WHEN N'ROTATION PARTICIPANT' THEN N'rotation_participant'
 WHEN N'CLINICAL DAY / PPVM (EXTERNAL)' THEN N'clinical_day'
 WHEN N'VETM 581 CLINICAL ROUNDS (12:30 - 4:30PM): 9 SEP 2026, 6 JAN 2027, 8 APR 2027' THEN N'vetm581_rounds'
 WHEN N'571 - CLINICAL PHARMACOLOGY' THEN N'vetm571_clinical_pharmacology'
 WHEN N'VETM 591 IM PRESENTATIONS (ALL DAY): 5 APR 2027' THEN N'vetm591_presentations'
 WHEN N'TEACHING EXCELLENCE PROGRAM(8-12:30PM)' THEN N'teaching_excellence' END;
END;
GO
ALTER PROCEDURE paws_api.GetCalendarActivityImport @ActorFirebaseUid nvarchar(128),@ImportBatchId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;
 IF paws_api.CalendarActivityAdmin(@ActorFirebaseUid)<>1 THROW 53801,'Administrator permission is required.',1;
 IF NOT EXISTS(SELECT 1 FROM staging.CalendarActivityImport WHERE ImportBatchId=@ImportBatchId) THROW 53803,'Import was not found.',1;
 SELECT (SELECT i.ImportBatchId batchId,i.SourceSha256 sourceSha256,i.Dataset dataset,i.PolicyVersion policyVersion,i.StartDate startDate,i.EndDate endDate,
  CONVERT(varchar(16),CONVERT(binary(8),i.ImportVersion),2) previewVersion,i.ManifestSha256 manifestSha256,i.ExpiresAtUtc expiresAtUtc,
  JSON_QUERY((SELECT SUM(CASE WHEN Status=N'accepted' THEN 1 ELSE 0 END) accepted,SUM(CASE WHEN Status=N'retained' THEN 1 ELSE 0 END) retained,
   SUM(CASE WHEN Status=N'excluded' THEN 1 ELSE 0 END) excluded,SUM(CASE WHEN Status=N'quarantined' THEN 1 ELSE 0 END) quarantined
   FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@ImportBatchId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) counts,
  JSON_QUERY((SELECT item.SourceRow sourceRow,item.Status status,
   CASE WHEN item.Status=N'accepted' THEN N'work' WHEN item.Status=N'excluded' THEN N'excluded' ELSE N'away' END disposition,
   CONVERT(bit,CASE WHEN item.Status=N'quarantined' THEN 1 ELSE 0 END) needsReview,
   JSON_QUERY(CASE WHEN item.ParsedIssuesJson<>N'[]' THEN item.ParsedIssuesJson WHEN item.IssueCode IS NOT NULL THEN CONCAT(N'["',item.IssueCode,N'"]') ELSE N'[]' END) issues,
   COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName,item.FacultySourceName) displayName,
   item.StartDate startDate,item.EndDate endDate,item.Category category,item.TargetCount targetCount
   FROM staging.CalendarActivityImportItem item LEFT JOIN paws.Faculty f ON f.FacultyId=item.FacultyId
   WHERE item.ImportBatchId=@ImportBatchId ORDER BY item.SourceRow FOR JSON PATH,INCLUDE_NULL_VALUES)) items
  FROM staging.CalendarActivityImport i WHERE i.ImportBatchId=@ImportBatchId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) responseJson;
END;
GO
ALTER PROCEDURE paws_api.PreviewCalendarActivityImport @ActorFirebaseUid nvarchar(128),@ImportBatchId uniqueidentifier,@ExpectedVersion varchar(64)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF paws_api.CalendarActivityAdmin(@ActorFirebaseUid)<>1 THROW 53801,'Administrator permission is required.',1;
 BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @Version binary(8),@Status nvarchar(32),@StoredSource char(64),@Policy nvarchar(64);
  SELECT @Version=ImportVersion,@Status=Status,@StoredSource=SourceSha256,@Policy=PolicyVersion FROM staging.CalendarActivityImport WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@ImportBatchId;
  IF @Version IS NULL THROW 53803,'Import was not found.',1;
  IF @Status<>N'staged' THROW 53804,'Import is no longer staged.',1;
  IF @StoredSource<>'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF' OR @Policy NOT IN(N'afc-working-activities-v1',N'afc-working-activities-v2')
   THROW 53806,'Approved classification source does not match.',1;
  IF @ExpectedVersion IS NULL OR DATALENGTH(@ExpectedVersion)<>16 OR TRY_CONVERT(binary(8),@ExpectedVersion,2) IS NULL OR TRY_CONVERT(binary(8),@ExpectedVersion,2)<>@Version THROW 53804,'Import preview changed.',1;
  -- Owner-approved v2: Remote work is Away. Preserve raw lineage and original issues.
  UPDATE staging.CalendarActivityImportItem SET Category=NULL,ParserTreatment=N'retain_afc',
   Status=CASE WHEN ParsedIssuesJson=N'[]' AND LEN(FacultySourceName)>0 AND StartDate IS NOT NULL AND EndDate>=StartDate THEN N'retained' ELSE N'quarantined' END,
   FacultyId=NULL,ResolutionMethod=NULL,IdentityDigest=NULL,AfcRecordId=NULL,ExpectedAfcVersion=NULL,TargetCount=0,
   IssueCode=CASE WHEN ParsedIssuesJson=N'[]' AND (LEN(FacultySourceName)=0 OR StartDate IS NULL OR EndDate IS NULL OR EndDate<StartDate) THEN N'INVALID_SOURCE_ROW' END
   WHERE ImportBatchId=@ImportBatchId AND Status<>N'excluded' AND SourceRow NOT IN(267,297,563,773)
    AND paws_api.CalendarActivityTextKey(OriginalLabel)=N'REMOTE WORK (APPROVED)';
  UPDATE staging.CalendarActivityImport SET PolicyVersion=N'afc-working-activities-v2' WHERE ImportBatchId=@ImportBatchId AND PolicyVersion<>N'afc-working-activities-v2';
  IF @Policy<>N'afc-working-activities-v2'
   INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson,ImportBatchId)
    VALUES(NEWID(),N'calendar_activity_classification_revised',N'calendar_activity_import',CONVERT(nvarchar(36),@ImportBatchId),@ActorFirebaseUid,SYSUTCDATETIME(),
     N'{"fromPolicy":"afc-working-activities-v1","toPolicy":"afc-working-activities-v2","remoteWorkAway":true,"abnormalAwayNeedsReview":true}',@ImportBatchId);
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
ALTER PROCEDURE paws_api.StageCalendarActivityImport @ActorFirebaseUid nvarchar(128),@RequestId uniqueidentifier,@SourceSha256 char(64),@RowsJson nvarchar(max)
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
   VALUES(@RequestId,SYSUTCDATETIME(),N'calendar_staged',@SourceSha256,N'calendar-activity-v2',NULL,N'{}');
  INSERT staging.ImportWorkbook(ImportWorkbookId,ImportBatchId,FileName,FileSha256,FileByteLength)
   VALUES(@Workbook,@RequestId,N'AFC Tracker Lookup (2).xlsx',@SourceSha256,80154);
  INSERT staging.ImportSheet(ImportSheetId,ImportWorkbookId,SheetName,SheetIndex,MaxRow,MaxColumn,NonEmptyRowCount)
   SELECT @Sheet,@Workbook,N'AFC records',1,MAX(SourceRow),4,COUNT(*) FROM @Rows;
  INSERT staging.CalendarActivityImport(ImportBatchId,SourceSha256,Dataset,PolicyVersion,StartDate,EndDate,Status,SourceRowCount,ActorFirebaseUid)
   SELECT @RequestId,@SourceSha256,N'afc-working-activities',N'afc-working-activities-v2',
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
     WHEN r.Treatment=N'retain_afc' AND paws_api.CalendarActivityTextKey(r.OriginalLabel) IN(N'OPA',N'UNIVERSITY TRAVEL',N'VACATION',N'VACATION/UNIVERSITY TRAVEL',N'RSL',N'SPECIAL LEAVE',N'MEDICAL',N'PARENTAL LEAVE',N'ADMINISTRATIVE LEAVE',N'STUDY LEAVE',N'REMOTE WORK (APPROVED)') AND r.Issues=N'[]' THEN N'retained' ELSE N'quarantined' END,
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
ALTER PROCEDURE paws_api.CommitCalendarActivityImport
 @ActorFirebaseUid nvarchar(128),@ImportBatchId uniqueidentifier,@ExpectedVersion varchar(64),@ManifestSha256 char(64),
 @SourceSha256 char(64),@IdempotencyKey uniqueidentifier,@Confirm bit
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 IF paws_api.CalendarActivityAdmin(@ActorFirebaseUid)<>1 THROW 53801,'Administrator permission is required.',1;
 IF @Confirm IS NULL OR @Confirm<>1 OR @IdempotencyKey IS NULL THROW 53802,'Explicit confirmation and a request key are required.',1;
 DECLARE @Receipt uniqueidentifier,@Replay bit=0;
 BEGIN TRY
  BEGIN TRANSACTION;
  SELECT @Receipt=ReceiptId FROM paws.CalendarActivityImportReceipt WITH(UPDLOCK,HOLDLOCK) WHERE IdempotencyKey=@IdempotencyKey;
  IF @Receipt IS NOT NULL
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM paws.CalendarActivityImportReceipt WHERE ReceiptId=@Receipt AND ImportBatchId=@ImportBatchId
    AND SourceSha256=@SourceSha256 AND ManifestSha256=@ManifestSha256 AND ActorUid=@ActorFirebaseUid AND Status=N'committed')
    THROW 53807,'Request key does not match the committed operation.',1;
   SET @Replay=1;
  END
  ELSE
  BEGIN
   DECLARE @Version binary(8),@Status nvarchar(32),@Expires datetime2(7),@StoredManifest char(64),@StoredSource char(64),@Policy nvarchar(64),@Dataset nvarchar(64);
   SELECT @Version=ImportVersion,@Status=Status,@Expires=ExpiresAtUtc,@StoredManifest=ManifestSha256,@StoredSource=SourceSha256,@Policy=PolicyVersion,@Dataset=Dataset
    FROM staging.CalendarActivityImport WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@ImportBatchId;
   IF @Version IS NULL THROW 53803,'Import was not found.',1;
   IF @Status<>N'staged' THROW 53807,'Import already has a durable outcome.',1;
   IF @SourceSha256 IS NULL OR @ManifestSha256 IS NULL OR @StoredSource<>@SourceSha256 OR @StoredManifest<>@ManifestSha256
    OR @SourceSha256<>'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF'
    OR @Policy<>N'afc-working-activities-v2' OR @Dataset<>N'afc-working-activities' THROW 53806,'Approved source manifest does not match.',1;
   IF @Expires IS NULL OR @Expires<=SYSUTCDATETIME() THROW 53805,'Import preview expired.',1;
   IF @ExpectedVersion IS NULL OR DATALENGTH(@ExpectedVersion)<>16 OR TRY_CONVERT(binary(8),@ExpectedVersion,2) IS NULL
    OR TRY_CONVERT(binary(8),@ExpectedVersion,2)<>@Version THROW 53804,'Import preview changed.',1;
   DECLARE @ManifestRows nvarchar(max)=(SELECT SourceRow,FacultyId,ResolutionMethod,CONVERT(varchar(64),IdentityDigest,2) identityDigest,
    AfcRecordId,CONVERT(varchar(16),ExpectedAfcVersion,2) afcVersion,StartDate,EndDate,OriginalLabel,Category,Status
    FROM staging.CalendarActivityImportItem WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@ImportBatchId ORDER BY SourceRow FOR JSON PATH,INCLUDE_NULL_VALUES);
   IF NOT EXISTS(SELECT 1 FROM staging.CalendarActivityImport WHERE ImportBatchId=@ImportBatchId AND ManifestSha256=CONVERT(varchar(64),HASHBYTES('SHA2_256',
    CONCAT(SourceSha256,N'|',Dataset,N'|',PolicyVersion,N'|',CONVERT(char(10),StartDate,23),N'|',CONVERT(char(10),EndDate,23),N'|',@ManifestRows)),2))
    THROW 53806,'Stored preview manifest changed.',1;
   DECLARE @Count int=(SELECT COUNT(*) FROM staging.CalendarActivityImportItem WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@ImportBatchId AND Status=N'accepted');
   IF @Count=0 THROW 53804,'No exact eligible targets remain.',1;
   IF EXISTS(SELECT 1 FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@ImportBatchId AND Status=N'accepted' AND
    (ParserTreatment<>N'working_candidate' OR ParsedIssuesJson<>N'[]' OR Category IS NULL
     OR paws_api.CalendarActivityPurposeCategory(OriginalLabel) IS NULL OR Category<>paws_api.CalendarActivityPurposeCategory(OriginalLabel)))
    THROW 53806,'Away or abnormal source rows cannot migrate as working activities.',1;
   DECLARE @FacultyJson nvarchar(max)=(SELECT DISTINCT CONVERT(char(36),FacultyId) value FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@ImportBatchId AND Status=N'accepted' FOR JSON PATH);
   SELECT @FacultyJson=CONCAT(N'[',STRING_AGG(CONVERT(nvarchar(max),CONCAT(N'"',JSON_VALUE(value,'$.value'),N'"')),N','),N']') FROM OPENJSON(@FacultyJson);
   EXEC paws_api.AcquireCalendarActivityFacultyLocks @FacultyJson;
   -- Serializable resolution reads every tier, including absent names and newly inserted aliases.
   IF EXISTS(SELECT 1 FROM staging.CalendarActivityImportItem item CROSS APPLY paws_api.CalendarActivityFacultyResolution(item.FacultySourceName) resolution
    WHERE item.ImportBatchId=@ImportBatchId AND item.Status=N'accepted' AND
    (resolution.ResolutionStatus<>N'resolved' OR resolution.FacultyId<>item.FacultyId OR resolution.Tier<>item.ResolutionMethod
     OR resolution.IdentityDigest IS NULL OR resolution.IdentityDigest<>item.IdentityDigest)) THROW 53804,'Faculty identity evidence changed.',1;
   -- Revalidate the whole preview predicate, including newly inserted matches.
   -- Keep its key ranges locked until the receipt and exact deletion commit.
   IF EXISTS(SELECT 1 FROM staging.CalendarActivityImportItem item
    CROSS APPLY(SELECT COUNT(*) TargetCount,MIN(CONVERT(char(36),a.AfcRecordId)) TargetId,
      MIN(CONVERT(varchar(16),CONVERT(binary(8),a.AfcVersion),2)) TargetVersion
      FROM paws.AfcRecord a WITH(UPDLOCK,HOLDLOCK)
      WHERE a.Active=1 AND a.FacultyId=item.FacultyId AND a.StartDate=item.StartDate AND a.EndDate=item.EndDate
       AND paws_api.CalendarActivityTextKey(a.Purpose)=paws_api.CalendarActivityTextKey(item.OriginalLabel)) targets
    WHERE item.ImportBatchId=@ImportBatchId AND item.Status=N'accepted' AND
     (targets.TargetCount<>1 OR TRY_CONVERT(uniqueidentifier,targets.TargetId)<>item.AfcRecordId
      OR TRY_CONVERT(binary(8),targets.TargetVersion,2)<>item.ExpectedAfcVersion))
    THROW 53804,'The complete exact AFC match set changed.',1;
   IF EXISTS(SELECT 1 FROM staging.CalendarActivityImportItem item LEFT JOIN paws.AfcRecord a WITH(UPDLOCK,HOLDLOCK) ON a.AfcRecordId=item.AfcRecordId
    WHERE item.ImportBatchId=@ImportBatchId AND item.Status=N'accepted' AND
    (a.AfcRecordId IS NULL OR a.Active<>1 OR a.AfcVersion<>item.ExpectedAfcVersion OR a.FacultyId<>item.FacultyId OR a.StartDate<>item.StartDate OR a.EndDate<>item.EndDate
     OR paws_api.CalendarActivityTextKey(a.Purpose)<>paws_api.CalendarActivityTextKey(item.OriginalLabel)
     OR NOT EXISTS(SELECT 1 FROM staging.AfcRecordRaw raw WITH(HOLDLOCK) WHERE raw.ImportBatchId=a.SourceImportBatchId AND raw.SourceRowNumber=a.SourceRow)))
    THROW 53804,'Exact imported AFC targets changed.',1;
   IF EXISTS(SELECT AfcRecordId FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@ImportBatchId AND Status=N'accepted' GROUP BY AfcRecordId HAVING COUNT(*)<>1)
    THROW 53804,'Targets are not unique.',1;
   -- No current imported AFC foreign references exist. A future reference requires an explicit reviewed deletion policy.
   DECLARE @ProtectedReferences bit;
   EXEC paws_api.CalendarActivityProtectedReferences N'afc',@ProtectedReferences OUTPUT;
   IF @ProtectedReferences=1 THROW 53808,'AFC references require a reviewed migration policy.',1;
   SET @Receipt=NEWID();
   INSERT paws.CalendarActivityImportReceipt(ReceiptId,ImportBatchId,Dataset,SourceSha256,ManifestSha256,IdempotencyKey,InsertedCount,DeletedAfcCount,ActorUid)
    VALUES(@Receipt,@ImportBatchId,@Dataset,@SourceSha256,@ManifestSha256,@IdempotencyKey,@Count,@Count,@ActorFirebaseUid);
   DECLARE @Created TABLE(ActivityId uniqueidentifier,SourceRow int,Version binary(8));
   INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid)
    OUTPUT inserted.ActivityId,inserted.SourceRow,inserted.ActivityVersion INTO @Created
    SELECT NEWID(),FacultyId,Category,OriginalLabel,StartDate,EndDate,@ImportBatchId,ImportRowId,@SourceSha256,N'AFC records',SourceRow,@ActorFirebaseUid
    FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@ImportBatchId AND Status=N'accepted';
   IF @@ROWCOUNT<>@Count THROW 53804,'Activity insertion count changed.',1;
   INSERT paws.CalendarActivityRecoveryRow(ReceiptId,OriginalAfcRecordId,ActivityId,ImportedActivityVersion,BeforeAfcJson)
    SELECT @Receipt,a.AfcRecordId,c.ActivityId,c.Version,
     (SELECT a.AfcRecordId,a.FacultyId,a.StartDate,a.EndDate,a.Purpose,a.Active,a.SourceImportBatchId,a.SourceRow,CONVERT(varchar(16),CONVERT(binary(8),a.AfcVersion),2) AfcVersion
       FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)
    FROM staging.CalendarActivityImportItem item JOIN paws.AfcRecord a ON a.AfcRecordId=item.AfcRecordId JOIN @Created c ON c.SourceRow=item.SourceRow
    WHERE item.ImportBatchId=@ImportBatchId AND item.Status=N'accepted';
   IF @@ROWCOUNT<>@Count THROW 53804,'Recovery before-image count changed.',1;
   DELETE a FROM paws.AfcRecord a JOIN staging.CalendarActivityImportItem item ON item.AfcRecordId=a.AfcRecordId
    WHERE item.ImportBatchId=@ImportBatchId AND item.Status=N'accepted' AND a.Active=1 AND a.AfcVersion=item.ExpectedAfcVersion;
   IF @@ROWCOUNT<>@Count THROW 53804,'Exact AFC deletion count changed.',1;
   UPDATE staging.CalendarActivityImport SET Status=N'committed' WHERE ImportBatchId=@ImportBatchId;
   UPDATE staging.ImportBatch SET Status=N'calendar_committed' WHERE ImportBatchId=@ImportBatchId;
   INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson,RequestId,ImportBatchId)
    VALUES(NEWID(),N'calendar_activity_import_committed',N'calendar_activity_receipt',CONVERT(nvarchar(36),@Receipt),@ActorFirebaseUid,SYSUTCDATETIME(),
     (SELECT @Count insertedCount,@Count deletedAfcCount,@ManifestSha256 manifestSha256 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@IdempotencyKey,@ImportBatchId);
  END;
  COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION;THROW;END CATCH;
 SELECT (SELECT ReceiptId receiptId,ImportBatchId batchId,SourceSha256 sourceSha256,ManifestSha256 manifestSha256,InsertedCount insertedCount,
  DeletedAfcCount deletedAfcCount,CommittedAtUtc committedAtUtc,@Replay idempotentReplay FROM paws.CalendarActivityImportReceipt WHERE ReceiptId=@Receipt
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
END;
GO
COMMIT TRANSACTION;
