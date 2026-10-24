/*
  PAWS W1H — AFC request lifecycle, decision, and approved artifact roles.

  PREPARATION ONLY. Do not execute this artifact as part of W1H. It requires
  separate DBA review/authorization after the migration-016 precondition and
  runtime identity cutover plan have been accepted.

  This migration creates empty role containers and grants only the six exact
  stored-procedure EXECUTE permissions below. It does not create/map users,
  assign memberships, grant direct table DML, or enable application gates.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 51800, 'W1H role artifact is scoped to VetMed-Ops; no change was made.', 1;

IF DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_request_write') IS NOT NULL
   OR DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_decision_write') IS NOT NULL
   OR DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_artifact_write') IS NOT NULL
    THROW 51801, 'W1H roles already exist; review their memberships and permissions before proceeding.', 1;

IF OBJECT_ID(N'paws_api.SubmitAfcRequest', N'P') IS NULL
   OR OBJECT_ID(N'paws_api.WithdrawAfcRequest', N'P') IS NULL
   OR OBJECT_ID(N'paws_api.RecommendAfcRequest', N'P') IS NULL
   OR OBJECT_ID(N'paws_api.RejectAfcRequest', N'P') IS NULL
   OR OBJECT_ID(N'paws_api.ApproveAfcRequest', N'P') IS NULL
   OR OBJECT_ID(N'paws_api.CreateOrGetApprovedAfcArtifact', N'P') IS NULL
    THROW 51802, 'W1H requires all six exact paws_api procedures to exist.', 1;

BEGIN TRY
    BEGIN TRANSACTION;

    CREATE ROLE [paws_runtime_afc_request_write] AUTHORIZATION [dbo];
    CREATE ROLE [paws_runtime_afc_decision_write] AUTHORIZATION [dbo];
    CREATE ROLE [paws_runtime_afc_artifact_write] AUTHORIZATION [dbo];

    GRANT EXECUTE ON OBJECT::paws_api.SubmitAfcRequest
        TO [paws_runtime_afc_request_write];
    GRANT EXECUTE ON OBJECT::paws_api.WithdrawAfcRequest
        TO [paws_runtime_afc_request_write];

    GRANT EXECUTE ON OBJECT::paws_api.RecommendAfcRequest
        TO [paws_runtime_afc_decision_write];
    GRANT EXECUTE ON OBJECT::paws_api.RejectAfcRequest
        TO [paws_runtime_afc_decision_write];
    GRANT EXECUTE ON OBJECT::paws_api.ApproveAfcRequest
        TO [paws_runtime_afc_decision_write];

    GRANT EXECUTE ON OBJECT::paws_api.CreateOrGetApprovedAfcArtifact
        TO [paws_runtime_afc_artifact_write];

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO

/*
  Deterministic manual rollback — use only after separately verifying all
  three role containers are empty. Dropping an empty role removes its grants;
  it does not change a login/user, another role, or any procedure/data.

  IF EXISTS (
      SELECT 1 FROM sys.database_role_members
      WHERE role_principal_id IN (
          DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_request_write'),
          DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_decision_write'),
          DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_artifact_write')
      )
  ) THROW 51810, 'W1H rollback stopped: remove/review role members separately first.', 1;

  IF DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_artifact_write') IS NOT NULL
      DROP ROLE [paws_runtime_afc_artifact_write];
  IF DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_decision_write') IS NOT NULL
      DROP ROLE [paws_runtime_afc_decision_write];
  IF DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_request_write') IS NOT NULL
      DROP ROLE [paws_runtime_afc_request_write];
*/
