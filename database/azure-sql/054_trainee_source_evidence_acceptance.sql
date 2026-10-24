/* Disposable synthetic SQL only. No source names/student notes from MASTER. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF USER_ID(N'paws-calendar-test-runtime') IS NULL THROW 55490,'Disposable fixture required.',1;
DECLARE @Seed uniqueidentifier=NEWID(),@A uniqueidentifier=NEWID(),@B uniqueidentifier=NEWID(),@Previous uniqueidentifier=NEWID(),@Inactive uniqueidentifier=NEWID(),@New uniqueidentifier=NEWID();
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Seed,SYSUTCDATETIME(),N'completed',REPLICATE('B',64),N'trainee-test',N'{}');
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@A,N'faculty',N'Example Alpha',1,@Seed),(@B,N'faculty',N'Example Beta',1,@Seed),(@Previous,N'faculty',N'Example Previous',1,@Seed),(@Inactive,N'faculty',N'Example Inactive',0,@Seed),(@New,N'faculty',N'Example New Zero',1,@Seed);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword) VALUES(N'trainee-admin',N'admin@example.test',N'Administrator',N'owner',NULL,1,0),(N'trainee-self',N'self@example.test',N'Self',N'faculty',@A,1,0),(N'trainee-viewer',N'viewer@example.test',N'Viewer',N'viewer',@B,1,0);
INSERT paws.DoeWorkloadSource(AcademicYear,ParametersJson,SourceReference,SourceSha256,ApprovedBy) VALUES('2026-27',N'{}',N'Synthetic baseline',REPLICATE('B',64),N'synthetic'),('2025-26',N'{}',N'Synthetic prior year',REPLICATE('B',64),N'synthetic');
INSERT paws.DoeSupervisionSourceSnapshot(SnapshotId,FacultyId,AcademicYear,RawDoe,EvidenceJson,SourceReference,SourceSha256,CreatedBy)
 SELECT NEWID(),faculty,year,raw,notes,N'Synthetic previous source',REPLICATE('B',64),N'synthetic' FROM(VALUES(@A,'2026-27',2,N'{"counts":[0,0,53,0,0,0,0]}'),(@B,'2026-27',0,N'{"counts":[0,0,0,0,0,0,0]}'),(@Previous,'2026-27',1,N'{"counts":[1,0,0,0,0,0,0]}'),(@Inactive,'2026-27',4,N'{"counts":[4,0,0,0,0,0,0]}'),(@A,'2025-26',9,N'{"counts":[0,0,9,0,0,0,0]}')) source(faculty,year,raw,notes);
CREATE TABLE dbo.TraineeContext(A uniqueidentifier,B uniqueidentifier,PreviousFaculty uniqueidentifier,InactiveFaculty uniqueidentifier,NewFaculty uniqueidentifier,SourceJson nvarchar(max),PreviewJson nvarchar(max),RequestKey uniqueidentifier,ReceiptId uniqueidentifier NULL);
DECLARE @Rows nvarchar(max)=(SELECT faculty facultyId,name sourceName,'resolved' identityStatus,JSON_QUERY(counts) rawCounts,JSON_QUERY(N'[0,0,0,0,0,0,0]') categoryDoe,sourceDoe,CAST(NULL AS int) sourceTotal,
 JSON_QUERY((SELECT REPLICATE('A',64) sha256,N'# Trainees' sheet,n row,N'A' [column] FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) sourceRef,JSON_QUERY(N'{"E":"PRIVATE OWN NOTE"}') privateNotes
 FROM(VALUES(@A,N'Example Alpha',3,N'[0,0,53,0,0,0,0]',CAST(1 AS decimal(12,6))),(@B,N'Example Beta',4,N'[0,null,0,0,0,0,0]',NULL),(@New,N'Example New Zero',5,N'[0,0,0,0,0,0,0]',CAST(0 AS decimal(12,6))),(@Inactive,N'Example Inactive',6,N'[4,0,0,0,0,0,0]',CAST(4 AS decimal(12,6))),(CAST(NULL AS uniqueidentifier),N'Unresolved Source',7,N'[0,0,0,0,0,0,0]',CAST(0 AS decimal(12,6))),(CAST(NULL AS uniqueidentifier),N'Guide row',2,N'[0,0,8,0,0,0,0]',CAST(0 AS decimal(12,6)))) data(faculty,name,n,counts,sourceDoe) ORDER BY n FOR JSON PATH,INCLUDE_NULL_VALUES);
DECLARE @Source nvarchar(max)=(SELECT 1 schemaVersion,'2026-27' academicYear,REPLICATE('A',64) sourceSha256,REPLICATE('C',64) manifestSha256,JSON_QUERY(@Rows) trainees FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
INSERT dbo.TraineeContext VALUES(@A,@B,@Previous,@Inactive,@New,@Source,NULL,NEWID(),NULL);
SELECT * INTO dbo.TraineeOriginalSnapshots FROM paws.DoeSupervisionSourceSnapshot;
GO
CREATE PROCEDURE dbo.StageTraineeTest
AS
BEGIN
 DECLARE @Source nvarchar(max)=(SELECT SourceJson FROM dbo.TraineeContext),@Guard nvarchar(max);
 SET @Guard=(SELECT 1 schemaVersion,REPLICATE('C',64) sourceManifestSha256,REPLICATE('D',64) doeGuardHash,CONVERT(varchar(64),HASHBYTES('SHA2_256',paws_api.MasterRefreshSnapshot('2026-27')),2) contextHash,
  JSON_QUERY((SELECT JSON_VALUE(value,'$.facultyId') facultyId,N'Trainee Supervision' roleType,JSON_VALUE(value,'$.sourceDoe') sourceDoe,
   CASE WHEN TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.facultyId'))=(SELECT NewFaculty FROM dbo.TraineeContext) THEN N'matched' ELSE N'held_mismatch' END status,N'safe' aggregateStatus,
   TRY_CONVERT(decimal(12,6),JSON_VALUE(value,'$.sourceDoe')) activeDoe,TRY_CONVERT(decimal(12,6),JSON_VALUE(value,'$.sourceDoe')) candidateDoe FROM OPENJSON(@Source,'$.trainees') FOR JSON PATH,INCLUDE_NULL_VALUES)) rows FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 SET @Guard=JSON_MODIFY(@Guard,'$.facultyImpacts',JSON_QUERY((SELECT NewFaculty facultyId,N'2026-27' academicYear,N'safe' status,REPLICATE('E',64) sourceHash,REPLICATE('F',64) evidenceHash,0 expectedRoleDelta,
 JSON_QUERY(N'{"scheduledTeachingDoe":0,"roleDoe":0,"rawSupervisionDoe":0,"appliedSupervisionDoe":0,"adjustmentDoe":0,"assignedTeachingDoe":0,"effectiveTargetDoe":40,"remainingDoe":40}') before,
 JSON_QUERY(N'{"scheduledTeachingDoe":0,"roleDoe":0,"rawSupervisionDoe":0,"appliedSupervisionDoe":0,"adjustmentDoe":0,"assignedTeachingDoe":0,"effectiveTargetDoe":40,"remainingDoe":40}') proposed FROM dbo.TraineeContext FOR JSON PATH)));
 DECLARE @Result TABLE(responseJson nvarchar(max));INSERT @Result EXEC paws_api.PreviewMasterRefresh N'trainees','2026-27',@Source,N'trainee-admin',@Guard;
 UPDATE dbo.TraineeContext SET PreviewJson=(SELECT responseJson FROM @Result),RequestKey=NEWID();
END;
GO
CREATE PROCEDURE dbo.ApplyTraineeTest
AS
BEGIN
 DECLARE @Preview nvarchar(max),@Key uniqueidentifier,@Batch uniqueidentifier,@Version varchar(16),@Source char(64)=REPLICATE('A',64),@Manifest char(64)=REPLICATE('C',64);
 SELECT @Preview=PreviewJson,@Key=RequestKey FROM dbo.TraineeContext;SELECT @Batch=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@Preview,'$.batchId')),@Version=JSON_VALUE(@Preview,'$.expectedVersion');
 EXEC paws_api.CommitMasterRefresh N'trainees',@Batch,@Version,@Manifest,@Source,@Key,N'trainee-admin',1;
END;
GO
EXEC dbo.StageTraineeTest;
IF (SELECT COUNT(*) FROM OPENJSON((SELECT PreviewJson FROM dbo.TraineeContext),'$.operations'))<>3 OR (SELECT COUNT(*) FROM OPENJSON((SELECT PreviewJson FROM dbo.TraineeContext),'$.heldIssues'))<>5 THROW 55490,'Trainee identity/allocation holds incorrect.',1;
BEGIN TRY
 BEGIN TRANSACTION;UPDATE paws.DoeSupervisionSourceSnapshot SET EvidenceJson=N'{"counts":[9,0,0,0,0,0,0]}' WHERE FacultyId=(SELECT A FROM dbo.TraineeContext) AND AcademicYear='2026-27';EXEC dbo.ApplyTraineeTest;THROW 55490,'Stale trainee source accepted.',1;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55204 THROW;END CATCH;
EXEC dbo.StageTraineeTest;
GO
CREATE TRIGGER paws.TraineeAuditFailure ON paws.AuditEvent AFTER INSERT AS
BEGIN
 IF EXISTS(SELECT 1 FROM inserted WHERE EventType=N'trainee_source_refreshed') THROW 55491,'Injected trainee audit failure.',1;
END;
GO
BEGIN TRY EXEC dbo.ApplyTraineeTest;THROW 55490,'Trainee audit failure ignored.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>55491 THROW;END CATCH;
IF EXISTS(SELECT 1 FROM paws.TraineeSourceEvidence) OR EXISTS(SELECT 1 FROM paws.MasterRefreshReceipt WHERE Domain=N'trainees') THROW 55490,'Trainee partial update persisted.',1;
DROP TRIGGER paws.TraineeAuditFailure;EXEC dbo.StageTraineeTest;
DECLARE @Result TABLE(responseJson nvarchar(max));INSERT @Result EXEC dbo.ApplyTraineeTest;
UPDATE dbo.TraineeContext SET ReceiptId=TRY_CONVERT(uniqueidentifier,JSON_VALUE((SELECT responseJson FROM @Result),'$.receiptId'));DELETE @Result;
IF (SELECT COUNT(*) FROM paws.TraineeSourceEvidence)<>3 OR EXISTS(SELECT 1 FROM dbo.TraineeOriginalSnapshots old LEFT JOIN paws.DoeSupervisionSourceSnapshot s ON s.SnapshotId=old.SnapshotId WHERE s.SnapshotId IS NULL OR s.RawDoe<>old.RawDoe) THROW 55490,'Trainee refresh changed existing DOE.',1;
IF NOT EXISTS(SELECT 1 FROM paws.TraineeSourceEvidence WHERE FacultyId=(SELECT A FROM dbo.TraineeContext) AND SourceDoe=1 AND AllocationStatus=N'held_mismatch') OR NOT EXISTS(SELECT 1 FROM paws.TraineeSourceEvidence WHERE FacultyId=(SELECT B FROM dbo.TraineeContext) AND SourceDoe IS NULL AND AllocationStatus=N'source_missing' AND JSON_VALUE(RawCountsJson,'$[0]')='0' AND JSON_VALUE(RawCountsJson,'$[1]') IS NULL) THROW 55490,'Source/null versus zero was lost.',1;
DECLARE @History TABLE(source nvarchar(16),eventId nvarchar(100),eventType nvarchar(128),entityType nvarchar(128),entityId nvarchar(256),occurredAtUtc datetime2(7),beforeJson nvarchar(max),afterJson nvarchar(max),metadataJson nvarchar(max),contextJson nvarchar(max),actorName nvarchar(260),academicYear nvarchar(32),facultyId uniqueidentifier,directoryFacultyJson nvarchar(max));
DECLARE @HistoryStart datetime2(7)=DATEADD(day,-1,SYSUTCDATETIME()),@HistoryEnd datetime2(7)=DATEADD(day,1,SYSUTCDATETIME());
INSERT @History EXEC paws_api.ListChangeHistoryEvents N'trainee-admin',N'dashboard',@HistoryStart,@HistoryEnd;
IF (SELECT COUNT(*) FROM @History WHERE eventType=N'trainee_source_refreshed')<>3 THROW 55490,'Administrator history omits trainee source refresh.',1;DELETE @History;
INSERT @History EXEC paws_api.ListChangeHistoryEvents N'trainee-self',N'dashboard',@HistoryStart,@HistoryEnd;
IF (SELECT COUNT(*) FROM @History WHERE eventType=N'trainee_source_refreshed')<>1 OR EXISTS(SELECT 1 FROM @History WHERE eventType=N'trainee_source_refreshed' AND JSON_VALUE(afterJson,'$.facultyId')<>CONVERT(nvarchar(36),(SELECT A FROM dbo.TraineeContext))) THROW 55490,'Trainee history widened self scope.',1;
IF EXISTS(SELECT 1 FROM @History WHERE eventType=N'trainee_source_refreshed' AND JSON_VALUE(afterJson,'$.academicYear')<>N'2026-27') THROW 55490,'Trainee history lacks recorded year.',1;
DECLARE @Self uniqueidentifier=(SELECT A FROM dbo.TraineeContext),@Response nvarchar(max);
ALTER ROLE paws_runtime_trainee_read ADD MEMBER [paws-calendar-test-runtime];
EXECUTE AS USER=N'paws-calendar-test-runtime';
BEGIN TRY
 SELECT TOP(1) * FROM paws.TraineeSourceEvidence;THROW 55490,'Runtime read private source evidence directly.',1;
END TRY BEGIN CATCH IF ERROR_NUMBER()<>229 THROW;END CATCH;
INSERT @Result EXEC paws_api.ListTraineeSource N'trainee-self','2026-27',N'',NULL,N'faculty',@Self;
REVERT;SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.rows'))<>1 OR JSON_VALUE(@Response,'$.rows[0].rawCounts[2]')<>N'53' OR TRY_CONVERT(decimal(12,6),JSON_VALUE(@Response,'$.rows[0].currentRawDoe'))<>2 OR TRY_CONVERT(decimal(12,6),JSON_VALUE(@Response,'$.rows[0].sourceDoe'))<>1 THROW 55490,'Self/guide/sourceDOE scope incorrect.',1;
INSERT @Result EXEC paws_api.ListTraineeSource N'trainee-self','2026-27',N'Beta',NULL,N'faculty',@Self;
IF COALESCE(JSON_QUERY((SELECT responseJson FROM @Result),'$.rows'),N'NULL')<>N'[]' THROW 55490,'Search must return an explicit empty self-scope array.',1;DELETE @Result;
INSERT @Result EXEC paws_api.ListTraineeSource N'trainee-self','2026-27',N'[AB]',NULL,N'faculty',@Self;
IF COALESCE(JSON_QUERY((SELECT responseJson FROM @Result),'$.rows'),N'NULL')<>N'[]' THROW 55490,'Literal bracket search must return an explicit empty array.',1;DELETE @Result;
INSERT @Result EXEC paws_api.ListTraineeSource N'trainee-self','2025-26',N'',N'preceptor',N'faculty',@Self;
IF JSON_VALUE((SELECT responseJson FROM @Result),'$.rows[0].rawCounts[2]')<>N'9' THROW 55490,'Trainee year isolation lost.',1;DELETE @Result;
INSERT @Result EXEC paws_api.ListTraineeSource N'trainee-self','2026-27',N'',N'undergrad',N'faculty',@Self;
IF COALESCE(JSON_QUERY((SELECT responseJson FROM @Result),'$.rows'),N'NULL')<>N'[]' THROW 55490,'Empty category must return an explicit array.',1;DELETE @Result;
INSERT @Result EXEC paws_api.ListTraineeSource N'trainee-admin','2026-27',N'',NULL,N'owner',NULL;
SELECT @Response=responseJson FROM @Result;DELETE @Result;
IF (SELECT COUNT(*) FROM OPENJSON(@Response,'$.rows'))<>4 OR NOT EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.rows') WHERE JSON_VALUE(value,'$.sourceStatus')=N'previous_source') OR EXISTS(SELECT 1 FROM OPENJSON(@Response,'$.rows') WHERE JSON_VALUE(value,'$.displayName')=N'Example Inactive') THROW 55490,'Previous-source or inactive scope incorrect.',1;
BEGIN TRY EXEC paws_api.ListTraineeSource N'trainee-self','2026-27',N'',NULL,N'owner',NULL;THROW 55490,'Forged expected role accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>55401 THROW;END CATCH;
UPDATE paws.UserProfile SET Active=0 WHERE FirebaseUid=N'trainee-self';
BEGIN TRY EXEC paws_api.ListTraineeSource N'trainee-self','2026-27',N'',NULL,N'faculty',@Self;THROW 55490,'Revoked profile read trainees.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>55401 THROW;END CATCH;
UPDATE paws.UserProfile SET Active=1 WHERE FirebaseUid=N'trainee-self';
INSERT @Result EXEC dbo.ApplyTraineeTest;
IF JSON_VALUE((SELECT responseJson FROM @Result),'$.idempotentReplay')<>N'true' THROW 55490,'Trainee retry duplicated data.',1;
DECLARE @Receipt uniqueidentifier=(SELECT ReceiptId FROM dbo.TraineeContext);
BEGIN TRY
 BEGIN TRANSACTION;UPDATE paws.TraineeSourceEvidence SET PrivateNotesJson=N'{"E":"Later manual edit"}' WHERE FacultyId=@Self;EXEC paws_api.RecoverMasterRefresh @Receipt,N'trainee-admin',1;THROW 55490,'Recovery overwrote later evidence.',1;
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;IF ERROR_NUMBER()<>55208 THROW;END CATCH;
EXEC paws_api.RecoverMasterRefresh @Receipt,N'trainee-admin',1;
IF EXISTS(SELECT 1 FROM paws.TraineeSourceEvidence) OR EXISTS(SELECT 1 FROM paws.DoeSupervisionSourceSnapshot WHERE FacultyId=(SELECT NewFaculty FROM dbo.TraineeContext)) OR EXISTS(SELECT 1 FROM dbo.TraineeOriginalSnapshots old LEFT JOIN paws.DoeSupervisionSourceSnapshot s ON s.SnapshotId=old.SnapshotId WHERE s.SnapshotId IS NULL OR s.RawDoe<>old.RawDoe OR s.EvidenceJson<>old.EvidenceJson) THROW 55490,'Trainee recovery did not preserve source/year/DOE.',1;
ALTER ROLE paws_runtime_trainee_read DROP MEMBER [paws-calendar-test-runtime];
PRINT 'MASTER_TRAINEES_ACCEPTANCE_OK';
