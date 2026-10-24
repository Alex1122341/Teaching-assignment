/* Commit identity read-shape correction only; no apply-time business, grant or membership writes. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;SET ANSI_WARNINGS ON;SET ARITHABORT ON;SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;
IF DB_NAME()<>N'VetMed-Ops' THROW 54600,'Commit preflight requires VetMed-Ops.',1;
DECLARE @Expected TABLE(ObjectName sysname PRIMARY KEY,DefinitionHash char(64),Kind nvarchar(16));
INSERT @Expected VALUES
(N'CommitCalendarActivityImport','19C5A732D9ABD432A96BCAAEE5462CA71B43A42D5172EF9F800914D5B3EB3CE1',N'PROCEDURE'),
(N'CalendarActivityFacultyResolution','D748290AC859D4E30BDF0A08EE1AB52C02DC5D71AEE0B23A63EB0FC5BEBE13DF',N'FUNCTION');
IF EXISTS(SELECT 1 FROM @Expected e LEFT JOIN sys.objects o ON o.schema_id=SCHEMA_ID(N'paws_api') AND o.name=e.ObjectName
 LEFT JOIN sys.sql_modules m ON m.object_id=o.object_id WHERE m.object_id IS NULL OR m.uses_ansi_nulls<>1 OR m.uses_quoted_identifier<>1
 OR e.DefinitionHash<>CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),TRIM(CHAR(9)+CHAR(10)+CHAR(13)+CHAR(32) FROM
 STUFF(REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)),1,CHARINDEX(e.Kind,UPPER(REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10))))-1,N'')))),2))
 THROW 54600,'Calendar commit preflight module drift; inspect before applying.',1;
BEGIN TRANSACTION;
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
