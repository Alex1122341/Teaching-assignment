-- B1R2 proposal only. Do not apply this file to live SQL.
-- Bind the actual runtime principal at the separately approved B1D gate.
:setvar PAWS_API_PRINCIPAL "paws-sql-beta-mi"

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF USER_ID(N'$(PAWS_API_PRINCIPAL)') IS NULL
    THROW 51301, 'The B1 runtime principal must already exist before permissions are applied.', 1;

DECLARE @PrincipalId int = USER_ID(N'$(PAWS_API_PRINCIPAL)');
DECLARE @PrincipalSid varbinary(85);
DECLARE @PrincipalType char(1);
SELECT @PrincipalSid = sid, @PrincipalType = type
FROM sys.database_principals
WHERE principal_id = @PrincipalId;

IF @PrincipalType = N'X'
    THROW 51302, 'The B1 runtime principal must be a dedicated user, not an external group.', 1;
IF EXISTS (SELECT 1 FROM sys.databases WHERE database_id = DB_ID() AND owner_sid = @PrincipalSid)
    THROW 51303, 'The B1 runtime principal must not own the database.', 1;
IF EXISTS (SELECT 1 FROM sys.database_role_members WHERE member_principal_id = @PrincipalId)
    THROW 51304, 'The B1 runtime principal must not inherit a database role.', 1;

IF SCHEMA_ID(N'paws') IS NULL OR EXISTS (
    SELECT 1 FROM sys.schemas WHERE name = N'paws' AND USER_NAME(principal_id) <> N'dbo'
)
    THROW 51305, 'The paws schema must exist and be owned by dbo.', 1;
IF SCHEMA_ID(N'paws_api') IS NULL OR EXISTS (
    SELECT 1 FROM sys.schemas WHERE name = N'paws_api' AND USER_NAME(principal_id) <> N'dbo'
)
    THROW 51306, 'The paws_api schema must exist and be owned by dbo.', 1;
IF OBJECT_ID(N'paws.vAfcRecordUnified', N'V') IS NULL
    THROW 51307, 'The unified AFC view must exist before its grant is applied.', 1;
IF OBJECT_ID(N'paws_api.CreateAfcRecord', N'P') IS NULL
    THROW 51308, 'The AFC write procedure must exist before its grant is applied.', 1;

IF EXISTS (SELECT 1 FROM sys.schemas WHERE principal_id = @PrincipalId)
    OR EXISTS (SELECT 1 FROM sys.objects WHERE principal_id = @PrincipalId)
    THROW 51309, 'The B1 runtime principal must own no schemas or objects.', 1;

-- The runtime contract must be evaluated against the database-level permission
-- and schema-level permission classes, including the existing paws and staging
-- schema DENYs. No missing schema can be silently treated as an empty contract.
IF SCHEMA_ID(N'paws') IS NULL OR SCHEMA_ID(N'staging') IS NULL
    THROW 51309, 'The paws and staging schemas must exist before permission preflight.', 1;

-- The normalized allowlist is the single semantic contract for both valid
-- pre-states: the reviewed R4D-10A/10A2 contract before B1, and that same
-- contract after the two B1 grants. Class 1 rows with minor_id = 0 are whole-
-- object permissions; column rows are represented by their exact column name.
DECLARE @PreB1Contract TABLE (
    contract_class tinyint NOT NULL,
    contract_state char(1) NOT NULL,
    contract_permission sysname NOT NULL,
    schema_name sysname NULL,
    object_name sysname NULL,
    column_name sysname NULL,
    scope_kind varchar(8) NOT NULL
);

INSERT @PreB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
VALUES
    (0, N'G', N'CONNECT', NULL, NULL, NULL, 'DATABASE'),
    (1, N'G', N'SELECT', N'paws', N'vCalendarSession', NULL, 'OBJECT');

INSERT @PreB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 1, N'G', N'SELECT', N'paws', N'UserProfile', v.column_name, 'COLUMN'
FROM (VALUES
    (N'FirebaseUid'), (N'DisplayName'), (N'BaseRole'), (N'FacultyId'),
    (N'Active'), (N'MustChangePassword')
) AS v(column_name);

INSERT @PreB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 1, N'G', N'SELECT', N'paws', N'SessionAssignment', v.column_name, 'COLUMN'
FROM (VALUES
    (N'SessionAssignmentId'), (N'SessionId'), (N'FacultyId'), (N'TeachingRole'),
    (N'LabLead'), (N'CreditedHours'), (N'DoeRate'), (N'DoeQuantity'),
    (N'DoeUnit'), (N'DoeCredit'), (N'DoeStatus')
) AS v(column_name);

INSERT @PreB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 1, N'G', N'SELECT', N'paws', N'Faculty', v.column_name, 'COLUMN'
FROM (VALUES
    (N'FacultyId'), (N'RecordType'), (N'PreferredFirstName'), (N'PreferredLastName'),
    (N'DisplayName'), (N'Ucid'), (N'Email'), (N'Stream'), (N'Rank'), (N'Fte'),
    (N'ReportsToFacultyId'), (N'Active')
) AS v(column_name);

INSERT @PreB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 1, N'G', N'SELECT', N'paws', N'FacultyProfessionalProfile', v.column_name, 'COLUMN'
FROM (VALUES
    (N'FacultyId'), (N'TeachingArea'), (N'ProfessionalCategory'), (N'ServiceDate'),
    (N'PriorYearsExperience'), (N'DvmEarnedDate'), (N'DvmType'),
    (N'MastersEarnedDate'), (N'MastersArea'), (N'PhdEarnedDate'), (N'PhdArea'),
    (N'BoardCertifiedDate'), (N'BoardCertification'), (N'BoardCertificationCount'),
    (N'AbvmaLicenseNumber'), (N'AbvmaMemberType')
) AS v(column_name);

INSERT @PreB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 1, N'G', N'SELECT', N'paws', N'JointAppointment', v.column_name, 'COLUMN'
FROM (VALUES
    (N'JointAppointmentId'), (N'FacultyId'), (N'HomeFaculty'), (N'JointFaculty'),
    (N'FteUcvm'), (N'FteOtherFaculty'), (N'ExpiryDate'), (N'Notes')
) AS v(column_name);

INSERT @PreB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 1, N'G', N'SELECT', N'paws', N'RoleAssignment', v.column_name, 'COLUMN'
FROM (VALUES
    (N'RoleAssignmentId'), (N'FacultyId'), (N'FacultyResolutionStatus'),
    (N'AcademicYear'), (N'RoleCategory'), (N'RoleType'),
    (N'CourseOrSubjectOrRotation'), (N'CourseName'), (N'Details'),
    (N'EffectiveDate'), (N'ExpirationDate'), (N'DoeMappedValue'),
    (N'DoeOverrideValue'), (N'DoeOverrideReason'), (N'SpecialNotes')
) AS v(column_name);

INSERT @PreB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 1, N'G', N'SELECT', N'paws', N'AfcRecord', v.column_name, 'COLUMN'
FROM (VALUES
    (N'AfcRecordId'), (N'FacultyId'), (N'StartDate'), (N'EndDate'), (N'Purpose'), (N'Active')
) AS v(column_name);

-- Existing schema DENYs are part of the contract, not a loose count. The
-- reviewed paws rows are permission_name IN (N'INSERT', N'UPDATE', N'DELETE', N'EXECUTE');
-- staging has the same mutation DENYs plus SELECT.
INSERT @PreB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 3, N'D', v.permission_name, N'paws', NULL, NULL, 'SCHEMA'
FROM (VALUES (N'INSERT'), (N'UPDATE'), (N'DELETE'), (N'EXECUTE')) AS v(permission_name);

INSERT @PreB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
SELECT 3, N'D', v.permission_name, N'staging', NULL, NULL, 'SCHEMA'
FROM (VALUES (N'SELECT'), (N'INSERT'), (N'UPDATE'), (N'DELETE'), (N'EXECUTE')) AS v(permission_name);

DECLARE @PostB1Contract TABLE (
    contract_class tinyint NOT NULL,
    contract_state char(1) NOT NULL,
    contract_permission sysname NOT NULL,
    schema_name sysname NULL,
    object_name sysname NULL,
    column_name sysname NULL,
    scope_kind varchar(8) NOT NULL
);
INSERT @PostB1Contract SELECT * FROM @PreB1Contract;
INSERT @PostB1Contract (contract_class, contract_state, contract_permission, schema_name, object_name, column_name, scope_kind)
VALUES
    (1, N'G', N'SELECT', N'paws', N'vAfcRecordUnified', NULL, 'OBJECT'),
    (1, N'G', N'EXECUTE', N'paws_api', N'CreateAfcRecord', NULL, 'OBJECT');

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

-- State W is never allowed for an object SELECT or EXECUTE; exact contract
-- matching below also rejects it for every other permission class/type.
-- Any unexpected object mutation/execute row is rejected before GRANT.
IF EXISTS (SELECT 1 FROM @ActualPermissions WHERE contract_state = N'W')
    THROW 51310, 'The runtime principal has a GRANT WITH GRANT OPTION permission.', 1;

-- Keep the public guard broad enough to catch database, schema, and object
-- grants over paws, paws_api, or staging. public may not broaden the boundary.
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
    THROW 51311, 'public has an unexpected grant affecting the B1 SQL boundary.', 1;

-- Compare normalized rows, not just class=0. This keeps legitimate class=1
-- column SELECT and class=3 DENY rows in scope while rejecting every other
-- permission name, state, object, column, grant option, or permission class.
DECLARE @PreB1Mismatch int;
DECLARE @PostB1Mismatch int;
;WITH PreUnexpected AS (
    SELECT * FROM @ActualPermissions
    EXCEPT
    SELECT * FROM @PreB1Contract
), PreMissing AS (
    SELECT * FROM @PreB1Contract
    EXCEPT
    SELECT * FROM @ActualPermissions
)
SELECT @PreB1Mismatch = (SELECT COUNT(*) FROM PreUnexpected) + (SELECT COUNT(*) FROM PreMissing);
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

IF NOT (
    (@PreB1Mismatch = 0 AND (SELECT COUNT(*) FROM @ActualPermissions) = (SELECT COUNT(*) FROM @PreB1Contract))
    OR (@PostB1Mismatch = 0 AND (SELECT COUNT(*) FROM @ActualPermissions) = (SELECT COUNT(*) FROM @PostB1Contract))
)
    THROW 51312, 'The runtime principal permission rows are outside the exact pre-B1 or idempotent B1 contract.', 1;

-- All ownership, public, allowlist, state, and DENY guards execute before
-- either new B1 GRANT. No grant is emitted on a failed preflight.
-- All guards above execute before either new B1 GRANT.
IF NOT EXISTS (
    SELECT 1 FROM @PreB1Contract
    WHERE contract_class = 3 AND schema_name = N'paws' AND contract_state = N'D' AND contract_permission = N'EXECUTE'
)
    THROW 51313, 'The paws schema mutation DENY contract is incomplete.', 1;
IF NOT EXISTS (
    SELECT 1 FROM @PreB1Contract
    WHERE contract_class = 3 AND schema_name = N'staging' AND contract_state = N'D' AND contract_permission = N'SELECT'
)
    THROW 51314, 'The staging schema DENY contract is incomplete.', 1;

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
    THROW 51315, 'An AFC procedure or target object has an incompatible owner.', 1;

BEGIN TRY
    BEGIN TRANSACTION;
    GRANT SELECT ON OBJECT::paws.vAfcRecordUnified TO [$(PAWS_API_PRINCIPAL)];
    GRANT EXECUTE ON OBJECT::paws_api.CreateAfcRecord TO [$(PAWS_API_PRINCIPAL)];
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

-- Verify the exact post-state after the transaction. A successful GRANT batch
-- is not sufficient evidence if another permission row was present or added.
DELETE FROM @ActualPermissions;
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
    THROW 51316, 'The resulting runtime principal permission rows are not the exact B1 post-state.', 1;

PRINT N'AFC_PERMISSION_CONTRACT_OK';
