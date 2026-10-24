/* Disposable labeled-container test only. Never run on the University host. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' OR USER_ID(N'paws-calendar-test-runtime') IS NULL THROW 54890,'Synthetic prerequisites required.',1;
DECLARE @Batch uniqueidentifier=NEWID(),@Faculty uniqueidentifier=NEWID();
INSERT staging.ImportBatch(ImportBatchId,StartedAtUtc,Status,SourceManifestSha256,ImporterVersion,ValidationSummaryJson) VALUES(@Batch,SYSUTCDATETIME(),N'completed',REPLICATE('A',64),N'synthetic-afc-forms',N'{}');
INSERT paws.Faculty(FacultyId,RecordType,DisplayName,Active,SourceImportBatchId) VALUES(@Faculty,N'faculty',N'Synthetic forms faculty',1,@Batch);
INSERT paws.UserProfile(FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword) VALUES(N'form-test-admin',N'admin@example.test',N'Synthetic admin',N'owner',NULL,1,0),(N'form-test-faculty',N'faculty@example.test',N'Synthetic faculty',N'faculty',@Faculty,1,0);
CREATE TABLE dbo.AfcFormTestContext(FacultyId uniqueidentifier,RequestId uniqueidentifier,DocumentId uniqueidentifier NULL);
INSERT dbo.AfcFormTestContext VALUES(@Faculty,NEWID(),NULL);
CREATE TABLE #protected(Name sysname PRIMARY KEY,Hash binary(32));
DECLARE @Name sysname,@Sql nvarchar(max),@Json nvarchar(max);
DECLARE tables CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID(N'paws') AND name NOT IN(N'AfcFormDocument',N'AuditEvent',N'ChangeHistoryContext',N'UserProfile');
OPEN tables;FETCH NEXT FROM tables INTO @Name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @Sql=N'SELECT @j=(SELECT * FROM paws.'+QUOTENAME(@Name)+N' FOR JSON PATH,INCLUDE_NULL_VALUES)';EXEC sys.sp_executesql @Sql,N'@j nvarchar(max) OUTPUT',@Json OUTPUT;
 INSERT #protected VALUES(@Name,HASHBYTES('SHA2_256',CONVERT(varbinary(max),@Json)));FETCH NEXT FROM tables INTO @Name;
END;CLOSE tables;DEALLOCATE tables;
DECLARE @Bytes varbinary(max)=0x255044462D73796E746865746963,@Hash varchar(64),@Request uniqueidentifier=(SELECT RequestId FROM dbo.AfcFormTestContext);
DECLARE @Rows TABLE(responseJson nvarchar(max));
SET @Hash=CONVERT(varchar(64),HASHBYTES('SHA2_256',@Bytes),2);
ALTER ROLE paws_runtime_afc_form ADD MEMBER [paws-calendar-test-runtime];
EXECUTE AS USER=N'paws-calendar-test-runtime';
INSERT @Rows EXEC paws_api.UploadAfcForm @ActorFirebaseUid=N'form-test-admin',@FacultyId=@Faculty,@RequestId=@Request,@FileName=N'Synthetic.pdf',@PdfBytes=@Bytes,@PdfSha256=@Hash,@PageCount=1;
REVERT;
UPDATE dbo.AfcFormTestContext SET DocumentId=CONVERT(uniqueidentifier,JSON_VALUE((SELECT TOP(1) responseJson FROM @Rows),'$.documentId'));
IF (SELECT COUNT(*) FROM paws.AfcFormDocument)<>1 OR (SELECT COUNT(*) FROM paws.AuditEvent WHERE EventType=N'afc_form_uploaded')<>1 THROW 54890,'Atomic upload/audit failed.',1;
DELETE @Rows;
INSERT @Rows EXEC paws_api.UploadAfcForm @ActorFirebaseUid=N'form-test-admin',@FacultyId=@Faculty,@RequestId=@Request,@FileName=N'Synthetic.pdf',@PdfBytes=@Bytes,@PdfSha256=@Hash,@PageCount=1;
IF JSON_VALUE((SELECT TOP(1) responseJson FROM @Rows),'$.idempotentReplay')<>N'true' OR (SELECT COUNT(*) FROM paws.AfcFormDocument)<>1 THROW 54890,'Replay duplicated upload.',1;
BEGIN TRY EXEC paws_api.UploadAfcForm @ActorFirebaseUid=N'form-test-admin',@FacultyId=@Faculty,@RequestId=@Request,@FileName=N'Changed.pdf',@PdfBytes=@Bytes,@PdfSha256=@Hash,@PageCount=1;THROW 54890,'Conflicting replay was accepted.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54804 THROW;END CATCH;
DECLARE @Id uniqueidentifier=(SELECT DocumentId FROM dbo.AfcFormTestContext);
DECLARE @Downloads TABLE(responseJson nvarchar(max),pdfBytes varbinary(max));
INSERT @Downloads EXEC paws_api.GetAfcForm @ActorFirebaseUid=N'form-test-admin',@DocumentId=@Id;
IF NOT EXISTS(SELECT 1 FROM @Downloads WHERE pdfBytes=@Bytes AND JSON_VALUE(responseJson,'$.fileName')=N'Synthetic.pdf') THROW 54890,'Download bytes/metadata changed.',1;
IF EXISTS(SELECT 1 FROM paws.AuditEvent WHERE EventType IN(N'afc_form_uploaded',N'afc_form_downloaded') AND COALESCE(AfterJson,N'') LIKE N'%PdfBytes%') THROW 54890,'Document bytes leaked into audit.',1;
BEGIN TRY EXEC paws_api.GetAfcForm @ActorFirebaseUid=N'form-test-faculty',@DocumentId=@Id;THROW 54890,'Faculty read allowed.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54801 THROW;END CATCH;
BEGIN TRY EXEC paws_api.ListAfcForms @ActorFirebaseUid=N'form-test-faculty',@FacultyId=@Faculty;THROW 54890,'Faculty list allowed.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54801 THROW;END CATCH;
UPDATE paws.UserProfile SET MustChangePassword=1 WHERE FirebaseUid=N'form-test-admin';
BEGIN TRY EXEC paws_api.GetAfcForm @ActorFirebaseUid=N'form-test-admin',@DocumentId=@Id;THROW 54890,'Password gate bypassed.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54801 THROW;END CATCH;
UPDATE paws.UserProfile SET MustChangePassword=0,Active=0 WHERE FirebaseUid=N'form-test-admin';
BEGIN TRY EXEC paws_api.ListAfcForms @ActorFirebaseUid=N'form-test-admin',@FacultyId=@Faculty;THROW 54890,'Inactive actor read allowed.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54801 THROW;END CATCH;
UPDATE paws.UserProfile SET Active=1,BaseRole=N'faculty',FacultyId=@Faculty WHERE FirebaseUid=N'form-test-admin';
BEGIN TRY EXEC paws_api.GetAfcForm @ActorFirebaseUid=N'form-test-admin',@DocumentId=@Id;THROW 54890,'Revoked role read allowed.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54801 THROW;END CATCH;
UPDATE paws.UserProfile SET BaseRole=N'owner',FacultyId=NULL WHERE FirebaseUid=N'form-test-admin';
EXECUTE AS USER=N'paws-calendar-test-runtime';
BEGIN TRY SELECT PdfBytes FROM paws.AfcFormDocument;REVERT;THROW 54890,'Direct document read allowed.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>229 BEGIN REVERT;THROW;END;END CATCH;
REVERT;
ALTER ROLE paws_runtime_afc_form DROP MEMBER [paws-calendar-test-runtime];
DECLARE @History TABLE(source nvarchar(16),eventId nvarchar(80),eventType nvarchar(128),entityType nvarchar(128),entityId nvarchar(256),occurredAtUtc datetime2(7),beforeJson nvarchar(max),afterJson nvarchar(max),metadataJson nvarchar(max),contextJson nvarchar(max),actorName nvarchar(260),academicYear nvarchar(32),facultyId uniqueidentifier,directoryFacultyJson nvarchar(max));
INSERT @History EXEC paws_api.ListChangeHistoryEvents @ActorFirebaseUid=N'form-test-admin',@Scope=N'dashboard',@StartUtc='2026-01-01',@EndExclusiveUtc='2030-01-01';
IF NOT EXISTS(SELECT 1 FROM @History WHERE eventType=N'afc_form_uploaded' AND JSON_VALUE(afterJson,'$.documentId')=CONVERT(varchar(36),@Id)) THROW 54890,'Uploaded form history is missing.',1;
GO
CREATE TRIGGER paws.TestAfcFormAuditFailure ON paws.AuditEvent AFTER INSERT AS
BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE EventType=N'afc_form_uploaded' AND JSON_VALUE(AfterJson,'$.fileName')=N'force-failure.pdf') THROW 54898,'Synthetic audit failure.',1;END;
GO
DECLARE @Faculty uniqueidentifier=(SELECT FacultyId FROM dbo.AfcFormTestContext),@Bytes varbinary(max)=0x255044462D73796E746865746963,@Hash varchar(64),@Request uniqueidentifier=NEWID();SET @Hash=CONVERT(varchar(64),HASHBYTES('SHA2_256',@Bytes),2);
BEGIN TRY EXEC paws_api.UploadAfcForm @ActorFirebaseUid=N'form-test-admin',@FacultyId=@Faculty,@RequestId=@Request,@FileName=N'force-failure.pdf',@PdfBytes=@Bytes,@PdfSha256=@Hash,@PageCount=1;THROW 54890,'Audit failure upload succeeded.',1;END TRY BEGIN CATCH IF ERROR_NUMBER()<>54898 THROW;END CATCH;
IF EXISTS(SELECT 1 FROM paws.AfcFormDocument WHERE RequestId=@Request) THROW 54890,'Failed audit left document.',1;
DROP TRIGGER paws.TestAfcFormAuditFailure;
IF (SELECT COUNT(*) FROM paws.AfcFormDocument)<>1 THROW 54890,'Original document changed.',1;
DECLARE @Name sysname,@Sql nvarchar(max),@Json nvarchar(max),@Expected binary(32);
DECLARE tables CURSOR LOCAL FAST_FORWARD FOR SELECT Name,Hash FROM #protected;
OPEN tables;FETCH NEXT FROM tables INTO @Name,@Expected;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @Sql=N'SELECT @j=(SELECT * FROM paws.'+QUOTENAME(@Name)+N' FOR JSON PATH,INCLUDE_NULL_VALUES)';EXEC sys.sp_executesql @Sql,N'@j nvarchar(max) OUTPUT',@Json OUTPUT;
 IF @Expected<>HASHBYTES('SHA2_256',CONVERT(varbinary(max),@Json)) THROW 54890,'Protected data changed.',1;
 FETCH NEXT FROM tables INTO @Name,@Expected;
END;CLOSE tables;DEALLOCATE tables;
PRINT 'AFC_FORM_SQL_ACCEPTANCE_OK';
