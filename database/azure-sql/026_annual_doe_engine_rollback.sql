/*
  Guarded P4 rollback. Refuses to remove any DOE evidence or any policy version
  edited/created after 026. It only restores the pre-P4 schema when all new
  domain tables are empty and the evolved policy metadata is still pristine.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'paws.DoePolicyVersion', N'U') IS NULL
        THROW 52550, 'P4 rollback requires paws.DoePolicyVersion.', 1;

    IF EXISTS (SELECT 1 FROM paws.DoePolicyVersion
               WHERE Status <> CASE WHEN Active=1 THEN N'active' ELSE N'archived' END
                  OR Revision <> 0 OR UpdatedBy IS NOT NULL
                  OR ValidatedRevision IS NOT NULL OR ValidatedChecksum IS NOT NULL
                  OR ImpactRevision IS NOT NULL OR ImpactChecksum IS NOT NULL)
        THROW 52551, 'P4 rollback refused: a policy version has P4 edits or lifecycle state.', 1;

    IF EXISTS (SELECT 1 FROM paws.DoePolicyPublication)
       OR EXISTS (SELECT 1 FROM paws.DoeImpactRunRow)
       OR EXISTS (SELECT 1 FROM paws.DoeImpactRun)
       OR EXISTS (SELECT 1 FROM paws.DoeAssignmentFactInput)
       OR EXISTS (SELECT 1 FROM paws.DoeAssignmentFact)
       OR EXISTS (SELECT 1 FROM paws.DoeCalculationRecord)
       OR EXISTS (SELECT 1 FROM paws.DoePolicyException)
       OR EXISTS (SELECT 1 FROM paws.DoeCourseMapping)
       OR EXISTS (SELECT 1 FROM paws.DoeSubjectMapping)
       OR EXISTS (SELECT 1 FROM paws.DoeRuleInput)
       OR EXISTS (SELECT 1 FROM paws.DoeRuleTier)
       OR EXISTS (SELECT 1 FROM paws.DoeRuleParameter)
       OR EXISTS (SELECT 1 FROM paws.DoeRuleSelector)
       OR EXISTS (SELECT 1 FROM paws.DoePolicyRule)
       OR EXISTS (SELECT 1 FROM paws.DoeReferenceSource)
       OR EXISTS (SELECT 1 FROM paws.DoeAuditEvent)
        THROW 52552, 'P4 rollback refused: DOE domain tables contain evidence or business data.', 1;

    IF OBJECT_ID(N'paws.DoePolicyPublication', N'U') IS NOT NULL DROP TABLE paws.DoePolicyPublication;
    IF OBJECT_ID(N'paws.DoeImpactRunRow', N'U') IS NOT NULL DROP TABLE paws.DoeImpactRunRow;
    IF OBJECT_ID(N'paws.DoeAssignmentFactInput', N'U') IS NOT NULL DROP TABLE paws.DoeAssignmentFactInput;
    IF OBJECT_ID(N'paws.DoeAssignmentFact', N'U') IS NOT NULL DROP TABLE paws.DoeAssignmentFact;
    IF OBJECT_ID(N'paws.DoeCalculationRecord', N'U') IS NOT NULL DROP TABLE paws.DoeCalculationRecord;
    IF OBJECT_ID(N'paws.DoeImpactRun', N'U') IS NOT NULL DROP TABLE paws.DoeImpactRun;
    IF OBJECT_ID(N'paws.DoePolicyException', N'U') IS NOT NULL DROP TABLE paws.DoePolicyException;
    IF OBJECT_ID(N'paws.DoeCourseMapping', N'U') IS NOT NULL DROP TABLE paws.DoeCourseMapping;
    IF OBJECT_ID(N'paws.DoeSubjectMapping', N'U') IS NOT NULL DROP TABLE paws.DoeSubjectMapping;
    IF OBJECT_ID(N'paws.DoeRuleInput', N'U') IS NOT NULL DROP TABLE paws.DoeRuleInput;
    IF OBJECT_ID(N'paws.DoeRuleTier', N'U') IS NOT NULL DROP TABLE paws.DoeRuleTier;
    IF OBJECT_ID(N'paws.DoeRuleParameter', N'U') IS NOT NULL DROP TABLE paws.DoeRuleParameter;
    IF OBJECT_ID(N'paws.DoeRuleSelector', N'U') IS NOT NULL DROP TABLE paws.DoeRuleSelector;
    IF OBJECT_ID(N'paws.DoePolicyRule', N'U') IS NOT NULL DROP TABLE paws.DoePolicyRule;
    IF OBJECT_ID(N'paws.DoeReferenceSource', N'U') IS NOT NULL DROP TABLE paws.DoeReferenceSource;
    IF OBJECT_ID(N'paws.DoeAuditEvent', N'U') IS NOT NULL DROP TABLE paws.DoeAuditEvent;

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'paws.DoePolicyVersion') AND name=N'UX_DoePolicyVersion_OneActiveYear')
        DROP INDEX UX_DoePolicyVersion_OneActiveYear ON paws.DoePolicyVersion;
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'paws.DoePolicyVersion') AND name=N'CK_DoePolicyVersion_Status')
        ALTER TABLE paws.DoePolicyVersion DROP CONSTRAINT CK_DoePolicyVersion_Status;
    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N'paws.DoePolicyVersion') AND name=N'DF_DoePolicyVersion_Status')
        ALTER TABLE paws.DoePolicyVersion DROP CONSTRAINT DF_DoePolicyVersion_Status;
    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N'paws.DoePolicyVersion') AND name=N'DF_DoePolicyVersion_Revision')
        ALTER TABLE paws.DoePolicyVersion DROP CONSTRAINT DF_DoePolicyVersion_Revision;
    ALTER TABLE paws.DoePolicyVersion DROP COLUMN Status, Revision, UpdatedBy,
        ValidatedRevision, ValidatedChecksum, ImpactRevision, ImpactChecksum;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
