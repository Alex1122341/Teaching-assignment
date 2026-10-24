:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 54690,'Wrong synthetic database.',1;
IF OBJECT_DEFINITION(OBJECT_ID(N'paws_api.CommitCalendarActivityImport')) NOT LIKE N'%DECLARE @IdentityNames TABLE%'
 THROW 54690,'COMMIT_IDENTITY_RECHECK_MUST_MATERIALIZE_NAMES',1;
GO
CREATE PROCEDURE dbo.CalendarCommitScaleProtected @Batch uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Name sysname,@Sql nvarchar(max),@Hash binary(32),@Count bigint;
 DECLARE @State TABLE(objectName sysname,fingerprint binary(32),rowTotal bigint);
 DECLARE protectedTables CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID(N'paws') AND
 (name IN(N'Session',N'SessionAssignment',N'AfcRecord',N'AfcManualRecord') OR name LIKE N'Doe%' OR name LIKE N'TeachingAssignmentPublished%') ORDER BY name;
 OPEN protectedTables;FETCH NEXT FROM protectedTables INTO @Name;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Sql=N'SELECT @Count=COUNT_BIG(*),@Result=HASHBYTES(''SHA2_256'',COALESCE(STRING_AGG(CONVERT(nvarchar(max),RowHash),N''|'') WITHIN GROUP(ORDER BY RowHash),N'''')) FROM '
  +N'(SELECT CONVERT(varchar(64),HASHBYTES(''SHA2_256'',(SELECT t.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)),2) RowHash FROM paws.'+QUOTENAME(@Name)+N' t'
  +CASE WHEN @Name=N'AfcRecord' THEN N' WHERE NOT EXISTS(SELECT 1 FROM staging.CalendarActivityImportItem item WHERE item.ImportBatchId=@Batch AND item.Status=N''accepted'' AND item.AfcRecordId=t.AfcRecordId)' ELSE N'' END+N') hashes;';
  EXEC sys.sp_executesql @Sql,N'@Batch uniqueidentifier,@Count bigint OUTPUT,@Result binary(32) OUTPUT',@Batch=@Batch,@Count=@Count OUTPUT,@Result=@Hash OUTPUT;
  INSERT @State VALUES(@Name,@Hash,@Count);FETCH NEXT FROM protectedTables INTO @Name;
 END;
 CLOSE protectedTables;DEALLOCATE protectedTables;
 SELECT objectName,fingerprint,rowTotal FROM @State ORDER BY objectName;
END;
GO
DECLARE @Actor nvarchar(128)=N'commit-scale-synthetic-admin',@Source uniqueidentifier=NEWID(),@Batch uniqueidentifier=NEWID(),@Key uniqueidentifier=NEWID();
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,Active,MustChangePassword) VALUES(@Actor,N'commit-scale@example.test',N'Commit Scale Synthetic',N'owner',1,0);
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson)
 VALUES(@Source,SYSUTCDATETIME(),N'synthetic',REPLICATE('B',64),N'commit-scale',N'{}');
DECLARE @Faculty TABLE(N int PRIMARY KEY,Id uniqueidentifier,Name nvarchar(256));
DECLARE @N int=1;
WHILE @N<=47
BEGIN
 DECLARE @Id uniqueidentifier=NEWID();INSERT @Faculty VALUES(@N,@Id,CONCAT(N'Commit Scale ',CONVERT(char(36),@Id)));SET @N+=1;
END;
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) SELECT Id,N'faculty',Name,1,@Source FROM @Faculty;
INSERT paws.SwapCandidate(FacultyId) SELECT Id FROM @Faculty;
DECLARE @Rows TABLE(N int PRIMARY KEY,Afc uniqueidentifier,FacultyId uniqueidentifier,Name nvarchar(256),Day date);
SET @N=1;
WHILE @N<=540
BEGIN
 INSERT @Rows SELECT @N,NEWID(),Id,Name,DATEADD(day,@N-1,CONVERT(date,'20260101')) FROM @Faculty WHERE N=1+((@N-1)%47);SET @N+=1;
END;
INSERT staging.AfcRecordRaw(ImportBatchId,ImportRowId,SourceRowNumber,FacultySourceName,StartDate,EndDate,Purpose,RawJson,ValidationStatus,ValidationErrorsJson)
 SELECT @Source,NEWID(),2000+N,Name,Day,Day,N'CCC Day',N'{}',N'valid',N'[]' FROM @Rows;
INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow)
 SELECT Afc,FacultyId,Day,Day,N'CCC Day',1,@Source,2000+N FROM @Rows;
DECLARE @Json nvarchar(max)=(SELECT 2000+N sourceRow,Name facultySourceName,CONVERT(char(10),Day,23) startDate,CONVERT(char(10),Day,23) endDate,
 N'CCC Day' originalLabel,N'working_candidate' treatment,JSON_QUERY(N'[]') issues FROM @Rows ORDER BY N FOR JSON PATH);
DECLARE @Response TABLE(responseJson nvarchar(max));
INSERT @Response EXEC paws_api.StageCalendarActivityImport @Actor,@Batch,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Json;
DECLARE @Version varchar(16)=(SELECT JSON_VALUE(responseJson,'$.previewVersion') FROM @Response),@Manifest char(64)=(SELECT JSON_VALUE(responseJson,'$.manifestSha256') FROM @Response);
IF (SELECT JSON_VALUE(responseJson,'$.counts.accepted') FROM @Response)<>N'540' THROW 54690,'Scale preview requires all540 exact targets.',1;
DECLARE @Changed uniqueidentifier=(SELECT Id FROM @Faculty WHERE N=1),@Rejected bit=0;
UPDATE paws.Faculty SET Active=0 WHERE FacultyId=@Changed;
BEGIN TRY EXEC paws_api.CommitCalendarActivityImport @Actor,@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;END TRY
BEGIN CATCH IF ERROR_NUMBER()=53804 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 OR EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ImportBatchId=@Batch) OR (SELECT COUNT(*) FROM paws.AfcRecord a JOIN @Rows r ON r.Afc=a.AfcRecordId)<>540
 THROW 54690,'Materialized evidence did not reject an inactive identity before business writes.',1;
UPDATE paws.Faculty SET Active=1 WHERE FacultyId=@Changed;
DELETE @Response;INSERT @Response EXEC paws_api.PreviewCalendarActivityImport @Actor,@Batch,@Version;
SELECT @Version=JSON_VALUE(responseJson,'$.previewVersion'),@Manifest=JSON_VALUE(responseJson,'$.manifestSha256') FROM @Response;
DECLARE @Before TABLE(objectName sysname,fingerprint binary(32),rowTotal bigint);
DECLARE @After TABLE(objectName sysname,fingerprint binary(32),rowTotal bigint);
INSERT @Before EXEC dbo.CalendarCommitScaleProtected @Batch;
DECLARE @Started datetime2=SYSUTCDATETIME();
DELETE @Response;INSERT @Response EXEC paws_api.CommitCalendarActivityImport @Actor,@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;
DECLARE @Elapsed int=DATEDIFF(millisecond,@Started,SYSUTCDATETIME()),@Receipt uniqueidentifier=(SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(responseJson,'$.receiptId')) FROM @Response);
IF @Receipt IS NULL OR @Elapsed>60000 OR (SELECT InsertedCount FROM paws.CalendarActivityImportReceipt WHERE ReceiptId=@Receipt)<>540
 OR (SELECT DeletedAfcCount FROM paws.CalendarActivityImportReceipt WHERE ReceiptId=@Receipt)<>540 OR (SELECT COUNT(*) FROM paws.CalendarActivity WHERE ImportBatchId=@Batch)<>540
 OR EXISTS(SELECT 1 FROM paws.AfcRecord a JOIN @Rows r ON r.Afc=a.AfcRecordId) OR (SELECT COUNT(*) FROM paws.CalendarActivityRecoveryRow WHERE ReceiptId=@Receipt)<>540
 THROW 54690,'540-record atomic command/recovery/bounded execution failed.',1;
INSERT @After EXEC dbo.CalendarCommitScaleProtected @Batch;
IF EXISTS(SELECT * FROM @Before EXCEPT SELECT * FROM @After) OR EXISTS(SELECT * FROM @After EXCEPT SELECT * FROM @Before)
 THROW 54690,'Scale commit changed unrelated AFC/teaching/DOE/Published.',1;
DECLARE @Recovery TABLE(recoveryJson nvarchar(max),recoverySha256 char(64));
INSERT @Recovery EXEC paws_api.ExportCalendarActivityRecovery @Actor,@Receipt;
IF (SELECT COUNT(*) FROM @Recovery)<>1 OR NOT EXISTS(SELECT 1 FROM @Recovery WHERE recoverySha256=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),recoveryJson)),2))
 THROW 54690,'Scale recovery hash is not receipt-bound UTF16LE.',1;
DELETE @Response;INSERT @Response EXEC paws_api.CommitCalendarActivityImport @Actor,@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;
IF JSON_VALUE((SELECT responseJson FROM @Response),'$.idempotentReplay')<>N'true' OR (SELECT COUNT(*) FROM paws.CalendarActivityImportReceipt WHERE ImportBatchId=@Batch)<>1
 THROW 54690,'Scale replay created a second durable outcome.',1;
PRINT CONCAT('CALENDAR_COMMIT_540_SCALE_OK elapsedMs=',@Elapsed);
PRINT 'CALENDAR_COMMIT_MATERIALIZED_IDENTITY_GUARDS_OK';
DROP PROCEDURE dbo.CalendarCommitScaleProtected;
