/*
  PAWS Beta P2: exact read-column and named workflow-procedure permissions.
  This creates no users, memberships, broad DML grants, or write-gate changes.
  Apply only after migrations 020 and 021 on VetMed-Ops using sqlcmd
  :ON ERROR EXIT. The four operation roles remain empty until separately
  governed runtime identity binding.
*/
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 52200, 'Migration 022 must run in VetMed-Ops.', 1;

IF DATABASE_PRINCIPAL_ID(N'paws_runtime_read') IS NOT NULL
   AND (SELECT type FROM sys.database_principals WHERE principal_id = DATABASE_PRINCIPAL_ID(N'paws_runtime_read')) <> 'R'
    THROW 52202, 'The paws_runtime_read principal exists but is not a database role.', 1;

IF OBJECT_ID(N'paws_api.CanActOnTeachingAssignmentPackage', N'FN') IS NULL
   OR OBJECT_ID(N'paws_api.SaveTeachingAssignmentDraft', N'P') IS NULL
   OR OBJECT_ID(N'paws_api.AddTeachingAssignmentContribution', N'P') IS NULL
   OR OBJECT_ID(N'paws_api.SubmitTeachingAssignmentRevision', N'P') IS NULL
   OR OBJECT_ID(N'paws_api.RecordTeachingAssignmentReview', N'P') IS NULL
   OR OBJECT_ID(N'paws_api.FinalSubmitTeachingAssignment', N'P') IS NULL
   OR OBJECT_ID(N'paws_api.SaveTeachingAssignmentFinalization', N'P') IS NULL
   OR OBJECT_ID(N'paws_api.PublishTeachingAssignmentRelease', N'P') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentPackage', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentGroup', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingResponsibility', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingResponsibilityAssignee', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentRevision', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentRevisionSession', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentRevisionInstructor', N'U') IS NULL
   OR OBJECT_ID(N'paws.Session', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingSessionOwnership', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentReview', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentCurrentFinalization', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentFinalization', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentFinalizationLine', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentContribution', N'U') IS NULL
   OR OBJECT_ID(N'paws.AuditEvent', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentPublicationState', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentPublicationRelease', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentPublishedSession', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentPublishedInstructor', N'U') IS NULL
    THROW 52201, 'Migration 022 requires the complete P2 API and schema; no change was made.', 1;

IF EXISTS (
    SELECT 1 FROM sys.database_principals
    WHERE name IN (N'paws_runtime_ta_draft_write', N'paws_runtime_ta_review_write', N'paws_runtime_ta_final_write', N'paws_runtime_ta_publish_write')
      AND type <> 'R'
)
    THROW 52203, 'A P2 permission role name is occupied by a non-role principal.', 1;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_read') IS NULL EXEC(N'CREATE ROLE [paws_runtime_read] AUTHORIZATION [dbo];');
    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_ta_draft_write') IS NULL EXEC(N'CREATE ROLE [paws_runtime_ta_draft_write] AUTHORIZATION [dbo];');
    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_ta_review_write') IS NULL EXEC(N'CREATE ROLE [paws_runtime_ta_review_write] AUTHORIZATION [dbo];');
    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_ta_final_write') IS NULL EXEC(N'CREATE ROLE [paws_runtime_ta_final_write] AUTHORIZATION [dbo];');
    IF DATABASE_PRINCIPAL_ID(N'paws_runtime_ta_publish_write') IS NULL EXEC(N'CREATE ROLE [paws_runtime_ta_publish_write] AUTHORIZATION [dbo];');

    IF EXISTS (
        SELECT 1 FROM sys.database_role_members m
        JOIN sys.database_principals r ON r.principal_id=m.role_principal_id
        WHERE r.name IN (N'paws_runtime_ta_draft_write', N'paws_runtime_ta_review_write', N'paws_runtime_ta_final_write', N'paws_runtime_ta_publish_write')
    )
        THROW 52204, 'P2 write roles must be empty before migration; inspect memberships before retrying.', 1;

    -- Direct repository reads only. Shared Faculty and SessionAssignment
    -- reads remain governed by their existing W1E column grants.
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentPackage
        (TeachingAssignmentPackageId, PackageIdentity, AcademicYear, GroupId, HiccResponsibilityId,
         Status, WorkingRevision, SubmittedWorkingRevision, ViscApprovedWorkingRevision,
         ViscReviewComment, DueAtUtc, CreatedAtUtc, UpdatedAtUtc)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentGroup
        (GroupId, Name, LeaderViscResponsibilityId, Active)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingResponsibility
        (ResponsibilityId, Kind, Label, Active)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingResponsibilityAssignee
        (ResponsibilityId, AcademicYear, FacultyId, ActiveDate, ExpirationDate)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentRevision
        (RevisionId, TeachingAssignmentPackageId, RevisionNumber)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentRevisionSession
        (RevisionId, TeachingAssignmentPackageId, SessionId, SessionOrder)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentRevisionInstructor
        (RevisionId, SessionId, FacultyId, TeachingRole)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.Session
        (SessionId, CourseCode, CourseName, Topic, SessionType, SessionDate, StartTime, EndTime, Room)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingSessionOwnership
        (SessionId, TeachingAssignmentPackageId)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentReview
        (TeachingAssignmentPackageId, RevisionNumber, Decision, Comment, ActorName, ActorResponsibilityId, CreatedAtUtc)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentCurrentFinalization
        (TeachingAssignmentPackageId, FinalizationId)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentFinalization
        (FinalizationId, VersionNumber, RevisionNumber, ActorName, FinalNote, CreatedAtUtc)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentFinalizationLine
        (FinalizationId, SessionId, FacultyId, FacultyDisplayName, TeachingRole)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentContribution
        (TeachingAssignmentPackageId, ContributionId, RevisionNumber, SessionId, CandidateKey,
         SuggestedDisplayName, SuggestedByOffice, ActorName, Note, CreatedAtUtc)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.AuditEvent
        (EventType, EntityType, EntityId, ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentPublicationState
        (AcademicYear, CurrentReleaseId)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentPublicationRelease
        (ReleaseId, AcademicYear, VersionNumber, PublishedAtUtc, PublishedByName, PublicationNote)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentPublishedSession
        (PublishedSessionId, ReleaseId, SessionId, CourseCode, CourseName, Topic, SessionType,
         SessionDate, StartTime, EndTime, Room, SourcePackageId)
        TO [paws_runtime_read];
    GRANT SELECT ON OBJECT::paws.TeachingAssignmentPublishedInstructor
        (PublishedSessionId, FacultyId, FacultyDisplayName, TeachingRole)
        TO [paws_runtime_read];
    GRANT EXECUTE ON OBJECT::paws_api.CanActOnTeachingAssignmentPackage TO [paws_runtime_read];

    -- Each P2 gate maps to one exact procedure set; no direct table DML.
    GRANT EXECUTE ON OBJECT::paws_api.SaveTeachingAssignmentDraft TO [paws_runtime_ta_draft_write];
    GRANT EXECUTE ON OBJECT::paws_api.AddTeachingAssignmentContribution TO [paws_runtime_ta_draft_write];
    GRANT EXECUTE ON OBJECT::paws_api.SubmitTeachingAssignmentRevision TO [paws_runtime_ta_draft_write];
    GRANT EXECUTE ON OBJECT::paws_api.FinalSubmitTeachingAssignment TO [paws_runtime_ta_draft_write];
    GRANT EXECUTE ON OBJECT::paws_api.RecordTeachingAssignmentReview TO [paws_runtime_ta_review_write];
    GRANT EXECUTE ON OBJECT::paws_api.SaveTeachingAssignmentFinalization TO [paws_runtime_ta_final_write];
    GRANT EXECUTE ON OBJECT::paws_api.PublishTeachingAssignmentRelease TO [paws_runtime_ta_publish_write];

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO

-- Read-only postflight evidence; membership remains intentionally unmanaged.
SELECT role_principal.name AS role_name, permission.permission_name, permission.state_desc,
       permission.class_desc,
       CASE permission.class WHEN 1 THEN QUOTENAME(OBJECT_SCHEMA_NAME(permission.major_id)) + N'.' + QUOTENAME(OBJECT_NAME(permission.major_id))
             WHEN 3 THEN QUOTENAME(SCHEMA_NAME(permission.major_id)) ELSE N'DATABASE' END AS securable,
       CASE WHEN permission.minor_id > 0 THEN COL_NAME(permission.major_id, permission.minor_id) END AS column_name
FROM sys.database_principals role_principal
LEFT JOIN sys.database_permissions permission ON permission.grantee_principal_id=role_principal.principal_id
WHERE role_principal.name IN (N'paws_runtime_read', N'paws_runtime_ta_draft_write', N'paws_runtime_ta_review_write',
                              N'paws_runtime_ta_final_write', N'paws_runtime_ta_publish_write')
ORDER BY role_principal.name, permission.class_desc, permission.permission_name, securable, column_name;
GO
