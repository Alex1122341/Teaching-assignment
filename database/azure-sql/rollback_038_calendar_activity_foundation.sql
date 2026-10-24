:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53800,'Wrong rollback database.',1;
IF EXISTS(SELECT 1 FROM paws.CalendarActivity) OR EXISTS(SELECT 1 FROM paws.CalendarActivityImportReceipt)
 OR EXISTS(SELECT 1 FROM staging.CalendarActivityImport) THROW 53808,'Populated activity/import evidence requires reviewed recovery; schema rollback is refused.',1;
BEGIN TRANSACTION;
DROP PROCEDURE IF EXISTS paws_api.ListCalendarActivities;
DROP PROCEDURE IF EXISTS paws_api.StageCalendarActivityImport;
DROP PROCEDURE IF EXISTS paws_api.PreviewCalendarActivityImport;
DROP PROCEDURE IF EXISTS paws_api.GetCalendarActivityImport;
DROP FUNCTION IF EXISTS paws_api.CalendarActivityFacultyResolution;
DROP FUNCTION IF EXISTS paws_api.CalendarActivityAdmin;
DROP FUNCTION IF EXISTS paws_api.CalendarActivityPurposeCategory;
DROP FUNCTION IF EXISTS paws_api.CalendarActivityNameKey;
DROP FUNCTION IF EXISTS paws_api.CalendarActivityTextKey;
DROP TABLE IF EXISTS paws.CalendarActivityRecoveryRow;
DROP TABLE IF EXISTS paws.CalendarActivityImportReceipt;
DROP TABLE IF EXISTS staging.CalendarActivityImportItem;
DROP TABLE IF EXISTS staging.CalendarActivityImport;
DROP TABLE IF EXISTS paws.CalendarActivityDayTime;
DROP TABLE IF EXISTS paws.CalendarActivity;
COMMIT TRANSACTION;
