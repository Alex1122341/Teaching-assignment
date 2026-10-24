-- B1R2 proposal-only proof. Run only in an isolated review database or at B1D.
-- This file never grants, revokes, or mutates permissions.
:setvar PAWS_API_PRINCIPAL "paws-sql-beta-mi"

SET NOCOUNT ON;

DECLARE @PrincipalId int = USER_ID(N'$(PAWS_API_PRINCIPAL)');
DECLARE @PrincipalSid varbinary(85);
DECLARE @PrincipalType char(1);
IF @PrincipalId IS NULL THROW 51320, 'Runtime principal is absent.', 1;

SELECT @PrincipalSid = sid, @PrincipalType = type
FROM sys.database_principals
WHERE principal_id = @PrincipalId;

IF @PrincipalType = N'X'
    THROW 51321, 'Runtime principal must be a dedicated user, not an external group.', 1;
IF EXISTS (SELECT 1 FROM sys.databases WHERE database_id = DB_ID() AND owner_sid = @PrincipalSid)
    THROW 51322, 'Runtime principal must not own the database.', 1;
IF EXISTS (SELECT 1 FROM sys.database_role_members WHERE member_principal_id = @PrincipalId)
    THROW 51323, 'Runtime principal inherits a database role.', 1;
IF EXISTS (SELECT 1 FROM sys.schemas WHERE principal_id = @PrincipalId)
    OR EXISTS (SELECT 1 FROM sys.objects WHERE principal_id = @PrincipalId)
    THROW 51324, 'Runtime principal owns schemas or objects.', 1;

-- The proof must inspect the database-level permission and schema-level permission
-- classes explicitly; a legitimate class=1 read and class=3 DENY
-- are not database-level permissions. Both reviewed schemas must exist.
IF SCHEMA_ID(N'paws') IS NULL OR SCHEMA_ID(N'staging') IS NULL
    THROW 51324, 'The paws and staging schemas must exist for the proof.', 1;

IF SCHEMA_ID(N'paws') IS NULL OR EXISTS (
    SELECT 1 FROM sys.schemas WHERE name = N'paws' AND USER_NAME(principal_id) <> N'dbo'
)
    THROW 51325, 'paws schema ownership is not dbo.', 1;
IF SCHEMA_ID(N'paws_api') IS NULL OR EXISTS (
    SELECT 1 FROM sys.schemas WHERE name = N'paws_api' AND USER_NAME(principal_id) <> N'dbo'
)
    THROW 51326, 'paws_api schema ownership is not dbo.', 1;
IF OBJECT_ID(N'paws.vAfcRecordUnified', N'V') IS NULL
    OR OBJECT_ID(N'paws_api.CreateAfcRecord', N'P') IS NULL
    THROW 51327, 'Required B1 AFC objects are absent.', 1;

IF EXISTS (
    SELECT 1
    FROM sys.objects AS object_row
    INNER JOIN sys.schemas AS schema_row ON schema_row.schema_id = object_row.schema_id
    WHERE (
        (schema_row.name = N'paws_api' AND object_row.name = N'CreateAfcRecord')
        OR (schema_row.name = N'paws' AND object_row.name IN (N'AfcManualRecord', N'AuditEvent', N'Faculty', N'AfcRecord', N'vAfcRecordUnified'))
    )
      AND COALESCE(USER_NAME(object_row.principal_id), USER_NAME(schema_row.principal_id)) <> N'dbo'
)
    THROW 51328, 'AFC procedure or target object ownership is incompatible with the chain.', 1;

-- Keep this post-state definition semantically identical to the apply script.
-- Whole-object SELECT is allowed only for vCalendarSession and the B1 unified
-- view. All other reviewed reads are exact column rows. The four paws DENYs
-- use permission_name IN (N'INSERT', N'UPDATE', N'DELETE', N'EXECUTE'); staging
-- retains those plus SELECT. The paws schema mutation DENY contract and the
-- staging schema DENY contract are both mandatory.
DECLARE @PostB1Contract TABLE (
    contract_class tinyint NOT NULL,
    contract_state char(1) NOT NULL,
    contract_permission sysname NOT NULL,
    schema_name sysname NULL,
    object_name sysname NULL,
    column_name sysname NULL,
    scope_kind varchar(8) NOT NULL
);

INSERT @PostB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
VALUES
    (0, N'G', N'CONNECT', NULL, NULL, NULL, 'DATABASE'),
    (1, N'G', N'SELECT', N'paws', N'vCalendarSession', NULL, 'OBJECT'),
    (1, N'G', N'SELECT', N'paws', N'vAfcRecordUnified', NULL, 'OBJECT'),
    (1, N'G', N'EXECUTE', N'paws_api', N'CreateAfcRecord', NULL, 'OBJECT');

INSERT @PostB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 1, N'G', N'SELECT', N'paws', v.object_name, v.column_name, 'COLUMN'
FROM (VALUES
    (N'UserProfile', N'FirebaseUid'), (N'UserProfile', N'DisplayName'),
    (N'UserProfile', N'BaseRole'), (N'UserProfile', N'FacultyId'),
    (N'UserProfile', N'Active'), (N'UserProfile', N'MustChangePassword'),
    (N'SessionAssignment', N'SessionAssignmentId'), (N'SessionAssignment', N'SessionId'),
    (N'SessionAssignment', N'FacultyId'), (N'SessionAssignment', N'TeachingRole'),
    (N'SessionAssignment', N'LabLead'), (N'SessionAssignment', N'CreditedHours'),
    (N'SessionAssignment', N'DoeRate'), (N'SessionAssignment', N'DoeQuantity'),
    (N'SessionAssignment', N'DoeUnit'), (N'SessionAssignment', N'DoeCredit'),
    (N'SessionAssignment', N'DoeStatus'),
    (N'Faculty', N'FacultyId'), (N'Faculty', N'RecordType'),
    (N'Faculty', N'PreferredFirstName'), (N'Faculty', N'PreferredLastName'),
    (N'Faculty', N'DisplayName'), (N'Faculty', N'Ucid'), (N'Faculty', N'Email'),
    (N'Faculty', N'Stream'), (N'Faculty', N'Rank'), (N'Faculty', N'Fte'),
    (N'Faculty', N'ReportsToFacultyId'), (N'Faculty', N'Active'),
    (N'FacultyProfessionalProfile', N'FacultyId'), (N'FacultyProfessionalProfile', N'TeachingArea'),
    (N'FacultyProfessionalProfile', N'ProfessionalCategory'), (N'FacultyProfessionalProfile', N'ServiceDate'),
    (N'FacultyProfessionalProfile', N'PriorYearsExperience'), (N'FacultyProfessionalProfile', N'DvmEarnedDate'),
    (N'FacultyProfessionalProfile', N'DvmType'), (N'FacultyProfessionalProfile', N'MastersEarnedDate'),
    (N'FacultyProfessionalProfile', N'MastersArea'), (N'FacultyProfessionalProfile', N'PhdEarnedDate'),
    (N'FacultyProfessionalProfile', N'PhdArea'), (N'FacultyProfessionalProfile', N'BoardCertifiedDate'),
    (N'FacultyProfessionalProfile', N'BoardCertification'), (N'FacultyProfessionalProfile', N'BoardCertificationCount'),
    (N'FacultyProfessionalProfile', N'AbvmaLicenseNumber'), (N'FacultyProfessionalProfile', N'AbvmaMemberType'),
    (N'JointAppointment', N'JointAppointmentId'), (N'JointAppointment', N'FacultyId'),
    (N'JointAppointment', N'HomeFaculty'), (N'JointAppointment', N'JointFaculty'),
    (N'JointAppointment', N'FteUcvm'), (N'JointAppointment', N'FteOtherFaculty'),
    (N'JointAppointment', N'ExpiryDate'), (N'JointAppointment', N'Notes'),
    (N'RoleAssignment', N'RoleAssignmentId'), (N'RoleAssignment', N'FacultyId'),
    (N'RoleAssignment', N'FacultyResolutionStatus'), (N'RoleAssignment', N'AcademicYear'),
    (N'RoleAssignment', N'RoleCategory'), (N'RoleAssignment', N'RoleType'),
    (N'RoleAssignment', N'CourseOrSubjectOrRotation'), (N'RoleAssignment', N'CourseName'),
    (N'RoleAssignment', N'Details'), (N'RoleAssignment', N'EffectiveDate'),
    (N'RoleAssignment', N'ExpirationDate'), (N'RoleAssignment', N'DoeMappedValue'),
    (N'RoleAssignment', N'DoeOverrideValue'), (N'RoleAssignment', N'DoeOverrideReason'),
    (N'RoleAssignment', N'SpecialNotes'),
    (N'AfcRecord', N'AfcRecordId'), (N'AfcRecord', N'FacultyId'),
    (N'AfcRecord', N'StartDate'), (N'AfcRecord', N'EndDate'),
    (N'AfcRecord', N'Purpose'), (N'AfcRecord', N'Active')
) AS v(object_name, column_name);

INSERT @PostB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 3, N'D', v.permission_name, N'paws', NULL, NULL, 'SCHEMA'
FROM (VALUES (N'INSERT'), (N'UPDATE'), (N'DELETE'), (N'EXECUTE')) AS v(permission_name);
INSERT @PostB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 3, N'D', v.permission_name, N'staging', NULL, NULL, 'SCHEMA'
FROM (VALUES (N'SELECT'), (N'INSERT'), (N'UPDATE'), (N'DELETE'), (N'EXECUTE')) AS v(permission_name);

DECLARE @ActualPermissions TABLE (
    contract_class tinyint NOT NULL,
    contract_state char(1) NOT NULL,
    contract_permission sysname NOT NULL,
    schema_name sysname NULL,
    object_name sysname NULL,
    column_name sysname NULL,
    scope_kind varchar(8) NOT NULL
);

INSERT @ActualPermissions (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT
    permission.class,
    permission.state,
    permission.permission_name,
    CASE
        WHEN permission.class = 3 THEN SCHEMA_NAME(permission.major_id)
        WHEN permission.class = 1 THEN OBJECT_SCHEMA_NAME(permission.major_id)
    END,
    CASE WHEN permission.class = 1 THEN OBJECT_NAME(permission.major_id) END,
    CASE WHEN permission.class = 1 AND permission.minor_id <> 0 THEN COL_NAME(permission.major_id, permission.minor_id) END,
    CASE
        WHEN permission.class = 0 THEN 'DATABASE'
        WHEN permission.class = 3 THEN 'SCHEMA'
        WHEN permission.class = 1 AND permission.minor_id = 0 THEN 'OBJECT'
        WHEN permission.class = 1 THEN 'COLUMN'
        ELSE 'OTHER'
    END
FROM sys.database_permissions AS permission
WHERE permission.grantee_principal_id = @PrincipalId;

IF EXISTS (SELECT 1 FROM @ActualPermissions WHERE contract_state = N'W')
    THROW 51329, 'The post-state contains GRANT WITH GRANT OPTION.', 1;

-- public may not broaden database business permissions or paws, paws_api,
-- staging, or objects in those schemas.
IF EXISTS (
    SELECT 1
    FROM sys.database_principals AS public_principal
    INNER JOIN sys.database_permissions AS permission
      ON permission.grantee_principal_id = public_principal.principal_id
    WHERE public_principal.name = N'public'
      AND permission.state IN (N'G', N'W')
      AND (
          (permission.class = 0 AND NOT (permission.permission_name = N'CONNECT' AND permission.state = N'G'))
          OR (permission.class = 3 AND SCHEMA_NAME(permission.major_id) IN (N'paws', N'paws_api', N'staging'))
          OR (permission.class = 1 AND OBJECT_SCHEMA_NAME(permission.major_id) IN (N'paws', N'paws_api', N'staging'))
      )
)
    THROW 51330, 'public has an unexpected grant affecting the B1 SQL boundary.', 1;

DECLARE @PostB1Mismatch int;
;WITH PostUnexpected AS (
    SELECT * FROM @ActualPermissions
    EXCEPT
    SELECT * FROM @PostB1Contract
), PostMissing AS (
    SELECT * FROM @PostB1Contract
    EXCEPT
    SELECT * FROM @ActualPermissions
)
SELECT @PostB1Mismatch = (SELECT COUNT(*) FROM PostUnexpected) + (SELECT COUNT(*) FROM PostMissing);

IF @PostB1Mismatch <> 0 OR (SELECT COUNT(*) FROM @ActualPermissions) <> (SELECT COUNT(*) FROM @PostB1Contract)
    THROW 51331, 'The runtime principal is not in the exact B1 post-state.', 1;

-- Explicit negative assertions retained for review readability. The exact
-- allowlist above already rejects direct DML, direct manual-table SELECT,
-- schema-wide paws_api EXECUTE, unexpected object EXECUTE, and all other
-- unanticipated permission types such as VIEW DEFINITION or REFERENCES.
-- The object mutation/execute contract includes permission_name = N'EXECUTE'
-- only for the exact B1 procedure; no other object write or execute is valid.
IF EXISTS (
    SELECT 1 FROM @ActualPermissions
    WHERE schema_name = N'paws'
      AND object_name IN (N'AfcManualRecord', N'AuditEvent')
      AND (contract_permission IN (N'SELECT', N'INSERT', N'UPDATE', N'DELETE') OR scope_kind = 'OBJECT')
)
    THROW 51332, 'Direct AFC table access is outside the exact contract.', 1;
IF EXISTS (
    SELECT 1 FROM @ActualPermissions
    WHERE schema_name = N'paws_api' AND scope_kind = 'SCHEMA'
)
    THROW 51333, 'Schema-wide paws_api permission is outside the exact contract.', 1;

PRINT N'LEAST_PRIVILEGE_WRITE_PROOF_OK';
