SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  P3B4 branch-only rollback.
  Never removes persisted AFC PDF evidence. It drops only P3B4 procedures and
  paws.AfcArtifact after proving the artifact table is empty.
*/

IF OBJECT_ID(N'paws.AfcArtifact', N'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM paws.AfcArtifact)
    THROW 51740, 'P3B4 rollback refuses to drop paws.AfcArtifact while artifact rows exist.', 1;

IF OBJECT_ID(N'paws_api.GetApprovedAfcArtifactSource', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.GetApprovedAfcArtifactSource;
IF OBJECT_ID(N'paws_api.CreateOrGetApprovedAfcArtifact', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.CreateOrGetApprovedAfcArtifact;
IF OBJECT_ID(N'paws_api.GetApprovedAfcArtifact', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.GetApprovedAfcArtifact;

IF OBJECT_ID(N'paws.AfcArtifact', N'U') IS NOT NULL
    DROP TABLE paws.AfcArtifact;
