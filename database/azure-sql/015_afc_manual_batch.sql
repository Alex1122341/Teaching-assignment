/*
  PAWS AFC multi-input foundation.
  Adds exact manual Purpose storage, request-level idempotency evidence and an
  atomic, administrator-gated API procedure. Imported AfcRecord rows and the
  existing single-entry CreateAfcRecord contract remain unchanged.
  The exact existing API runtime database user must be supplied as the
  sqlcmd variable PAWS_API_PRINCIPAL after it has been identified.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

IF NULLIF(N'$(PAWS_API_PRINCIPAL)', N'') IS NULL
    THROW 51519, 'Supply the exact existing PAWS SQL runtime database user as PAWS_API_PRINCIPAL.', 1;
DECLARE @RuntimePrincipalName sysname = N'$(PAWS_API_PRINCIPAL)';
DECLARE @RuntimePrincipalId int = USER_ID(@RuntimePrincipalName);
IF @RuntimePrincipalId IS NULL
    THROW 51520, 'The specified PAWS API runtime database user does not exist.', 1;
IF @RuntimePrincipalName COLLATE Latin1_General_100_BIN2 <> N'UC\sa-xinyu.zhu1' COLLATE Latin1_General_100_BIN2
    THROW 51521, 'PAWS_API_PRINCIPAL must be the verified temporary Beta runtime principal.', 1;
IF EXISTS (SELECT 1 FROM sys.schemas WHERE principal_id = @RuntimePrincipalId)
    OR EXISTS (SELECT 1 FROM sys.objects WHERE principal_id = @RuntimePrincipalId)
    THROW 51522, 'The PAWS API runtime database user must not own schemas or objects.', 1;

-- TEMPORARY BETA SECURITY DEBT: UC\sa-xinyu.zhu1 currently has pre-existing
-- db_owner membership. This migration does not add or remove role membership.
IF EXISTS (
    SELECT 1
    FROM sys.database_role_members drm
    INNER JOIN sys.database_principals role_principal
        ON role_principal.principal_id = drm.role_principal_id
    WHERE drm.member_principal_id = @RuntimePrincipalId
      AND role_principal.name = N'db_owner'
)
    PRINT N'TEMPORARY BETA SECURITY DEBT: verified runtime principal remains in pre-existing db_owner; migration will not change roles.';

BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'paws.AfcManualRecord', N'U') IS NULL
        THROW 51500, 'paws.AfcManualRecord must exist before migration 015.', 1;
    IF OBJECT_ID(N'paws.AuditEvent', N'U') IS NULL
        THROW 51501, 'paws.AuditEvent must exist before migration 015.', 1;
    IF OBJECT_ID(N'paws.Faculty', N'U') IS NULL
        THROW 51502, 'paws.Faculty must exist before migration 015.', 1;

    IF COL_LENGTH(N'paws.AfcManualRecord', N'ManualPurpose') IS NULL
        ALTER TABLE paws.AfcManualRecord ADD ManualPurpose nvarchar(1000) NULL;
    IF COL_LENGTH(N'paws.AfcManualRecord', N'BatchRequestId') IS NULL
        ALTER TABLE paws.AfcManualRecord ADD BatchRequestId uniqueidentifier NULL;
    IF COL_LENGTH(N'paws.AfcManualRecord', N'BatchRowNumber') IS NULL
        ALTER TABLE paws.AfcManualRecord ADD BatchRowNumber int NULL;
    IF COL_LENGTH(N'paws.AfcManualRecord', N'BatchPayloadHash') IS NULL
        ALTER TABLE paws.AfcManualRecord ADD BatchPayloadHash binary(32) NULL;

    IF EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'paws.AfcManualRecord')
          AND name = N'CK_AfcManualRecord_Reason'
    )
        ALTER TABLE paws.AfcManualRecord DROP CONSTRAINT CK_AfcManualRecord_Reason;
    IF EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'paws.AfcManualRecord')
          AND name = N'CK_AfcManualRecord_Notes'
    )
        ALTER TABLE paws.AfcManualRecord DROP CONSTRAINT CK_AfcManualRecord_Notes;
    IF COL_LENGTH(N'paws.AfcManualRecord', N'ReasonCode') IS NOT NULL
        ALTER TABLE paws.AfcManualRecord ALTER COLUMN ReasonCode nvarchar(32) NULL;

    IF NOT EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'paws.AfcManualRecord')
          AND name = N'CK_AfcManualRecord_PurposeMode'
    )
        EXEC sys.sp_executesql N'
            ALTER TABLE paws.AfcManualRecord WITH CHECK ADD CONSTRAINT CK_AfcManualRecord_PurposeMode CHECK (
                (
                    ReasonCode IS NOT NULL
                    AND ManualPurpose IS NULL
                    AND ReasonCode COLLATE Latin1_General_100_BIN2 IN (
                        N''university_travel'', N''vacation'', N''rsl'', N''medical'', N''mat'', N''special'', N''other''
                    )
                    AND (
                        ReasonCode COLLATE Latin1_General_100_BIN2 NOT IN (N''special'', N''other'')
                        OR NULLIF(LTRIM(RTRIM(Notes)), N'''') IS NOT NULL
                    )
                )
                OR (
                    ReasonCode IS NULL
                    AND ManualPurpose IS NOT NULL
                    AND NULLIF(LTRIM(RTRIM(ManualPurpose)), N'''') IS NOT NULL
                    AND DATALENGTH(ManualPurpose) / 2 <= 1000
                    AND Notes IS NULL
                )
            );';

    IF NOT EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'paws.AfcManualRecord')
          AND name = N'CK_AfcManualRecord_BatchKey'
    )
        EXEC sys.sp_executesql N'
            ALTER TABLE paws.AfcManualRecord WITH CHECK ADD CONSTRAINT CK_AfcManualRecord_BatchKey CHECK (
                (BatchRequestId IS NULL AND BatchRowNumber IS NULL AND BatchPayloadHash IS NULL)
                OR (BatchRequestId IS NOT NULL AND BatchRowNumber IS NOT NULL
                    AND BatchRowNumber >= 0 AND BatchPayloadHash IS NOT NULL)
            );';

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'paws.AfcManualRecord')
          AND name = N'UX_AfcManualRecord_BatchRequestRow'
    )
        EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_AfcManualRecord_BatchRequestRow
            ON paws.AfcManualRecord(BatchRequestId, BatchRowNumber)
            WHERE BatchRequestId IS NOT NULL;';
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
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
        CONVERT(nvarchar(50), CONCAT(N'import:', CONVERT(varchar(36), a.AfcRecordId))) AS RecordKey
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
        CONVERT(nvarchar(50), CONCAT(N'manual:', CONVERT(varchar(36), m.AfcRecordId))) AS RecordKey
    FROM paws.AfcManualRecord AS m;
GO

CREATE OR ALTER PROCEDURE paws_api.CreateAfcManualBatch
    @RequestId uniqueidentifier,
    @RowsJson nvarchar(max),
    @ActorFirebaseUid nvarchar(128),
    @ActorName nvarchar(260) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @ActorFirebaseUid = NULLIF(LTRIM(RTRIM(@ActorFirebaseUid)), N'');
    SET @ActorName = NULLIF(LTRIM(RTRIM(COALESCE(@ActorName, N''))), N'');
    IF @RequestId IS NULL THROW 51510, 'RequestId is required.', 1;
    IF @ActorFirebaseUid IS NULL THROW 51511, 'ActorFirebaseUid is required.', 1;
    IF ISJSON(@RowsJson) <> 1 THROW 51512, 'RowsJson must be a JSON array.', 1;

    DECLARE @Rows TABLE (
        RowIndex int NOT NULL PRIMARY KEY,
        FacultyId uniqueidentifier NOT NULL,
        StartDate date NOT NULL,
        EndDate date NOT NULL,
        Purpose nvarchar(1000) NOT NULL,
        FacultyName nvarchar(260) NULL,
        AfcRecordId uniqueidentifier NULL
    );
    INSERT @Rows (RowIndex, FacultyId, StartDate, EndDate, Purpose)
    SELECT RowIndex, FacultyId, StartDate, EndDate, Purpose
    FROM OPENJSON(@RowsJson) WITH (
        RowIndex int N'$.rowIndex',
        FacultyId uniqueidentifier N'$.facultyId',
        StartDate date N'$.startDate',
        EndDate date N'$.endDate',
        Purpose nvarchar(1000) N'$.purpose'
    );
    DECLARE @RowCount int = (SELECT COUNT(*) FROM @Rows);
    IF @RowCount < 1 OR @RowCount > 20 THROW 51513, 'Batch must contain between 1 and 20 rows.', 1;
    IF (SELECT MIN(RowIndex) FROM @Rows) <> 0 OR (SELECT MAX(RowIndex) FROM @Rows) <> @RowCount - 1
        THROW 51514, 'Row indexes must be sequential and zero based.', 1;
    IF EXISTS (SELECT 1 FROM @Rows WHERE FacultyId IS NULL OR StartDate IS NULL OR EndDate IS NULL OR EndDate < StartDate
        OR Purpose IS NULL OR NULLIF(LTRIM(RTRIM(Purpose)), N'') IS NULL OR DATALENGTH(Purpose) / 2 > 1000)
        THROW 51515, 'A batch row failed server-side validation.', 1;
    IF EXISTS (
        SELECT 1 FROM @Rows a INNER JOIN @Rows b ON a.RowIndex < b.RowIndex
          AND a.FacultyId = b.FacultyId AND a.StartDate = b.StartDate AND a.EndDate = b.EndDate
          AND a.Purpose COLLATE Latin1_General_100_BIN2 = b.Purpose COLLATE Latin1_General_100_BIN2
          AND DATALENGTH(a.Purpose) = DATALENGTH(b.Purpose)
    )
        THROW 51516, 'The batch contains duplicate business rows.', 1;

    UPDATE r SET FacultyName = f.DisplayName
    FROM @Rows r
    INNER JOIN paws.Faculty f ON f.FacultyId = r.FacultyId AND f.Active = 1;
    IF EXISTS (SELECT 1 FROM @Rows WHERE FacultyName IS NULL)
        THROW 51517, 'An active Faculty record was not found.', 1;

    DECLARE @PayloadHash binary(32) = HASHBYTES('SHA2_256', CONVERT(varbinary(max), @RowsJson));
    DECLARE @ExistingCount int;
    DECLARE @BatchStatus nvarchar(32) = N'CREATED';
    DECLARE @Result TABLE (
        RowIndex int NOT NULL,
        AfcRecordId uniqueidentifier NULL,
        FacultyId uniqueidentifier NOT NULL,
        FacultyName nvarchar(260) NULL,
        StartDate date NOT NULL,
        EndDate date NOT NULL,
        Purpose nvarchar(1000) NOT NULL,
        RowStatus nvarchar(32) NOT NULL
    );

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @LockResult int;
        EXEC @LockResult = sys.sp_getapplock
            @Resource = N'paws.AfcManualBatch',
            @LockMode = N'Exclusive',
            @LockOwner = N'Transaction',
            @LockTimeout = 10000;
        IF @LockResult < 0 THROW 51518, 'AFC batch serialization lock could not be acquired.', 1;

        SELECT @ExistingCount = COUNT(*)
        FROM paws.AfcManualRecord WITH (UPDLOCK, HOLDLOCK)
        WHERE BatchRequestId = @RequestId;
        IF @ExistingCount > 0
        BEGIN
            IF @ExistingCount = @RowCount
               AND NOT EXISTS (SELECT 1 FROM paws.AfcManualRecord WHERE BatchRequestId = @RequestId AND BatchPayloadHash <> @PayloadHash)
            BEGIN
                SET @BatchStatus = N'ALREADY_APPLIED';
                INSERT @Result (RowIndex, AfcRecordId, FacultyId, FacultyName, StartDate, EndDate, Purpose, RowStatus)
                SELECT m.BatchRowNumber, m.AfcRecordId, m.FacultyId, f.DisplayName, m.StartDate, m.EndDate, m.ManualPurpose, N'ALREADY_APPLIED'
                FROM paws.AfcManualRecord m
                INNER JOIN paws.Faculty f ON f.FacultyId = m.FacultyId
                WHERE m.BatchRequestId = @RequestId;
                COMMIT TRANSACTION;
            END
            ELSE
            BEGIN
                SET @BatchStatus = N'CONFLICT';
                INSERT @Result (RowIndex, AfcRecordId, FacultyId, FacultyName, StartDate, EndDate, Purpose, RowStatus)
                SELECT RowIndex, NULL, FacultyId, FacultyName, StartDate, EndDate, Purpose, N'IDEMPOTENCY_CONFLICT'
                FROM @Rows;
                COMMIT TRANSACTION;
            END;
        END
        ELSE
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM @Rows r
                INNER JOIN paws.vAfcRecordUnified u
                  ON u.FacultyId = r.FacultyId AND u.StartDate = r.StartDate AND u.EndDate = r.EndDate
                 AND u.Purpose COLLATE Latin1_General_100_BIN2 = r.Purpose COLLATE Latin1_General_100_BIN2
                 AND DATALENGTH(u.Purpose) = DATALENGTH(r.Purpose)
            )
            BEGIN
                SET @BatchStatus = N'CONFLICT';
                INSERT @Result (RowIndex, AfcRecordId, FacultyId, FacultyName, StartDate, EndDate, Purpose, RowStatus)
                SELECT r.RowIndex, existing.AfcRecordId, r.FacultyId, r.FacultyName, r.StartDate, r.EndDate, r.Purpose,
                       CASE WHEN existing.AfcRecordId IS NULL THEN N'NOT_CREATED' ELSE N'ALREADY_EXISTS' END
                FROM @Rows r
                OUTER APPLY (
                    SELECT TOP (1) u.AfcRecordId
                    FROM paws.vAfcRecordUnified u
                    WHERE u.FacultyId = r.FacultyId AND u.StartDate = r.StartDate AND u.EndDate = r.EndDate
                      AND u.Purpose COLLATE Latin1_General_100_BIN2 = r.Purpose COLLATE Latin1_General_100_BIN2
                      AND DATALENGTH(u.Purpose) = DATALENGTH(r.Purpose)
                    ORDER BY u.AfcRecordId
                ) existing;
                COMMIT TRANSACTION;
            END
            ELSE
            BEGIN
                UPDATE @Rows SET AfcRecordId = NEWID();
                INSERT paws.AfcManualRecord (
                    AfcRecordId, FacultyId, StartDate, EndDate, ReasonCode, Notes,
                    ManualPurpose, BatchRequestId, BatchRowNumber, BatchPayloadHash,
                    CreatedByFirebaseUid, CreatedByName, RequestId
                )
                SELECT AfcRecordId, FacultyId, StartDate, EndDate, NULL, NULL,
                       Purpose, @RequestId, RowIndex, @PayloadHash,
                       @ActorFirebaseUid, @ActorName, @RequestId
                FROM @Rows;

                INSERT paws.AuditEvent (
                    AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid,
                    ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson,
                    RequestId, ImportBatchId
                )
                SELECT NEWID(), N'afc_record_created', N'afc_record', CONVERT(nvarchar(36), r.AfcRecordId),
                       @ActorFirebaseUid, @ActorName, SYSUTCDATETIME(), NULL,
                       (SELECT r.AfcRecordId AS afcRecordId, r.FacultyId AS facultyId,
                               r.StartDate AS startDate, r.EndDate AS endDate, r.Purpose AS purpose,
                               CAST(1 AS bit) AS active FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                       (SELECT @RequestId AS batchRequestId, r.RowIndex AS batchRowNumber,
                               @RowCount AS batchRowCount, N'multi_input' AS source
                        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                       @RequestId, NULL
                FROM @Rows r;

                INSERT @Result (RowIndex, AfcRecordId, FacultyId, FacultyName, StartDate, EndDate, Purpose, RowStatus)
                SELECT RowIndex, AfcRecordId, FacultyId, FacultyName, StartDate, EndDate, Purpose, N'NEW'
                FROM @Rows;
                COMMIT TRANSACTION;
            END;
        END;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT @BatchStatus AS batchStatus, RowIndex AS rowIndex, AfcRecordId AS afcRecordId,
           FacultyId AS facultyId, FacultyName AS facultyName,
           CONVERT(varchar(10), StartDate, 23) AS startDate,
           CONVERT(varchar(10), EndDate, 23) AS endDate,
           Purpose AS purpose, RowStatus AS rowStatus
    FROM @Result ORDER BY RowIndex;
END;
GO

-- Inspect effective permission as the verified runtime user, not as the migration caller.
-- Preserve an existing role/direct grant; only add this exact object permission when absent.
DECLARE @RuntimePrincipalName sysname = N'$(PAWS_API_PRINCIPAL)';
IF @RuntimePrincipalName COLLATE Latin1_General_100_BIN2 <> N'UC\sa-xinyu.zhu1' COLLATE Latin1_General_100_BIN2
    THROW 51521, 'PAWS_API_PRINCIPAL must be the verified temporary Beta runtime principal.', 1;
DECLARE @RuntimePrincipalId int = USER_ID(@RuntimePrincipalName);
IF @RuntimePrincipalId IS NULL
    THROW 51520, 'The specified PAWS API runtime database user does not exist.', 1;
DECLARE @BatchProcedureId int = OBJECT_ID(N'paws_api.CreateAfcManualBatch', N'P');
IF @BatchProcedureId IS NULL
    THROW 51523, 'The AFC batch procedure is missing; effective permission cannot be checked.', 1;

DECLARE @RuntimePermissionDenied bit = 0;
;WITH RuntimePrincipals AS (
    SELECT @RuntimePrincipalId AS principal_id
    UNION ALL
    SELECT drm.role_principal_id
    FROM sys.database_role_members drm
    INNER JOIN RuntimePrincipals rp ON rp.principal_id = drm.member_principal_id
)
SELECT @RuntimePermissionDenied = CONVERT(bit, CASE WHEN EXISTS (
    SELECT 1
    FROM sys.database_permissions permission_entry
    INNER JOIN RuntimePrincipals grantee ON grantee.principal_id = permission_entry.grantee_principal_id
    WHERE permission_entry.state = 'D'
      AND permission_entry.permission_name IN (N'EXECUTE', N'CONTROL')
      AND (
          (permission_entry.class = 0 AND permission_entry.major_id = 0)
          OR (permission_entry.class = 3 AND permission_entry.major_id = SCHEMA_ID(N'paws_api'))
          OR (permission_entry.class = 1 AND permission_entry.major_id = @BatchProcedureId)
      )
) THEN 1 ELSE 0 END)
OPTION (MAXRECURSION 32);
IF @RuntimePermissionDenied = 1
    THROW 51524, 'A runtime EXECUTE or CONTROL DENY exists; investigate before adding a grant.', 1;

DECLARE @RuntimeCanExecute bit = 0;
;WITH RuntimePrincipals AS (
    SELECT @RuntimePrincipalId AS principal_id
    UNION ALL
    SELECT drm.role_principal_id
    FROM sys.database_role_members drm
    INNER JOIN RuntimePrincipals rp ON rp.principal_id = drm.member_principal_id
)
SELECT @RuntimeCanExecute = CONVERT(bit, CASE
    WHEN EXISTS (
        SELECT 1
        FROM RuntimePrincipals grantee
        INNER JOIN sys.database_principals role_principal ON role_principal.principal_id = grantee.principal_id
        WHERE role_principal.name = N'db_owner'
    ) THEN 1
    WHEN EXISTS (
        SELECT 1
        FROM sys.database_permissions permission_entry
        INNER JOIN RuntimePrincipals grantee ON grantee.principal_id = permission_entry.grantee_principal_id
        WHERE permission_entry.state IN ('G', 'W')
          AND permission_entry.permission_name IN (N'EXECUTE', N'CONTROL')
          AND (
              (permission_entry.class = 0 AND permission_entry.major_id = 0)
              OR (permission_entry.class = 3 AND permission_entry.major_id = SCHEMA_ID(N'paws_api'))
              OR (permission_entry.class = 1 AND permission_entry.major_id = @BatchProcedureId)
          )
    ) THEN 1 ELSE 0 END)
OPTION (MAXRECURSION 32);

IF @RuntimeCanExecute IS NULL
    THROW 51525, 'Could not verify AFC batch EXECUTE permission for the PAWS runtime user.', 1;
IF @RuntimeCanExecute = 0
BEGIN
    GRANT EXECUTE ON OBJECT::paws_api.CreateAfcManualBatch TO [$(PAWS_API_PRINCIPAL)];
    PRINT N'Added only the required paws_api.CreateAfcManualBatch EXECUTE permission.';
END;
ELSE
    PRINT N'Existing effective AFC batch EXECUTE permission is preserved; no new grant was added.';
GO
