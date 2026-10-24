:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53000,'Rollback030 requires VetMed-Ops.',1;
-- Roll back runtime to the previous release first. Never discard real requests/audits.
IF EXISTS(SELECT 1 FROM paws.SwapRequest) THROW 53000,'Real SWAP requests exist; preserve the schema and use runtime rollback.',1;
BEGIN TRANSACTION;
DROP PROCEDURE IF EXISTS paws_api.WithdrawSessionSwap;
DROP PROCEDURE IF EXISTS paws_api.DecideSessionSwap;
DROP PROCEDURE IF EXISTS paws_api.SaveSessionSwap;
DROP PROCEDURE IF EXISTS paws_api.GetSessionSwapQueue;
DROP PROCEDURE IF EXISTS paws_api.GetSessionSwap;
DROP PROCEDURE IF EXISTS paws_api.GetSessionSwapContext;
DROP FUNCTION IF EXISTS paws_api.CanEditSessionSwapField;
DROP FUNCTION IF EXISTS paws_api.CanActOnSessionSwap;
DROP FUNCTION IF EXISTS paws_api.SessionSwapSnapshot;
DROP TABLE IF EXISTS paws.SwapNotification;
DROP TABLE IF EXISTS paws.SwapDecision;
DROP TABLE IF EXISTS paws.SwapRevision;
DROP TABLE IF EXISTS paws.SwapRequest;
DROP TABLE IF EXISTS paws.SwapCandidate;
COMMIT TRANSACTION;
