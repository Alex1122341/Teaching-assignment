:ON ERROR EXIT
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53800,'Unexpected database.',1;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM paws.CalendarActivityImportReceipt WITH(UPDLOCK,HOLDLOCK))
 OR EXISTS(SELECT 1 FROM paws.CalendarActivity WITH(UPDLOCK,HOLDLOCK))
 OR EXISTS(SELECT 1 FROM paws.CalendarActivityDayTime WITH(UPDLOCK,HOLDLOCK))
 THROW 53808,'Populated activity state requires narrow receipt recovery and review before schema rollback.',1;
DROP PROCEDURE IF EXISTS paws_api.RecoverCalendarActivityImport;
DROP PROCEDURE IF EXISTS paws_api.ExportCalendarActivityRecovery;
DROP PROCEDURE IF EXISTS paws_api.ResolveCalendarActivityDayTime;
DROP PROCEDURE IF EXISTS paws_api.CommitCalendarActivityImport;
DROP PROCEDURE IF EXISTS paws_api.CalendarActivityProtectedReferences;
DROP PROCEDURE IF EXISTS paws_api.AcquireCalendarActivityFacultyLocks;
COMMIT TRANSACTION;
