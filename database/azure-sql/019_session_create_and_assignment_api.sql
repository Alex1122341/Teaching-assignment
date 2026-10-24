/*
  PAWS Beta P1 — guarded canonical session create and assignment APIs.

  This is a one-time guarded migration. It creates only narrow paws_api
  procedures and the batch idempotency receipt table; it grants no direct table
  DML and creates no login/user/role. Keep all application write gates closed
  until the deployment has been independently verified.

  Run with sqlcmd using :ON ERROR EXIT. The application procedures contain no
  dynamic SQL. All business writes are transactional and audited.
*/
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 51900, 'Migration 019 must run in VetMed-Ops.', 1;

IF SCHEMA_ID(N'paws_api') IS NULL
   OR OBJECT_ID(N'paws.Session', N'U') IS NULL
   OR OBJECT_ID(N'paws.SessionAssignment', N'U') IS NULL
   OR OBJECT_ID(N'paws.Course', N'U') IS NULL
   OR OBJECT_ID(N'paws.Faculty', N'U') IS NULL
   OR OBJECT_ID(N'paws.AuditEvent', N'U') IS NULL
   OR OBJECT_ID(N'staging.ImportBatch', N'U') IS NULL
   OR OBJECT_ID(N'paws.vCalendarSession', N'V') IS NULL
    THROW 51901, 'Migration 019 is missing a required base object; no change was made.', 1;

IF OBJECT_ID(N'paws_api.ValidateCalendarSessionJson', N'P') IS NOT NULL
   OR OBJECT_ID(N'paws_api.CreateCalendarSession', N'P') IS NOT NULL
   OR OBJECT_ID(N'paws_api.CreateCalendarSessionBatch', N'P') IS NOT NULL
   OR OBJECT_ID(N'paws_api.ReplaceCalendarSessionAssignments', N'P') IS NOT NULL
   OR OBJECT_ID(N'paws_api.SessionBatchRequest', N'U') IS NOT NULL
    THROW 51902, 'Migration 019 objects already exist; inspect their exact definitions before proceeding.', 1;
GO

BEGIN TRANSACTION;
GO

CREATE TABLE paws_api.SessionBatchRequest (
    RequestId uniqueidentifier NOT NULL CONSTRAINT PK_SessionBatchRequest PRIMARY KEY,
    ActorFirebaseUid nvarchar(128) NOT NULL,
    PayloadSha256 binary(32) NOT NULL,
    ResponseJson nvarchar(max) NOT NULL,
    CreatedAtUtc datetime2(7) NOT NULL,
    CONSTRAINT CK_SessionBatchRequest_ResponseJson CHECK (ISJSON(ResponseJson) = 1)
);
GO

CREATE PROCEDURE paws_api.ValidateCalendarSessionJson
    @SessionJson nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    IF ISJSON(@SessionJson) <> 1
        THROW 51250, 'Invalid session JSON.', 1;

    IF EXISTS (
        SELECT 1 FROM OPENJSON(@SessionJson)
        WHERE [key] NOT IN (N'academicYear', N'curriculumYear', N'courseCode', N'sessionType', N'date', N'startTime', N'endTime', N'topic', N'room', N'assignments')
    ) THROW 51250, 'Unsupported session fields.', 1;

    DECLARE @AcademicYear nvarchar(32) = JSON_VALUE(@SessionJson, '$.academicYear');
    DECLARE @CurriculumYear nvarchar(64) = JSON_VALUE(@SessionJson, '$.curriculumYear');
    DECLARE @CourseCode nvarchar(32) = NULLIF(LTRIM(RTRIM(JSON_VALUE(@SessionJson, '$.courseCode'))), N'');
    DECLARE @SessionType nvarchar(128) = JSON_VALUE(@SessionJson, '$.sessionType');
    DECLARE @Date date = TRY_CONVERT(date, JSON_VALUE(@SessionJson, '$.date'), 23);
    DECLARE @StartText nvarchar(16) = JSON_VALUE(@SessionJson, '$.startTime');
    DECLARE @EndText nvarchar(16) = JSON_VALUE(@SessionJson, '$.endTime');
    DECLARE @StartTime time(0) = TRY_CONVERT(time(0), @StartText);
    DECLARE @EndTime time(0) = TRY_CONVERT(time(0), @EndText);
    DECLARE @Topic nvarchar(4000) = JSON_VALUE(@SessionJson, '$.topic');
    DECLARE @Room nvarchar(256) = JSON_VALUE(@SessionJson, '$.room');
    DECLARE @AssignmentsJson nvarchar(max) = JSON_QUERY(@SessionJson, '$.assignments');

    IF @AcademicYear NOT LIKE '[12][0-9][0-9][0-9]-[0-9][0-9]'
       OR TRY_CONVERT(int, RIGHT(@AcademicYear, 2)) <> (TRY_CONVERT(int, LEFT(@AcademicYear, 4)) + 1) % 100
       OR @CurriculumYear NOT IN (N'1', N'2', N'3', N'4')
       OR @CourseCode IS NULL OR DATALENGTH(@CourseCode) > 64
       OR @SessionType NOT IN (N'LEC', N'LAB', N'SRL', N'Quiz/Midterm', N'OSCE', N'Exam')
       OR @Date IS NULL OR CONVERT(varchar(10), @Date, 23) <> JSON_VALUE(@SessionJson, '$.date')
       OR @Date < DATEFROMPARTS(TRY_CONVERT(int, LEFT(@AcademicYear, 4)), 5, 1)
       OR @Date >= DATEFROMPARTS(TRY_CONVERT(int, LEFT(@AcademicYear, 4)) + 1, 5, 1)
       OR @StartTime IS NULL OR @EndTime IS NULL OR @StartTime >= @EndTime
       OR @Topic IS NULL OR NULLIF(LTRIM(RTRIM(@Topic)), N'') IS NULL OR DATALENGTH(@Topic) > 8000
       OR DATALENGTH(COALESCE(@Room, N'')) > 512
        THROW 51250, 'Session fields are invalid.', 1;

    IF NOT EXISTS (SELECT 1 FROM paws.Course WHERE CourseCode = @CourseCode)
        THROW 51251, 'Course code was not found.', 1;

    IF EXISTS (SELECT 1 FROM OPENJSON(@SessionJson) WHERE [key] = N'assignments' AND [type] <> 4)
        THROW 51254, 'Assignments must be a JSON array.', 1;

    IF @AssignmentsJson IS NOT NULL
    BEGIN
        DECLARE @Assignments TABLE (FacultyId uniqueidentifier NULL, TeachingRole nvarchar(256) NULL);

        IF LEFT(LTRIM(@AssignmentsJson), 1) <> N'['
            THROW 51254, 'Assignments must be a JSON array.', 1;
        IF (SELECT COUNT_BIG(*) FROM OPENJSON(@AssignmentsJson)) > 30
            THROW 51254, 'Too many session assignments.', 1;
        IF EXISTS (SELECT 1 FROM OPENJSON(@AssignmentsJson) WHERE [type] <> 5)
            THROW 51254, 'Each session assignment must be an object.', 1;

        IF EXISTS (
            SELECT 1
            FROM OPENJSON(@AssignmentsJson) AS assignment
            CROSS APPLY OPENJSON(assignment.value) AS field
            WHERE field.[key] NOT IN (N'facultyId', N'teachingRole')
        ) THROW 51254, 'Unsupported assignment fields.', 1;

        INSERT @Assignments (FacultyId, TeachingRole)
        SELECT TRY_CONVERT(uniqueidentifier, JSON_VALUE(value, '$.facultyId')),
               NULLIF(LTRIM(RTRIM(JSON_VALUE(value, '$.teachingRole'))), N'')
        FROM OPENJSON(@AssignmentsJson);

        IF EXISTS (SELECT 1 FROM @Assignments WHERE FacultyId IS NULL OR DATALENGTH(COALESCE(TeachingRole, N'')) > 512)
           OR EXISTS (SELECT FacultyId FROM @Assignments GROUP BY FacultyId HAVING COUNT_BIG(*) > 1)
           OR EXISTS (
               SELECT 1 FROM @Assignments AS assignment
               WHERE NOT EXISTS (SELECT 1 FROM paws.Faculty AS faculty WHERE faculty.FacultyId = assignment.FacultyId AND faculty.Active = 1)
           )
            THROW 51254, 'Assignment FacultyId is not a distinct active canonical Faculty record.', 1;
    END;
END;
GO

CREATE PROCEDURE paws_api.CreateCalendarSession
    @SessionJson nvarchar(max),
    @ActorFirebaseUid nvarchar(128),
    @ActorName nvarchar(260) = NULL,
    @RequestId uniqueidentifier = NULL,
    @ImportBatchId uniqueidentifier = NULL OUTPUT,
    @SourceRow int = 1,
    @SessionId uniqueidentifier = NULL OUTPUT,
    @ReturnSession bit = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NULLIF(LTRIM(RTRIM(@ActorFirebaseUid)), N'') IS NULL OR @SourceRow < 1
        THROW 51250, 'Actor and source row are required.', 1;
    EXEC paws_api.ValidateCalendarSessionJson @SessionJson = @SessionJson;

    DECLARE @AcademicYear nvarchar(32) = JSON_VALUE(@SessionJson, '$.academicYear');
    DECLARE @CurriculumYear nvarchar(64) = JSON_VALUE(@SessionJson, '$.curriculumYear');
    DECLARE @CourseCode nvarchar(32) = LTRIM(RTRIM(JSON_VALUE(@SessionJson, '$.courseCode')));
    DECLARE @SessionType nvarchar(128) = JSON_VALUE(@SessionJson, '$.sessionType');
    DECLARE @Date date = CONVERT(date, JSON_VALUE(@SessionJson, '$.date'), 23);
    DECLARE @StartTime time(0) = CONVERT(time(0), JSON_VALUE(@SessionJson, '$.startTime'));
    DECLARE @EndTime time(0) = CONVERT(time(0), JSON_VALUE(@SessionJson, '$.endTime'));
    DECLARE @Topic nvarchar(max) = JSON_VALUE(@SessionJson, '$.topic');
    DECLARE @Room nvarchar(256) = NULLIF(LTRIM(RTRIM(JSON_VALUE(@SessionJson, '$.room'))), N'');
    DECLARE @AssignmentsJson nvarchar(max) = COALESCE(JSON_QUERY(@SessionJson, '$.assignments'), N'[]');
    DECLARE @CourseId uniqueidentifier;
    DECLARE @CourseName nvarchar(512);
    DECLARE @BeforeJson nvarchar(max) = NULL;
    DECLARE @AfterJson nvarchar(max);

    IF @RequestId IS NULL SET @RequestId = NEWID();
    SELECT @CourseId = CourseId, @CourseName = CourseName FROM paws.Course WHERE CourseCode = @CourseCode;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF @ImportBatchId IS NULL
        BEGIN
            SET @ImportBatchId = NEWID();
            INSERT staging.ImportBatch (ImportBatchId, StartedAtUtc, CompletedAtUtc, Status, SourceManifestSha256, ImporterVersion, ActorUpn, ValidationSummaryJson)
            VALUES (@ImportBatchId, SYSUTCDATETIME(), SYSUTCDATETIME(), N'Completed', CONVERT(char(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), @SessionJson)), 2), N'paws-api-p1-019', NULL, N'{"source":"session-create-api","validated":true}');
        END;

        IF EXISTS (
            SELECT 1 FROM paws.Session AS existing WITH (UPDLOCK, HOLDLOCK)
            WHERE existing.AcademicYear = @AcademicYear
              AND existing.CourseId = @CourseId
              AND existing.SessionDate = @Date
              AND existing.StartTime = @StartTime
              AND existing.EndTime = @EndTime
              AND existing.SessionType = @SessionType
              AND LOWER(LTRIM(RTRIM(COALESCE(existing.Topic, N'')))) = LOWER(LTRIM(RTRIM(@Topic)))
        ) THROW 51253, 'A matching canonical session already exists.', 1;

        SET @SessionId = NEWID();
        INSERT paws.Session (SessionId, AcademicYear, CurriculumYear, CourseId, CourseCode, CourseName, Topic, SessionType, SessionDate, StartTime, EndTime, Room, SourceImportBatchId)
        VALUES (@SessionId, @AcademicYear, @CurriculumYear, @CourseId, @CourseCode, @CourseName, @Topic, @SessionType, @Date, @StartTime, @EndTime, @Room, @ImportBatchId);

        INSERT paws.SessionAssignment (SessionAssignmentId, SessionId, FacultyId, SourceFacultyName, FacultyResolutionStatus, TeachingRole, LabLead, CreditedHours, DoeRate, DoeQuantity, DoeUnit, DoeCredit, DoeStatus, SourceImportBatchId, SourceRow)
        SELECT NEWID(), @SessionId, TRY_CONVERT(uniqueidentifier, JSON_VALUE(assignment.value, '$.facultyId')), NULL, N'resolved', NULLIF(LTRIM(RTRIM(JSON_VALUE(assignment.value, '$.teachingRole'))), N''), NULL, NULL, NULL, NULL, NULL, NULL, N'Needs Review', @ImportBatchId, @SourceRow
        FROM OPENJSON(@AssignmentsJson) AS assignment;

        SELECT @AfterJson = (
            SELECT s.SessionId AS id, s.AcademicYear AS academicYear, s.CurriculumYear AS curriculumYear, s.CourseCode AS courseCode, s.CourseName AS courseName,
                   s.Topic AS topic, s.SessionType AS sessionType, CONVERT(varchar(10), s.SessionDate, 23) AS date,
                   CONVERT(varchar(8), s.StartTime, 108) AS startTime, CONVERT(varchar(8), s.EndTime, 108) AS endTime, s.Room AS room,
                   JSON_QUERY((SELECT sa.FacultyId AS facultyId, sa.TeachingRole AS teachingRole FROM paws.SessionAssignment sa WHERE sa.SessionId = s.SessionId FOR JSON PATH, INCLUDE_NULL_VALUES)) AS assignments
            FROM paws.Session s WHERE s.SessionId = @SessionId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES
        );

        INSERT paws.AuditEvent (AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid, ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson, RequestId, ImportBatchId)
        VALUES (NEWID(), N'session_created', N'session', CONVERT(nvarchar(36), @SessionId), @ActorFirebaseUid, NULLIF(LTRIM(RTRIM(@ActorName)), N''), SYSUTCDATETIME(), @BeforeJson, @AfterJson, N'{"source":"paws_api.CreateCalendarSession"}', @RequestId, @ImportBatchId);

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    IF @ReturnSession = 1
    BEGIN
        SELECT c.SessionId AS id, c.AcademicYear AS academicYear, c.CurriculumYear AS curriculumYear, c.CourseCode AS courseCode, c.CourseName AS courseName,
               c.Topic AS topic, c.SessionType AS sessionType, CONVERT(varchar(10), c.SessionDate, 23) AS date,
               CONVERT(varchar(8), c.StartTime, 108) AS startTime, CONVERT(varchar(8), c.EndTime, 108) AS endTime, c.Room AS room, c.InstructorNames AS instructorNames
        FROM paws.vCalendarSession AS c WHERE c.SessionId = @SessionId;
    END;
END;
GO

CREATE PROCEDURE paws_api.CreateCalendarSessionBatch
    @RequestId uniqueidentifier,
    @SessionsJson nvarchar(max),
    @ActorFirebaseUid nvarchar(128),
    @ActorName nvarchar(260) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @RequestId IS NULL OR NULLIF(LTRIM(RTRIM(@ActorFirebaseUid)), N'') IS NULL OR ISJSON(@SessionsJson) <> 1 OR LEFT(LTRIM(@SessionsJson), 1) <> N'['
        THROW 51250, 'RequestId, actor, and a JSON sessions array are required.', 1;

    DECLARE @Rows TABLE (RowNumber int NOT NULL PRIMARY KEY, SessionJson nvarchar(max) NOT NULL);
    INSERT @Rows (RowNumber, SessionJson)
    SELECT TRY_CONVERT(int, [key]) + 1, value FROM OPENJSON(@SessionsJson) WHERE [type] = 5;
    IF EXISTS (SELECT 1 FROM OPENJSON(@SessionsJson) WHERE [type] <> 5)
       OR (SELECT COUNT(*) FROM @Rows) < 1 OR (SELECT COUNT(*) FROM @Rows) > 200
        THROW 51250, 'The session batch must contain between 1 and 200 session objects.', 1;

    DECLARE @PayloadHash binary(32) = HASHBYTES('SHA2_256', CONVERT(varbinary(max), @SessionsJson));
    DECLARE @ReplayJson nvarchar(max);
    DECLARE @IdempotentReplay bit = 0;
    DECLARE @ImportBatchId uniqueidentifier;
    DECLARE @RowNumber int;
    DECLARE @SessionJson nvarchar(max);
    DECLARE @SessionId uniqueidentifier;
    DECLARE @Created TABLE (RowNumber int NOT NULL PRIMARY KEY, SessionId uniqueidentifier NOT NULL);

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @ReplayJson = ResponseJson
        FROM paws_api.SessionBatchRequest WITH (UPDLOCK, HOLDLOCK)
        WHERE RequestId = @RequestId;

        IF @ReplayJson IS NOT NULL
        BEGIN
            IF EXISTS (SELECT 1 FROM paws_api.SessionBatchRequest WHERE RequestId = @RequestId AND (ActorFirebaseUid <> @ActorFirebaseUid OR PayloadSha256 <> @PayloadHash))
                THROW 51255, 'RequestId has already been used for a different actor or payload.', 1;
            SET @IdempotentReplay = 1;
            COMMIT TRANSACTION;
            SELECT id, academicYear, curriculumYear, courseCode, courseName, topic, sessionType, date, startTime, endTime, room, instructorNames, CAST(1 AS bit) AS idempotentReplay
            FROM OPENJSON(@ReplayJson) WITH (
                id uniqueidentifier '$.id', academicYear nvarchar(32) '$.academicYear', curriculumYear nvarchar(64) '$.curriculumYear',
                courseCode nvarchar(32) '$.courseCode', courseName nvarchar(512) '$.courseName', topic nvarchar(4000) '$.topic',
                sessionType nvarchar(128) '$.sessionType', date varchar(10) '$.date', startTime varchar(8) '$.startTime', endTime varchar(8) '$.endTime',
                room nvarchar(256) '$.room', instructorNames nvarchar(max) '$.instructorNames'
            ) ORDER BY id;
            RETURN;
        END;

        -- Validate every object before inserting any session or provenance row.
        DECLARE validate_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT RowNumber, SessionJson FROM @Rows ORDER BY RowNumber;
        OPEN validate_cursor;
        FETCH NEXT FROM validate_cursor INTO @RowNumber, @SessionJson;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            EXEC paws_api.ValidateCalendarSessionJson @SessionJson = @SessionJson;
            FETCH NEXT FROM validate_cursor INTO @RowNumber, @SessionJson;
        END;
        CLOSE validate_cursor;
        DEALLOCATE validate_cursor;

        IF EXISTS (
            SELECT 1
            FROM @Rows AS leftRow
            INNER JOIN @Rows AS rightRow ON rightRow.RowNumber > leftRow.RowNumber
            WHERE JSON_VALUE(leftRow.SessionJson, '$.academicYear') = JSON_VALUE(rightRow.SessionJson, '$.academicYear')
              AND UPPER(LTRIM(RTRIM(JSON_VALUE(leftRow.SessionJson, '$.courseCode')))) = UPPER(LTRIM(RTRIM(JSON_VALUE(rightRow.SessionJson, '$.courseCode'))))
              AND TRY_CONVERT(date, JSON_VALUE(leftRow.SessionJson, '$.date'), 23) = TRY_CONVERT(date, JSON_VALUE(rightRow.SessionJson, '$.date'), 23)
              AND TRY_CONVERT(time(0), JSON_VALUE(leftRow.SessionJson, '$.startTime')) = TRY_CONVERT(time(0), JSON_VALUE(rightRow.SessionJson, '$.startTime'))
              AND TRY_CONVERT(time(0), JSON_VALUE(leftRow.SessionJson, '$.endTime')) = TRY_CONVERT(time(0), JSON_VALUE(rightRow.SessionJson, '$.endTime'))
              AND JSON_VALUE(leftRow.SessionJson, '$.sessionType') = JSON_VALUE(rightRow.SessionJson, '$.sessionType')
              AND LOWER(LTRIM(RTRIM(JSON_VALUE(leftRow.SessionJson, '$.topic')))) = LOWER(LTRIM(RTRIM(JSON_VALUE(rightRow.SessionJson, '$.topic'))))
        ) THROW 51253, 'The batch contains duplicate session rows.', 1;

        DECLARE @ConflictRow int;
        SELECT TOP (1) @ConflictRow = row.RowNumber
            FROM @Rows AS row
            INNER JOIN paws.Course AS course ON course.CourseCode = LTRIM(RTRIM(JSON_VALUE(row.SessionJson, '$.courseCode')))
            INNER JOIN paws.Session AS existing WITH (UPDLOCK, HOLDLOCK)
              ON existing.AcademicYear = JSON_VALUE(row.SessionJson, '$.academicYear')
             AND existing.CourseId = course.CourseId
             AND existing.SessionDate = TRY_CONVERT(date, JSON_VALUE(row.SessionJson, '$.date'), 23)
             AND existing.StartTime = TRY_CONVERT(time(0), JSON_VALUE(row.SessionJson, '$.startTime'))
             AND existing.EndTime = TRY_CONVERT(time(0), JSON_VALUE(row.SessionJson, '$.endTime'))
             AND existing.SessionType = JSON_VALUE(row.SessionJson, '$.sessionType')
             AND LOWER(LTRIM(RTRIM(COALESCE(existing.Topic, N'')))) = LOWER(LTRIM(RTRIM(JSON_VALUE(row.SessionJson, '$.topic'))))
            ORDER BY row.RowNumber;
        IF @ConflictRow IS NOT NULL
        BEGIN
            DECLARE @ConflictMessage nvarchar(2048) = CONCAT(N'Batch row ', @ConflictRow, N' conflicts with canonical timetable data.');
            THROW 51253, @ConflictMessage, 1;
        END;

        SET @ImportBatchId = NEWID();
        INSERT staging.ImportBatch (ImportBatchId, StartedAtUtc, CompletedAtUtc, Status, SourceManifestSha256, ImporterVersion, ActorUpn, ValidationSummaryJson)
        VALUES (@ImportBatchId, SYSUTCDATETIME(), SYSUTCDATETIME(), N'Completed', CONVERT(char(64), @PayloadHash, 2), N'paws-api-p1-019-batch', NULL,
                (SELECT COUNT(*) AS [rowCount], CAST(1 AS bit) AS validated FROM @Rows FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

        INSERT paws_api.SessionBatchRequest (RequestId, ActorFirebaseUid, PayloadSha256, ResponseJson, CreatedAtUtc)
        VALUES (@RequestId, @ActorFirebaseUid, @PayloadHash, N'[]', SYSUTCDATETIME());

        DECLARE create_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT RowNumber, SessionJson FROM @Rows ORDER BY RowNumber;
        OPEN create_cursor;
        FETCH NEXT FROM create_cursor INTO @RowNumber, @SessionJson;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @SessionId = NULL;
            EXEC paws_api.CreateCalendarSession
                @SessionJson = @SessionJson,
                @ActorFirebaseUid = @ActorFirebaseUid,
                @ActorName = @ActorName,
                @RequestId = @RequestId,
                @ImportBatchId = @ImportBatchId OUTPUT,
                @SourceRow = @RowNumber,
                @SessionId = @SessionId OUTPUT,
                @ReturnSession = 0;
            INSERT @Created (RowNumber, SessionId) VALUES (@RowNumber, @SessionId);
            FETCH NEXT FROM create_cursor INTO @RowNumber, @SessionJson;
        END;
        CLOSE create_cursor;
        DEALLOCATE create_cursor;

        DECLARE @ResponseJson nvarchar(max) = (
            SELECT c.SessionId AS id, s.AcademicYear AS academicYear, s.CurriculumYear AS curriculumYear,
                   s.CourseCode AS courseCode, s.CourseName AS courseName, s.Topic AS topic, s.SessionType AS sessionType,
                   CONVERT(varchar(10), s.SessionDate, 23) AS date, CONVERT(varchar(8), s.StartTime, 108) AS startTime,
                   CONVERT(varchar(8), s.EndTime, 108) AS endTime, s.Room AS room, viewSession.InstructorNames AS instructorNames
            FROM @Created AS c
            INNER JOIN paws.Session AS s ON s.SessionId = c.SessionId
            INNER JOIN paws.vCalendarSession AS viewSession ON viewSession.SessionId = s.SessionId
            ORDER BY c.RowNumber
            FOR JSON PATH, INCLUDE_NULL_VALUES
        );
        UPDATE paws_api.SessionBatchRequest SET ResponseJson = @ResponseJson WHERE RequestId = @RequestId;

        COMMIT TRANSACTION;
        SELECT c.SessionId AS id, s.AcademicYear AS academicYear, s.CurriculumYear AS curriculumYear,
               s.CourseCode AS courseCode, s.CourseName AS courseName, s.Topic AS topic, s.SessionType AS sessionType,
               CONVERT(varchar(10), s.SessionDate, 23) AS date, CONVERT(varchar(8), s.StartTime, 108) AS startTime,
               CONVERT(varchar(8), s.EndTime, 108) AS endTime, s.Room AS room, viewSession.InstructorNames AS instructorNames,
               CAST(0 AS bit) AS idempotentReplay
        FROM @Created AS c
        INNER JOIN paws.Session AS s ON s.SessionId = c.SessionId
        INNER JOIN paws.vCalendarSession AS viewSession ON viewSession.SessionId = s.SessionId
        ORDER BY c.RowNumber;
    END TRY
    BEGIN CATCH
        IF CURSOR_STATUS('local', 'validate_cursor') >= 0 CLOSE validate_cursor;
        IF CURSOR_STATUS('local', 'validate_cursor') > -3 DEALLOCATE validate_cursor;
        IF CURSOR_STATUS('local', 'create_cursor') >= 0 CLOSE create_cursor;
        IF CURSOR_STATUS('local', 'create_cursor') > -3 DEALLOCATE create_cursor;
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE PROCEDURE paws_api.ReplaceCalendarSessionAssignments
    @SessionId uniqueidentifier,
    @AssignmentsJson nvarchar(max),
    @ActorFirebaseUid nvarchar(128),
    @ActorName nvarchar(260) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @SessionId IS NULL OR ISJSON(@AssignmentsJson) <> 1 OR LEFT(LTRIM(@AssignmentsJson), 1) <> N'[' OR NULLIF(LTRIM(RTRIM(@ActorFirebaseUid)), N'') IS NULL
        THROW 51261, 'Invalid session assignment request.', 1;

    DECLARE @Assignments TABLE (FacultyId uniqueidentifier NULL, TeachingRole nvarchar(256) NULL);
    IF EXISTS (SELECT 1 FROM OPENJSON(@AssignmentsJson) WHERE [type] <> 5)
       OR (SELECT COUNT_BIG(*) FROM OPENJSON(@AssignmentsJson)) > 30
        THROW 51261, 'Assignments must be a bounded array of objects.', 1;
    IF EXISTS (
        SELECT 1 FROM OPENJSON(@AssignmentsJson) AS assignment
        CROSS APPLY OPENJSON(assignment.value) AS field
        WHERE field.[key] NOT IN (N'facultyId', N'teachingRole')
    ) THROW 51261, 'Unsupported assignment fields.', 1;

    INSERT @Assignments (FacultyId, TeachingRole)
    SELECT TRY_CONVERT(uniqueidentifier, JSON_VALUE(value, '$.facultyId')),
           NULLIF(LTRIM(RTRIM(JSON_VALUE(value, '$.teachingRole'))), N'')
    FROM OPENJSON(@AssignmentsJson);

    IF EXISTS (SELECT 1 FROM @Assignments WHERE FacultyId IS NULL OR DATALENGTH(COALESCE(TeachingRole, N'')) > 512)
       OR EXISTS (SELECT FacultyId FROM @Assignments GROUP BY FacultyId HAVING COUNT_BIG(*) > 1)
       OR EXISTS (SELECT 1 FROM @Assignments a WHERE NOT EXISTS (SELECT 1 FROM paws.Faculty f WHERE f.FacultyId = a.FacultyId AND f.Active = 1))
        THROW 51261, 'Assignment FacultyId must resolve to distinct active canonical Faculty records.', 1;

    DECLARE @BeforeJson nvarchar(max);
    DECLARE @AfterJson nvarchar(max);
    DECLARE @ExistingImportBatch uniqueidentifier;
    DECLARE @ManifestHash char(64) = CONVERT(char(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), @AssignmentsJson)), 2);

    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM paws.Session WITH (UPDLOCK, HOLDLOCK) WHERE SessionId = @SessionId)
            THROW 51260, 'Session was not found.', 1;

        SELECT @BeforeJson = (
            SELECT sa.SessionAssignmentId AS sessionAssignmentId, sa.FacultyId AS facultyId, sa.SourceFacultyName AS sourceFacultyName,
                   sa.FacultyResolutionStatus AS facultyResolutionStatus, sa.TeachingRole AS teachingRole, sa.LabLead AS labLead,
                   sa.CreditedHours AS creditedHours, sa.DoeRate AS doeRate, sa.DoeQuantity AS doeQuantity, sa.DoeUnit AS doeUnit,
                   sa.DoeCredit AS doeCredit, sa.DoeStatus AS doeStatus, sa.SourceImportBatchId AS sourceImportBatchId, sa.SourceRow AS sourceRow
            FROM paws.SessionAssignment sa WITH (UPDLOCK, HOLDLOCK)
            WHERE sa.SessionId = @SessionId FOR JSON PATH, INCLUDE_NULL_VALUES
        );

        IF EXISTS (
            SELECT 1 FROM paws.SessionAssignment AS existing
            WHERE existing.SessionId = @SessionId
              AND NOT EXISTS (SELECT 1 FROM @Assignments AS requested WHERE requested.FacultyId = existing.FacultyId)
              AND (existing.FacultyId IS NULL OR existing.FacultyResolutionStatus <> N'resolved' OR existing.SourceFacultyName IS NOT NULL OR existing.LabLead IS NOT NULL
                   OR existing.CreditedHours IS NOT NULL OR existing.DoeRate IS NOT NULL OR existing.DoeQuantity IS NOT NULL OR existing.DoeUnit IS NOT NULL OR existing.DoeCredit IS NOT NULL)
        ) THROW 51262, 'An unresolved, sourced, lead, or workload-bearing assignment cannot be removed through this endpoint.', 1;

        IF EXISTS (
            SELECT 1
            FROM paws.SessionAssignment AS existing
            INNER JOIN @Assignments AS requested ON requested.FacultyId = existing.FacultyId
            WHERE existing.SessionId = @SessionId
              AND ISNULL(existing.TeachingRole, N'') <> ISNULL(requested.TeachingRole, N'')
              AND (existing.CreditedHours IS NOT NULL OR existing.DoeRate IS NOT NULL OR existing.DoeQuantity IS NOT NULL OR existing.DoeUnit IS NOT NULL OR existing.DoeCredit IS NOT NULL)
        ) THROW 51263, 'An assignment with recorded workload or DOE cannot have its role changed through this endpoint.', 1;

        SET @ExistingImportBatch = NEWID();
        INSERT staging.ImportBatch (ImportBatchId, StartedAtUtc, CompletedAtUtc, Status, SourceManifestSha256, ImporterVersion, ActorUpn, ValidationSummaryJson)
        VALUES (@ExistingImportBatch, SYSUTCDATETIME(), SYSUTCDATETIME(), N'Completed', @ManifestHash, N'paws-api-p1-019-assignments', NULL, N'{"source":"session-assignment-api","validated":true}');

        UPDATE existing
        SET TeachingRole = requested.TeachingRole, FacultyResolutionStatus = N'resolved'
        FROM paws.SessionAssignment AS existing
        INNER JOIN @Assignments AS requested ON requested.FacultyId = existing.FacultyId
        WHERE existing.SessionId = @SessionId;

        INSERT paws.SessionAssignment (SessionAssignmentId, SessionId, FacultyId, SourceFacultyName, FacultyResolutionStatus, TeachingRole, LabLead, CreditedHours, DoeRate, DoeQuantity, DoeUnit, DoeCredit, DoeStatus, SourceImportBatchId, SourceRow)
        SELECT NEWID(), @SessionId, requested.FacultyId, NULL, N'resolved', requested.TeachingRole, NULL, NULL, NULL, NULL, NULL, NULL, N'Needs Review', @ExistingImportBatch, 1
        FROM @Assignments AS requested
        WHERE NOT EXISTS (SELECT 1 FROM paws.SessionAssignment AS existing WITH (UPDLOCK, HOLDLOCK) WHERE existing.SessionId = @SessionId AND existing.FacultyId = requested.FacultyId);

        DELETE existing
        FROM paws.SessionAssignment AS existing
        WHERE existing.SessionId = @SessionId
          AND NOT EXISTS (SELECT 1 FROM @Assignments AS requested WHERE requested.FacultyId = existing.FacultyId);

        SELECT @AfterJson = (
            SELECT sa.SessionAssignmentId AS sessionAssignmentId, sa.FacultyId AS facultyId, sa.TeachingRole AS teachingRole,
                   sa.CreditedHours AS creditedHours, sa.DoeRate AS doeRate, sa.DoeQuantity AS doeQuantity,
                   sa.DoeUnit AS doeUnit, sa.DoeCredit AS doeCredit, sa.DoeStatus AS doeStatus
            FROM paws.SessionAssignment sa WHERE sa.SessionId = @SessionId FOR JSON PATH, INCLUDE_NULL_VALUES
        );

        INSERT paws.AuditEvent (AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid, ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson, RequestId, ImportBatchId)
        VALUES (NEWID(), N'session_assignments_replaced', N'session', CONVERT(nvarchar(36), @SessionId), @ActorFirebaseUid, NULLIF(LTRIM(RTRIM(@ActorName)), N''), SYSUTCDATETIME(), @BeforeJson, @AfterJson, N'{"source":"paws_api.ReplaceCalendarSessionAssignments"}', NEWID(), @ExistingImportBatch);

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT c.SessionId AS id, c.AcademicYear AS academicYear, c.CurriculumYear AS curriculumYear, c.CourseCode AS courseCode, c.CourseName AS courseName,
           c.Topic AS topic, c.SessionType AS sessionType, CONVERT(varchar(10), c.SessionDate, 23) AS date,
           CONVERT(varchar(8), c.StartTime, 108) AS startTime, CONVERT(varchar(8), c.EndTime, 108) AS endTime, c.Room AS room, c.InstructorNames AS instructorNames
    FROM paws.vCalendarSession AS c WHERE c.SessionId = @SessionId;
END;
GO

-- No direct INSERT/UPDATE/DELETE grants are created. The current temporary Beta
-- runtime is overprivileged; stored-procedure-only identity grants remain a
-- separately governed production prerequisite.
COMMIT TRANSACTION;
