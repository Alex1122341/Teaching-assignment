'use strict';
// Disposable LocalDB check of the leadership directory SQL (synthetic data; rolled back).
// Usage (Windows, from a checkout of the feature branch with server/node_modules installed):
//   node leadership-sql-check.js <repo root> <LocalDB instance>
const path = require('node:path');
const { execSync } = require('node:child_process');
const repo = path.resolve(process.argv[2]);
const instance = process.argv[3] || 'PAWSTestSim';
const sql = require(path.join(repo, 'server/node_modules/mssql/msnodesqlv8'));
const { createSqlLeadershipDirectoryRepository } = require(path.join(repo, 'server/src/data/sql-leadership-directory-repository'));
const { buildDirectory } = require(path.join(repo, 'server/src/roles/leadership-directory-api'));

const info = execSync(`SqlLocalDB.exe info ${instance}`, { encoding: 'utf8' });
if (!/State:\s+Running/i.test(info)) execSync(`SqlLocalDB.exe start ${instance}`);
const pipe = /Instance pipe name:\s*(\S+)/i.exec(execSync(`SqlLocalDB.exe info ${instance}`, { encoding: 'utf8' }))[1];
const drivers = execSync('powershell -NoProfile -Command "(Get-OdbcDriver -Platform 64-bit).Name"', { encoding: 'utf8' });
const driver = ['ODBC Driver 18 for SQL Server', 'ODBC Driver 17 for SQL Server', 'SQL Server'].find(n => drivers.includes(n));
const connectionString = `Driver={${driver}};Server=${pipe};Database=VetMed-Ops;Trusted_Connection=Yes;`;

(async () => {
  const pool = await new sql.ConnectionPool({ connectionString }).connect();
  try {
    // Capture the exact repository statement and parameters.
    let captured;
    await createSqlLeadershipDirectoryRepository({ query: async (text, params) => { captured = { text, params }; return []; } }).list({ academicYear: '2026-27' });
    const declare = Object.entries(captured.params).map(([k, v]) => typeof v === 'number' ? `DECLARE @${k} int = ${v};` : `DECLARE @${k} nvarchar(64) = N'${String(v).replace(/'/g, "''")}';`).join('\n');
    const [guard] = (await pool.request().query(`SELECT (SELECT COUNT(*) FROM paws_env.EnvironmentIdentity WHERE Environment=N'testing') AS testingMarker, USER_ID(N'paws_testing_runtime') AS runtimeUser,
      (SELECT COUNT(*) FROM sys.database_role_members rm JOIN sys.database_principals r ON r.principal_id=rm.role_principal_id JOIN sys.database_principals m ON m.principal_id=rm.member_principal_id WHERE r.name=N'paws_runtime_read' AND m.name=N'paws_testing_runtime') AS readRoleMember`)).recordset;
    if (guard.testingMarker !== 1) throw new Error('Refusing: not a Testing-marked database');
    const batch = `SET NOCOUNT ON; SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @batch uniqueidentifier = (SELECT TOP 1 SourceImportBatchId FROM paws.RoleAssignment);
DECLARE @f0 uniqueidentifier = (SELECT FacultyId FROM paws.UserProfile WHERE FirebaseUid=N'syn-hicc'),
        @f1 uniqueidentifier = (SELECT FacultyId FROM paws.UserProfile WHERE FirebaseUid=N'syn-visc'),
        @f2 uniqueidentifier = (SELECT FacultyId FROM paws.UserProfile WHERE FirebaseUid=N'syn-faculty-a'),
        @inactive uniqueidentifier = (SELECT TOP 1 FacultyId FROM paws.Faculty WHERE Active=0 AND RecordType=N'faculty');
DECLARE @r TABLE(id uniqueidentifier, label nvarchar(40));
INSERT @r VALUES (NEWID(),N'hicc-schedule'),(NEWID(),N'cc-no-dates'),(NEWID(),N'cc-no-dates-dup'),(NEWID(),N'visc-gap'),(NEWID(),N'visc-legacy'),(NEWID(),N'legacy-label'),(NEWID(),N'rotation'),(NEWID(),N'inactive-faculty'),(NEWID(),N'other-year'),(NEWID(),N'visc-unscoped');
INSERT paws.RoleAssignment (RoleAssignmentId,FacultyId,FacultyResolutionStatus,AcademicYear,RoleType,CourseOrSubjectOrRotation,EffectiveDate,ExpirationDate,DoeMappedValue,SpecialNotes,SourceImportBatchId,SourceRow)
SELECT id, CASE label WHEN N'hicc-schedule' THEN @f0 WHEN N'visc-gap' THEN @f1 WHEN N'visc-legacy' THEN @f2 WHEN N'visc-unscoped' THEN @f1 WHEN N'inactive-faculty' THEN @inactive ELSE @f2 END,
  N'preferred_name', CASE label WHEN N'other-year' THEN N'2025-26' ELSE N'2026-27' END,
  CASE label WHEN N'hicc-schedule' THEN N'HICC' WHEN N'cc-no-dates' THEN N'Course Coordinator' WHEN N'cc-no-dates-dup' THEN N'Course Coordinator'
             WHEN N'visc-gap' THEN N'VISC' WHEN N'visc-legacy' THEN N' VISC ' WHEN N'visc-unscoped' THEN N'VISC' WHEN N'legacy-label' THEN N'Course Coordinator / HICC (legacy ambiguous)'
             WHEN N'rotation' THEN N'Rotation Participant' ELSE N'HICC' END,
  CASE label WHEN N'visc-gap' THEN N'Cardiology' WHEN N'visc-legacy' THEN N'Anatomy' WHEN N'visc-unscoped' THEN NULL ELSE N'VTMD 200' END,
  CASE label WHEN N'visc-legacy' THEN '2026-07-01' WHEN N'other-year' THEN '2025-07-01' END,
  CASE label WHEN N'visc-legacy' THEN '2027-06-30' WHEN N'other-year' THEN '2026-06-30' END,
  7.5, N'private note', @batch, 900000 + ROW_NUMBER() OVER (ORDER BY label)
FROM @r;
INSERT paws.RoleAppointmentSchedule(RoleAssignmentId,PeriodsJson,UpdatedAtUtc,UpdatedByFirebaseUid)
SELECT id, CASE label WHEN N'hicc-schedule' THEN N'[{"startDate":"2026-07-01","endDate":"2026-12-31"},{"startDate":"2027-01-15","endDate":"2027-06-30"}]'
                       ELSE N'[{"startDate":"2026-07-01","endDate":"2026-09-30"},{"startDate":"2027-01-05","endDate":null}]' END, SYSUTCDATETIME(), N'leadership-sql-check'
FROM @r WHERE label IN (N'hicc-schedule', N'visc-gap');
EXECUTE AS USER = N'paws_testing_runtime';
${declare}
${captured.text};
REVERT;
SELECT label FROM @r ORDER BY label;
ROLLBACK TRANSACTION;`;
    const result = await pool.request().query(batch);
    const rows = result.recordsets[0];
    const directory = buildDirectory(rows, { academicYear: '2026-27', asOfDate: '2026-10-22' });
    const total = (await pool.request().query(`SELECT COUNT(*) AS n FROM paws.RoleAssignment WHERE SourceRow >= 900000`)).recordset[0].n;
    console.log(JSON.stringify({ ok: true, instance, guard, executedAs: 'paws_testing_runtime (EXECUTE AS USER)', sqlRows: rows.length,
      roleTypesReturned: [...new Set(rows.map(r => r.roleType))].sort(), columnsReturned: Object.keys(rows[0] || {}).sort(),
      hiccCc: directory.hiccCc.length, visc: directory.visc.length, directory, leftoverRowsAfterRollback: total }, null, 2));
  } finally { await pool.close(); }
})().catch(error => { console.error('LEADERSHIP_SQL_CHECK_FAILED', error.message); process.exit(1); });
