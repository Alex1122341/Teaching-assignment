SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  P3B2 rollback.
  Refuses to remove approval behavior once any approval decision or approved/rejected
  request exists. It never deletes business rows.
*/

IF EXISTS (SELECT 1 FROM paws.AfcApproval)
    THROW 51640, 'P3B2 rollback refuses to remove populated AFC approval decisions.', 1;

IF EXISTS (
    SELECT 1
    FROM paws.AfcRequest
    WHERE Status IN (N'approved', N'rejected')
)
    THROW 51641, 'P3B2 rollback refuses to remove approved or rejected AFC workflow state.', 1;
GO

IF OBJECT_ID(N'paws_api.RecommendAfcRequest', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.RecommendAfcRequest;
IF OBJECT_ID(N'paws_api.RejectAfcRequest', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.RejectAfcRequest;
IF OBJECT_ID(N'paws_api.ApproveAfcRequest', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.ApproveAfcRequest;
GO

IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'paws.AfcRequest')
      AND name = N'IX_AfcRequest_StatusSubmitted'
)
    DROP INDEX IX_AfcRequest_StatusSubmitted ON paws.AfcRequest;
GO

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'paws.AfcApproval')
      AND name = N'CK_AfcApproval_RejectionReason'
)
    ALTER TABLE paws.AfcApproval DROP CONSTRAINT CK_AfcApproval_RejectionReason;

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'paws.AfcApproval')
      AND name = N'CK_AfcApproval_DecisionEvidence'
)
    ALTER TABLE paws.AfcApproval DROP CONSTRAINT CK_AfcApproval_DecisionEvidence;
GO

CREATE OR ALTER VIEW paws.vAfcRecordUnified
AS
    SELECT
        a.AfcRecordId,
        a.FacultyId,
        a.StartDate,
        a.EndDate,
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
        m.AfcRecordId,
        m.FacultyId,
        m.StartDate,
        m.EndDate,
        m.ReasonCode,
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
