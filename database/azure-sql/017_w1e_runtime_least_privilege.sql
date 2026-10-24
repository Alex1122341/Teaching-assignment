/*
  PAWS W1E local-only permission contract.

  This is an unexecuted proposal. It creates reusable database roles but does
  not create/map a login or user, grant roles to a principal, alter live access,
  or activate an API write gate. Run only after separate review and approval.

  Runtime identity binding is deliberately omitted. It must be a dedicated,
  non-personal account selected by University IT, never UC\sa-xinyu.zhu1.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 51750, 'W1E role artifact is scoped to VetMed-Ops; no change was made.', 1;

BEGIN TRY
    BEGIN TRANSACTION;

    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_read') IS NULL
        EXEC(N'CREATE ROLE [paws_runtime_read] AUTHORIZATION [dbo];');
    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_single_write') IS NULL
        EXEC(N'CREATE ROLE [paws_runtime_afc_single_write] AUTHORIZATION [dbo];');
    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_afc_batch_write') IS NULL
        EXEC(N'CREATE ROLE [paws_runtime_afc_batch_write] AUTHORIZATION [dbo];');
    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_session_edit_write') IS NULL
        EXEC(N'CREATE ROLE [paws_runtime_session_edit_write] AUTHORIZATION [dbo];');

    GRANT CONNECT TO [paws_runtime_read];

    -- Identity and timetable read contract (source: SQL repositories).
    GRANT SELECT ON OBJECT::paws.UserProfile
        (FirebaseUid, DisplayName, BaseRole, FacultyId, Active, MustChangePassword)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.vCalendarSession
        (SessionId, AcademicYear, CurriculumYear, CourseCode, CourseName, Topic,
         SessionType, SessionDate, StartTime, EndTime, Room, InstructorNames)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.SessionAssignment
        (SessionAssignmentId, SessionId, FacultyId, TeachingRole, LabLead,
         CreditedHours, DoeRate, DoeQuantity, DoeUnit, DoeCredit, DoeStatus)
        TO [paws_runtime_read];

    -- Dashboard and DOE read contract. Source import/provenance columns are
    -- omitted unless query semantics require them (DoeRuleSeed.SourceRow is
    -- currently used only as a stable ORDER BY key).
    GRANT SELECT ON OBJECT::paws.Faculty
        (FacultyId, RecordType, PreferredFirstName, PreferredLastName, DisplayName,
         Ucid, Email, Stream, Rank, Fte, ReportsToFacultyId, Active,
         FteSourceReference, FteSourceRow, FteSourceUpdatedAtUtc)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.FacultyProfessionalProfile
        (FacultyId, TeachingArea, ProfessionalCategory, ServiceDate,
         PriorYearsExperience, DvmEarnedDate, DvmType, MastersEarnedDate,
         MastersArea, PhdEarnedDate, PhdArea, BoardCertifiedDate,
         BoardCertification, BoardCertificationCount, AbvmaLicenseNumber,
         AbvmaMemberType)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.JointAppointment
        (JointAppointmentId, FacultyId, HomeFaculty, JointFaculty, FteUcvm,
         FteOtherFaculty, ExpiryDate, Notes)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.RoleAssignment
        (RoleAssignmentId, FacultyId, FacultyResolutionStatus, AcademicYear,
         RoleCategory, RoleType, CourseOrSubjectOrRotation, CourseName, Details,
         EffectiveDate, ExpirationDate, DoeMappedValue, DoeOverrideValue,
         DoeOverrideReason, SpecialNotes)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeFacultyTarget
        (DoeFacultyTargetId, FacultyId, AcademicYear, ContractTeachingDoe,
         OverrideDoe, EffectiveTargetDoe, OverrideReason, OverrideNotes, Source,
         PolicyVersionId, Active, UpdatedAtUtc)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoePolicyVersion
        (PolicyVersionId, AcademicYear, VersionLabel, SourceReference, Active)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeFacultyAllocation
        (DoeFacultyAllocationId, FacultyId, AcademicYear, CategoryCode,
         AllocationDoe, SourceReference, PolicyVersionId, Active)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.DoeRuleSeed
        (DoeRuleSeedId, PolicyVersionId, Category, RuleLabel,
         AcademicYearOrStage, RateOrTierPct, Basis, RequiredInput,
         CalculationOrNote, RawJson, SourceUrl, SourceRow)
        TO [paws_runtime_read];

    -- Existing GET surface; column grants constrain SQL's direct AFC request
    -- listing. The view's projection supports the dashboard AFC read surface.
    GRANT SELECT ON OBJECT::paws.AfcRequest
        (AfcRequestId, FacultyId, FacultyName, RequesterFirebaseUid,
         ReportToFirebaseUid, Status, StartDate, EndDate, WorkDays, Reason,
         PurposeDestination, Coverage, SubmittedAtUtc, UpdatedAtUtc)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.vAfcRecordUnified
        (AfcRecordId, FacultyId, StartDate, EndDate, ReasonCode, ReasonDisplay,
         Notes, Purpose, LegacyPurpose, Active, SourceKind, CreatedAtUtc,
         CreatedByName, RecordKey)
        TO [paws_runtime_read];
    GRANT EXECUTE ON OBJECT::paws_api.GetApprovedAfcArtifactSource TO [paws_runtime_read];
    GRANT EXECUTE ON OBJECT::paws_api.GetApprovedAfcArtifact TO [paws_runtime_read];

    -- W1C gates are independent application checks and remain default OFF.
    -- A role grant alone must never activate an operation. These role grants
    -- have no member until a separately approved, verified identity binding.
    -- PAWS_AFC_SINGLE_WRITE_ENABLED: unchanged / default disabled.
    -- PAWS_AFC_BATCH_WRITE_ENABLED: unchanged / default disabled.
    -- PAWS_SESSION_EDIT_WRITE_ENABLED: unchanged / default disabled.
    GRANT EXECUTE ON OBJECT::paws_api.CreateAfcRecord TO [paws_runtime_afc_single_write];
    GRANT EXECUTE ON OBJECT::paws_api.CreateAfcManualBatch TO [paws_runtime_afc_batch_write];
    GRANT EXECUTE ON OBJECT::paws_api.UpdateCalendarSession TO [paws_runtime_session_edit_write];

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO

-- Read-only role-definition postflight. It does not prove a future member's
-- effective rights; verify memberships, inherited grants, server roles,
-- database owner, and fn_my_permissions under the actual runtime identity.
SELECT role_principal.name AS role_name,
       permission.permission_name,
       permission.state_desc,
       permission.class_desc,
       CASE permission.class
           WHEN 1 THEN QUOTENAME(OBJECT_SCHEMA_NAME(permission.major_id)) + N'.' + QUOTENAME(OBJECT_NAME(permission.major_id))
           WHEN 3 THEN QUOTENAME(SCHEMA_NAME(permission.major_id))
           ELSE N'DATABASE'
       END AS securable,
       CASE WHEN permission.minor_id > 0 THEN COL_NAME(permission.major_id, permission.minor_id) END AS column_name
FROM sys.database_principals AS role_principal
LEFT JOIN sys.database_permissions AS permission
  ON permission.grantee_principal_id = role_principal.principal_id
WHERE role_principal.name IN
    (N'paws_runtime_read', N'paws_runtime_afc_single_write',
     N'paws_runtime_afc_batch_write', N'paws_runtime_session_edit_write')
ORDER BY role_principal.name, permission.class_desc, permission.permission_name, securable, column_name;

/*
  Manual rollback after separately removing all members from these roles:

  DROP ROLE [paws_runtime_session_edit_write];
  DROP ROLE [paws_runtime_afc_batch_write];
  DROP ROLE [paws_runtime_afc_single_write];
  DROP ROLE [paws_runtime_read];

  Dropping these empty role containers removes their grants. No login/user is
  dropped by this rollback. Do not remove database permissions from a personal
  DBA identity as part of an application-runtime retirement.
*/
