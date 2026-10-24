SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  P3B4 approved AFC PDF artifact storage.
  Branch-only additive migration. It creates one immutable artifact row for an
  approved paws.AfcRequest and three narrowly scoped API procedures. It adds no
  grants and must not be run against live VetMed-Ops during this stage.
*/

IF SCHEMA_ID(N'paws') IS NULL
    THROW 51720, 'The paws schema must already exist before P3B4.', 1;
IF SCHEMA_ID(N'paws_api') IS NULL
    THROW 51721, 'The paws_api schema must already exist before P3B4.', 1;
IF OBJECT_ID(N'paws.AfcRequest', N'U') IS NULL
   OR OBJECT_ID(N'paws.AfcApproval', N'U') IS NULL
   OR OBJECT_ID(N'paws.UserProfile', N'U') IS NULL
   OR OBJECT_ID(N'paws.AuditEvent', N'U') IS NULL
    THROW 51722, 'P3B1/P3B2 AFC request, approval, profile, and audit objects must already exist.', 1;
IF OBJECT_ID(N'paws.AfcArtifact', N'U') IS NOT NULL
   OR OBJECT_ID(N'paws_api.GetApprovedAfcArtifactSource', N'P') IS NOT NULL
   OR OBJECT_ID(N'paws_api.CreateOrGetApprovedAfcArtifact', N'P') IS NOT NULL
   OR OBJECT_ID(N'paws_api.GetApprovedAfcArtifact', N'P') IS NOT NULL
    THROW 51723, 'P3B4 artifact objects already exist; refusing to replace them.', 1;
GO

CREATE TABLE paws.AfcArtifact (
    AfcArtifactId uniqueidentifier NOT NULL CONSTRAINT PK_AfcArtifact PRIMARY KEY,
    AfcRequestId uniqueidentifier NOT NULL,
    ContentType varchar(64) NOT NULL CONSTRAINT DF_AfcArtifact_ContentType DEFAULT ('application/pdf'),
    PdfBytes varbinary(max) NOT NULL,
    PdfSha256 binary(32) NOT NULL,
    ByteLength int NOT NULL,
    SourceSnapshotSha256 binary(32) NOT NULL,
    TemplateSha256 binary(32) NOT NULL,
    RendererVersion nvarchar(64) NOT NULL,
    CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_AfcArtifact_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    CreatedByFirebaseUid nvarchar(128) NOT NULL,

    CONSTRAINT UQ_AfcArtifact_AfcRequest UNIQUE (AfcRequestId),
    CONSTRAINT FK_AfcArtifact_AfcRequest FOREIGN KEY (AfcRequestId)
        REFERENCES paws.AfcRequest(AfcRequestId),
    CONSTRAINT CK_AfcArtifact_ContentType CHECK (
        ContentType COLLATE Latin1_General_100_BIN2 = 'application/pdf'
    ),
    CONSTRAINT CK_AfcArtifact_ByteLength CHECK (
        ByteLength >= 1 AND ByteLength <= 8388608
        AND DATALENGTH(PdfBytes) = ByteLength
        AND DATALENGTH(PdfBytes) <= 8388608
    ),
    CONSTRAINT CK_AfcArtifact_RendererVersion CHECK (NULLIF(LTRIM(RTRIM(RendererVersion)), N'') IS NOT NULL)
);
GO

CREATE PROCEDURE paws_api.GetApprovedAfcArtifactSource
    @AfcRequestId uniqueidentifier,
    @ActorFirebaseUid nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @ActorFirebaseUid = LTRIM(RTRIM(COALESCE(@ActorFirebaseUid, N'')));
    IF @AfcRequestId IS NULL OR NULLIF(@ActorFirebaseUid, N'') IS NULL
        THROW 51701, 'An active authenticated artifact caller is required.', 1;

    DECLARE
        @ActorRole nvarchar(128),
        @RequesterFirebaseUid nvarchar(128),
        @ReportToFirebaseUid nvarchar(128),
        @RequestStatus nvarchar(32),
        @ApprovedAtUtc datetime2(7),
        @SourceSnapshotJson nvarchar(max),
        @SourceSnapshotSha256 binary(32);

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @ActorRole = LOWER(LTRIM(RTRIM(up.BaseRole)))
        FROM paws.UserProfile AS up WITH (HOLDLOCK)
        WHERE up.FirebaseUid COLLATE Latin1_General_100_BIN2 = @ActorFirebaseUid COLLATE Latin1_General_100_BIN2
          AND up.Active = 1
          AND up.MustChangePassword = 0;

        IF @ActorRole IS NULL
            THROW 51701, 'An active authenticated artifact caller is required.', 1;

        SELECT
            @RequesterFirebaseUid = ar.RequesterFirebaseUid,
            @ReportToFirebaseUid = ar.ReportToFirebaseUid,
            @RequestStatus = ar.Status,
            @ApprovedAtUtc = ar.ApprovedAtUtc
        FROM paws.AfcRequest AS ar WITH (HOLDLOCK)
        WHERE ar.AfcRequestId = @AfcRequestId;

        IF @RequestStatus COLLATE Latin1_General_100_BIN2 <> N'approved'
           OR @ApprovedAtUtc IS NULL
           OR NOT EXISTS (
                SELECT 1
                FROM paws.AfcApproval AS aa WITH (HOLDLOCK)
                WHERE aa.AfcRequestId = @AfcRequestId
                  AND aa.Stage COLLATE Latin1_General_100_BIN2 = N'admin'
                  AND aa.Status COLLATE Latin1_General_100_BIN2 = N'approved'
           )
           OR (
                @ReportToFirebaseUid IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1
                    FROM paws.AfcApproval AS aa WITH (HOLDLOCK)
                    WHERE aa.AfcRequestId = @AfcRequestId
                      AND aa.Stage COLLATE Latin1_General_100_BIN2 = N'report_to'
                      AND aa.Status COLLATE Latin1_General_100_BIN2 = N'approved'
                )
           )
            THROW 51702, 'The approved AFC artifact is not available to this caller.', 1;

        IF @ActorFirebaseUid COLLATE Latin1_General_100_BIN2 <> @RequesterFirebaseUid COLLATE Latin1_General_100_BIN2
           AND NOT EXISTS (
                SELECT 1
                FROM paws.AfcApproval AS aa WITH (HOLDLOCK)
                WHERE aa.AfcRequestId = @AfcRequestId
                  AND aa.Status COLLATE Latin1_General_100_BIN2 = N'approved'
                  AND aa.Stage COLLATE Latin1_General_100_BIN2 IN (N'report_to', N'admin')
                  AND aa.ApproverFirebaseUid COLLATE Latin1_General_100_BIN2 = @ActorFirebaseUid COLLATE Latin1_General_100_BIN2
           )
           AND @ActorRole COLLATE Latin1_General_100_BIN2 NOT IN (
                N'owner', N'administrator', N'adfa_general', N'adfa_regular', N'admin'
           )
            THROW 51702, 'The approved AFC artifact is not available to this caller.', 1;

        SELECT @SourceSnapshotJson = (
            SELECT
                CONVERT(varchar(36), ar.AfcRequestId) AS afcRequestId,
                CONVERT(varchar(36), ar.FacultyId) AS facultyId,
                ar.FacultyName AS facultyName,
                f.Ucid AS employeeId,
                f.PreferredFirstName AS preferredFirstName,
                f.PreferredLastName AS preferredLastName,
                f.Rank AS rank,
                ar.RequesterFirebaseUid AS requesterFirebaseUid,
                ar.RequesterEmail AS requesterEmail,
                CONVERT(varchar(36), ar.ReportsToFacultyId) AS reportsToFacultyId,
                ar.ReportToFirebaseUid AS reportToFirebaseUid,
                CONVERT(varchar(10), ar.StartDate, 23) AS startDate,
                CONVERT(varchar(10), ar.EndDate, 23) AS endDate,
                ar.WorkDays AS workDays,
                ar.Reason AS reason,
                ar.PurposeDestination AS purposeDestination,
                ar.Coverage AS coverage,
                ar.ContactAddress AS contactAddress,
                ar.ContactPhone AS contactPhone,
                JSON_QUERY(ar.TeachingSessionsJson) AS teachingSessions,
                ar.ApplicantSignatureMode AS applicantSignatureMode,
                ar.ApplicantSignatureName AS applicantSignatureName,
                ar.ApplicantSignatureUid AS applicantSignatureUid,
                ar.ApplicantSignatureSignedAtUtc AS applicantSignatureSignedAtUtc,
                ar.ApplicantSignatureFingerprint AS applicantSignatureFingerprint,
                ar.ApplicantSignatureImageDataUrl AS applicantSignatureImageDataUrl,
                ar.ApprovedAtUtc AS approvedAtUtc,
                JSON_QUERY((
                    SELECT
                        aa.Stage AS stage,
                        aa.ApproverFirebaseUid AS approverFirebaseUid,
                        aa.SignatureMode AS signatureMode,
                        aa.SignatureName AS signatureName,
                        aa.SignatureSignedAtUtc AS signatureSignedAtUtc,
                        aa.SignatureFingerprint AS signatureFingerprint,
                        aa.SignatureImageDataUrl AS signatureImageDataUrl
                    FROM paws.AfcApproval AS aa WITH (HOLDLOCK)
                    WHERE aa.AfcRequestId = ar.AfcRequestId
                      AND aa.Status COLLATE Latin1_General_100_BIN2 = N'approved'
                      AND aa.Stage COLLATE Latin1_General_100_BIN2 IN (N'report_to', N'admin')
                    ORDER BY CASE aa.Stage WHEN N'report_to' THEN 1 WHEN N'admin' THEN 2 ELSE 3 END
                    FOR JSON PATH, INCLUDE_NULL_VALUES
                )) AS approvals
            FROM paws.AfcRequest AS ar WITH (HOLDLOCK)
            INNER JOIN paws.Faculty AS f WITH (HOLDLOCK)
                ON f.FacultyId = ar.FacultyId
            WHERE ar.AfcRequestId = @AfcRequestId
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES
        );

        -- SQL NVARCHAR code units are UTF-16LE bytes without a BOM. Node must hash
        -- Buffer.from(SourceSnapshotJson, 'utf16le') without JSON re-serialization.
        SET @SourceSnapshotSha256 = CONVERT(binary(32), HASHBYTES(
            'SHA2_256', CONVERT(varbinary(max), @SourceSnapshotJson)
        ));

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT @SourceSnapshotJson AS SourceSnapshotJson,
           @SourceSnapshotSha256 AS SourceSnapshotSha256;
END;
GO

CREATE PROCEDURE paws_api.CreateOrGetApprovedAfcArtifact
    @AfcRequestId uniqueidentifier,
    @ActorFirebaseUid nvarchar(128),
    @SourceSnapshotSha256 binary(32),
    @PdfBytes varbinary(max),
    @PdfSha256 binary(32),
    @ByteLength int,
    @TemplateSha256 binary(32),
    @RendererVersion nvarchar(64)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @ActorFirebaseUid = LTRIM(RTRIM(COALESCE(@ActorFirebaseUid, N'')));
    IF @AfcRequestId IS NULL OR NULLIF(@ActorFirebaseUid, N'') IS NULL
        THROW 51701, 'An active authenticated artifact caller is required.', 1;

    DECLARE
        @LockResult int,
        @LockResource nvarchar(255) = N'paws.afc-artifact:' + CONVERT(nvarchar(36), @AfcRequestId),
        @ActorRole nvarchar(128),
        @RequesterFirebaseUid nvarchar(128),
        @ReportToFirebaseUid nvarchar(128),
        @RequestStatus nvarchar(32),
        @ApprovedAtUtc datetime2(7),
        @CurrentSourceSnapshotSha256 binary(32),
        @AfcArtifactId uniqueidentifier,
        @StoredBytes varbinary(max),
        @StoredPdfSha256 binary(32),
        @StoredByteLength int,
        @StoredSourceSnapshotSha256 binary(32),
        @StoredTemplateSha256 binary(32),
        @StoredRendererVersion nvarchar(64),
        @CreatedAtUtc datetime2(7),
        @CreatedByFirebaseUid nvarchar(128),
        @Now datetime2(7) = SYSUTCDATETIME(),
        @ApprovedTemplateSha256 binary(32) = 0x481677829217736B15CB3CBB010F49CB553A8664FE53F8604782093E99896547;

    BEGIN TRY
        BEGIN TRANSACTION;

        EXEC @LockResult = sys.sp_getapplock
            @Resource = @LockResource,
            @LockMode = N'Exclusive',
            @LockOwner = N'Transaction',
            @LockTimeout = 15000;
        IF @LockResult < 0
            THROW 51707, 'The AFC artifact creation lock could not be acquired.', 1;

        SELECT @ActorRole = LOWER(LTRIM(RTRIM(up.BaseRole)))
        FROM paws.UserProfile AS up WITH (HOLDLOCK)
        WHERE up.FirebaseUid COLLATE Latin1_General_100_BIN2 = @ActorFirebaseUid COLLATE Latin1_General_100_BIN2
          AND up.Active = 1
          AND up.MustChangePassword = 0;
        IF @ActorRole IS NULL
            THROW 51701, 'An active authenticated artifact caller is required.', 1;

        SELECT
            @RequesterFirebaseUid = ar.RequesterFirebaseUid,
            @ReportToFirebaseUid = ar.ReportToFirebaseUid,
            @RequestStatus = ar.Status,
            @ApprovedAtUtc = ar.ApprovedAtUtc
        FROM paws.AfcRequest AS ar WITH (HOLDLOCK)
        WHERE ar.AfcRequestId = @AfcRequestId;

        IF @RequestStatus COLLATE Latin1_General_100_BIN2 <> N'approved'
           OR @ApprovedAtUtc IS NULL
           OR NOT EXISTS (
                SELECT 1 FROM paws.AfcApproval AS aa WITH (HOLDLOCK)
                WHERE aa.AfcRequestId = @AfcRequestId
                  AND aa.Stage COLLATE Latin1_General_100_BIN2 = N'admin'
                  AND aa.Status COLLATE Latin1_General_100_BIN2 = N'approved'
           )
           OR (
                @ReportToFirebaseUid IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM paws.AfcApproval AS aa WITH (HOLDLOCK)
                    WHERE aa.AfcRequestId = @AfcRequestId
                      AND aa.Stage COLLATE Latin1_General_100_BIN2 = N'report_to'
                      AND aa.Status COLLATE Latin1_General_100_BIN2 = N'approved'
                )
           )
            THROW 51702, 'The approved AFC artifact is not available to this caller.', 1;

        IF @ActorFirebaseUid COLLATE Latin1_General_100_BIN2 <> @RequesterFirebaseUid COLLATE Latin1_General_100_BIN2
           AND NOT EXISTS (
                SELECT 1 FROM paws.AfcApproval AS aa WITH (HOLDLOCK)
                WHERE aa.AfcRequestId = @AfcRequestId
                  AND aa.Status COLLATE Latin1_General_100_BIN2 = N'approved'
                  AND aa.Stage COLLATE Latin1_General_100_BIN2 IN (N'report_to', N'admin')
                  AND aa.ApproverFirebaseUid COLLATE Latin1_General_100_BIN2 = @ActorFirebaseUid COLLATE Latin1_General_100_BIN2
           )
           AND @ActorRole COLLATE Latin1_General_100_BIN2 NOT IN (
                N'owner', N'administrator', N'adfa_general', N'adfa_regular', N'admin'
           )
            THROW 51702, 'The approved AFC artifact is not available to this caller.', 1;

        DECLARE @CurrentSource TABLE (
            SourceSnapshotJson nvarchar(max) NOT NULL,
            SourceSnapshotSha256 binary(32) NOT NULL
        );
        INSERT INTO @CurrentSource (SourceSnapshotJson, SourceSnapshotSha256)
        EXEC paws_api.GetApprovedAfcArtifactSource
            @AfcRequestId = @AfcRequestId,
            @ActorFirebaseUid = @ActorFirebaseUid;
        SELECT @CurrentSourceSnapshotSha256 = SourceSnapshotSha256
        FROM @CurrentSource;

        IF EXISTS (SELECT 1 FROM paws.AfcArtifact WITH (UPDLOCK, HOLDLOCK) WHERE AfcRequestId = @AfcRequestId)
        BEGIN
            SELECT
                @AfcArtifactId = AfcArtifactId,
                @StoredBytes = PdfBytes,
                @StoredPdfSha256 = PdfSha256,
                @StoredByteLength = ByteLength,
                @StoredSourceSnapshotSha256 = SourceSnapshotSha256,
                @StoredTemplateSha256 = TemplateSha256,
                @StoredRendererVersion = RendererVersion,
                @CreatedAtUtc = CreatedAtUtc,
                @CreatedByFirebaseUid = CreatedByFirebaseUid
            FROM paws.AfcArtifact WITH (UPDLOCK, HOLDLOCK)
            WHERE AfcRequestId = @AfcRequestId;

            IF DATALENGTH(@StoredBytes) <> @StoredByteLength
               OR DATALENGTH(@StoredBytes) > 8388608
               OR HASHBYTES('SHA2_256', @StoredBytes) <> @StoredPdfSha256
                THROW 51706, 'The stored AFC artifact failed its integrity check.', 1;

            COMMIT TRANSACTION;
            SELECT @AfcArtifactId AS AfcArtifactId,
                   @AfcRequestId AS AfcRequestId,
                   'application/pdf' AS ContentType,
                   @StoredBytes AS PdfBytes,
                   @StoredPdfSha256 AS PdfSha256,
                   @StoredByteLength AS ByteLength,
                   @StoredSourceSnapshotSha256 AS SourceSnapshotSha256,
                   @StoredTemplateSha256 AS TemplateSha256,
                   @StoredRendererVersion AS RendererVersion,
                   @CreatedAtUtc AS CreatedAtUtc,
                   @CreatedByFirebaseUid AS CreatedByFirebaseUid;
            RETURN;
        END;

        IF @SourceSnapshotSha256 IS NULL OR @PdfBytes IS NULL OR @PdfSha256 IS NULL
           OR @ByteLength IS NULL OR @TemplateSha256 IS NULL
           OR NULLIF(LTRIM(RTRIM(COALESCE(@RendererVersion, N''))), N'') IS NULL
            THROW 51704, 'A complete approved AFC artifact is required.', 1;
        IF @ByteLength < 1 OR @ByteLength > 8388608 OR DATALENGTH(@PdfBytes) <> @ByteLength
           OR DATALENGTH(@PdfBytes) > 8388608
            THROW 51705, 'The rendered AFC PDF exceeds the allowed size or length.', 1;
        IF HASHBYTES('SHA2_256', @PdfBytes) <> @PdfSha256
           OR @TemplateSha256 <> @ApprovedTemplateSha256
            THROW 51706, 'The rendered AFC PDF or reviewed template hash is invalid.', 1;
        IF @CurrentSourceSnapshotSha256 <> @SourceSnapshotSha256
            THROW 51703, 'The AFC request source changed; render again from a fresh approved snapshot.', 1;

        SET @AfcArtifactId = NEWID();
        INSERT INTO paws.AfcArtifact (
            AfcArtifactId, AfcRequestId, ContentType, PdfBytes, PdfSha256,
            ByteLength, SourceSnapshotSha256, TemplateSha256, RendererVersion,
            CreatedAtUtc, CreatedByFirebaseUid
        )
        VALUES (
            @AfcArtifactId, @AfcRequestId, 'application/pdf', @PdfBytes, @PdfSha256,
            @ByteLength, @SourceSnapshotSha256, @TemplateSha256, @RendererVersion,
            @Now, @ActorFirebaseUid
        );

        INSERT INTO paws.AuditEvent (
            AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid,
            ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson,
            RequestId, ImportBatchId
        )
        VALUES (
            NEWID(), N'afc_artifact_created', N'afc_artifact', CONVERT(nvarchar(36), @AfcArtifactId),
            @ActorFirebaseUid, NULL, @Now, NULL,
            (SELECT CONVERT(nvarchar(36), @AfcArtifactId) AS artifactId,
                    @ByteLength AS byteLength
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            (SELECT LOWER(CONVERT(varchar(64), @PdfSha256, 2)) AS pdfSha256,
                    LOWER(CONVERT(varchar(64), @SourceSnapshotSha256, 2)) AS sourceSnapshotSha256,
                    LOWER(CONVERT(varchar(64), @TemplateSha256, 2)) AS templateSha256,
                    @RendererVersion AS rendererVersion
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
            @AfcRequestId, NULL
        );

        COMMIT TRANSACTION;

        SELECT @AfcArtifactId AS AfcArtifactId,
               @AfcRequestId AS AfcRequestId,
               'application/pdf' AS ContentType,
               @PdfBytes AS PdfBytes,
               @PdfSha256 AS PdfSha256,
               @ByteLength AS ByteLength,
               @SourceSnapshotSha256 AS SourceSnapshotSha256,
               @TemplateSha256 AS TemplateSha256,
               @RendererVersion AS RendererVersion,
               @Now AS CreatedAtUtc,
               @ActorFirebaseUid AS CreatedByFirebaseUid;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE PROCEDURE paws_api.GetApprovedAfcArtifact
    @AfcRequestId uniqueidentifier,
    @ActorFirebaseUid nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @ActorFirebaseUid = LTRIM(RTRIM(COALESCE(@ActorFirebaseUid, N'')));
    IF @AfcRequestId IS NULL OR NULLIF(@ActorFirebaseUid, N'') IS NULL
        THROW 51701, 'An active authenticated artifact caller is required.', 1;

    DECLARE
        @ActorRole nvarchar(128),
        @RequesterFirebaseUid nvarchar(128),
        @ReportToFirebaseUid nvarchar(128),
        @RequestStatus nvarchar(32),
        @ApprovedAtUtc datetime2(7),
        @AfcArtifactId uniqueidentifier,
        @ContentType varchar(64),
        @PdfBytes varbinary(max),
        @PdfSha256 binary(32),
        @ByteLength int,
        @SourceSnapshotSha256 binary(32),
        @TemplateSha256 binary(32),
        @RendererVersion nvarchar(64),
        @CreatedAtUtc datetime2(7),
        @CreatedByFirebaseUid nvarchar(128);

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @ActorRole = LOWER(LTRIM(RTRIM(up.BaseRole)))
        FROM paws.UserProfile AS up WITH (HOLDLOCK)
        WHERE up.FirebaseUid COLLATE Latin1_General_100_BIN2 = @ActorFirebaseUid COLLATE Latin1_General_100_BIN2
          AND up.Active = 1
          AND up.MustChangePassword = 0;
        IF @ActorRole IS NULL
            THROW 51701, 'An active authenticated artifact caller is required.', 1;

        SELECT
            @RequesterFirebaseUid = ar.RequesterFirebaseUid,
            @ReportToFirebaseUid = ar.ReportToFirebaseUid,
            @RequestStatus = ar.Status,
            @ApprovedAtUtc = ar.ApprovedAtUtc
        FROM paws.AfcRequest AS ar WITH (HOLDLOCK)
        WHERE ar.AfcRequestId = @AfcRequestId;

        IF @RequestStatus COLLATE Latin1_General_100_BIN2 <> N'approved'
           OR @ApprovedAtUtc IS NULL
           OR NOT EXISTS (
                SELECT 1 FROM paws.AfcApproval AS aa WITH (HOLDLOCK)
                WHERE aa.AfcRequestId = @AfcRequestId
                  AND aa.Stage COLLATE Latin1_General_100_BIN2 = N'admin'
                  AND aa.Status COLLATE Latin1_General_100_BIN2 = N'approved'
           )
           OR (
                @ReportToFirebaseUid IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM paws.AfcApproval AS aa WITH (HOLDLOCK)
                    WHERE aa.AfcRequestId = @AfcRequestId
                      AND aa.Stage COLLATE Latin1_General_100_BIN2 = N'report_to'
                      AND aa.Status COLLATE Latin1_General_100_BIN2 = N'approved'
                )
           )
            THROW 51702, 'The approved AFC artifact is not available to this caller.', 1;

        IF @ActorFirebaseUid COLLATE Latin1_General_100_BIN2 <> @RequesterFirebaseUid COLLATE Latin1_General_100_BIN2
           AND NOT EXISTS (
                SELECT 1 FROM paws.AfcApproval AS aa WITH (HOLDLOCK)
                WHERE aa.AfcRequestId = @AfcRequestId
                  AND aa.Status COLLATE Latin1_General_100_BIN2 = N'approved'
                  AND aa.Stage COLLATE Latin1_General_100_BIN2 IN (N'report_to', N'admin')
                  AND aa.ApproverFirebaseUid COLLATE Latin1_General_100_BIN2 = @ActorFirebaseUid COLLATE Latin1_General_100_BIN2
           )
           AND @ActorRole COLLATE Latin1_General_100_BIN2 NOT IN (
                N'owner', N'administrator', N'adfa_general', N'adfa_regular', N'admin'
           )
            THROW 51702, 'The approved AFC artifact is not available to this caller.', 1;

        SELECT
            @AfcArtifactId = aa.AfcArtifactId,
            @ContentType = aa.ContentType,
            @PdfBytes = aa.PdfBytes,
            @PdfSha256 = aa.PdfSha256,
            @ByteLength = aa.ByteLength,
            @SourceSnapshotSha256 = aa.SourceSnapshotSha256,
            @TemplateSha256 = aa.TemplateSha256,
            @RendererVersion = aa.RendererVersion,
            @CreatedAtUtc = aa.CreatedAtUtc,
            @CreatedByFirebaseUid = aa.CreatedByFirebaseUid
        FROM paws.AfcArtifact AS aa WITH (HOLDLOCK)
        WHERE aa.AfcRequestId = @AfcRequestId;

        IF @AfcArtifactId IS NULL
            THROW 51708, 'An approved AFC artifact has not been created for this request.', 1;
        IF @ContentType COLLATE Latin1_General_100_BIN2 <> 'application/pdf'
           OR DATALENGTH(@PdfBytes) <> @ByteLength
           OR @ByteLength < 1 OR @ByteLength > 8388608
           OR HASHBYTES('SHA2_256', @PdfBytes) <> @PdfSha256
            THROW 51706, 'The stored AFC artifact failed its integrity check.', 1;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT @AfcArtifactId AS AfcArtifactId,
           @AfcRequestId AS AfcRequestId,
           @ContentType AS ContentType,
           @PdfBytes AS PdfBytes,
           @PdfSha256 AS PdfSha256,
           @ByteLength AS ByteLength,
           @SourceSnapshotSha256 AS SourceSnapshotSha256,
           @TemplateSha256 AS TemplateSha256,
           @RendererVersion AS RendererVersion,
           @CreatedAtUtc AS CreatedAtUtc,
           @CreatedByFirebaseUid AS CreatedByFirebaseUid;
END;
GO
