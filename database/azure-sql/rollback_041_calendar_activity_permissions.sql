:ON ERROR EXIT
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53800,'Unexpected database.',1;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM sys.database_role_members WHERE role_principal_id IN(DATABASE_PRINCIPAL_ID(N'paws_runtime_calendar_read'),DATABASE_PRINCIPAL_ID(N'paws_runtime_calendar_stage'),DATABASE_PRINCIPAL_ID(N'paws_runtime_calendar_commit'),DATABASE_PRINCIPAL_ID(N'paws_runtime_calendar_time'),DATABASE_PRINCIPAL_ID(N'paws_calendar_recovery_admin')))
 THROW 53808,'Calendar principals must be explicitly unbound before permission rollback.',1;
REVOKE SELECT ON OBJECT::staging.CalendarActivityImport FROM paws_runtime_read;
REVOKE SELECT ON OBJECT::staging.CalendarActivityImportItem FROM paws_runtime_read;
REVOKE SELECT ON OBJECT::paws.CalendarActivityRecoveryRow FROM paws_runtime_read;
REVOKE SELECT ON OBJECT::paws.CalendarActivityImportReceipt FROM paws_runtime_read;
REVOKE SELECT ON OBJECT::paws.CalendarActivityDayTime FROM paws_runtime_read;
DROP ROLE paws_runtime_calendar_read;
DROP ROLE paws_runtime_calendar_stage;
DROP ROLE paws_runtime_calendar_commit;
DROP ROLE paws_runtime_calendar_time;
DROP ROLE paws_calendar_recovery_admin;
COMMIT TRANSACTION;
