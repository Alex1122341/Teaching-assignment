/*
  PAWS Beta P2: explicit parameterized workflow procedures.
  Run after migration 020 with sqlcmd :ON ERROR EXIT. Application gates remain
  independently false until API authorization and live acceptance pass.
*/
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 52100, 'Migration 021 must run in VetMed-Ops.', 1;
IF OBJECT_ID(N'paws.TeachingAssignmentRevision', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentCurrentFinalization', N'U') IS NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentPublicationState', N'U') IS NULL
    OR SCHEMA_ID(N'paws_api') IS NULL
    THROW 52101, 'Migration 021 requires migration 020 and the accepted API schema.', 1;
BEGIN TRANSACTION;
GO

CREATE OR ALTER FUNCTION paws_api.CanActOnTeachingAssignmentPackage
(
    @PackageId uniqueidentifier,
    @ActorFirebaseUid nvarchar(128),
    @ActionKind nvarchar(16)
)
RETURNS bit
AS
BEGIN
    DECLARE @NowUtc datetime2(7) = SYSUTCDATETIME();
    DECLARE @TodayUtc date = CONVERT(date, @NowUtc);
    IF @ActionKind = N'adfad'
        RETURN CASE WHEN EXISTS (
            SELECT 1 FROM paws.UserProfile up
            WHERE up.FirebaseUid = @ActorFirebaseUid AND up.Active = 1 AND up.MustChangePassword = 0
              AND LOWER(up.BaseRole) IN (N'owner', N'administrator', N'adfa_general', N'adfa_regular', N'admin')
        ) THEN 1 ELSE 0 END;

    RETURN CASE WHEN EXISTS (
        SELECT 1
        FROM paws.TeachingAssignmentPackage p
        INNER JOIN paws.TeachingAssignmentGroup g ON g.GroupId = p.GroupId AND g.Active = 1
        INNER JOIN paws.UserProfile up ON up.FirebaseUid = @ActorFirebaseUid AND up.Active = 1 AND up.MustChangePassword = 0
        INNER JOIN paws.TeachingResponsibilityAssignee actorAssignment
          ON actorAssignment.AcademicYear = p.AcademicYear AND actorAssignment.FacultyId = up.FacultyId
         AND actorAssignment.ActiveDate <= @TodayUtc
         AND (actorAssignment.ExpirationDate IS NULL OR @NowUtc < CONVERT(datetime2(7), actorAssignment.ExpirationDate))
        INNER JOIN paws.TeachingResponsibility actorResponsibility
          ON actorResponsibility.ResponsibilityId = actorAssignment.ResponsibilityId AND actorResponsibility.Active = 1
        WHERE p.TeachingAssignmentPackageId = @PackageId
          AND (
            (@ActionKind = N'hicc' AND LOWER(up.BaseRole) = N'hicc'
             AND actorResponsibility.ResponsibilityId = p.HiccResponsibilityId
             AND actorResponsibility.Kind = N'hicc'
             AND EXISTS (SELECT 1 FROM paws.TeachingAssignmentGroupHicc gh WHERE gh.GroupId = p.GroupId AND gh.HiccResponsibilityId = p.HiccResponsibilityId AND gh.HiccResponsibilityKind = N'hicc'))
            OR
            (@ActionKind = N'visc' AND LOWER(up.BaseRole) = N'visc'
             AND actorResponsibility.ResponsibilityId = g.LeaderViscResponsibilityId
             AND actorResponsibility.Kind = N'visc')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM paws.TeachingResponsibilityAssignee overlapping
            WHERE overlapping.ResponsibilityId = actorResponsibility.ResponsibilityId
              AND overlapping.AcademicYear = p.AcademicYear
              AND overlapping.ResponsibilityAssigneeId <> actorAssignment.ResponsibilityAssigneeId
              AND overlapping.ActiveDate < COALESCE(actorAssignment.ExpirationDate, CONVERT(date, '99991231'))
              AND actorAssignment.ActiveDate < COALESCE(overlapping.ExpirationDate, CONVERT(date, '99991231'))
              AND (overlapping.AssignmentMode <> N'concurrent' OR actorAssignment.AssignmentMode <> N'concurrent')
          )
    ) THEN 1 ELSE 0 END;
END;
GO

CREATE OR ALTER PROCEDURE paws_api.SaveTeachingAssignmentDraft
    @PackageId uniqueidentifier,
    @ExpectedWorkingRevision int,
    @SessionsJson nvarchar(max),
    @RevisionNote nvarchar(1000) = NULL,
    @ActorFirebaseUid nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @PackageId IS NULL OR @ExpectedWorkingRevision < 0 OR ISJSON(@SessionsJson) <> 1
       OR LEFT(LTRIM(@SessionsJson), 1) <> N'[' OR NULLIF(LTRIM(RTRIM(@ActorFirebaseUid)), N'') IS NULL
        THROW 52110, 'Invalid working draft request.', 1;
    IF (SELECT COUNT_BIG(*) FROM OPENJSON(@SessionsJson)) > 200
        THROW 52110, 'A draft may include at most 200 sessions.', 1;
    IF EXISTS (SELECT 1 FROM OPENJSON(@SessionsJson) WHERE [type] <> 5)
        THROW 52110, 'Each draft session must be an object.', 1;
    IF EXISTS (
        SELECT 1 FROM OPENJSON(@SessionsJson) AS session
        CROSS APPLY OPENJSON(session.value) AS field
        WHERE field.[key] NOT IN (N'sessionId', N'assignments')
    ) THROW 52110, 'Unsupported draft session fields.', 1;

    DECLARE @Requested TABLE (SessionId uniqueidentifier NOT NULL PRIMARY KEY, SessionOrder int NOT NULL, AssignmentsJson nvarchar(max) NOT NULL);
    INSERT @Requested (SessionId, SessionOrder, AssignmentsJson)
    SELECT TRY_CONVERT(uniqueidentifier, JSON_VALUE(value, '$.sessionId')),
           TRY_CONVERT(int, [key]),
           JSON_QUERY(value, '$.assignments')
    FROM OPENJSON(@SessionsJson);
    IF EXISTS (SELECT 1 FROM @Requested WHERE SessionId IS NULL OR AssignmentsJson IS NULL OR LEFT(LTRIM(AssignmentsJson), 1) <> N'[')
       OR (SELECT COUNT_BIG(*) FROM @Requested) <> (SELECT COUNT_BIG(*) FROM OPENJSON(@SessionsJson))
        THROW 52110, 'Draft sessions require valid IDs and assignment arrays.', 1;

    DECLARE @RequestedInstructors TABLE (SessionId uniqueidentifier NOT NULL, FacultyId uniqueidentifier NOT NULL, TeachingRole nvarchar(256) NOT NULL,
        PRIMARY KEY (SessionId, FacultyId));
    IF EXISTS (
        SELECT 1 FROM @Requested AS requested
        CROSS APPLY OPENJSON(requested.AssignmentsJson) AS assignment
        WHERE assignment.[type] <> 5
    ) THROW 52110, 'Each assignment must be an object.', 1;
    IF EXISTS (
        SELECT 1 FROM @Requested AS requested
        CROSS APPLY OPENJSON(requested.AssignmentsJson) AS assignment
        CROSS APPLY OPENJSON(assignment.value) AS field
        WHERE field.[key] NOT IN (N'facultyId', N'teachingRole')
    ) THROW 52110, 'Unsupported assignment fields.', 1;
    INSERT @RequestedInstructors (SessionId, FacultyId, TeachingRole)
    SELECT requested.SessionId,
           TRY_CONVERT(uniqueidentifier, JSON_VALUE(assignment.value, '$.facultyId')),
           NULLIF(LTRIM(RTRIM(JSON_VALUE(assignment.value, '$.teachingRole'))), N'')
    FROM @Requested AS requested
    CROSS APPLY OPENJSON(requested.AssignmentsJson) AS assignment;
    IF EXISTS (SELECT 1 FROM @RequestedInstructors WHERE FacultyId IS NULL OR TeachingRole IS NULL OR DATALENGTH(TeachingRole) > 512)
       OR EXISTS (SELECT 1 FROM @RequestedInstructors AS requested WHERE NOT EXISTS (SELECT 1 FROM paws.Faculty f WHERE f.FacultyId = requested.FacultyId AND f.Active = 1))
        THROW 52110, 'Draft assignments must resolve to active canonical Faculty.', 1;

    DECLARE @ActorName nvarchar(260), @AcademicYear nvarchar(32), @GroupId nvarchar(64), @HiccResponsibilityId nvarchar(64);
    DECLARE @OldRevision int, @NewRevision int, @RevisionId uniqueidentifier = NEWID(), @BeforeJson nvarchar(max), @AfterJson nvarchar(max);
    SELECT @ActorName = up.DisplayName FROM paws.UserProfile up WHERE up.FirebaseUid = @ActorFirebaseUid AND up.Active = 1 AND up.MustChangePassword = 0;

    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @AcademicYear = p.AcademicYear, @GroupId = p.GroupId, @HiccResponsibilityId = p.HiccResponsibilityId,
               @OldRevision = p.WorkingRevision
        FROM paws.TeachingAssignmentPackage p WITH (UPDLOCK, HOLDLOCK)
        WHERE p.TeachingAssignmentPackageId = @PackageId;
        IF @AcademicYear IS NULL THROW 52111, 'Teaching Assignment package was not found.', 1;
        IF paws_api.CanActOnTeachingAssignmentPackage(@PackageId, @ActorFirebaseUid, N'hicc') <> 1
            THROW 52112, 'Actor does not hold the current HICC responsibility for this package.', 1;
        IF @OldRevision <> @ExpectedWorkingRevision
            THROW 52113, 'Working revision conflict; reload the package before saving.', 1;
        IF EXISTS (
            SELECT 1 FROM @Requested requested
            WHERE NOT EXISTS (
                SELECT 1 FROM paws.TeachingSessionOwnership tso
                WHERE tso.SessionId = requested.SessionId AND tso.AcademicYear = @AcademicYear
                  AND tso.TeachingAssignmentGroupId = @GroupId
                  AND tso.ResponsibleHiccResponsibilityId = @HiccResponsibilityId
                  AND tso.TeachingAssignmentPackageId = @PackageId
            )
        ) THROW 52114, 'A draft session is outside the package ownership scope.', 1;
        IF EXISTS (
            SELECT 1
            FROM @Requested requested
            JOIN paws.Session s ON s.SessionId = requested.SessionId
            JOIN paws.TeachingSessionOwnership tso ON tso.SessionId = s.SessionId
            WHERE NOT EXISTS (
                SELECT 1 FROM paws.TeachingResponsibilityScope scope
                WHERE scope.HiccResponsibilityId = @HiccResponsibilityId
                  AND scope.HiccResponsibilityKind = N'hicc'
                  AND scope.CourseId = s.CourseId
                  AND (scope.SubjectId IS NULL OR scope.SubjectId = tso.SubjectId)
            )
        ) THROW 52116, 'A draft session has no canonical course/subject authorization scope.', 1;
        IF EXISTS (
            SELECT 1 FROM @RequestedInstructors ri
            WHERE NOT EXISTS (SELECT 1 FROM @Requested r WHERE r.SessionId = ri.SessionId)
        ) THROW 52115, 'An assignment references a session outside the draft.', 1;

        SET @NewRevision = @OldRevision + 1;
        SELECT @BeforeJson = (SELECT @OldRevision AS workingRevision, p.Status AS status,
                                     p.SubmittedWorkingRevision AS submittedRevision,
                                     p.ViscApprovedWorkingRevision AS approvedRevision
                              FROM paws.TeachingAssignmentPackage p WHERE p.TeachingAssignmentPackageId = @PackageId
                              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
        INSERT paws.TeachingAssignmentRevision
            (RevisionId, TeachingAssignmentPackageId, RevisionNumber, CreatedByFirebaseUid, CreatedByName, CreatedAtUtc, RevisionNote)
        VALUES (@RevisionId, @PackageId, @NewRevision, @ActorFirebaseUid, @ActorName, SYSUTCDATETIME(), NULLIF(LTRIM(RTRIM(@RevisionNote)), N''));
        INSERT paws.TeachingAssignmentRevisionSession (RevisionId, TeachingAssignmentPackageId, SessionId, SessionOrder)
        SELECT @RevisionId, @PackageId, SessionId, SessionOrder FROM @Requested;
        INSERT paws.TeachingAssignmentRevisionInstructor (RevisionId, SessionId, FacultyId, TeachingRole)
        SELECT @RevisionId, SessionId, FacultyId, TeachingRole FROM @RequestedInstructors;

        UPDATE paws.TeachingAssignmentPackage
        SET WorkingRevision = @NewRevision, SubmittedWorkingRevision = NULL, ViscApprovedWorkingRevision = NULL,
            ReviewFingerprint = NULL, ViscApprovedFingerprint = NULL, ViscReviewComment = NULL,
            Status = N'draft', UpdatedAtUtc = SYSUTCDATETIME()
        WHERE TeachingAssignmentPackageId = @PackageId;
        SET @AfterJson = (SELECT @NewRevision AS workingRevision, N'draft' AS status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT paws.AuditEvent (AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid, ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson, RequestId, ImportBatchId)
        VALUES (NEWID(), N'TeachingAssignmentDraftSaved', N'TeachingAssignmentPackage', CONVERT(nvarchar(36), @PackageId), @ActorFirebaseUid, @ActorName, SYSUTCDATETIME(), @BeforeJson, @AfterJson,
                (SELECT @GroupId AS groupId, @HiccResponsibilityId AS responsibleHiccResponsibilityId, @RevisionId AS revisionId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER), NEWID(), NULL);
        COMMIT TRANSACTION;
        SELECT @PackageId AS packageId, @RevisionId AS revisionId, @NewRevision AS workingRevision, N'draft' AS status;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE paws_api.AddTeachingAssignmentContribution
    @PackageId uniqueidentifier,
    @RevisionNumber int,
    @SessionId uniqueidentifier,
    @CandidateKey nvarchar(128),
    @SuggestedDisplayName nvarchar(260),
    @SuggestedByOffice nvarchar(16),
    @Note nvarchar(1000)=NULL,
    @ActorFirebaseUid nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @PackageId IS NULL OR @SessionId IS NULL OR @RevisionNumber<1
       OR NULLIF(LTRIM(RTRIM(@CandidateKey)),N'') IS NULL OR DATALENGTH(@CandidateKey)>256
       OR NULLIF(LTRIM(RTRIM(@SuggestedDisplayName)),N'') IS NULL OR DATALENGTH(@SuggestedDisplayName)>520
       OR @SuggestedByOffice NOT IN (N'adc',N'lab',N'hicc') OR DATALENGTH(@Note)>2000
       OR NULLIF(LTRIM(RTRIM(@ActorFirebaseUid)),N'') IS NULL
        THROW 52170,'Contribution suggestion values are invalid.',1;
    DECLARE @ActorName nvarchar(260),@BaseRole nvarchar(128),@ContributionId uniqueidentifier,@Now datetime2(7)=SYSUTCDATETIME();
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @ActorName=DisplayName,@BaseRole=LOWER(BaseRole) FROM paws.UserProfile WITH(UPDLOCK,HOLDLOCK)
        WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
        IF @ActorName IS NULL OR @BaseRole NOT IN (N'adc',N'lab',N'hicc') OR @BaseRole<>@SuggestedByOffice
            THROW 52171,'Actor office is not authorized to contribute to this package.',1;
        IF @BaseRole=N'hicc' AND paws_api.CanActOnTeachingAssignmentPackage(@PackageId,@ActorFirebaseUid,N'hicc')<>1
            THROW 52172,'Current HICC responsibility is required for this contribution.',1;
        IF NOT EXISTS(
            SELECT 1 FROM paws.TeachingAssignmentPackage p
            JOIN paws.TeachingSessionOwnership tso ON tso.TeachingAssignmentPackageId=p.TeachingAssignmentPackageId AND tso.SessionId=@SessionId
            JOIN paws.TeachingAssignmentRevision rev ON rev.TeachingAssignmentPackageId=p.TeachingAssignmentPackageId AND rev.RevisionNumber=@RevisionNumber
            JOIN paws.TeachingAssignmentRevisionSession rs ON rs.RevisionId=rev.RevisionId AND rs.SessionId=@SessionId
            WHERE p.TeachingAssignmentPackageId=@PackageId AND p.WorkingRevision=@RevisionNumber AND p.Status IN(N'draft',N'changes_requested')
        ) THROW 52173,'Contribution session or revision is outside the current package.',1;
        SELECT @ContributionId=ContributionId FROM paws.TeachingAssignmentContribution WITH(UPDLOCK,HOLDLOCK)
        WHERE TeachingAssignmentPackageId=@PackageId AND RevisionNumber=@RevisionNumber AND SessionId=@SessionId
          AND CandidateKey=@CandidateKey AND SuggestedByOffice=@SuggestedByOffice;
        IF @ContributionId IS NOT NULL
        BEGIN
            COMMIT TRANSACTION;
            SELECT @ContributionId AS contributionId,CAST(1 AS bit) AS idempotentReplay;
            RETURN;
        END;
        SET @ContributionId=NEWID();
        INSERT paws.TeachingAssignmentContribution(ContributionId,TeachingAssignmentPackageId,RevisionNumber,SessionId,CandidateKey,SuggestedDisplayName,SuggestedByOffice,ActorFirebaseUid,ActorName,Note,CreatedAtUtc)
        VALUES(@ContributionId,@PackageId,@RevisionNumber,@SessionId,LTRIM(RTRIM(@CandidateKey)),LTRIM(RTRIM(@SuggestedDisplayName)),@SuggestedByOffice,@ActorFirebaseUid,@ActorName,NULLIF(LTRIM(RTRIM(@Note)),N''),@Now);
        INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson,RequestId,ImportBatchId)
        VALUES(NEWID(),N'TeachingAssignmentContributionSuggested',N'TeachingAssignmentPackage',CONVERT(nvarchar(36),@PackageId),@ActorFirebaseUid,@ActorName,@Now,NULL,
          (SELECT @ContributionId AS contributionId,@RevisionNumber AS revisionNumber,@SessionId AS sessionId,@SuggestedByOffice AS suggestedByOffice FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),
          (SELECT @CandidateKey AS candidateKey,@SuggestedDisplayName AS suggestedDisplayName,@Note AS note FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),NEWID(),NULL);
        COMMIT TRANSACTION;
        SELECT @ContributionId AS contributionId,CAST(0 AS bit) AS idempotentReplay;
    END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION; THROW; END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE paws_api.SubmitTeachingAssignmentRevision
    @PackageId uniqueidentifier,
    @ExpectedWorkingRevision int,
    @ActorFirebaseUid nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @OldStatus nvarchar(32), @ActorName nvarchar(260), @RevisionId uniqueidentifier, @Fingerprint char(64), @Now datetime2(7) = SYSUTCDATETIME();
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @OldStatus = Status FROM paws.TeachingAssignmentPackage WITH (UPDLOCK, HOLDLOCK)
        WHERE TeachingAssignmentPackageId = @PackageId AND WorkingRevision = @ExpectedWorkingRevision AND WorkingRevision > 0;
        IF @OldStatus IS NULL THROW 52120, 'Working revision conflict; reload the package.', 1;
        IF paws_api.CanActOnTeachingAssignmentPackage(@PackageId, @ActorFirebaseUid, N'hicc') <> 1 THROW 52121, 'Current HICC scope is required.', 1;
        SELECT @ActorName = DisplayName FROM paws.UserProfile WHERE FirebaseUid = @ActorFirebaseUid AND Active = 1 AND MustChangePassword = 0;
        SELECT @RevisionId = RevisionId FROM paws.TeachingAssignmentRevision WHERE TeachingAssignmentPackageId = @PackageId AND RevisionNumber = @ExpectedWorkingRevision;
        IF @RevisionId IS NULL THROW 52122, 'Revision content is missing.', 1;
        SET @Fingerprint = LOWER(CONVERT(char(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), CONVERT(nvarchar(max), (
            SELECT rs.SessionId AS sessionId, ri.FacultyId AS facultyId, ri.TeachingRole AS teachingRole
            FROM paws.TeachingAssignmentRevisionSession rs LEFT JOIN paws.TeachingAssignmentRevisionInstructor ri
              ON ri.RevisionId = rs.RevisionId AND ri.SessionId = rs.SessionId
            WHERE rs.RevisionId = @RevisionId ORDER BY rs.SessionOrder, rs.SessionId, ri.FacultyId
            FOR JSON PATH, INCLUDE_NULL_VALUES)))), 2));
        UPDATE paws.TeachingAssignmentPackage SET Status = N'visc_review', SubmittedWorkingRevision = @ExpectedWorkingRevision,
            ViscApprovedWorkingRevision = NULL, ReviewFingerprint = @Fingerprint, ViscApprovedFingerprint = NULL,
            ViscReviewComment = NULL, UpdatedAtUtc = @Now WHERE TeachingAssignmentPackageId = @PackageId;
        INSERT paws.AuditEvent (AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid, ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson, RequestId, ImportBatchId)
        VALUES (NEWID(), N'TeachingAssignmentSubmitted', N'TeachingAssignmentPackage', CONVERT(nvarchar(36), @PackageId), @ActorFirebaseUid, @ActorName, @Now,
                (SELECT @OldStatus AS status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT N'visc_review' AS status, @ExpectedWorkingRevision AS submittedRevision FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT @RevisionId AS revisionId, @Fingerprint AS contentFingerprint FOR JSON PATH, WITHOUT_ARRAY_WRAPPER), NEWID(), NULL);
        COMMIT TRANSACTION;
        SELECT @PackageId AS packageId, @ExpectedWorkingRevision AS submittedRevision, N'visc_review' AS status;
    END TRY BEGIN CATCH IF XACT_STATE() <> 0 ROLLBACK TRANSACTION; THROW; END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE paws_api.RecordTeachingAssignmentReview
    @PackageId uniqueidentifier,
    @RevisionNumber int,
    @Decision nvarchar(24),
    @Comment nvarchar(2000),
    @ActorFirebaseUid nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorName nvarchar(260), @ResponsibilityId nvarchar(64), @RevisionId uniqueidentifier, @Fingerprint char(64), @Now datetime2(7) = SYSUTCDATETIME(), @OldStatus nvarchar(32);
    IF @Decision NOT IN (N'approved', N'push_back') OR (@Decision = N'push_back' AND NULLIF(LTRIM(RTRIM(@Comment)), N'') IS NULL)
        THROW 52130, 'Review decision and push-back reason are required.', 1;
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @OldStatus = Status, @Fingerprint = ReviewFingerprint FROM paws.TeachingAssignmentPackage WITH (UPDLOCK, HOLDLOCK)
        WHERE TeachingAssignmentPackageId = @PackageId AND SubmittedWorkingRevision = @RevisionNumber AND WorkingRevision = @RevisionNumber AND Status = N'visc_review';
        IF @OldStatus IS NULL THROW 52131, 'Submitted revision is stale or not awaiting review.', 1;
        IF paws_api.CanActOnTeachingAssignmentPackage(@PackageId, @ActorFirebaseUid, N'visc') <> 1 THROW 52132, 'Current VISC group authority is required.', 1;
        SELECT @ActorName = up.DisplayName, @ResponsibilityId = g.LeaderViscResponsibilityId
        FROM paws.TeachingAssignmentPackage p JOIN paws.TeachingAssignmentGroup g ON g.GroupId = p.GroupId
        JOIN paws.UserProfile up ON up.FirebaseUid = @ActorFirebaseUid WHERE p.TeachingAssignmentPackageId = @PackageId;
        SELECT @RevisionId = RevisionId FROM paws.TeachingAssignmentRevision WHERE TeachingAssignmentPackageId = @PackageId AND RevisionNumber = @RevisionNumber;
        INSERT paws.TeachingAssignmentReview (ReviewId, TeachingAssignmentPackageId, RevisionId, RevisionNumber, Decision, Comment, ActorFirebaseUid, ActorName, ActorResponsibilityId, CreatedAtUtc, ContentFingerprint)
        VALUES (NEWID(), @PackageId, @RevisionId, @RevisionNumber, @Decision, NULLIF(LTRIM(RTRIM(@Comment)), N''), @ActorFirebaseUid, @ActorName, @ResponsibilityId, @Now, @Fingerprint);
        UPDATE paws.TeachingAssignmentPackage
        SET Status = CASE WHEN @Decision = N'approved' THEN N'visc_approved' ELSE N'changes_requested' END,
            ViscApprovedWorkingRevision = CASE WHEN @Decision = N'approved' THEN @RevisionNumber ELSE NULL END,
            ViscApprovedFingerprint = CASE WHEN @Decision = N'approved' THEN @Fingerprint ELSE NULL END,
            ViscReviewComment = NULLIF(LTRIM(RTRIM(@Comment)), N''), UpdatedAtUtc = @Now
        WHERE TeachingAssignmentPackageId = @PackageId;
        INSERT paws.AuditEvent (AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid, ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson, RequestId, ImportBatchId)
        VALUES (NEWID(), N'TeachingAssignmentReviewRecorded', N'TeachingAssignmentPackage', CONVERT(nvarchar(36), @PackageId), @ActorFirebaseUid, @ActorName, @Now,
                (SELECT @OldStatus AS status, @RevisionNumber AS submittedRevision FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT CASE WHEN @Decision = N'approved' THEN N'visc_approved' ELSE N'changes_requested' END AS status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT @Decision AS decision, @Comment AS comment, @ResponsibilityId AS actorResponsibilityId, @RevisionId AS revisionId, @Fingerprint AS contentFingerprint FOR JSON PATH, WITHOUT_ARRAY_WRAPPER), NEWID(), NULL);
        COMMIT TRANSACTION;
        SELECT @PackageId AS packageId, @RevisionNumber AS reviewedRevision, @Decision AS decision,
               CASE WHEN @Decision = N'approved' THEN N'visc_approved' ELSE N'changes_requested' END AS status;
    END TRY BEGIN CATCH IF XACT_STATE() <> 0 ROLLBACK TRANSACTION; THROW; END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE paws_api.FinalSubmitTeachingAssignment
    @PackageId uniqueidentifier,
    @ExpectedWorkingRevision int,
    @ActorFirebaseUid nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorName nvarchar(260), @Now datetime2(7) = SYSUTCDATETIME();
    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (
            SELECT 1 FROM paws.TeachingAssignmentPackage WITH (UPDLOCK, HOLDLOCK)
            WHERE TeachingAssignmentPackageId = @PackageId AND WorkingRevision = @ExpectedWorkingRevision
              AND SubmittedWorkingRevision = @ExpectedWorkingRevision AND ViscApprovedWorkingRevision = @ExpectedWorkingRevision
              AND Status = N'visc_approved' AND ReviewFingerprint = ViscApprovedFingerprint
        ) THROW 52140, 'Stale revision or VISC approval required before final submit.', 1;
        IF paws_api.CanActOnTeachingAssignmentPackage(@PackageId, @ActorFirebaseUid, N'hicc') <> 1 THROW 52141, 'Current HICC package scope is required.', 1;
        SELECT @ActorName = DisplayName FROM paws.UserProfile WHERE FirebaseUid = @ActorFirebaseUid AND Active = 1 AND MustChangePassword = 0;
        UPDATE paws.TeachingAssignmentPackage SET Status = N'submitted_to_adfad', UpdatedAtUtc = @Now WHERE TeachingAssignmentPackageId = @PackageId;
        INSERT paws.AuditEvent (AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid, ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson, RequestId, ImportBatchId)
        VALUES (NEWID(), N'TeachingAssignmentFinalSubmitted', N'TeachingAssignmentPackage', CONVERT(nvarchar(36), @PackageId), @ActorFirebaseUid, @ActorName, @Now,
                (SELECT N'visc_approved' AS status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT N'submitted_to_adfad' AS status, @ExpectedWorkingRevision AS revision FOR JSON PATH, WITHOUT_ARRAY_WRAPPER), NULL, NEWID(), NULL);
        COMMIT TRANSACTION;
        SELECT @PackageId AS packageId, N'submitted_to_adfad' AS status, @ExpectedWorkingRevision AS revisionNumber;
    END TRY BEGIN CATCH IF XACT_STATE() <> 0 ROLLBACK TRANSACTION; THROW; END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE paws_api.SaveTeachingAssignmentFinalization
    @PackageId uniqueidentifier,
    @ExpectedWorkingRevision int,
    @AssignmentsJson nvarchar(max),
    @FinalNote nvarchar(2000) = NULL,
    @ActorFirebaseUid nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF ISJSON(@AssignmentsJson) <> 1 OR LEFT(LTRIM(@AssignmentsJson), 1) <> N'[' OR (SELECT COUNT(*) FROM OPENJSON(@AssignmentsJson)) > 200
       OR EXISTS (SELECT 1 FROM OPENJSON(@AssignmentsJson) WHERE [type] <> 5)
       OR EXISTS (SELECT 1 FROM OPENJSON(@AssignmentsJson) a CROSS APPLY OPENJSON(a.value) f WHERE f.[key] NOT IN (N'sessionId',N'facultyId',N'teachingRole'))
        THROW 52150, 'Final assignments must be a bounded array of canonical session/faculty IDs and roles.', 1;
    DECLARE @Rows TABLE (SessionId uniqueidentifier NOT NULL, FacultyId uniqueidentifier NOT NULL, TeachingRole nvarchar(256) NOT NULL, PRIMARY KEY(SessionId,FacultyId));
    INSERT @Rows SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.sessionId')), TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.facultyId')),
        NULLIF(LTRIM(RTRIM(JSON_VALUE(value,'$.teachingRole'))),N'') FROM OPENJSON(@AssignmentsJson);
    IF EXISTS (SELECT 1 FROM @Rows WHERE SessionId IS NULL OR FacultyId IS NULL OR TeachingRole IS NULL OR DATALENGTH(TeachingRole)>512)
        OR EXISTS (SELECT 1 FROM @Rows r WHERE NOT EXISTS(SELECT 1 FROM paws.Faculty f WHERE f.FacultyId=r.FacultyId AND f.Active=1))
        THROW 52150, 'Final assignments must resolve to active canonical Faculty.', 1;
    DECLARE @ActorName nvarchar(260), @AcademicYear nvarchar(32), @Version int, @FinalizationId uniqueidentifier=NEWID(), @Now datetime2(7)=SYSUTCDATETIME(), @Before nvarchar(max), @After nvarchar(max);
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @AcademicYear=AcademicYear FROM paws.TeachingAssignmentPackage WITH(UPDLOCK,HOLDLOCK)
        WHERE TeachingAssignmentPackageId=@PackageId AND WorkingRevision=@ExpectedWorkingRevision AND SubmittedWorkingRevision=@ExpectedWorkingRevision
          AND ViscApprovedWorkingRevision=@ExpectedWorkingRevision AND Status=N'submitted_to_adfad' AND ReviewFingerprint=ViscApprovedFingerprint;
        IF @AcademicYear IS NULL THROW 52151, 'Package is stale or has not passed HICC final submit.', 1;
        IF paws_api.CanActOnTeachingAssignmentPackage(@PackageId,@ActorFirebaseUid,N'adfad')<>1 THROW 52152, 'ADFAD administrator authority is required.', 1;
        IF EXISTS(SELECT 1 FROM @Rows r WHERE NOT EXISTS(SELECT 1 FROM paws.TeachingAssignmentRevisionSession rs JOIN paws.TeachingAssignmentRevision rev ON rev.RevisionId=rs.RevisionId WHERE rev.TeachingAssignmentPackageId=@PackageId AND rev.RevisionNumber=@ExpectedWorkingRevision AND rs.SessionId=r.SessionId))
            THROW 52153, 'A final assignment references a session outside the approved revision.', 1;
        SELECT @ActorName=DisplayName FROM paws.UserProfile WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
        SELECT @Version=COALESCE(MAX(VersionNumber),0)+1 FROM paws.TeachingAssignmentFinalization WITH(UPDLOCK,HOLDLOCK) WHERE TeachingAssignmentPackageId=@PackageId;
        SELECT @Before=(SELECT FinalizationId AS currentFinalizationId FROM paws.TeachingAssignmentCurrentFinalization WHERE TeachingAssignmentPackageId=@PackageId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
        INSERT paws.TeachingAssignmentFinalization(FinalizationId,TeachingAssignmentPackageId,RevisionId,RevisionNumber,VersionNumber,ActorFirebaseUid,ActorName,FinalNote,CreatedAtUtc)
        SELECT @FinalizationId,@PackageId,RevisionId,@ExpectedWorkingRevision,@Version,@ActorFirebaseUid,@ActorName,NULLIF(LTRIM(RTRIM(@FinalNote)),N''),@Now
        FROM paws.TeachingAssignmentRevision WHERE TeachingAssignmentPackageId=@PackageId AND RevisionNumber=@ExpectedWorkingRevision;
        INSERT paws.TeachingAssignmentFinalizationLine(FinalizationId,SessionAssignmentId,SessionId,FacultyId,FacultyDisplayName,TeachingRole)
        SELECT @FinalizationId,NEWID(),r.SessionId,r.FacultyId,f.DisplayName,r.TeachingRole FROM @Rows r JOIN paws.Faculty f ON f.FacultyId=r.FacultyId;
        IF EXISTS(SELECT 1 FROM paws.TeachingAssignmentCurrentFinalization WHERE TeachingAssignmentPackageId=@PackageId)
            UPDATE paws.TeachingAssignmentCurrentFinalization SET FinalizationId=@FinalizationId WHERE TeachingAssignmentPackageId=@PackageId;
        ELSE INSERT paws.TeachingAssignmentCurrentFinalization(TeachingAssignmentPackageId,FinalizationId) VALUES(@PackageId,@FinalizationId);
        UPDATE paws.TeachingAssignmentPackage SET Status=N'adfad_finalized',UpdatedAtUtc=@Now WHERE TeachingAssignmentPackageId=@PackageId;
        SET @After=(SELECT @FinalizationId AS finalizationId,@Version AS versionNumber,@ExpectedWorkingRevision AS revisionNumber FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson,RequestId,ImportBatchId)
        VALUES(NEWID(),N'TeachingAssignmentFinalized',N'TeachingAssignmentPackage',CONVERT(nvarchar(36),@PackageId),@ActorFirebaseUid,@ActorName,@Now,@Before,@After,
            (SELECT @FinalNote AS note,(SELECT COUNT(*) FROM @Rows) AS assignmentCount FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),NEWID(),NULL);
        COMMIT TRANSACTION;
        SELECT @PackageId AS packageId,@FinalizationId AS finalizationId,@Version AS versionNumber,N'adfad_finalized' AS status;
    END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION; THROW; END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE paws_api.PublishTeachingAssignmentRelease
    @AcademicYear nvarchar(32),
    @PublicationNote nvarchar(2000)=NULL,
    @ActorFirebaseUid nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorName nvarchar(260),@ReleaseId uniqueidentifier=NEWID(),@Now datetime2(7)=SYSUTCDATETIME(),@Version int,@Before nvarchar(max),@After nvarchar(max);
    IF @AcademicYear NOT LIKE '[1-9][0-9][0-9][0-9]-[0-9][0-9]' OR TRY_CONVERT(int,RIGHT(@AcademicYear,2))<>(TRY_CONVERT(int,LEFT(@AcademicYear,4))+1)%100
        THROW 52160,'Academic year is invalid.',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        IF paws_api.CanActOnTeachingAssignmentPackage(NULL,@ActorFirebaseUid,N'adfad')<>1 THROW 52161,'ADFAD administrator authority is required.',1;
        IF NOT EXISTS(SELECT 1 FROM paws.TeachingAssignmentPackage p JOIN paws.TeachingAssignmentCurrentFinalization cf ON cf.TeachingAssignmentPackageId=p.TeachingAssignmentPackageId WHERE p.AcademicYear=@AcademicYear AND p.Status=N'adfad_finalized')
            THROW 52162,'No finalized assignments are available to publish.',1;
        IF EXISTS(SELECT 1 FROM paws.TeachingAssignmentPackage p LEFT JOIN paws.TeachingAssignmentCurrentFinalization cf ON cf.TeachingAssignmentPackageId=p.TeachingAssignmentPackageId
          WHERE p.AcademicYear=@AcademicYear AND (p.Status<>N'adfad_finalized' OR cf.FinalizationId IS NULL))
            THROW 52163,'Unfinalized packages remain; publication must not omit package assignments.',1;
        SELECT @Version=COALESCE(MAX(VersionNumber),0)+1 FROM paws.TeachingAssignmentPublicationRelease WITH(UPDLOCK,HOLDLOCK) WHERE AcademicYear=@AcademicYear;
        SELECT @Before=(SELECT CurrentReleaseId AS currentReleaseId FROM paws.TeachingAssignmentPublicationState WHERE AcademicYear=@AcademicYear FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
        SELECT @ActorName=DisplayName FROM paws.UserProfile WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0;
        INSERT paws.TeachingAssignmentPublicationRelease(ReleaseId,AcademicYear,VersionNumber,PublishedAtUtc,PublishedByFirebaseUid,PublishedByName,PublicationNote)
        VALUES(@ReleaseId,@AcademicYear,@Version,@Now,@ActorFirebaseUid,@ActorName,NULLIF(LTRIM(RTRIM(@PublicationNote)),N''));
        INSERT paws.TeachingAssignmentPublishedSession(PublishedSessionId,ReleaseId,SessionId,CourseCode,CourseName,Topic,SessionType,SessionDate,StartTime,EndTime,Room,SourcePackageId,SourceRevisionNumber)
        SELECT NEWID(),@ReleaseId,s.SessionId,s.CourseCode,s.CourseName,s.Topic,s.SessionType,s.SessionDate,s.StartTime,s.EndTime,s.Room,p.TeachingAssignmentPackageId,cf.RevisionNumber
        FROM paws.TeachingAssignmentPackage p JOIN paws.TeachingAssignmentCurrentFinalization c ON c.TeachingAssignmentPackageId=p.TeachingAssignmentPackageId
        JOIN paws.TeachingAssignmentFinalization cf ON cf.FinalizationId=c.FinalizationId
        JOIN paws.TeachingAssignmentFinalizationLine fl ON fl.FinalizationId=cf.FinalizationId
        JOIN paws.Session s ON s.SessionId=fl.SessionId
        WHERE p.AcademicYear=@AcademicYear AND p.Status=N'adfad_finalized';
        INSERT paws.TeachingAssignmentPublishedInstructor(PublishedSessionId,FacultyId,FacultyDisplayName,TeachingRole)
        SELECT ps.PublishedSessionId,fl.FacultyId,fl.FacultyDisplayName,fl.TeachingRole
        FROM paws.TeachingAssignmentPublishedSession ps JOIN paws.TeachingAssignmentPackage p ON p.TeachingAssignmentPackageId=ps.SourcePackageId
        JOIN paws.TeachingAssignmentCurrentFinalization c ON c.TeachingAssignmentPackageId=p.TeachingAssignmentPackageId
        JOIN paws.TeachingAssignmentFinalizationLine fl ON fl.FinalizationId=c.FinalizationId AND fl.SessionId=ps.SessionId
        WHERE ps.ReleaseId=@ReleaseId;
        IF EXISTS(SELECT 1 FROM paws.TeachingAssignmentPublicationState WHERE AcademicYear=@AcademicYear)
            UPDATE paws.TeachingAssignmentPublicationState SET CurrentReleaseId=@ReleaseId WHERE AcademicYear=@AcademicYear;
        ELSE INSERT paws.TeachingAssignmentPublicationState(AcademicYear,CurrentReleaseId) VALUES(@AcademicYear,@ReleaseId);
        SET @After=(SELECT @ReleaseId AS releaseId,@Version AS versionNumber,@AcademicYear AS academicYear FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT paws.AuditEvent(AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson,RequestId,ImportBatchId)
        VALUES(NEWID(),N'TeachingAssignmentPublished',N'TeachingAssignmentPublicationRelease',CONVERT(nvarchar(36),@ReleaseId),@ActorFirebaseUid,@ActorName,@Now,@Before,@After,
            (SELECT @PublicationNote AS note FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),NEWID(),NULL);
        COMMIT TRANSACTION;
        SELECT @ReleaseId AS releaseId,@AcademicYear AS academicYear,@Version AS versionNumber,@Now AS publishedAtUtc;
    END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION; THROW; END CATCH;
END;
GO

COMMIT TRANSACTION;
GO
