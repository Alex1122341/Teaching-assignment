/*
  Guarded rollback for migration 015.
  It refuses to run after any exact-purpose batch row has been written so the
  only copy of submitted Purpose/idempotency data can never be discarded.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF NULLIF(N'$(PAWS_API_PRINCIPAL)', N'') IS NULL
    THROW 51530, 'Supply the exact PAWS_API_PRINCIPAL used when migration 015 was applied.', 1;
IF USER_ID(N'$(PAWS_API_PRINCIPAL)') IS NULL
    THROW 51531, 'The specified PAWS API runtime database user does not exist.', 1;
IF OBJECT_ID(N'paws.AfcManualRecord', N'U') IS NULL
    THROW 51532, 'paws.AfcManualRecord does not exist.', 1;
IF COL_LENGTH(N'paws.AfcManualRecord', N'BatchRequestId') IS NULL
    OR COL_LENGTH(N'paws.AfcManualRecord', N'ManualPurpose') IS NULL
    OR COL_LENGTH(N'paws.AfcManualRecord', N'BatchPayloadHash') IS NULL
    OR COL_LENGTH(N'paws.AfcManualRecord', N'BatchRowNumber') IS NULL
    THROW 51536, 'Migration 015 columns are incomplete or absent; rollback was not applied.', 1;
DECLARE @HasBatchData bit = 0;
EXEC sys.sp_executesql
    N'SELECT @HasData = CASE WHEN EXISTS (
          SELECT 1 FROM paws.AfcManualRecord
          WHERE BatchRequestId IS NOT NULL OR ManualPurpose IS NOT NULL
      ) THEN 1 ELSE 0 END;',
    N'@HasData bit OUTPUT',
    @HasData = @HasBatchData OUTPUT;
IF @HasBatchData = 1
    THROW 51533, 'Rollback refused because manual-purpose batch data exists. Preserve the new schema.', 1;
IF EXISTS (SELECT 1 FROM paws.AfcManualRecord WHERE ReasonCode IS NULL)
    THROW 51534, 'Rollback refused because a legacy ReasonCode is null.', 1;

IF OBJECT_ID(N'paws_api.CreateAfcManualBatch', N'P') IS NOT NULL
    EXEC(N'REVOKE EXECUTE ON OBJECT::paws_api.CreateAfcManualBatch FROM [$(PAWS_API_PRINCIPAL)];');
GO

DROP PROCEDURE IF EXISTS paws_api.CreateAfcManualBatch;
GO

CREATE OR ALTER VIEW paws.vAfcRecordUnified
AS
    SELECT
        a.AfcRecordId, a.FacultyId, a.StartDate, a.EndDate,
        CAST(NULL AS nvarchar(32)) AS ReasonCode,
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
        m.AfcRecordId, m.FacultyId, m.StartDate, m.EndDate, m.ReasonCode,
        CASE m.ReasonCode
            WHEN N'university_travel' THEN N'University Travel'
            WHEN N'vacation' THEN N'Vacation'
            WHEN N'rsl' THEN N'RSL'
            WHEN N'medical' THEN N'Medical'
            WHEN N'mat' THEN N'MAT'
            WHEN N'special' THEN N'Special'
            WHEN N'other' THEN N'Other'
        END AS ReasonDisplay,
        m.Notes,
        CAST(NULL AS nvarchar(1000)) AS LegacyPurpose,
        m.Active,
        CAST(N'manual' AS nvarchar(16)) AS SourceKind,
        m.CreatedAtUtc,
        m.CreatedByName,
        CONVERT(nvarchar(50), CONCAT(N'manual:', CONVERT(varchar(36), m.AfcRecordId))) AS RecordKey
    FROM paws.AfcManualRecord AS m;
GO

BEGIN TRY
    BEGIN TRANSACTION;
    IF EXISTS (SELECT 1 FROM paws.AfcManualRecord WHERE ReasonCode IS NULL)
        THROW 51535, 'Rollback refused because a legacy ReasonCode is null.', 1;
    IF EXISTS (SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'paws.AfcManualRecord')
          AND name = N'CK_AfcManualRecord_PurposeMode')
        ALTER TABLE paws.AfcManualRecord DROP CONSTRAINT CK_AfcManualRecord_PurposeMode;
    IF EXISTS (SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'paws.AfcManualRecord')
          AND name = N'CK_AfcManualRecord_BatchKey')
        ALTER TABLE paws.AfcManualRecord DROP CONSTRAINT CK_AfcManualRecord_BatchKey;
    IF EXISTS (SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'paws.AfcManualRecord')
          AND name = N'UX_AfcManualRecord_BatchRequestRow')
        DROP INDEX UX_AfcManualRecord_BatchRequestRow ON paws.AfcManualRecord;
    ALTER TABLE paws.AfcManualRecord ALTER COLUMN ReasonCode nvarchar(32) NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'paws.AfcManualRecord')
          AND name = N'CK_AfcManualRecord_Reason')
        ALTER TABLE paws.AfcManualRecord WITH CHECK ADD CONSTRAINT CK_AfcManualRecord_Reason CHECK (
            ReasonCode COLLATE Latin1_General_100_BIN2 IN
            (N'university_travel', N'vacation', N'rsl', N'medical', N'mat', N'special', N'other')
        );
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'paws.AfcManualRecord')
          AND name = N'CK_AfcManualRecord_Notes')
        ALTER TABLE paws.AfcManualRecord WITH CHECK ADD CONSTRAINT CK_AfcManualRecord_Notes CHECK (
            ReasonCode COLLATE Latin1_General_100_BIN2 NOT IN (N'special', N'other')
            OR NULLIF(LTRIM(RTRIM(Notes)), N'') IS NOT NULL
        );
    ALTER TABLE paws.AfcManualRecord DROP COLUMN BatchPayloadHash, BatchRowNumber, BatchRequestId, ManualPurpose;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
