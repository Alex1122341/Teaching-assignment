/* Emergency read-feature rollback. Preserve captured history evidence. Roll API
   back FIRST: the newer draft writer depends on DoeHistoryPolicySnapshot. */
:ON ERROR EXIT
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 54700,'History rollback requires VetMed-Ops.',1;
BEGIN TRANSACTION;
DROP TRIGGER IF EXISTS paws.CaptureChangeHistoryContext;
DROP PROCEDURE IF EXISTS paws_api.ListChangeHistoryEvents;
-- Keep ChangeHistoryContext, HistoryAffectedFaculty and policy snapshot function:
-- no evidence loss and no dependency break for an in-flight writer.
COMMIT;
