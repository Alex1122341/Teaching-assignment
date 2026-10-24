/* BETA-R4D-12A1 repository proposal only. SessionAssignment remains authoritative for final faculty assignment. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

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
