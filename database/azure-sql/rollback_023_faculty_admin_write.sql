/*
  Roll back only PAWS Beta migration 023 database objects. Faculty business
  rows, relationship rows and audit history are never removed or rewritten.
*/
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 52310, 'Rollback 023 must run in VetMed-Ops.', 1;

IF DATABASE_PRINCIPAL_ID(N'paws_runtime_faculty_admin_write') IS NOT NULL
   AND (SELECT type FROM sys.database_principals WHERE principal_id=DATABASE_PRINCIPAL_ID(N'paws_runtime_faculty_admin_write')) <> 'R'
    THROW 52311, 'The Faculty admin permission principal is not a role; no change was made.', 1;

IF DATABASE_PRINCIPAL_ID(N'paws_runtime_faculty_admin_write') IS NOT NULL
   AND EXISTS (SELECT 1 FROM sys.database_role_members WHERE role_principal_id=DATABASE_PRINCIPAL_ID(N'paws_runtime_faculty_admin_write'))
    THROW 52312, 'The Faculty admin write role has members; inspect memberships before rollback.', 1;

IF DATABASE_PRINCIPAL_ID(N'paws_runtime_faculty_admin_write') IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM sys.database_permissions
        WHERE grantee_principal_id=DATABASE_PRINCIPAL_ID(N'paws_runtime_faculty_admin_write')
          AND (major_id NOT IN (OBJECT_ID(N'paws_api.UpdateFaculty'),OBJECT_ID(N'paws_api.DeactivateFaculty'),OBJECT_ID(N'paws_api.RestoreFaculty'))
               OR permission_name<>N'EXECUTE' OR state_desc<>N'GRANT')
   )
    THROW 52313, 'The Faculty admin write role has permissions outside migration 023; inspect before rollback.', 1;

BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'paws_api.UpdateFaculty',N'P') IS NOT NULL DROP PROCEDURE paws_api.UpdateFaculty;
    IF OBJECT_ID(N'paws_api.DeactivateFaculty',N'P') IS NOT NULL DROP PROCEDURE paws_api.DeactivateFaculty;
    IF OBJECT_ID(N'paws_api.RestoreFaculty',N'P') IS NOT NULL DROP PROCEDURE paws_api.RestoreFaculty;
    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_faculty_admin_write') IS NOT NULL DROP ROLE [paws_runtime_faculty_admin_write];
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO

SELECT OBJECT_ID(N'paws_api.UpdateFaculty',N'P') AS update_procedure_id,
       OBJECT_ID(N'paws_api.DeactivateFaculty',N'P') AS deactivate_procedure_id,
       OBJECT_ID(N'paws_api.RestoreFaculty',N'P') AS restore_procedure_id,
       DATABASE_PRINCIPAL_ID(N'paws_runtime_faculty_admin_write') AS permission_role_id;
GO
