/* P3 Faculty admin correction: make rowversion portable as a text token and prevent JSON audit metadata overflow/null cases. */
:ON ERROR EXIT
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'VetMed-Ops' THROW 52410, 'Migration 024 must run in VetMed-Ops.', 1;
IF OBJECT_ID(N'paws_api.UpdateFaculty',N'P') IS NULL OR OBJECT_ID(N'paws_api.DeactivateFaculty',N'P') IS NULL OR OBJECT_ID(N'paws_api.RestoreFaculty',N'P') IS NULL THROW 52411, 'Migration 023 Faculty procedures are required before migration 024.', 1;
IF COL_LENGTH(N'paws.FacultyProfessionalProfile',N'ProfileVersion') IS NULL OR NOT EXISTS(SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'paws.FacultyProfessionalProfile') AND c.name=N'ProfileVersion' AND t.name=N'timestamp') THROW 52412, 'Migration 024 requires the ProfileVersion rowversion column.', 1;
BEGIN TRANSACTION;
GO
CREATE OR ALTER PROCEDURE paws_api.UpdateFaculty
    @FacultyId uniqueidentifier,
    @ExpectedUpdatedAtUtc nvarchar(40),
    @ExpectedProfileVersion varchar(18),
    @ActorFirebaseUid nvarchar(128),
    @PreferredFirstName nvarchar(128),
    @PreferredLastName nvarchar(128),
    @DisplayName nvarchar(260),
    @Ucid nvarchar(64),
    @Email nvarchar(256),
    @RecordType nvarchar(32),
    @Stream nvarchar(128),
    @Rank nvarchar(128),
    @Fte decimal(5,4),
    @ReportsToFacultyId uniqueidentifier,
    @TeachingArea nvarchar(512),
    @ProfessionalCategory nvarchar(256),
    @ServiceDate date,
    @PriorYearsExperience decimal(5,2),
    @DvmEarnedDate nvarchar(64),
    @DvmType nvarchar(256),
    @MastersEarnedDate nvarchar(64),
    @MastersArea nvarchar(max),
    @PhdEarnedDate nvarchar(64),
    @PhdArea nvarchar(max),
    @BoardCertifiedDate nvarchar(64),
    @BoardCertification nvarchar(max),
    @BoardCertificationCount decimal(5,2),
    @AbvmaLicenseNumber nvarchar(128),
    @AbvmaMemberType nvarchar(512)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET ARITHABORT ON;
    DECLARE @Expected datetime2(7)=TRY_CONVERT(datetime2(7), @ExpectedUpdatedAtUtc, 127),
            @Current datetime2(7), @CurrentProfileVersion binary(8), @ExpectedProfileVersionBytes binary(8),
            @ActorName nvarchar(260), @BeforeJson nvarchar(max),
            @AfterJson nvarchar(max), @ChangedFields nvarchar(max);
    IF @Expected IS NULL OR @FacultyId IS NULL OR NULLIF(LTRIM(RTRIM(@ActorFirebaseUid)),N'') IS NULL
       OR NULLIF(LTRIM(RTRIM(@DisplayName)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(@RecordType)),N'') IS NULL
       OR LOWER(LTRIM(RTRIM(@RecordType))) NOT IN (N'faculty',N'other_pool',N'sessional_pool',N'vacancy')
       OR (@Fte IS NOT NULL AND @Fte < 0) OR (@PriorYearsExperience IS NOT NULL AND @PriorYearsExperience < 0)
       OR (@BoardCertificationCount IS NOT NULL AND @BoardCertificationCount < 0)
        OR (@ReportsToFacultyId IS NOT NULL AND @ReportsToFacultyId=@FacultyId)
        THROW 52306, 'Faculty update failed schema validation.', 1;
    IF @ExpectedProfileVersion IS NOT NULL AND (LEN(@ExpectedProfileVersion)<>18 OR LEFT(@ExpectedProfileVersion,2)<>'0x')
        THROW 52306, 'Faculty profile version is invalid.', 1;
    SET @ExpectedProfileVersionBytes=CASE WHEN @ExpectedProfileVersion IS NULL THEN NULL ELSE TRY_CONVERT(binary(8),@ExpectedProfileVersion,1) END;
    IF @ExpectedProfileVersion IS NOT NULL AND @ExpectedProfileVersionBytes IS NULL
        THROW 52306, 'Faculty profile version is invalid.', 1;
    IF @ReportsToFacultyId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM paws.Faculty WHERE FacultyId=@ReportsToFacultyId)
        THROW 52306, 'Reports-To Faculty does not exist.', 1;

    SELECT @ActorName=DisplayName
      FROM paws.UserProfile
     WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0
       AND LOWER(LTRIM(RTRIM(BaseRole))) IN (N'admin',N'administrator',N'adfa_regular',N'adfa_general',N'owner');
    IF @ActorName IS NULL THROW 52302, 'Faculty administration is not authorized for this SQL user.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @Current=UpdatedAtUtc
          FROM paws.Faculty WITH (UPDLOCK,HOLDLOCK)
         WHERE FacultyId=@FacultyId;
        IF @Current IS NULL THROW 52303, 'Faculty record was not found.', 1;
        IF @Current<>@Expected THROW 52305, 'Faculty record changed after it was loaded.', 1;
        SELECT @CurrentProfileVersion=ProfileVersion
          FROM paws.FacultyProfessionalProfile WITH (UPDLOCK,HOLDLOCK)
         WHERE FacultyId=@FacultyId;
        IF (@CurrentProfileVersion IS NULL AND @ExpectedProfileVersionBytes IS NOT NULL)
           OR (@CurrentProfileVersion IS NOT NULL AND (@ExpectedProfileVersionBytes IS NULL OR @CurrentProfileVersion<>@ExpectedProfileVersionBytes))
            THROW 52305, 'Faculty profile changed after it was loaded.', 1;

        IF @Ucid IS NOT NULL AND EXISTS (
            SELECT 1 FROM paws.Faculty WITH (UPDLOCK,HOLDLOCK)
             WHERE FacultyId<>@FacultyId AND UPPER(LTRIM(RTRIM(Ucid)))=UPPER(LTRIM(RTRIM(@Ucid)))
        ) THROW 52304, 'UCID already belongs to another Faculty record; restore the existing record instead.', 1;
        IF @Email IS NOT NULL AND EXISTS (
            SELECT 1 FROM paws.Faculty WITH (UPDLOCK,HOLDLOCK)
             WHERE FacultyId<>@FacultyId AND UPPER(LTRIM(RTRIM(Email)))=UPPER(LTRIM(RTRIM(@Email)))
        ) THROW 52304, 'Email already belongs to another Faculty record; restore the existing record instead.', 1;

        SELECT @BeforeJson=(SELECT f.FacultyId AS facultyId,f.PreferredFirstName AS preferredFirstName,
            f.PreferredLastName AS preferredLastName,f.DisplayName AS displayName,f.Ucid AS ucid,f.Email AS email,
            f.RecordType AS recordType,f.Stream AS stream,f.Rank AS rank,f.Fte AS fte,f.ReportsToFacultyId AS reportsToFacultyId,
            f.Active AS active,p.TeachingArea AS teachingArea,p.ProfessionalCategory AS professionalCategory,
            p.ServiceDate AS serviceDate,p.PriorYearsExperience AS priorYearsExperience,p.DvmEarnedDate AS dvmEarnedDate,
            p.DvmType AS dvmType,p.MastersEarnedDate AS mastersEarnedDate,p.MastersArea AS mastersArea,
            p.PhdEarnedDate AS phdEarnedDate,p.PhdArea AS phdArea,p.BoardCertifiedDate AS boardCertifiedDate,
            p.BoardCertification AS boardCertification,p.BoardCertificationCount AS boardCertificationCount,
            p.AbvmaLicenseNumber AS abvmaLicenseNumber,p.AbvmaMemberType AS abvmaMemberType
          FROM paws.Faculty f LEFT JOIN paws.FacultyProfessionalProfile p ON p.FacultyId=f.FacultyId
          WHERE f.FacultyId=@FacultyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);

        UPDATE paws.Faculty SET
            PreferredFirstName=NULLIF(LTRIM(RTRIM(@PreferredFirstName)),N''),
            PreferredLastName=NULLIF(LTRIM(RTRIM(@PreferredLastName)),N''),
            DisplayName=LTRIM(RTRIM(@DisplayName)), Ucid=NULLIF(LTRIM(RTRIM(@Ucid)),N''),
            Email=NULLIF(LTRIM(RTRIM(@Email)),N''), RecordType=LTRIM(RTRIM(@RecordType)),
            Stream=NULLIF(LTRIM(RTRIM(@Stream)),N''), Rank=NULLIF(LTRIM(RTRIM(@Rank)),N''),
            Fte=@Fte, ReportsToFacultyId=@ReportsToFacultyId, UpdatedAtUtc=SYSUTCDATETIME()
         WHERE FacultyId=@FacultyId AND UpdatedAtUtc=@Current;
        IF @@ROWCOUNT<>1 THROW 52305, 'Faculty record changed during update.', 1;

        IF NOT EXISTS (SELECT 1 FROM paws.FacultyProfessionalProfile WITH (UPDLOCK,HOLDLOCK) WHERE FacultyId=@FacultyId)
            INSERT paws.FacultyProfessionalProfile (FacultyId,SourceImportBatchId,SourceRow)
            SELECT FacultyId,SourceImportBatchId,SourceRow FROM paws.Faculty WHERE FacultyId=@FacultyId;

        UPDATE paws.FacultyProfessionalProfile SET
            TeachingArea=@TeachingArea, ProfessionalCategory=@ProfessionalCategory, ServiceDate=@ServiceDate,
            PriorYearsExperience=@PriorYearsExperience, DvmEarnedDate=@DvmEarnedDate, DvmType=@DvmType,
            MastersEarnedDate=@MastersEarnedDate, MastersArea=@MastersArea, PhdEarnedDate=@PhdEarnedDate,
            PhdArea=@PhdArea, BoardCertifiedDate=@BoardCertifiedDate, BoardCertification=@BoardCertification,
            BoardCertificationCount=@BoardCertificationCount, AbvmaLicenseNumber=@AbvmaLicenseNumber,
            AbvmaMemberType=@AbvmaMemberType
         WHERE FacultyId=@FacultyId;

        SELECT @AfterJson=(SELECT f.FacultyId AS facultyId,f.PreferredFirstName AS preferredFirstName,
            f.PreferredLastName AS preferredLastName,f.DisplayName AS displayName,f.Ucid AS ucid,f.Email AS email,
            f.RecordType AS recordType,f.Stream AS stream,f.Rank AS rank,f.Fte AS fte,f.ReportsToFacultyId AS reportsToFacultyId,
            f.Active AS active,p.TeachingArea AS teachingArea,p.ProfessionalCategory AS professionalCategory,
            p.ServiceDate AS serviceDate,p.PriorYearsExperience AS priorYearsExperience,p.DvmEarnedDate AS dvmEarnedDate,
            p.DvmType AS dvmType,p.MastersEarnedDate AS mastersEarnedDate,p.MastersArea AS mastersArea,
            p.PhdEarnedDate AS phdEarnedDate,p.PhdArea AS phdArea,p.BoardCertifiedDate AS boardCertifiedDate,
            p.BoardCertification AS boardCertification,p.BoardCertificationCount AS boardCertificationCount,
            p.AbvmaLicenseNumber AS abvmaLicenseNumber,p.AbvmaMemberType AS abvmaMemberType
          FROM paws.Faculty f LEFT JOIN paws.FacultyProfessionalProfile p ON p.FacultyId=f.FacultyId
          WHERE f.FacultyId=@FacultyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
        SELECT @ChangedFields=(
          SELECT COALESCE(beforeField.[key],afterField.[key]) AS [value]
          FROM OPENJSON(@BeforeJson) beforeField
          FULL OUTER JOIN OPENJSON(@AfterJson) afterField ON beforeField.[key]=afterField.[key]
          WHERE ISNULL(CONVERT(int,beforeField.[type]),-1)<>ISNULL(CONVERT(int,afterField.[type]),-1)
             OR ISNULL(beforeField.[value],N'')<>ISNULL(afterField.[value],N'')
          FOR JSON PATH);
        SET @ChangedFields=COALESCE(@ChangedFields,N'[]');
        INSERT paws.AuditEvent (AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson)
        VALUES (NEWID(),N'FacultyUpdated',N'Faculty',CONVERT(nvarchar(36),@FacultyId),@ActorFirebaseUid,@ActorName,
                SYSUTCDATETIME(),@BeforeJson,@AfterJson,CONCAT(N'{"changedFields":',@ChangedFields,N'}'));
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT f.FacultyId AS facultyId,f.PreferredFirstName AS preferredFirstName,f.PreferredLastName AS preferredLastName,
        f.DisplayName AS displayName,f.Ucid AS ucid,f.Email AS email,f.RecordType AS recordType,f.Stream AS stream,
        f.Rank AS rank,f.Fte AS fte,f.ReportsToFacultyId AS reportsToFacultyId,f.Active AS active,
        CONVERT(varchar(33),f.UpdatedAtUtc,126)+ 'Z' AS updatedAtUtc,
        p.TeachingArea AS teachingArea,p.ProfessionalCategory AS professionalCategory,
        CONVERT(varchar(10),p.ServiceDate,23) AS serviceDate,p.PriorYearsExperience AS priorYearsExperience,
        p.DvmEarnedDate AS dvmEarnedDate,p.DvmType AS dvmType,p.MastersEarnedDate AS mastersEarnedDate,
        p.MastersArea AS mastersArea,p.PhdEarnedDate AS phdEarnedDate,p.PhdArea AS phdArea,
        p.BoardCertifiedDate AS boardCertifiedDate,p.BoardCertification AS boardCertification,
        p.BoardCertificationCount AS boardCertificationCount,p.AbvmaLicenseNumber AS abvmaLicenseNumber,
        p.AbvmaMemberType AS abvmaMemberType,CONVERT(varchar(18),CONVERT(varbinary(8),p.ProfileVersion),1) AS profileVersion
      FROM paws.Faculty f LEFT JOIN paws.FacultyProfessionalProfile p ON p.FacultyId=f.FacultyId
     WHERE f.FacultyId=@FacultyId;
END;
GO
CREATE OR ALTER PROCEDURE paws_api.DeactivateFaculty
    @FacultyId uniqueidentifier,
    @ExpectedUpdatedAtUtc nvarchar(40),
    @ActorFirebaseUid nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET ARITHABORT ON;
    DECLARE @Expected datetime2(7)=TRY_CONVERT(datetime2(7),@ExpectedUpdatedAtUtc,127),
            @Current datetime2(7),@ActorName nvarchar(260),@BeforeJson nvarchar(max),@AfterJson nvarchar(max);
    SELECT @ActorName=DisplayName FROM paws.UserProfile
     WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0
       AND LOWER(LTRIM(RTRIM(BaseRole))) IN (N'admin',N'administrator',N'adfa_regular',N'adfa_general',N'owner');
    IF @Expected IS NULL OR @ActorName IS NULL THROW 52302, 'Faculty administration is not authorized or the version is invalid.', 1;
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @Current=UpdatedAtUtc FROM paws.Faculty WITH (UPDLOCK,HOLDLOCK) WHERE FacultyId=@FacultyId AND Active=1;
        IF @Current IS NULL THROW 52303, 'Active Faculty record was not found.', 1;
        IF @Current<>@Expected THROW 52305, 'Faculty record changed after it was loaded.', 1;
        SELECT @BeforeJson=(SELECT FacultyId AS facultyId,DisplayName AS displayName,Ucid AS ucid,Email AS email,Active AS active
            FROM paws.Faculty WHERE FacultyId=@FacultyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        UPDATE paws.Faculty SET Active=0,UpdatedAtUtc=SYSUTCDATETIME() WHERE FacultyId=@FacultyId AND Active=1 AND UpdatedAtUtc=@Current;
        IF @@ROWCOUNT<>1 THROW 52305, 'Faculty record changed during deactivation.', 1;
        SELECT @AfterJson=(SELECT FacultyId AS facultyId,DisplayName AS displayName,Ucid AS ucid,Email AS email,Active AS active
            FROM paws.Faculty WHERE FacultyId=@FacultyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT paws.AuditEvent (AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson)
        VALUES (NEWID(),N'FacultyDeactivated',N'Faculty',CONVERT(nvarchar(36),@FacultyId),@ActorFirebaseUid,@ActorName,
                SYSUTCDATETIME(),@BeforeJson,@AfterJson,N'{"preservedRelationships":true}');
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
    SELECT f.FacultyId AS facultyId,f.PreferredFirstName AS preferredFirstName,f.PreferredLastName AS preferredLastName,
        f.DisplayName AS displayName,f.Ucid AS ucid,f.Email AS email,f.RecordType AS recordType,f.Stream AS stream,f.Rank AS rank,
        f.Fte AS fte,f.ReportsToFacultyId AS reportsToFacultyId,f.Active AS active,
        CONVERT(varchar(33),f.UpdatedAtUtc,126)+'Z' AS updatedAtUtc,
        p.TeachingArea AS teachingArea,p.ProfessionalCategory AS professionalCategory,
        CONVERT(varchar(10),p.ServiceDate,23) AS serviceDate,p.PriorYearsExperience AS priorYearsExperience,
        p.DvmEarnedDate AS dvmEarnedDate,p.DvmType AS dvmType,p.MastersEarnedDate AS mastersEarnedDate,
        p.MastersArea AS mastersArea,p.PhdEarnedDate AS phdEarnedDate,p.PhdArea AS phdArea,
        p.BoardCertifiedDate AS boardCertifiedDate,p.BoardCertification AS boardCertification,
        p.BoardCertificationCount AS boardCertificationCount,p.AbvmaLicenseNumber AS abvmaLicenseNumber,
        p.AbvmaMemberType AS abvmaMemberType,CONVERT(varchar(18),CONVERT(varbinary(8),p.ProfileVersion),1) AS profileVersion
      FROM paws.Faculty f LEFT JOIN paws.FacultyProfessionalProfile p ON p.FacultyId=f.FacultyId
      WHERE f.FacultyId=@FacultyId;
END;
GO
CREATE OR ALTER PROCEDURE paws_api.RestoreFaculty
    @FacultyId uniqueidentifier,
    @ExpectedUpdatedAtUtc nvarchar(40),
    @ActorFirebaseUid nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET ARITHABORT ON;
    DECLARE @Expected datetime2(7)=TRY_CONVERT(datetime2(7),@ExpectedUpdatedAtUtc,127),
            @Current datetime2(7),@ActorName nvarchar(260),@BeforeJson nvarchar(max),@AfterJson nvarchar(max),
            @Ucid nvarchar(64),@Email nvarchar(256);
    SELECT @ActorName=DisplayName FROM paws.UserProfile
     WHERE FirebaseUid=@ActorFirebaseUid AND Active=1 AND MustChangePassword=0
       AND LOWER(LTRIM(RTRIM(BaseRole))) IN (N'admin',N'administrator',N'adfa_regular',N'adfa_general',N'owner');
    IF @Expected IS NULL OR @ActorName IS NULL THROW 52302, 'Faculty administration is not authorized or the version is invalid.', 1;
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @Current=UpdatedAtUtc,@Ucid=Ucid,@Email=Email
          FROM paws.Faculty WITH (UPDLOCK,HOLDLOCK) WHERE FacultyId=@FacultyId AND Active=0;
        IF @Current IS NULL THROW 52303, 'Inactive Faculty record was not found.', 1;
        IF @Current<>@Expected THROW 52305, 'Faculty record changed after it was loaded.', 1;
        IF @Ucid IS NOT NULL AND EXISTS (SELECT 1 FROM paws.Faculty WITH (UPDLOCK,HOLDLOCK)
              WHERE FacultyId<>@FacultyId AND UPPER(LTRIM(RTRIM(Ucid)))=UPPER(LTRIM(RTRIM(@Ucid))))
            THROW 52304, 'UCID belongs to another Faculty record; resolve the duplicate before restoring.', 1;
        IF @Email IS NOT NULL AND EXISTS (SELECT 1 FROM paws.Faculty WITH (UPDLOCK,HOLDLOCK)
              WHERE FacultyId<>@FacultyId AND UPPER(LTRIM(RTRIM(Email)))=UPPER(LTRIM(RTRIM(@Email))))
            THROW 52304, 'Email belongs to another Faculty record; resolve the duplicate before restoring.', 1;
        SELECT @BeforeJson=(SELECT FacultyId AS facultyId,DisplayName AS displayName,Ucid AS ucid,Email AS email,Active AS active
            FROM paws.Faculty WHERE FacultyId=@FacultyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        UPDATE paws.Faculty SET Active=1,UpdatedAtUtc=SYSUTCDATETIME() WHERE FacultyId=@FacultyId AND Active=0 AND UpdatedAtUtc=@Current;
        IF @@ROWCOUNT<>1 THROW 52305, 'Faculty record changed during restoration.', 1;
        SELECT @AfterJson=(SELECT FacultyId AS facultyId,DisplayName AS displayName,Ucid AS ucid,Email AS email,Active AS active
            FROM paws.Faculty WHERE FacultyId=@FacultyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT paws.AuditEvent (AuditEventId,EventType,EntityType,EntityId,ActorFirebaseUid,ActorName,OccurredAtUtc,BeforeJson,AfterJson,MetadataJson)
        VALUES (NEWID(),N'FacultyRestored',N'Faculty',CONVERT(nvarchar(36),@FacultyId),@ActorFirebaseUid,@ActorName,
                SYSUTCDATETIME(),@BeforeJson,@AfterJson,N'{"preservedRelationships":true}');
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
    SELECT f.FacultyId AS facultyId,f.PreferredFirstName AS preferredFirstName,f.PreferredLastName AS preferredLastName,
        f.DisplayName AS displayName,f.Ucid AS ucid,f.Email AS email,f.RecordType AS recordType,f.Stream AS stream,f.Rank AS rank,
        f.Fte AS fte,f.ReportsToFacultyId AS reportsToFacultyId,f.Active AS active,
        CONVERT(varchar(33),f.UpdatedAtUtc,126)+'Z' AS updatedAtUtc,
        p.TeachingArea AS teachingArea,p.ProfessionalCategory AS professionalCategory,
        CONVERT(varchar(10),p.ServiceDate,23) AS serviceDate,p.PriorYearsExperience AS priorYearsExperience,
        p.DvmEarnedDate AS dvmEarnedDate,p.DvmType AS dvmType,p.MastersEarnedDate AS mastersEarnedDate,
        p.MastersArea AS mastersArea,p.PhdEarnedDate AS phdEarnedDate,p.PhdArea AS phdArea,
        p.BoardCertifiedDate AS boardCertifiedDate,p.BoardCertification AS boardCertification,
        p.BoardCertificationCount AS boardCertificationCount,p.AbvmaLicenseNumber AS abvmaLicenseNumber,
        p.AbvmaMemberType AS abvmaMemberType,CONVERT(varchar(18),CONVERT(varbinary(8),p.ProfileVersion),1) AS profileVersion
      FROM paws.Faculty f LEFT JOIN paws.FacultyProfessionalProfile p ON p.FacultyId=f.FacultyId
      WHERE f.FacultyId=@FacultyId;
END;
GO
IF EXISTS (SELECT 1 FROM sys.sql_modules WHERE object_id IN (OBJECT_ID(N'paws_api.UpdateFaculty'),OBJECT_ID(N'paws_api.DeactivateFaculty'),OBJECT_ID(N'paws_api.RestoreFaculty')) AND (uses_ansi_nulls=0 OR uses_quoted_identifier=0))
    THROW 52413, 'Migration 024 procedure settings are invalid; transaction will be rolled back.', 1;
COMMIT TRANSACTION;
GO
SELECT OBJECT_NAME(object_id) AS procedure_name,uses_ansi_nulls,uses_quoted_identifier
FROM sys.sql_modules
WHERE object_id IN (OBJECT_ID(N'paws_api.UpdateFaculty'),OBJECT_ID(N'paws_api.DeactivateFaculty'),OBJECT_ID(N'paws_api.RestoreFaculty'))
ORDER BY procedure_name;
GO