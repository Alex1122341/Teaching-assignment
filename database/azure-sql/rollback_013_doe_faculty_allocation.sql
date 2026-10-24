/*
  Safe rollback for the empty DOE allocation schema only.
  Refuses to discard imported source rows; remove them through an explicit,
  reviewed data rollback before using this schema rollback.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'paws.DoeFacultyAllocation', N'U') IS NULL
        THROW 51433, 'paws.DoeFacultyAllocation does not exist.', 1;
    IF EXISTS (SELECT 1 FROM paws.DoeFacultyAllocation)
        THROW 51434, 'DOE allocations exist; refusing destructive rollback.', 1;
    DROP TABLE paws.DoeFacultyAllocation;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
