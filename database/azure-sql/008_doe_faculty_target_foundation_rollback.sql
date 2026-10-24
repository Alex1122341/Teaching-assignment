/* P2A exact rollback. Refuses populated data or external dependencies. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'paws.DoeFacultyTarget', N'U') IS NOT NULL
    BEGIN
        DECLARE @TargetRows bigint = (SELECT COUNT_BIG(*) FROM paws.DoeFacultyTarget);
        IF @TargetRows <> 0
            THROW 51411, 'Rollback refused: paws.DoeFacultyTarget contains rows.', 1;
        IF EXISTS (
            SELECT 1 FROM sys.foreign_keys
            WHERE referenced_object_id = OBJECT_ID(N'paws.DoeFacultyTarget', N'U')
        )
            THROW 51412, 'Rollback refused: another object references paws.DoeFacultyTarget.', 1;
    END;

    IF OBJECT_ID(N'paws.DoePolicyVersion', N'U') IS NOT NULL
    BEGIN
        DECLARE @PolicyRows bigint = (SELECT COUNT_BIG(*) FROM paws.DoePolicyVersion);
        IF @PolicyRows <> 0
            THROW 51413, 'Rollback refused: paws.DoePolicyVersion contains rows.', 1;
        IF EXISTS (
            SELECT 1 FROM sys.foreign_keys
            WHERE referenced_object_id = OBJECT_ID(N'paws.DoePolicyVersion', N'U')
              AND parent_object_id <> OBJECT_ID(N'paws.DoeFacultyTarget', N'U')
        )
            THROW 51414, 'Rollback refused: another object references paws.DoePolicyVersion.', 1;
    END;

    IF OBJECT_ID(N'paws.DoeFacultyTarget', N'U') IS NOT NULL
        DROP TABLE paws.DoeFacultyTarget;
    IF OBJECT_ID(N'paws.DoePolicyVersion', N'U') IS NOT NULL
        DROP TABLE paws.DoePolicyVersion;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
