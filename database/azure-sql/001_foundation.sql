SET NOCOUNT ON;
SET XACT_ABORT ON;

IF SCHEMA_ID(N'staging') IS NULL EXEC(N'CREATE SCHEMA staging');
IF SCHEMA_ID(N'paws') IS NULL EXEC(N'CREATE SCHEMA paws');

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

CREATE TABLE staging.ImportWorkbook (
    ImportWorkbookId uniqueidentifier NOT NULL CONSTRAINT PK_ImportWorkbook PRIMARY KEY,
    ImportBatchId uniqueidentifier NOT NULL,
    FileName nvarchar(512) NOT NULL,
    FileSha256 char(64) NOT NULL,
    FileByteLength bigint NOT NULL,
    CONSTRAINT FK_ImportWorkbook_Batch FOREIGN KEY (ImportBatchId) REFERENCES staging.ImportBatch(ImportBatchId)
);

CREATE TABLE staging.ImportSheet (
    ImportSheetId uniqueidentifier NOT NULL CONSTRAINT PK_ImportSheet PRIMARY KEY,
    ImportWorkbookId uniqueidentifier NOT NULL,
    SheetName nvarchar(256) NOT NULL,
    SheetIndex int NOT NULL,
    MaxRow int NOT NULL,
    MaxColumn int NOT NULL,
    NonEmptyRowCount int NOT NULL,
    CONSTRAINT FK_ImportSheet_Workbook FOREIGN KEY (ImportWorkbookId) REFERENCES staging.ImportWorkbook(ImportWorkbookId)
);

CREATE TABLE staging.ImportRow (
    ImportRowId uniqueidentifier NOT NULL CONSTRAINT PK_ImportRow PRIMARY KEY,
    ImportSheetId uniqueidentifier NOT NULL,
    SourceRowNumber int NOT NULL,
    RawJson nvarchar(max) NOT NULL,
    FormulaJson nvarchar(max) NULL,
    ValidationStatus nvarchar(32) NOT NULL,
    ValidationErrorsJson nvarchar(max) NOT NULL,
    CONSTRAINT FK_ImportRow_Sheet FOREIGN KEY (ImportSheetId) REFERENCES staging.ImportSheet(ImportSheetId),
    CONSTRAINT CK_ImportRow_RawJson CHECK (ISJSON(RawJson) = 1),
    CONSTRAINT CK_ImportRow_FormulaJson CHECK (FormulaJson IS NULL OR ISJSON(FormulaJson) = 1),
    CONSTRAINT CK_ImportRow_ErrorsJson CHECK (ISJSON(ValidationErrorsJson) = 1)
);

CREATE TABLE staging.PackageEntity (
    PackageEntityId uniqueidentifier NOT NULL CONSTRAINT PK_PackageEntity PRIMARY KEY,
    ImportBatchId uniqueidentifier NOT NULL,
    EntityKind nvarchar(128) NOT NULL,
    SourceFileName nvarchar(512) NULL,
    SourceRowNumber int NULL,
    PayloadJson nvarchar(max) NOT NULL,
    CONSTRAINT FK_PackageEntity_Batch FOREIGN KEY (ImportBatchId) REFERENCES staging.ImportBatch(ImportBatchId),
    CONSTRAINT CK_PackageEntity_PayloadJson CHECK (ISJSON(PayloadJson) = 1)
);
CREATE INDEX IX_PackageEntity_Kind ON staging.PackageEntity(EntityKind);

CREATE TABLE staging.FacultyRaw (
    ImportBatchId uniqueidentifier NOT NULL,
    ImportRowId uniqueidentifier NOT NULL CONSTRAINT PK_FacultyRaw PRIMARY KEY,
    SourceRowNumber int NOT NULL,
    PreferredSourceName nvarchar(256) NULL,
    Ucid nvarchar(64) NULL,
    Email nvarchar(256) NULL,
    RawJson nvarchar(max) NOT NULL,
    ValidationStatus nvarchar(32) NOT NULL,
    ValidationErrorsJson nvarchar(max) NOT NULL
);
CREATE TABLE staging.FacultyProfessionalRaw (
    ImportBatchId uniqueidentifier NOT NULL,
    ImportRowId uniqueidentifier NOT NULL CONSTRAINT PK_FacultyProfessionalRaw PRIMARY KEY,
    SourceRowNumber int NOT NULL,
    PreferredSourceName nvarchar(256) NULL,
    RawJson nvarchar(max) NOT NULL,
    ValidationStatus nvarchar(32) NOT NULL,
    ValidationErrorsJson nvarchar(max) NOT NULL
);
CREATE TABLE staging.JointAppointmentRaw (
    ImportBatchId uniqueidentifier NOT NULL,
    ImportRowId uniqueidentifier NOT NULL CONSTRAINT PK_JointAppointmentRaw PRIMARY KEY,
    SourceRowNumber int NOT NULL,
    PreferredSourceName nvarchar(256) NULL,
    RawJson nvarchar(max) NOT NULL,
    ValidationStatus nvarchar(32) NOT NULL,
    ValidationErrorsJson nvarchar(max) NOT NULL
);
CREATE TABLE staging.FacultyOverviewRaw (
    ImportBatchId uniqueidentifier NOT NULL,
    ImportRowId uniqueidentifier NOT NULL CONSTRAINT PK_FacultyOverviewRaw PRIMARY KEY,
    SourceRowNumber int NOT NULL,
    FacultySourceName nvarchar(256) NULL,
    RawJson nvarchar(max) NOT NULL,
    ValidationStatus nvarchar(32) NOT NULL,
    ValidationErrorsJson nvarchar(max) NOT NULL
);
CREATE TABLE staging.TeachingAssignmentRaw (
    ImportBatchId uniqueidentifier NOT NULL,
    ImportRowId uniqueidentifier NOT NULL CONSTRAINT PK_TeachingAssignmentRaw PRIMARY KEY,
    SourceRowNumber int NOT NULL,
    FacultySourceName nvarchar(256) NULL,
    AcademicYear nvarchar(32) NULL,
    CourseCode nvarchar(32) NULL,
    SessionDate date NULL,
    StartTime time(0) NULL,
    EndTime time(0) NULL,
    RawJson nvarchar(max) NOT NULL,
    ValidationStatus nvarchar(32) NOT NULL,
    ValidationErrorsJson nvarchar(max) NOT NULL
);
CREATE TABLE staging.RoleAssignmentRaw (
    ImportBatchId uniqueidentifier NOT NULL,
    ImportRowId uniqueidentifier NOT NULL CONSTRAINT PK_RoleAssignmentRaw PRIMARY KEY,
    SourceRowNumber int NOT NULL,
    FacultySourceName nvarchar(256) NULL,
    AcademicYear nvarchar(32) NULL,
    RoleType nvarchar(256) NULL,
    CourseCode nvarchar(1000) NULL,
    RawJson nvarchar(max) NOT NULL,
    ValidationStatus nvarchar(32) NOT NULL,
    ValidationErrorsJson nvarchar(max) NOT NULL
);
CREATE TABLE staging.CourseRaw (
    ImportBatchId uniqueidentifier NOT NULL,
    ImportRowId uniqueidentifier NOT NULL CONSTRAINT PK_CourseRaw PRIMARY KEY,
    SourceRowNumber int NOT NULL,
    CourseCode nvarchar(32) NULL,
    CourseName nvarchar(512) NULL,
    RawJson nvarchar(max) NOT NULL,
    ValidationStatus nvarchar(32) NOT NULL,
    ValidationErrorsJson nvarchar(max) NOT NULL
);
CREATE TABLE staging.DoeRuleRaw (
    ImportBatchId uniqueidentifier NOT NULL,
    ImportRowId uniqueidentifier NOT NULL CONSTRAINT PK_DoeRuleRaw PRIMARY KEY,
    SourceRowNumber int NOT NULL,
    Category nvarchar(256) NULL,
    RuleLabel nvarchar(256) NULL,
    RawJson nvarchar(max) NOT NULL,
    ValidationStatus nvarchar(32) NOT NULL,
    ValidationErrorsJson nvarchar(max) NOT NULL
);
CREATE TABLE staging.AccountRoleRaw (
    ImportBatchId uniqueidentifier NOT NULL,
    ImportRowId uniqueidentifier NOT NULL CONSTRAINT PK_AccountRoleRaw PRIMARY KEY,
    SourceRowNumber int NOT NULL,
    DatabaseRole nvarchar(128) NULL,
    RawJson nvarchar(max) NOT NULL,
    ValidationStatus nvarchar(32) NOT NULL,
    ValidationErrorsJson nvarchar(max) NOT NULL
);
CREATE TABLE staging.AfcRecordRaw (
    ImportBatchId uniqueidentifier NOT NULL,
    ImportRowId uniqueidentifier NOT NULL CONSTRAINT PK_AfcRecordRaw PRIMARY KEY,
    SourceRowNumber int NOT NULL,
    FacultySourceName nvarchar(256) NULL,
    StartDate date NULL,
    EndDate date NULL,
    Purpose nvarchar(1000) NULL,
    RawJson nvarchar(max) NOT NULL,
    ValidationStatus nvarchar(32) NOT NULL,
    ValidationErrorsJson nvarchar(max) NOT NULL
);

CREATE TABLE paws.Faculty (
    FacultyId uniqueidentifier NOT NULL CONSTRAINT PK_Faculty PRIMARY KEY,
    RecordType nvarchar(32) NOT NULL,
    PreferredFirstName nvarchar(128) NULL,
    PreferredLastName nvarchar(128) NULL,
    DisplayName nvarchar(260) NOT NULL,
    Ucid nvarchar(64) NULL,
    Email nvarchar(256) NULL,
    Stream nvarchar(128) NULL,
    Rank nvarchar(128) NULL,
    Fte decimal(6,4) NULL,
    ReportsToFacultyId uniqueidentifier NULL,
    ReportsToRaw nvarchar(256) NULL,
    Active bit NOT NULL,
    SourceImportBatchId uniqueidentifier NOT NULL,
    SourceRow int NULL,
    CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_Faculty_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_Faculty_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Faculty_ReportsTo FOREIGN KEY (ReportsToFacultyId) REFERENCES paws.Faculty(FacultyId),
    CONSTRAINT FK_Faculty_ImportBatch FOREIGN KEY (SourceImportBatchId) REFERENCES staging.ImportBatch(ImportBatchId)
);
CREATE UNIQUE INDEX UX_Faculty_Ucid ON paws.Faculty(Ucid) WHERE Ucid IS NOT NULL;
CREATE UNIQUE INDEX UX_Faculty_Email ON paws.Faculty(Email) WHERE Email IS NOT NULL;

CREATE TABLE paws.FacultyAlias (
    FacultyAliasId uniqueidentifier NOT NULL CONSTRAINT PK_FacultyAlias PRIMARY KEY,
    FacultyId uniqueidentifier NOT NULL,
    AliasName nvarchar(256) NOT NULL,
    TargetPreferredSourceName nvarchar(256) NOT NULL,
    TargetDisplayName nvarchar(260) NOT NULL,
    Active bit NOT NULL,
    SourceImportBatchId uniqueidentifier NOT NULL,
    CONSTRAINT FK_FacultyAlias_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId),
    CONSTRAINT UQ_FacultyAlias_Alias UNIQUE (AliasName)
);

CREATE TABLE paws.FacultyProfessionalProfile (
    FacultyId uniqueidentifier NOT NULL CONSTRAINT PK_FacultyProfessionalProfile PRIMARY KEY,
    TeachingArea nvarchar(512) NULL,
    ProfessionalCategory nvarchar(256) NULL,
    ServiceDate date NULL,
    PriorYearsExperience decimal(8,2) NULL,
    DvmEarnedDate nvarchar(64) NULL,
    DvmType nvarchar(256) NULL,
    MastersEarnedDate nvarchar(64) NULL,
    MastersArea nvarchar(max) NULL,
    PhdEarnedDate nvarchar(64) NULL,
    PhdArea nvarchar(max) NULL,
    BoardCertifiedDate nvarchar(64) NULL,
    BoardCertification nvarchar(max) NULL,
    BoardCertificationCount decimal(8,2) NULL,
    AbvmaLicenseNumber nvarchar(128) NULL,
    AbvmaMemberType nvarchar(512) NULL,
    SourceImportBatchId uniqueidentifier NOT NULL,
    SourceRow int NULL,
    CONSTRAINT FK_FacultyProfessionalProfile_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId)
);

CREATE TABLE paws.JointAppointment (
    JointAppointmentId uniqueidentifier NOT NULL CONSTRAINT PK_JointAppointment PRIMARY KEY,
    FacultyId uniqueidentifier NOT NULL,
    HomeFaculty nvarchar(256) NULL,
    JointFaculty nvarchar(256) NULL,
    FteUcvm decimal(6,4) NULL,
    FteOtherFaculty decimal(6,4) NULL,
    ExpiryDate date NULL,
    Notes nvarchar(max) NULL,
    SourceImportBatchId uniqueidentifier NOT NULL,
    SourceRow int NULL,
    CONSTRAINT FK_JointAppointment_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId)
);

CREATE TABLE paws.Course (
    CourseId uniqueidentifier NOT NULL CONSTRAINT PK_Course PRIMARY KEY,
    CourseCode nvarchar(32) NOT NULL,
    CourseName nvarchar(512) NULL,
    NameStatus nvarchar(256) NULL,
    Source nvarchar(512) NULL,
    SourceUrl nvarchar(2048) NULL,
    SourceImportBatchId uniqueidentifier NOT NULL,
    SourceRow int NULL,
    CONSTRAINT UQ_Course_Code UNIQUE (CourseCode)
);

CREATE TABLE paws.Session (
    SessionId uniqueidentifier NOT NULL CONSTRAINT PK_Session PRIMARY KEY,
    AcademicYear nvarchar(32) NOT NULL,
    CurriculumYear nvarchar(64) NULL,
    CourseId uniqueidentifier NULL,
    CourseCode nvarchar(32) NULL,
    CourseName nvarchar(512) NULL,
    Topic nvarchar(max) NULL,
    SessionType nvarchar(128) NULL,
    SessionDate date NULL,
    StartTime time(0) NULL,
    EndTime time(0) NULL,
    Room nvarchar(256) NULL,
    SourceImportBatchId uniqueidentifier NOT NULL,
    CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_Session_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_Session_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Session_Course FOREIGN KEY (CourseId) REFERENCES paws.Course(CourseId)
);

CREATE TABLE paws.SessionAssignment (
    SessionAssignmentId uniqueidentifier NOT NULL CONSTRAINT PK_SessionAssignment PRIMARY KEY,
    SessionId uniqueidentifier NOT NULL,
    FacultyId uniqueidentifier NULL,
    SourceFacultyName nvarchar(256) NULL,
    FacultyResolutionStatus nvarchar(32) NOT NULL,
    TeachingRole nvarchar(256) NULL,
    LabLead nvarchar(128) NULL,
    CreditedHours decimal(12,4) NULL,
    DoeRate decimal(12,6) NULL,
    DoeQuantity decimal(12,4) NULL,
    DoeUnit nvarchar(128) NULL,
    DoeCredit decimal(12,6) NULL,
    DoeStatus nvarchar(512) NULL,
    SourceImportBatchId uniqueidentifier NOT NULL,
    SourceRow int NOT NULL,
    CONSTRAINT FK_SessionAssignment_Session FOREIGN KEY (SessionId) REFERENCES paws.Session(SessionId),
    CONSTRAINT FK_SessionAssignment_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId)
);

CREATE TABLE paws.AfcRecord (
    AfcRecordId uniqueidentifier NOT NULL CONSTRAINT PK_AfcRecord PRIMARY KEY,
    FacultyId uniqueidentifier NOT NULL,
    StartDate date NOT NULL,
    EndDate date NOT NULL,
    Purpose nvarchar(1000) NULL,
    Active bit NOT NULL,
    SourceImportBatchId uniqueidentifier NOT NULL,
    SourceRow int NOT NULL,
    CONSTRAINT FK_AfcRecord_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId),
    CONSTRAINT CK_AfcRecord_DateRange CHECK (EndDate >= StartDate)
);

CREATE TABLE paws.RoleAssignment (
    RoleAssignmentId uniqueidentifier NOT NULL CONSTRAINT PK_RoleAssignment PRIMARY KEY,
    FacultyId uniqueidentifier NULL,
    SourceFacultyName nvarchar(256) NULL,
    FacultyResolutionStatus nvarchar(32) NOT NULL,
    AcademicYear nvarchar(32) NULL,
    RoleCategory nvarchar(128) NULL,
    RoleType nvarchar(256) NULL,
    CourseId uniqueidentifier NULL,
    CourseOrSubjectOrRotation nvarchar(1000) NULL,
    CourseName nvarchar(512) NULL,
    Details nvarchar(max) NULL,
    EffectiveDate date NULL,
    ExpirationDate date NULL,
    DoeMappedValue decimal(12,6) NULL,
    DoeOverrideValue decimal(12,6) NULL,
    DoeOverrideReason nvarchar(1000) NULL,
    SpecialNotes nvarchar(max) NULL,
    SourceImportBatchId uniqueidentifier NOT NULL,
    SourceRow int NOT NULL,
    CONSTRAINT FK_RoleAssignment_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId),
    CONSTRAINT FK_RoleAssignment_Course FOREIGN KEY (CourseId) REFERENCES paws.Course(CourseId),
    CONSTRAINT CK_RoleAssignment_DateRange CHECK (ExpirationDate IS NULL OR EffectiveDate IS NULL OR ExpirationDate > EffectiveDate)
);

CREATE TABLE paws.DoeRuleSeed (
    DoeRuleSeedId uniqueidentifier NOT NULL CONSTRAINT PK_DoeRuleSeed PRIMARY KEY,
    Category nvarchar(256) NULL,
    RuleLabel nvarchar(256) NULL,
    AcademicYearOrStage nvarchar(128) NULL,
    RateOrTierPct nvarchar(256) NULL,
    Basis nvarchar(512) NULL,
    RequiredInput nvarchar(512) NULL,
    CalculationOrNote nvarchar(max) NULL,
    AuthoritativeInExcel nvarchar(256) NULL,
    SourceUrl nvarchar(2048) NULL,
    RawJson nvarchar(max) NOT NULL,
    SourceImportBatchId uniqueidentifier NOT NULL,
    SourceRow int NOT NULL,
    CONSTRAINT CK_DoeRuleSeed_RawJson CHECK (ISJSON(RawJson) = 1)
);

CREATE TABLE paws.RoleDefinition (
    RoleDefinitionId uniqueidentifier NOT NULL CONSTRAINT PK_RoleDefinition PRIMARY KEY,
    DatabaseRole nvarchar(128) NOT NULL,
    Category nvarchar(128) NULL,
    FacultyLinked nvarchar(32) NULL,
    FacultyRolesAllowed nvarchar(128) NULL,
    DefaultOfficeAccess nvarchar(256) NULL,
    OfficeAccessNotes nvarchar(max) NULL,
    CurrentStatusNotes nvarchar(max) NULL,
    SourceUrl nvarchar(2048) NULL,
    SourceImportBatchId uniqueidentifier NOT NULL,
    SourceRow int NOT NULL,
    CONSTRAINT UQ_RoleDefinition_DatabaseRole UNIQUE (DatabaseRole)
);

CREATE TABLE paws.UserProfile (
    FirebaseUid nvarchar(128) NOT NULL CONSTRAINT PK_UserProfile PRIMARY KEY,
    Email nvarchar(256) NOT NULL,
    DisplayName nvarchar(260) NOT NULL,
    BaseRole nvarchar(128) NOT NULL,
    FacultyId uniqueidentifier NULL,
    Active bit NOT NULL,
    MustChangePassword bit NOT NULL,
    OfficeName nvarchar(256) NULL,
    CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_UserProfile_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_UserProfile_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_UserProfile_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId)
);

CREATE TABLE paws.AuditEvent (
    AuditEventId uniqueidentifier NOT NULL CONSTRAINT PK_AuditEvent PRIMARY KEY,
    EventType nvarchar(128) NOT NULL,
    EntityType nvarchar(128) NOT NULL,
    EntityId nvarchar(256) NOT NULL,
    ActorFirebaseUid nvarchar(128) NULL,
    ActorName nvarchar(260) NULL,
    OccurredAtUtc datetime2(7) NOT NULL,
    BeforeJson nvarchar(max) NULL,
    AfterJson nvarchar(max) NULL,
    MetadataJson nvarchar(max) NULL,
    RequestId uniqueidentifier NULL,
    ImportBatchId uniqueidentifier NULL,
    CONSTRAINT CK_AuditEvent_BeforeJson CHECK (BeforeJson IS NULL OR ISJSON(BeforeJson) = 1),
    CONSTRAINT CK_AuditEvent_AfterJson CHECK (AfterJson IS NULL OR ISJSON(AfterJson) = 1),
    CONSTRAINT CK_AuditEvent_MetadataJson CHECK (MetadataJson IS NULL OR ISJSON(MetadataJson) = 1)
);
