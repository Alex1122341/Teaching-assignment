/*
  PAWS Beta P2 permission rollback. Removes only migration 022's P2 column and
  named-procedure grants. Empty runtime role containers are retained so an audited
  retry can reapply the migration without role-name races. No business data,
  migration 017 permissions, logins, users, or memberships are modified.
*/
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 52210, 'Rollback 022 must run in VetMed-Ops.', 1;

IF EXISTS (
    SELECT 1 FROM sys.database_role_members m
    JOIN sys.database_principals r ON r.principal_id=m.role_principal_id
    WHERE r.name IN (N'paws_runtime_ta_draft_write', N'paws_runtime_ta_review_write', N'paws_runtime_ta_final_write', N'paws_runtime_ta_publish_write')
)
    THROW 52211, 'P2 permission roles have members; remove them through the approved identity process before rollback.', 1;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentPackage
        (TeachingAssignmentPackageId, PackageIdentity, AcademicYear, GroupId, HiccResponsibilityId,
         Status, WorkingRevision, SubmittedWorkingRevision, ViscApprovedWorkingRevision,
         ViscReviewComment, DueAtUtc, CreatedAtUtc, UpdatedAtUtc)
        FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentGroup
        (GroupId, Name, LeaderViscResponsibilityId, Active) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingResponsibility
        (ResponsibilityId, Kind, Label, Active) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingResponsibilityAssignee
        (ResponsibilityId, AcademicYear, FacultyId, ActiveDate, ExpirationDate) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentRevision
        (RevisionId, TeachingAssignmentPackageId, RevisionNumber) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentRevisionSession
        (RevisionId, TeachingAssignmentPackageId, SessionId, SessionOrder) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentRevisionInstructor
        (RevisionId, SessionId, FacultyId, TeachingRole) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.Session
        (SessionId, CourseCode, CourseName, Topic, SessionType, SessionDate, StartTime, EndTime, Room) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingSessionOwnership
        (SessionId, TeachingAssignmentPackageId) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentReview
        (TeachingAssignmentPackageId, RevisionNumber, Decision, Comment, ActorName, ActorResponsibilityId, CreatedAtUtc) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentCurrentFinalization
        (TeachingAssignmentPackageId, FinalizationId) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentFinalization
        (FinalizationId, VersionNumber, RevisionNumber, ActorName, FinalNote, CreatedAtUtc) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentFinalizationLine
        (FinalizationId, SessionId, FacultyId, FacultyDisplayName, TeachingRole) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentContribution
        (TeachingAssignmentPackageId, ContributionId, RevisionNumber, SessionId, CandidateKey,
         SuggestedDisplayName, SuggestedByOffice, ActorName, Note, CreatedAtUtc) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.AuditEvent
        (EventType, EntityType, EntityId, ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentPublicationState
        (AcademicYear, CurrentReleaseId) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentPublicationRelease
        (ReleaseId, AcademicYear, VersionNumber, PublishedAtUtc, PublishedByName, PublicationNote) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentPublishedSession
        (PublishedSessionId, ReleaseId, SessionId, CourseCode, CourseName, Topic, SessionType,
         SessionDate, StartTime, EndTime, Room, SourcePackageId) FROM [paws_runtime_read];
    REVOKE SELECT ON OBJECT::paws.TeachingAssignmentPublishedInstructor
        (PublishedSessionId, FacultyId, FacultyDisplayName, TeachingRole) FROM [paws_runtime_read];
    REVOKE EXECUTE ON OBJECT::paws_api.CanActOnTeachingAssignmentPackage FROM [paws_runtime_read];

    REVOKE EXECUTE ON OBJECT::paws_api.SaveTeachingAssignmentDraft FROM [paws_runtime_ta_draft_write];
    REVOKE EXECUTE ON OBJECT::paws_api.AddTeachingAssignmentContribution FROM [paws_runtime_ta_draft_write];
    REVOKE EXECUTE ON OBJECT::paws_api.SubmitTeachingAssignmentRevision FROM [paws_runtime_ta_draft_write];
    REVOKE EXECUTE ON OBJECT::paws_api.FinalSubmitTeachingAssignment FROM [paws_runtime_ta_draft_write];
    REVOKE EXECUTE ON OBJECT::paws_api.RecordTeachingAssignmentReview FROM [paws_runtime_ta_review_write];
    REVOKE EXECUTE ON OBJECT::paws_api.SaveTeachingAssignmentFinalization FROM [paws_runtime_ta_final_write];
    REVOKE EXECUTE ON OBJECT::paws_api.PublishTeachingAssignmentRelease FROM [paws_runtime_ta_publish_write];

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
