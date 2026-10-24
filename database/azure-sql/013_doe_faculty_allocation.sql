/*
  Normalized non-Teaching Faculty contract DOE allocations.
  Teaching remains canonical in DoeFacultyTarget.ContractTeachingDoe.
  This migration creates an empty table; DOE source rows are loaded only by
  the separately reviewed local import process after exact UCID dry-run.
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

    IF OBJECT_ID(N'paws.DoeFacultyAllocation', N'U') IS NOT NULL
        THROW 51430, 'paws.DoeFacultyAllocation already exists; refusing to replace it.', 1;
    IF OBJECT_ID(N'paws.DoePolicyVersion', N'U') IS NULL
        THROW 51431, 'paws.DoePolicyVersion must exist before DOE allocations.', 1;
    IF OBJECT_ID(N'paws.Faculty', N'U') IS NULL
        THROW 51432, 'paws.Faculty must exist before DOE allocations.', 1;

    CREATE TABLE paws.DoeFacultyAllocation (
        DoeFacultyAllocationId uniqueidentifier NOT NULL CONSTRAINT PK_DoeFacultyAllocation PRIMARY KEY,
        FacultyId uniqueidentifier NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        CategoryCode nvarchar(64) NOT NULL,
        AllocationDoe decimal(12,6) NOT NULL,
        SourceReference nvarchar(512) NOT NULL,
        PolicyVersionId uniqueidentifier NOT NULL,
        Active bit NOT NULL CONSTRAINT DF_DoeFacultyAllocation_Active DEFAULT (1),
        CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoeFacultyAllocation_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoeFacultyAllocation_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_DoeFacultyAllocation_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId),
        CONSTRAINT FK_DoeFacultyAllocation_PolicyYear FOREIGN KEY (PolicyVersionId, AcademicYear)
            REFERENCES paws.DoePolicyVersion(PolicyVersionId, AcademicYear),
        CONSTRAINT CK_DoeFacultyAllocation_AcademicYear CHECK (
            AcademicYear LIKE '[1-9][0-9][0-9][0-9]-[0-9][0-9]'
            AND TRY_CONVERT(int, LEFT(AcademicYear, 4)) IS NOT NULL
            AND TRY_CONVERT(int, RIGHT(AcademicYear, 2)) =
                (TRY_CONVERT(int, LEFT(AcademicYear, 4)) + 1) % 100
        ),
        CONSTRAINT CK_DoeFacultyAllocation_CategoryCode CHECK (CategoryCode IN (
            N'scholarly_activity', N'ppvm_cost_share', N'clinical_unsorted',
            N'clinical_teaching', N'clinical_activity_ppvm', N'research',
            N'contract_admin', N'service_admin', N'other', N'onboarding'
        )),
        CONSTRAINT CK_DoeFacultyAllocation_AllocationDoe CHECK (AllocationDoe >= 0 AND AllocationDoe <= 100),
        CONSTRAINT CK_DoeFacultyAllocation_SourceReference CHECK (LEN(LTRIM(RTRIM(SourceReference))) > 0)
    );

    CREATE UNIQUE INDEX UX_DoeFacultyAllocation_FacultyYearCategoryActive
        ON paws.DoeFacultyAllocation(FacultyId, AcademicYear, CategoryCode)
        WHERE Active = 1;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
