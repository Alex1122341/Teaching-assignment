/*
  Rollback for database/azure-sql/019_session_create_and_assignment_api.sql.

  This removes only the new P1 API objects. It intentionally refuses rollback
  once the procedures have created any application data or provenance rows.
  No session, assignment, audit, or ImportBatch data is deleted here.
*/
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 51910, 'Rollback 019 must run in VetMed-Ops.', 1;
IF OBJECT_ID(N'paws_api.SessionBatchRequest', N'U') IS NULL
    THROW 51911, 'Rollback 019 requires its migration-created receipt table; inspect manually.', 1;
GO

IF EXISTS (
       SELECT 1 FROM staging.ImportBatch
       WHERE ImporterVersion IN (N'paws-api-p1-019', N'paws-api-p1-019-batch', N'paws-api-p1-019-assignments')
   )
    THROW 51912, 'Rollback 019 refused because P1 session writes or idempotency receipts exist; preserve data and use a forward repair.', 1;
IF OBJECT_ID(N'paws_api.SessionBatchRequest', N'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM paws_api.SessionBatchRequest)
    THROW 51912, 'Rollback 019 refused because P1 idempotency receipts exist; preserve data and use a forward repair.', 1;
GO

BEGIN TRANSACTION;
IF OBJECT_ID(N'paws_api.ReplaceCalendarSessionAssignments', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.ReplaceCalendarSessionAssignments;
IF OBJECT_ID(N'paws_api.CreateCalendarSessionBatch', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.CreateCalendarSessionBatch;
IF OBJECT_ID(N'paws_api.CreateCalendarSession', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.CreateCalendarSession;
IF OBJECT_ID(N'paws_api.ValidateCalendarSessionJson', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.ValidateCalendarSessionJson;
IF OBJECT_ID(N'paws_api.SessionBatchRequest', N'U') IS NOT NULL
    DROP TABLE paws_api.SessionBatchRequest;
COMMIT TRANSACTION;
PRINT 'ROLLBACK_019_SESSION_CREATE_AND_ASSIGNMENT_OK';
GO
