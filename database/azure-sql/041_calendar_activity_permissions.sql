/* Empty, independent operation roles. Live binding is a separate reviewed action. */
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53800,'Calendar permissions require VetMed-Ops.',1;
IF OBJECT_ID(N'paws_api.CommitCalendarActivityImport') IS NULL OR OBJECT_ID(N'paws_api.ListCalendarActivities') IS NULL OR OBJECT_ID(N'paws.SwapCalendarActivitySnapshot') IS NULL
 THROW 53800,'Complete Calendar and SWAP migrations are required.',1;
IF DATABASE_PRINCIPAL_ID(N'paws_runtime_read') IS NULL THROW 53800,'Existing reviewed runtime read role is required.',1;
IF EXISTS(SELECT 1 FROM sys.schemas WHERE name IN(N'paws',N'paws_api',N'staging') AND USER_NAME(principal_id)<>N'dbo') THROW 53800,'The dbo ownership chain is required.',1;
IF EXISTS(SELECT 1 FROM sys.database_principals WHERE name IN(N'paws_runtime_calendar_read',N'paws_runtime_calendar_stage',N'paws_runtime_calendar_commit',N'paws_runtime_calendar_time',N'paws_calendar_recovery_admin'))
 THROW 53800,'Inspect existing Calendar roles before retrying.',1;
BEGIN TRANSACTION;
CREATE ROLE paws_runtime_calendar_read AUTHORIZATION dbo;
CREATE ROLE paws_runtime_calendar_stage AUTHORIZATION dbo;
CREATE ROLE paws_runtime_calendar_commit AUTHORIZATION dbo;
CREATE ROLE paws_runtime_calendar_time AUTHORIZATION dbo;
CREATE ROLE paws_calendar_recovery_admin AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::paws_api.ListCalendarActivities TO paws_runtime_calendar_read;
GRANT EXECUTE ON OBJECT::paws_api.StageCalendarActivityImport TO paws_runtime_calendar_stage;
GRANT EXECUTE ON OBJECT::paws_api.PreviewCalendarActivityImport TO paws_runtime_calendar_stage;
GRANT EXECUTE ON OBJECT::paws_api.GetCalendarActivityImport TO paws_runtime_calendar_stage;
GRANT EXECUTE ON OBJECT::paws_api.CommitCalendarActivityImport TO paws_runtime_calendar_commit;
GRANT EXECUTE ON OBJECT::paws_api.ResolveCalendarActivityDayTime TO paws_runtime_calendar_time;
GRANT EXECUTE ON OBJECT::paws_api.ExportCalendarActivityRecovery TO paws_calendar_recovery_admin;
GRANT EXECUTE ON OBJECT::paws_api.RecoverCalendarActivityImport TO paws_calendar_recovery_admin;
DENY SELECT ON OBJECT::staging.CalendarActivityImport TO paws_runtime_read;
DENY SELECT ON OBJECT::staging.CalendarActivityImportItem TO paws_runtime_read;
DENY SELECT ON OBJECT::paws.CalendarActivityRecoveryRow TO paws_runtime_read;
DENY SELECT ON OBJECT::paws.CalendarActivityImportReceipt TO paws_runtime_read;
DENY SELECT ON OBJECT::paws.CalendarActivityDayTime TO paws_runtime_read;
COMMIT TRANSACTION;
