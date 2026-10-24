/*
  Guarded rollback for milestone 014. Refuses to discard populated source or
  policy provenance; export/reconcile those rows before a separately reviewed
  data-preserving rollback.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF COL_LENGTH(N'paws.DoeRuleSeed', N'PolicyVersionId') IS NOT NULL
       AND EXISTS (SELECT 1 FROM paws.DoeRuleSeed WHERE PolicyVersionId IS NOT NULL)
        THROW 51443, 'Rollback refused: versioned DOE rule references exist.', 1;

    IF COL_LENGTH(N'paws.Faculty', N'FteSourceReference') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM paws.Faculty
           WHERE FteSourceReference IS NOT NULL
              OR FteSourceRow IS NOT NULL
              OR FteSourceUpdatedAtUtc IS NOT NULL
       )
        THROW 51444, 'Rollback refused: Faculty FTE provenance exists.', 1;

    IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'paws.DoeRuleSeed')
          AND name = N'UX_DoeRuleSeed_PolicyRuleStage'
    )
        DROP INDEX UX_DoeRuleSeed_PolicyRuleStage ON paws.DoeRuleSeed;

    IF EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE parent_object_id = OBJECT_ID(N'paws.DoeRuleSeed')
          AND name = N'FK_DoeRuleSeed_PolicyVersion'
    )
        ALTER TABLE paws.DoeRuleSeed DROP CONSTRAINT FK_DoeRuleSeed_PolicyVersion;

    IF COL_LENGTH(N'paws.DoeRuleSeed', N'PolicyVersionId') IS NOT NULL
        ALTER TABLE paws.DoeRuleSeed DROP COLUMN PolicyVersionId;
    IF COL_LENGTH(N'paws.Faculty', N'FteSourceUpdatedAtUtc') IS NOT NULL
        ALTER TABLE paws.Faculty DROP COLUMN FteSourceUpdatedAtUtc;
    IF COL_LENGTH(N'paws.Faculty', N'FteSourceRow') IS NOT NULL
        ALTER TABLE paws.Faculty DROP COLUMN FteSourceRow;
    IF COL_LENGTH(N'paws.Faculty', N'FteSourceReference') IS NOT NULL
        ALTER TABLE paws.Faculty DROP COLUMN FteSourceReference;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
