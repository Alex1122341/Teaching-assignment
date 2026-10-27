:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53059,'059 rollback requires VetMed-Ops.',1;
-- Exact known definitions; refuse an unrelated or later read implementation.
IF EXISTS(SELECT 1 FROM (VALUES (N'GetSessionSwap','A935A6DB98628424689806B4EFCBF7C6DF39A02048ED22EAC9053A49E0B233FC','95870DDC317304C6C8A43C643D5BE58F7D91746ECE893C85FDAE58C891960510'),(N'GetSessionSwapQueue','C9156F1B9F3BB6F128D5155AD7E2EBFCFD7B49302D897324A2FA98DA03D6FD7B','4973E39E9FFF274E5C7B454EF1AD9C646996C80F0010078CF137C38395281F03')) v(objectName,baselineHash,candidateHash)
LEFT JOIN sys.procedures p ON p.schema_id=SCHEMA_ID(N'paws_api') AND p.name=v.objectName
LEFT JOIN sys.sql_modules m ON m.object_id=p.object_id
WHERE m.definition IS NULL OR CHARINDEX(N'PROCEDURE',m.definition)=0 OR
CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),TRIM(CHAR(9)+CHAR(10)+CHAR(13)+CHAR(32) FROM STUFF(REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)),1,CHARINDEX(N'PROCEDURE',m.definition)-1,N'CREATE ')))),2) NOT IN(v.candidateHash))
THROW 53059,'059 refuses an unknown read-procedure definition.',1;
BEGIN TRANSACTION;
GO
CREATE OR ALTER PROCEDURE paws_api.GetSessionSwap @RequestId uniqueidentifier,@ActorFirebaseUid nvarchar(128) AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Session uniqueidentifier,@Revision int,@Stage nvarchar(16),@Status nvarchar(32),@Creator nvarchar(128),@CanRevise bit=0,@CanDecide bit=0;
 SELECT @Session=SessionId,@Revision=Revision,@Stage=NextStage,@Status=Status,@Creator=CreatorUid FROM paws.SwapRequest WHERE RequestId=@RequestId;
 IF @Session IS NULL THROW 53004,'SWAP request not found.',1;
 IF @Creator<>@ActorFirebaseUid AND paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'read')<>1 AND NOT EXISTS(SELECT 1 FROM paws.SwapNotification WHERE RequestId=@RequestId AND Revision=@Revision AND TargetUid=@ActorFirebaseUid) THROW 53003,'Request is outside your SWAP scope.',1;
 IF @Status IN(N'pending',N'changes_requested') AND (@Creator=@ActorFirebaseUid OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'visc')=1 OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'adfa')=1 OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'adc')=1 OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'lab')=1) SET @CanRevise=1;
 IF @Status=N'pending' AND (paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,@Stage)=1 OR (@Stage<>N'target' AND paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'override')=1) OR (@Stage=N'target' AND EXISTS(SELECT 1 FROM paws.SwapNotification WHERE RequestId=@RequestId AND Revision=@Revision AND TargetUid=@ActorFirebaseUid AND Status=N'pending'))) SET @CanDecide=1;
 DECLARE @Editable nvarchar(max)=N'[]',@Field nvarchar(128),@Type nvarchar(128); SELECT @Type=SessionType FROM paws.Session WHERE SessionId=@Session;
 DECLARE fieldsCursor CURSOR LOCAL FAST_FORWARD FOR SELECT [key] FROM (VALUES(N'replacementCandidateKey'),(N'courseCode'),(N'date'),(N'startTime'),(N'endTime'),(N'sessionType'),(N'room'),(N'topic')) f([key]) WHERE paws_api.CanEditSessionSwapField(@Session,@ActorFirebaseUid,f.[key],@Type)=1;
 OPEN fieldsCursor;FETCH NEXT FROM fieldsCursor INTO @Field;WHILE @@FETCH_STATUS=0 BEGIN SET @Editable=JSON_MODIFY(@Editable,N'append $',@Field);FETCH NEXT FROM fieldsCursor INTO @Field;END;CLOSE fieldsCursor;DEALLOCATE fieldsCursor;
 SELECT (SELECT JSON_QUERY((SELECT RequestId requestId,SessionId sessionId,AssignmentId assignmentId,Revision revision,Status status,NextStage nextStage,JSON_QUERY(ChangesJson) changes,(SELECT COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f.PreferredFirstName,N' ',f.PreferredLastName))),N''),REPLACE(f.DisplayName,N',',N' ')) FROM paws.Faculty f WHERE f.FacultyId=TargetFacultyId) replacementDisplayName,NotifyReplacement notifyReplacement,Note note,CreatedAtUtc createdAtUtc,UpdatedAtUtc updatedAtUtc FROM paws.SwapRequest WHERE RequestId=@RequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) request,
 JSON_QUERY((SELECT @CanRevise canRevise,CAST(IIF(@Status IN(N'pending',N'changes_requested') AND (@Creator=@ActorFirebaseUid OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'adfa')=1),1,0) AS bit) canWithdraw,@CanDecide canDecide,paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'override') canOverride,JSON_QUERY(N'["approve","reject","push_back"]') decisions,JSON_QUERY(@Editable) editableFields FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) capabilities,
 JSON_QUERY((SELECT Revision revision,Stage stage,Decision decision,Comment comment,OverrideReason overrideReason,CreatedAtUtc createdAtUtc FROM paws.SwapDecision WHERE RequestId=@RequestId ORDER BY CreatedAtUtc FOR JSON PATH,INCLUDE_NULL_VALUES)) history,
 JSON_QUERY((SELECT Revision revision,Status status FROM paws.SwapNotification WHERE RequestId=@RequestId AND (@Creator=@ActorFirebaseUid OR TargetUid=@ActorFirebaseUid OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'adfa')=1) FOR JSON PATH)) notifications FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
END;
GO
CREATE OR ALTER PROCEDURE paws_api.GetSessionSwapQueue @ActorFirebaseUid nvarchar(128) AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM paws.UserProfile WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0) THROW 53003,'Active SQL profile required.',1;
 SELECT (SELECT JSON_QUERY((SELECT r.RequestId requestId,r.SessionId sessionId,(SELECT CourseCode FROM paws.Session WHERE SessionId=r.SessionId) courseCode,r.Revision revision,r.Status status,r.NextStage nextStage,JSON_QUERY(r.ChangesJson) changes,r.NotifyReplacement notifyReplacement,r.Note note,r.CreatedAtUtc createdAtUtc,r.UpdatedAtUtc updatedAtUtc FROM paws.SwapRequest r WHERE r.CreatorUid=@ActorFirebaseUid OR paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,N'adfa')=1 OR paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,N'visc')=1 OR paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,N'adc')=1 OR paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,N'lab')=1 OR EXISTS(SELECT 1 FROM paws.SwapNotification n WHERE n.RequestId=r.RequestId AND n.Revision=r.Revision AND n.TargetUid=@ActorFirebaseUid) ORDER BY r.UpdatedAtUtc DESC FOR JSON PATH,INCLUDE_NULL_VALUES)) requests,JSON_QUERY((SELECT n.RequestId requestId,n.Revision revision,n.Status status FROM paws.SwapNotification n JOIN paws.SwapRequest r ON r.RequestId=n.RequestId AND r.Revision=n.Revision WHERE n.TargetUid=@ActorFirebaseUid AND n.Status=N'pending' AND r.Status=N'pending' FOR JSON PATH)) notifications FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
END;
GO
COMMIT;
GO
