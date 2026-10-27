:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53000,'Migration 059 requires VetMed-Ops.',1;
IF OBJECT_ID(N'paws_api.GetSessionSwap',N'P') IS NULL OR OBJECT_ID(N'paws_api.GetSessionSwapQueue',N'P') IS NULL OR OBJECT_ID(N'paws.SwapRevision',N'U') IS NULL THROW 53000,'Migration 059 requires the accepted SWAP foundation.',1;
-- Exact known definitions; refuse an unrelated or later read implementation.
IF EXISTS(SELECT 1 FROM (VALUES (N'GetSessionSwap','A935A6DB98628424689806B4EFCBF7C6DF39A02048ED22EAC9053A49E0B233FC','95870DDC317304C6C8A43C643D5BE58F7D91746ECE893C85FDAE58C891960510'),(N'GetSessionSwapQueue','C9156F1B9F3BB6F128D5155AD7E2EBFCFD7B49302D897324A2FA98DA03D6FD7B','4973E39E9FFF274E5C7B454EF1AD9C646996C80F0010078CF137C38395281F03')) v(objectName,baselineHash,candidateHash)
LEFT JOIN sys.procedures p ON p.schema_id=SCHEMA_ID(N'paws_api') AND p.name=v.objectName
LEFT JOIN sys.sql_modules m ON m.object_id=p.object_id
WHERE m.definition IS NULL OR CHARINDEX(N'PROCEDURE',m.definition)=0 OR
CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),TRIM(CHAR(9)+CHAR(10)+CHAR(13)+CHAR(32) FROM STUFF(REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)),1,CHARINDEX(N'PROCEDURE',m.definition)-1,N'CREATE ')))),2) NOT IN(v.baselineHash,v.candidateHash))
THROW 53059,'059 refuses an unknown read-procedure definition.',1;
BEGIN TRANSACTION;
GO
CREATE OR ALTER PROCEDURE paws_api.GetSessionSwap @RequestId uniqueidentifier,@ActorFirebaseUid nvarchar(128) AS
BEGIN
 -- PAWS_SWAP_APPROVAL_READ_059: presentation only; no request/decision writes.
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM paws.UserProfile WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0) THROW 53003,'Active SQL profile required.',1;
 DECLARE @Session uniqueidentifier,@Revision int,@Stage nvarchar(16),@Status nvarchar(32),@Creator nvarchar(128),@CanRevise bit=0,@CanDecide bit=0,@NormalDecision bit=0;
 SELECT @Session=SessionId,@Revision=Revision,@Stage=NextStage,@Status=Status,@Creator=CreatorUid FROM paws.SwapRequest WHERE RequestId=@RequestId;
 IF @Session IS NULL THROW 53004,'SWAP request not found.',1;
 IF @Creator<>@ActorFirebaseUid AND paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'read')<>1 AND NOT EXISTS(SELECT 1 FROM paws.SwapNotification WHERE RequestId=@RequestId AND Revision=@Revision AND TargetUid=@ActorFirebaseUid) THROW 53003,'Request is outside your SWAP scope.',1;
 IF @Status IN(N'pending',N'changes_requested') AND (@Creator=@ActorFirebaseUid OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'visc')=1 OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'adfa')=1 OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'adc')=1 OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'lab')=1) SET @CanRevise=1;
 IF @Status=N'pending' AND ((@Stage<>N'target' AND paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,@Stage)=1) OR (@Stage=N'target' AND EXISTS(SELECT 1 FROM paws.SwapNotification n JOIN paws.UserProfile u ON u.FirebaseUid=n.TargetUid AND u.Active=1 AND u.MustChangePassword=0 JOIN paws.SwapRequest r ON r.RequestId=n.RequestId AND r.TargetFacultyId=u.FacultyId WHERE n.RequestId=@RequestId AND n.Revision=@Revision AND n.TargetUid=@ActorFirebaseUid AND n.Status=N'pending'))) SET @NormalDecision=1;
 IF @NormalDecision=1 OR (@Status=N'pending' AND @Stage<>N'target' AND paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'override')=1) SET @CanDecide=1;
 DECLARE @Editable nvarchar(max)=N'[]',@Field nvarchar(128),@Type nvarchar(128);SELECT @Type=SessionType FROM paws.Session WHERE SessionId=@Session;
 DECLARE fieldsCursor CURSOR LOCAL FAST_FORWARD FOR SELECT [key] FROM (VALUES(N'replacementCandidateKey'),(N'courseCode'),(N'date'),(N'startTime'),(N'endTime'),(N'sessionType'),(N'room'),(N'topic')) f([key]) WHERE paws_api.CanEditSessionSwapField(@Session,@ActorFirebaseUid,f.[key],@Type)=1;
 OPEN fieldsCursor;FETCH NEXT FROM fieldsCursor INTO @Field;WHILE @@FETCH_STATUS=0 BEGIN SET @Editable=JSON_MODIFY(@Editable,N'append $',@Field);FETCH NEXT FROM fieldsCursor INTO @Field;END;CLOSE fieldsCursor;DEALLOCATE fieldsCursor;
 SELECT (SELECT JSON_QUERY((SELECT r.RequestId requestId,r.SessionId sessionId,r.AssignmentId assignmentId,r.SnapshotToken snapshotToken,r.Revision revision,r.Status status,r.NextStage nextStage,JSON_QUERY(r.ChangesJson) changes,r.NotifyReplacement notifyReplacement,r.Note note,r.CreatedAtUtc createdAtUtc,r.UpdatedAtUtc updatedAtUtc,
 CAST(IIF(r.CreatorUid=@ActorFirebaseUid,1,0) AS bit) isMine,JSON_VALUE(r.SnapshotJson,'$.AcademicYear') academicYear,JSON_VALUE(r.SnapshotJson,'$.CourseCode') courseCode,JSON_VALUE(r.SnapshotJson,'$.SessionDate') date,JSON_VALUE(r.SnapshotJson,'$.Topic') topic,
 JSON_QUERY((SELECT u.DisplayName displayName,f.PreferredFirstName firstName,f.PreferredLastName lastName FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) requester,
 JSON_QUERY((SELECT f2.DisplayName displayName,f2.PreferredFirstName firstName,f2.PreferredLastName lastName FROM paws.Faculty f2 WHERE f2.FacultyId=r.TargetFacultyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) replacement,
 (SELECT COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(f2.PreferredFirstName,N' ',f2.PreferredLastName))),N''),f2.DisplayName) FROM paws.Faculty f2 WHERE f2.FacultyId=r.TargetFacultyId) replacementDisplayName,
 JSON_QUERY((SELECT r.NotifyReplacement notifyReplacement,r.NeedsAdc needsAdc,r.NeedsLab needsLab,r.NeedsVisc needsVisc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) routing,
 JSON_QUERY((SELECT JSON_VALUE(r.SnapshotJson,'$.CourseCode') courseCode,JSON_VALUE(r.SnapshotJson,'$.SessionDate') date,LEFT(JSON_VALUE(r.SnapshotJson,'$.StartTime'),5) startTime,LEFT(JSON_VALUE(r.SnapshotJson,'$.EndTime'),5) endTime,JSON_VALUE(r.SnapshotJson,'$.SessionType') sessionType,JSON_VALUE(r.SnapshotJson,'$.Topic') topic,JSON_VALUE(r.SnapshotJson,'$.Room') room,
 JSON_QUERY((SELECT sf.DisplayName displayName,sf.PreferredFirstName firstName,sf.PreferredLastName lastName FROM OPENJSON(r.SnapshotJson,'$.assignments') WITH(SessionAssignmentId uniqueidentifier,FacultyId uniqueidentifier) s JOIN paws.Faculty sf ON sf.FacultyId=s.FacultyId WHERE s.SessionAssignmentId=r.AssignmentId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) assignment FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) original
 FROM paws.SwapRequest r LEFT JOIN paws.UserProfile u ON u.FirebaseUid=r.CreatorUid LEFT JOIN paws.Faculty f ON f.FacultyId=u.FacultyId WHERE r.RequestId=@RequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) request,
 JSON_QUERY((SELECT @CanRevise canRevise,CAST(IIF(@Status IN(N'pending',N'changes_requested') AND (@Creator=@ActorFirebaseUid OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'adfa')=1),1,0) AS bit) canWithdraw,@CanDecide canDecide,paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'override') canOverride,CAST(IIF(@CanDecide=1 AND @NormalDecision=0,1,0) AS bit) requiresOverride,JSON_QUERY(N'["approve","reject","push_back"]') decisions,JSON_QUERY(@Editable) editableFields FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) capabilities,
 JSON_QUERY((SELECT d.Revision revision,d.Stage stage,d.Decision decision,d.Comment comment,d.OverrideReason overrideReason,d.CreatedAtUtc createdAtUtc,JSON_QUERY((SELECT u.DisplayName displayName,f.PreferredFirstName firstName,f.PreferredLastName lastName FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) actor FROM paws.SwapDecision d LEFT JOIN paws.UserProfile u ON u.FirebaseUid=d.ActorUid LEFT JOIN paws.Faculty f ON f.FacultyId=u.FacultyId WHERE d.RequestId=@RequestId ORDER BY d.CreatedAtUtc,d.DecisionId FOR JSON PATH,INCLUDE_NULL_VALUES)) history,
 JSON_QUERY((SELECT v.Revision revision,v.CreatedAtUtc createdAtUtc,JSON_QUERY((SELECT u.DisplayName displayName,f.PreferredFirstName firstName,f.PreferredLastName lastName FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) actor FROM paws.SwapRevision v LEFT JOIN paws.UserProfile u ON u.FirebaseUid=v.ActorUid LEFT JOIN paws.Faculty f ON f.FacultyId=u.FacultyId WHERE v.RequestId=@RequestId ORDER BY v.Revision FOR JSON PATH,INCLUDE_NULL_VALUES)) revisions,
 JSON_QUERY((SELECT Revision revision,Status status FROM paws.SwapNotification WHERE RequestId=@RequestId AND (@Creator=@ActorFirebaseUid OR TargetUid=@ActorFirebaseUid OR paws_api.CanActOnSessionSwap(@Session,@ActorFirebaseUid,N'adfa')=1) FOR JSON PATH)) notifications FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
END;
GO
CREATE OR ALTER PROCEDURE paws_api.GetSessionSwapQueue @ActorFirebaseUid nvarchar(128) AS
BEGIN
 -- PAWS_SWAP_APPROVAL_READ_059: scope remains in SQL, never a browser role claim.
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM paws.UserProfile WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0) THROW 53003,'Active SQL profile required.',1;
 SELECT (SELECT JSON_QUERY((SELECT r.RequestId requestId,r.SessionId sessionId,JSON_VALUE(r.SnapshotJson,'$.CourseCode') courseCode,JSON_VALUE(r.SnapshotJson,'$.SessionDate') date,JSON_VALUE(r.SnapshotJson,'$.AcademicYear') academicYear,JSON_VALUE(r.SnapshotJson,'$.Topic') topic,r.Revision revision,r.Status status,r.NextStage nextStage,JSON_QUERY(r.ChangesJson) changes,r.NotifyReplacement notifyReplacement,r.Note note,r.CreatedAtUtc createdAtUtc,r.UpdatedAtUtc updatedAtUtc,
 JSON_QUERY((SELECT u.DisplayName displayName,f.PreferredFirstName firstName,f.PreferredLastName lastName FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)) requester,CAST(IIF(r.CreatorUid=@ActorFirebaseUid,1,0) AS bit) isMine,
 CAST(IIF(r.Status=N'pending' AND ((r.NextStage<>N'target' AND (paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,r.NextStage)=1 OR paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,N'override')=1)) OR (r.NextStage=N'target' AND EXISTS(SELECT 1 FROM paws.SwapNotification n JOIN paws.UserProfile targetUser ON targetUser.FirebaseUid=n.TargetUid AND targetUser.FacultyId=r.TargetFacultyId AND targetUser.Active=1 AND targetUser.MustChangePassword=0 WHERE n.RequestId=r.RequestId AND n.Revision=r.Revision AND n.TargetUid=@ActorFirebaseUid AND n.Status=N'pending'))),1,0) AS bit) canDecide,
 CAST(IIF(r.Status=N'pending' AND r.NextStage<>N'target' AND paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,r.NextStage)=0 AND paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,N'override')=1,1,0) AS bit) requiresOverride
 FROM paws.SwapRequest r LEFT JOIN paws.UserProfile u ON u.FirebaseUid=r.CreatorUid LEFT JOIN paws.Faculty f ON f.FacultyId=u.FacultyId
 WHERE r.CreatorUid=@ActorFirebaseUid OR paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,N'adfa')=1 OR paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,N'visc')=1 OR paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,N'adc')=1 OR paws_api.CanActOnSessionSwap(r.SessionId,@ActorFirebaseUid,N'lab')=1 OR EXISTS(SELECT 1 FROM paws.SwapNotification n WHERE n.RequestId=r.RequestId AND n.Revision=r.Revision AND n.TargetUid=@ActorFirebaseUid)
 ORDER BY r.UpdatedAtUtc DESC,r.RequestId FOR JSON PATH,INCLUDE_NULL_VALUES)) requests,
 JSON_QUERY((SELECT n.RequestId requestId,n.Revision revision,n.Status status FROM paws.SwapNotification n JOIN paws.SwapRequest r ON r.RequestId=n.RequestId AND r.Revision=n.Revision WHERE n.TargetUid=@ActorFirebaseUid AND n.Status=N'pending' AND r.Status=N'pending' FOR JSON PATH)) notifications FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) responseJson;
END;
GO
COMMIT;
GO
