/*
  P4: Annual DOE Rule Book, mapping, assignment-fact, and immutable evidence domain.
  VetMed-Ops only. Existing DOE policy/target/allocation identities are evolved;
  legacy Faculty and RoleAssignment evidence is deliberately not rewritten.
*/
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF SCHEMA_ID(N'paws') IS NULL
       OR OBJECT_ID(N'paws.Faculty', N'U') IS NULL
       OR OBJECT_ID(N'paws.DoePolicyVersion', N'U') IS NULL
       OR OBJECT_ID(N'paws.DoeFacultyTarget', N'U') IS NULL
       OR OBJECT_ID(N'paws.DoeRuleSeed', N'U') IS NULL
        THROW 52500, 'P4 requires the accepted DOE target, policy-version, rule-seed, and Faculty foundations.', 1;

    IF COL_LENGTH(N'paws.DoePolicyVersion', N'Status') IS NULL
        ALTER TABLE paws.DoePolicyVersion ADD Status nvarchar(16) NULL;
    IF COL_LENGTH(N'paws.DoePolicyVersion', N'Revision') IS NULL
        ALTER TABLE paws.DoePolicyVersion ADD Revision bigint NULL;
    IF COL_LENGTH(N'paws.DoePolicyVersion', N'UpdatedBy') IS NULL
        ALTER TABLE paws.DoePolicyVersion ADD UpdatedBy nvarchar(128) NULL;
    IF COL_LENGTH(N'paws.DoePolicyVersion', N'ValidatedRevision') IS NULL
        ALTER TABLE paws.DoePolicyVersion ADD ValidatedRevision bigint NULL;
    IF COL_LENGTH(N'paws.DoePolicyVersion', N'ValidatedChecksum') IS NULL
        ALTER TABLE paws.DoePolicyVersion ADD ValidatedChecksum char(64) NULL;
    IF COL_LENGTH(N'paws.DoePolicyVersion', N'ImpactRevision') IS NULL
        ALTER TABLE paws.DoePolicyVersion ADD ImpactRevision bigint NULL;
    IF COL_LENGTH(N'paws.DoePolicyVersion', N'ImpactChecksum') IS NULL
        ALTER TABLE paws.DoePolicyVersion ADD ImpactChecksum char(64) NULL;

    IF EXISTS (SELECT AcademicYear FROM paws.DoePolicyVersion WHERE Active=1 GROUP BY AcademicYear HAVING COUNT_BIG(*)>1)
        THROW 52501, 'P4 requires one existing Active DOE policy version per academic year.', 1;

    /* Compile column references only after the conditional ALTER TABLE statements above. */
    EXEC sys.sp_executesql N'
        UPDATE paws.DoePolicyVersion
           SET Status = COALESCE(Status, CASE WHEN Active = 1 THEN N''active'' ELSE N''archived'' END),
               Revision = COALESCE(Revision, 0);

        IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N''paws.DoePolicyVersion'') AND name=N''DF_DoePolicyVersion_Status'')
            ALTER TABLE paws.DoePolicyVersion ADD CONSTRAINT DF_DoePolicyVersion_Status DEFAULT (N''draft'') FOR Status;
        IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N''paws.DoePolicyVersion'') AND name=N''DF_DoePolicyVersion_Revision'')
            ALTER TABLE paws.DoePolicyVersion ADD CONSTRAINT DF_DoePolicyVersion_Revision DEFAULT (0) FOR Revision;
        IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N''paws.DoePolicyVersion'') AND name=N''Status'' AND is_nullable=1)
            ALTER TABLE paws.DoePolicyVersion ALTER COLUMN Status nvarchar(16) NOT NULL;
        IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N''paws.DoePolicyVersion'') AND name=N''Revision'' AND is_nullable=1)
            ALTER TABLE paws.DoePolicyVersion ALTER COLUMN Revision bigint NOT NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N''paws.DoePolicyVersion'') AND name=N''CK_DoePolicyVersion_Status'')
            ALTER TABLE paws.DoePolicyVersion ADD CONSTRAINT CK_DoePolicyVersion_Status CHECK (Status IN (N''draft'',N''active'',N''archived''));
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N''paws.DoePolicyVersion'') AND name=N''UX_DoePolicyVersion_OneActiveYear'')
            CREATE UNIQUE INDEX UX_DoePolicyVersion_OneActiveYear ON paws.DoePolicyVersion(AcademicYear) WHERE Status=N''active'';
    ';

    IF OBJECT_ID(N'paws.DoePolicyRule', N'U') IS NULL
    CREATE TABLE paws.DoePolicyRule (
        RuleId uniqueidentifier NOT NULL CONSTRAINT PK_DoePolicyRule PRIMARY KEY,
        PolicyVersionId uniqueidentifier NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        RuleKey nvarchar(128) NOT NULL,
        Category nvarchar(64) NOT NULL,
        ActivityType nvarchar(128) NULL,
        RuleLabel nvarchar(256) NOT NULL,
        Priority int NOT NULL CONSTRAINT DF_DoePolicyRule_Priority DEFAULT (0),
        CalculationMode nvarchar(40) NOT NULL,
        TierStrategy nvarchar(32) NULL,
        FormulaText nvarchar(1000) NULL,
        MappingRequirement nvarchar(16) NULL,
        ResultKind nvarchar(16) NOT NULL CONSTRAINT DF_DoePolicyRule_ResultKind DEFAULT (N'credit'),
        ReferenceId uniqueidentifier NULL,
        Enabled bit NOT NULL CONSTRAINT DF_DoePolicyRule_Enabled DEFAULT (1),
        ReviewStatus nvarchar(32) NOT NULL CONSTRAINT DF_DoePolicyRule_ReviewStatus DEFAULT (N'needs_review'),
        CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoePolicyRule_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoePolicyRule_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_DoePolicyRule_PolicyYear FOREIGN KEY(PolicyVersionId,AcademicYear) REFERENCES paws.DoePolicyVersion(PolicyVersionId,AcademicYear),
        CONSTRAINT UQ_DoePolicyRule_VersionKey UNIQUE(PolicyVersionId,RuleKey),
        CONSTRAINT CK_DoePolicyRule_Category CHECK(Category IN(N'teaching',N'assigned_teaching',N'course_coordination',N'rotation',N'supervision',N'hicc',N'visc',N'reserve',N'adjustment',N'exception',N'approved_activity',N'target',N'other')),
        CONSTRAINT CK_DoePolicyRule_Mode CHECK(CalculationMode IN(N'fixed',N'per_hour',N'per_shift',N'per_week',N'per_trainee',N'tiered',N'minimum',N'capped',N'percentage_of_target',N'prorated',N'formula')),
        CONSTRAINT CK_DoePolicyRule_Mapping CHECK(MappingRequirement IS NULL OR MappingRequirement IN(N'course',N'subject'))
    );

    IF OBJECT_ID(N'paws.DoeRuleSelector', N'U') IS NULL
    CREATE TABLE paws.DoeRuleSelector (
        SelectorId uniqueidentifier NOT NULL CONSTRAINT PK_DoeRuleSelector PRIMARY KEY,
        RuleId uniqueidentifier NOT NULL,
        FieldName nvarchar(128) NOT NULL,
        Operator nvarchar(16) NOT NULL,
        ValueType nvarchar(16) NOT NULL,
        ValueText nvarchar(1000) NULL,
        ValueNumber decimal(18,6) NULL,
        ValuesJson nvarchar(2000) NULL,
        CONSTRAINT FK_DoeRuleSelector_Rule FOREIGN KEY(RuleId) REFERENCES paws.DoePolicyRule(RuleId),
        CONSTRAINT CK_DoeRuleSelector_Operator CHECK(Operator IN(N'equals',N'not_equals',N'in',N'not_in',N'gt',N'gte',N'lt',N'lte')),
        CONSTRAINT CK_DoeRuleSelector_ValueType CHECK(ValueType IN(N'text',N'number',N'list')),
        CONSTRAINT CK_DoeRuleSelector_ValuesJson CHECK(ValuesJson IS NULL OR ISJSON(ValuesJson)=1)
    );

    IF OBJECT_ID(N'paws.DoeRuleParameter', N'U') IS NULL
    CREATE TABLE paws.DoeRuleParameter (
        ParameterId uniqueidentifier NOT NULL CONSTRAINT PK_DoeRuleParameter PRIMARY KEY,
        RuleId uniqueidentifier NOT NULL,
        Name nvarchar(128) NOT NULL,
        ValueNumber decimal(18,6) NULL,
        ValueText nvarchar(1000) NULL,
        CONSTRAINT FK_DoeRuleParameter_Rule FOREIGN KEY(RuleId) REFERENCES paws.DoePolicyRule(RuleId),
        CONSTRAINT UQ_DoeRuleParameter_RuleName UNIQUE(RuleId,Name),
        CONSTRAINT CK_DoeRuleParameter_Value CHECK(
            (ValueNumber IS NULL AND ValueText IS NOT NULL)
            OR (ValueNumber IS NOT NULL AND ValueText IS NULL)
        )
    );

    IF OBJECT_ID(N'paws.DoeRuleTier', N'U') IS NULL
    CREATE TABLE paws.DoeRuleTier (
        TierId uniqueidentifier NOT NULL CONSTRAINT PK_DoeRuleTier PRIMARY KEY,
        RuleId uniqueidentifier NOT NULL,
        TierOrder int NOT NULL,
        FromValue decimal(18,6) NOT NULL,
        ToValue decimal(18,6) NULL,
        Rate decimal(18,6) NULL,
        FixedCredit decimal(18,6) NULL,
        CONSTRAINT FK_DoeRuleTier_Rule FOREIGN KEY(RuleId) REFERENCES paws.DoePolicyRule(RuleId),
        CONSTRAINT UQ_DoeRuleTier_Order UNIQUE(RuleId,TierOrder),
        CONSTRAINT CK_DoeRuleTier_Range CHECK(ToValue IS NULL OR ToValue>FromValue),
        CONSTRAINT CK_DoeRuleTier_Value CHECK(
            (Rate IS NULL AND FixedCredit IS NOT NULL)
            OR (Rate IS NOT NULL AND FixedCredit IS NULL)
        )
    );

    IF OBJECT_ID(N'paws.DoeRuleInput', N'U') IS NULL
    CREATE TABLE paws.DoeRuleInput (
        RuleInputId uniqueidentifier NOT NULL CONSTRAINT PK_DoeRuleInput PRIMARY KEY,
        RuleId uniqueidentifier NOT NULL,
        InputName nvarchar(128) NOT NULL,
        Source nvarchar(256) NULL,
        Required bit NOT NULL CONSTRAINT DF_DoeRuleInput_Required DEFAULT (1),
        CONSTRAINT FK_DoeRuleInput_Rule FOREIGN KEY(RuleId) REFERENCES paws.DoePolicyRule(RuleId),
        CONSTRAINT UQ_DoeRuleInput_Name UNIQUE(RuleId,InputName)
    );

    IF OBJECT_ID(N'paws.DoeReferenceSource', N'U') IS NULL
    CREATE TABLE paws.DoeReferenceSource (
        ReferenceId uniqueidentifier NOT NULL CONSTRAINT PK_DoeReferenceSource PRIMARY KEY,
        PolicyVersionId uniqueidentifier NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        Title nvarchar(256) NOT NULL,
        Section nvarchar(256) NULL,
        TableName nvarchar(128) NULL,
        PageNumber int NULL,
        EffectiveDate date NULL,
        SourceReference nvarchar(1000) NULL,
        DocumentLink nvarchar(1000) NULL,
        Notes nvarchar(2000) NULL,
        ReviewStatus nvarchar(32) NOT NULL CONSTRAINT DF_DoeReferenceSource_ReviewStatus DEFAULT (N'needs_review'),
        CONSTRAINT FK_DoeReferenceSource_PolicyYear FOREIGN KEY(PolicyVersionId,AcademicYear) REFERENCES paws.DoePolicyVersion(PolicyVersionId,AcademicYear),
        CONSTRAINT UQ_DoeReferenceSource_PolicyEvidence UNIQUE(ReferenceId,PolicyVersionId,AcademicYear),
        CONSTRAINT CK_DoeReferenceSource_Page CHECK(PageNumber IS NULL OR PageNumber>0)
    );

    IF OBJECT_ID(N'paws.DoeCourseMapping', N'U') IS NULL
    CREATE TABLE paws.DoeCourseMapping (
        MappingId uniqueidentifier NOT NULL CONSTRAINT PK_DoeCourseMapping PRIMARY KEY,
        PolicyVersionId uniqueidentifier NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        CourseCode nvarchar(64) NOT NULL,
        UnitCount decimal(10,4) NULL,
        CurriculumStage nvarchar(64) NULL,
        HiccEligible bit NULL,
        MappingFactsJson nvarchar(4000) NULL,
        ReferenceId uniqueidentifier NULL,
        ReviewStatus nvarchar(32) NOT NULL CONSTRAINT DF_DoeCourseMapping_ReviewStatus DEFAULT (N'needs_review'),
        Enabled bit NOT NULL CONSTRAINT DF_DoeCourseMapping_Enabled DEFAULT (1),
        CONSTRAINT FK_DoeCourseMapping_PolicyYear FOREIGN KEY(PolicyVersionId,AcademicYear) REFERENCES paws.DoePolicyVersion(PolicyVersionId,AcademicYear),
        CONSTRAINT CK_DoeCourseMapping_Units CHECK(UnitCount IS NULL OR UnitCount>0),
        CONSTRAINT CK_DoeCourseMapping_Facts CHECK(MappingFactsJson IS NULL OR ISJSON(MappingFactsJson)=1)
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'paws.DoeCourseMapping') AND name=N'UX_DoeCourseMapping_EnabledCode')
        CREATE UNIQUE INDEX UX_DoeCourseMapping_EnabledCode ON paws.DoeCourseMapping(PolicyVersionId,CourseCode) WHERE Enabled=1;

    IF OBJECT_ID(N'paws.DoeSubjectMapping', N'U') IS NULL
    CREATE TABLE paws.DoeSubjectMapping (
        MappingId uniqueidentifier NOT NULL CONSTRAINT PK_DoeSubjectMapping PRIMARY KEY,
        PolicyVersionId uniqueidentifier NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        SubjectKey nvarchar(128) NOT NULL,
        SubjectName nvarchar(256) NOT NULL,
        CurriculumStage nvarchar(64) NULL,
        DevelopmentPhase nvarchar(64) NULL,
        MappingFactsJson nvarchar(4000) NULL,
        ReferenceId uniqueidentifier NULL,
        ReviewStatus nvarchar(32) NOT NULL CONSTRAINT DF_DoeSubjectMapping_ReviewStatus DEFAULT (N'needs_review'),
        Enabled bit NOT NULL CONSTRAINT DF_DoeSubjectMapping_Enabled DEFAULT (1),
        CONSTRAINT FK_DoeSubjectMapping_PolicyYear FOREIGN KEY(PolicyVersionId,AcademicYear) REFERENCES paws.DoePolicyVersion(PolicyVersionId,AcademicYear),
        CONSTRAINT CK_DoeSubjectMapping_Facts CHECK(MappingFactsJson IS NULL OR ISJSON(MappingFactsJson)=1)
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'paws.DoeSubjectMapping') AND name=N'UX_DoeSubjectMapping_EnabledKey')
        CREATE UNIQUE INDEX UX_DoeSubjectMapping_EnabledKey ON paws.DoeSubjectMapping(PolicyVersionId,SubjectKey) WHERE Enabled=1;

    IF OBJECT_ID(N'paws.DoePolicyException', N'U') IS NULL
    CREATE TABLE paws.DoePolicyException (
        ExceptionId uniqueidentifier NOT NULL CONSTRAINT PK_DoePolicyException PRIMARY KEY,
        PolicyVersionId uniqueidentifier NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        Category nvarchar(64) NULL,
        ScopeType nvarchar(32) NOT NULL,
        ScopeKey nvarchar(256) NULL,
        FacultyId uniqueidentifier NULL,
        FixedDoe decimal(12,6) NOT NULL,
        ResultKind nvarchar(16) NOT NULL CONSTRAINT DF_DoePolicyException_ResultKind DEFAULT (N'credit'),
        Reason nvarchar(1000) NOT NULL,
        SourceReference nvarchar(1000) NOT NULL,
        EffectiveStart date NULL,
        EffectiveEnd date NULL,
        Recurring bit NOT NULL CONSTRAINT DF_DoePolicyException_Recurring DEFAULT (0),
        Enabled bit NOT NULL CONSTRAINT DF_DoePolicyException_Enabled DEFAULT (1),
        ReviewStatus nvarchar(32) NOT NULL CONSTRAINT DF_DoePolicyException_ReviewStatus DEFAULT (N'needs_review'),
        CONSTRAINT FK_DoePolicyException_PolicyYear FOREIGN KEY(PolicyVersionId,AcademicYear) REFERENCES paws.DoePolicyVersion(PolicyVersionId,AcademicYear),
        CONSTRAINT CK_DoePolicyException_Scope CHECK(ScopeType=N'global' OR ScopeKey IS NOT NULL),
        CONSTRAINT CK_DoePolicyException_Range CHECK(EffectiveEnd IS NULL OR EffectiveStart IS NULL OR EffectiveEnd>=EffectiveStart),
        CONSTRAINT CK_DoePolicyException_Doe CHECK(FixedDoe>=0)
    );

    IF OBJECT_ID(N'paws.DoeCalculationRecord', N'U') IS NULL
    CREATE TABLE paws.DoeCalculationRecord (
        CalculationId uniqueidentifier NOT NULL CONSTRAINT PK_DoeCalculationRecord PRIMARY KEY,
        AcademicYear nvarchar(32) NOT NULL,
        PolicyVersionId uniqueidentifier NOT NULL,
        RuleId uniqueidentifier NULL,
        RuleKey nvarchar(128) NULL,
        ExceptionId uniqueidentifier NULL,
        Category nvarchar(64) NOT NULL,
        FacultyId uniqueidentifier NULL,
        SessionId uniqueidentifier NULL,
        AssignmentId nvarchar(128) NULL,
        SourceEntityType nvarchar(64) NULL,
        SourceEntityId nvarchar(128) NULL,
        FactsSnapshotJson nvarchar(max) NOT NULL,
        InputsSnapshotJson nvarchar(max) NOT NULL,
        ParameterSnapshotJson nvarchar(max) NOT NULL,
        RuleSnapshotJson nvarchar(max) NOT NULL,
        ReferenceSnapshotJson nvarchar(max) NULL,
        CalculationText nvarchar(2000) NOT NULL,
        ResultDoe decimal(12,6) NULL,
        CalculationStatus nvarchar(24) NOT NULL CONSTRAINT DF_DoeCalculationRecord_Status DEFAULT (N'calculated'),
        CalculationTrigger nvarchar(64) NOT NULL,
        CalculatedBy nvarchar(128) NOT NULL,
        CalculatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoeCalculationRecord_CalculatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_DoeCalculationRecord_PolicyYear FOREIGN KEY(PolicyVersionId,AcademicYear) REFERENCES paws.DoePolicyVersion(PolicyVersionId,AcademicYear),
        CONSTRAINT CK_DoeCalculationRecord_Facts CHECK(ISJSON(FactsSnapshotJson)=1),
        CONSTRAINT CK_DoeCalculationRecord_Inputs CHECK(ISJSON(InputsSnapshotJson)=1),
        CONSTRAINT CK_DoeCalculationRecord_Parameters CHECK(ISJSON(ParameterSnapshotJson)=1),
        CONSTRAINT CK_DoeCalculationRecord_Rule CHECK(ISJSON(RuleSnapshotJson)=1),
        CONSTRAINT CK_DoeCalculationRecord_Reference CHECK(ReferenceSnapshotJson IS NULL OR ISJSON(ReferenceSnapshotJson)=1),
        CONSTRAINT CK_DoeCalculationRecord_Status CHECK(CalculationStatus IN(N'calculated',N'needs_review',N'error')),
        CONSTRAINT CK_DoeCalculationRecord_Result CHECK((CalculationStatus=N'calculated' AND ResultDoe IS NOT NULL) OR (CalculationStatus<>N'calculated' AND ResultDoe IS NULL))
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'paws.DoeCalculationRecord') AND name=N'IX_DoeCalculationRecord_FacultyYear')
        CREATE INDEX IX_DoeCalculationRecord_FacultyYear ON paws.DoeCalculationRecord(FacultyId,AcademicYear,CalculatedAtUtc DESC);

    IF OBJECT_ID(N'paws.DoeAssignmentFact', N'U') IS NULL
    CREATE TABLE paws.DoeAssignmentFact (
        AssignmentFactId uniqueidentifier NOT NULL CONSTRAINT PK_DoeAssignmentFact PRIMARY KEY,
        FacultyId uniqueidentifier NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        Category nvarchar(64) NOT NULL,
        RoleType nvarchar(128) NULL,
        ActivityType nvarchar(128) NULL,
        ScopeText nvarchar(256) NULL,
        CourseCode nvarchar(64) NULL,
        SubjectKey nvarchar(128) NULL,
        SessionId uniqueidentifier NULL,
        SessionAssignmentId uniqueidentifier NULL,
        SourceEntityType nvarchar(64) NOT NULL,
        SourceEntityId nvarchar(128) NOT NULL,
        Notes nvarchar(1000) NULL,
        Active bit NOT NULL CONSTRAINT DF_DoeAssignmentFact_Active DEFAULT (1),
        Revision bigint NOT NULL CONSTRAINT DF_DoeAssignmentFact_Revision DEFAULT (0),
        CurrentCalculationId uniqueidentifier NULL,
        CreatedBy nvarchar(128) NOT NULL,
        CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoeAssignmentFact_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedBy nvarchar(128) NOT NULL,
        UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoeAssignmentFact_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_DoeAssignmentFact_Faculty FOREIGN KEY(FacultyId) REFERENCES paws.Faculty(FacultyId),
        CONSTRAINT FK_DoeAssignmentFact_Calculation FOREIGN KEY(CurrentCalculationId) REFERENCES paws.DoeCalculationRecord(CalculationId),
        CONSTRAINT CK_DoeAssignmentFact_Category CHECK(Category IN(N'role',N'teaching',N'course_coordination',N'rotation',N'supervision',N'hicc',N'visc',N'adjustment',N'approved_activity',N'other'))
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'paws.DoeAssignmentFact') AND name=N'IX_DoeAssignmentFact_FacultyYearActive')
        CREATE INDEX IX_DoeAssignmentFact_FacultyYearActive ON paws.DoeAssignmentFact(FacultyId,AcademicYear,Active);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'paws.DoeAssignmentFact') AND name=N'UX_DoeAssignmentFact_SessionAssignment')
        CREATE UNIQUE INDEX UX_DoeAssignmentFact_SessionAssignment ON paws.DoeAssignmentFact(SessionAssignmentId) WHERE SessionAssignmentId IS NOT NULL;

    IF OBJECT_ID(N'paws.DoeAssignmentFactInput', N'U') IS NULL
    CREATE TABLE paws.DoeAssignmentFactInput (
        AssignmentFactInputId uniqueidentifier NOT NULL CONSTRAINT PK_DoeAssignmentFactInput PRIMARY KEY,
        AssignmentFactId uniqueidentifier NOT NULL,
        InputName nvarchar(128) NOT NULL,
        ValueType nvarchar(16) NOT NULL,
        ValueText nvarchar(1000) NULL,
        ValueNumber decimal(18,6) NULL,
        CONSTRAINT FK_DoeAssignmentFactInput_Assignment FOREIGN KEY(AssignmentFactId) REFERENCES paws.DoeAssignmentFact(AssignmentFactId),
        CONSTRAINT UQ_DoeAssignmentFactInput_Name UNIQUE(AssignmentFactId,InputName),
        CONSTRAINT CK_DoeAssignmentFactInput_Type CHECK(ValueType IN(N'text',N'number',N'boolean'))
    );

    IF OBJECT_ID(N'paws.DoeImpactRun', N'U') IS NULL
    CREATE TABLE paws.DoeImpactRun (
        ImpactRunId uniqueidentifier NOT NULL CONSTRAINT PK_DoeImpactRun PRIMARY KEY,
        PolicyVersionId uniqueidentifier NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        DraftRevision bigint NOT NULL,
        DraftChecksum char(64) NOT NULL,
        InputDatasetChecksum char(64) NOT NULL,
        FacultyAffected int NOT NULL,
        AssignmentsChanged int NOT NULL,
        NeedsReview int NOT NULL,
        MappingGaps int NOT NULL,
        TotalDelta decimal(18,6) NULL,
        CreatedBy nvarchar(128) NOT NULL,
        CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoeImpactRun_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_DoeImpactRun_PolicyYear FOREIGN KEY(PolicyVersionId,AcademicYear) REFERENCES paws.DoePolicyVersion(PolicyVersionId,AcademicYear)
    );

    IF OBJECT_ID(N'paws.DoeImpactRunRow', N'U') IS NULL
    CREATE TABLE paws.DoeImpactRunRow (
        ImpactRunRowId uniqueidentifier NOT NULL CONSTRAINT PK_DoeImpactRunRow PRIMARY KEY,
        ImpactRunId uniqueidentifier NOT NULL,
        FacultyId uniqueidentifier NULL,
        SourceEntityType nvarchar(64) NULL,
        SourceEntityId nvarchar(128) NULL,
        OldDoe decimal(12,6) NULL,
        ProjectedDoe decimal(12,6) NULL,
        DeltaDoe decimal(12,6) NULL,
        Status nvarchar(24) NOT NULL,
        IssueCode nvarchar(64) NULL,
        CONSTRAINT FK_DoeImpactRunRow_Run FOREIGN KEY(ImpactRunId) REFERENCES paws.DoeImpactRun(ImpactRunId),
        CONSTRAINT CK_DoeImpactRunRow_Status CHECK(Status IN(N'calculated',N'needs_review',N'needs_mapping',N'unchanged'))
    );

    IF OBJECT_ID(N'paws.DoeAuditEvent', N'U') IS NULL
    CREATE TABLE paws.DoeAuditEvent (
        AuditEventId uniqueidentifier NOT NULL CONSTRAINT PK_DoeAuditEvent PRIMARY KEY,
        PolicyVersionId uniqueidentifier NULL,
        AcademicYear nvarchar(32) NULL,
        Action nvarchar(64) NOT NULL,
        EntityType nvarchar(64) NOT NULL,
        EntityId nvarchar(128) NOT NULL,
        FacultyId uniqueidentifier NULL,
        ActorUid nvarchar(128) NOT NULL,
        ActorName nvarchar(256) NULL,
        ActorEmail nvarchar(256) NULL,
        BeforeJson nvarchar(max) NULL,
        AfterJson nvarchar(max) NULL,
        ChangedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoeAuditEvent_ChangedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_DoeAuditEvent_Before CHECK(BeforeJson IS NULL OR ISJSON(BeforeJson)=1),
        CONSTRAINT CK_DoeAuditEvent_After CHECK(AfterJson IS NULL OR ISJSON(AfterJson)=1)
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'paws.DoeAuditEvent') AND name=N'IX_DoeAuditEvent_Year')
        CREATE INDEX IX_DoeAuditEvent_Year ON paws.DoeAuditEvent(AcademicYear,ChangedAtUtc DESC);

    IF OBJECT_ID(N'paws.DoePolicyPublication', N'U') IS NULL
    CREATE TABLE paws.DoePolicyPublication (
        PublicationId uniqueidentifier NOT NULL CONSTRAINT PK_DoePolicyPublication PRIMARY KEY,
        PolicyVersionId uniqueidentifier NOT NULL,
        AcademicYear nvarchar(32) NOT NULL,
        Revision bigint NOT NULL,
        PolicyChecksum char(64) NOT NULL,
        ImpactRunId uniqueidentifier NULL,
        PublishedBy nvarchar(128) NOT NULL,
        PublishedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_DoePolicyPublication_PublishedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_DoePolicyPublication_PolicyYear FOREIGN KEY(PolicyVersionId,AcademicYear) REFERENCES paws.DoePolicyVersion(PolicyVersionId,AcademicYear),
        CONSTRAINT FK_DoePolicyPublication_Impact FOREIGN KEY(ImpactRunId) REFERENCES paws.DoeImpactRun(ImpactRunId)
    );

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'paws.DoePolicyRule') AND name=N'FK_DoePolicyRule_Reference')
        ALTER TABLE paws.DoePolicyRule ADD CONSTRAINT FK_DoePolicyRule_Reference FOREIGN KEY(ReferenceId,PolicyVersionId,AcademicYear) REFERENCES paws.DoeReferenceSource(ReferenceId,PolicyVersionId,AcademicYear);
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'paws.DoeCourseMapping') AND name=N'FK_DoeCourseMapping_Reference')
        ALTER TABLE paws.DoeCourseMapping ADD CONSTRAINT FK_DoeCourseMapping_Reference FOREIGN KEY(ReferenceId,PolicyVersionId,AcademicYear) REFERENCES paws.DoeReferenceSource(ReferenceId,PolicyVersionId,AcademicYear);
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'paws.DoeSubjectMapping') AND name=N'FK_DoeSubjectMapping_Reference')
        ALTER TABLE paws.DoeSubjectMapping ADD CONSTRAINT FK_DoeSubjectMapping_Reference FOREIGN KEY(ReferenceId,PolicyVersionId,AcademicYear) REFERENCES paws.DoeReferenceSource(ReferenceId,PolicyVersionId,AcademicYear);

    /*
      Seed an initial 2026-27 Rule Book as a Draft. The imported Faculty/FTE
      policy version remains the current Active version until an authorized,
      explicit Validate -> Impact Preview -> Publish lifecycle completes.
      Only rows marked authoritative in the reviewed DOE seed are executable;
      ambiguous or unsupported source rows remain available in DoeRuleSeed.
    */
    DECLARE @p4SeedPolicy uniqueidentifier = 'A607A73D-ED99-40E4-A9D3-81DDF6D1E327';
    DECLARE @p4SeedReference uniqueidentifier = 'A607A73D-ED99-40E4-A9D3-81DDF6D1E328';
    EXEC sys.sp_executesql N'
        IF EXISTS (SELECT 1 FROM paws.DoePolicyVersion WHERE AcademicYear=N''2026-27'' AND VersionLabel=N''2026-27 P4 normalized Rule Book seed (Draft)'' AND PolicyVersionId<>@p4SeedPolicy)
            THROW 52505, ''The initial 2026-27 P4 Draft label is already used by a different policy identity.'', 1;
        IF NOT EXISTS (SELECT 1 FROM paws.DoePolicyVersion WHERE PolicyVersionId=@p4SeedPolicy)
        BEGIN
            INSERT INTO paws.DoePolicyVersion(PolicyVersionId,AcademicYear,VersionLabel,SourceReference,Active,Status,Revision,UpdatedBy)
            VALUES(@p4SeedPolicy,N''2026-27'',N''2026-27 P4 normalized Rule Book seed (Draft)'',
                   N''Initial normalized Draft from reviewed 2026-27 DoeRuleSeed rows; existing Active Faculty/FTE policy is unchanged.'',0,N''draft'',0,N''p4-migration'');
            INSERT INTO paws.DoeAuditEvent(AuditEventId,PolicyVersionId,AcademicYear,Action,EntityType,EntityId,ActorUid,AfterJson)
            VALUES(NEWID(),@p4SeedPolicy,N''2026-27'',N''draft_seeded'',N''doe_policy_version'',CONVERT(nvarchar(128),@p4SeedPolicy),N''p4-migration'',
                   (SELECT N''2026-27 P4 normalized Rule Book seed (Draft)'' AS versionLabel,N''authoritative seed facts only; not published'' AS disposition FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
        END;
        IF NOT EXISTS (SELECT 1 FROM paws.DoePolicyVersion WHERE PolicyVersionId=@p4SeedPolicy AND AcademicYear=N''2026-27'' AND Status=N''draft'' AND Active=0)
            THROW 52506, ''The initial 2026-27 P4 policy identity is not an unpublished Draft.'', 1;
    ',
    N'@p4SeedPolicy uniqueidentifier',
    @p4SeedPolicy=@p4SeedPolicy;
    IF EXISTS (
        SELECT expected.RuleLabel
          FROM (VALUES (N'Lecture',N'0.3'),(N'SRL',N'0.3'),(N'Lab Primary',N'0.21'),(N'Lab Secondary',N'0.19')) expected(RuleLabel,Rate)
          LEFT JOIN paws.DoeRuleSeed seed ON seed.AcademicYearOrStage=N'2026-27'
             AND seed.Category=N'Assigned Teaching' AND seed.RuleLabel=expected.RuleLabel
             AND LTRIM(RTRIM(seed.RateOrTierPct))=expected.Rate AND seed.Basis=N'per credited hour'
             AND seed.RequiredInput LIKE N'%creditedHours%'
             AND seed.AuthoritativeInExcel LIKE N'Yes%'
         WHERE seed.DoeRuleSeedId IS NULL
    ) THROW 52507, 'Reviewed 2026-27 authoritative teaching seeds do not match the P4 normalized policy seed.', 1;
    IF NOT EXISTS (SELECT 1 FROM paws.DoeRuleSeed WHERE AcademicYearOrStage=N'2026-27' AND Category=N'Development' AND RuleLabel=N'VISC' AND LTRIM(RTRIM(RateOrTierPct))=N'5' AND RequiredInput=N'subject mapping' AND AuthoritativeInExcel=N'Used in Role Assignments')
        THROW 52508, 'The reviewed 2026-27 VISC subject rule seed is missing or has changed.', 1;

    IF NOT EXISTS (SELECT 1 FROM paws.DoeReferenceSource WHERE ReferenceId=@p4SeedReference)
        INSERT INTO paws.DoeReferenceSource(ReferenceId,PolicyVersionId,AcademicYear,Title,Section,TableName,EffectiveDate,SourceReference,DocumentLink,Notes,ReviewStatus)
        VALUES(@p4SeedReference,@p4SeedPolicy,N'2026-27',N'2026-27 DOE seed import',N'Assigned Teaching and VISC',N'paws.DoeRuleSeed',NULL,
               N'Reviewed DOE seed rows explicitly marked authoritative for their stated facts and inputs; this source reference does not authorize missing mappings or units.',
               N'https://github.com/Alex1122341/Teaching-assignment/blob/main/docs/superpowers/specs/2026-09-19-unified-annual-doe-rulebook-design.md',
               N'Imported source row and its authoritative-input qualifier are retained in paws.DoeRuleSeed.',N'approved');

    DECLARE @p4SeedRules TABLE(RuleId uniqueidentifier,RuleKey nvarchar(128),RuleLabel nvarchar(256),RoleName nvarchar(128),Rate decimal(18,6));
    INSERT INTO @p4SeedRules(RuleId,RuleKey,RuleLabel,RoleName,Rate) VALUES
      ('A607A73D-ED99-40E4-A9D3-81DDF6D1E329',N'teaching_lecture_2026_27',N'Lecture · 2026-27',N'Lecture',0.300000),
      ('A607A73D-ED99-40E4-A9D3-81DDF6D1E32A',N'teaching_srl_2026_27',N'SRL · 2026-27',N'SRL',0.300000),
      ('A607A73D-ED99-40E4-A9D3-81DDF6D1E32B',N'teaching_lab_primary_2026_27',N'Lab Primary · 2026-27',N'Lab Primary',0.210000),
      ('A607A73D-ED99-40E4-A9D3-81DDF6D1E32C',N'teaching_lab_secondary_2026_27',N'Lab Secondary · 2026-27',N'Lab Secondary',0.190000);
    INSERT INTO paws.DoePolicyRule(RuleId,PolicyVersionId,AcademicYear,RuleKey,Category,ActivityType,RuleLabel,Priority,CalculationMode,MappingRequirement,ResultKind,ReferenceId,Enabled,ReviewStatus)
    SELECT s.RuleId,@p4SeedPolicy,N'2026-27',s.RuleKey,N'teaching',s.RoleName,s.RuleLabel,100,N'per_hour',NULL,N'credit',@p4SeedReference,1,N'approved'
      FROM @p4SeedRules s
     WHERE NOT EXISTS(SELECT 1 FROM paws.DoePolicyRule r WHERE r.PolicyVersionId=@p4SeedPolicy AND r.RuleKey=s.RuleKey);
    INSERT INTO paws.DoeRuleSelector(SelectorId,RuleId,FieldName,Operator,ValueType,ValueText)
    SELECT NEWID(),s.RuleId,N'teachingRole',N'equals',N'text',s.RoleName
      FROM @p4SeedRules s
     WHERE NOT EXISTS(SELECT 1 FROM paws.DoeRuleSelector x WHERE x.RuleId=s.RuleId AND x.FieldName=N'teachingRole');
    INSERT INTO paws.DoeRuleParameter(ParameterId,RuleId,Name,ValueNumber)
    SELECT NEWID(),s.RuleId,N'rate',s.Rate
      FROM @p4SeedRules s
     WHERE NOT EXISTS(SELECT 1 FROM paws.DoeRuleParameter x WHERE x.RuleId=s.RuleId AND x.Name=N'rate');
    INSERT INTO paws.DoeRuleInput(RuleInputId,RuleId,InputName,Source,Required)
    SELECT NEWID(),s.RuleId,N'hours',N'paws.SessionAssignment.CreditedHours',1
      FROM @p4SeedRules s
     WHERE NOT EXISTS(SELECT 1 FROM paws.DoeRuleInput x WHERE x.RuleId=s.RuleId AND x.InputName=N'hours');

    IF NOT EXISTS (SELECT 1 FROM paws.DoePolicyRule WHERE PolicyVersionId=@p4SeedPolicy AND RuleKey=N'visc_subject_2026_27')
    BEGIN
        DECLARE @p4ViscRule uniqueidentifier='A607A73D-ED99-40E4-A9D3-81DDF6D1E32D';
        INSERT INTO paws.DoePolicyRule(RuleId,PolicyVersionId,AcademicYear,RuleKey,Category,ActivityType,RuleLabel,Priority,CalculationMode,MappingRequirement,ResultKind,ReferenceId,Enabled,ReviewStatus)
        VALUES(@p4ViscRule,@p4SeedPolicy,N'2026-27',N'visc_subject_2026_27',N'visc',N'VISC',N'VISC subject development · 2026-27',100,N'fixed',N'subject',N'credit',@p4SeedReference,1,N'approved');
        INSERT INTO paws.DoeRuleSelector(SelectorId,RuleId,FieldName,Operator,ValueType,ValueText)
        VALUES(NEWID(),@p4ViscRule,N'roleType',N'equals',N'text',N'VISC');
        INSERT INTO paws.DoeRuleParameter(ParameterId,RuleId,Name,ValueNumber)
        VALUES(NEWID(),@p4ViscRule,N'fixed',5.000000);
    END;

    /* Reserve policy is explicitly marked for review; no numeric defaults are seeded. */
    IF NOT EXISTS (SELECT 1 FROM paws.DoePolicyRule WHERE PolicyVersionId=@p4SeedPolicy AND RuleKey=N'reserve_policy_2026_27')
    BEGIN
        DECLARE @p4ReserveRule uniqueidentifier='A607A73D-ED99-40E4-A9D3-81DDF6D1E32E';
        INSERT INTO paws.DoePolicyRule(RuleId,PolicyVersionId,AcademicYear,RuleKey,Category,ActivityType,RuleLabel,Priority,CalculationMode,ReferenceId,Enabled,ReviewStatus)
        VALUES(@p4ReserveRule,@p4SeedPolicy,N'2026-27',N'reserve_policy_2026_27',N'reserve',N'reserve_policy',N'Reserve policy parameters · 2026-27',0,N'fixed',@p4SeedReference,0,N'needs_review');
    END;

    IF OBJECT_ID(N'paws.TR_DoeCalculationRecord_Immutable', N'TR') IS NULL
        EXEC sys.sp_executesql N'CREATE TRIGGER paws.TR_DoeCalculationRecord_Immutable ON paws.DoeCalculationRecord AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 52502, ''DOE calculation evidence is immutable.'', 1; END;';
    IF OBJECT_ID(N'paws.TR_DoePolicyPublication_Immutable', N'TR') IS NULL
        EXEC sys.sp_executesql N'CREATE TRIGGER paws.TR_DoePolicyPublication_Immutable ON paws.DoePolicyPublication AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 52503, ''DOE policy publication evidence is immutable.'', 1; END;';
    IF OBJECT_ID(N'paws.TR_DoeAuditEvent_Immutable', N'TR') IS NULL
        EXEC sys.sp_executesql N'CREATE TRIGGER paws.TR_DoeAuditEvent_Immutable ON paws.DoeAuditEvent AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 52504, ''DOE audit evidence is immutable.'', 1; END;';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
