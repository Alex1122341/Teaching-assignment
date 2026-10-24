:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 54900,'CCC rollback requires VetMed-Ops.',1;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM staging.CccReplacement) OR EXISTS(SELECT 1 FROM paws.CccReplacementReceipt)
 OR EXISTS(SELECT 1 FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id=m.role_principal_id WHERE r.name IN(N'paws_runtime_ccc_stage',N'paws_runtime_ccc_commit',N'paws_ccc_recovery_admin')) THROW 54908,'CCC source, recovery or role membership prevents rollback.',1;
DROP PROCEDURE paws_api.RecoverCccReplacement;
DROP PROCEDURE paws_api.CommitCccReplacement;
DROP PROCEDURE paws_api.LockCccReplacementScope;
DROP PROCEDURE paws_api.PreviewCccReplacement;
DROP PROCEDURE paws_api.StageCccReplacement;
DROP PROCEDURE paws_api.GetCccReplacement;
DROP PROCEDURE paws_api.AssertCccAdministrator;
DROP FUNCTION paws_api.CccReplacementSnapshot;
DROP FUNCTION paws_api.CccScopeSnapshot;
DROP FUNCTION paws_api.CccReplacementRows;
DROP TABLE paws.CccReplacementReceipt;
DROP TABLE staging.CccReplacement;
DROP ROLE paws_runtime_ccc_stage;
DROP ROLE paws_runtime_ccc_commit;
DROP ROLE paws_ccc_recovery_admin;
-- The additive history event allowlist is retained; it references no CCC feature objects.
COMMIT;
