:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 54590,'Wrong synthetic database.',1;
IF paws_api.CalendarActivityPurposeCategory(N'Remote Work (approved)') IS NOT NULL
 THROW 54590,'REMOTE_WORK_MUST_REMAIN_AFC_AWAY',1;
DECLARE @Actor nvarchar(128)=N'away-synthetic-admin',@Source uniqueidentifier=NEWID(),@Batch uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID();
DECLARE @Work uniqueidentifier=NEWID(),@Remote uniqueidentifier=NEWID(),@Opa uniqueidentifier=NEWID(),@Manual uniqueidentifier=NEWID();
DECLARE @Name nvarchar(256)=CONCAT(N'Away Synthetic ',CONVERT(char(36),@Faculty));
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,Active,MustChangePassword) VALUES(@Actor,N'away@example.test',N'Away Synthetic Admin',N'owner',1,0);
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson)
 VALUES(@Source,SYSUTCDATETIME(),N'synthetic',REPLICATE('A',64),N'away-test',N'{}');
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',@Name,1,@Source);
INSERT paws.SwapCandidate(FacultyId) VALUES(@Faculty);
INSERT staging.AfcRecordRaw(ImportBatchId,ImportRowId,SourceRowNumber,FacultySourceName,StartDate,EndDate,Purpose,RawJson,ValidationStatus,ValidationErrorsJson)
 SELECT @Source,NEWID(),r.SourceRow,@Name,'2026-11-05','2026-11-06',r.Purpose,N'{}',N'valid',N'[]'
 FROM(VALUES(2,N'CCC Day'),(3,N'Remote Work (approved)'),(4,N'OPA'))r(SourceRow,Purpose);
INSERT paws.AfcRecord(AfcRecordId,FacultyId,StartDate,EndDate,Purpose,Active,SourceImportBatchId,SourceRow)
 VALUES(@Work,@Faculty,'2026-11-05','2026-11-06',N'CCC Day',1,@Source,2),
 (@Remote,@Faculty,'2026-11-05','2026-11-06',N'Remote Work (approved)',1,@Source,3),
 (@Opa,@Faculty,'2026-11-05','2026-11-06',N'OPA',1,@Source,4);
INSERT paws.AfcManualRecord(AfcRecordId,FacultyId,StartDate,EndDate,ReasonCode,Active,CreatedByFirebaseUid,RequestId)
 VALUES(@Manual,@Faculty,'2026-11-05','2026-11-06',N'vacation',1,@Actor,NEWID());
DECLARE @Protected TABLE(Id uniqueidentifier PRIMARY KEY,Version binary(8));
INSERT @Protected SELECT AfcRecordId,CONVERT(binary(8),AfcVersion) FROM paws.AfcRecord WHERE AfcRecordId IN(@Remote,@Opa)
 UNION ALL SELECT AfcRecordId,CONVERT(binary(8),AfcVersion) FROM paws.AfcManualRecord WHERE AfcRecordId=@Manual;
DECLARE @Rows nvarchar(max)=(SELECT r.SourceRow sourceRow,@Name facultySourceName,N'2026-11-05' startDate,N'2026-11-06' endDate,r.Purpose originalLabel,
 CASE WHEN r.SourceRow=4 THEN N'retain_afc' ELSE N'working_candidate' END treatment,JSON_QUERY(N'[]') issues
 FROM(VALUES(2,N'CCC Day'),(3,N'Remote Work (approved)'),(4,N'OPA'))r(SourceRow,Purpose) FOR JSON PATH);
DECLARE @N int=5,@Issue nvarchar(64),@Label nvarchar(1000);
WHILE @N<=16
BEGIN
 SET @Issue=CASE WHEN @N<=12 THEN N'DUPLICATE_SOURCE_ROW' WHEN @N IN(13,14) THEN N'END_BEFORE_START' WHEN @N=15 THEN N'MISSING_FACULTY' ELSE N'MISSING_PURPOSE' END;
 SET @Label=CASE WHEN @N<=12 THEN N'Vacation' WHEN @N=13 THEN N'Clinical Day / PPVM (external)' WHEN @N=14 THEN N'Remote Work (approved)' WHEN @N=15 THEN N'CCC Day' ELSE N'' END;
 SET @Rows=JSON_MODIFY(@Rows,'append $',JSON_QUERY((SELECT @N sourceRow,CASE WHEN @N=15 THEN N'' ELSE @Name END facultySourceName,
 N'2026-11-05' startDate,CASE WHEN @N IN(13,14) THEN N'2026-11-04' ELSE N'2026-11-06' END endDate,@Label originalLabel,N'quarantined' treatment,
 JSON_QUERY(CONCAT(N'["',@Issue,N'"]')) issues FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)));
 SET @N+=1;
END;
SET @Rows=JSON_MODIFY(@Rows,'append $',JSON_QUERY(N'{"sourceRow":267,"facultySourceName":"Departed Synthetic","startDate":"2026-11-05","endDate":"2026-11-06","originalLabel":"CCC Day","treatment":"excluded","issues":[]}'));
DECLARE @Response TABLE(responseJson nvarchar(max));
INSERT @Response EXEC paws_api.StageCalendarActivityImport @Actor,@Batch,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Rows;
DECLARE @Json nvarchar(max)=(SELECT responseJson FROM @Response),@Version varchar(16),@Manifest char(64),@Key uniqueidentifier=NEWID();
IF JSON_VALUE(@Json,'$.policyVersion')<>N'afc-working-activities-v2' OR JSON_VALUE(@Json,'$.counts.accepted')<>N'1'
 OR JSON_VALUE(@Json,'$.counts.retained')<>N'2' OR JSON_VALUE(@Json,'$.counts.quarantined')<>N'12' OR JSON_VALUE(@Json,'$.counts.excluded')<>N'1'
 THROW 54590,'Away revision produced incorrect treatments.',1;
IF (SELECT COUNT(*) FROM OPENJSON(@Json,'$.items') WITH(status nvarchar(32),disposition nvarchar(16),needsReview bit) WHERE status=N'quarantined' AND disposition=N'away' AND needsReview=1)<>12
 THROW 54590,'Abnormal Away rows lost their needs-review warning.',1;
IF EXISTS(SELECT 1 FROM OPENJSON(@Json,'$.items') WITH(status nvarchar(32),issues nvarchar(max) AS JSON) WHERE status=N'quarantined' AND (issues IS NULL OR issues=N'[]'))
 THROW 54590,'Away classification erased original source issues.',1;
IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Json,'$.items') WITH(sourceRow int,endDate date,displayName nvarchar(256),disposition nvarchar(16),needsReview bit) WHERE sourceRow=13 AND endDate='2026-11-04' AND needsReview=1 AND disposition=N'away')
 THROW 54590,'Incorrect Away dates were guessed or silently normalized.',1;
IF NOT EXISTS(SELECT 1 FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@Batch AND SourceRow=15 AND FacultySourceName=N'' AND FacultyId IS NULL AND Status=N'quarantined')
 THROW 54590,'Missing Away identity was invented.',1;
IF EXISTS(SELECT 1 FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@Batch AND SourceRow IN(3,14) AND (Category IS NOT NULL OR AfcRecordId IS NOT NULL OR FacultyId IS NOT NULL))
 THROW 54590,'Remote work retained stale working targets.',1;
PRINT 'CALENDAR_AWAY_DISPOSITION_AND_ISSUES_OK';
-- Reproduce the already staged v1 source before the owner revised classification.
UPDATE remote SET ParserTreatment=N'working_candidate',Category=N'remote_work',Status=N'accepted',FacultyId=work.FacultyId,
 ResolutionMethod=work.ResolutionMethod,IdentityDigest=work.IdentityDigest,AfcRecordId=@Remote,
 ExpectedAfcVersion=(SELECT CONVERT(binary(8),AfcVersion) FROM paws.AfcRecord WHERE AfcRecordId=@Remote),TargetCount=1
 FROM staging.CalendarActivityImportItem remote JOIN staging.CalendarActivityImportItem work ON work.ImportBatchId=remote.ImportBatchId AND work.SourceRow=2
 WHERE remote.ImportBatchId=@Batch AND remote.SourceRow=3;
DECLARE @ManifestRows nvarchar(max)=(SELECT SourceRow,FacultyId,ResolutionMethod,CONVERT(varchar(64),IdentityDigest,2) identityDigest,
 AfcRecordId,CONVERT(varchar(16),ExpectedAfcVersion,2) afcVersion,StartDate,EndDate,OriginalLabel,Category,Status
 FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@Batch ORDER BY SourceRow FOR JSON PATH,INCLUDE_NULL_VALUES);
UPDATE staging.CalendarActivityImport SET PolicyVersion=N'afc-working-activities-v1',ManifestSha256=CONVERT(varchar(64),HASHBYTES('SHA2_256',
 CONCAT(SourceSha256,N'|',Dataset,N'|',N'afc-working-activities-v1',N'|',CONVERT(char(10),StartDate,23),N'|',CONVERT(char(10),EndDate,23),N'|',@ManifestRows)),2) WHERE ImportBatchId=@Batch;
SELECT @Version=CONVERT(varchar(16),CONVERT(binary(8),ImportVersion),2),@Manifest=ManifestSha256 FROM staging.CalendarActivityImport WHERE ImportBatchId=@Batch;
DECLARE @OldManifest char(64)=@Manifest,@Rejected bit=0;
BEGIN TRY EXEC paws_api.CommitCalendarActivityImport @Actor,@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;END TRY
BEGIN CATCH IF ERROR_NUMBER()=53806 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 OR EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ImportBatchId=@Batch) OR NOT EXISTS(SELECT 1 FROM paws.AfcRecord WHERE AfcRecordId=@Remote)
 THROW 54590,'Old v1 migration was not rejected before business writes.',1;
-- Even a recomputed v2 manifest cannot turn a retained purpose back into work.
UPDATE staging.CalendarActivityImport SET PolicyVersion=N'afc-working-activities-v2',ManifestSha256=CONVERT(varchar(64),HASHBYTES('SHA2_256',
 CONCAT(SourceSha256,N'|',Dataset,N'|',N'afc-working-activities-v2',N'|',CONVERT(char(10),StartDate,23),N'|',CONVERT(char(10),EndDate,23),N'|',@ManifestRows)),2) WHERE ImportBatchId=@Batch;
SELECT @Version=CONVERT(varchar(16),CONVERT(binary(8),ImportVersion),2),@Manifest=ManifestSha256 FROM staging.CalendarActivityImport WHERE ImportBatchId=@Batch;
SET @Rejected=0;
BEGIN TRY EXEC paws_api.CommitCalendarActivityImport @Actor,@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;END TRY
BEGIN CATCH IF ERROR_NUMBER()=53806 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 THROW 54590,'A retained purpose bypassed the canonical work classifier.',1;
UPDATE staging.CalendarActivityImport SET PolicyVersion=N'afc-working-activities-v1',ManifestSha256=@OldManifest WHERE ImportBatchId=@Batch;
SELECT @Version=CONVERT(varchar(16),CONVERT(binary(8),ImportVersion),2) FROM staging.CalendarActivityImport WHERE ImportBatchId=@Batch;
DELETE @Response;INSERT @Response EXEC paws_api.PreviewCalendarActivityImport @Actor,@Batch,@Version;
SELECT @Json=responseJson,@Version=JSON_VALUE(responseJson,'$.previewVersion'),@Manifest=JSON_VALUE(responseJson,'$.manifestSha256') FROM @Response;
IF @Manifest=@OldManifest OR JSON_VALUE(@Json,'$.policyVersion')<>N'afc-working-activities-v2' OR JSON_VALUE(@Json,'$.counts.accepted')<>N'1'
 OR NOT EXISTS(SELECT 1 FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@Batch AND SourceRow=3 AND Status=N'retained' AND Category IS NULL AND AfcRecordId IS NULL)
 THROW 54590,'Fresh preview did not invalidate and replace v1 Remote work targets.',1;
SET @Rejected=0;
BEGIN TRY EXEC paws_api.CommitCalendarActivityImport @Actor,@Batch,@Version,@OldManifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;END TRY
BEGIN CATCH IF ERROR_NUMBER()=53806 SET @Rejected=1;ELSE THROW;END CATCH;
IF @Rejected=0 THROW 54590,'Superseded manifest was accepted with a refreshed version.',1;
PRINT 'CALENDAR_AWAY_LEGACY_MANIFEST_REJECTED_OK';
DELETE @Response;INSERT @Response EXEC paws_api.CommitCalendarActivityImport @Actor,@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;
DECLARE @Receipt uniqueidentifier=(SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(responseJson,'$.receiptId')) FROM @Response);
IF @Receipt IS NULL OR (SELECT InsertedCount FROM paws.CalendarActivityImportReceipt WHERE ReceiptId=@Receipt)<>1 OR (SELECT DeletedAfcCount FROM paws.CalendarActivityImportReceipt WHERE ReceiptId=@Receipt)<>1
 OR EXISTS(SELECT 1 FROM paws.AfcRecord WHERE AfcRecordId=@Work) OR (SELECT COUNT(*) FROM paws.CalendarActivity WHERE ImportBatchId=@Batch)<>1
 OR EXISTS(SELECT 1 FROM @Protected p LEFT JOIN (SELECT AfcRecordId,AfcVersion FROM paws.AfcRecord UNION ALL SELECT AfcRecordId,AfcVersion FROM paws.AfcManualRecord) a ON a.AfcRecordId=p.Id WHERE a.AfcRecordId IS NULL OR CONVERT(binary(8),a.AfcVersion)<>p.Version)
 THROW 54590,'Work-only commit changed retained Remote work, OPA or manual AFC.',1;
IF (SELECT COUNT(*) FROM staging.CalendarActivityImportItem WHERE ImportBatchId=@Batch AND Status=N'quarantined')<>12
 OR (SELECT COUNT(*) FROM paws.CalendarActivityRecoveryRow WHERE ReceiptId=@Receipt)<>1
 THROW 54590,'Away rows were migrated or recovery before-images were lost.',1;
EXEC paws_api.ExportCalendarActivityRecovery @Actor,@Receipt;
DELETE @Response;INSERT @Response EXEC paws_api.CommitCalendarActivityImport @Actor,@Batch,@Version,@Manifest,'4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF',@Key,1;
IF JSON_VALUE((SELECT responseJson FROM @Response),'$.idempotentReplay')<>N'true' OR (SELECT COUNT(*) FROM paws.CalendarActivityImportReceipt WHERE ImportBatchId=@Batch)<>1
 THROW 54590,'Work-only import replay was not receipt-bound and idempotent.',1;
PRINT 'CALENDAR_AWAY_ATOMIC_RETENTION_RECOVERY_OK';
