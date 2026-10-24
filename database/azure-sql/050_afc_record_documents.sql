/* Record-linked AFC originals; live authorization and owner-scoped reads. No memberships/data backfill. */
:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws.AfcFormDocument') IS NULL OR OBJECT_ID(N'paws_api.CreateAfcRecord',N'P') IS NULL THROW 55000,'AFC document prerequisites missing.',1;
IF OBJECT_ID(N'paws.AfcRecordDocument') IS NOT NULL OR DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_record_document') IS NOT NULL THROW 55000,'Inspect existing record/document feature before applying.',1;
IF EXISTS(SELECT 1 FROM sys.schemas WHERE name IN(N'paws',N'paws_api') AND USER_NAME(principal_id)<>N'dbo') THROW 55000,'dbo ownership chain required.',1;
BEGIN TRANSACTION;
ALTER TABLE paws.AfcManualRecord ADD CONSTRAINT UQ_AfcManualRecord_DocumentFaculty UNIQUE(AfcRecordId,FacultyId);
ALTER TABLE paws.AfcFormDocument ADD CONSTRAINT UQ_AfcFormDocument_RecordFaculty UNIQUE(DocumentId,FacultyId);
CREATE TABLE paws.AfcRecordDocument(
 AfcRecordId uniqueidentifier NOT NULL PRIMARY KEY,
 FacultyId uniqueidentifier NOT NULL,
 DocumentId uniqueidentifier NOT NULL UNIQUE,
 LinkedByUid nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
 LinkedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT FK_AfcRecordDocument_RecordFaculty FOREIGN KEY(AfcRecordId,FacultyId) REFERENCES paws.AfcManualRecord(AfcRecordId,FacultyId),
 CONSTRAINT FK_AfcRecordDocument_DocumentFaculty FOREIGN KEY(DocumentId,FacultyId) REFERENCES paws.AfcFormDocument(DocumentId,FacultyId)
);
GO
CREATE VIEW paws.vAfcRecordOriginal AS
 SELECT link.AfcRecordId,link.FacultyId,link.DocumentId FROM paws.AfcRecordDocument link;
GO
CREATE PROCEDURE paws_api.CreateAfcRecordWithDocument
 @AfcRecordId uniqueidentifier,@FacultyId uniqueidentifier,@StartDate date,@EndDate date,@ReasonCode nvarchar(128),@Notes nvarchar(max),
 @ActorFirebaseUid nvarchar(128),@ActorName nvarchar(260),@RequestId uniqueidentifier,@DocumentId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @RecordedActor nvarchar(260),@FileName nvarchar(180);
 DECLARE @Created TABLE(afcRecordId uniqueidentifier,facultyId uniqueidentifier,facultyName nvarchar(260),startDate varchar(10),endDate varchar(10),reasonCode nvarchar(128),reason nvarchar(64),notes nvarchar(max),active bit,sourceKind nvarchar(16));
 BEGIN TRY
  BEGIN TRANSACTION;
  SELECT @RecordedActor=DisplayName FROM paws.UserProfile WITH(HOLDLOCK) WHERE FirebaseUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND Active=1 AND MustChangePassword=0 AND LOWER(BaseRole) COLLATE Latin1_General_100_BIN2 IN(N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin');
  IF @@ROWCOUNT<>1 THROW 55001,'Current AFC administrator required.',1;
  SELECT @FileName=FileName FROM paws.AfcFormDocument WITH(UPDLOCK,HOLDLOCK) WHERE DocumentId=@DocumentId AND FacultyId=@FacultyId AND CreatedByUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2;
  IF @DocumentId IS NULL OR @FileName IS NULL OR EXISTS(SELECT 1 FROM paws.AfcRecordDocument WITH(UPDLOCK,HOLDLOCK) WHERE DocumentId=@DocumentId OR AfcRecordId=@AfcRecordId) THROW 55003,'Archived original is not available for this exact faculty record.',1;
  INSERT @Created EXEC paws_api.CreateAfcRecord @AfcRecordId=@AfcRecordId,@FacultyId=@FacultyId,@StartDate=@StartDate,@EndDate=@EndDate,@ReasonCode=@ReasonCode,@Notes=@Notes,@ActorFirebaseUid=@ActorFirebaseUid,@ActorName=@RecordedActor,@RequestId=@RequestId;
  INSERT paws.AfcRecordDocument(AfcRecordId,FacultyId,DocumentId,LinkedByUid)VALUES(@AfcRecordId,@FacultyId,@DocumentId,@ActorFirebaseUid);
  DECLARE @After nvarchar(max)=(SELECT @AfcRecordId afcRecordId,@FacultyId facultyId,@DocumentId documentId,@FileName fileName,@StartDate startDate,@EndDate endDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson,RequestId,ImportBatchId)
  VALUES(NEWID(),N'afc_form_linked',N'afc_record',CONVERT(nvarchar(36),@AfcRecordId),@ActorFirebaseUid,@RecordedActor,SYSUTCDATETIME(),NULL,@After,(SELECT @FacultyId facultyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@RequestId,NULL);
  COMMIT;
  SELECT created.*,@DocumentId documentId FROM @Created created;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE paws_api.ListAfcForms
 @ActorFirebaseUid nvarchar(128),@FacultyId uniqueidentifier,@Cursor uniqueidentifier=NULL,@Limit int=25
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Role nvarchar(128),@Own uniqueidentifier,@Admin bit=0,@Response nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;
  SELECT @Role=LOWER(BaseRole),@Own=FacultyId FROM paws.UserProfile WITH(HOLDLOCK) WHERE FirebaseUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND Active=1 AND MustChangePassword=0;
  IF @Role IN(N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin') SET @Admin=1;
  IF @Role IS NULL OR (@Admin=0 AND (@Role NOT IN(N'faculty',N'hicc',N'visc') OR @Own IS NULL OR @Own<>@FacultyId OR NOT EXISTS(SELECT 1 FROM paws.Faculty WITH(HOLDLOCK) WHERE FacultyId=@Own AND Active=1))) THROW 54801,'Own AFC document access required.',1;
  IF @FacultyId IS NULL OR @Limit IS NULL OR @Limit NOT BETWEEN 1 AND 100 THROW 54802,'Invalid AFC document query.',1;
  DECLARE @CursorDate datetime2(7)=NULL;
  IF @Cursor IS NOT NULL BEGIN SELECT @CursorDate=CreatedAtUtc FROM paws.AfcFormDocument WHERE FacultyId=@FacultyId AND DocumentId=@Cursor;IF @CursorDate IS NULL THROW 54802,'Invalid document cursor.',1;END;
  SELECT TOP(@Limit+1) DocumentId,FacultyId,FileName,ByteLength,PageCount,PdfSha256,CreatedAtUtc INTO #docs FROM paws.AfcFormDocument WHERE FacultyId=@FacultyId AND (@Cursor IS NULL OR CreatedAtUtc<@CursorDate OR(CreatedAtUtc=@CursorDate AND DocumentId>@Cursor)) ORDER BY CreatedAtUtc DESC,DocumentId;
  DECLARE @Next uniqueidentifier=NULL;IF(SELECT COUNT(*) FROM #docs)>@Limit SELECT @Next=DocumentId FROM #docs ORDER BY CreatedAtUtc DESC,DocumentId OFFSET(@Limit-1)ROWS FETCH NEXT 1 ROWS ONLY;
  SET @Response=(SELECT JSON_QUERY((SELECT TOP(@Limit) CONVERT(varchar(36),DocumentId) documentId,CONVERT(varchar(36),FacultyId) facultyId,FileName fileName,ByteLength byteLength,PageCount pageCount,LOWER(CONVERT(varchar(64),PdfSha256,2)) sha256,CreatedAtUtc createdAtUtc FROM #docs ORDER BY CreatedAtUtc DESC,DocumentId FOR JSON PATH)) documents,CONVERT(varchar(36),@Next) nextCursor FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
  COMMIT;SELECT @Response responseJson;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE paws_api.GetAfcForm @ActorFirebaseUid nvarchar(128),@DocumentId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Role nvarchar(128),@Own uniqueidentifier,@ActorName nvarchar(260),@Admin bit=0,@Metadata nvarchar(max),@Pdf varbinary(max);
 BEGIN TRY
  BEGIN TRANSACTION;
  SELECT @Role=LOWER(BaseRole),@Own=FacultyId,@ActorName=DisplayName FROM paws.UserProfile WITH(HOLDLOCK) WHERE FirebaseUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND Active=1 AND MustChangePassword=0;
  IF @Role IN(N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin') SET @Admin=1;
  IF @Role IS NULL OR (@Admin=0 AND (@Role NOT IN(N'faculty',N'hicc',N'visc') OR @Own IS NULL OR NOT EXISTS(SELECT 1 FROM paws.Faculty WITH(HOLDLOCK) WHERE FacultyId=@Own AND Active=1))) THROW 54801,'Own AFC document access required.',1;
  SELECT @Metadata=(SELECT CONVERT(varchar(36),DocumentId) documentId,CONVERT(varchar(36),FacultyId) facultyId,FileName fileName,ByteLength byteLength,PageCount pageCount,LOWER(CONVERT(varchar(64),PdfSha256,2)) sha256,CreatedAtUtc createdAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@Pdf=PdfBytes FROM paws.AfcFormDocument WITH(HOLDLOCK) WHERE DocumentId=@DocumentId AND(@Admin=1 OR FacultyId=@Own);
  IF @Pdf IS NULL THROW 54803,'Document not found in permitted archive.',1;
  IF HASHBYTES('SHA2_256',@Pdf)<>TRY_CONVERT(binary(32),JSON_VALUE(@Metadata,'$.sha256'),2) THROW 54805,'Document integrity failure.',1;
  INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson,RequestId,ImportBatchId)
  VALUES(NEWID(),N'afc_form_downloaded',N'afc_form',CONVERT(nvarchar(36),@DocumentId),@ActorFirebaseUid,@ActorName,SYSUTCDATETIME(),NULL,NULL,NULL,NEWID(),NULL);
  COMMIT;SELECT @Metadata responseJson,@Pdf pdfBytes;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE ROLE paws_runtime_afc_record_document AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::paws_api.CreateAfcRecordWithDocument TO paws_runtime_afc_record_document;
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::paws.AfcRecordDocument TO paws_runtime_afc_record_document;
GRANT SELECT ON OBJECT::paws.vAfcRecordOriginal TO paws_runtime_read;
COMMIT;
