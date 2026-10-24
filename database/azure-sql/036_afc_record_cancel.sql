/* Reviewed AFC cancellation foundation. Apply before the new API runtime.
   This migration grants no memberships or direct table writes. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'VetMed-Ops' THROW 53600, 'Migration 036 requires VetMed-Ops.', 1;
IF OBJECT_ID(N'paws.AfcRecord',N'U') IS NULL OR OBJECT_ID(N'paws.AfcManualRecord',N'U') IS NULL
 OR OBJECT_ID(N'paws.UserProfile',N'U') IS NULL OR OBJECT_ID(N'paws.AuditEvent',N'U') IS NULL
 OR COL_LENGTH(N'paws.AfcManualRecord',N'ManualPurpose') IS NULL
 OR DATABASE_PRINCIPAL_ID(N'paws_runtime_read') IS NULL
 THROW 53600, 'Migration 036 requires the existing AFC, audit and read-role foundation.', 1;
IF EXISTS (SELECT 1 FROM sys.schemas WHERE name IN (N'paws',N'paws_api') AND USER_NAME(principal_id) <> N'dbo')
 THROW 53600, 'AFC ownership chain must remain dbo-owned.', 1;
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id IN (OBJECT_ID(N'paws.AfcRecord'),OBJECT_ID(N'paws.AfcManualRecord'),OBJECT_ID(N'paws.UserProfile'),OBJECT_ID(N'paws.AuditEvent'),OBJECT_ID(N'paws.vAfcRecordUnified')) AND principal_id IS NOT NULL AND USER_NAME(principal_id) <> N'dbo')
 THROW 53600, 'AFC objects must retain the dbo ownership chain.', 1;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id IN (OBJECT_ID(N'paws.AfcRecord'),OBJECT_ID(N'paws.AfcManualRecord')) AND name=N'AfcVersion' AND system_type_id<>189)
 THROW 53600, 'Unexpected AFC concurrency column type.', 1;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id IN (OBJECT_ID(N'paws.AfcRecord'),OBJECT_ID(N'paws.AfcManualRecord')) AND system_type_id=189 AND name<>N'AfcVersion')
 THROW 53600, 'Review the existing AFC rowversion before adding another.', 1;
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name=N'paws_runtime_afc_cancel_write' AND (type<>N'R' OR USER_NAME(owning_principal_id)<>N'dbo'))
 THROW 53600, 'The cancellation role must be a dbo-owned role.', 1;
IF COL_LENGTH(N'paws.AfcRecord',N'AfcVersion') IS NULL ALTER TABLE paws.AfcRecord ADD AfcVersion rowversion NOT NULL;
IF COL_LENGTH(N'paws.AfcManualRecord',N'AfcVersion') IS NULL ALTER TABLE paws.AfcManualRecord ADD AfcVersion rowversion NOT NULL;
GO
CREATE OR ALTER VIEW paws.vAfcRecordUnified
AS
    SELECT
        a.AfcRecordId,
        a.FacultyId,
        a.StartDate,
        a.EndDate,
        CAST(NULL AS nvarchar(32)) AS ReasonCode,
        a.Purpose AS Purpose,
        a.Purpose AS ReasonDisplay,
        CAST(NULL AS nvarchar(1000)) AS Notes,
        a.Purpose AS LegacyPurpose,
        a.Active,
        CAST(N'import' AS nvarchar(16)) AS SourceKind,
        CAST(NULL AS datetime2(7)) AS CreatedAtUtc,
        CAST(NULL AS nvarchar(260)) AS CreatedByName,
        CONVERT(nvarchar(50), CONCAT(N'import:', CONVERT(varchar(36), a.AfcRecordId))) AS RecordKey,
        CONVERT(varchar(16), a.AfcVersion, 2) AS VersionToken
    FROM paws.AfcRecord AS a
    UNION ALL
    SELECT
        m.AfcRecordId,
        m.FacultyId,
        m.StartDate,
        m.EndDate,
        m.ReasonCode,
        COALESCE(m.ManualPurpose, CASE m.ReasonCode
            WHEN N'university_travel' THEN N'University Travel'
            WHEN N'vacation' THEN N'Vacation'
            WHEN N'rsl' THEN N'RSL'
            WHEN N'medical' THEN N'Medical'
            WHEN N'mat' THEN N'MAT'
            WHEN N'special' THEN N'Special'
            WHEN N'other' THEN N'Other'
        END) AS Purpose,
        COALESCE(m.ManualPurpose, CASE m.ReasonCode
            WHEN N'university_travel' THEN N'University Travel'
            WHEN N'vacation' THEN N'Vacation'
            WHEN N'rsl' THEN N'RSL'
            WHEN N'medical' THEN N'Medical'
            WHEN N'mat' THEN N'MAT'
            WHEN N'special' THEN N'Special'
            WHEN N'other' THEN N'Other'
        END) AS ReasonDisplay,
        m.Notes,
        CAST(NULL AS nvarchar(1000)) AS LegacyPurpose,
        m.Active,
        CAST(N'manual' AS nvarchar(16)) AS SourceKind,
        m.CreatedAtUtc,
        m.CreatedByName,
        CONVERT(nvarchar(50), CONCAT(N'manual:', CONVERT(varchar(36), m.AfcRecordId))) AS RecordKey,
        CONVERT(varchar(16), m.AfcVersion, 2) AS VersionToken
    FROM paws.AfcManualRecord AS m;
GO

CREATE OR ALTER PROCEDURE paws_api.CancelAfcRecord
 @AfcRecordId uniqueidentifier,
 @SourceKind nvarchar(64),
 @ExpectedVersion varchar(64),
 @ActorFirebaseUid nvarchar(128),
 @ActorName nvarchar(260),
 @RequestId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;
 SET XACT_ABORT ON;
 IF @AfcRecordId IS NULL OR @RequestId IS NULL OR @SourceKind COLLATE Latin1_General_100_BIN2 NOT IN (N'manual',N'import') OR @SourceKind IS NULL
  THROW 53601, 'An exact AFC record and source are required.', 1;
 IF @ExpectedVersion IS NULL OR DATALENGTH(@ExpectedVersion)<>16 OR @ExpectedVersion COLLATE Latin1_General_100_BIN2 LIKE '%[^0-9A-Fa-f]%'
  THROW 53601, 'An exact AFC version is required.', 1;
 DECLARE @ExpectedBytes binary(8)=TRY_CONVERT(binary(8),@ExpectedVersion,2), @CurrentBytes binary(8), @Active bit, @FacultyId uniqueidentifier;
 DECLARE @BeforeJson nvarchar(max), @AfterJson nvarchar(max), @TrustedName nvarchar(260);
 BEGIN TRY
  BEGIN TRANSACTION;
  SELECT @TrustedName=DisplayName FROM paws.UserProfile WITH (HOLDLOCK)
   WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0
    AND LOWER(LTRIM(RTRIM(BaseRole))) IN (N'developer',N'owner',N'administrator',N'adfa_general',N'adfa_regular',N'admin');
  IF @@ROWCOUNT=0 THROW 53602, 'Administrator permission is required.', 1;
  IF @SourceKind=N'manual'
   SELECT @CurrentBytes=AfcVersion,@Active=Active,@FacultyId=FacultyId FROM paws.AfcManualRecord WITH (UPDLOCK,HOLDLOCK) WHERE AfcRecordId=@AfcRecordId;
  ELSE
   SELECT @CurrentBytes=AfcVersion,@Active=Active,@FacultyId=FacultyId FROM paws.AfcRecord WITH (UPDLOCK,HOLDLOCK) WHERE AfcRecordId=@AfcRecordId;
  IF @CurrentBytes IS NULL THROW 53603, 'AFC record was not found.', 1;
  IF @Active=1 AND @CurrentBytes<>@ExpectedBytes THROW 53604, 'AFC record changed; refresh before cancelling.', 1;
  IF @Active=1
  BEGIN
   SET @BeforeJson=(SELECT AfcRecordId,FacultyId,StartDate,EndDate,ReasonCode,Purpose,Notes,LegacyPurpose,Active,SourceKind,VersionToken FROM paws.vAfcRecordUnified WHERE AfcRecordId=@AfcRecordId AND SourceKind=@SourceKind FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
   IF @SourceKind=N'manual'
    UPDATE paws.AfcManualRecord SET Active=0 WHERE AfcRecordId=@AfcRecordId AND AfcVersion=@ExpectedBytes AND Active=1;
   ELSE
    UPDATE paws.AfcRecord SET Active=0 WHERE AfcRecordId=@AfcRecordId AND AfcVersion=@ExpectedBytes AND Active=1;
   IF @@ROWCOUNT<>1 THROW 53604, 'AFC record changed; refresh before cancelling.', 1;
   SET @AfterJson=(SELECT AfcRecordId,FacultyId,StartDate,EndDate,ReasonCode,Purpose,Notes,LegacyPurpose,Active,SourceKind,VersionToken FROM paws.vAfcRecordUnified WHERE AfcRecordId=@AfcRecordId AND SourceKind=@SourceKind FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
   INSERT paws.AuditEvent (AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson,RequestId,ImportBatchId)
   VALUES (NEWID(),N'afc_record_cancelled',N'afc_record',CONVERT(nvarchar(36),@AfcRecordId),@ActorFirebaseUid,@TrustedName,SYSUTCDATETIME(),@BeforeJson,@AfterJson,(SELECT @SourceKind AS sourceKind FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@RequestId,NULL);
   SELECT @CurrentBytes=AfcVersion FROM paws.AfcManualRecord WHERE @SourceKind=N'manual' AND AfcRecordId=@AfcRecordId;
   IF @SourceKind=N'import' SELECT @CurrentBytes=AfcVersion FROM paws.AfcRecord WHERE AfcRecordId=@AfcRecordId;
  END;
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
 SELECT @AfcRecordId AS afcRecordId,@FacultyId AS facultyId,@SourceKind AS sourceKind,CAST(0 AS bit) AS active,CONVERT(varchar(16),@CurrentBytes,2) AS versionToken;
END;
GO
IF DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_cancel_write') IS NULL
 CREATE ROLE paws_runtime_afc_cancel_write AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::paws_api.CancelAfcRecord TO paws_runtime_afc_cancel_write;
GRANT SELECT ON OBJECT::paws.vAfcRecordUnified (VersionToken) TO paws_runtime_read;
GO
/* Release activates PAWS_AFC_CANCEL_WRITE_ENABLED only after the exact runtime
   identity receives this narrow role and rollback acceptance succeeds.
   Rollback: disable the gate and revoke the role membership. Keep row versions
   and audit/history data; never delete business records to roll back a release. */
