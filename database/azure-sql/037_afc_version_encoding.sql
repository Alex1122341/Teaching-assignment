/* Correct SQL Server timestamp/rowversion text encoding. Migration036 is retained as applied history. */
:ON ERROR EXIT
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53700,'Migration037 requires VetMed-Ops.',1;
IF COL_LENGTH(N'paws.AfcRecord',N'AfcVersion') IS NULL OR COL_LENGTH(N'paws.AfcManualRecord',N'AfcVersion') IS NULL OR OBJECT_ID(N'paws_api.CancelAfcRecord',N'P') IS NULL OR OBJECT_ID(N'paws.vAfcRecordUnified',N'V') IS NULL
 THROW 53700,'Migration037 requires the applied migration036 foundation.',1;
IF EXISTS(SELECT 1 FROM sys.schemas WHERE name IN(N'paws',N'paws_api') AND USER_NAME(principal_id)<>N'dbo') OR EXISTS(SELECT 1 FROM sys.objects WHERE object_id=OBJECT_ID(N'paws.vAfcRecordUnified') AND principal_id IS NOT NULL AND USER_NAME(principal_id)<>N'dbo')
 THROW 53700,'The unified AFC view must retain dbo ownership.',1;
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
        CONVERT(varchar(16), CONVERT(binary(8), a.AfcVersion), 2) AS VersionToken
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
        CONVERT(varchar(16), CONVERT(binary(8), m.AfcVersion), 2) AS VersionToken
    FROM paws.AfcManualRecord AS m;
GO

