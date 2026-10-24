SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  P3B1 rollback. Refuses to remove populated workflow data.
  No business rows are deleted.
*/

IF OBJECT_ID(N'paws.AfcApproval', N'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM paws.AfcApproval)
    THROW 51540, 'P3B1 rollback refuses to drop populated paws.AfcApproval.', 1;

IF OBJECT_ID(N'paws.AfcRequest', N'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM paws.AfcRequest)
    THROW 51541, 'P3B1 rollback refuses to drop populated paws.AfcRequest.', 1;
GO

IF OBJECT_ID(N'paws_api.WithdrawAfcRequest', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.WithdrawAfcRequest;
IF OBJECT_ID(N'paws_api.SubmitAfcRequest', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.SubmitAfcRequest;
GO

IF OBJECT_ID(N'paws.AfcApproval', N'U') IS NOT NULL
    DROP TABLE paws.AfcApproval;
IF OBJECT_ID(N'paws.AfcRequest', N'U') IS NOT NULL
    DROP TABLE paws.AfcRequest;
GO
