/*
  PAWS Beta P2: authority foundation, normalized revisions, review history,
  ADFAD finalization, and immutable publication snapshots. This is additive
  schema only; write gates stay closed. Apply to VetMed-Ops with sqlcmd :ON ERROR EXIT.
*/
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 52000, 'Migration 020 must run in VetMed-Ops.', 1;

IF EXISTS (
    SELECT 1
    FROM sys.objects AS o
    INNER JOIN sys.schemas AS schemaInfo ON schemaInfo.schema_id = o.schema_id
    WHERE schemaInfo.name = N'paws'
      AND o.name IN (
          N'Subject', N'TeachingResponsibility', N'TeachingResponsibilityScope',
          N'TeachingResponsibilityAssignee', N'TeachingAssignmentGroup',
          N'TeachingAssignmentGroupHicc', N'TeachingAssignmentPackage',
          N'TeachingSessionOwnership'
      )
      AND o.type <> N'U'
)
    THROW 52007, 'A P2 authority object exists with an unexpected object type.', 1;

IF OBJECT_ID(N'staging.ImportBatch') IS NOT NULL AND OBJECT_ID(N'staging.ImportBatch', N'U') IS NULL
    THROW 52008, 'staging.ImportBatch exists with an unexpected object type.', 1;

IF OBJECT_ID(N'paws.Session', N'U') IS NULL
   OR OBJECT_ID(N'paws.SessionAssignment', N'U') IS NULL
   OR OBJECT_ID(N'paws.Faculty', N'U') IS NULL
   OR OBJECT_ID(N'paws.Course', N'U') IS NULL
   OR OBJECT_ID(N'paws.AuditEvent', N'U') IS NULL
   OR OBJECT_ID(N'paws.UserProfile', N'U') IS NULL
    THROW 52001, 'Migration 020 requires the canonical Beta session, course, faculty, audit, and user profile foundation.', 1;

DECLARE @AuthorityFoundationObjectCount int =
    (CASE WHEN OBJECT_ID(N'paws.Subject', N'U') IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN OBJECT_ID(N'paws.TeachingResponsibility', N'U') IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN OBJECT_ID(N'paws.TeachingResponsibilityScope', N'U') IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN OBJECT_ID(N'paws.TeachingResponsibilityAssignee', N'U') IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN OBJECT_ID(N'paws.TeachingAssignmentGroup', N'U') IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN OBJECT_ID(N'paws.TeachingAssignmentGroupHicc', N'U') IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN OBJECT_ID(N'paws.TeachingAssignmentPackage', N'U') IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN OBJECT_ID(N'paws.TeachingSessionOwnership', N'U') IS NULL THEN 0 ELSE 1 END);

IF @AuthorityFoundationObjectCount NOT IN (0, 8)
    THROW 52003, 'A partial authority foundation exists; inspect and reconcile it before migration 020.', 1;

IF @AuthorityFoundationObjectCount = 8 AND (
       COL_LENGTH(N'paws.Subject', N'SubjectKey') IS NULL
    OR COL_LENGTH(N'paws.TeachingResponsibility', N'Kind') IS NULL
    OR COL_LENGTH(N'paws.TeachingResponsibilityScope', N'SubjectId') IS NULL
    OR COL_LENGTH(N'paws.TeachingResponsibilityAssignee', N'ExpirationDate') IS NULL
    OR COL_LENGTH(N'paws.TeachingAssignmentGroup', N'LeaderViscResponsibilityId') IS NULL
    OR COL_LENGTH(N'paws.TeachingAssignmentGroupHicc', N'HiccResponsibilityId') IS NULL
    OR COL_LENGTH(N'paws.TeachingAssignmentPackage', N'WorkingRevision') IS NULL
    OR COL_LENGTH(N'paws.TeachingSessionOwnership', N'TeachingAssignmentPackageId') IS NULL
)
    THROW 52004, 'The existing authority foundation is structurally incompatible with migration 020.', 1;

IF OBJECT_ID(N'staging.ImportBatch', N'U') IS NOT NULL AND (
       COL_LENGTH(N'staging.ImportBatch', N'ImportBatchId') IS NULL
    OR COL_LENGTH(N'staging.ImportBatch', N'StartedAtUtc') IS NULL
    OR COL_LENGTH(N'staging.ImportBatch', N'Status') IS NULL
    OR COL_LENGTH(N'staging.ImportBatch', N'SourceManifestSha256') IS NULL
    OR COL_LENGTH(N'staging.ImportBatch', N'ImporterVersion') IS NULL
    OR COL_LENGTH(N'staging.ImportBatch', N'ValidationSummaryJson') IS NULL
)
    THROW 52005, 'The existing staging.ImportBatch is structurally incompatible with migration 020.', 1;

IF OBJECT_ID(N'paws.TeachingAssignmentRevision', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentRevisionSession', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentRevisionInstructor', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentContribution', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentReview', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentFinalization', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentFinalizationLine', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentCurrentFinalization', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentPublicationRelease', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentPublicationState', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentPublishedSession', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws.TeachingAssignmentPublishedInstructor', N'U') IS NOT NULL
   OR COL_LENGTH(N'paws.TeachingAssignmentPackage', N'DueAtUtc') IS NOT NULL
    THROW 52002, 'Migration 020 objects already exist; inspect the schema before retrying.', 1;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    IF SCHEMA_ID(N'staging') IS NULL EXEC(N'CREATE SCHEMA staging');

    IF OBJECT_ID(N'staging.ImportBatch', N'U') IS NULL
    BEGIN
        CREATE TABLE staging.ImportBatch (
            ImportBatchId uniqueidentifier NOT NULL CONSTRAINT PK_ImportBatch PRIMARY KEY,
            StartedAtUtc datetime2(7) NOT NULL,
            CompletedAtUtc datetime2(7) NULL,
            Status nvarchar(32) NOT NULL,
            SourceManifestSha256 char(64) NOT NULL,
            ImporterVersion nvarchar(64) NOT NULL,
            ActorUpn nvarchar(256) NULL,
            ValidationSummaryJson nvarchar(max) NOT NULL,
            CONSTRAINT CK_ImportBatch_ValidationJson CHECK (ISJSON(ValidationSummaryJson) = 1)
        );
    END;

    /*
      Migration 005 was marked repository-proposal-only and was not deployed on
      this Beta database. Install its P2 authority foundation atomically here
      when wholly absent. The preflight rejects a partial install above.
    */

IF OBJECT_ID(N'paws.Subject', N'U') IS NULL
BEGIN
    CREATE TABLE paws.Subject (
        SubjectId uniqueidentifier NOT NULL CONSTRAINT PK_Subject PRIMARY KEY,
        SubjectKey nvarchar(64) NOT NULL,
        SubjectKeyNormalized AS LOWER(LTRIM(RTRIM(SubjectKey))) PERSISTED,
        Label nvarchar(100) NOT NULL,
        Active bit NOT NULL,
        CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_Subject_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_Subject_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_Subject_Key CHECK (SubjectKey COLLATE Latin1_General_100_BIN2 = LOWER(LTRIM(RTRIM(SubjectKey))) COLLATE Latin1_General_100_BIN2 AND SubjectKey COLLATE Latin1_General_100_BIN2 LIKE '[a-z]%' AND SubjectKey COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^a-z0-9_-]%'),
        CONSTRAINT CK_Subject_Label CHECK (LEN(LTRIM(RTRIM(Label))) > 0)
    );
    CREATE UNIQUE INDEX UX_Subject_KeyNormalized ON paws.Subject(SubjectKeyNormalized);
END;

IF OBJECT_ID(N'paws.TeachingResponsibility', N'U') IS NULL
BEGIN
    CREATE TABLE paws.TeachingResponsibility (
        ResponsibilityId nvarchar(64) NOT NULL CONSTRAINT PK_TeachingResponsibility PRIMARY KEY,
        Kind nvarchar(16) NOT NULL,
        Label nvarchar(120) NOT NULL,
        Active bit NOT NULL,
        CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_TeachingResponsibility_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_TeachingResponsibility_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_TeachingResponsibility_IdKind UNIQUE (ResponsibilityId, Kind),
        CONSTRAINT CK_TeachingResponsibility_Id CHECK (ResponsibilityId COLLATE Latin1_General_100_BIN2 = LOWER(LTRIM(RTRIM(ResponsibilityId))) COLLATE Latin1_General_100_BIN2 AND ResponsibilityId COLLATE Latin1_General_100_BIN2 LIKE '[a-z]%' AND ResponsibilityId COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^a-z0-9_-]%'),
        CONSTRAINT CK_TeachingResponsibility_Kind CHECK (Kind COLLATE Latin1_General_100_BIN2 IN (N'hicc', N'visc')),
        CONSTRAINT CK_TeachingResponsibility_Label CHECK (LEN(LTRIM(RTRIM(Label))) > 0)
    );
END;

IF OBJECT_ID(N'paws.TeachingResponsibilityScope', N'U') IS NULL
BEGIN
    CREATE TABLE paws.TeachingResponsibilityScope (
        ResponsibilityScopeId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingResponsibilityScope PRIMARY KEY,
        HiccResponsibilityId nvarchar(64) NOT NULL,
        HiccResponsibilityKind nvarchar(16) NOT NULL CONSTRAINT DF_TeachingResponsibilityScope_Kind DEFAULT N'hicc',
        CourseId uniqueidentifier NOT NULL,
        SubjectId uniqueidentifier NULL,
        CONSTRAINT FK_TeachingResponsibilityScope_Responsibility FOREIGN KEY (HiccResponsibilityId, HiccResponsibilityKind) REFERENCES paws.TeachingResponsibility(ResponsibilityId, Kind),
        CONSTRAINT FK_TeachingResponsibilityScope_Course FOREIGN KEY (CourseId) REFERENCES paws.Course(CourseId),
        CONSTRAINT FK_TeachingResponsibilityScope_Subject FOREIGN KEY (SubjectId) REFERENCES paws.Subject(SubjectId),
        CONSTRAINT CK_TeachingResponsibilityScope_Kind CHECK (HiccResponsibilityKind COLLATE Latin1_General_100_BIN2 = N'hicc')
    );
    CREATE UNIQUE INDEX UX_TeachingResponsibilityScope_Subject ON paws.TeachingResponsibilityScope(HiccResponsibilityId, CourseId, SubjectId) WHERE SubjectId IS NOT NULL;
    CREATE UNIQUE INDEX UX_TeachingResponsibilityScope_CourseWide ON paws.TeachingResponsibilityScope(HiccResponsibilityId, CourseId) WHERE SubjectId IS NULL;
END;

IF OBJECT_ID(N'paws.TeachingResponsibilityAssignee', N'U') IS NULL
BEGIN
    CREATE TABLE paws.TeachingResponsibilityAssignee (
        ResponsibilityAssigneeId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingResponsibilityAssignee PRIMARY KEY,
        ResponsibilityId nvarchar(64) NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        FacultyId uniqueidentifier NOT NULL,
        ActiveDate date NOT NULL,
        ExpirationDate date NOT NULL,
        CONSTRAINT FK_TeachingResponsibilityAssignee_Responsibility FOREIGN KEY (ResponsibilityId) REFERENCES paws.TeachingResponsibility(ResponsibilityId),
        CONSTRAINT FK_TeachingResponsibilityAssignee_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId),
        CONSTRAINT UQ_TeachingResponsibilityAssignee_Window UNIQUE (ResponsibilityId, AcademicYear, FacultyId, ActiveDate),
        CONSTRAINT CK_TeachingResponsibilityAssignee_Dates CHECK (ExpirationDate > ActiveDate),
        CONSTRAINT CK_TeachingResponsibilityAssignee_AcademicYear CHECK (AcademicYear LIKE '[1-9][0-9][0-9][0-9]-[0-9][0-9]' AND TRY_CONVERT(int, LEFT(AcademicYear, 4)) IS NOT NULL AND TRY_CONVERT(int, RIGHT(AcademicYear, 2)) = (TRY_CONVERT(int, LEFT(AcademicYear, 4)) + 1) % 100)
    );
    CREATE INDEX IX_TeachingResponsibilityAssignee_ActorWindow ON paws.TeachingResponsibilityAssignee(FacultyId, AcademicYear, ActiveDate, ExpirationDate);
    CREATE INDEX IX_TeachingResponsibilityAssignee_ResponsibilityWindow ON paws.TeachingResponsibilityAssignee(ResponsibilityId, AcademicYear, ActiveDate, ExpirationDate);
END;

IF OBJECT_ID(N'paws.TeachingAssignmentGroup', N'U') IS NULL
BEGIN
    CREATE TABLE paws.TeachingAssignmentGroup (
        GroupId nvarchar(64) NOT NULL CONSTRAINT PK_TeachingAssignmentGroup PRIMARY KEY,
        Name nvarchar(120) NOT NULL,
        LeaderViscResponsibilityId nvarchar(64) NOT NULL,
        LeaderViscResponsibilityKind nvarchar(16) NOT NULL CONSTRAINT DF_TeachingAssignmentGroup_LeaderKind DEFAULT N'visc',
        Active bit NOT NULL,
        CONSTRAINT FK_TeachingAssignmentGroup_Visc FOREIGN KEY (LeaderViscResponsibilityId, LeaderViscResponsibilityKind) REFERENCES paws.TeachingResponsibility(ResponsibilityId, Kind),
        CONSTRAINT CK_TeachingAssignmentGroup_Id CHECK (GroupId COLLATE Latin1_General_100_BIN2 = LOWER(LTRIM(RTRIM(GroupId))) COLLATE Latin1_General_100_BIN2 AND GroupId COLLATE Latin1_General_100_BIN2 LIKE '[a-z]%' AND GroupId COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^a-z0-9_-]%'),
        CONSTRAINT CK_TeachingAssignmentGroup_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
        CONSTRAINT CK_TeachingAssignmentGroup_LeaderKind CHECK (LeaderViscResponsibilityKind COLLATE Latin1_General_100_BIN2 = N'visc')
    );
END;

IF OBJECT_ID(N'paws.TeachingAssignmentGroupHicc', N'U') IS NULL
BEGIN
    CREATE TABLE paws.TeachingAssignmentGroupHicc (
        GroupId nvarchar(64) NOT NULL,
        HiccResponsibilityId nvarchar(64) NOT NULL,
        HiccResponsibilityKind nvarchar(16) NOT NULL CONSTRAINT DF_TeachingAssignmentGroupHicc_Kind DEFAULT N'hicc',
        CONSTRAINT PK_TeachingAssignmentGroupHicc PRIMARY KEY (GroupId, HiccResponsibilityId),
        CONSTRAINT FK_TeachingAssignmentGroupHicc_Group FOREIGN KEY (GroupId) REFERENCES paws.TeachingAssignmentGroup(GroupId),
        CONSTRAINT FK_TeachingAssignmentGroupHicc_Hicc FOREIGN KEY (HiccResponsibilityId, HiccResponsibilityKind) REFERENCES paws.TeachingResponsibility(ResponsibilityId, Kind),
        CONSTRAINT CK_TeachingAssignmentGroupHicc_Kind CHECK (HiccResponsibilityKind COLLATE Latin1_General_100_BIN2 = N'hicc')
    );
END;

IF OBJECT_ID(N'paws.TeachingAssignmentPackage', N'U') IS NULL
BEGIN
    CREATE TABLE paws.TeachingAssignmentPackage (
        TeachingAssignmentPackageId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingAssignmentPackage PRIMARY KEY,
        PackageIdentity nvarchar(256) NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        GroupId nvarchar(64) NOT NULL,
        HiccResponsibilityId nvarchar(64) NOT NULL,
        HiccResponsibilityKind nvarchar(16) NOT NULL CONSTRAINT DF_TeachingAssignmentPackage_HiccKind DEFAULT N'hicc',
        Status nvarchar(32) NOT NULL,
        WorkingRevision int NOT NULL,
        SubmittedWorkingRevision int NULL,
        ViscApprovedWorkingRevision int NULL,
        ReviewFingerprint varchar(64) NULL,
        ViscApprovedFingerprint varchar(64) NULL,
        ViscReviewComment nvarchar(2000) NULL,
        CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_TeachingAssignmentPackage_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_TeachingAssignmentPackage_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_TeachingAssignmentPackage_Identity UNIQUE (PackageIdentity),
        CONSTRAINT UQ_TeachingAssignmentPackage_Tuple UNIQUE (AcademicYear, GroupId, HiccResponsibilityId),
        CONSTRAINT UQ_TeachingAssignmentPackage_TupleWithId UNIQUE (AcademicYear, GroupId, HiccResponsibilityId, TeachingAssignmentPackageId),
        CONSTRAINT FK_TeachingAssignmentPackage_Group FOREIGN KEY (GroupId) REFERENCES paws.TeachingAssignmentGroup(GroupId),
        CONSTRAINT FK_TeachingAssignmentPackage_Hicc FOREIGN KEY (HiccResponsibilityId, HiccResponsibilityKind) REFERENCES paws.TeachingResponsibility(ResponsibilityId, Kind),
        CONSTRAINT FK_TeachingAssignmentPackage_GroupHicc FOREIGN KEY (GroupId, HiccResponsibilityId) REFERENCES paws.TeachingAssignmentGroupHicc(GroupId, HiccResponsibilityId),
        CONSTRAINT CK_TeachingAssignmentPackage_Identity CHECK (PackageIdentity = N'ta-package-v1__' + AcademicYear + N'__' + GroupId + N'__' + HiccResponsibilityId),
        CONSTRAINT CK_TeachingAssignmentPackage_HiccKind CHECK (HiccResponsibilityKind COLLATE Latin1_General_100_BIN2 = N'hicc'),
        CONSTRAINT CK_TeachingAssignmentPackage_AcademicYear CHECK (AcademicYear LIKE '[1-9][0-9][0-9][0-9]-[0-9][0-9]' AND TRY_CONVERT(int, LEFT(AcademicYear, 4)) IS NOT NULL AND TRY_CONVERT(int, RIGHT(AcademicYear, 2)) = (TRY_CONVERT(int, LEFT(AcademicYear, 4)) + 1) % 100),
        CONSTRAINT CK_TeachingAssignmentPackage_Status CHECK (Status COLLATE Latin1_General_100_BIN2 IN (N'draft', N'visc_review', N'visc_approved', N'changes_requested', N'submitted_to_adfad', N'adfad_finalized')),
        CONSTRAINT CK_TeachingAssignmentPackage_Revisions CHECK (WorkingRevision >= 0 AND (SubmittedWorkingRevision IS NULL OR SubmittedWorkingRevision >= 0) AND (ViscApprovedWorkingRevision IS NULL OR ViscApprovedWorkingRevision >= 0)),
        CONSTRAINT CK_TeachingAssignmentPackage_ReviewFingerprint CHECK (ReviewFingerprint IS NULL OR (DATALENGTH(ReviewFingerprint) = 64 AND ReviewFingerprint COLLATE Latin1_General_100_BIN2 = LOWER(ReviewFingerprint) COLLATE Latin1_General_100_BIN2 AND ReviewFingerprint COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9a-f]%')),
        CONSTRAINT CK_TeachingAssignmentPackage_ApprovedFingerprint CHECK (ViscApprovedFingerprint IS NULL OR (DATALENGTH(ViscApprovedFingerprint) = 64 AND ViscApprovedFingerprint COLLATE Latin1_General_100_BIN2 = LOWER(ViscApprovedFingerprint) COLLATE Latin1_General_100_BIN2 AND ViscApprovedFingerprint COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9a-f]%'))
    );
    CREATE INDEX IX_TeachingAssignmentPackage_GroupHicc ON paws.TeachingAssignmentPackage(GroupId, HiccResponsibilityId, AcademicYear);
END;

IF OBJECT_ID(N'paws.TeachingSessionOwnership', N'U') IS NULL
BEGIN
    CREATE TABLE paws.TeachingSessionOwnership (
        SessionOwnershipId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingSessionOwnership PRIMARY KEY,
        SessionId uniqueidentifier NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        TeachingAssignmentGroupId nvarchar(64) NOT NULL,
        ResponsibleHiccResponsibilityId nvarchar(64) NOT NULL,
        TeachingAssignmentPackageId uniqueidentifier NOT NULL,
        SubjectId uniqueidentifier NULL,
        CONSTRAINT UQ_TeachingSessionOwnership_Session UNIQUE (SessionId),
        CONSTRAINT FK_TeachingSessionOwnership_Session FOREIGN KEY (SessionId) REFERENCES paws.Session(SessionId),
        CONSTRAINT FK_TeachingSessionOwnership_Group FOREIGN KEY (TeachingAssignmentGroupId) REFERENCES paws.TeachingAssignmentGroup(GroupId),
        CONSTRAINT FK_TeachingSessionOwnership_Hicc FOREIGN KEY (ResponsibleHiccResponsibilityId) REFERENCES paws.TeachingResponsibility(ResponsibilityId),
        CONSTRAINT FK_TeachingSessionOwnership_PackageTuple FOREIGN KEY (AcademicYear, TeachingAssignmentGroupId, ResponsibleHiccResponsibilityId, TeachingAssignmentPackageId) REFERENCES paws.TeachingAssignmentPackage(AcademicYear, GroupId, HiccResponsibilityId, TeachingAssignmentPackageId),
        CONSTRAINT FK_TeachingSessionOwnership_Subject FOREIGN KEY (SubjectId) REFERENCES paws.Subject(SubjectId),
        CONSTRAINT CK_TeachingSessionOwnership_AcademicYear CHECK (AcademicYear LIKE '[1-9][0-9][0-9][0-9]-[0-9][0-9]' AND TRY_CONVERT(int, LEFT(AcademicYear, 4)) IS NOT NULL AND TRY_CONVERT(int, RIGHT(AcademicYear, 2)) = (TRY_CONVERT(int, LEFT(AcademicYear, 4)) + 1) % 100)
    );
    CREATE INDEX IX_TeachingSessionOwnership_Package ON paws.TeachingSessionOwnership(TeachingAssignmentPackageId, SessionId);
END;
    IF COL_LENGTH(N'paws.TeachingResponsibilityAssignee', N'AssignmentMode') IS NULL
    BEGIN
        IF EXISTS (SELECT 1 FROM paws.TeachingResponsibilityAssignee)
            THROW 52006, 'Existing responsibility assignees require explicit AssignmentMode classification.', 1;

        ALTER TABLE paws.TeachingResponsibilityAssignee
            ADD AssignmentMode nvarchar(16) NOT NULL
                CONSTRAINT DF_TeachingResponsibilityAssignee_AssignmentMode DEFAULT (N'exclusive') WITH VALUES;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE name = N'CK_TeachingResponsibilityAssignee_AssignmentMode'
          AND parent_object_id = OBJECT_ID(N'paws.TeachingResponsibilityAssignee')
    )
        ALTER TABLE paws.TeachingResponsibilityAssignee
            ADD CONSTRAINT CK_TeachingResponsibilityAssignee_AssignmentMode
            CHECK (AssignmentMode COLLATE Latin1_General_100_BIN2 IN (N'exclusive', N'concurrent'));

    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(N'paws.TeachingResponsibilityAssignee')
          AND name = N'ExpirationDate' AND is_nullable = 0
    )
        ALTER TABLE paws.TeachingResponsibilityAssignee ALTER COLUMN ExpirationDate date NULL;

    ALTER TABLE paws.TeachingAssignmentPackage ADD DueAtUtc datetime2(7) NULL;

    CREATE TABLE paws.TeachingAssignmentRevision (
        RevisionId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingAssignmentRevision PRIMARY KEY,
        TeachingAssignmentPackageId uniqueidentifier NOT NULL,
        RevisionNumber int NOT NULL,
        CreatedByFirebaseUid nvarchar(128) NOT NULL,
        CreatedByName nvarchar(260) NOT NULL,
        CreatedAtUtc datetime2(7) NOT NULL,
        RevisionNote nvarchar(1000) NULL,
        CONSTRAINT UQ_TeachingAssignmentRevision_PackageNumber UNIQUE (TeachingAssignmentPackageId, RevisionNumber),
        CONSTRAINT UQ_TeachingAssignmentRevision_IdPackage UNIQUE (RevisionId, TeachingAssignmentPackageId),
        CONSTRAINT FK_TeachingAssignmentRevision_Package FOREIGN KEY (TeachingAssignmentPackageId) REFERENCES paws.TeachingAssignmentPackage(TeachingAssignmentPackageId),
        CONSTRAINT CK_TeachingAssignmentRevision_Number CHECK (RevisionNumber > 0),
        CONSTRAINT CK_TeachingAssignmentRevision_Actor CHECK (LEN(LTRIM(RTRIM(CreatedByFirebaseUid))) > 0 AND LEN(LTRIM(RTRIM(CreatedByName))) > 0)
    );

    CREATE TABLE paws.TeachingAssignmentRevisionSession (
        RevisionId uniqueidentifier NOT NULL,
        TeachingAssignmentPackageId uniqueidentifier NOT NULL,
        SessionId uniqueidentifier NOT NULL,
        SessionOrder int NOT NULL,
        CONSTRAINT PK_TeachingAssignmentRevisionSession PRIMARY KEY (RevisionId, SessionId),
        CONSTRAINT UQ_TeachingAssignmentRevisionSession_Order UNIQUE (RevisionId, SessionOrder),
        CONSTRAINT FK_TeachingAssignmentRevisionSession_Revision FOREIGN KEY (RevisionId, TeachingAssignmentPackageId) REFERENCES paws.TeachingAssignmentRevision(RevisionId, TeachingAssignmentPackageId),
        CONSTRAINT FK_TeachingAssignmentRevisionSession_Session FOREIGN KEY (SessionId) REFERENCES paws.Session(SessionId),
        CONSTRAINT CK_TeachingAssignmentRevisionSession_Order CHECK (SessionOrder >= 0)
    );

    CREATE TABLE paws.TeachingAssignmentRevisionInstructor (
        RevisionId uniqueidentifier NOT NULL,
        SessionId uniqueidentifier NOT NULL,
        FacultyId uniqueidentifier NOT NULL,
        TeachingRole nvarchar(256) NOT NULL,
        CONSTRAINT PK_TeachingAssignmentRevisionInstructor PRIMARY KEY (RevisionId, SessionId, FacultyId),
        CONSTRAINT FK_TeachingAssignmentRevisionInstructor_Session FOREIGN KEY (RevisionId, SessionId) REFERENCES paws.TeachingAssignmentRevisionSession(RevisionId, SessionId),
        CONSTRAINT FK_TeachingAssignmentRevisionInstructor_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId),
        CONSTRAINT CK_TeachingAssignmentRevisionInstructor_Role CHECK (LEN(LTRIM(RTRIM(TeachingRole))) > 0 AND DATALENGTH(TeachingRole) <= 512)
    );

    CREATE TABLE paws.TeachingAssignmentContribution (
        ContributionId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingAssignmentContribution PRIMARY KEY,
        TeachingAssignmentPackageId uniqueidentifier NOT NULL,
        RevisionNumber int NOT NULL,
        SessionId uniqueidentifier NOT NULL,
        CandidateKey nvarchar(128) NOT NULL,
        SuggestedDisplayName nvarchar(260) NOT NULL,
        SuggestedByOffice nvarchar(16) NOT NULL,
        ActorFirebaseUid nvarchar(128) NOT NULL,
        ActorName nvarchar(260) NOT NULL,
        Note nvarchar(1000) NULL,
        CreatedAtUtc datetime2(7) NOT NULL,
        CONSTRAINT UQ_TeachingAssignmentContribution_Candidate UNIQUE (TeachingAssignmentPackageId, RevisionNumber, SessionId, CandidateKey, SuggestedByOffice),
        CONSTRAINT FK_TeachingAssignmentContribution_Package FOREIGN KEY (TeachingAssignmentPackageId) REFERENCES paws.TeachingAssignmentPackage(TeachingAssignmentPackageId),
        CONSTRAINT FK_TeachingAssignmentContribution_Session FOREIGN KEY (SessionId) REFERENCES paws.Session(SessionId),
        CONSTRAINT CK_TeachingAssignmentContribution_Revision CHECK (RevisionNumber > 0),
        CONSTRAINT CK_TeachingAssignmentContribution_Candidate CHECK (LEN(LTRIM(RTRIM(CandidateKey))) > 0 AND DATALENGTH(CandidateKey) <= 256),
        CONSTRAINT CK_TeachingAssignmentContribution_Display CHECK (LEN(LTRIM(RTRIM(SuggestedDisplayName))) > 0 AND DATALENGTH(SuggestedDisplayName) <= 520),
        CONSTRAINT CK_TeachingAssignmentContribution_Office CHECK (SuggestedByOffice COLLATE Latin1_General_100_BIN2 IN (N'adc', N'lab', N'hicc')),
        CONSTRAINT CK_TeachingAssignmentContribution_Actor CHECK (LEN(LTRIM(RTRIM(ActorFirebaseUid))) > 0 AND LEN(LTRIM(RTRIM(ActorName))) > 0)
    );
    CREATE INDEX IX_TeachingAssignmentContribution_PackageRevision ON paws.TeachingAssignmentContribution(TeachingAssignmentPackageId, RevisionNumber, CreatedAtUtc);

    CREATE TABLE paws.TeachingAssignmentReview (
        ReviewId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingAssignmentReview PRIMARY KEY,
        TeachingAssignmentPackageId uniqueidentifier NOT NULL,
        RevisionId uniqueidentifier NOT NULL,
        RevisionNumber int NOT NULL,
        Decision nvarchar(24) NOT NULL,
        Comment nvarchar(2000) NULL,
        ActorFirebaseUid nvarchar(128) NOT NULL,
        ActorName nvarchar(260) NOT NULL,
        ActorResponsibilityId nvarchar(64) NOT NULL,
        CreatedAtUtc datetime2(7) NOT NULL,
        ContentFingerprint char(64) NOT NULL,
        CONSTRAINT FK_TeachingAssignmentReview_Revision FOREIGN KEY (RevisionId, TeachingAssignmentPackageId) REFERENCES paws.TeachingAssignmentRevision(RevisionId, TeachingAssignmentPackageId),
        CONSTRAINT FK_TeachingAssignmentReview_Responsibility FOREIGN KEY (ActorResponsibilityId) REFERENCES paws.TeachingResponsibility(ResponsibilityId),
        CONSTRAINT CK_TeachingAssignmentReview_Decision CHECK (Decision COLLATE Latin1_General_100_BIN2 IN (N'approved', N'push_back')),
        CONSTRAINT CK_TeachingAssignmentReview_Comment CHECK (Decision <> N'push_back' OR NULLIF(LTRIM(RTRIM(Comment)), N'') IS NOT NULL),
        CONSTRAINT CK_TeachingAssignmentReview_Fingerprint CHECK (DATALENGTH(ContentFingerprint) = 64 AND ContentFingerprint COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9a-f]%'),
        CONSTRAINT CK_TeachingAssignmentReview_Actor CHECK (LEN(LTRIM(RTRIM(ActorFirebaseUid))) > 0 AND LEN(LTRIM(RTRIM(ActorName))) > 0 AND RevisionNumber > 0)
    );
    CREATE INDEX IX_TeachingAssignmentReview_PackageHistory ON paws.TeachingAssignmentReview(TeachingAssignmentPackageId, CreatedAtUtc, RevisionNumber);

    CREATE TABLE paws.TeachingAssignmentFinalization (
        FinalizationId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingAssignmentFinalization PRIMARY KEY,
        TeachingAssignmentPackageId uniqueidentifier NOT NULL,
        RevisionId uniqueidentifier NOT NULL,
        RevisionNumber int NOT NULL,
        VersionNumber int NOT NULL,
        ActorFirebaseUid nvarchar(128) NOT NULL,
        ActorName nvarchar(260) NOT NULL,
        FinalNote nvarchar(2000) NULL,
        CreatedAtUtc datetime2(7) NOT NULL,
        CONSTRAINT UQ_TeachingAssignmentFinalization_PackageVersion UNIQUE (TeachingAssignmentPackageId, VersionNumber),
        CONSTRAINT UQ_TeachingAssignmentFinalization_IdPackage UNIQUE (FinalizationId, TeachingAssignmentPackageId),
        CONSTRAINT FK_TeachingAssignmentFinalization_Revision FOREIGN KEY (RevisionId, TeachingAssignmentPackageId) REFERENCES paws.TeachingAssignmentRevision(RevisionId, TeachingAssignmentPackageId),
        CONSTRAINT CK_TeachingAssignmentFinalization_Version CHECK (VersionNumber > 0 AND RevisionNumber > 0),
        CONSTRAINT CK_TeachingAssignmentFinalization_Actor CHECK (LEN(LTRIM(RTRIM(ActorFirebaseUid))) > 0 AND LEN(LTRIM(RTRIM(ActorName))) > 0)
    );

    CREATE TABLE paws.TeachingAssignmentCurrentFinalization (
        TeachingAssignmentPackageId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingAssignmentCurrentFinalization PRIMARY KEY,
        FinalizationId uniqueidentifier NOT NULL,
        CONSTRAINT FK_TeachingAssignmentCurrentFinalization_Finalization FOREIGN KEY (FinalizationId, TeachingAssignmentPackageId) REFERENCES paws.TeachingAssignmentFinalization(FinalizationId, TeachingAssignmentPackageId)
    );

    CREATE TABLE paws.TeachingAssignmentFinalizationLine (
        FinalizationId uniqueidentifier NOT NULL,
        SessionAssignmentId uniqueidentifier NOT NULL,
        SessionId uniqueidentifier NOT NULL,
        FacultyId uniqueidentifier NOT NULL,
        FacultyDisplayName nvarchar(260) NOT NULL,
        TeachingRole nvarchar(256) NOT NULL,
        CONSTRAINT PK_TeachingAssignmentFinalizationLine PRIMARY KEY (FinalizationId, SessionAssignmentId),
        CONSTRAINT FK_TeachingAssignmentFinalizationLine_Finalization FOREIGN KEY (FinalizationId) REFERENCES paws.TeachingAssignmentFinalization(FinalizationId),
        CONSTRAINT FK_TeachingAssignmentFinalizationLine_Session FOREIGN KEY (SessionId) REFERENCES paws.Session(SessionId),
        CONSTRAINT FK_TeachingAssignmentFinalizationLine_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId)
    );

    CREATE TABLE paws.TeachingAssignmentPublicationRelease (
        ReleaseId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingAssignmentPublicationRelease PRIMARY KEY,
        AcademicYear nvarchar(32) NOT NULL,
        VersionNumber int NOT NULL,
        PublishedAtUtc datetime2(7) NOT NULL,
        PublishedByFirebaseUid nvarchar(128) NOT NULL,
        PublishedByName nvarchar(260) NOT NULL,
        PublicationNote nvarchar(2000) NULL,
        CONSTRAINT UQ_TeachingAssignmentPublicationRelease_YearVersion UNIQUE (AcademicYear, VersionNumber),
        CONSTRAINT UQ_TeachingAssignmentPublicationRelease_IdYear UNIQUE (ReleaseId, AcademicYear),
        CONSTRAINT CK_TeachingAssignmentPublicationRelease_AcademicYear CHECK (AcademicYear LIKE '[1-9][0-9][0-9][0-9]-[0-9][0-9]' AND TRY_CONVERT(int, RIGHT(AcademicYear, 2)) = (TRY_CONVERT(int, LEFT(AcademicYear, 4)) + 1) % 100),
        CONSTRAINT CK_TeachingAssignmentPublicationRelease_Actor CHECK (VersionNumber > 0 AND LEN(LTRIM(RTRIM(PublishedByFirebaseUid))) > 0 AND LEN(LTRIM(RTRIM(PublishedByName))) > 0)
    );

    CREATE TABLE paws.TeachingAssignmentPublicationState (
        AcademicYear nvarchar(32) NOT NULL CONSTRAINT PK_TeachingAssignmentPublicationState PRIMARY KEY,
        CurrentReleaseId uniqueidentifier NOT NULL,
        CONSTRAINT FK_TeachingAssignmentPublicationState_Release FOREIGN KEY (CurrentReleaseId, AcademicYear) REFERENCES paws.TeachingAssignmentPublicationRelease(ReleaseId, AcademicYear)
    );

    CREATE TABLE paws.TeachingAssignmentPublishedSession (
        PublishedSessionId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingAssignmentPublishedSession PRIMARY KEY,
        ReleaseId uniqueidentifier NOT NULL,
        SessionId uniqueidentifier NOT NULL,
        CourseCode nvarchar(32) NULL,
        CourseName nvarchar(512) NULL,
        Topic nvarchar(max) NULL,
        SessionType nvarchar(128) NULL,
        SessionDate date NULL,
        StartTime time(0) NULL,
        EndTime time(0) NULL,
        Room nvarchar(256) NULL,
        SourcePackageId uniqueidentifier NULL,
        SourceRevisionNumber int NULL,
        CONSTRAINT UQ_TeachingAssignmentPublishedSession_ReleaseSession UNIQUE (ReleaseId, SessionId),
        CONSTRAINT FK_TeachingAssignmentPublishedSession_Release FOREIGN KEY (ReleaseId) REFERENCES paws.TeachingAssignmentPublicationRelease(ReleaseId),
        CONSTRAINT FK_TeachingAssignmentPublishedSession_Session FOREIGN KEY (SessionId) REFERENCES paws.Session(SessionId),
        CONSTRAINT FK_TeachingAssignmentPublishedSession_Package FOREIGN KEY (SourcePackageId) REFERENCES paws.TeachingAssignmentPackage(TeachingAssignmentPackageId)
    );

    CREATE TABLE paws.TeachingAssignmentPublishedInstructor (
        PublishedSessionId uniqueidentifier NOT NULL,
        FacultyId uniqueidentifier NOT NULL,
        FacultyDisplayName nvarchar(260) NOT NULL,
        TeachingRole nvarchar(256) NOT NULL,
        CONSTRAINT PK_TeachingAssignmentPublishedInstructor PRIMARY KEY (PublishedSessionId, FacultyId, TeachingRole),
        CONSTRAINT FK_TeachingAssignmentPublishedInstructor_Session FOREIGN KEY (PublishedSessionId) REFERENCES paws.TeachingAssignmentPublishedSession(PublishedSessionId),
        CONSTRAINT FK_TeachingAssignmentPublishedInstructor_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId)
    );
    CREATE INDEX IX_TeachingAssignmentPublicationRelease_YearVersion ON paws.TeachingAssignmentPublicationRelease(AcademicYear, VersionNumber DESC);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
