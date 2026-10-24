/* P2A DOE Faculty Target domain foundation.
   This creates empty domain tables only. ContractTeachingDoe has no default;
   no contract values, policy rows, permissions, triggers, or writes are added.
*/
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF SCHEMA_ID(N'paws') IS NULL
        THROW 51401, 'The paws schema must exist before P2A.', 1;
    IF OBJECT_ID(N'paws.DoePolicyVersion', N'U') IS NOT NULL
        THROW 51402, 'paws.DoePolicyVersion already exists; refusing to replace it.', 1;
    IF OBJECT_ID(N'paws.DoeFacultyTarget', N'U') IS NOT NULL
        THROW 51403, 'paws.DoeFacultyTarget already exists; refusing to replace it.', 1;

    CREATE TABLE paws.DoePolicyVersion (
        PolicyVersionId uniqueidentifier NOT NULL CONSTRAINT PK_DoePolicyVersion PRIMARY KEY,
        AcademicYear nvarchar(32) NOT NULL,
        VersionLabel nvarchar(64) NOT NULL,
        SourceReference nvarchar(512) NOT NULL,
        Active bit NOT NULL CONSTRAINT DF_DoePolicyVersion_Active DEFAULT (1),
        CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoePolicyVersion_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoePolicyVersion_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_DoePolicyVersion_IdAcademicYear UNIQUE (PolicyVersionId, AcademicYear),
        CONSTRAINT UQ_DoePolicyVersion_YearVersion UNIQUE (AcademicYear, VersionLabel),
        CONSTRAINT CK_DoePolicyVersion_AcademicYear CHECK (
            AcademicYear LIKE '[1-9][0-9][0-9][0-9]-[0-9][0-9]'
            AND TRY_CONVERT(int, LEFT(AcademicYear, 4)) IS NOT NULL
            AND TRY_CONVERT(int, RIGHT(AcademicYear, 2)) =
                (TRY_CONVERT(int, LEFT(AcademicYear, 4)) + 1) % 100
        ),
        CONSTRAINT CK_DoePolicyVersion_VersionLabel CHECK (LEN(LTRIM(RTRIM(VersionLabel))) > 0),
        CONSTRAINT CK_DoePolicyVersion_SourceReference CHECK (LEN(LTRIM(RTRIM(SourceReference))) > 0)
    );

    CREATE TABLE paws.DoeFacultyTarget (
        DoeFacultyTargetId uniqueidentifier NOT NULL CONSTRAINT PK_DoeFacultyTarget PRIMARY KEY,
        FacultyId uniqueidentifier NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        ContractTeachingDoe decimal(12,6) NULL,
        OverrideDoe decimal(12,6) NULL,
        OverrideReason nvarchar(1000) NULL,
        OverrideNotes nvarchar(2000) NULL,
        EffectiveTargetDoe AS COALESCE(OverrideDoe, ContractTeachingDoe) PERSISTED,
        Source nvarchar(512) NULL,
        PolicyVersionId uniqueidentifier NULL,
        Active bit NOT NULL CONSTRAINT DF_DoeFacultyTarget_Active DEFAULT (1),
        UpdatedBy nvarchar(128) NULL,
        CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoeFacultyTarget_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoeFacultyTarget_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_DoeFacultyTarget_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId),
        CONSTRAINT FK_DoeFacultyTarget_PolicyYear FOREIGN KEY (PolicyVersionId, AcademicYear)
            REFERENCES paws.DoePolicyVersion(PolicyVersionId, AcademicYear),
        CONSTRAINT CK_DoeFacultyTarget_AcademicYear CHECK (
            AcademicYear LIKE '[1-9][0-9][0-9][0-9]-[0-9][0-9]'
            AND TRY_CONVERT(int, LEFT(AcademicYear, 4)) IS NOT NULL
            AND TRY_CONVERT(int, RIGHT(AcademicYear, 2)) =
                (TRY_CONVERT(int, LEFT(AcademicYear, 4)) + 1) % 100
        ),
        CONSTRAINT CK_DoeFacultyTarget_OverrideReason CHECK (
            (OverrideDoe IS NULL
                AND NULLIF(LTRIM(RTRIM(OverrideReason)), N'') IS NULL
                AND NULLIF(LTRIM(RTRIM(OverrideNotes)), N'') IS NULL)
            OR
            (OverrideDoe IS NOT NULL
                AND NULLIF(LTRIM(RTRIM(OverrideReason)), N'') IS NOT NULL)
        )
    );

    CREATE UNIQUE INDEX UX_DoeFacultyTarget_FacultyYearActive
        ON paws.DoeFacultyTarget(FacultyId, AcademicYear)
        WHERE Active = 1;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
