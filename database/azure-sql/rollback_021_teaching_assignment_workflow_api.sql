/* Removes migration 021's code objects only; no workflow data is touched. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'VetMed-Ops' THROW 52190, 'Rollback 021 must run in VetMed-Ops.', 1;
IF OBJECT_ID(N'paws.TeachingAssignmentRevision', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentPublicationState', N'U') IS NULL
    THROW 52191, 'Rollback 021 requires migration 020.', 1;
BEGIN TRANSACTION;
GO
DROP PROCEDURE IF EXISTS paws_api.PublishTeachingAssignmentRelease;
DROP PROCEDURE IF EXISTS paws_api.SaveTeachingAssignmentFinalization;
DROP PROCEDURE IF EXISTS paws_api.FinalSubmitTeachingAssignment;
DROP PROCEDURE IF EXISTS paws_api.RecordTeachingAssignmentReview;
DROP PROCEDURE IF EXISTS paws_api.SubmitTeachingAssignmentRevision;
DROP PROCEDURE IF EXISTS paws_api.SaveTeachingAssignmentDraft;
DROP FUNCTION IF EXISTS paws_api.CanActOnTeachingAssignmentPackage;
COMMIT TRANSACTION;
GO
