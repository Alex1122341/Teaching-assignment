:ON ERROR EXIT
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 55200,'MASTER rollback requires VetMed-Ops.',1;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM staging.MasterRefresh) OR EXISTS(SELECT 1 FROM paws.MasterRefreshReceipt) OR EXISTS(SELECT 1 FROM paws.MasterRoleSourceEvidence) OR EXISTS(SELECT 1 FROM paws.MasterRoleDefinition)
 OR EXISTS(SELECT 1 FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id=m.role_principal_id WHERE r.name=N'paws_master_refresh_operator') THROW 55208,'MASTER evidence or operator membership prevents rollback.',1;
DROP PROCEDURE paws_api.RecoverMasterRefresh;
DROP PROCEDURE paws_api.CommitMasterRefresh;
DROP PROCEDURE paws_api.PreviewMasterRefresh;
DROP PROCEDURE paws_api.AssertMasterRefreshOperator;
DROP FUNCTION paws_api.MasterRefreshSnapshot;
DROP FUNCTION paws_api.MasterDoeAggregateSafe;
DROP VIEW paws.vMasterRoleFacts;
DROP TABLE paws.MasterRefreshReceipt;
DROP TABLE staging.MasterRefresh;
DROP TABLE paws.MasterRoleSourceEvidence;
DROP TABLE paws.MasterRoleDefinition;
DROP ROLE paws_master_refresh_operator;
COMMIT;
