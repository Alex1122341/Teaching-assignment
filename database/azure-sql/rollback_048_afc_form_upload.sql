/* Removes only empty uploaded-form storage. Never delete uploaded originals to roll back. */
:ON ERROR EXIT
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 54890,'Wrong database.',1;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM paws.AfcFormDocument WITH(UPDLOCK,HOLDLOCK)) THROW 54890,'Uploaded originals must be preserved; roll back API only.',1;
IF EXISTS(SELECT 1 FROM sys.database_role_members WHERE role_principal_id=DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_form')) THROW 54890,'Inspect role members before rollback.',1;
DROP PROCEDURE paws_api.UploadAfcForm;
DROP PROCEDURE paws_api.ListAfcForms;
DROP PROCEDURE paws_api.GetAfcForm;
DROP TABLE paws.AfcFormDocument;
DROP ROLE paws_runtime_afc_form;
-- History keeps its additive audit allowlist: no evidence is removed.
COMMIT;
