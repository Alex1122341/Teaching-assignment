:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_DEFINITION(OBJECT_ID(N'paws_api.GetSessionSwap')) NOT LIKE N'%PAWS_SWAP_APPROVAL_READ_059%' THROW 53059,'059 synthetic acceptance requires its prepared disposable target.',1;
BEGIN TRANSACTION;
-- Expected authorization THROWs must not doom the synthetic fixture transaction.
SET XACT_ABORT OFF;
DECLARE @Source uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID(),@Session uniqueidentifier=NEWID(),@Assignment uniqueidentifier=NEWID(),@Request uniqueidentifier=NEWID(),@Hash varchar(64),@Snapshot nvarchar(max),@Reply nvarchar(max),@Denied bit=0;
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Source,SYSUTCDATETIME(),N'synthetic',REPLICATE('A',64),N'swap-approval059',N'{}');
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,PreferredFirstName,PreferredLastName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',N'Mary Jane de la Cruz',N'Mary Jane',N'de la Cruz',1,@Source);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword) VALUES(N'approval059-self',N'self-private@example.test',N'Mary Jane de la Cruz',N'faculty',@Faculty,1,0),(N'approval059-other',N'other-private@example.test',N'Synthetic Other',N'faculty',NULL,1,0),(N'approval059-adc',N'adc-private@example.test',N'Synthetic ADC',N'adc',NULL,1,0),(N'approval059-lab',N'lab-private@example.test',N'Synthetic LAB',N'lab',NULL,1,0),(N'approval059-admin',N'admin-private@example.test',N'Synthetic Administrator',N'adfa_regular',NULL,1,0);
INSERT paws.Session(SessionId,AcademicYear,CourseCode,Topic,SessionType,SessionDate,StartTime,EndTime,SourceImportBatchId) VALUES(@Session,N'2026-27',N'APPROVAL059',N'Original LAB topic',N'LAB','2026-11-05','09:00','10:00',@Source);
INSERT paws.SessionAssignment(SessionAssignmentId,SessionId,FacultyId,SourceFacultyName,FacultyResolutionStatus,TeachingRole,DoeCredit,SourceImportBatchId,SourceRow) VALUES(@Assignment,@Session,@Faculty,N'Mary Jane de la Cruz',N'resolved',N'Lab Lead',0.42,@Source,1);
SET @Snapshot=paws_api.SessionSwapSnapshot(@Session);SET @Hash=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),@Snapshot)),2);
-- Direct fixture insertion is confined by the launcher to a labeled disposable container.
INSERT paws.SwapRequest(RequestId,SessionId,AssignmentId,CreatorUid,CreatorRole,Revision,Status,NextStage,SnapshotJson,SnapshotToken,ChangesJson,TargetFacultyId,NotifyReplacement,Note,NeedsAdc,NeedsLab,NeedsVisc)
VALUES(@Request,@Session,@Assignment,N'approval059-self',N'faculty',2,N'pending',N'lab',@Snapshot,@Hash,N'{"topic":"Proposed LAB topic","room":"Room 104"}',NULL,0,N'Synthetic note',1,1,0);
INSERT paws.SwapRevision(RequestId,Revision,PayloadJson,ActorUid) VALUES(@Request,1,N'{"secret":"RAW_PAYLOAD_PRIVATE"}',N'approval059-self'),(@Request,2,N'{"secret":"RAW_PAYLOAD_PRIVATE"}',N'approval059-self');
INSERT paws.SwapDecision(RequestId,Revision,Stage,Decision,Comment,ActorUid) VALUES(@Request,1,N'adfa',N'approve',N'Old revision',N'approval059-admin'),(@Request,2,N'adc',N'approve',N'Schedule checked',N'approval059-adc');
DECLARE @Result TABLE(responseJson nvarchar(max));
INSERT @Result EXEC paws_api.GetSessionSwap @Request,N'approval059-lab';SELECT @Reply=responseJson FROM @Result;
IF JSON_VALUE(@Reply,'$.request.original.topic')<>N'Original LAB topic' OR JSON_VALUE(@Reply,'$.request.changes.topic')<>N'Proposed LAB topic' OR JSON_VALUE(@Reply,'$.request.routing.needsAdc')<>N'true' OR JSON_VALUE(@Reply,'$.request.routing.needsLab')<>N'true' OR JSON_VALUE(@Reply,'$.capabilities.canDecide')<>N'true' OR JSON_VALUE(@Reply,'$.request.requester.lastName')<>N'de la Cruz' THROW 53059,'059 detail did not retain original proposal, persisted route or LAB authority.',1;
IF @Reply LIKE N'%private@example.test%' OR @Reply LIKE N'%RAW_PAYLOAD_PRIVATE%' OR @Reply LIKE N'%"CreatorUid"%' OR @Reply LIKE N'%"SnapshotJson"%' OR @Reply LIKE N'%"FacultyId"%' OR @Reply LIKE N'%"DoeCredit"%' THROW 53059,'059 leaked raw identity, source snapshot, payload or DOE.',1;
DELETE @Result;INSERT @Result EXEC paws_api.GetSessionSwap @Request,N'approval059-admin';SELECT @Reply=responseJson FROM @Result;
IF JSON_VALUE(@Reply,'$.capabilities.canDecide')<>N'false' THROW 53059,'059 granted a later normal office permission to act.',1;
BEGIN TRY EXEC paws_api.GetSessionSwap @Request,N'approval059-other';END TRY BEGIN CATCH IF ERROR_NUMBER()=53003 SET @Denied=1;ELSE THROW;END CATCH;
IF @Denied=0 THROW 53059,'059 allowed out-of-scope faculty detail.',1;
DELETE @Result;INSERT @Result EXEC paws_api.GetSessionSwapQueue N'approval059-other';SELECT @Reply=responseJson FROM @Result;
IF EXISTS(SELECT 1 FROM OPENJSON(@Reply,'$.requests') WITH(requestId uniqueidentifier) WHERE requestId=@Request) THROW 53059,'059 leaked queue row to unrelated faculty.',1;
DELETE @Result;INSERT @Result EXEC paws_api.GetSessionSwapQueue N'approval059-self';SELECT @Reply=responseJson FROM @Result;
IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Reply,'$.requests') WITH(requestId uniqueidentifier,isMine bit,canDecide bit,date date) WHERE requestId=@Request AND isMine=1 AND canDecide=0 AND date='2026-11-05') THROW 53059,'059 queue ownership/capability/date projection failed.',1;
UPDATE paws.Session SET Topic=N'Live topic changed later' WHERE SessionId=@Session;
DELETE @Result;INSERT @Result EXEC paws_api.GetSessionSwap @Request,N'approval059-self';SELECT @Reply=responseJson FROM @Result;
IF JSON_VALUE(@Reply,'$.request.original.topic')<>N'Original LAB topic' THROW 53059,'059 replaced original snapshot with live data.',1;
UPDATE paws.UserProfile SET Active=0 WHERE FirebaseUid=N'approval059-self';SET @Denied=0;
BEGIN TRY EXEC paws_api.GetSessionSwap @Request,N'approval059-self';END TRY BEGIN CATCH IF ERROR_NUMBER()=53003 SET @Denied=1;ELSE THROW;END CATCH;
IF @Denied=0 THROW 53059,'059 allowed an inactive requester.',1;
-- Imported SourceFacultyName is provenance. A later swap must bind From to snapshot FacultyId.
DECLARE @NextFaculty uniqueidentifier=NEWID(),@NextRequest uniqueidentifier=NEWID();
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,PreferredFirstName,PreferredLastName,Active,SourceImportBatchId) VALUES(@NextFaculty,N'faculty',N'David Hall',N'David',N'Hall',1,@Source);
UPDATE paws.SessionAssignment SET FacultyId=@NextFaculty WHERE SessionAssignmentId=@Assignment;
SET @Snapshot=paws_api.SessionSwapSnapshot(@Session);SET @Hash=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),@Snapshot)),2);
INSERT paws.SwapRequest(RequestId,SessionId,AssignmentId,CreatorUid,CreatorRole,Revision,Status,NextStage,SnapshotJson,SnapshotToken,ChangesJson,TargetFacultyId,NotifyReplacement,Note,NeedsAdc,NeedsLab,NeedsVisc)
VALUES(@NextRequest,@Session,@Assignment,N'approval059-admin',N'adfa_regular',1,N'pending',N'adfa',@Snapshot,@Hash,N'{"room":"Room 105"}',NULL,0,N'Synthetic repeated request',0,0,0);
DELETE @Result;INSERT @Result EXEC paws_api.GetSessionSwap @NextRequest,N'approval059-admin';SELECT @Reply=responseJson FROM @Result;
IF JSON_VALUE(@Reply,'$.request.original.assignment.lastName')<>N'Hall' OR JSON_VALUE(@Reply,'$.request.original.assignment.firstName')<>N'David' THROW 53059,'059 used imported predecessor name instead of the snapshot outgoing identity.',1;
ROLLBACK;
PRINT 'SWAP_APPROVAL_READ_059_ACCEPTANCE_OK';
