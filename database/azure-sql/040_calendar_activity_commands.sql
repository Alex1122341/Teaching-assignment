/* Receipt-bound atomic commands. Permissions and runtime activation are separate. */
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
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws.CalendarActivity') IS NULL THROW 53800,'Calendar foundation is required.',1;
IF OBJECT_ID(N'paws_api.CommitCalendarActivityImport') IS NOT NULL THROW 53800,'Inspect existing commands before applying.',1;
BEGIN TRANSACTION;
GO
CREATE PROCEDURE paws_api.AcquireCalendarActivityFacultyLocks @FacultyIdsJson nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 OR ISJSON(@FacultyIdsJson)<>1 OR LEFT(LTRIM(@FacultyIdsJson),1)<>N'['
  OR EXISTS(SELECT 1 FROM OPENJSON(@FacultyIdsJson) WHERE TRY_CONVERT(uniqueidentifier,value) IS NULL)
  THROW 53809,'A transaction and canonical faculty keys are required.',1;
 DECLARE @Id uniqueidentifier,@Resource nvarchar(255),@Result int;
 DECLARE facultyLocks CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@FacultyIdsJson) ORDER BY 1;
 OPEN facultyLocks;FETCH NEXT FROM facultyLocks INTO @Id;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Resource=CONCAT(N'paws:calendar-availability:',CONVERT(char(36),@Id));
  EXEC @Result=sys.sp_getapplock @Resource=@Resource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=5000,@DbPrincipal=N'dbo';
  IF @Result<0 THROW 53809,'Faculty availability is busy. Retry with a fresh preview.',1;
  FETCH NEXT FROM facultyLocks INTO @Id;
 END;
 CLOSE facultyLocks;DEALLOCATE facultyLocks;
END;
GO
/* Metadata visibility is evaluated as the object owner, without granting catalog or table access to callers. */
CREATE PROCEDURE paws_api.CalendarActivityProtectedReferences @Target nvarchar(16),@Protected bit OUTPUT
WITH EXECUTE AS OWNER
AS
BEGIN
 SET NOCOUNT ON;
 IF @Target IS NULL OR @Target COLLATE Latin1_General_100_BIN2 NOT IN(N'afc',N'activity') THROW 53808,'Unsupported protected-reference target.',1;
 DECLARE @Object int=OBJECT_ID(CASE @Target WHEN N'afc' THEN N'paws.AfcRecord' ELSE N'paws.CalendarActivity' END),@DayTime int=OBJECT_ID(N'paws.CalendarActivityDayTime');
 IF @Object IS NULL OR @DayTime IS NULL THROW 53808,'Protected-reference metadata is unavailable.',1;
 SET @Protected=CASE WHEN EXISTS(SELECT 1 FROM sys.foreign_keys WHERE referenced_object_id=@Object AND (@Target=N'afc' OR parent_object_id<>@DayTime)) THEN 1 ELSE 0 END;
END;
GO
CREATE PROCEDURE paws_api.CommitCalendarActivityImport
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
    OR @Policy<>N'afc-working-activities-v1' OR @Dataset<>N'afc-working-activities' THROW 53806,'Approved source manifest does not match.',1;
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
CREATE PROCEDURE paws_api.ResolveCalendarActivityDayTime
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
  IF @Faculty IS NULL THROW 53803,'Activity was not found.',1;
  DECLARE @FacultyJson nvarchar(max)=CONCAT(N'["',CONVERT(char(36),@Faculty),N'"]');
  EXEC paws_api.AcquireCalendarActivityFacultyLocks @FacultyJson;
  DECLARE @Version binary(8),@StartDate date,@EndDate date;
  SELECT @Version=ActivityVersion,@StartDate=StartDate,@EndDate=EndDate FROM paws.CalendarActivity WITH(UPDLOCK,HOLDLOCK) WHERE ActivityId=@ActivityId AND FacultyId=@Faculty;
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
 SELECT (SELECT a.ActivityId activityId,c.CandidateKey facultyKey,COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName) facultyDisplayName,
  a.Category category,a.OriginalLabel label,a.StartDate startDate,a.EndDate endDate,course.CourseCode courseCode,
  CASE WHEN (SELECT COUNT(*) FROM paws.CalendarActivityDayTime WHERE ActivityId=a.ActivityId)=DATEDIFF(day,a.StartDate,a.EndDate)+1 THEN N'verified' ELSE N'partial' END timeStatus,
  CONVERT(varchar(16),CONVERT(binary(8),a.ActivityVersion),2) version,
  JSON_QUERY((SELECT ActivityDate date,CONVERT(char(5),StartTime,108) startTime,CONVERT(char(5),EndTime,108) endTime FROM paws.CalendarActivityDayTime WHERE ActivityId=a.ActivityId ORDER BY ActivityDate FOR JSON PATH)) timeEvidence
  FROM paws.CalendarActivity a JOIN paws.Faculty f ON f.FacultyId=a.FacultyId LEFT JOIN paws.SwapCandidate c ON c.FacultyId=a.FacultyId LEFT JOIN paws.Course course ON course.CourseId=a.CourseId
  WHERE a.ActivityId=@ActivityId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) responseJson;
END;
GO
CREATE PROCEDURE paws_api.ExportCalendarActivityRecovery @ActorFirebaseUid nvarchar(128),@ReceiptId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;
 IF paws_api.CalendarActivityAdmin(@ActorFirebaseUid)<>1 OR (USER_NAME()<>N'dbo' AND COALESCE(IS_ROLEMEMBER(N'paws_calendar_recovery_admin'),0)<>1)
  THROW 53801,'Trusted recovery permission is required.',1;
 IF NOT EXISTS(SELECT 1 FROM paws.CalendarActivityImportReceipt WHERE ReceiptId=@ReceiptId) THROW 53803,'Receipt was not found.',1;
 DECLARE @Json nvarchar(max)=(SELECT r.ReceiptId receiptId,r.ImportBatchId batchId,r.SourceSha256 sourceSha256,r.ManifestSha256 manifestSha256,
  JSON_QUERY((SELECT OriginalAfcRecordId originalAfcRecordId,ActivityId activityId,CONVERT(varchar(16),ImportedActivityVersion,2) importedActivityVersion,JSON_QUERY(BeforeAfcJson) beforeAfc
   FROM paws.CalendarActivityRecoveryRow WHERE ReceiptId=r.ReceiptId ORDER BY OriginalAfcRecordId FOR JSON PATH)) rows
  FROM paws.CalendarActivityImportReceipt r WHERE ReceiptId=@ReceiptId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 SELECT @Json recoveryJson,CONVERT(varchar(64),HASHBYTES('SHA2_256',@Json),2) recoverySha256;
END;
GO
CREATE PROCEDURE paws_api.RecoverCalendarActivityImport @ActorFirebaseUid nvarchar(128),@ReceiptId uniqueidentifier,@ExpectedRecoverySha256 char(64),@Confirm bit
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF paws_api.CalendarActivityAdmin(@ActorFirebaseUid)<>1 OR (USER_NAME()<>N'dbo' AND COALESCE(IS_ROLEMEMBER(N'paws_calendar_recovery_admin'),0)<>1)
  THROW 53801,'Trusted recovery permission is required.',1;
 IF @Confirm IS NULL OR @Confirm<>1 OR @ExpectedRecoverySha256 IS NULL THROW 53802,'Explicit verified recovery is required.',1;
 BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @Batch uniqueidentifier,@Status nvarchar(32),@Count int;
  SELECT @Batch=ImportBatchId,@Status=Status,@Count=InsertedCount FROM paws.CalendarActivityImportReceipt WITH(UPDLOCK,HOLDLOCK) WHERE ReceiptId=@ReceiptId;
  IF @Batch IS NULL THROW 53803,'Receipt was not found.',1;
  IF @Status<>N'committed' THROW 53804,'Receipt is not recoverable.',1;
  DECLARE @LockedBatch uniqueidentifier;
  SELECT @LockedBatch=ImportBatchId FROM staging.CalendarActivityImport WITH(UPDLOCK,HOLDLOCK) WHERE ImportBatchId=@Batch;
  DECLARE @Recovery TABLE(recoveryJson nvarchar(max),recoverySha256 char(64));
  INSERT @Recovery EXEC paws_api.ExportCalendarActivityRecovery @ActorFirebaseUid,@ReceiptId;
  IF NOT EXISTS(SELECT 1 FROM @Recovery WHERE recoverySha256=@ExpectedRecoverySha256) THROW 53806,'Recovery artifact does not match.',1;
  DECLARE @FacultyJson nvarchar(max)=(SELECT CONCAT(N'[',STRING_AGG(CONVERT(nvarchar(max),CONCAT(N'"',Faculty,N'"')),N','),N']') FROM
   (SELECT DISTINCT JSON_VALUE(BeforeAfcJson,'$.FacultyId') Faculty FROM paws.CalendarActivityRecoveryRow WITH(UPDLOCK,HOLDLOCK) WHERE ReceiptId=@ReceiptId) ids);
  EXEC paws_api.AcquireCalendarActivityFacultyLocks @FacultyJson;
  IF (SELECT COUNT(*) FROM paws.CalendarActivityRecoveryRow WHERE ReceiptId=@ReceiptId)<>@Count OR
   EXISTS(SELECT 1 FROM paws.CalendarActivityRecoveryRow r LEFT JOIN paws.CalendarActivity a WITH(UPDLOCK,HOLDLOCK) ON a.ActivityId=r.ActivityId
    WHERE r.ReceiptId=@ReceiptId AND (a.ActivityId IS NULL OR a.ActivityVersion<>r.ImportedActivityVersion OR a.ImportBatchId<>@Batch
     OR EXISTS(SELECT 1 FROM paws.CalendarActivityDayTime WITH(UPDLOCK,HOLDLOCK) WHERE ActivityId=r.ActivityId)
     OR EXISTS(SELECT 1 FROM paws.AfcRecord WITH(UPDLOCK,HOLDLOCK) WHERE AfcRecordId=r.OriginalAfcRecordId))) THROW 53804,'Newer activity or AFC state prevents recovery.',1;
  DECLARE @ProtectedReferences bit;
  EXEC paws_api.CalendarActivityProtectedReferences N'activity',@ProtectedReferences OUTPUT;
  IF @ProtectedReferences=1 THROW 53808,'Activity references require a reviewed recovery policy.',1;
  INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow)
   SELECT j.AfcRecordId,j.FacultyId,j.StartDate,j.EndDate,j.Purpose,j.Active,j.SourceImportBatchId,j.SourceRow
   FROM paws.CalendarActivityRecoveryRow r CROSS APPLY OPENJSON(r.BeforeAfcJson) WITH(AfcRecordId uniqueidentifier,FacultyId uniqueidentifier,StartDate date,EndDate date,Purpose nvarchar(1000),Active bit,SourceImportBatchId uniqueidentifier,SourceRow int) j WHERE r.ReceiptId=@ReceiptId;
  IF @@ROWCOUNT<>@Count THROW 53804,'Recovery insertion count changed.',1;
  DELETE a FROM paws.CalendarActivity a JOIN paws.CalendarActivityRecoveryRow r ON r.ActivityId=a.ActivityId WHERE r.ReceiptId=@ReceiptId AND a.ActivityVersion=r.ImportedActivityVersion;
  IF @@ROWCOUNT<>@Count THROW 53804,'Recovery deletion count changed.',1;
  UPDATE paws.CalendarActivityImportReceipt SET Status=N'recovered' WHERE ReceiptId=@ReceiptId;
  UPDATE staging.CalendarActivityImport SET Status=N'recovered' WHERE ImportBatchId=@Batch;
  UPDATE staging.ImportBatch SET Status=N'calendar_recovered' WHERE ImportBatchId=@Batch;
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,OccurredAtUtc,MetadataJson,ImportBatchId)
   VALUES(NEWID(),N'calendar_activity_import_recovered',N'calendar_activity_receipt',CONVERT(nvarchar(36),@ReceiptId),@ActorFirebaseUid,SYSUTCDATETIME(),
    (SELECT @ExpectedRecoverySha256 recoverySha256,@Count restoredAfcCount FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@Batch);
  COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION;THROW;END CATCH;
 SELECT (SELECT @ReceiptId receiptId,@Count restoredAfcCount,CAST(1 AS bit) recovered FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
END;
GO
COMMIT TRANSACTION;
