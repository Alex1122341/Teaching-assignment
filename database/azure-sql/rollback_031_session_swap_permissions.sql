:ON ERROR EXIT
SET XACT_ABORT ON;
BEGIN TRANSACTION;
REVOKE EXECUTE ON OBJECT::paws_api.GetSessionSwapContext FROM paws_runtime_swap_read;
REVOKE EXECUTE ON OBJECT::paws_api.GetSessionSwap FROM paws_runtime_swap_read;
REVOKE EXECUTE ON OBJECT::paws_api.GetSessionSwapQueue FROM paws_runtime_swap_read;
REVOKE EXECUTE ON OBJECT::paws_api.SaveSessionSwap FROM paws_runtime_swap_request;
REVOKE EXECUTE ON OBJECT::paws_api.WithdrawSessionSwap FROM paws_runtime_swap_request;
REVOKE EXECUTE ON OBJECT::paws_api.DecideSessionSwap FROM paws_runtime_swap_decision;
COMMIT TRANSACTION;
-- Keep named roles and memberships recoverable; no business records are removed.
