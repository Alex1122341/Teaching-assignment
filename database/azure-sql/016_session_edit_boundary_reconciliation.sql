SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'VetMed-Ops'
    THROW 51600, 'Migration 016 must run in VetMed-Ops.', 1;

DECLARE @CurrentDefinition nvarchar(max) = OBJECT_DEFINITION(OBJECT_ID(N'paws_api.UpdateCalendarSession', N'P'));
IF @CurrentDefinition IS NULL
    THROW 51601, 'Migration 016 requires paws_api.UpdateCalendarSession to exist.', 1;

DECLARE @CurrentRawHash varchar(64) = CONVERT(varchar(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), @CurrentDefinition)), 2);
DECLARE @ExpectedWeakerHash varchar(64) = N'0A4459A9E254D65144D3E3A0F7097F5C01D20F90365B4BC2F557D34941994E57';
DECLARE @ExpectedTargetCanonicalHash varchar(64) = N'F09724E9BF3BD9A2D5286B9F00FF1B88049FFD9173103CE162FA2D7571A9AFB0';

DECLARE @CurrentCanonicalDefinition nvarchar(max) = REPLACE(REPLACE(@CurrentDefinition, NCHAR(13) + NCHAR(10), NCHAR(10)), NCHAR(13), NCHAR(10));
DECLARE @CurrentCanonicalLength int = DATALENGTH(@CurrentCanonicalDefinition) / 2;
WHILE @CurrentCanonicalLength > 0 AND LEFT(@CurrentCanonicalDefinition, 1) = NCHAR(10)
BEGIN
    SET @CurrentCanonicalDefinition = SUBSTRING(@CurrentCanonicalDefinition, 2, @CurrentCanonicalLength - 1);
    SET @CurrentCanonicalLength -= 1;
END;
WHILE @CurrentCanonicalLength > 0 AND RIGHT(@CurrentCanonicalDefinition, 1) = NCHAR(10)
BEGIN
    SET @CurrentCanonicalDefinition = SUBSTRING(@CurrentCanonicalDefinition, 1, @CurrentCanonicalLength - 1);
    SET @CurrentCanonicalLength -= 1;
END;

DECLARE @CurrentHeader nvarchar(64);
IF LEFT(@CurrentCanonicalDefinition, DATALENGTH(N'CREATE OR ALTER PROCEDURE') / 2) COLLATE Latin1_General_100_BIN2 = N'CREATE OR ALTER PROCEDURE'
    SET @CurrentHeader = N'CREATE OR ALTER PROCEDURE';
ELSE IF LEFT(@CurrentCanonicalDefinition, DATALENGTH(N'CREATE PROCEDURE') / 2) COLLATE Latin1_General_100_BIN2 = N'CREATE PROCEDURE'
    SET @CurrentHeader = N'CREATE PROCEDURE';
ELSE IF LEFT(@CurrentCanonicalDefinition, DATALENGTH(N'CREATE   PROCEDURE') / 2) COLLATE Latin1_General_100_BIN2 = N'CREATE   PROCEDURE'
    SET @CurrentHeader = N'CREATE   PROCEDURE';
ELSE IF LEFT(@CurrentCanonicalDefinition, DATALENGTH(N'ALTER PROCEDURE') / 2) COLLATE Latin1_General_100_BIN2 = N'ALTER PROCEDURE'
    SET @CurrentHeader = N'ALTER PROCEDURE';
IF @CurrentHeader IS NULL
    THROW 51604, 'Migration 016 stopped: the procedure declaration header is not an audited representation.', 1;
SET @CurrentCanonicalDefinition = STUFF(@CurrentCanonicalDefinition, 1, DATALENGTH(@CurrentHeader) / 2, N'CREATE OR ALTER PROCEDURE');
DECLARE @CurrentCanonicalHash varchar(64) = CONVERT(varchar(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), @CurrentCanonicalDefinition)), 2);

IF @CurrentRawHash <> @ExpectedWeakerHash AND @CurrentCanonicalHash <> @ExpectedTargetCanonicalHash
    THROW 51602, 'Migration 016 stopped: the procedure definition is not an audited starting state.', 1;

BEGIN TRY
    BEGIN TRANSACTION;
    IF @CurrentRawHash = @ExpectedWeakerHash
    BEGIN
        DECLARE @TargetDefinition nvarchar(max) = N'CREATE OR ALTER PROCEDURE paws_api.UpdateCalendarSession
    @SessionId uniqueidentifier,
    @PatchJson nvarchar(max),
    @ActorFirebaseUid nvarchar(128),
    @ActorName nvarchar(260) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @SessionId IS NULL OR ISJSON(@PatchJson) <> 1 OR NULLIF(LTRIM(RTRIM(@ActorFirebaseUid)), N'''') IS NULL
        THROW 51240, ''Invalid session edit request.'', 1;

    DECLARE @Fields TABLE ([Key] nvarchar(4000) NOT NULL);
    INSERT @Fields ([Key]) SELECT [key] FROM OPENJSON(@PatchJson);

    IF NOT EXISTS (SELECT 1 FROM @Fields)
       OR EXISTS (SELECT [Key] FROM @Fields GROUP BY [Key] HAVING COUNT_BIG(*) > 1)
       OR EXISTS (SELECT 1 FROM @Fields WHERE [Key] NOT IN (N''date'', N''startTime'', N''endTime'', N''courseCode'', N''sessionType'', N''topic'', N''room''))
        THROW 51241, ''Unsupported or duplicate session edit fields.'', 1;

    DECLARE @Date date = TRY_CONVERT(date, JSON_VALUE(@PatchJson, ''$.date''), 23);
    DECLARE @StartText nvarchar(16) = JSON_VALUE(@PatchJson, ''$.startTime'');
    DECLARE @EndText nvarchar(16) = JSON_VALUE(@PatchJson, ''$.endTime'');
    DECLARE @StartTime time(0) = TRY_CONVERT(time(0), @StartText);
    DECLARE @EndTime time(0) = TRY_CONVERT(time(0), @EndText);
    DECLARE @CourseCode nvarchar(32) = NULLIF(LTRIM(RTRIM(JSON_VALUE(@PatchJson, ''$.courseCode''))), N'''');
    DECLARE @SessionType nvarchar(128) = JSON_VALUE(@PatchJson, ''$.sessionType'');
    DECLARE @Topic nvarchar(4000) = JSON_VALUE(@PatchJson, ''$.topic'');
    DECLARE @Room nvarchar(256) = JSON_VALUE(@PatchJson, ''$.room'');
    DECLARE @HasDate bit = IIF(EXISTS (SELECT 1 FROM @Fields WHERE [Key] = N''date''), 1, 0);
    DECLARE @HasStart bit = IIF(EXISTS (SELECT 1 FROM @Fields WHERE [Key] = N''startTime''), 1, 0);
    DECLARE @HasEnd bit = IIF(EXISTS (SELECT 1 FROM @Fields WHERE [Key] = N''endTime''), 1, 0);
    DECLARE @HasCourse bit = IIF(EXISTS (SELECT 1 FROM @Fields WHERE [Key] = N''courseCode''), 1, 0);
    DECLARE @HasType bit = IIF(EXISTS (SELECT 1 FROM @Fields WHERE [Key] = N''sessionType''), 1, 0);
    DECLARE @HasTopic bit = IIF(EXISTS (SELECT 1 FROM @Fields WHERE [Key] = N''topic''), 1, 0);
    DECLARE @HasRoom bit = IIF(EXISTS (SELECT 1 FROM @Fields WHERE [Key] = N''room''), 1, 0);

    IF (@HasDate = 1 AND @Date IS NULL)
       OR (@HasStart <> @HasEnd)
       OR (@HasStart = 1 AND NOT ((@StartText IS NULL AND @EndText IS NULL) OR (@StartTime IS NOT NULL AND @EndTime IS NOT NULL AND @StartTime < @EndTime)))
       OR (@HasCourse = 1 AND DATALENGTH(JSON_VALUE(@PatchJson, ''$.courseCode'')) > 64)
       OR (@HasCourse = 1 AND @CourseCode IS NULL)
       OR (@HasType = 1 AND (@SessionType IS NULL OR DATALENGTH(JSON_VALUE(@PatchJson, ''$.sessionType'')) > 256 OR @SessionType NOT IN (N''LEC'', N''LAB'', N''SRL'', N''Quiz/Midterm'', N''OSCE'', N''Exam'')))
       OR (@HasTopic = 1 AND DATALENGTH(JSON_VALUE(@PatchJson, ''$.topic'')) > 8000)
       OR (@HasRoom = 1 AND DATALENGTH(JSON_VALUE(@PatchJson, ''$.room'')) > 512)
        THROW 51242, ''Invalid session edit values.'', 1;

    DECLARE @CourseId uniqueidentifier = NULL;
    DECLARE @CourseName nvarchar(512) = NULL;
    IF @HasCourse = 1
    BEGIN
        SELECT @CourseId = CourseId, @CourseName = CourseName
        FROM paws.Course
        WHERE CourseCode = @CourseCode;
        IF @CourseId IS NULL THROW 51243, ''Course code was not found.'', 1;
    END;

    DECLARE @BeforeJson nvarchar(max);
    DECLARE @AfterJson nvarchar(max);
    DECLARE @AcademicYear nvarchar(32);
    DECLARE @NextDate date;
    DECLARE @NextStartTime time(0);
    DECLARE @NextEndTime time(0);
    DECLARE @NextCourseId uniqueidentifier;
    DECLARE @NextSessionType nvarchar(128);
    DECLARE @NextTopic nvarchar(max);

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @AcademicYear = s.AcademicYear,
               @BeforeJson = (SELECT s.SessionId AS id, s.AcademicYear AS academicYear,
                   s.CurriculumYear AS curriculumYear, s.CourseCode AS courseCode, s.CourseName AS courseName,
                   s.Topic AS topic, s.SessionType AS sessionType,
                   CONVERT(varchar(10), s.SessionDate, 23) AS date,
                   CONVERT(varchar(8), s.StartTime, 108) AS startTime,
                   CONVERT(varchar(8), s.EndTime, 108) AS endTime, s.Room AS room
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES)
        FROM paws.Session AS s WITH (UPDLOCK, HOLDLOCK)
        WHERE s.SessionId = @SessionId;

        IF @BeforeJson IS NULL
        BEGIN
            ROLLBACK TRANSACTION;
            RETURN;
        END;
        IF @AcademicYear NOT LIKE ''[12][0-9][0-9][0-9]-[0-9][0-9]''
           OR TRY_CONVERT(int, RIGHT(@AcademicYear, 2)) <> (TRY_CONVERT(int, LEFT(@AcademicYear, 4)) + 1) % 100
            THROW 51244, ''The stored academic year is invalid.'', 1;

        SELECT @NextDate = CASE WHEN @HasDate = 1 THEN @Date ELSE SessionDate END,
               @NextStartTime = CASE WHEN @HasStart = 1 THEN @StartTime ELSE StartTime END,
               @NextEndTime = CASE WHEN @HasEnd = 1 THEN @EndTime ELSE EndTime END,
               @NextCourseId = CASE WHEN @HasCourse = 1 THEN @CourseId ELSE CourseId END,
               @NextSessionType = CASE WHEN @HasType = 1 THEN @SessionType ELSE SessionType END,
               @NextTopic = CASE WHEN @HasTopic = 1 THEN @Topic ELSE Topic END
        FROM paws.Session WHERE SessionId = @SessionId;

        IF @HasDate = 1 AND (
            @NextDate < DATEFROMPARTS(TRY_CONVERT(int, LEFT(@AcademicYear, 4)), 5, 1)
            OR @NextDate >= DATEFROMPARTS(TRY_CONVERT(int, LEFT(@AcademicYear, 4)) + 1, 5, 1)
        ) THROW 51245, ''The date does not match the stored academic year.'', 1;

        IF EXISTS (
            SELECT 1 FROM paws.Session AS duplicate WITH (UPDLOCK, HOLDLOCK)
            WHERE duplicate.SessionId <> @SessionId
              AND duplicate.AcademicYear = @AcademicYear
              AND ISNULL(duplicate.CourseId, ''00000000-0000-0000-0000-000000000000'') = ISNULL(@NextCourseId, ''00000000-0000-0000-0000-000000000000'')
              AND ISNULL(duplicate.SessionDate, CONVERT(date, ''00010101'', 112)) = ISNULL(@NextDate, CONVERT(date, ''00010101'', 112))
              AND ISNULL(duplicate.StartTime, CONVERT(time(0), ''00:00'')) = ISNULL(@NextStartTime, CONVERT(time(0), ''00:00''))
              AND ISNULL(duplicate.EndTime, CONVERT(time(0), ''00:00'')) = ISNULL(@NextEndTime, CONVERT(time(0), ''00:00''))
              AND LOWER(LTRIM(RTRIM(ISNULL(duplicate.SessionType, N'''')))) = LOWER(LTRIM(RTRIM(ISNULL(@NextSessionType, N''''))))
              AND LOWER(LTRIM(RTRIM(ISNULL(duplicate.Topic, N'''')))) = LOWER(LTRIM(RTRIM(ISNULL(@NextTopic, N''''))))
        ) THROW 51246, ''The edit would duplicate an existing session.'', 1;

        UPDATE paws.Session
        SET SessionDate = CASE WHEN @HasDate = 1 THEN @Date ELSE SessionDate END,
            StartTime = CASE WHEN @HasStart = 1 THEN @StartTime ELSE StartTime END,
            EndTime = CASE WHEN @HasEnd = 1 THEN @EndTime ELSE EndTime END,
            CourseId = CASE WHEN @HasCourse = 1 THEN @CourseId ELSE CourseId END,
            CourseCode = CASE WHEN @HasCourse = 1 THEN @CourseCode ELSE CourseCode END,
            CourseName = CASE WHEN @HasCourse = 1 THEN @CourseName ELSE CourseName END,
            SessionType = CASE WHEN @HasType = 1 THEN @SessionType ELSE SessionType END,
            Topic = CASE WHEN @HasTopic = 1 THEN @Topic ELSE Topic END,
            Room = CASE WHEN @HasRoom = 1 THEN @Room ELSE Room END,
            UpdatedAtUtc = SYSUTCDATETIME()
        WHERE SessionId = @SessionId;

        SELECT @AfterJson = (SELECT s.SessionId AS id, s.AcademicYear AS academicYear,
               s.CurriculumYear AS curriculumYear, s.CourseCode AS courseCode, s.CourseName AS courseName,
               s.Topic AS topic, s.SessionType AS sessionType,
               CONVERT(varchar(10), s.SessionDate, 23) AS date,
               CONVERT(varchar(8), s.StartTime, 108) AS startTime,
               CONVERT(varchar(8), s.EndTime, 108) AS endTime, s.Room AS room,
               c.InstructorNames AS instructorNames
            FROM paws.vCalendarSession AS c
            INNER JOIN paws.Session AS s ON s.SessionId = c.SessionId
            WHERE s.SessionId = @SessionId
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);

        INSERT paws.AuditEvent (
            AuditEventId, EventType, EntityType, EntityId, ActorFirebaseUid,
            ActorName, OccurredAtUtc, BeforeJson, AfterJson, MetadataJson, RequestId, ImportBatchId
        ) VALUES (
            NEWID(), N''session_updated'', N''session'', CONVERT(nvarchar(36), @SessionId),
            @ActorFirebaseUid, NULLIF(LTRIM(RTRIM(@ActorName)), N''''), SYSUTCDATETIME(),
            @BeforeJson, @AfterJson,
            (SELECT [Key] AS field FROM @Fields ORDER BY [Key] FOR JSON PATH), NEWID(), NULL
        );

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT s.SessionId AS id, s.AcademicYear AS academicYear,
           s.CurriculumYear AS curriculumYear, s.CourseCode AS courseCode, s.CourseName AS courseName,
           s.Topic AS topic, s.SessionType AS sessionType,
           CONVERT(varchar(10), s.SessionDate, 23) AS date,
           CONVERT(varchar(8), s.StartTime, 108) AS startTime,
           CONVERT(varchar(8), s.EndTime, 108) AS endTime, s.Room AS room,
           c.InstructorNames AS instructorNames
    FROM paws.vCalendarSession AS c
    INNER JOIN paws.Session AS s ON s.SessionId = c.SessionId
    WHERE s.SessionId = @SessionId;
END;
';
        EXEC sys.sp_executesql @TargetDefinition;
    END;

    DECLARE @FinalDefinition nvarchar(max) = OBJECT_DEFINITION(OBJECT_ID(N'paws_api.UpdateCalendarSession', N'P'));
    IF @FinalDefinition IS NULL
        THROW 51605, 'Migration 016 stopped: the target procedure definition disappeared.', 1;
    DECLARE @FinalRawHash varchar(64) = CONVERT(varchar(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), @FinalDefinition)), 2);
    DECLARE @FinalCanonicalDefinition nvarchar(max) = REPLACE(REPLACE(@FinalDefinition, NCHAR(13) + NCHAR(10), NCHAR(10)), NCHAR(13), NCHAR(10));
    DECLARE @FinalCanonicalLength int = DATALENGTH(@FinalCanonicalDefinition) / 2;
    WHILE @FinalCanonicalLength > 0 AND LEFT(@FinalCanonicalDefinition, 1) = NCHAR(10)
    BEGIN
        SET @FinalCanonicalDefinition = SUBSTRING(@FinalCanonicalDefinition, 2, @FinalCanonicalLength - 1);
        SET @FinalCanonicalLength -= 1;
    END;
    WHILE @FinalCanonicalLength > 0 AND RIGHT(@FinalCanonicalDefinition, 1) = NCHAR(10)
    BEGIN
        SET @FinalCanonicalDefinition = SUBSTRING(@FinalCanonicalDefinition, 1, @FinalCanonicalLength - 1);
        SET @FinalCanonicalLength -= 1;
    END;

    DECLARE @FinalHeader nvarchar(64);
    IF LEFT(@FinalCanonicalDefinition, DATALENGTH(N'CREATE OR ALTER PROCEDURE') / 2) COLLATE Latin1_General_100_BIN2 = N'CREATE OR ALTER PROCEDURE'
        SET @FinalHeader = N'CREATE OR ALTER PROCEDURE';
    ELSE IF LEFT(@FinalCanonicalDefinition, DATALENGTH(N'CREATE PROCEDURE') / 2) COLLATE Latin1_General_100_BIN2 = N'CREATE PROCEDURE'
        SET @FinalHeader = N'CREATE PROCEDURE';
    ELSE IF LEFT(@FinalCanonicalDefinition, DATALENGTH(N'CREATE   PROCEDURE') / 2) COLLATE Latin1_General_100_BIN2 = N'CREATE   PROCEDURE'
        SET @FinalHeader = N'CREATE   PROCEDURE';
    ELSE IF LEFT(@FinalCanonicalDefinition, DATALENGTH(N'ALTER PROCEDURE') / 2) COLLATE Latin1_General_100_BIN2 = N'ALTER PROCEDURE'
        SET @FinalHeader = N'ALTER PROCEDURE';
    IF @FinalHeader IS NULL
        THROW 51606, 'Migration 016 stopped: resulting procedure declaration header is not recognized.', 1;
    SET @FinalCanonicalDefinition = STUFF(@FinalCanonicalDefinition, 1, DATALENGTH(@FinalHeader) / 2, N'CREATE OR ALTER PROCEDURE');
    DECLARE @FinalCanonicalHash varchar(64) = CONVERT(varchar(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), @FinalCanonicalDefinition)), 2);
    IF @FinalCanonicalHash <> @ExpectedTargetCanonicalHash
        THROW 51603, 'Migration 016 stopped: the resulting procedure definition did not match migration 012.', 1;
    PRINT CONCAT('RAW_FINAL_HASH=', @FinalRawHash);
    PRINT CONCAT('CANONICAL_FINAL_HASH=', @FinalCanonicalHash);
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

PRINT 'MIGRATION_016_SESSION_EDIT_BOUNDARY_OK';
