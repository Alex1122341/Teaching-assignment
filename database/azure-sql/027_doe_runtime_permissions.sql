/*
  P4: column/table-scoped runtime access for the University DOE API.
  Run after guarded schema migration 026 on VetMed-Ops only. Roles remain
  empty; deployment governance owns any runtime identity membership binding.
*/
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 52600, 'Migration 027 must run in VetMed-Ops.', 1;

IF OBJECT_ID(N'paws.DoePolicyRule', N'U') IS NULL
   OR OBJECT_ID(N'paws.DoeAssignmentFact', N'U') IS NULL
   OR OBJECT_ID(N'paws.DoeCalculationRecord', N'U') IS NULL
   OR DATABASE_PRINCIPAL_ID(N'paws_runtime_read') IS NULL
    THROW 52601, 'Migration 027 requires migration 026 and the accepted runtime read role.', 1;

IF EXISTS (
    SELECT 1 FROM sys.database_principals
    WHERE name IN (N'paws_runtime_doe_admin_write', N'paws_runtime_doe_policy_publish', N'paws_runtime_doe_recalculate')
      AND type <> 'R'
)
    THROW 52602, 'A DOE runtime role name is occupied by a non-role principal.', 1;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_doe_admin_write') IS NULL EXEC(N'CREATE ROLE [paws_runtime_doe_admin_write] AUTHORIZATION [dbo];');
    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_doe_policy_publish') IS NULL EXEC(N'CREATE ROLE [paws_runtime_doe_policy_publish] AUTHORIZATION [dbo];');
    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_doe_recalculate') IS NULL EXEC(N'CREATE ROLE [paws_runtime_doe_recalculate] AUTHORIZATION [dbo];');

    IF EXISTS (
        SELECT 1 FROM sys.database_role_members m
        JOIN sys.database_principals r ON r.principal_id=m.role_principal_id
        WHERE r.name IN (N'paws_runtime_doe_admin_write', N'paws_runtime_doe_policy_publish', N'paws_runtime_doe_recalculate')
    )
        THROW 52603, 'P4 DOE write roles must remain empty until separately governed runtime binding.', 1;

    GRANT SELECT ON OBJECT::paws.DoePolicyRule TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeRuleSelector TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeRuleParameter TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeRuleTier TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeRuleInput TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeReferenceSource TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeCourseMapping TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeSubjectMapping TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoePolicyException TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeCalculationRecord TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeAssignmentFact TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeAssignmentFactInput TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeImpactRun TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeImpactRunRow TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeAuditEvent TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoePolicyPublication TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeFacultyTarget TO [paws_runtime_read];

    GRANT INSERT ON OBJECT::paws.DoePolicyVersion TO [paws_runtime_doe_admin_write];
    GRANT UPDATE (VersionLabel, SourceReference, Revision, UpdatedBy, UpdatedAtUtc, ValidatedRevision, ValidatedChecksum, ImpactRevision, ImpactChecksum)
        ON OBJECT::paws.DoePolicyVersion TO [paws_runtime_doe_admin_write];
    GRANT INSERT, UPDATE, DELETE ON OBJECT::paws.DoePolicyRule TO [paws_runtime_doe_admin_write];
    GRANT INSERT, UPDATE, DELETE ON OBJECT::paws.DoeRuleSelector TO [paws_runtime_doe_admin_write];
    GRANT INSERT, UPDATE, DELETE ON OBJECT::paws.DoeRuleParameter TO [paws_runtime_doe_admin_write];
    GRANT INSERT, UPDATE, DELETE ON OBJECT::paws.DoeRuleTier TO [paws_runtime_doe_admin_write];
    GRANT INSERT, UPDATE, DELETE ON OBJECT::paws.DoeRuleInput TO [paws_runtime_doe_admin_write];
    GRANT INSERT, UPDATE, DELETE ON OBJECT::paws.DoeReferenceSource TO [paws_runtime_doe_admin_write];
    GRANT INSERT, UPDATE, DELETE ON OBJECT::paws.DoeCourseMapping TO [paws_runtime_doe_admin_write];
    GRANT INSERT, UPDATE, DELETE ON OBJECT::paws.DoeSubjectMapping TO [paws_runtime_doe_admin_write];
    GRANT INSERT, UPDATE, DELETE ON OBJECT::paws.DoePolicyException TO [paws_runtime_doe_admin_write];
    GRANT INSERT ON OBJECT::paws.DoeAssignmentFact TO [paws_runtime_doe_admin_write];
    GRANT UPDATE (Category, RoleType, ActivityType, ScopeText, CourseCode, SubjectKey, SessionId, Notes, Active, Revision, CurrentCalculationId, UpdatedBy, UpdatedAtUtc)
        ON OBJECT::paws.DoeAssignmentFact TO [paws_runtime_doe_admin_write];
    GRANT INSERT, DELETE ON OBJECT::paws.DoeAssignmentFactInput TO [paws_runtime_doe_admin_write];
    GRANT INSERT ON OBJECT::paws.DoeCalculationRecord TO [paws_runtime_doe_admin_write];
    GRANT INSERT ON OBJECT::paws.DoeAuditEvent TO [paws_runtime_doe_admin_write];
    GRANT INSERT ON OBJECT::paws.DoeImpactRun TO [paws_runtime_doe_admin_write];
    GRANT INSERT ON OBJECT::paws.DoeImpactRunRow TO [paws_runtime_doe_admin_write];
    GRANT UPDATE ON OBJECT::paws.DoeFacultyTarget TO [paws_runtime_doe_admin_write];

    GRANT UPDATE (Status, Active, Revision, UpdatedBy, UpdatedAtUtc)
        ON OBJECT::paws.DoePolicyVersion TO [paws_runtime_doe_policy_publish];
    GRANT INSERT ON OBJECT::paws.DoePolicyPublication TO [paws_runtime_doe_policy_publish];
    GRANT INSERT ON OBJECT::paws.DoeAuditEvent TO [paws_runtime_doe_policy_publish];

    GRANT INSERT ON OBJECT::paws.DoeCalculationRecord TO [paws_runtime_doe_recalculate];
    GRANT UPDATE (CurrentCalculationId, Revision, UpdatedBy, UpdatedAtUtc)
        ON OBJECT::paws.DoeAssignmentFact TO [paws_runtime_doe_recalculate];
    GRANT INSERT ON OBJECT::paws.DoeAuditEvent TO [paws_runtime_doe_recalculate];

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO

SELECT DB_NAME() AS DatabaseName,
       CASE WHEN DATABASE_PRINCIPAL_ID(N'paws_runtime_doe_admin_write') IS NOT NULL THEN 1 ELSE 0 END AS DoeAdminRolePresent,
       CASE WHEN DATABASE_PRINCIPAL_ID(N'paws_runtime_doe_policy_publish') IS NOT NULL THEN 1 ELSE 0 END AS DoePolicyPublishRolePresent,
       CASE WHEN DATABASE_PRINCIPAL_ID(N'paws_runtime_doe_recalculate') IS NOT NULL THEN 1 ELSE 0 END AS DoeRecalculateRolePresent,
       (SELECT COUNT_BIG(*) FROM sys.database_role_members AS m
          INNER JOIN sys.database_principals AS r ON r.principal_id=m.role_principal_id
         WHERE r.name IN (N'paws_runtime_doe_admin_write',N'paws_runtime_doe_policy_publish',N'paws_runtime_doe_recalculate')) AS DoeWriteRoleMemberCount;
GO
