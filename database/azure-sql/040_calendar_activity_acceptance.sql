:ON ERROR EXIT
SET NOCOUNT ON;
IF OBJECT_ID(N'paws_api.CommitCalendarActivityImport') IS NULL THROW 53890,'Atomic activity commands are missing.',1;
GO
CREATE PROCEDURE dbo.CalendarActivityTestPrepare
 @Row int,@Faculty uniqueidentifier OUTPUT,@Afc uniqueidentifier OUTPUT,@Batch uniqueidentifier OUTPUT,@Version varchar(16) OUTPUT,@Manifest char(64) OUTPUT
AS
BEGIN
 SET NOCOUNT ON;
 SET @Faculty=NEWID();SET @Afc=NEWID();SET @Batch=NEWID();
 DECLARE @Source uniqueidentifier=NEWID(),@Raw uniqueidentifier=NEWID(),@Name nvarchar(256)=CONCAT(N'Synthetic ',CONVERT(char(36),@Faculty));
 IF NOT EXISTS(SELECT 1 FROM paws.UserProfile WHERE FirebaseUid=N'calendar-command-admin')
  INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,Active,MustChangePassword) VALUES(N'calendar-command-admin',N'commands@example.test',N'Synthetic Command Admin',N'owner',1,0);
 INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson)
 VALUES(@Source,SYSUTCDATETIME(),N'synthetic',REPLICATE('A',64),N'test',N'{}');
 INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',@Name,1,@Source);
 INSERT paws.SwapCandidate(FacultyId) VALUES(@Faculty);
 INSERT staging.AfcRecordRaw(ImportBatchId,ImportRowId,SourceRowNumber,FacultySourceName,StartDate,EndDate,Purpose,RawJson,ValidationStatus,ValidationErrorsJson)
 VALUES(@Source,@Raw,@Row,@Name,'2026-11-05','2026-11-06',N'CCC Day',N'{}',N'valid',N'[]');
 INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow)
 VALUES(@Afc,@Faculty,'2026-11-05','2026-11-06',N'CCC Day',1,@Source,@Row);
 DECLARE @Rows nvarchar(max)=(SELECT @Row sourceRow,@Name facultySourceName,N'2026-11-05' startDate,N'2026-11-06' endDate,N'CCC Day' originalLabel,N'ccc' category,N'working_candidate' treatment,JSON_QUERY(N'[]') issues FOR JSON PATH);
 DECLARE @Response TABLE(responseJson nvarchar(max));
 INSERT @Response EXEC paws_api.StageCalendarActivityImport N'calendar-command-admin',@Batch,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Rows;
 SELECT @Version=JSON_VALUE(responseJson,'$.previewVersion'),@Manifest=JSON_VALUE(responseJson,'$.manifestSha256') FROM @Response;
END;
GO
CREATE PROCEDURE dbo.CalendarActivityTestProtected
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Name sysname,@Sql nvarchar(max),@Hash binary(32);
 DECLARE @State TABLE(objectName sysname,fingerprint binary(32));
 DECLARE protectedTables CURSOR LOCAL FAST_FORWARD FOR
  SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID(N'paws') AND
   (name IN(N'Session',N'SessionAssignment') OR name LIKE N'Doe%' OR name LIKE N'TeachingAssignmentPublished%') ORDER BY name;
 OPEN protectedTables;FETCH NEXT FROM protectedTables INTO @Name;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Sql=N'SELECT @Result=HASHBYTES(''SHA2_256'',COALESCE(STRING_AGG(CONVERT(nvarchar(max),RowHash),N''|'') WITHIN GROUP(ORDER BY RowHash),N'''')) FROM '
   +N'(SELECT CONVERT(varchar(64),HASHBYTES(''SHA2_256'',(SELECT t.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)),2) RowHash FROM paws.'+QUOTENAME(@Name)+N' t) hashes;';
  EXEC sys.sp_executesql @Sql,N'@Result binary(32) OUTPUT',@Result=@Hash OUTPUT;
  INSERT @State VALUES(@Name,@Hash);
  FETCH NEXT FROM protectedTables INTO @Name;
 END;
 CLOSE protectedTables;DEALLOCATE protectedTables;
 SELECT objectName,fingerprint FROM @State ORDER BY objectName;
END;
GO
DECLARE @ProtectedBefore TABLE(objectName sysname,fingerprint binary(32));
INSERT @ProtectedBefore EXEC dbo.CalendarActivityTestProtected;
DECLARE @Faculty uniqueidentifier,@Afc uniqueidentifier,@Batch uniqueidentifier,@Version varchar(16),@Manifest char(64),@Key uniqueidentifier,@Case int=1,@Expected int,@Rejected bit,@FixtureRow int;
WHILE @Case<=11
BEGIN
 SET @FixtureRow=@Case+100;
 EXEC dbo.CalendarActivityTestPrepare @Row=@FixtureRow,@Faculty=@Faculty OUTPUT,@Afc=@Afc OUTPUT,@Batch=@Batch OUTPUT,@Version=@Version OUTPUT,@Manifest=@Manifest OUTPUT;
 SET @Key=NEWID();SET @Expected=53804;SET @Rejected=0;
 IF @Case=1 UPDATE paws.AfcRecord SET Active=0 WHERE AfcRecordId=@Afc;
 IF @Case=2 UPDATE paws.AfcRecord SET Purpose=N'Vacation' WHERE AfcRecordId=@Afc;
 IF @Case=3 UPDATE paws.Faculty SET Active=0,UpdatedAtUtc=SYSUTCDATETIME() WHERE FacultyId=@Faculty;
 IF @Case=4
 BEGIN
  UPDATE staging.CalendarActivityImport SET ExpiresAtUtc=DATEADD(minute,-1,SYSUTCDATETIME()) WHERE ImportBatchId=@Batch;
  SELECT @Version=CONVERT(varchar(16),CONVERT(binary(8),ImportVersion),2) FROM staging.CalendarActivityImport WHERE ImportBatchId=@Batch;
  SET @Expected=53805;
 END;
 IF @Case=5 SET @Manifest=REPLICATE('0',64);
 IF @Case=5 SET @Expected=53806;
 IF @Case=6
  INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId)
   SELECT NEWID(),RecordType,DisplayName,1,SourceImportBatchId FROM paws.Faculty WHERE FacultyId=@Faculty;
 IF @Case=7 DELETE raw FROM staging.AfcRecordRaw raw JOIN paws.AfcRecord a ON a.SourceImportBatchId=raw.ImportBatchId AND a.SourceRow=raw.SourceRowNumber WHERE a.AfcRecordId=@Afc;
 IF @Case=8 UPDATE staging.CalendarActivityImport SET ExpiresAtUtc=DATEADD(minute,1,ExpiresAtUtc) WHERE ImportBatchId=@Batch;
 IF @Case=9 UPDATE staging.CalendarActivityImportItem SET Category=N'clinical_day' WHERE ImportBatchId=@Batch;
 IF @Case=9 SET @Expected=53806;
 IF @Case=10 UPDATE paws.Faculty SET DisplayName=CONCAT(DisplayName,N' changed') WHERE FacultyId=@Faculty;
 IF @Case=11
 BEGIN
  INSERT staging.AfcRecordRaw(ImportBatchId,ImportRowId,SourceRowNumber,FacultySourceName,StartDate,EndDate,Purpose,RawJson,ValidationStatus,ValidationErrorsJson)
   SELECT raw.ImportBatchId,NEWID(),raw.SourceRowNumber+9000,raw.FacultySourceName,raw.StartDate,raw.EndDate,raw.Purpose,raw.RawJson,raw.ValidationStatus,raw.ValidationErrorsJson
   FROM staging.AfcRecordRaw raw JOIN paws.AfcRecord a ON a.SourceImportBatchId=raw.ImportBatchId AND a.SourceRow=raw.SourceRowNumber WHERE a.AfcRecordId=@Afc;
  INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow)
   SELECT NEWID(),FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow+9000 FROM paws.AfcRecord WHERE AfcRecordId=@Afc;
 END;
 BEGIN TRY
  EXEC paws_api.CommitCalendarActivityImport N'calendar-command-admin',@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;
 END TRY BEGIN CATCH IF ERROR_NUMBER()=@Expected SET @Rejected=1;ELSE THROW;END CATCH;
 IF @Rejected=0 OR NOT EXISTS(SELECT 1 FROM paws.AfcRecord WHERE AfcRecordId=@Afc) OR EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ImportBatchId=@Batch)
  THROW 53890,'Stale/expired/ambiguous import was not rejected atomically.',1;
 IF @Case=11 AND ((SELECT COUNT(*) FROM paws.AfcRecord WHERE FacultyId=@Faculty AND Active=1)<>2
  OR EXISTS(SELECT 1 FROM paws.CalendarActivityImportReceipt WHERE ImportBatchId=@Batch)
  OR EXISTS(SELECT 1 FROM paws.AuditEvent WHERE ImportBatchId=@Batch AND EventType=N'calendar_activity_import_committed'))
  THROW 53890,'Late duplicate match was not preserved without receipt or commit audit.',1;
 SET @Case+=1;
END;
-- Failure at either business write boundary must also preserve both sides.
SET @Case=1;
WHILE @Case<=2
BEGIN
 SET @FixtureRow=40+@Case;
 EXEC dbo.CalendarActivityTestPrepare @Row=@FixtureRow,@Faculty=@Faculty OUTPUT,@Afc=@Afc OUTPUT,@Batch=@Batch OUTPUT,@Version=@Version OUTPUT,@Manifest=@Manifest OUTPUT;
 SET @Key=NEWID();SET @Rejected=0;
 IF @Case=1 EXEC(N'CREATE TRIGGER paws.TR_CalendarActivityTestRejectInsert ON paws.CalendarActivity AFTER INSERT AS THROW 53899,''Synthetic activity insert failure.'',1;');
 ELSE EXEC(N'CREATE TRIGGER paws.TR_CalendarActivityTestRejectDelete ON paws.AfcRecord AFTER DELETE AS THROW 53899,''Synthetic AFC delete failure.'',1;');
 BEGIN TRY EXEC paws_api.CommitCalendarActivityImport N'calendar-command-admin',@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1; END TRY
 BEGIN CATCH IF ERROR_NUMBER()=53899 SET @Rejected=1;ELSE THROW;END CATCH;
 IF @Case=1 DROP TRIGGER paws.TR_CalendarActivityTestRejectInsert;
 ELSE DROP TRIGGER paws.TR_CalendarActivityTestRejectDelete;
 IF @Rejected=0 OR NOT EXISTS(SELECT 1 FROM paws.AfcRecord WHERE AfcRecordId=@Afc AND Active=1) OR EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ImportBatchId=@Batch)
  OR EXISTS(SELECT 1 FROM paws.CalendarActivityImportReceipt WHERE ImportBatchId=@Batch) THROW 53890,'Business-write failure did not fully roll back.',1;
 SET @Case+=1;
END;
-- A failure injected into the durable commit audit must roll back insert and delete.
EXEC dbo.CalendarActivityTestPrepare @Row=20,@Faculty=@Faculty OUTPUT,@Afc=@Afc OUTPUT,@Batch=@Batch OUTPUT,@Version=@Version OUTPUT,@Manifest=@Manifest OUTPUT;
SET @Key=NEWID();
EXEC(N'CREATE TRIGGER paws.TR_CalendarActivityTestRejectAudit ON paws.AuditEvent AFTER INSERT AS IF EXISTS(SELECT 1 FROM inserted WHERE EventType=N''calendar_activity_import_committed'') THROW 53899,''Synthetic injected audit failure.'',1;');
SET @Rejected=0;
BEGIN TRY EXEC paws_api.CommitCalendarActivityImport N'calendar-command-admin',@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53899 SET @Rejected=1;ELSE THROW;END CATCH;
DROP TRIGGER paws.TR_CalendarActivityTestRejectAudit;
IF @Rejected=0 OR NOT EXISTS(SELECT 1 FROM paws.AfcRecord WHERE AfcRecordId=@Afc AND Active=1) OR EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ImportBatchId=@Batch)
 OR EXISTS(SELECT 1 FROM paws.CalendarActivityImportReceipt WHERE ImportBatchId=@Batch) THROW 53890,'Commit audit failure did not fully roll back.',1;
EXEC dbo.CalendarActivityTestPrepare @Row=21,@Faculty=@Faculty OUTPUT,@Afc=@Afc OUTPUT,@Batch=@Batch OUTPUT,@Version=@Version OUTPUT,@Manifest=@Manifest OUTPUT;
SET @Key=NEWID();
DECLARE @OriginalVersion binary(8)=(SELECT AfcVersion FROM paws.AfcRecord WHERE AfcRecordId=@Afc);
DECLARE @OtherAfc uniqueidentifier=NEWID(),@UnknownAfc uniqueidentifier=NEWID(),@Manual uniqueidentifier=NEWID();
INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow)
 SELECT @OtherAfc,FacultyId,StartDate,EndDate,N'OPA',1,SourceImportBatchId,22 FROM paws.AfcRecord WHERE AfcRecordId=@Afc
 UNION ALL SELECT @UnknownAfc,FacultyId,StartDate,EndDate,N'Unclassified synthetic',1,SourceImportBatchId,23 FROM paws.AfcRecord WHERE AfcRecordId=@Afc;
INSERT paws.AfcManualRecord(AfcRecordId,FacultyId,StartDate,EndDate,ReasonCode,Notes,CreatedByFirebaseUid,RequestId)
 VALUES(@Manual,@Faculty,'2026-11-05','2026-11-06',N'other',N'CCC Day',N'calendar-command-admin',NEWID());
DECLARE @PreservedAfc binary(32)=HASHBYTES('SHA2_256',(SELECT * FROM paws.AfcRecord WHERE AfcRecordId<>@Afc ORDER BY AfcRecordId FOR JSON PATH,INCLUDE_NULL_VALUES));
DECLARE @PreservedManual binary(32)=HASHBYTES('SHA2_256',(SELECT * FROM paws.AfcManualRecord ORDER BY AfcRecordId FOR JSON PATH,INCLUDE_NULL_VALUES));
DECLARE @Reply TABLE(responseJson nvarchar(max));
INSERT @Reply EXEC paws_api.CommitCalendarActivityImport N'calendar-command-admin',@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;
DECLARE @Receipt uniqueidentifier=(SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(responseJson,'$.receiptId')) FROM @Reply);
IF @Receipt IS NULL OR EXISTS(SELECT 1 FROM paws.AfcRecord WHERE AfcRecordId=@Afc) OR (SELECT COUNT(*) FROM paws.CalendarActivity WHERE ImportBatchId=@Batch)<>1
 THROW 53890,'Successful import did not perform exact two-sided movement.',1;
DELETE @Reply;
INSERT @Reply EXEC paws_api.CommitCalendarActivityImport N'calendar-command-admin',@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;
IF JSON_VALUE((SELECT responseJson FROM @Reply),'$.idempotentReplay')<>N'true' OR (SELECT COUNT(*) FROM paws.CalendarActivityImportReceipt WHERE IdempotencyKey=@Key)<>1
 THROW 53890,'Lost-response retry created duplicate work.',1;
IF (SELECT COUNT(*) FROM paws.AuditEvent WHERE RequestId=@Key AND EventType=N'calendar_activity_import_committed')<>1 THROW 53890,'Retry duplicated commit audit.',1;
SET @Rejected=0;
DECLARE @DifferentKey uniqueidentifier=NEWID();
BEGIN TRY EXEC paws_api.CommitCalendarActivityImport N'calendar-command-admin',@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@DifferentKey,1; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53807 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 THROW 53890,'Changed-key retry was accepted.',1;
SET @Rejected=0;
BEGIN TRY EXEC paws_api.CommitCalendarActivityImport N'calendar-command-admin',@Batch,@Version,@Manifest,'0000000000000000000000000000000000000000000000000000000000000000',@Key,1; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53807 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 THROW 53890,'Changed-hash replay was accepted.',1;
DECLARE @Recovery TABLE(recoveryJson nvarchar(max),recoverySha256 char(64));
INSERT @Recovery EXEC paws_api.ExportCalendarActivityRecovery N'calendar-command-admin',@Receipt;
DECLARE @RecoveryHash char(64)=(SELECT recoverySha256 FROM @Recovery);
EXEC paws_api.RecoverCalendarActivityImport N'calendar-command-admin',@Receipt,@RecoveryHash,1;
IF NOT EXISTS(SELECT 1 FROM paws.AfcRecord WHERE AfcRecordId=@Afc AND AfcVersion<>@OriginalVersion)
 OR EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ImportBatchId=@Batch) THROW 53890,'Narrow recovery did not restore exact identity with a new version.',1;
IF @PreservedAfc<>HASHBYTES('SHA2_256',(SELECT * FROM paws.AfcRecord WHERE AfcRecordId<>@Afc ORDER BY AfcRecordId FOR JSON PATH,INCLUDE_NULL_VALUES))
 OR @PreservedManual<>HASHBYTES('SHA2_256',(SELECT * FROM paws.AfcManualRecord ORDER BY AfcRecordId FOR JSON PATH,INCLUDE_NULL_VALUES))
 THROW 53890,'Retained, unrelated, manual or unclassified AFC changed.',1;
-- Editing one verified date bumps the parent token and prevents overwriting it via recovery.
EXEC dbo.CalendarActivityTestPrepare @Row=30,@Faculty=@Faculty OUTPUT,@Afc=@Afc OUTPUT,@Batch=@Batch OUTPUT,@Version=@Version OUTPUT,@Manifest=@Manifest OUTPUT;
SET @Key=NEWID();DELETE @Reply;
INSERT @Reply EXEC paws_api.CommitCalendarActivityImport N'calendar-command-admin',@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;
SELECT @Receipt=TRY_CONVERT(uniqueidentifier,JSON_VALUE(responseJson,'$.receiptId')) FROM @Reply;
DECLARE @Activity uniqueidentifier,@ActivityVersion varchar(16);
SELECT @Activity=ActivityId,@ActivityVersion=CONVERT(varchar(16),CONVERT(binary(8),ActivityVersion),2) FROM paws.CalendarActivity WHERE ImportBatchId=@Batch;
SET @Rejected=0;
BEGIN TRY EXEC paws_api.ResolveCalendarActivityDayTime N'calendar-command-admin',@Activity,@ActivityVersion,'2026-11-07','09:00','10:00',N'synthetic evidence',N'approved fixture'; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53802 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 THROW 53890,'Out-of-range timing was accepted.',1;
DELETE @Reply;
INSERT @Reply EXEC paws_api.ResolveCalendarActivityDayTime N'calendar-command-admin',@Activity,@ActivityVersion,'2026-11-05','09:00','10:00',N'synthetic evidence',N'private approved fixture';
IF JSON_VALUE((SELECT responseJson FROM @Reply),'$.timeStatus')<>N'partial' OR (SELECT responseJson FROM @Reply) LIKE N'%private approved fixture%'
 OR NOT EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ActivityId=@Activity AND CONVERT(varchar(16),CONVERT(binary(8),ActivityVersion),2)<>@ActivityVersion)
 THROW 53890,'Timing did not update exactly one date with a sanitized response and new token.',1;
SET @Rejected=0;
BEGIN TRY EXEC paws_api.ResolveCalendarActivityDayTime N'calendar-command-admin',@Activity,@ActivityVersion,'2026-11-06','09:00','10:00',N'synthetic evidence',N'approved fixture'; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53804 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 THROW 53890,'Stale timing token was accepted.',1;
DELETE @Recovery;
INSERT @Recovery EXEC paws_api.ExportCalendarActivityRecovery N'calendar-command-admin',@Receipt;
SELECT @RecoveryHash=recoverySha256 FROM @Recovery;SET @Rejected=0;
BEGIN TRY EXEC paws_api.RecoverCalendarActivityImport N'calendar-command-admin',@Receipt,@RecoveryHash,1; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53804 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 OR EXISTS(SELECT 1 FROM paws.AfcRecord WHERE AfcRecordId=@Afc) OR NOT EXISTS(SELECT 1 FROM paws.CalendarActivityDayTime WHERE ActivityId=@Activity)
 THROW 53890,'Recovery overwrote verified newer timing.',1;
-- A new registered alias changes a previously provenance-only identity and must be rejected.
EXEC dbo.CalendarActivityTestPrepare @Row=50,@Faculty=@Faculty OUTPUT,@Afc=@Afc OUTPUT,@Batch=@Batch OUTPUT,@Version=@Version OUTPUT,@Manifest=@Manifest OUTPUT;
DECLARE @OldName nvarchar(256)=(SELECT DisplayName FROM paws.Faculty WHERE FacultyId=@Faculty),@NewFaculty uniqueidentifier=NEWID();
UPDATE paws.Faculty SET DisplayName=CONCAT(DisplayName,N' renamed') WHERE FacultyId=@Faculty;
DELETE @Reply;
INSERT @Reply EXEC paws_api.PreviewCalendarActivityImport N'calendar-command-admin',@Batch,@Version;
SELECT @Version=JSON_VALUE(responseJson,'$.previewVersion'),@Manifest=JSON_VALUE(responseJson,'$.manifestSha256') FROM @Reply;
IF NOT EXISTS(SELECT 1 FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@Batch AND ResolutionMethod=3 AND Status=N'accepted') THROW 53890,'Provenance fixture did not resolve.',1;
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId)
 SELECT @NewFaculty,RecordType,CONCAT(DisplayName,N' other'),1,SourceImportBatchId FROM paws.Faculty WHERE FacultyId=@Faculty;
INSERT paws.FacultyAlias(FacultyAliasId,FacultyId,AliasName,TargetPreferredSourceName,TargetDisplayName,Active,SourceImportBatchId)
 SELECT NEWID(),@NewFaculty,@OldName,@OldName,DisplayName,1,SourceImportBatchId FROM paws.Faculty WHERE FacultyId=@NewFaculty;
SET @Key=NEWID();SET @Rejected=0;
BEGIN TRY EXEC paws_api.CommitCalendarActivityImport N'calendar-command-admin',@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53804 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 OR NOT EXISTS(SELECT 1 FROM paws.AfcRecord WHERE AfcRecordId=@Afc) THROW 53890,'New alias evidence was not rechecked.',1;
EXEC dbo.CalendarActivityTestPrepare @Row=51,@Faculty=@Faculty OUTPUT,@Afc=@Afc OUTPUT,@Batch=@Batch OUTPUT,@Version=@Version OUTPUT,@Manifest=@Manifest OUTPUT;
CREATE TABLE dbo.CalendarActivityTestProtectedAfc(AfcRecordId uniqueidentifier NOT NULL REFERENCES paws.AfcRecord(AfcRecordId));
INSERT dbo.CalendarActivityTestProtectedAfc VALUES(@Afc);
SET @Key=NEWID();SET @Rejected=0;
BEGIN TRY EXEC paws_api.CommitCalendarActivityImport N'calendar-command-admin',@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1; END TRY
BEGIN CATCH IF ERROR_NUMBER()=53808 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 OR NOT EXISTS(SELECT 1 FROM paws.AfcRecord WHERE AfcRecordId=@Afc) THROW 53890,'Protected AFC reference was deleted.',1;
DROP TABLE dbo.CalendarActivityTestProtectedAfc;
DECLARE @ProtectedAfter TABLE(objectName sysname,fingerprint binary(32));
INSERT @ProtectedAfter EXEC dbo.CalendarActivityTestProtected;
IF EXISTS(SELECT * FROM @ProtectedBefore EXCEPT SELECT * FROM @ProtectedAfter) OR EXISTS(SELECT * FROM @ProtectedAfter EXCEPT SELECT * FROM @ProtectedBefore)
 THROW 53890,'Unrelated Session, DOE or Published data changed.',1;
PRINT 'CALENDAR_ACTIVITY_ATOMIC_ACCEPTANCE_OK';
PRINT 'CALENDAR_ACTIVITY_RECOVERY_ACCEPTANCE_OK';
DROP PROCEDURE dbo.CalendarActivityTestPrepare;
DROP PROCEDURE dbo.CalendarActivityTestProtected;
