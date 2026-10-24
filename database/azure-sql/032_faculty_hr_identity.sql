/* Separate source-backed HR identity from preferred UI names.
   No names are inferred or imported by this schema migration.
   Source import must use a reviewed exact canonical FacultyId crosswalk.
   Public replacement candidates must never select these private columns. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53200,'Migration 032 requires VetMed-Ops.',1;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'paws.Faculty', N'U') IS NULL
    THROW 53200, 'paws.Faculty must exist before migration 032.', 1;
  IF COL_LENGTH(N'paws.Faculty', N'HrName') IS NULL
    ALTER TABLE paws.Faculty ADD HrName nvarchar(260) NULL;
  IF COL_LENGTH(N'paws.Faculty', N'HrNameSource') IS NULL
    ALTER TABLE paws.Faculty ADD HrNameSource nvarchar(1024) NULL;
  IF DATABASE_PRINCIPAL_ID(N'paws_runtime_read') IS NULL
    THROW 53200, 'Reviewed runtime read role is required.', 1;
  EXEC(N'GRANT SELECT ON OBJECT::paws.Faculty(HrName,HrNameSource) TO paws_runtime_read;');
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
