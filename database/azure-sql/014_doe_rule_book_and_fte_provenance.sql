/*
  PAWS milestone 014: link the existing DoeRuleSeed domain to policy versions
  and retain source provenance for explicitly imported Faculty FTE values.
  This migration adds schema only; it contains no Faculty or rule-book data.
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

    IF OBJECT_ID(N'paws.Faculty', N'U') IS NULL
        THROW 51440, 'paws.Faculty must exist before migration 014.', 1;
    IF OBJECT_ID(N'paws.DoePolicyVersion', N'U') IS NULL
        THROW 51441, 'paws.DoePolicyVersion must exist before migration 014.', 1;
    IF OBJECT_ID(N'paws.DoeRuleSeed', N'U') IS NULL
        THROW 51442, 'paws.DoeRuleSeed must exist before migration 014.', 1;

    IF COL_LENGTH(N'paws.Faculty', N'FteSourceReference') IS NULL
        ALTER TABLE paws.Faculty ADD FteSourceReference nvarchar(512) NULL;
    IF COL_LENGTH(N'paws.Faculty', N'FteSourceRow') IS NULL
        ALTER TABLE paws.Faculty ADD FteSourceRow int NULL;
    IF COL_LENGTH(N'paws.Faculty', N'FteSourceUpdatedAtUtc') IS NULL
        ALTER TABLE paws.Faculty ADD FteSourceUpdatedAtUtc datetime2(7) NULL;

    IF COL_LENGTH(N'paws.DoeRuleSeed', N'PolicyVersionId') IS NULL
        ALTER TABLE paws.DoeRuleSeed ADD PolicyVersionId uniqueidentifier NULL;

    IF NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE parent_object_id = OBJECT_ID(N'paws.DoeRuleSeed')
          AND name = N'FK_DoeRuleSeed_PolicyVersion'
    )
        EXEC sys.sp_executesql N'ALTER TABLE paws.DoeRuleSeed WITH CHECK ADD CONSTRAINT FK_DoeRuleSeed_PolicyVersion FOREIGN KEY (PolicyVersionId) REFERENCES paws.DoePolicyVersion(PolicyVersionId);';

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'paws.DoeRuleSeed')
          AND name = N'UX_DoeRuleSeed_PolicyRuleStage'
    )
        EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_DoeRuleSeed_PolicyRuleStage ON paws.DoeRuleSeed(PolicyVersionId, RuleLabel, AcademicYearOrStage) WHERE PolicyVersionId IS NOT NULL;';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
