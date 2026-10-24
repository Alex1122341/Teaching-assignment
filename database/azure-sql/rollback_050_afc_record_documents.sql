/* Refuse populated originals/links; never delete business records or archived documents. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws.AfcRecordDocument') IS NULL THROW 55000,'Record document feature required.',1;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM paws.AfcRecordDocument WITH(UPDLOCK,HOLDLOCK)) OR EXISTS(SELECT 1 FROM paws.AfcFormDocument WITH(UPDLOCK,HOLDLOCK)) THROW 55008,'Populated AFC document rollback refused.',1;
IF EXISTS(SELECT 1 FROM sys.database_role_members WHERE role_principal_id=DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_record_document')) THROW 55008,'Remove reviewed runtime memberships before rollback.',1;
DROP PROCEDURE paws_api.CreateAfcRecordWithDocument;
DROP VIEW paws.vAfcRecordOriginal;
DROP TABLE paws.AfcRecordDocument;
ALTER TABLE paws.AfcManualRecord DROP CONSTRAINT UQ_AfcManualRecord_DocumentFaculty;
ALTER TABLE paws.AfcFormDocument DROP CONSTRAINT UQ_AfcFormDocument_RecordFaculty;
DROP ROLE paws_runtime_afc_record_document;
GO
CREATE OR ALTER PROCEDURE paws_api.ListAfcForms
 @ActorFirebaseUid nvarchar(128),@FacultyId uniqueidentifier,@Cursor uniqueidentifier=NULL,@Limit int=25
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Response nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;
  IF NOT EXISTS(SELECT 1 FROM paws.UserProfile WITH(HOLDLOCK) WHERE FirebaseUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND Active=1 AND MustChangePassword=0
   AND LOWER(BaseRole) COLLATE Latin1_General_100_BIN2 IN(N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin')) THROW 54801,'AFC form administrator required.',1;
  IF @FacultyId IS NULL OR @Limit NOT BETWEEN 1 AND 100 OR @Limit IS NULL THROW 54802,'Invalid AFC form query.',1;
  DECLARE @CursorDate datetime2(7)=NULL;
  IF @Cursor IS NOT NULL
  BEGIN
   SELECT @CursorDate=CreatedAtUtc FROM paws.AfcFormDocument WHERE FacultyId=@FacultyId AND DocumentId=@Cursor;
   IF @CursorDate IS NULL THROW 54802,'Invalid document cursor.',1;
  END;
  SELECT TOP(@Limit+1) DocumentId,FacultyId,FileName,ByteLength,PageCount,PdfSha256,CreatedAtUtc INTO #docs FROM paws.AfcFormDocument WHERE FacultyId=@FacultyId AND (@Cursor IS NULL OR CreatedAtUtc<@CursorDate OR (CreatedAtUtc=@CursorDate AND DocumentId>@Cursor)) ORDER BY CreatedAtUtc DESC,DocumentId;
  DECLARE @Next uniqueidentifier=NULL;
  IF (SELECT COUNT(*) FROM #docs)>@Limit SELECT @Next=DocumentId FROM #docs ORDER BY CreatedAtUtc DESC,DocumentId OFFSET (@Limit-1) ROWS FETCH NEXT 1 ROWS ONLY;
  SET @Response=(SELECT JSON_QUERY((SELECT TOP(@Limit) CONVERT(varchar(36),DocumentId) documentId,CONVERT(varchar(36),FacultyId) facultyId,FileName fileName,ByteLength byteLength,PageCount pageCount,LOWER(CONVERT(varchar(64),PdfSha256,2)) sha256,CreatedAtUtc createdAtUtc FROM #docs ORDER BY CreatedAtUtc DESC,DocumentId FOR JSON PATH)) documents,CONVERT(varchar(36),@Next) nextCursor FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
  COMMIT;SELECT @Response responseJson;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE paws_api.GetAfcForm @ActorFirebaseUid nvarchar(128),@DocumentId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Metadata nvarchar(max),@Pdf varbinary(max);
 BEGIN TRY
  BEGIN TRANSACTION;
  IF NOT EXISTS(SELECT 1 FROM paws.UserProfile WITH(HOLDLOCK) WHERE FirebaseUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND Active=1 AND MustChangePassword=0
   AND LOWER(BaseRole) COLLATE Latin1_General_100_BIN2 IN(N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin')) THROW 54801,'AFC form administrator required.',1;
  SELECT @Metadata=(SELECT CONVERT(varchar(36),DocumentId) documentId,CONVERT(varchar(36),FacultyId) facultyId,FileName fileName,ByteLength byteLength,PageCount pageCount,LOWER(CONVERT(varchar(64),PdfSha256,2)) sha256,CreatedAtUtc createdAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@Pdf=PdfBytes FROM paws.AfcFormDocument WITH(HOLDLOCK) WHERE DocumentId=@DocumentId;
  IF @Pdf IS NULL THROW 54803,'Document not found.',1;
  IF HASHBYTES('SHA2_256',@Pdf)<>TRY_CONVERT(binary(32),JSON_VALUE(@Metadata,'$.sha256'),2) THROW 54805,'Document integrity failure.',1;
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson,RequestId,ImportBatchId)
  VALUES(NEWID(),N'afc_form_downloaded',N'afc_form',CONVERT(nvarchar(36),@DocumentId),@ActorFirebaseUid,NULL,SYSUTCDATETIME(),NULL,NULL,NULL,NEWID(),NULL);
  COMMIT;SELECT @Metadata responseJson,@Pdf pdfBytes;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
COMMIT;
