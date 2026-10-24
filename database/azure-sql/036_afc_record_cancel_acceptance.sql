/* Run on a staging/accepted SQL database after migrations 036 and 037. Every fixture
   and cancellation is rolled back, including audit rows. Never COMMIT this script. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53610,'AFC acceptance requires VetMed-Ops.',1;
DECLARE @Actor nvarchar(128)=(SELECT TOP (1) FirebaseUid FROM paws.UserProfile WHERE Active=1 AND MustChangePassword=0 AND BaseRole IN (N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin'));
DECLARE @Faculty uniqueidentifier=(SELECT TOP (1) FacultyId FROM paws.Faculty WHERE Active=1);
IF @Actor IS NULL OR @Faculty IS NULL THROW 53610,'Acceptance requires existing authorized actor and Faculty.',1;
DECLARE @Id uniqueidentifier=NEWID(),@Request uniqueidentifier=NEWID(),@Version varchar(16),@Retry uniqueidentifier=NEWID();
BEGIN TRY
 BEGIN TRANSACTION;
 EXEC paws_api.CreateAfcRecord @AfcRecordId=@Id,@FacultyId=@Faculty,@StartDate='2099-11-05',@EndDate='2099-11-06',@ReasonCode=N'vacation',@Notes=N'Rollback-only acceptance fixture',@ActorFirebaseUid=@Actor,@ActorName=N'Acceptance',@RequestId=@Request;
 SELECT @Version=VersionToken FROM paws.vAfcRecordUnified WHERE AfcRecordId=@Id AND SourceKind=N'manual';
 EXEC paws_api.CancelAfcRecord @AfcRecordId=@Id,@SourceKind=N'manual',@ExpectedVersion=@Version,@ActorFirebaseUid=@Actor,@ActorName=N'Untrusted client name',@RequestId=@Retry;
 EXEC paws_api.CancelAfcRecord @AfcRecordId=@Id,@SourceKind=N'manual',@ExpectedVersion=@Version,@ActorFirebaseUid=@Actor,@ActorName=N'Untrusted client name',@RequestId=@Retry;
 IF NOT EXISTS(SELECT 1 FROM paws.vAfcRecordUnified WHERE AfcRecordId=@Id AND SourceKind=N'manual' AND Active=0 AND StartDate='2099-11-05' AND EndDate='2099-11-06') THROW 53611,'Cancelled manual history was not retained.',1;
 IF (SELECT COUNT(*) FROM paws.AuditEvent WHERE EntityId=CONVERT(nvarchar(36),@Id) AND EventType=N'afc_record_cancelled')<>1 THROW 53611,'Cancellation retry duplicated its audit.',1;
 IF NOT EXISTS(SELECT 1 FROM paws.AuditEvent WHERE EntityId=CONVERT(nvarchar(36),@Id) AND EventType=N'afc_record_cancelled' AND ISJSON(BeforeJson)=1 AND ISJSON(AfterJson)=1 AND ActorName<>N'Untrusted client name') THROW 53611,'Trusted audit snapshots were not captured.',1;
 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
IF EXISTS(SELECT 1 FROM paws.AfcManualRecord WHERE AfcRecordId=@Id) THROW 53611,'Rollback acceptance left its fixture behind.',1;
PRINT 'AFC_CANCEL_ROLLBACK_ACCEPTANCE_OK';
