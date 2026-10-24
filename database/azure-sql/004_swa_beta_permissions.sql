SET NOCOUNT ON;
SET XACT_ABORT ON;

-- BETA-R4D-10A: the runtime principal name is parameterised. The reviewed
-- contract originally addressed a contained user named `paws_swa_beta`, but the
-- deployed Beta runtime authenticates as the application managed identity
-- `paws-sql-beta-mi` (confirmed live: it is an EXTERNAL_USER, holds the reviewed
-- permission set, and `paws_swa_beta` does not exist in the database).
--
-- Run this file with sqlcmd and bind the principal that actually connects:
--     sqlcmd -v PAWS_API_PRINCIPAL="paws-sql-beta-mi" -i 004_swa_beta_permissions.sql
-- The default remains `paws_swa_beta` so an unparameterised run is unchanged.
:setvar PAWS_API_PRINCIPAL "paws_swa_beta"

IF USER_ID(N'$(PAWS_API_PRINCIPAL)') IS NULL
    THROW 51000, 'Expected contained database user does not exist. Provisioning is a separate approved operator action.', 1;

DECLARE @PrincipalId int = USER_ID(N'$(PAWS_API_PRINCIPAL)');
DECLARE @PrincipalSid varbinary(85);
DECLARE @PrincipalType char(1);

SELECT @PrincipalSid = principal.sid, @PrincipalType = principal.type
FROM sys.database_principals AS principal
WHERE principal.principal_id = @PrincipalId;

IF @PrincipalType = N'X'
    THROW 51004, 'The runtime principal must be a dedicated user, not an EXTERNAL_GROUP principal.', 1;

IF EXISTS (
    SELECT 1 FROM sys.databases
    WHERE database_id = DB_ID() AND owner_sid = @PrincipalSid
) THROW 51005, 'The runtime principal must not be the database owner.', 1;

IF EXISTS (
    SELECT 1 FROM sys.database_role_members
    WHERE member_principal_id = @PrincipalId
) THROW 51001, 'The runtime principal must not inherit any database role.', 1;

IF EXISTS (
    SELECT 1
    FROM sys.database_permissions AS permission
    INNER JOIN sys.database_principals AS public_principal
      ON public_principal.principal_id = permission.grantee_principal_id
     AND public_principal.name = N'public'
    WHERE permission.state IN (N'G', N'W')
      AND (
        (permission.class = 0 AND NOT (permission.permission_name = N'CONNECT' AND permission.state = N'G'))
        OR (permission.class = 3 AND SCHEMA_NAME(permission.major_id) IN (N'paws', N'staging'))
        OR (permission.class = 1 AND OBJECT_SCHEMA_NAME(permission.major_id) IN (N'paws', N'staging'))
      )
) THROW 51006, 'public has a grant that can broaden the runtime principal''s access to paws or staging.', 1;

IF EXISTS (SELECT 1 FROM sys.schemas WHERE principal_id = @PrincipalId)
   OR EXISTS (SELECT 1 FROM sys.objects WHERE principal_id = @PrincipalId)
    THROW 51003, 'The runtime principal must not own schemas or objects.', 1;

IF EXISTS (
    SELECT 1
    FROM sys.database_permissions AS permission
    WHERE permission.grantee_principal_id = @PrincipalId
      AND (
        (permission.class = 0 AND NOT (permission.permission_name = N'CONNECT' AND permission.state = N'G'))
        OR (permission.class = 3 AND NOT (
          permission.state = N'D' AND (
            (SCHEMA_NAME(permission.major_id) = N'paws' AND permission.permission_name IN (N'INSERT', N'UPDATE', N'DELETE', N'EXECUTE'))
            OR (SCHEMA_NAME(permission.major_id) = N'staging' AND permission.permission_name IN (N'SELECT', N'INSERT', N'UPDATE', N'DELETE', N'EXECUTE'))
          )
        ))
        OR (permission.class = 1 AND NOT (
          permission.state = N'G'
          AND permission.permission_name = N'SELECT'
          AND (
            (OBJECT_SCHEMA_NAME(permission.major_id) = N'paws' AND OBJECT_NAME(permission.major_id) = N'vCalendarSession' AND permission.minor_id = 0)
            OR (
              OBJECT_SCHEMA_NAME(permission.major_id) = N'paws'
              AND OBJECT_NAME(permission.major_id) = N'UserProfile'
              AND COL_NAME(permission.major_id, permission.minor_id) IN (N'FirebaseUid', N'DisplayName', N'BaseRole', N'FacultyId', N'Active', N'MustChangePassword')
            )
            -- BETA-R4D-10A2: full teaching-assignment / DOE read contract. The
            -- workload and stored DOE columns are now part of the reviewed
            -- surface; source provenance columns (SourceFacultyName,
            -- SourceImportBatchId, SourceRow) deliberately stay unreadable.
            OR (
              OBJECT_SCHEMA_NAME(permission.major_id) = N'paws'
              AND OBJECT_NAME(permission.major_id) = N'SessionAssignment'
              AND COL_NAME(permission.major_id, permission.minor_id) IN (
                N'SessionAssignmentId', N'SessionId', N'FacultyId', N'TeachingRole',
                N'LabLead', N'CreditedHours', N'DoeRate', N'DoeQuantity',
                N'DoeUnit', N'DoeCredit', N'DoeStatus'
              )
            )
            -- BETA-R4D-10A: least-privilege Dashboard read columns. Only the
            -- roster and detail fields the read API projects are granted; FTE and
            -- reporting relations stay readable, DOE/creditable-hour and source
            -- provenance columns deliberately do not.
            OR (
              OBJECT_SCHEMA_NAME(permission.major_id) = N'paws'
              AND OBJECT_NAME(permission.major_id) = N'Faculty'
              AND COL_NAME(permission.major_id, permission.minor_id) IN (
                N'FacultyId', N'RecordType', N'PreferredFirstName', N'PreferredLastName',
                N'DisplayName', N'Ucid', N'Email', N'Stream', N'Rank', N'Fte',
                N'ReportsToFacultyId', N'Active'
              )
            )
            -- BETA-R4D-10A2: professional profile detail. Every returned field is
            -- granted; SourceImportBatchId and SourceRow are not.
            OR (
              OBJECT_SCHEMA_NAME(permission.major_id) = N'paws'
              AND OBJECT_NAME(permission.major_id) = N'FacultyProfessionalProfile'
              AND COL_NAME(permission.major_id, permission.minor_id) IN (
                N'FacultyId', N'TeachingArea', N'ProfessionalCategory', N'ServiceDate',
                N'PriorYearsExperience', N'DvmEarnedDate', N'DvmType',
                N'MastersEarnedDate', N'MastersArea', N'PhdEarnedDate', N'PhdArea',
                N'BoardCertifiedDate', N'BoardCertification', N'BoardCertificationCount',
                N'AbvmaLicenseNumber', N'AbvmaMemberType'
              )
            )
            -- BETA-R4D-10A2: joint appointments. Source metadata excluded.
            OR (
              OBJECT_SCHEMA_NAME(permission.major_id) = N'paws'
              AND OBJECT_NAME(permission.major_id) = N'JointAppointment'
              AND COL_NAME(permission.major_id, permission.minor_id) IN (
                N'JointAppointmentId', N'FacultyId', N'HomeFaculty', N'JointFaculty',
                N'FteUcvm', N'FteOtherFaculty', N'ExpiryDate', N'Notes'
              )
            )
            -- BETA-R4D-10A2: role assignments. Stored DOE values are returned
            -- as-is; SourceFacultyName / SourceImportBatchId / SourceRow are not.
            OR (
              OBJECT_SCHEMA_NAME(permission.major_id) = N'paws'
              AND OBJECT_NAME(permission.major_id) = N'RoleAssignment'
              AND COL_NAME(permission.major_id, permission.minor_id) IN (
                N'RoleAssignmentId', N'FacultyId', N'FacultyResolutionStatus',
                N'AcademicYear', N'RoleCategory', N'RoleType',
                N'CourseOrSubjectOrRotation', N'CourseName', N'Details',
                N'EffectiveDate', N'ExpirationDate', N'DoeMappedValue',
                N'DoeOverrideValue', N'DoeOverrideReason', N'SpecialNotes'
              )
            )
            -- BETA-R4D-10A2: AFC records, including the detail-only Purpose.
            OR (
              OBJECT_SCHEMA_NAME(permission.major_id) = N'paws'
              AND OBJECT_NAME(permission.major_id) = N'AfcRecord'
              AND COL_NAME(permission.major_id, permission.minor_id) IN (
                N'AfcRecordId', N'FacultyId', N'StartDate', N'EndDate', N'Purpose', N'Active'
              )
            )
          )
        ))
        OR permission.class NOT IN (0, 1, 3)
      )
) THROW 51002, 'The runtime principal has permissions outside the reviewed Beta-R1 + R4D-10A/10A2 contract.', 1;

GRANT CONNECT TO [$(PAWS_API_PRINCIPAL)];
GRANT SELECT ON OBJECT::paws.UserProfile
    (FirebaseUid, DisplayName, BaseRole, FacultyId, Active, MustChangePassword)
    TO [$(PAWS_API_PRINCIPAL)];
GRANT SELECT ON OBJECT::paws.vCalendarSession TO [$(PAWS_API_PRINCIPAL)];
GRANT SELECT ON OBJECT::paws.SessionAssignment
    (SessionAssignmentId, SessionId, FacultyId, TeachingRole, LabLead,
     CreditedHours, DoeRate, DoeQuantity, DoeUnit, DoeCredit, DoeStatus)
    TO [$(PAWS_API_PRINCIPAL)];

-- BETA-R4D-10A: Dashboard read contract. Column-scoped SELECT only; the
-- schema-wide DML denies stay in force below, so these grants widen the read
-- surface without widening the mutation surface.
--
-- This grant is what makes the /dashboard/faculty routes work at all: without
-- it the SQL principal has no read access to paws.Faculty and those routes fail
-- with a permission error rather than returning data.
GRANT SELECT ON OBJECT::paws.Faculty
    (FacultyId, RecordType, PreferredFirstName, PreferredLastName, DisplayName,
     Ucid, Email, Stream, Rank, Fte, ReportsToFacultyId, Active)
    TO [$(PAWS_API_PRINCIPAL)];

-- BETA-R4D-10A2: complete the Dashboard read contract. Each grant is
-- column-scoped to exactly the fields the read API returns or joins on. Source
-- provenance columns (SourceImportBatchId, SourceRow, SourceFacultyName) are
-- deliberately absent, so the API can never surface import metadata.
GRANT SELECT ON OBJECT::paws.FacultyProfessionalProfile
    (FacultyId, TeachingArea, ProfessionalCategory, ServiceDate,
     PriorYearsExperience, DvmEarnedDate, DvmType, MastersEarnedDate, MastersArea,
     PhdEarnedDate, PhdArea, BoardCertifiedDate, BoardCertification,
     BoardCertificationCount, AbvmaLicenseNumber, AbvmaMemberType)
    TO [$(PAWS_API_PRINCIPAL)];

GRANT SELECT ON OBJECT::paws.JointAppointment
    (JointAppointmentId, FacultyId, HomeFaculty, JointFaculty, FteUcvm,
     FteOtherFaculty, ExpiryDate, Notes)
    TO [$(PAWS_API_PRINCIPAL)];

GRANT SELECT ON OBJECT::paws.RoleAssignment
    (RoleAssignmentId, FacultyId, FacultyResolutionStatus, AcademicYear,
     RoleCategory, RoleType, CourseOrSubjectOrRotation, CourseName, Details,
     EffectiveDate, ExpirationDate, DoeMappedValue, DoeOverrideValue,
     DoeOverrideReason, SpecialNotes)
    TO [$(PAWS_API_PRINCIPAL)];

GRANT SELECT ON OBJECT::paws.AfcRecord
    (AfcRecordId, FacultyId, StartDate, EndDate, Purpose, Active)
    TO [$(PAWS_API_PRINCIPAL)];

DENY INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::paws TO [$(PAWS_API_PRINCIPAL)];
DENY SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::staging TO [$(PAWS_API_PRINCIPAL)];
