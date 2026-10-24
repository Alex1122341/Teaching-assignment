SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  P3B1 AFC Request SQL foundation.
  Additive proposal only:
  - creates the workflow request/approval domain;
  - creates trusted submit/withdraw procedures;
  - derives applicant, Reports-To and teaching evidence from SQL authority;
  - does NOT create final AFC absence records;
  - adds no runtime permission statements.
*/

IF SCHEMA_ID(N'paws') IS NULL
    THROW 51520, 'The paws schema must already exist before P3B1.', 1;
IF SCHEMA_ID(N'paws_api') IS NULL
    THROW 51521, 'The paws_api schema must already exist before P3B1.', 1;
IF OBJECT_ID(N'paws.AuditEvent', N'U') IS NULL
    THROW 51522, 'paws.AuditEvent must already exist before P3B1.', 1;
IF OBJECT_ID(N'paws.UserProfile', N'U') IS NULL
    THROW 51523, 'paws.UserProfile must already exist before P3B1.', 1;
IF OBJECT_ID(N'paws.Faculty', N'U') IS NULL
    THROW 51524, 'paws.Faculty must already exist before P3B1.', 1;
IF OBJECT_ID(N'paws.Session', N'U') IS NULL OR OBJECT_ID(N'paws.SessionAssignment', N'U') IS NULL
    THROW 51525, 'Canonical session tables must already exist before P3B1.', 1;
IF OBJECT_ID(N'paws.AfcRequest', N'U') IS NOT NULL OR OBJECT_ID(N'paws.AfcApproval', N'U') IS NOT NULL
    THROW 51526, 'P3B1 AFC request objects already exist; refusing to replace them.', 1;
GO

CREATE TABLE paws.AfcRequest (
    AfcRequestId uniqueidentifier NOT NULL CONSTRAINT PK_AfcRequest PRIMARY KEY,
    FacultyId uniqueidentifier NOT NULL,
    FacultyName nvarchar(520) NOT NULL,
    RequesterFirebaseUid nvarchar(256) NOT NULL,
    RequesterEmail nvarchar(512) NOT NULL,
    ReportsToFacultyId uniqueidentifier NULL,
    ReportToFirebaseUid nvarchar(256) NULL,
    Status nvarchar(32) NOT NULL,
    StartDate date NOT NULL,
    EndDate date NOT NULL,
    WorkDays int NOT NULL,
    Reason nvarchar(32) NOT NULL,
    PurposeDestination nvarchar(1000) NULL,
    Coverage nvarchar(2000) NULL,
    ContactAddress nvarchar(500) NOT NULL,
    ContactPhone nvarchar(50) NOT NULL,
    TermsAccepted bit NOT NULL,
    TermsVersion nvarchar(128) NOT NULL,
    TermsSource nvarchar(512) NOT NULL,
    TermsAcceptedAtUtc datetime2(7) NOT NULL,
    ApplicantSignatureMode nvarchar(32) NOT NULL,
    ApplicantSignatureName nvarchar(260) NOT NULL,
    ApplicantSignatureUid nvarchar(256) NOT NULL,
    ApplicantSignatureSignedAtUtc datetime2(7) NOT NULL,
    ApplicantSignatureFingerprint char(64) NOT NULL,
    ApplicantSignatureImageDataUrl nvarchar(max) NULL,
    TeachingSessionsJson nvarchar(max) NULL,
    RejectionReason nvarchar(1000) NULL,
    WithdrawnByFirebaseUid nvarchar(256) NULL,
    WithdrawnAtUtc datetime2(7) NULL,
    SubmittedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_AfcRequest_SubmittedAtUtc DEFAULT SYSUTCDATETIME(),
    ApprovedAtUtc datetime2(7) NULL,
    UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_AfcRequest_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_AfcRequest_Faculty FOREIGN KEY (FacultyId) REFERENCES paws.Faculty(FacultyId),
    CONSTRAINT FK_AfcRequest_ReportsToFaculty FOREIGN KEY (ReportsToFacultyId) REFERENCES paws.Faculty(FacultyId),
    CONSTRAINT CK_AfcRequest_Status CHECK (
        Status COLLATE Latin1_General_100_BIN2 IN (
            N'pending_report_to', N'pending_admin', N'approved', N'rejected', N'withdrawn'
        )
    ),
    CONSTRAINT CK_AfcRequest_DateRange CHECK (EndDate >= StartDate AND DATEDIFF(day, StartDate, EndDate) <= 366),
    CONSTRAINT CK_AfcRequest_WorkDays CHECK (WorkDays >= 1 AND WorkDays <= 267),
    CONSTRAINT CK_AfcRequest_Reason CHECK (
        Reason COLLATE Latin1_General_100_BIN2 IN (N'vacation', N'business_other')
    ),
    CONSTRAINT CK_AfcRequest_Purpose CHECK (
        Reason COLLATE Latin1_General_100_BIN2 <> N'business_other'
        OR NULLIF(LTRIM(RTRIM(PurposeDestination)), N'') IS NOT NULL
    ),
    CONSTRAINT CK_AfcRequest_Terms CHECK (TermsAccepted = 1),
    CONSTRAINT CK_AfcRequest_SignatureMode CHECK (
        ApplicantSignatureMode COLLATE Latin1_General_100_BIN2 IN (N'typed', N'drawn', N'uploaded')
    ),
    CONSTRAINT CK_AfcRequest_SignatureFingerprint CHECK (
        LEN(ApplicantSignatureFingerprint) = 64
        AND ApplicantSignatureFingerprint NOT LIKE '%[^0-9a-fA-F]%'
    ),
    CONSTRAINT CK_AfcRequest_SignatureImageSize CHECK (
        ApplicantSignatureImageDataUrl IS NULL OR DATALENGTH(ApplicantSignatureImageDataUrl) <= 2000000
    ),
    CONSTRAINT CK_AfcRequest_TeachingJson CHECK (
        TeachingSessionsJson IS NULL OR ISJSON(TeachingSessionsJson) = 1
    )
);
GO

CREATE INDEX IX_AfcRequest_RequesterSubmitted
    ON paws.AfcRequest(RequesterFirebaseUid, SubmittedAtUtc DESC);
CREATE INDEX IX_AfcRequest_ReportToStatus
    ON paws.AfcRequest(ReportToFirebaseUid, Status, SubmittedAtUtc DESC)
    WHERE ReportToFirebaseUid IS NOT NULL;
CREATE INDEX IX_AfcRequest_FacultyDates
    ON paws.AfcRequest(FacultyId, StartDate DESC, EndDate DESC);
GO

CREATE TABLE paws.AfcApproval (
    AfcApprovalId uniqueidentifier NOT NULL CONSTRAINT PK_AfcApproval PRIMARY KEY,
    AfcRequestId uniqueidentifier NOT NULL,
    Stage nvarchar(32) NOT NULL,
    Status nvarchar(32) NOT NULL CONSTRAINT DF_AfcApproval_Status DEFAULT (N'pending'),
    ApproverFirebaseUid nvarchar(256) NULL,
    SignatureMode nvarchar(32) NULL,
    SignatureName nvarchar(260) NULL,
    SignatureSignedAtUtc datetime2(7) NULL,
    SignatureFingerprint char(64) NULL,
    SignatureImageDataUrl nvarchar(max) NULL,
    RejectionReason nvarchar(1000) NULL,
    DecidedAtUtc datetime2(7) NULL,
    UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_AfcApproval_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_AfcApproval_Request FOREIGN KEY (AfcRequestId)
        REFERENCES paws.AfcRequest(AfcRequestId),
    CONSTRAINT UQ_AfcApproval_RequestStage UNIQUE (AfcRequestId, Stage),
    CONSTRAINT CK_AfcApproval_Stage CHECK (
        Stage COLLATE Latin1_General_100_BIN2 IN (N'report_to', N'admin')
    ),
    CONSTRAINT CK_AfcApproval_Status CHECK (
        Status COLLATE Latin1_General_100_BIN2 IN (N'pending', N'approved', N'rejected')
    ),
    CONSTRAINT CK_AfcApproval_SignatureImageSize CHECK (
        SignatureImageDataUrl IS NULL OR DATALENGTH(SignatureImageDataUrl) <= 2000000
    )
);
GO

CREATE OR ALTER PROCEDURE paws_api.SubmitAfcRequest
    @AfcRequestId uniqueidentifier,
    @StartDate date,
    @EndDate date,
    @WorkDays int,
    @Reason nvarchar(32),
    @PurposeDestination nvarchar(1000),
    @Coverage nvarchar(2000),
    @ContactAddress nvarchar(500),
    @ContactPhone nvarchar(50),
    @TermsVersion nvarchar(128),
    @TermsSource nvarchar(512),
    @SignatureMode nvarchar(32),
    @SignatureName nvarchar(260),
    @SignatureSignedAt datetime2(7),
    @SignatureFingerprint char(64),
    @SignatureImageDataUrl nvarchar(max),
    @ActorFirebaseUid nvarchar(256)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @ActorFirebaseUid = LTRIM(RTRIM(COALESCE(@ActorFirebaseUid, N'')));
    SET @Reason = LTRIM(RTRIM(COALESCE(@Reason, N'')));
    SET @PurposeDestination = NULLIF(LTRIM(RTRIM(COALESCE(@PurposeDestination, N''))), N'');
    SET @Coverage = NULLIF(LTRIM(RTRIM(COALESCE(@Coverage, N''))), N'');
    SET @ContactAddress = LTRIM(RTRIM(COALESCE(@ContactAddress, N'')));
    SET @ContactPhone = LTRIM(RTRIM(COALESCE(@ContactPhone, N'')));
    SET @TermsVersion = LTRIM(RTRIM(COALESCE(@TermsVersion, N'')));
    SET @TermsSource = LTRIM(RTRIM(COALESCE(@TermsSource, N'')));
    SET @SignatureMode = LTRIM(RTRIM(COALESCE(@SignatureMode, N'')));
    SET @SignatureName = LTRIM(RTRIM(COALESCE(@SignatureName, N'')));
    SET @SignatureFingerprint = LTRIM(RTRIM(COALESCE(@SignatureFingerprint, N'')));

    IF @AfcRequestId IS NULL OR NULLIF(@ActorFirebaseUid, N'') IS NULL
        THROW 51501, 'A linked authenticated requester is required.', 1;
    IF @StartDate IS NULL OR @EndDate IS NULL OR @EndDate < @StartDate
       OR DATEDIFF(day, @StartDate, @EndDate) > 366
        THROW 51504, 'AFC dates are invalid.', 1;
    IF @WorkDays IS NULL OR @WorkDays < 1 OR @WorkDays > 267
        THROW 51504, 'AFC working-day count is invalid.', 1;
    IF @Reason COLLATE Latin1_General_100_BIN2 NOT IN (N'vacation', N'business_other')
        THROW 51504, 'AFC reason is invalid.', 1;
    IF @Reason COLLATE Latin1_General_100_BIN2 = N'business_other'
       AND @PurposeDestination IS NULL
        THROW 51504, 'Purpose and destination are required.', 1;
    IF NULLIF(@ContactAddress, N'') IS NULL OR LEN(@ContactAddress) > 500
        THROW 51504, 'Contact address is invalid.', 1;
    IF NULLIF(@ContactPhone, N'') IS NULL OR LEN(@ContactPhone) > 50
        THROW 51504, 'Contact phone is invalid.', 1;
    IF NULLIF(@TermsVersion, N'') IS NULL OR NULLIF(@TermsSource, N'') IS NULL
        THROW 51504, 'Terms evidence is required.', 1;
    IF @SignatureMode COLLATE Latin1_General_100_BIN2 NOT IN (N'typed', N'drawn', N'uploaded')
       OR NULLIF(@SignatureName, N'') IS NULL
       OR @SignatureSignedAt IS NULL
       OR LEN(@SignatureFingerprint) <> 64
       OR @SignatureFingerprint LIKE '%[^0-9a-fA-F]%'
        THROW 51504, 'Applicant signature evidence is invalid.', 1;
    IF @SignatureImageDataUrl IS NOT NULL AND DATALENGTH(@SignatureImageDataUrl) > 2000000
        THROW 51504, 'Applicant signature image is too large.', 1;

    DECLARE
        @FacultyId uniqueidentifier,
        @FacultyName nvarchar(520),
        @RequesterEmail nvarchar(512),
        @RequesterRole nvarchar(256),
        @ReportsToFacultyId uniqueidentifier,
        @ReportToFirebaseUid nvarchar(256),
        @ReportToMatches int,
        @Status nvarchar(32),
        @TeachingCount int,
        @TeachingSessionsJson nvarchar(max),
        @Now datetime2(7) = SYSUTCDATETIME();

    BEGIN TRY
        BEGIN TRANSACTION;

        IF EXISTS (SELECT 1 FROM paws.AfcRequest WHERE AfcRequestId = @AfcRequestId)
            THROW 51506, 'AFC request identifier already exists.', 1;

        SELECT
            @FacultyId = up.FacultyId,
            @RequesterEmail = up.Email,
            @RequesterRole = LOWER(LTRIM(RTRIM(up.BaseRole)))
        FROM paws.UserProfile AS up WITH (UPDLOCK, HOLDLOCK)
        WHERE up.FirebaseUid = @ActorFirebaseUid
          AND up.Active = 1
          AND up.MustChangePassword = 0;

        IF @FacultyId IS NULL
           OR @RequesterRole NOT IN (N'faculty', N'hicc', N'visc')
            THROW 51501, 'A linked authenticated requester is required.', 1;

        SELECT
            @FacultyName = f.DisplayName,
            @ReportsToFacultyId = f.ReportsToFacultyId
        FROM paws.Faculty AS f
        WHERE f.FacultyId = @FacultyId
          AND f.Active = 1;

        IF @FacultyName IS NULL
            THROW 51502, 'Active Faculty record was not found.', 1;

        SELECT
            @ReportToMatches = COUNT(*),
            @ReportToFirebaseUid = MIN(up.FirebaseUid)
        FROM paws.UserProfile AS up
        INNER JOIN paws.Faculty AS reportToFaculty
            ON reportToFaculty.FacultyId = up.FacultyId
           AND reportToFaculty.Active = 1
        WHERE @ReportsToFacultyId IS NOT NULL
          AND up.FacultyId = @ReportsToFacultyId
          AND up.Active = 1
          AND up.MustChangePassword = 0
          AND LOWER(LTRIM(RTRIM(up.BaseRole))) IN (N'faculty', N'hicc', N'visc');

        IF @ReportToMatches > 1
            THROW 51503, 'Reports-To account mapping is ambiguous.', 1;
        IF @ReportsToFacultyId IS NOT NULL AND @ReportToMatches = 0
            THROW 51509, 'The assigned Reports-To Faculty has no active eligible approval account.', 1;

        SET @Status = CASE WHEN @ReportToMatches = 1 THEN N'pending_report_to' ELSE N'pending_admin' END;

        SELECT @TeachingCount = COUNT(*)
        FROM (
            SELECT DISTINCT s.SessionId
            FROM paws.Session AS s
            INNER JOIN paws.SessionAssignment AS sa ON sa.SessionId = s.SessionId
            WHERE sa.FacultyId = @FacultyId
              AND s.SessionDate BETWEEN @StartDate AND @EndDate
        ) AS assigned;

        SELECT @TeachingSessionsJson = (
            SELECT
                CONVERT(varchar(36), q.SessionId) AS id,
                CONVERT(varchar(10), q.SessionDate, 23) AS [date],
                CASE WHEN q.StartTime IS NULL THEN NULL ELSE LEFT(CONVERT(varchar(8), q.StartTime, 108), 5) END AS [start],
                CASE WHEN q.EndTime IS NULL THEN NULL ELSE LEFT(CONVERT(varchar(8), q.EndTime, 108), 5) END AS [end],
                q.CourseCode AS course,
                q.Topic AS topic,
                q.SessionType AS [type]
            FROM (
                SELECT DISTINCT
                    s.SessionId, s.SessionDate, s.StartTime, s.EndTime,
                    s.CourseCode, s.Topic, s.SessionType
                FROM paws.Session AS s
                INNER JOIN paws.SessionAssignment AS sa ON sa.SessionId = s.SessionId
                WHERE sa.FacultyId = @FacultyId
                  AND s.SessionDate BETWEEN @StartDate AND @EndDate
            ) AS q
            ORDER BY q.SessionDate, q.StartTime, q.CourseCode, q.SessionId
            FOR JSON PATH
        );

        IF @TeachingCount > 0 AND @Coverage IS NULL
            THROW 51505, 'Coverage is required because teaching assignments occur during this absence.', 1;

        INSERT INTO paws.AfcRequest (
            AfcRequestId, FacultyId, FacultyName, RequesterFirebaseUid, RequesterEmail,
            ReportsToFacultyId, ReportToFirebaseUid, Status,
            StartDate, EndDate, WorkDays, Reason, PurposeDestination, Coverage,
            ContactAddress, ContactPhone, TermsAccepted, TermsVersion, TermsSource,
            TermsAcceptedAtUtc, ApplicantSignatureMode, ApplicantSignatureName,
            ApplicantSignatureUid, ApplicantSignatureSignedAtUtc,
            ApplicantSignatureFingerprint, ApplicantSignatureImageDataUrl,
            TeachingSessionsJson, SubmittedAtUtc, UpdatedAtUtc
        )
        VALUES (
            @AfcRequestId, @FacultyId, @FacultyName, @ActorFirebaseUid, @RequesterEmail,
            @ReportsToFacultyId, @ReportToFirebaseUid, @Status,
            @StartDate, @EndDate, @WorkDays, @Reason, @PurposeDestination, @Coverage,
            @ContactAddress, @ContactPhone, 1, @TermsVersion, @TermsSource,
            @Now, @SignatureMode, @SignatureName, @ActorFirebaseUid, @SignatureSignedAt,
            LOWER(@SignatureFingerprint), @SignatureImageDataUrl,
            NULLIF(@TeachingSessionsJson, N'[]'), @Now, @Now
        );

        INSERT INTO paws.AuditEvent (
            AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid,
            ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson,
            RequestId, ImportBatchId
        )
        VALUES (
            NEWID(), N'afc_request_submitted', N'afc_request', CONVERT(nvarchar(36), @AfcRequestId),
            @ActorFirebaseUid, @FacultyName, @Now, NULL,
            (SELECT
                @AfcRequestId AS afcRequestId,
                @FacultyId AS facultyId,
                @Status AS status,
                @StartDate AS startDate,
                @EndDate AS endDate,
                @WorkDays AS workDays,
                @Reason AS reason,
                @TeachingCount AS teachingSessionCount
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            NULL, @AfcRequestId, NULL
        );

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT
        @AfcRequestId AS afcRequestId,
        @FacultyId AS facultyId,
        @FacultyName AS facultyName,
        @ActorFirebaseUid AS requesterFirebaseUid,
        @ReportToFirebaseUid AS reportToFirebaseUid,
        @Status AS status,
        CONVERT(varchar(10), @StartDate, 23) AS startDate,
        CONVERT(varchar(10), @EndDate, 23) AS endDate,
        @WorkDays AS workDays,
        @Reason AS reason,
        @PurposeDestination AS purposeDestination,
        @Coverage AS coverage,
        @Now AS submittedAtUtc,
        @Now AS updatedAtUtc;
END;
GO

CREATE OR ALTER PROCEDURE paws_api.WithdrawAfcRequest
    @AfcRequestId uniqueidentifier,
    @ActorFirebaseUid nvarchar(256),
    @AuditRequestId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @ActorFirebaseUid = LTRIM(RTRIM(COALESCE(@ActorFirebaseUid, N'')));
    IF @AfcRequestId IS NULL OR @AuditRequestId IS NULL OR NULLIF(@ActorFirebaseUid, N'') IS NULL
        THROW 51507, 'A pending AFC request was not found for this requester.', 1;

    DECLARE
        @RequesterFirebaseUid nvarchar(256),
        @Status nvarchar(32),
        @FacultyId uniqueidentifier,
        @FacultyName nvarchar(520),
        @ReportToFirebaseUid nvarchar(256),
        @StartDate date,
        @EndDate date,
        @WorkDays int,
        @Reason nvarchar(32),
        @PurposeDestination nvarchar(1000),
        @Coverage nvarchar(2000),
        @SubmittedAtUtc datetime2(7),
        @Now datetime2(7) = SYSUTCDATETIME();

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT
            @RequesterFirebaseUid = ar.RequesterFirebaseUid,
            @Status = ar.Status,
            @FacultyId = ar.FacultyId,
            @FacultyName = ar.FacultyName,
            @ReportToFirebaseUid = ar.ReportToFirebaseUid,
            @StartDate = ar.StartDate,
            @EndDate = ar.EndDate,
            @WorkDays = ar.WorkDays,
            @Reason = ar.Reason,
            @PurposeDestination = ar.PurposeDestination,
            @Coverage = ar.Coverage,
            @SubmittedAtUtc = ar.SubmittedAtUtc
        FROM paws.AfcRequest AS ar WITH (UPDLOCK, HOLDLOCK)
        WHERE ar.AfcRequestId = @AfcRequestId;

        IF @RequesterFirebaseUid IS NULL OR @RequesterFirebaseUid <> @ActorFirebaseUid
            THROW 51507, 'A pending AFC request was not found for this requester.', 1;
        IF @Status NOT IN (N'pending_report_to', N'pending_admin')
            THROW 51508, 'This AFC request can no longer be withdrawn.', 1;

        UPDATE paws.AfcRequest
        SET
            Status = N'withdrawn',
            WithdrawnByFirebaseUid = @ActorFirebaseUid,
            WithdrawnAtUtc = @Now,
            UpdatedAtUtc = @Now
        WHERE AfcRequestId = @AfcRequestId;

        INSERT INTO paws.AuditEvent (
            AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid,
            ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson,
            RequestId, ImportBatchId
        )
        VALUES (
            NEWID(), N'afc_request_withdrawn', N'afc_request', CONVERT(nvarchar(36), @AfcRequestId),
            @ActorFirebaseUid, @FacultyName, @Now,
            (SELECT @Status AS status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            (SELECT N'withdrawn' AS status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            NULL, @AuditRequestId, NULL
        );

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT
        @AfcRequestId AS afcRequestId,
        @FacultyId AS facultyId,
        @FacultyName AS facultyName,
        @ActorFirebaseUid AS requesterFirebaseUid,
        @ReportToFirebaseUid AS reportToFirebaseUid,
        N'withdrawn' AS status,
        CONVERT(varchar(10), @StartDate, 23) AS startDate,
        CONVERT(varchar(10), @EndDate, 23) AS endDate,
        @WorkDays AS workDays,
        @Reason AS reason,
        @PurposeDestination AS purposeDestination,
        @Coverage AS coverage,
        @SubmittedAtUtc AS submittedAtUtc,
        @Now AS updatedAtUtc;
END;
GO
