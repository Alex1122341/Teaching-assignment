/* Uploaded originals are confidential documents, never approval artifacts or absence records. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
IF DB_NAME()<>N'VetMed-Ops' OR OBJECT_ID(N'paws_api.ListChangeHistoryEvents',N'P') IS NULL THROW 54800,'AFC form prerequisites are missing.',1;
IF OBJECT_ID(N'paws.AfcFormDocument') IS NOT NULL OR DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_form') IS NOT NULL THROW 54800,'Inspect existing AFC form objects before applying.',1;
BEGIN TRANSACTION;
CREATE TABLE paws.AfcFormDocument(
 DocumentId uniqueidentifier NOT NULL PRIMARY KEY,
 FacultyId uniqueidentifier NOT NULL REFERENCES paws.Faculty(FacultyId),
 FileName nvarchar(180) NOT NULL,
 PdfBytes varbinary(max) NOT NULL,
 PdfSha256 binary(32) NOT NULL,
 ByteLength int NOT NULL,
 PageCount int NOT NULL CHECK(PageCount BETWEEN 1 AND 100),
 RequestId uniqueidentifier NOT NULL,
 CreatedByUid nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
 CreatedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT UQ_AfcFormDocument_Request UNIQUE(CreatedByUid,RequestId),
 CONSTRAINT CK_AfcFormDocument_Length CHECK(ByteLength BETWEEN 1 AND 2097152 AND DATALENGTH(PdfBytes)=ByteLength),
 CONSTRAINT CK_AfcFormDocument_Hash CHECK(PdfSha256=HASHBYTES('SHA2_256',PdfBytes))
);
CREATE INDEX IX_AfcFormDocument_Faculty ON paws.AfcFormDocument(FacultyId,DocumentId);
GO
CREATE PROCEDURE paws_api.UploadAfcForm
 @ActorFirebaseUid nvarchar(128),@FacultyId uniqueidentifier,@RequestId uniqueidentifier,
 @FileName nvarchar(180),@PdfBytes varbinary(max),@PdfSha256 varchar(64),@PageCount int
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @DocumentId uniqueidentifier,@Replay bit=0,@Response nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;
  IF NOT EXISTS(SELECT 1 FROM paws.UserProfile WITH(HOLDLOCK) WHERE FirebaseUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND Active=1 AND MustChangePassword=0
   AND LOWER(BaseRole) COLLATE Latin1_General_100_BIN2 IN(N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin')) THROW 54801,'AFC form administrator required.',1;
  IF @FacultyId IS NULL OR @RequestId IS NULL OR @FileName IS NULL OR LEN(@FileName)=0 OR LEN(@FileName)>180 OR LOWER(RIGHT(@FileName,4))<>N'.pdf'
   OR @FileName LIKE N'%[/\:*?"<>|]%' OR CHARINDEX(NCHAR(10),@FileName)>0 OR CHARINDEX(NCHAR(13),@FileName)>0
   OR @PageCount NOT BETWEEN 1 AND 100 OR @PageCount IS NULL OR @PdfBytes IS NULL OR DATALENGTH(@PdfBytes) NOT BETWEEN 1 AND 2097152
   OR @PdfSha256 IS NULL OR DATALENGTH(@PdfSha256)<>64 OR TRY_CONVERT(binary(32),@PdfSha256,2) IS NULL
   OR HASHBYTES('SHA2_256',@PdfBytes)<>TRY_CONVERT(binary(32),@PdfSha256,2) THROW 54802,'Invalid AFC form input.',1;
  SELECT @DocumentId=DocumentId FROM paws.AfcFormDocument WITH(UPDLOCK,HOLDLOCK) WHERE CreatedByUid COLLATE Latin1_General_100_BIN2=@ActorFirebaseUid COLLATE Latin1_General_100_BIN2 AND RequestId=@RequestId;
  IF @DocumentId IS NOT NULL
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM paws.AfcFormDocument WHERE DocumentId=@DocumentId AND FacultyId=@FacultyId AND FileName COLLATE Latin1_General_100_BIN2=@FileName COLLATE Latin1_General_100_BIN2 AND PdfSha256=CONVERT(binary(32),@PdfSha256,2) AND PageCount=@PageCount) THROW 54804,'Upload key conflicts with another document.',1;
   SET @Replay=1;
  END
  ELSE
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM paws.Faculty WITH(HOLDLOCK) WHERE FacultyId=@FacultyId AND Active=1) THROW 54803,'Active faculty not found.',1;
   SET @DocumentId=NEWID();
   INSERT paws.AfcFormDocument(DocumentId,FacultyId,FileName,PdfBytes,PdfSha256,ByteLength,PageCount,RequestId,CreatedByUid)
   VALUES(@DocumentId,@FacultyId,@FileName,@PdfBytes,CONVERT(binary(32),@PdfSha256,2),DATALENGTH(@PdfBytes),@PageCount,@RequestId,@ActorFirebaseUid);
   DECLARE @After nvarchar(max)=(SELECT CONVERT(varchar(36),@FacultyId) facultyId,CONVERT(varchar(36),@DocumentId) documentId,@FileName fileName,DATALENGTH(@PdfBytes) byteLength,@PageCount pageCount,@PdfSha256 sha256 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson,RequestId,ImportBatchId)
   VALUES(NEWID(),N'afc_form_uploaded',N'afc_form',CONVERT(nvarchar(36),@DocumentId),@ActorFirebaseUid,NULL,SYSUTCDATETIME(),NULL,@After,(SELECT CONVERT(varchar(36),@FacultyId) facultyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@RequestId,NULL);
  END;
  SET @Response=(SELECT CONVERT(varchar(36),DocumentId) documentId,CONVERT(varchar(36),FacultyId) facultyId,FileName fileName,ByteLength byteLength,PageCount pageCount,LOWER(CONVERT(varchar(64),PdfSha256,2)) sha256,CreatedAtUtc createdAtUtc,@Replay idempotentReplay FROM paws.AfcFormDocument WHERE DocumentId=@DocumentId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  COMMIT;SELECT @Response responseJson;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE paws_api.ListAfcForms
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
CREATE PROCEDURE paws_api.GetAfcForm @ActorFirebaseUid nvarchar(128),@DocumentId uniqueidentifier
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
CREATE ROLE paws_runtime_afc_form AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::paws_api.UploadAfcForm TO paws_runtime_afc_form;
GRANT EXECUTE ON OBJECT::paws_api.ListAfcForms TO paws_runtime_afc_form;
GRANT EXECUTE ON OBJECT::paws_api.GetAfcForm TO paws_runtime_afc_form;
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::paws.AfcFormDocument TO paws_runtime_afc_form;
GO
CREATE OR ALTER PROCEDURE paws_api.ListChangeHistoryEvents
 @ActorFirebaseUid nvarchar(128),@Scope nvarchar(16),@StartUtc datetime2(7),@EndExclusiveUtc datetime2(7)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Role nvarchar(128),@Faculty uniqueidentifier,@Admin bit=0;
 SELECT @Role=LOWER(LTRIM(RTRIM(BaseRole))),@Faculty=FacultyId FROM paws.UserProfile
 WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
 IF @Role IS NULL OR @Role NOT IN(N'owner',N'administrator',N'admin',N'developer',N'adfa_general',N'adfa_regular',N'faculty',N'hicc',N'visc',N'adc',N'lab')
 OR (@Role IN(N'faculty',N'hicc',N'visc') AND @Faculty IS NULL) THROW 54701,'History role denied.',1;
 IF @Scope NOT IN(N'mine',N'timetable',N'dashboard') OR @StartUtc IS NULL OR @EndExclusiveUtc IS NULL OR @StartUtc>=@EndExclusiveUtc
 OR DATEDIFF(day,@StartUtc,@EndExclusiveUtc)>3660 THROW 54702,'Invalid history range or scope.',1;
 IF @Scope=N'mine' AND @Faculty IS NULL THROW 54703,'My history requires a faculty link.',1;
 IF @Role IN(N'owner',N'administrator',N'admin',N'developer',N'adfa_general',N'adfa_regular') SET @Admin=1;
 SELECT TOP(10001) * INTO #HistoryEvents FROM (
 SELECT N'audit' source,CONVERT(nvarchar(36),e.AuditEventId) eventId,e.EventType eventType,e.EntityType entityType,e.EntityId entityId,
 e.OccurredAtUtc occurredAtUtc,e.BeforeJson beforeJson,e.AfterJson afterJson,e.MetadataJson metadataJson,c.ContextJson contextJson,
 CASE WHEN @Admin=1 THEN e.ActorName END actorName,CAST(NULL AS nvarchar(32)) academicYear,CAST(NULL AS uniqueidentifier) facultyId
 FROM paws.AuditEvent e LEFT JOIN paws.ChangeHistoryContext c ON c.AuditEventId=e.AuditEventId
 WHERE e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc AND (
 (@Scope IN(N'mine',N'timetable') AND e.EventType IN(N'session_updated',N'session_created',N'session_assignments_replaced',N'swap_applied',N'session_deleted')
 AND (@Scope=N'timetable' OR EXISTS(SELECT 1 FROM paws_api.HistoryAffectedFaculty(e.BeforeJson,e.AfterJson,c.ContextJson) af WHERE af.FacultyId=@Faculty)))
 OR (@Scope=N'dashboard' AND e.EventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored',N'role_periods_updated',N'afc_form_uploaded',N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected')
 AND (@Admin=1 OR EXISTS(SELECT 1 FROM paws_api.HistoryAffectedFaculty(e.BeforeJson,e.AfterJson,c.ContextJson) af WHERE af.FacultyId=@Faculty)
 OR(e.EventType IN(N'afc_form_uploaded',N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected') AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(e.MetadataJson,'$.facultyId'))=@Faculty)
 OR(e.EventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored') AND TRY_CONVERT(uniqueidentifier,e.EntityId)=@Faculty)))
 )
 UNION ALL
 SELECT N'doe',CONVERT(nvarchar(36),e.AuditEventId),e.Action,e.EntityType,e.EntityId,e.ChangedAtUtc,e.BeforeJson,e.AfterJson,NULL,
 (SELECT CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM paws.DoePolicyPublication p WHERE p.PolicyVersionId=e.PolicyVersionId) THEN 1 ELSE 0 END) wasPublished FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),
 CASE WHEN @Admin=1 THEN e.ActorName END,e.AcademicYear,e.FacultyId
 FROM paws.DoeAuditEvent e WHERE @Scope=N'dashboard' AND e.ChangedAtUtc>=@StartUtc AND e.ChangedAtUtc<@EndExclusiveUtc
 AND ((e.EntityType=N'doe_policy_version' AND e.Action IN(N'draft_created',N'draft_updated',N'working_draft_created',N'published',N'archived')
 AND (@Admin=1 OR e.Action=N'published' OR(e.Action=N'archived' AND EXISTS(SELECT 1 FROM paws.DoePolicyPublication p WHERE p.PolicyVersionId=e.PolicyVersionId AND p.PublishedAtUtc<=e.ChangedAtUtc))))
 OR(e.EntityType IN(N'doe_assignment',N'faculty_doe_target',N'manual_doe_assignment') AND (@Admin=1 OR e.FacultyId=@Faculty)))
 UNION ALL
 -- Receipt/recovery bindings prove historical membership without inferring it
 -- from today's assignments. Only immutable source activity facts are selected;
 -- confidential AFC recovery before-images never leave this read procedure.
 SELECT N'work',CONCAT(CONVERT(nvarchar(36),e.AuditEventId),N':',CONVERT(nvarchar(36),recovery.ActivityId)),e.EventType,N'calendar_activity',CONVERT(nvarchar(256),recovery.ActivityId),e.OccurredAtUtc,
 CASE WHEN e.EventType=N'calendar_activity_import_recovered' THEN(SELECT item.FacultyId facultyId,item.OriginalLabel label,item.Category category,item.StartDate startDate,item.EndDate endDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END,
 CASE WHEN e.EventType=N'calendar_activity_import_committed' THEN(SELECT item.FacultyId facultyId,item.OriginalLabel label,item.Category category,item.StartDate startDate,item.EndDate endDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END,NULL,NULL,
 CASE WHEN @Admin=1 THEN e.ActorName END,NULL,item.FacultyId
 FROM paws.AuditEvent e JOIN paws.CalendarActivityImportReceipt receipt ON receipt.ReceiptId=TRY_CONVERT(uniqueidentifier,e.EntityId)
 JOIN paws.CalendarActivityRecoveryRow recovery ON recovery.ReceiptId=receipt.ReceiptId
 JOIN staging.CalendarActivityImportItem item ON item.ImportBatchId=receipt.ImportBatchId AND item.AfcRecordId=recovery.OriginalAfcRecordId
 WHERE @Scope IN(N'mine',N'dashboard') AND e.EventType IN(N'calendar_activity_import_committed',N'calendar_activity_import_recovered')
 AND e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc
 AND ((@Scope=N'dashboard' AND @Admin=1) OR item.FacultyId=@Faculty)
 UNION ALL
 SELECT N'work',CONVERT(nvarchar(36),e.AuditEventId),e.EventType,e.EntityType,e.EntityId,e.OccurredAtUtc,e.BeforeJson,JSON_QUERY(c.ContextJson,'$.workActivity'),NULL,c.ContextJson,
 CASE WHEN @Admin=1 THEN e.ActorName END,NULL,TRY_CONVERT(uniqueidentifier,JSON_VALUE(c.ContextJson,'$.facultyId'))
 FROM paws.AuditEvent e LEFT JOIN paws.ChangeHistoryContext c ON c.AuditEventId=e.AuditEventId
 WHERE e.EventType=N'calendar_activity_time_resolved' AND @Scope IN(N'mine',N'dashboard')
 AND e.OccurredAtUtc>=@StartUtc AND e.OccurredAtUtc<@EndExclusiveUtc
 AND ((@Scope=N'dashboard' AND @Admin=1) OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(c.ContextJson,'$.facultyId'))=@Faculty)
 ) events ORDER BY occurredAtUtc DESC,source,eventId;
 IF (SELECT COUNT(*) FROM #HistoryEvents)>10000 OR (SELECT COALESCE(SUM(CONVERT(bigint,COALESCE(DATALENGTH(beforeJson),0))+COALESCE(DATALENGTH(afterJson),0)+COALESCE(DATALENGTH(contextJson),0)+COALESCE(DATALENGTH(metadataJson),0)),0) FROM #HistoryEvents)>12582912
 THROW 54704,'Narrow the history range before reading.',1;
 -- Resolve only proven historical IDs to opaque filter keys. Today's roster is
 -- never evidence of affected membership; current names label the filter only.
 SELECT events.*,(
 SELECT candidate.FacultyId facultyId,candidate.CandidateKey facultyKey,
 COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),f.DisplayName) displayName
 FROM paws.SwapCandidate candidate JOIN paws.Faculty f ON f.FacultyId=candidate.FacultyId
 WHERE candidate.FacultyId IN(
 SELECT FacultyId FROM paws_api.HistoryAffectedFaculty(events.beforeJson,events.afterJson,events.contextJson)
 UNION SELECT events.facultyId WHERE events.facultyId IS NOT NULL
 UNION SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(events.metadataJson,'$.facultyId')) WHERE events.eventType IN(N'afc_form_uploaded',N'afc_record_created',N'afc_record_cancelled',N'afc_request_submitted',N'afc_request_withdrawn',N'afc_request_recommended',N'afc_request_approved',N'afc_request_rejected')
 UNION SELECT TRY_CONVERT(uniqueidentifier,events.entityId) WHERE events.eventType IN(N'FacultyUpdated',N'FacultyDeactivated',N'FacultyRestored')
 ) FOR JSON PATH) directoryFacultyJson
 FROM #HistoryEvents events ORDER BY occurredAtUtc DESC,source,eventId;
END;
GO
COMMIT;
