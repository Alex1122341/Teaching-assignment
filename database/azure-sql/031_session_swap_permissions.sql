:ON ERROR EXIT
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 53100,'Migration031 requires VetMed-Ops.',1;
IF OBJECT_ID(N'paws_api.DecideSessionSwap',N'P') IS NULL THROW 53100,'Migration030 must precede031.',1;
BEGIN TRANSACTION;
IF DATABASE_PRINCIPAL_ID(N'paws_runtime_swap_read') IS NULL CREATE ROLE paws_runtime_swap_read AUTHORIZATION dbo;
IF DATABASE_PRINCIPAL_ID(N'paws_runtime_swap_request') IS NULL CREATE ROLE paws_runtime_swap_request AUTHORIZATION dbo;
IF DATABASE_PRINCIPAL_ID(N'paws_runtime_swap_decision') IS NULL CREATE ROLE paws_runtime_swap_decision AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::paws_api.GetSessionSwapContext TO paws_runtime_swap_read;
GRANT EXECUTE ON OBJECT::paws_api.GetSessionSwap TO paws_runtime_swap_read;
GRANT EXECUTE ON OBJECT::paws_api.GetSessionSwapQueue TO paws_runtime_swap_read;
GRANT EXECUTE ON OBJECT::paws_api.SaveSessionSwap TO paws_runtime_swap_request;
GRANT EXECUTE ON OBJECT::paws_api.WithdrawSessionSwap TO paws_runtime_swap_request;
GRANT EXECUTE ON OBJECT::paws_api.DecideSessionSwap TO paws_runtime_swap_decision;
COMMIT TRANSACTION;
-- Bind only the explicitly reviewed runtime identity as a separate operator action.
-- No table DML, schema-wide EXECUTE or application-user role changes are granted.
