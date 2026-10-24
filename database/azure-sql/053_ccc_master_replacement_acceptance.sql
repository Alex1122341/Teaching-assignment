/* Synthetic labeled-container acceptance ONLY; no University data. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF USER_ID(N'paws-calendar-test-runtime') IS NULL OR OBJECT_ID(N'dbo.CccSlotContext') IS NULL THROW 55390,'Disposable fixture required.',1;
DECLARE @HistoricalBatch uniqueidentifier=(SELECT Seed FROM dbo.CccSlotContext);
INSERT staging.CalendarActivityImport(ImportBatchId,SourceSha256,Dataset,PolicyVersion,Status,SourceRowCount,ActorFirebaseUid) VALUES(@HistoricalBatch,REPLICATE('B',64),N'afc-working-activities',N'synthetic-historical',N'committed',540,N'synthetic');
INSERT paws.CalendarActivityImportReceipt(ReceiptId,ImportBatchId,Dataset,SourceSha256,ManifestSha256,IdempotencyKey,InsertedCount,DeletedAfcCount,ActorUid) VALUES(NEWID(),@HistoricalBatch,N'afc-working-activities',REPLICATE('B',64),REPLICATE('F',64),NEWID(),540,540,N'synthetic');
CREATE TABLE dbo.CccHistoricalReceipt(Hash binary(32));
INSERT dbo.CccHistoricalReceipt SELECT HASHBYTES('SHA2_256',(SELECT * FROM paws.CalendarActivityImportReceipt ORDER BY ReceiptId FOR JSON PATH,INCLUDE_NULL_VALUES));
CREATE TABLE dbo.CccMasterContext(BatchId uniqueidentifier,RequestKey uniqueidentifier,PayloadJson nvarchar(max),PreviewJson nvarchar(max),ReceiptId uniqueidentifier NULL);
DECLARE @Faculty uniqueidentifier=(SELECT Faculty FROM dbo.CccSlotContext),@Rows nvarchar(max),@Payload nvarchar(max);
SET @Rows=(SELECT n sourceRow,CASE WHEN col<>N'D' THEN @Faculty END facultySourceId,CAST(NULL AS nvarchar(256)) facultySourceName,N'2026-11-02' startDate,N'2026-11-02' endDate,CAST(NULL AS nvarchar(64)) courseCode,N'CCC' label,
 CASE WHEN col=N'D' THEN N'unassigned' ELSE N'assigned' END staffingKind,CASE WHEN col=N'D' THEN N'Locum' END staffingLabel,N'Example Block' blockLabel,CONCAT(N'CCC!',col,N'25') slotKey,
 JSON_QUERY((SELECT REPLICATE('C',64) sha256,N'CCC' sheet,25 row,col [column] FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) sourceRef,
 JSON_QUERY((SELECT CASE WHEN col=N'D' THEN N'Locum' ELSE N'Example Assigned' END sourceName,N'SECRET-MASTER-CCC' privateNotes FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) sourceEvidence,JSON_QUERY(N'[]') issues
 FROM(VALUES(2,N'C'),(3,N'D'),(4,N'E')) slots(n,col) ORDER BY n FOR JSON PATH,INCLUDE_NULL_VALUES);
SET @Payload=(SELECT 2 schemaVersion,'2026-27' academicYear,REPLICATE('C',64) sourceSha256,REPLICATE('D',64) sourceManifestSha256,REPLICATE('E',64) manifestSha256,JSON_QUERY(N'{"total":3,"assigned":2,"unassigned":1}') slotCounts,JSON_QUERY(@Rows) rows FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
INSERT dbo.CccMasterContext VALUES(NEWID(),NEWID(),@Payload,NULL,NULL);
GO
CREATE PROCEDURE dbo.StageCccMasterTest
AS
BEGIN
 DECLARE @Batch uniqueidentifier,@Payload nvarchar(max),@Version varchar(16);SELECT @Batch=BatchId,@Payload=PayloadJson FROM dbo.CccMasterContext;
 DECLARE @Result TABLE(responseJson nvarchar(max));
 INSERT @Result EXEC paws_api.StageMasterCccReplacement N'ccc-slots-admin',@Batch,N'Synthetic-MASTER.xlsx',1500000,@Payload;
 SELECT @Version=JSON_VALUE(responseJson,'$.previewVersion') FROM @Result;DELETE @Result;
 INSERT @Result EXEC paws_api.PreviewCccReplacement N'ccc-slots-admin',@Batch,@Version;
 UPDATE dbo.CccMasterContext SET PreviewJson=(SELECT responseJson FROM @Result);
END;
GO
CREATE PROCEDURE dbo.ApplyCccMasterTest @KeyOverride uniqueidentifier=NULL
AS
BEGIN
 DECLARE @Batch uniqueidentifier,@Key uniqueidentifier,@Preview nvarchar(max),@Version varchar(16),@Manifest varchar(64),@Source char(64)=REPLICATE('C',64);SELECT @Batch=BatchId,@Key=COALESCE(@KeyOverride,RequestKey),@Preview=PreviewJson FROM dbo.CccMasterContext;
 SELECT @Version=JSON_VALUE(@Preview,'$.previewVersion'),@Manifest=JSON_VALUE(@Preview,'$.manifestSha256');
 EXEC paws_api.CommitCccReplacement N'ccc-slots-admin',@Batch,'2026-27',N'ccc-calendar',@Version,@Manifest,@Source,@Key,1,1;
END;
GO
-- Runtime v1 stage rights cannot create trusted MASTER payloads.
DECLARE @Payload nvarchar(max)=(SELECT PayloadJson FROM dbo.CccMasterContext),@Batch uniqueidentifier=NEWID();
ALTER ROLE paws_runtime_ccc_stage ADD MEMBER [paws-calendar-test-runtime];
EXECUTE AS USER=N'paws-calendar-test-runtime';
BEGIN TRY EXEC paws_api.StageMasterCccReplacement N'ccc-slots-admin',@Batch,N'Synthetic.xlsx',1500000,@Payload;REVERT;THROW 55390,'Runtime bypassed trusted stage.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>229 BEGIN REVERT;THROW;END;END CATCH;REVERT;
DECLARE @Incomplete nvarchar(max)=JSON_MODIFY(@Payload,'$.rows',JSON_QUERY((SELECT value FROM OPENJSON(@Payload,'$.rows') WHERE JSON_VALUE(value,'$.staffingKind')=N'assigned' FOR JSON PATH)));
BEGIN TRY EXEC paws_api.StageMasterCccReplacement N'ccc-slots-admin',@Batch,N'Synthetic.xlsx',1500000,@Incomplete;THROW 55390,'Incomplete source accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54902 THROW;END CATCH;
EXEC dbo.StageCccMasterTest;
DECLARE @Preview nvarchar(max)=(SELECT PreviewJson FROM dbo.CccMasterContext);
IF JSON_QUERY(@Preview,'$.preview.issues')<>N'[]' OR (SELECT COUNT(*) FROM OPENJSON(@Preview,'$.preview.rows'))<>3 OR JSON_VALUE(@Preview,'$.preview.slotCounts.unassigned')<>N'1' OR @Preview LIKE N'%SECRET-MASTER-CCC%' THROW 55390,'Trusted preview lost completeness or exposed notes.',1;
IF EXISTS(SELECT 1 FROM OPENJSON(@Preview,'$.preview.rows') WHERE JSON_QUERY(value,'$.issues')<>N'[]') THROW 55390,'Distinct source slots were collapsed as duplicate faculty/dates.',1;
-- Later source edits cannot be legitimized simply by refreshing the preview.
BEGIN TRY
 BEGIN TRANSACTION;
 UPDATE staging.CccReplacement SET RowsJson=JSON_MODIFY(RowsJson,'$[1]',NULL) WHERE ImportBatchId=(SELECT BatchId FROM dbo.CccMasterContext);
 DECLARE @Version varchar(16)=(SELECT CONVERT(varchar(16),CONVERT(binary(8),PreviewVersion),2) FROM staging.CccReplacement WHERE ImportBatchId=(SELECT BatchId FROM dbo.CccMasterContext));
 DECLARE @CurrentBatch uniqueidentifier=(SELECT BatchId FROM dbo.CccMasterContext);
 DECLARE @Result TABLE(responseJson nvarchar(max));
 INSERT @Result EXEC paws_api.PreviewCccReplacement N'ccc-slots-admin',@CurrentBatch,@Version;
 UPDATE dbo.CccMasterContext SET PreviewJson=(SELECT responseJson FROM @Result);
 EXEC dbo.ApplyCccMasterTest;THROW 55390,'Edited complete source committed.',1;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER() NOT IN(54908,54906) THROW;END CATCH;
EXEC dbo.StageCccMasterTest;
GO
CREATE TRIGGER paws.MasterCccAuditFailure ON paws.AuditEvent AFTER INSERT AS
BEGIN
 IF EXISTS(SELECT 1 FROM inserted WHERE EventType=N'ccc_activity_added') THROW 55391,'Injected CCC history failure.',1;
END;
GO
BEGIN TRY EXEC dbo.ApplyCccMasterTest;THROW 55390,'CCC audit failure ignored.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>55391 THROW;END CATCH;
IF NOT EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ActivityId=(SELECT OldId FROM dbo.CccSlotContext)) OR EXISTS(SELECT 1 FROM paws.CccReplacementReceipt) OR EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE SourceSha256=REPLICATE('C',64)) THROW 55390,'Partial CCC replacement survived rollback.',1;
DROP TRIGGER paws.MasterCccAuditFailure;
EXEC dbo.StageCccMasterTest;
DECLARE @Result TABLE(responseJson nvarchar(max));INSERT @Result EXEC dbo.ApplyCccMasterTest;
UPDATE dbo.CccMasterContext SET ReceiptId=TRY_CONVERT(uniqueidentifier,JSON_VALUE((SELECT responseJson FROM @Result),'$.receiptId'));
IF JSON_VALUE((SELECT responseJson FROM @Result),'$.insertedCount')<>N'3' OR JSON_VALUE((SELECT responseJson FROM @Result),'$.deletedCount')<>N'1' OR (SELECT COUNT(*) FROM paws.CalendarActivity WHERE SourceRow=25 AND SourceColumn IN(N'C',N'D',N'E'))<>3 THROW 55390,'Complete CCC set not applied.',1;
IF (SELECT COUNT(*) FROM paws.CalendarActivity WHERE FacultyId IS NULL AND StaffingLabel=N'Locum')<>1 OR EXISTS(SELECT 1 FROM paws.Faculty WHERE DisplayName=N'Locum') THROW 55390,'Locum identity was fabricated.',1;
IF paws_api.MasterRefreshSnapshot('2026-27')<>(SELECT DoeSnapshot FROM dbo.CccSlotContext) OR EXISTS(SELECT 1 FROM paws.AfcRecord) THROW 55390,'CCC schedule changed DOE/AFC.',1;
DELETE @Result;INSERT @Result EXEC dbo.ApplyCccMasterTest;
IF JSON_VALUE((SELECT responseJson FROM @Result),'$.idempotentReplay')<>N'true' OR (SELECT COUNT(*) FROM paws.CccReplacementReceipt)<>1 THROW 55390,'CCC retry duplicated rows.',1;
DECLARE @Receipt uniqueidentifier=(SELECT ReceiptId FROM dbo.CccMasterContext);
BEGIN TRY
 BEGIN TRANSACTION;UPDATE paws.CalendarActivity SET BlockLabel=N'Later manual edit' WHERE SourceColumn=N'D';EXEC paws_api.RecoverCccReplacement N'ccc-slots-admin',@Receipt,1;THROW 55390,'Recovery overwrote manual metadata.',1;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>54908 THROW;END CATCH;
EXEC paws_api.RecoverCccReplacement N'ccc-slots-admin',@Receipt,1;
IF NOT EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ActivityId=(SELECT OldId FROM dbo.CccSlotContext) AND OriginalLabel=N'Legacy CCC') OR EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE SourceColumn IS NOT NULL) THROW 55390,'Complete old-set recovery failed.',1;
IF NOT EXISTS(SELECT 1 FROM staging.ImportRow WHERE RawJson LIKE N'%SECRET-MASTER-CCC%') THROW 55390,'Private source evidence was not retained.',1;
IF HASHBYTES('SHA2_256',(SELECT * FROM paws.CalendarActivityImportReceipt ORDER BY ReceiptId FOR JSON PATH,INCLUDE_NULL_VALUES))<>(SELECT Hash FROM dbo.CccHistoricalReceipt) THROW 55390,'Historical working-activity migration receipt changed.',1;
PRINT 'MASTER_CCC_REPLACEMENT_ACCEPTANCE_OK';
