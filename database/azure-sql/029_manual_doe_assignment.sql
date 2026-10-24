-- Negotiated manual DOE is additive and never creates an annual calculation.
SET XACT_ABORT ON;
IF DB_NAME()<>N'VetMed-Ops' THROW 52900,'Wrong database for PAWS manual DOE migration.',1;
IF OBJECT_ID(N'paws.DoeAuditEvent',N'U') IS NULL OR DATABASE_PRINCIPAL_ID(N'paws_runtime_read') IS NULL
    THROW 52901,'DOE foundation and runtime read role are required.',1;
GO
IF OBJECT_ID(N'paws.ManualDoeAssignment',N'U') IS NULL
BEGIN
    CREATE TABLE paws.ManualDoeAssignment (
        AssignmentId uniqueidentifier NOT NULL CONSTRAINT PK_ManualDoeAssignment PRIMARY KEY,
        FacultyId uniqueidentifier NOT NULL REFERENCES paws.Faculty(FacultyId),
        AcademicYear nvarchar(32) NOT NULL,
        RoleType nvarchar(128) NOT NULL,
        ScopeText nvarchar(256) NOT NULL,
        CourseCode nvarchar(64) NULL,
        SubjectKey nvarchar(128) NULL,
        DoeValue decimal(12,6) NOT NULL,
        Notes nvarchar(1000) NULL,
        Active bit NOT NULL DEFAULT(1),
        Revision bigint NOT NULL DEFAULT(1),
        CreatedBy nvarchar(128) NOT NULL,
        CreatedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedBy nvarchar(128) NOT NULL,
        UpdatedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_ManualDoeAssignment_Role CHECK(RoleType IN(N'Course Coordinator',N'HICC',N'VISC',N'Course Coordinator / HICC',N'Rotation / Week Lead',N'CCC',N'Trainee / Supervision',N'Special Project',N'Other')),
        CONSTRAINT CK_ManualDoeAssignment_Scope CHECK(LEN(LTRIM(RTRIM(ScopeText)))>0),
        CONSTRAINT CK_ManualDoeAssignment_NegativeReason CHECK(DoeValue>=0 OR LEN(LTRIM(RTRIM(COALESCE(Notes,N''))))>0),
        CONSTRAINT CK_ManualDoeAssignment_Revision CHECK(Revision>0)
    );
    CREATE INDEX IX_ManualDoeAssignment_FacultyYearActive ON paws.ManualDoeAssignment(FacultyId,AcademicYear,Active);
END;
IF DATABASE_PRINCIPAL_ID(N'paws_runtime_manual_doe_write') IS NULL
    CREATE ROLE paws_runtime_manual_doe_write AUTHORIZATION dbo;
GRANT SELECT ON OBJECT::paws.ManualDoeAssignment TO paws_runtime_read;
GRANT SELECT ON OBJECT::paws.Course (CourseCode, CourseName) TO [paws_runtime_read];
GO
CREATE OR ALTER PROCEDURE paws.SaveManualDoeAssignment
    @assignmentId uniqueidentifier, @facultyId uniqueidentifier, @academicYear nvarchar(32),
    @expectedRevision bigint, @roleType nvarchar(128), @scopeText nvarchar(256),
    @courseCode nvarchar(64), @subjectKey nvarchar(128), @doeValue decimal(12,6),
    @notes nvarchar(1000), @actorUid nvarchar(128), @deactivate bit=0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@actorUid)),N'') IS NULL OR @expectedRevision<0
        THROW 52902,'MANUAL_DOE_INVALID',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS(SELECT 1 FROM paws.Faculty WITH(HOLDLOCK) WHERE FacultyId=@facultyId)
            THROW 52903,'MANUAL_DOE_FACULTY_NOT_FOUND',1;
        DECLARE @before nvarchar(max),@after nvarchar(max),@revision bigint,@action nvarchar(64);
        SELECT @revision=Revision,@before=(SELECT m.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)
            FROM paws.ManualDoeAssignment AS m WITH(UPDLOCK,HOLDLOCK)
            WHERE AssignmentId=@assignmentId;
        IF @expectedRevision=0
        BEGIN
            IF @revision IS NOT NULL OR @deactivate=1 THROW 52904,'MANUAL_DOE_REVISION_CONFLICT',1;
            INSERT paws.ManualDoeAssignment(AssignmentId,FacultyId,AcademicYear,RoleType,ScopeText,CourseCode,SubjectKey,DoeValue,Notes,CreatedBy,UpdatedBy)
            VALUES(@assignmentId,@facultyId,@academicYear,@roleType,@scopeText,@courseCode,@subjectKey,@doeValue,@notes,@actorUid,@actorUid);
            SET @action=N'manual_doe_created';
        END
        ELSE
        BEGIN
            IF @revision IS NULL THROW 52905,'MANUAL_DOE_NOT_FOUND',1;
            IF @revision<>@expectedRevision THROW 52904,'MANUAL_DOE_REVISION_CONFLICT',1;
            IF NOT EXISTS(SELECT 1 FROM paws.ManualDoeAssignment WHERE AssignmentId=@assignmentId AND FacultyId=@facultyId AND AcademicYear=@academicYear AND Active=1)
                THROW 52905,'MANUAL_DOE_NOT_FOUND',1;
            IF @deactivate=1
            BEGIN
                UPDATE paws.ManualDoeAssignment SET Active=0,Revision=Revision+1,UpdatedBy=@actorUid,UpdatedAtUtc=SYSUTCDATETIME()
                    WHERE AssignmentId=@assignmentId;
                SET @action=N'manual_doe_deactivated';
            END
            ELSE
            BEGIN
                UPDATE paws.ManualDoeAssignment SET RoleType=@roleType,ScopeText=@scopeText,CourseCode=@courseCode,
                    SubjectKey=@subjectKey,DoeValue=@doeValue,Notes=@notes,Revision=Revision+1,UpdatedBy=@actorUid,UpdatedAtUtc=SYSUTCDATETIME()
                    WHERE AssignmentId=@assignmentId;
                SET @action=N'manual_doe_updated';
            END;
        END;
        SELECT @after=(SELECT m.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM paws.ManualDoeAssignment m WHERE AssignmentId=@assignmentId;
        INSERT paws.DoeAuditEvent(AuditEventId,AcademicYear,Action,EntityType,EntityId,FacultyId,ActorUid,BeforeJson,AfterJson)
            VALUES(NEWID(),@academicYear,@action,N'manual_doe_assignment',CONVERT(nvarchar(128),@assignmentId),@facultyId,@actorUid,@before,@after);
        COMMIT TRANSACTION;
        SELECT CONVERT(nvarchar(36),AssignmentId) AS assignmentFactId,Revision AS revision,Active AS active,DoeValue AS resultDoe
            FROM paws.ManualDoeAssignment WHERE AssignmentId=@assignmentId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO
GRANT EXECUTE ON OBJECT::paws.SaveManualDoeAssignment TO paws_runtime_manual_doe_write;
-- Membership is an explicit deployment action. No broad DOE admin membership.
GO
