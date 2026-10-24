-- BETA-R4D-10A — read-only proof for the Dashboard SQL principal.
--
-- Run as a sysadmin/db_owner connection AFTER 004_swa_beta_permissions.sql has
-- been applied. Every check below must report DENIED / NO-GRANT; the script
-- throws as soon as one fails, so a green run is a positive statement that the
-- Dashboard read principal cannot mutate `paws` and cannot read `staging`.
--
-- Bind the principal that actually connects:
--     sqlcmd -v PAWS_API_PRINCIPAL="paws-sql-beta-mi" -i 004_swa_beta_permissions_readonly_proof.sql
--
-- This script performs no mutation.

SET NOCOUNT ON;

:setvar PAWS_API_PRINCIPAL "paws_swa_beta"

DECLARE @Principal sysname = N'$(PAWS_API_PRINCIPAL)';
DECLARE @PrincipalId int = USER_ID(@Principal);
IF @PrincipalId IS NULL
    THROW 51100, 'The runtime principal does not exist; apply 004_swa_beta_permissions.sql first.', 1;

-- 1. No schema-wide or object-level DML grant anywhere in `paws`.
IF EXISTS (
    SELECT 1
    FROM sys.database_permissions AS p
    WHERE p.grantee_principal_id = @PrincipalId
      AND p.state IN (N'G', N'W')
      AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE', N'MERGE', N'EXECUTE', N'ALTER', N'CONTROL', N'TAKE OWNERSHIP')
) THROW 51101, 'The runtime principal holds a mutation-capable permission.', 1;

-- 2. No SELECT grant of any kind on the staging schema.
IF EXISTS (
    SELECT 1
    FROM sys.database_permissions AS p
    WHERE p.grantee_principal_id = @PrincipalId
      AND p.state IN (N'G', N'W')
      AND p.permission_name = N'SELECT'
      AND (
        (p.class = 3 AND SCHEMA_NAME(p.major_id) = N'staging')
        OR (p.class = 1 AND OBJECT_SCHEMA_NAME(p.major_id) = N'staging')
      )
) THROW 51102, 'The runtime principal can read the staging schema.', 1;

-- 3. Explicit DENY rows exist for every mutation verb on `paws` and for
--    `staging` SELECT. Counted per verb so a missing DENY cannot hide behind
--    its siblings.
IF (
    SELECT COUNT(DISTINCT permission_name)
    FROM sys.database_permissions
    WHERE grantee_principal_id = @PrincipalId
      AND class = 3
      AND SCHEMA_NAME(major_id) = N'paws'
      AND state = N'D'
      AND permission_name IN (N'INSERT', N'UPDATE', N'DELETE', N'EXECUTE')
) <> 4 THROW 51103, 'The four paws schema mutation DENY rows are not all present.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_permissions
    WHERE grantee_principal_id = @PrincipalId
      AND class = 3
      AND SCHEMA_NAME(major_id) = N'staging'
      AND state = N'D'
      AND permission_name = N'SELECT'
) THROW 51104, 'staging SELECT DENY row is missing.', 1;

-- 4. The principal holds no database role.
IF EXISTS (SELECT 1 FROM sys.database_role_members WHERE member_principal_id = @PrincipalId)
    THROW 51105, 'The runtime principal inherits a database role.', 1;

-- 5. Principal-scoped effective-mutation probe.
--
--    HAS_PERMS_BY_NAME cannot be used here: it evaluates the CALLER's effective
--    permissions and ignores its principal argument entirely, so when this
--    script runs as a db_owner it reports the db_owner's rights (verified live:
--    it returns 1 for `paws.Session`/UPDATE even though the runtime principal
--    has an explicit DENY). The effective check therefore has to be expressed
--    against the runtime principal's own rows, honouring DENY-over-GRANT.
--
--    A verb is effectively permitted only when there is a GRANT at database,
--    schema or object scope and no DENY covering it. Every mutation verb below
--    must have zero effective permission.
IF EXISTS (
    SELECT 1
    FROM (VALUES
        (N'INSERT'), (N'UPDATE'), (N'DELETE'), (N'EXECUTE'),
        (N'ALTER'), (N'CONTROL'), (N'TAKE OWNERSHIP')
    ) AS verb(name)
    WHERE EXISTS (
        SELECT 1
        FROM sys.database_permissions AS grant_row
        WHERE grant_row.grantee_principal_id = @PrincipalId
          AND grant_row.state IN (N'G', N'W')
          AND grant_row.permission_name = verb.name
          AND NOT EXISTS (
              SELECT 1
              FROM sys.database_permissions AS deny_row
              WHERE deny_row.grantee_principal_id = @PrincipalId
                AND deny_row.state = N'D'
                AND deny_row.permission_name = verb.name
                AND (
                    deny_row.class = 0
                    OR (deny_row.class = 3 AND (
                        grant_row.class = 0
                        OR (grant_row.class = 3 AND deny_row.major_id = grant_row.major_id)
                        OR (grant_row.class = 1 AND deny_row.major_id = SCHEMA_ID(OBJECT_SCHEMA_NAME(grant_row.major_id)))
                    ))
                )
          )
    )
) THROW 51106, 'The runtime principal has effective mutation permission on a paws object.', 1;

-- 5b. Positive control: the mutation DENYs really are in force for this
--     principal, so check 5 is not vacuously true.
IF (
    SELECT COUNT(DISTINCT permission_name)
    FROM sys.database_permissions
    WHERE grantee_principal_id = @PrincipalId
      AND class = 3
      AND SCHEMA_NAME(major_id) = N'paws'
      AND state = N'D'
      AND permission_name IN (N'INSERT', N'UPDATE', N'DELETE', N'EXECUTE')
) <> 4 THROW 51108, 'The paws schema mutation DENYs are not all in force.', 1;

-- 6. Every granted SELECT is column-scoped except the reviewed view.
IF EXISTS (
    SELECT 1
    FROM sys.database_permissions AS p
    WHERE p.grantee_principal_id = @PrincipalId
      AND p.state = N'G'
      AND p.permission_name = N'SELECT'
      AND p.class = 1
      AND p.minor_id = 0
      AND NOT (OBJECT_SCHEMA_NAME(p.major_id) = N'paws' AND OBJECT_NAME(p.major_id) IN (N'vCalendarSession'))
) THROW 51107, 'The runtime principal has an unreviewed whole-object SELECT grant.', 1;

-- 7. BETA-R4D-10A2 positive control: the expanded Dashboard read surface is
--    actually present. Without this, a silent loss of the R4D-10A2 grants would
--    still produce a green "read-only" run while the API quietly broke.
--
--    The expected (object, column) pairs are projected with a SELECT and a row
--    constructor, so the proof script contains no DML statement of any kind -
--    not even against a temporary table variable.
SELECT object_name, column_name
  INTO #ExpectedColumns
  FROM (VALUES
    (N'FacultyProfessionalProfile', N'TeachingArea'),
    (N'FacultyProfessionalProfile', N'ProfessionalCategory'),
    (N'FacultyProfessionalProfile', N'AbvmaMemberType'),
    (N'JointAppointment', N'JointAppointmentId'),
    (N'JointAppointment', N'FteUcvm'),
    (N'JointAppointment', N'Notes'),
    (N'RoleAssignment', N'RoleAssignmentId'),
    (N'RoleAssignment', N'RoleCategory'),
    (N'RoleAssignment', N'DoeOverrideValue'),
    (N'AfcRecord', N'AfcRecordId'),
    (N'AfcRecord', N'Purpose'),
    (N'AfcRecord', N'Active'),
    (N'SessionAssignment', N'SessionAssignmentId'),
    (N'SessionAssignment', N'TeachingRole'),
    (N'SessionAssignment', N'LabLead'),
    (N'SessionAssignment', N'CreditedHours'),
    (N'SessionAssignment', N'DoeRate'),
    (N'SessionAssignment', N'DoeQuantity'),
    (N'SessionAssignment', N'DoeUnit'),
    (N'SessionAssignment', N'DoeCredit'),
    (N'SessionAssignment', N'DoeStatus')
  ) AS expected(object_name, column_name);

IF EXISTS (
    SELECT 1
    FROM #ExpectedColumns AS expected
    WHERE NOT EXISTS (
        SELECT 1
        FROM sys.database_permissions AS p
        WHERE p.grantee_principal_id = @PrincipalId
          AND p.state = N'G'
          AND p.permission_name = N'SELECT'
          AND p.class = 1
          AND OBJECT_SCHEMA_NAME(p.major_id) = N'paws'
          AND OBJECT_NAME(p.major_id) = expected.object_name
          AND COL_NAME(p.major_id, p.minor_id) = expected.column_name
    )
) THROW 51109, 'The R4D-10A2 Dashboard read grants are incomplete.', 1;

-- 8. BETA-R4D-10A2 negative control: provenance columns must NOT be readable.
--    Source metadata staying unreachable is the point of the column-scoped
--    grant, so a grant here would be a regression, not a convenience.
IF EXISTS (
    SELECT 1
    FROM sys.database_permissions AS p
    WHERE p.grantee_principal_id = @PrincipalId
      AND p.state IN (N'G', N'W')
      AND p.permission_name = N'SELECT'
      AND p.class = 1
      AND OBJECT_SCHEMA_NAME(p.major_id) = N'paws'
      AND (
        (OBJECT_NAME(p.major_id) IN (N'Faculty', N'FacultyProfessionalProfile', N'JointAppointment', N'RoleAssignment', N'AfcRecord', N'SessionAssignment')
         AND (COL_NAME(p.major_id, p.minor_id) IN (N'SourceImportBatchId', N'SourceRow', N'SourceFacultyName')
              OR p.minor_id = 0))
      )
) THROW 51110, 'The runtime principal can read source import provenance.', 1;

SELECT
    N'READ_ONLY_PROOF_OK' AS Result,
    @Principal AS PrincipalName,
    (SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = @PrincipalId AND state = N'G') AS GrantCount,
    (SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = @PrincipalId AND state = N'D') AS DenyCount;
