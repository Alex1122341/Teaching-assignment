/* Synthetic labeled-container acceptance ONLY. Never execute on University SQL. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
DECLARE @Source char(64)=REPLICATE('C',64),@DuplicateSource char(64)=REPLICATE('D',64);
IF USER_ID(N'paws-calendar-test-runtime') IS NULL THROW 54990,'Disposable test principal required.',1;
DECLARE @Seed uniqueidentifier=NEWID(),@Sheet uniqueidentifier=NEWID(),@Workbook uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID(),@Other uniqueidentifier=NEWID(),@Course uniqueidentifier=NEWID();
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Seed,SYSUTCDATETIME(),N'completed',REPLICATE('B',64),N'ccc-test',N'{}');
INSERT staging.ImportWorkbook(ImportWorkbookId,ImportBatchId,FileName,FileSha256,FileByteLength) VALUES(@Workbook,@Seed,N'synthetic.xlsx',REPLICATE('B',64),100);
INSERT staging.ImportSheet(ImportSheetId,ImportWorkbookId,SheetName,SheetIndex,MaxRow,MaxColumn,NonEmptyRowCount) VALUES(@Sheet,@Workbook,N'Seed',1,10,6,9);
INSERT staging.ImportRow(ImportRowId,ImportSheetId,SourceRowNumber,RawJson,ValidationStatus,ValidationErrorsJson) SELECT NEWID(),@Sheet,n,N'{}',N'accepted',N'[]' FROM(VALUES(2),(3),(4),(5),(6),(7),(8),(9),(10)) numbers(n);
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',N'CCC Synthetic Faculty',1,@Seed),(@Other,N'faculty',N'CCC Other Faculty',1,@Seed);
INSERT paws.SwapCandidate(CandidateKey,FacultyId) VALUES(NEWID(),@Faculty),(NEWID(),@Other);
INSERT paws.Course(CourseId,CourseCode,SourceImportBatchId) VALUES(@Course,N'CCC-TEST',@Seed);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword) VALUES(N'ccc-test-admin',N'ccc-admin@example.test',N'Synthetic admin',N'owner',NULL,1,0),(N'ccc-test-faculty',N'ccc-fac@example.test',N'Synthetic faculty',N'faculty',@Faculty,1,0);
CREATE TABLE dbo.CccTestContext(Seed uniqueidentifier,SheetId uniqueidentifier,FacultyId uniqueidentifier,BatchId uniqueidentifier,OldId uniqueidentifier,KeyId uniqueidentifier,PreviewVersion varchar(16) NULL,Manifest varchar(64) NULL,ReceiptId uniqueidentifier NULL);
INSERT dbo.CccTestContext VALUES(@Seed,@Sheet,@Faculty,NEWID(),NEWID(),NEWID(),NULL,NULL,NULL);
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,CourseId,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid)
 SELECT CASE WHEN n=2 THEN(SELECT OldId FROM dbo.CccTestContext) ELSE NEWID() END,@Faculty,CASE WHEN n=3 THEN N'clinical_day' ELSE N'ccc' END,N'Synthetic old',CASE WHEN n=4 THEN '2027-08-01' ELSE '2026-10-01' END,CASE WHEN n=4 THEN '2027-08-01' ELSE '2026-10-01' END,@Course,@Seed,r.ImportRowId,REPLICATE('B',64),N'Seed',n,N'synthetic'
 FROM(VALUES(2),(3),(4)) nums(n) JOIN staging.ImportRow r ON r.ImportSheetId=@Sheet AND r.SourceRowNumber=n;
CREATE TABLE #protected(Name sysname PRIMARY KEY,Hash binary(32));
DECLARE @Name sysname,@Sql nvarchar(max),@Json nvarchar(max);
DECLARE tables CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID(N'paws') AND name NOT IN(N'CalendarActivity',N'CccReplacementReceipt',N'AuditEvent',N'ChangeHistoryContext',N'UserProfile',N'Faculty');
OPEN tables;FETCH NEXT FROM tables INTO @Name;
WHILE @@FETCH_STATUS=0 BEGIN SET @Sql=N'SELECT @j=(SELECT * FROM paws.'+QUOTENAME(@Name)+N' FOR JSON PATH,INCLUDE_NULL_VALUES)';EXEC sys.sp_executesql @Sql,N'@j nvarchar(max) OUTPUT',@Json OUTPUT;INSERT #protected VALUES(@Name,HASHBYTES('SHA2_256',CONVERT(varbinary(max),@Json)));FETCH NEXT FROM tables INTO @Name;END;CLOSE tables;DEALLOCATE tables;
DECLARE @Batch uniqueidentifier=(SELECT BatchId FROM dbo.CccTestContext),@Rows nvarchar(max)=(SELECT 2 sourceRow,CONVERT(varchar(36),@Faculty) facultySourceId,N'CCC Synthetic Faculty' facultySourceName,N'2026-11-02' startDate,N'2026-11-04' endDate,N'CCC-TEST' courseCode,N'CCC' label,JSON_QUERY(N'[]') issues FOR JSON PATH),@Response nvarchar(max),@Version varchar(16),@Manifest varchar(64),@Key uniqueidentifier=(SELECT KeyId FROM dbo.CccTestContext);
DECLARE @Result TABLE(responseJson nvarchar(max));
ALTER ROLE paws_runtime_ccc_stage ADD MEMBER [paws-calendar-test-runtime];ALTER ROLE paws_runtime_ccc_commit ADD MEMBER [paws-calendar-test-runtime];
EXECUTE AS USER=N'paws-calendar-test-runtime';
INSERT @Result EXEC paws_api.StageCccReplacement N'ccc-test-admin',@Batch,@Source,'2026-27',N'CCC.xlsx',200,@Rows;
REVERT;
SET @Response=(SELECT TOP(1) responseJson FROM @Result);SET @Version=JSON_VALUE(@Response,'$.previewVersion');DELETE @Result;
IF (SELECT COUNT(*) FROM paws.CalendarActivity)<>3 THROW 54990,'Stage changed Calendar.',1;
INSERT @Result EXEC paws_api.PreviewCccReplacement N'ccc-test-admin',@Batch,@Version;
SET @Response=(SELECT TOP(1) responseJson FROM @Result);SET @Version=JSON_VALUE(@Response,'$.previewVersion');SET @Manifest=JSON_VALUE(@Response,'$.manifestSha256');DELETE @Result;
IF JSON_QUERY(@Response,'$.preview.issues')<>N'[]' OR JSON_QUERY(@Response,'$.preview.rows[0].issues')<>N'[]' OR (SELECT COUNT(*) FROM OPENJSON(@Response,'$.preview.targets'))<>1 THROW 54990,'Preview did not resolve exact CCC scope.',1;
BEGIN TRY EXEC paws_api.CommitCccReplacement N'ccc-test-faculty',@Batch,'2026-27',N'ccc-calendar',@Version,@Manifest,@Source,@Key,1,1;THROW 54990,'Faculty committed CCC.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54901 THROW;END CATCH;
UPDATE paws.UserProfile SET Active=0 WHERE FirebaseUid=N'ccc-test-admin';
BEGIN TRY EXEC paws_api.CommitCccReplacement N'ccc-test-admin',@Batch,'2026-27',N'ccc-calendar',@Version,@Manifest,@Source,@Key,1,1;THROW 54990,'Revoked actor committed.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54901 THROW;END CATCH;
UPDATE paws.UserProfile SET Active=1 WHERE FirebaseUid=N'ccc-test-admin';
-- A newly inserted target not in the preview must invalidate the entire set.
INSERT paws.CalendarActivity(ActivityId,FacultyId,Category,OriginalLabel,StartDate,EndDate,ImportBatchId,ImportRowId,SourceSha256,SourceSheet,SourceRow,CreatedByUid)
 SELECT NEWID(),@Other,N'ccc',N'Phantom','2026-10-03','2026-10-03',@Seed,ImportRowId,REPLICATE('B',64),N'Seed',5,N'synthetic' FROM staging.ImportRow WHERE ImportSheetId=@Sheet AND SourceRowNumber=5;
BEGIN TRY EXEC paws_api.CommitCccReplacement N'ccc-test-admin',@Batch,'2026-27',N'ccc-calendar',@Version,@Manifest,@Source,@Key,1,1;THROW 54990,'Phantom target accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54904 THROW;END CATCH;
DELETE paws.CalendarActivity WHERE OriginalLabel=N'Phantom';
UPDATE staging.CccReplacement SET ExpiresAtUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE ImportBatchId=@Batch;SELECT @Version=CONVERT(varchar(16),CONVERT(binary(8),PreviewVersion),2) FROM staging.CccReplacement WHERE ImportBatchId=@Batch;
BEGIN TRY EXEC paws_api.CommitCccReplacement N'ccc-test-admin',@Batch,'2026-27',N'ccc-calendar',@Version,@Manifest,@Source,@Key,1,1;THROW 54990,'Expired preview accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54905 THROW;END CATCH;
INSERT @Result EXEC paws_api.PreviewCccReplacement N'ccc-test-admin',@Batch,@Version;SET @Response=(SELECT TOP(1) responseJson FROM @Result);SET @Version=JSON_VALUE(@Response,'$.previewVersion');SET @Manifest=JSON_VALUE(@Response,'$.manifestSha256');DELETE @Result;
UPDATE dbo.CccTestContext SET PreviewVersion=@Version,Manifest=@Manifest;
PRINT 'CCC_STAGE_SCOPE_ROLE_EXPIRY_OK';
GO
CREATE TRIGGER paws.CccTestAuditFailure ON paws.AuditEvent AFTER INSERT AS
BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE EventType=N'ccc_activity_added') THROW 54991,'Synthetic audit failure.',1;END;
GO
DECLARE @Source char(64)=REPLICATE('C',64),@DuplicateSource char(64)=REPLICATE('D',64);
DECLARE @Batch uniqueidentifier,@Key uniqueidentifier,@Version varchar(16),@Manifest varchar(64),@Old uniqueidentifier;
SELECT @Batch=BatchId,@Key=KeyId,@Version=PreviewVersion,@Manifest=Manifest,@Old=OldId FROM dbo.CccTestContext;
BEGIN TRY EXEC paws_api.CommitCccReplacement N'ccc-test-admin',@Batch,'2026-27',N'ccc-calendar',@Version,@Manifest,@Source,@Key,1,1;THROW 54990,'Audit failure accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54991 THROW;END CATCH;
IF NOT EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ActivityId=@Old) OR EXISTS(SELECT 1 FROM paws.CccReplacementReceipt) OR EXISTS(SELECT 1 FROM paws.AuditEvent WHERE EventType=N'ccc_activity_removed') THROW 54990,'Audit failure did not roll back.',1;
DROP TRIGGER paws.CccTestAuditFailure;
PRINT 'CCC_ATOMIC_AUDIT_FAILURE_OK';
GO
DECLARE @Source char(64)=REPLICATE('C',64),@DuplicateSource char(64)=REPLICATE('D',64);
DECLARE @Batch uniqueidentifier,@Key uniqueidentifier,@Version varchar(16),@Manifest varchar(64),@Old uniqueidentifier,@Faculty uniqueidentifier,@Rows nvarchar(max),@Response nvarchar(max),@Receipt uniqueidentifier;
SELECT @Batch=BatchId,@Key=KeyId,@Version=PreviewVersion,@Manifest=Manifest,@Old=OldId,@Faculty=FacultyId FROM dbo.CccTestContext;
DECLARE @Result TABLE(responseJson nvarchar(max));
-- Existing verified times block replacement instead of silently deleting evidence.
INSERT paws.CalendarActivityDayTime(ActivityId,ActivityDate,StartTime,EndTime,EvidenceRef,EvidenceNote,ActorUid) VALUES(@Old,'2026-10-01','09:00','10:00',N'synthetic',N'synthetic',N'ccc-test-admin');
INSERT @Result EXEC paws_api.PreviewCccReplacement N'ccc-test-admin',@Batch,@Version;SET @Response=(SELECT TOP(1) responseJson FROM @Result);SET @Version=JSON_VALUE(@Response,'$.previewVersion');SET @Manifest=JSON_VALUE(@Response,'$.manifestSha256');DELETE @Result;
IF JSON_QUERY(@Response,'$.preview.issues') NOT LIKE N'%TARGET_HAS_TIME_EVIDENCE%' THROW 54990,'Time evidence omitted.',1;
BEGIN TRY EXEC paws_api.CommitCccReplacement N'ccc-test-admin',@Batch,'2026-27',N'ccc-calendar',@Version,@Manifest,@Source,@Key,1,1;THROW 54990,'Timed target deleted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54908 THROW;END CATCH;
DELETE paws.CalendarActivityDayTime WHERE ActivityId=@Old;
UPDATE paws.CalendarActivity SET StartDate='2026-04-30' WHERE ActivityId=@Old;
INSERT @Result EXEC paws_api.PreviewCccReplacement N'ccc-test-admin',@Batch,@Version;SET @Response=(SELECT TOP(1) responseJson FROM @Result);SET @Version=JSON_VALUE(@Response,'$.previewVersion');SET @Manifest=JSON_VALUE(@Response,'$.manifestSha256');DELETE @Result;
IF JSON_QUERY(@Response,'$.preview.issues') NOT LIKE N'%CROSS_YEAR_TARGET%' THROW 54990,'Cross-year range clipped.',1;
BEGIN TRY EXEC paws_api.CommitCccReplacement N'ccc-test-admin',@Batch,'2026-27',N'ccc-calendar',@Version,@Manifest,@Source,@Key,1,1;THROW 54990,'Cross-year target deleted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54908 THROW;END CATCH;
UPDATE paws.CalendarActivity SET StartDate='2026-10-01' WHERE ActivityId=@Old;
-- Both name and ID resolving to the same person must count as a duplicate.
DECLARE @DuplicateBatch uniqueidentifier=NEWID(),@DuplicateKey uniqueidentifier=NEWID(),@DupVersion varchar(16),@DupManifest varchar(64);
SET @Rows=(SELECT * FROM(SELECT 2 sourceRow,CONVERT(varchar(36),@Faculty) facultySourceId,CAST(NULL AS nvarchar(256)) facultySourceName,N'2026-11-02' startDate,N'2026-11-04' endDate,N'CCC-TEST' courseCode,N'CCC' label,JSON_QUERY(N'[]') issues UNION ALL SELECT 3,NULL,N'CCC Synthetic Faculty',N'2026-11-02',N'2026-11-04',N'CCC-TEST',N'CCC',JSON_QUERY(N'[]')) sourceRows FOR JSON PATH,INCLUDE_NULL_VALUES);
INSERT @Result EXEC paws_api.StageCccReplacement N'ccc-test-admin',@DuplicateBatch,@DuplicateSource,'2026-27',N'Duplicate.xlsx',200,@Rows;SET @DupVersion=JSON_VALUE((SELECT TOP(1) responseJson FROM @Result),'$.previewVersion');DELETE @Result;
INSERT @Result EXEC paws_api.PreviewCccReplacement N'ccc-test-admin',@DuplicateBatch,@DupVersion;SET @Response=(SELECT TOP(1) responseJson FROM @Result);SET @DupVersion=JSON_VALUE(@Response,'$.previewVersion');SET @DupManifest=JSON_VALUE(@Response,'$.manifestSha256');DELETE @Result;
IF JSON_QUERY(@Response,'$.preview.rows[0].issues') NOT LIKE N'%DUPLICATE_RESOLVED_ROW%' THROW 54990,'Resolved aliases escaped duplicate detection.',1;
BEGIN TRY EXEC paws_api.CommitCccReplacement N'ccc-test-admin',@DuplicateBatch,'2026-27',N'ccc-calendar',@DupVersion,@DupManifest,@DuplicateSource,@DuplicateKey,1,1;THROW 54990,'Duplicate source committed.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54906 THROW;END CATCH;
INSERT @Result EXEC paws_api.PreviewCccReplacement N'ccc-test-admin',@Batch,@Version;SET @Response=(SELECT TOP(1) responseJson FROM @Result);SET @Version=JSON_VALUE(@Response,'$.previewVersion');SET @Manifest=JSON_VALUE(@Response,'$.manifestSha256');DELETE @Result;
EXECUTE AS USER=N'paws-calendar-test-runtime';
INSERT @Result EXEC paws_api.CommitCccReplacement N'ccc-test-admin',@Batch,'2026-27',N'ccc-calendar',@Version,@Manifest,@Source,@Key,1,1;
REVERT;
SET @Response=(SELECT TOP(1) responseJson FROM @Result);SET @Receipt=CONVERT(uniqueidentifier,JSON_VALUE(@Response,'$.receiptId'));DELETE @Result;
IF JSON_VALUE(@Response,'$.deletedCount')<>N'1' OR JSON_VALUE(@Response,'$.insertedCount')<>N'1' OR @Response LIKE N'%BeforeRowsJson%' OR EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ActivityId=@Old) OR (SELECT COUNT(*) FROM paws.CalendarActivity)<>3 THROW 54990,'Whole replacement scope/counts invalid.',1;
IF NOT EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ImportBatchId=@Batch AND StartDate='2026-11-02' AND EndDate='2026-11-04') THROW 54990,'Date range was changed.',1;
INSERT @Result EXEC paws_api.CommitCccReplacement N'ccc-test-admin',@Batch,'2026-27',N'ccc-calendar',@Version,@Manifest,@Source,@Key,1,1;
IF JSON_VALUE((SELECT TOP(1) responseJson FROM @Result),'$.idempotentReplay')<>N'true' OR (SELECT COUNT(*) FROM paws.CccReplacementReceipt)<>1 THROW 54990,'Replay duplicated replacement.',1;DELETE @Result;
BEGIN TRY EXEC paws_api.CommitCccReplacement N'ccc-test-admin',@Batch,'2025-26',N'ccc-calendar',@Version,@Manifest,@Source,@Key,1,1;THROW 54990,'Mismatched replay accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54907 THROW;END CATCH;
UPDATE dbo.CccTestContext SET ReceiptId=@Receipt;
-- The runtime can execute only its role's procedures, never read recovery data.
EXECUTE AS USER=N'paws-calendar-test-runtime';
BEGIN TRY SELECT * FROM paws.CccReplacementReceipt;REVERT;THROW 54990,'Runtime read private recovery.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>229 BEGIN REVERT;THROW;END;END CATCH;
BEGIN TRY EXEC paws_api.RecoverCccReplacement N'ccc-test-admin',@Receipt,1;REVERT;THROW 54990,'Runtime recovered CCC.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>229 BEGIN REVERT;THROW;END;END CATCH;REVERT;
-- A changed new row prevents recovery; rollback the synthetic change afterward.
BEGIN TRY BEGIN TRANSACTION;UPDATE paws.CalendarActivity SET OriginalLabel=N'Changed after commit' WHERE ImportBatchId=@Batch;EXEC paws_api.RecoverCccReplacement N'ccc-test-admin',@Receipt,1;THROW 54990,'Changed rows recovered.',1;END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>54908 THROW;END CATCH;
EXEC paws_api.RecoverCccReplacement N'ccc-test-admin',@Receipt,1;
IF NOT EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ActivityId=@Old AND OriginalLabel=N'Synthetic old') OR EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ImportBatchId=@Batch) THROW 54990,'Private guarded recovery failed.',1;
DECLARE @Name sysname,@Sql nvarchar(max),@Json nvarchar(max),@Expected binary(32);
DECLARE tables CURSOR LOCAL FAST_FORWARD FOR SELECT Name,Hash FROM #protected;OPEN tables;FETCH NEXT FROM tables INTO @Name,@Expected;
WHILE @@FETCH_STATUS=0 BEGIN SET @Sql=N'SELECT @j=(SELECT * FROM paws.'+QUOTENAME(@Name)+N' FOR JSON PATH,INCLUDE_NULL_VALUES)';EXEC sys.sp_executesql @Sql,N'@j nvarchar(max) OUTPUT',@Json OUTPUT;IF HASHBYTES('SHA2_256',CONVERT(varbinary(max),@Json))<>@Expected THROW 54990,'Unrelated business table changed.',1;FETCH NEXT FROM tables INTO @Name,@Expected;END;CLOSE tables;DEALLOCATE tables;
ALTER ROLE paws_runtime_ccc_stage DROP MEMBER [paws-calendar-test-runtime];ALTER ROLE paws_runtime_ccc_commit DROP MEMBER [paws-calendar-test-runtime];
PRINT 'CCC_FULL_REPLACEMENT_RECOVERY_PROTECTED_HASHES_OK';
