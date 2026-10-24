SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  P3B2 AFC approval foundation.
  Non-live proposal:
  - adds trusted Reports-To/Admin decision procedures;
  - preserves the exact pending_report_to -> pending_admin -> approved state machine;
  - permits Reports-To/Admin rejection from their authorized stages;
  - projects approved workflow requests into paws.vAfcRecordUnified as SourceKind=request;
  - never inserts workflow approvals into AfcManualRecord or imported AfcRecord;
  - adds no runtime permission statements.
*/

IF OBJECT_ID(N'paws.AfcRequest', N'U') IS NULL
    THROW 51620, 'paws.AfcRequest must already exist before P3B2.', 1;
IF OBJECT_ID(N'paws.AfcApproval', N'U') IS NULL
    THROW 51621, 'paws.AfcApproval must already exist before P3B2.', 1;
IF OBJECT_ID(N'paws.AuditEvent', N'U') IS NULL
    THROW 51622, 'paws.AuditEvent must already exist before P3B2.', 1;
IF OBJECT_ID(N'paws.UserProfile', N'U') IS NULL
    THROW 51623, 'paws.UserProfile must already exist before P3B2.', 1;
IF OBJECT_ID(N'paws.vAfcRecordUnified', N'V') IS NULL
    THROW 51624, 'paws.vAfcRecordUnified must already exist before P3B2.', 1;
IF OBJECT_ID(N'paws_api.RecommendAfcRequest', N'P') IS NOT NULL
   OR OBJECT_ID(N'paws_api.RejectAfcRequest', N'P') IS NOT NULL
   OR OBJECT_ID(N'paws_api.ApproveAfcRequest', N'P') IS NOT NULL
    THROW 51625, 'P3B2 approval procedures already exist; refusing to replace them.', 1;
GO

ALTER TABLE paws.AfcApproval
ADD CONSTRAINT CK_AfcApproval_DecisionEvidence CHECK (
    (
        Status COLLATE Latin1_General_100_BIN2 = N'pending'
        AND ApproverFirebaseUid IS NULL
        AND SignatureMode IS NULL
        AND SignatureName IS NULL
        AND SignatureSignedAtUtc IS NULL
        AND SignatureFingerprint IS NULL
        AND SignatureImageDataUrl IS NULL
        AND RejectionReason IS NULL
        AND DecidedAtUtc IS NULL
    )
    OR
    (
        Status COLLATE Latin1_General_100_BIN2 IN (N'approved', N'rejected')
        AND NULLIF(LTRIM(RTRIM(ApproverFirebaseUid)), N'') IS NOT NULL
        AND SignatureMode COLLATE Latin1_General_100_BIN2 IN (N'typed', N'drawn', N'uploaded')
        AND NULLIF(LTRIM(RTRIM(SignatureName)), N'') IS NOT NULL
        AND SignatureSignedAtUtc IS NOT NULL
        AND LEN(SignatureFingerprint) = 64
        AND SignatureFingerprint NOT LIKE '%[^0-9a-fA-F]%'
        AND DecidedAtUtc IS NOT NULL
    )
);
GO

ALTER TABLE paws.AfcApproval
ADD CONSTRAINT CK_AfcApproval_RejectionReason CHECK (
    (
        Status COLLATE Latin1_General_100_BIN2 = N'rejected'
        AND NULLIF(LTRIM(RTRIM(RejectionReason)), N'') IS NOT NULL
    )
    OR
    (
        Status COLLATE Latin1_General_100_BIN2 <> N'rejected'
        AND RejectionReason IS NULL
    )
);
GO

CREATE INDEX IX_AfcRequest_StatusSubmitted
    ON paws.AfcRequest(Status, SubmittedAtUtc DESC, AfcRequestId);
GO

CREATE OR ALTER PROCEDURE paws_api.RecommendAfcRequest
    @AfcRequestId uniqueidentifier,
    @ApprovalId uniqueidentifier,
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
    SET @SignatureMode = LTRIM(RTRIM(COALESCE(@SignatureMode, N'')));
    SET @SignatureName = LTRIM(RTRIM(COALESCE(@SignatureName, N'')));
    SET @SignatureFingerprint = LTRIM(RTRIM(COALESCE(@SignatureFingerprint, N'')));

    IF @AfcRequestId IS NULL OR @ApprovalId IS NULL
        THROW 51601, 'AFC request and approval identifiers are required.', 1;
    IF NULLIF(@ActorFirebaseUid, N'') IS NULL
        THROW 51601, 'An authenticated decision actor is required.', 1;
    IF @SignatureMode COLLATE Latin1_General_100_BIN2 NOT IN (N'typed', N'drawn', N'uploaded')
       OR NULLIF(@SignatureName, N'') IS NULL
       OR @SignatureSignedAt IS NULL
       OR LEN(@SignatureFingerprint) <> 64
       OR @SignatureFingerprint LIKE '%[^0-9a-fA-F]%'
        THROW 51605, 'Decision signature evidence is invalid.', 1;
    IF @SignatureImageDataUrl IS NOT NULL AND DATALENGTH(@SignatureImageDataUrl) > 2000000
        THROW 51605, 'Decision signature image is too large.', 1;

    DECLARE
        @ActorRole nvarchar(256),
        @ActorName nvarchar(520),
        @IsAdmin bit = 0,
        @Status nvarchar(32),
        @ReportToFirebaseUid nvarchar(256),
        @FacultyId uniqueidentifier,
        @Now datetime2(7) = SYSUTCDATETIME(),
        @SignedOnBehalf bit = 0;

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT
            @ActorRole = LOWER(LTRIM(RTRIM(up.BaseRole))),
            @ActorName = up.DisplayName
        FROM paws.UserProfile AS up WITH (UPDLOCK, HOLDLOCK)
        WHERE up.FirebaseUid = @ActorFirebaseUid
          AND up.Active = 1
          AND up.MustChangePassword = 0;

        IF @ActorRole IS NULL
            THROW 51601, 'An active decision actor is required.', 1;

        SET @IsAdmin = CASE WHEN @ActorRole IN (
            N'owner', N'administrator', N'adfa_general', N'adfa_regular', N'admin'
        ) THEN 1 ELSE 0 END;

        SELECT
            @Status = ar.Status,
            @ReportToFirebaseUid = ar.ReportToFirebaseUid,
            @FacultyId = ar.FacultyId
        FROM paws.AfcRequest AS ar WITH (UPDLOCK, HOLDLOCK)
        WHERE ar.AfcRequestId = @AfcRequestId;

        IF @Status IS NULL
            THROW 51602, 'AFC request was not found.', 1;
        IF @Status COLLATE Latin1_General_100_BIN2 <> N'pending_report_to'
            THROW 51603, 'This AFC request is not awaiting Reports-To recommendation.', 1;
        IF @ReportToFirebaseUid IS NULL
            THROW 51603, 'This AFC request has no Reports-To decision stage.', 1;

        IF @IsAdmin = 0
        BEGIN
            IF @ActorRole NOT IN (N'faculty', N'hicc', N'visc')
               OR @ActorFirebaseUid <> @ReportToFirebaseUid
                THROW 51604, 'This actor cannot recommend the AFC request.', 1;
        END
        ELSE IF @ActorFirebaseUid <> @ReportToFirebaseUid
            SET @SignedOnBehalf = 1;

        IF EXISTS (
            SELECT 1
            FROM paws.AfcApproval
            WHERE AfcRequestId = @AfcRequestId
              AND Stage = N'report_to'
        )
            THROW 51606, 'A Reports-To decision already exists for this AFC request.', 1;

        INSERT INTO paws.AfcApproval (
            AfcApprovalId, AfcRequestId, Stage, Status,
            ApproverFirebaseUid, SignatureMode, SignatureName,
            SignatureSignedAtUtc, SignatureFingerprint, SignatureImageDataUrl,
            RejectionReason, DecidedAtUtc, UpdatedAtUtc
        )
        VALUES (
            @ApprovalId, @AfcRequestId, N'report_to', N'approved',
            @ActorFirebaseUid, @SignatureMode, @SignatureName,
            @SignatureSignedAt, LOWER(@SignatureFingerprint), @SignatureImageDataUrl,
            NULL, @Now, @Now
        );

        UPDATE paws.AfcRequest
        SET Status = N'pending_admin',
            UpdatedAtUtc = @Now
        WHERE AfcRequestId = @AfcRequestId;

        INSERT INTO paws.AuditEvent (
            AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid,
            ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson,
            RequestId, ImportBatchId
        )
        VALUES (
            NEWID(), N'afc_request_recommended', N'afc_request',
            CONVERT(nvarchar(36), @AfcRequestId),
            @ActorFirebaseUid, @ActorName, @Now,
            (SELECT N'pending_report_to' AS status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            (SELECT N'pending_admin' AS status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            (SELECT @SignedOnBehalf AS signedOnBehalf,
                    @ReportToFirebaseUid AS assignedReportToFirebaseUid,
                    @FacultyId AS facultyId
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            @ApprovalId, NULL
        );

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT
        @AfcRequestId AS afcRequestId,
        N'pending_admin' AS status,
        @Now AS updatedAtUtc;
END;
GO

CREATE OR ALTER PROCEDURE paws_api.RejectAfcRequest
    @AfcRequestId uniqueidentifier,
    @ApprovalId uniqueidentifier,
    @RejectionReason nvarchar(1000),
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
    SET @RejectionReason = NULLIF(LTRIM(RTRIM(COALESCE(@RejectionReason, N''))), N'');
    SET @SignatureMode = LTRIM(RTRIM(COALESCE(@SignatureMode, N'')));
    SET @SignatureName = LTRIM(RTRIM(COALESCE(@SignatureName, N'')));
    SET @SignatureFingerprint = LTRIM(RTRIM(COALESCE(@SignatureFingerprint, N'')));

    IF @AfcRequestId IS NULL OR @ApprovalId IS NULL
        THROW 51601, 'AFC request and approval identifiers are required.', 1;
    IF NULLIF(@ActorFirebaseUid, N'') IS NULL
        THROW 51601, 'An authenticated decision actor is required.', 1;
    IF @RejectionReason IS NULL OR LEN(@RejectionReason) > 1000
        THROW 51607, 'A rejection reason of 1000 characters or fewer is required.', 1;
    IF @SignatureMode COLLATE Latin1_General_100_BIN2 NOT IN (N'typed', N'drawn', N'uploaded')
       OR NULLIF(@SignatureName, N'') IS NULL
       OR @SignatureSignedAt IS NULL
       OR LEN(@SignatureFingerprint) <> 64
       OR @SignatureFingerprint LIKE '%[^0-9a-fA-F]%'
        THROW 51605, 'Decision signature evidence is invalid.', 1;
    IF @SignatureImageDataUrl IS NOT NULL AND DATALENGTH(@SignatureImageDataUrl) > 2000000
        THROW 51605, 'Decision signature image is too large.', 1;

    DECLARE
        @ActorRole nvarchar(256),
        @ActorName nvarchar(520),
        @IsAdmin bit = 0,
        @Status nvarchar(32),
        @ReportToFirebaseUid nvarchar(256),
        @FacultyId uniqueidentifier,
        @Stage nvarchar(32),
        @Now datetime2(7) = SYSUTCDATETIME();

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT
            @ActorRole = LOWER(LTRIM(RTRIM(up.BaseRole))),
            @ActorName = up.DisplayName
        FROM paws.UserProfile AS up WITH (UPDLOCK, HOLDLOCK)
        WHERE up.FirebaseUid = @ActorFirebaseUid
          AND up.Active = 1
          AND up.MustChangePassword = 0;

        IF @ActorRole IS NULL
            THROW 51601, 'An active decision actor is required.', 1;

        SET @IsAdmin = CASE WHEN @ActorRole IN (
            N'owner', N'administrator', N'adfa_general', N'adfa_regular', N'admin'
        ) THEN 1 ELSE 0 END;

        SELECT
            @Status = ar.Status,
            @ReportToFirebaseUid = ar.ReportToFirebaseUid,
            @FacultyId = ar.FacultyId
        FROM paws.AfcRequest AS ar WITH (UPDLOCK, HOLDLOCK)
        WHERE ar.AfcRequestId = @AfcRequestId;

        IF @Status IS NULL
            THROW 51602, 'AFC request was not found.', 1;
        IF @Status COLLATE Latin1_General_100_BIN2 NOT IN (N'pending_report_to', N'pending_admin')
            THROW 51603, 'This AFC request can no longer be rejected.', 1;

        IF @Status COLLATE Latin1_General_100_BIN2 = N'pending_report_to'
        BEGIN
            IF @IsAdmin = 0
            BEGIN
                IF @ActorRole NOT IN (N'faculty', N'hicc', N'visc')
                   OR @ActorFirebaseUid <> @ReportToFirebaseUid
                    THROW 51604, 'This actor cannot reject the AFC request.', 1;
                SET @Stage = N'report_to';
            END
            ELSE
                SET @Stage = N'admin';
        END
        ELSE
        BEGIN
            IF @IsAdmin = 0
                THROW 51604, 'Only an administrator can reject an AFC request pending Admin review.', 1;
            SET @Stage = N'admin';
        END

        IF EXISTS (
            SELECT 1
            FROM paws.AfcApproval
            WHERE AfcRequestId = @AfcRequestId
              AND Stage = @Stage
        )
            THROW 51606, 'A decision already exists for this AFC request stage.', 1;

        INSERT INTO paws.AfcApproval (
            AfcApprovalId, AfcRequestId, Stage, Status,
            ApproverFirebaseUid, SignatureMode, SignatureName,
            SignatureSignedAtUtc, SignatureFingerprint, SignatureImageDataUrl,
            RejectionReason, DecidedAtUtc, UpdatedAtUtc
        )
        VALUES (
            @ApprovalId, @AfcRequestId, @Stage, N'rejected',
            @ActorFirebaseUid, @SignatureMode, @SignatureName,
            @SignatureSignedAt, LOWER(@SignatureFingerprint), @SignatureImageDataUrl,
            @RejectionReason, @Now, @Now
        );

        UPDATE paws.AfcRequest
        SET Status = N'rejected',
            RejectionReason = @RejectionReason,
            UpdatedAtUtc = @Now
        WHERE AfcRequestId = @AfcRequestId;

        INSERT INTO paws.AuditEvent (
            AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid,
            ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson,
            RequestId, ImportBatchId
        )
        VALUES (
            NEWID(), N'afc_request_rejected', N'afc_request',
            CONVERT(nvarchar(36), @AfcRequestId),
            @ActorFirebaseUid, @ActorName, @Now,
            (SELECT @Status AS status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            (SELECT N'rejected' AS status,
                    @RejectionReason AS rejectionReason
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            (SELECT @Stage AS decisionStage,
                    @FacultyId AS facultyId
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            @ApprovalId, NULL
        );

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT
        @AfcRequestId AS afcRequestId,
        N'rejected' AS status,
        @RejectionReason AS rejectionReason,
        @Now AS updatedAtUtc;
END;
GO

CREATE OR ALTER PROCEDURE paws_api.ApproveAfcRequest
    @AfcRequestId uniqueidentifier,
    @ApprovalId uniqueidentifier,
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
    SET @SignatureMode = LTRIM(RTRIM(COALESCE(@SignatureMode, N'')));
    SET @SignatureName = LTRIM(RTRIM(COALESCE(@SignatureName, N'')));
    SET @SignatureFingerprint = LTRIM(RTRIM(COALESCE(@SignatureFingerprint, N'')));

    IF @AfcRequestId IS NULL OR @ApprovalId IS NULL
        THROW 51601, 'AFC request and approval identifiers are required.', 1;
    IF NULLIF(@ActorFirebaseUid, N'') IS NULL
        THROW 51601, 'An authenticated decision actor is required.', 1;
    IF @SignatureMode COLLATE Latin1_General_100_BIN2 NOT IN (N'typed', N'drawn', N'uploaded')
       OR NULLIF(@SignatureName, N'') IS NULL
       OR @SignatureSignedAt IS NULL
       OR LEN(@SignatureFingerprint) <> 64
       OR @SignatureFingerprint LIKE '%[^0-9a-fA-F]%'
        THROW 51605, 'Decision signature evidence is invalid.', 1;
    IF @SignatureImageDataUrl IS NOT NULL AND DATALENGTH(@SignatureImageDataUrl) > 2000000
        THROW 51605, 'Decision signature image is too large.', 1;

    DECLARE
        @ActorRole nvarchar(256),
        @ActorName nvarchar(520),
        @Status nvarchar(32),
        @ReportToFirebaseUid nvarchar(256),
        @FacultyId uniqueidentifier,
        @Now datetime2(7) = SYSUTCDATETIME();

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT
            @ActorRole = LOWER(LTRIM(RTRIM(up.BaseRole))),
            @ActorName = up.DisplayName
        FROM paws.UserProfile AS up WITH (UPDLOCK, HOLDLOCK)
        WHERE up.FirebaseUid = @ActorFirebaseUid
          AND up.Active = 1
          AND up.MustChangePassword = 0;

        IF @ActorRole IS NULL OR @ActorRole NOT IN (
            N'owner', N'administrator', N'adfa_general', N'adfa_regular', N'admin'
        )
            THROW 51604, 'Only an active administrator can approve an AFC request.', 1;

        SELECT
            @Status = ar.Status,
            @ReportToFirebaseUid = ar.ReportToFirebaseUid,
            @FacultyId = ar.FacultyId
        FROM paws.AfcRequest AS ar WITH (UPDLOCK, HOLDLOCK)
        WHERE ar.AfcRequestId = @AfcRequestId;

        IF @Status IS NULL
            THROW 51602, 'AFC request was not found.', 1;
        IF @Status COLLATE Latin1_General_100_BIN2 <> N'pending_admin'
            THROW 51603, 'This AFC request is not awaiting Admin approval.', 1;

        IF @ReportToFirebaseUid IS NOT NULL
           AND NOT EXISTS (
                SELECT 1
                FROM paws.AfcApproval AS aa
                WHERE aa.AfcRequestId = @AfcRequestId
                  AND aa.Stage = N'report_to'
                  AND aa.Status = N'approved'
           )
            THROW 51608, 'Reports-To recommendation evidence is required before Admin approval.', 1;

        IF EXISTS (
            SELECT 1
            FROM paws.AfcApproval
            WHERE AfcRequestId = @AfcRequestId
              AND Stage = N'admin'
        )
            THROW 51606, 'An Admin decision already exists for this AFC request.', 1;

        INSERT INTO paws.AfcApproval (
            AfcApprovalId, AfcRequestId, Stage, Status,
            ApproverFirebaseUid, SignatureMode, SignatureName,
            SignatureSignedAtUtc, SignatureFingerprint, SignatureImageDataUrl,
            RejectionReason, DecidedAtUtc, UpdatedAtUtc
        )
        VALUES (
            @ApprovalId, @AfcRequestId, N'admin', N'approved',
            @ActorFirebaseUid, @SignatureMode, @SignatureName,
            @SignatureSignedAt, LOWER(@SignatureFingerprint), @SignatureImageDataUrl,
            NULL, @Now, @Now
        );

        UPDATE paws.AfcRequest
        SET Status = N'approved',
            ApprovedAtUtc = @Now,
            UpdatedAtUtc = @Now
        WHERE AfcRequestId = @AfcRequestId;

        INSERT INTO paws.AuditEvent (
            AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid,
            ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson,
            RequestId, ImportBatchId
        )
        VALUES (
            NEWID(), N'afc_request_approved', N'afc_request',
            CONVERT(nvarchar(36), @AfcRequestId),
            @ActorFirebaseUid, @ActorName, @Now,
            (SELECT N'pending_admin' AS status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            (SELECT N'approved' AS status,
                    @Now AS approvedAtUtc
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            (SELECT @FacultyId AS facultyId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            @ApprovalId, NULL
        );

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT
        @AfcRequestId AS afcRequestId,
        N'approved' AS status,
        @Now AS approvedAtUtc,
        @Now AS updatedAtUtc;
END;
GO

CREATE OR ALTER VIEW paws.vAfcRecordUnified
AS
    SELECT
        a.AfcRecordId,
        a.FacultyId,
        a.StartDate,
        a.EndDate,
        CAST(NULL AS nvarchar(32)) AS ReasonCode,
        a.Purpose AS ReasonDisplay,
        CAST(NULL AS nvarchar(1000)) AS Notes,
        a.Purpose AS LegacyPurpose,
        a.Active,
        CAST(N'import' AS nvarchar(16)) AS SourceKind,
        CAST(NULL AS datetime2(7)) AS CreatedAtUtc,
        CAST(NULL AS nvarchar(520)) AS CreatedByName,
        CONVERT(nvarchar(50), CONCAT(N'import:', CONVERT(varchar(36), a.AfcRecordId))) AS RecordKey
    FROM paws.AfcRecord AS a

    UNION ALL

    SELECT
        m.AfcRecordId,
        m.FacultyId,
        m.StartDate,
        m.EndDate,
        m.ReasonCode,
        CASE m.ReasonCode
            WHEN N'university_travel' THEN N'University Travel'
            WHEN N'vacation' THEN N'Vacation'
            WHEN N'rsl' THEN N'RSL'
            WHEN N'medical' THEN N'Medical'
            WHEN N'mat' THEN N'MAT'
            WHEN N'special' THEN N'Special'
            WHEN N'other' THEN N'Other'
        END AS ReasonDisplay,
        m.Notes,
        CAST(NULL AS nvarchar(1000)) AS LegacyPurpose,
        m.Active,
        CAST(N'manual' AS nvarchar(16)) AS SourceKind,
        m.CreatedAtUtc,
        m.CreatedByName,
        CONVERT(nvarchar(50), CONCAT(N'manual:', CONVERT(varchar(36), m.AfcRecordId))) AS RecordKey
    FROM paws.AfcManualRecord AS m

    UNION ALL

    SELECT
        ar.AfcRequestId AS AfcRecordId,
        ar.FacultyId,
        ar.StartDate,
        ar.EndDate,
        CAST(CASE ar.Reason
            WHEN N'vacation' THEN N'vacation'
            ELSE N'other'
        END AS nvarchar(32)) AS ReasonCode,
        CAST(CASE ar.Reason
            WHEN N'vacation' THEN N'Vacation'
            ELSE N'Business / Other'
        END AS nvarchar(1000)) AS ReasonDisplay,
        CAST(CASE ar.Reason
            WHEN N'business_other' THEN ar.PurposeDestination
            ELSE NULL
        END AS nvarchar(1000)) AS Notes,
        CAST(NULL AS nvarchar(1000)) AS LegacyPurpose,
        CAST(1 AS bit) AS Active,
        CAST(N'request' AS nvarchar(16)) AS SourceKind,
        ar.ApprovedAtUtc AS CreatedAtUtc,
        CAST(NULL AS nvarchar(520)) AS CreatedByName,
        CONVERT(nvarchar(50), CONCAT(N'request:', CONVERT(varchar(36), ar.AfcRequestId))) AS RecordKey
    FROM paws.AfcRequest AS ar
    WHERE ar.Status = N'approved';
GO
