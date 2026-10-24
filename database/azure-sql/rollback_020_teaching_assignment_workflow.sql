/*
  Roll back the P2 workflow extension only before any workflow/publication data
  exists. The additive authority foundation and staging.ImportBatch are shared
  prerequisites and intentionally remain after rollback.
*/
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 52050, 'Rollback 020 must run in VetMed-Ops.', 1;

IF OBJECT_ID(N'paws.TeachingAssignmentRevision', N'U') IS NULL
    THROW 52051, 'Migration 020 objects are not present.', 1;

IF EXISTS (SELECT 1 FROM paws.TeachingAssignmentRevision)
   OR EXISTS (SELECT 1 FROM paws.TeachingAssignmentContribution)
   OR EXISTS (SELECT 1 FROM paws.TeachingAssignmentReview)
   OR EXISTS (SELECT 1 FROM paws.TeachingAssignmentFinalization)
   OR EXISTS (SELECT 1 FROM paws.TeachingAssignmentPublicationRelease)
    THROW 52052, 'P2 workflow records exist; preserve them and roll forward instead.', 1;

IF EXISTS (SELECT 1 FROM paws.TeachingResponsibilityAssignee WHERE ExpirationDate IS NULL)
    THROW 52053, 'Open-ended responsibility assignments exist; expiration rollback would lose valid state.', 1;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    DROP TABLE paws.TeachingAssignmentPublishedInstructor;
    DROP TABLE paws.TeachingAssignmentPublishedSession;
    DROP TABLE paws.TeachingAssignmentPublicationState;
    DROP TABLE paws.TeachingAssignmentPublicationRelease;
    DROP TABLE paws.TeachingAssignmentFinalizationLine;
    DROP TABLE paws.TeachingAssignmentCurrentFinalization;
    DROP TABLE paws.TeachingAssignmentFinalization;
    DROP TABLE paws.TeachingAssignmentReview;
    DROP TABLE paws.TeachingAssignmentContribution;
    DROP TABLE paws.TeachingAssignmentRevisionInstructor;
    DROP TABLE paws.TeachingAssignmentRevisionSession;
    DROP TABLE paws.TeachingAssignmentRevision;

    ALTER TABLE paws.TeachingAssignmentPackage DROP COLUMN DueAtUtc;
    ALTER TABLE paws.TeachingResponsibilityAssignee ALTER COLUMN ExpirationDate date NOT NULL;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
