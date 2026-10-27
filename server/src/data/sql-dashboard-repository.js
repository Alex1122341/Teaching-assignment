'use strict';

const { facultyDisplayNameSql } = require('./faculty-display-name');

// BETA-R4D-10A2 — read-only Azure SQL repository for the Dashboard API.
//
// Scope and safety contract:
//   * READ ONLY. This module must never emit INSERT, UPDATE, DELETE, MERGE,
//     EXEC, or any DDL. A repository test asserts this statically.
//   * `paws` schema only. `staging` is never referenced.
//   * Every statement is parameterised; no value is interpolated into SQL text.
//   * Faculty scoping is a server-side WHERE predicate, never a UI filter.
//
// The Dashboard summary/roster/detail payloads are derived exclusively from
// Azure SQL. There is no Firestore read anywhere on this path.
//
// R4D-10A2 widens the read surface from three objects to the full Dashboard
// contract: Faculty, FacultyProfessionalProfile, JointAppointment,
// RoleAssignment, AfcRecord, SessionAssignment (+ vCalendarSession).

const {
  DEFAULT_ACADEMIC_YEAR,
  canonicalAcademicYear,
  resolveAcademicYear
} = require('./academic-year');
const {
  DOE_NON_CREDIT_SESSION_TYPES,
  resolveTeachingDoe,
  resolveRoleDoe
} = require('../domain/doe-calculator');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The Dashboard "needs attention" predicate mirrors the reviewed session-quality
// taxonomy: a session is grid-positionable only when it starts at or after 07:30
// and ends strictly after it starts. Everything else is check-needed.
const GRID_START = '07:30:00';

// Bounded roster page size. The limit is bound as a SQL parameter (`@limit`),
// never spliced into the statement text.
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const AFC_MAX_LIMIT = 2000;

// Deterministic HICC / VISC classification.
//
// CONFIRMED AGAINST LIVE DATA (recon, 2026-09-27): `paws.RoleAssignment.RoleCategory`
// is NULL for ALL 162 rows in academic year 2026-27. The classification
// vocabulary lives entirely in `RoleType`. A predicate on `RoleCategory` would
// have silently returned hiccCount = 0 / viscCount = 0, which is exactly the
// class of failure this task exists to eliminate.
//
// Canonical live vocabulary (`RoleType`, all rows, 2026-27):
//   'Course Coordinator / HICC (legacy ambiguous)'  64 rows / 46 faculty
//   'Rotation Participant'                          38 rows / 27 faculty
//   'VISC'                                          35 rows / 34 faculty
//   'CCC'                                           14 rows / 14 faculty
//   'Designated Rotation Coordinator'               11 rows /  9 faculty
//
// Matching rule: EXACT, case-insensitive whole-value equality against a closed
// list. No LIKE, no substring, no prefix. `Designated Rotation Coordinator`
// is deliberately NOT counted as HICC — despite containing the word
// "Coordinator" — because the source distinguishes the two values and fuzzy
// matching would inflate the HICC count from 64 to 75.
const VISC_ROLE_TYPES = ['VISC'];
const HICC_ROLE_TYPES = ['Course Coordinator / HICC (legacy ambiguous)', 'HICC'];

// Retained only so the R4D-10A export surface does not break. NOT used as a
// query predicate — `RoleCategory` is the wrong axis (it is NULL live).
const HICC_CATEGORY = HICC_ROLE_TYPES[0];
const VISC_CATEGORY = VISC_ROLE_TYPES[0];

// Renders an exact-match predicate over a closed list as `IN (@p0, @p1, ...)`,
// returning both the SQL fragment and the parameters to bind. SQL text is never
// spliced; only generated parameter names appear in the statement.
function roleTypeInPredicate(column, values, prefix) {
  const names = values.map((_, index) => `@${prefix}${index}`);
  const params = {};
  values.forEach((value, index) => {
    params[names[index].slice(1)] = value;
  });
  return {
    sql: `${column} IN (${names.join(', ')})`,
    params
  };
}

// ---------------------------------------------------------------------------
// GRANT-SAFE ROW COUNTING (R4D-10A2 hotfix, confirmed live 2026-09-28)
// ---------------------------------------------------------------------------
//
// `paws-sql-beta-mi` holds COLUMN-scoped SELECT grants, not object-scoped ones.
// Several tables retain import-provenance columns (`SourceImportBatchId`,
// `SourceRow`, `SourceFacultyName`, `ReportsToRaw`, `CreatedAtUtc`,
// `UpdatedAtUtc`, …) that are deliberately NOT granted.
//
// Under column-level security, `SELECT COUNT(*)` is authorised against *every*
// column of the object, so a bare `COUNT(*)` over such a table is refused even
// though it returns no data:
//
//   The SELECT permission was denied on the column 'SourceRow' of the object
//   'AfcRecord', database 'teaching-assignment-lab', schema 'paws'. (err 230)
//
// A correlated `COUNT(*)` that filters on a granted column happens to succeed
// (the optimiser can seek), but that is an accident of the plan, not a contract.
// The deterministic fix is to count a NOT NULL column the principal is
// authorised to read. Every table below has a NOT NULL primary-key surrogate
// (`AfcRecordId`, `RoleAssignmentId`, `SessionAssignmentId`, `FacultyId`,
// `JointAppointmentId`), so `COUNT(<pk>)` equals `COUNT(*)` exactly, while
// touching only granted columns.
//
// This helper renders that form for a qualified column reference.
function rowCount(qualifiedKey) {
  return `COUNT(${qualifiedKey})`;
}

function isUuid(value) {
  return typeof value === 'string' && UUID.test(value.trim());
}

// Kept for backwards compatibility with the R4D-10A export surface. Delegates
// to the canonical implementation so there is exactly one year rule.
function academicYear(value) {
  return resolveAcademicYear(value);
}

function boundLimit(value) {
  const numeric = Number.isFinite(value) ? Math.trunc(value) : NaN;
  if (!Number.isFinite(numeric)) return DEFAULT_LIMIT;
  return Math.min(Math.max(numeric, 1), MAX_LIMIT);
}

function boundAfcLimit(value) {
  const numeric = Number.isFinite(value) ? Math.trunc(value) : NaN;
  if (!Number.isFinite(numeric)) return AFC_MAX_LIMIT;
  return Math.min(Math.max(numeric, 1), AFC_MAX_LIMIT);
}

// `LIKE` metacharacters are escaped and the statement declares `ESCAPE '\'`, so
// a search for `100%` cannot broaden into a wildcard scan.
function likePattern(value) {
  return '%' + String(value).replace(/[\\%_[\]]/g, match => '\\' + match) + '%';
}

function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function toInt(value) {
  return value === null || value === undefined ? 0 : Number(value);
}

function toText(value) {
  return value === null || value === undefined ? null : String(value);
}

function toBool(value) {
  return value === true || value === 1;
}

function emptyDoeGapBucket() {
  return { gapCount: 0, calculatedCount: 0, unresolvedCount: 0, calculatedDoe: 0 };
}

function addDoeGap(map, facultyId, resolution) {
  const key = String(facultyId);
  const bucket = map.get(key) || emptyDoeGapBucket();
  bucket.gapCount += 1;
  if (resolution.effectiveDoe === null || resolution.effectiveDoe === undefined) {
    bucket.unresolvedCount += 1;
  } else {
    bucket.calculatedCount += 1;
    bucket.calculatedDoe += Number(resolution.effectiveDoe) || 0;
  }
  map.set(key, bucket);
}

function sumDoeGapMap(map) {
  const total = emptyDoeGapBucket();
  for (const bucket of map.values()) {
    total.gapCount += bucket.gapCount;
    total.calculatedCount += bucket.calculatedCount;
    total.unresolvedCount += bucket.unresolvedCount;
    total.calculatedDoe += bucket.calculatedDoe;
  }
  return total;
}

// Calculator gap queries remain read-only and bounded by the requested academic
// year. Only rows with no stored DOE are loaded, so normal stored evidence never
// fans out through the calculator and stored/override precedence is preserved.
async function calculateDoeGapSummary(db, academicYear) {
  const params = {
    academicYear,
    doeNa0: DOE_NON_CREDIT_SESSION_TYPES[0],
    doeNa1: DOE_NON_CREDIT_SESSION_TYPES[1]
  };
  const [teachingRows, roleRows] = await Promise.all([
    db.query(
      `SELECT sa.FacultyId AS facultyId,
              c.SessionType AS sessionType,
              sa.TeachingRole AS teachingRole,
              sa.CreditedHours AS creditedHours,
              sa.DoeQuantity AS doeQuantity,
              sa.DoeCredit AS doeCredit
         FROM paws.SessionAssignment sa
         INNER JOIN paws.vCalendarSession c ON c.SessionId = sa.SessionId
        WHERE c.AcademicYear = @academicYear
          AND sa.DoeCredit IS NULL
          AND (c.SessionType IS NULL OR c.SessionType NOT IN (@doeNa0, @doeNa1))`,
      params
    ),
    db.query(
      `SELECT r.FacultyId AS facultyId,
              r.AcademicYear AS academicYear,
              r.RoleType AS roleType,
              r.CourseOrSubjectOrRotation AS courseOrSubjectOrRotation,
              r.CourseName AS courseName,
              r.Details AS details,
              CONVERT(varchar(10), r.EffectiveDate, 23) AS effectiveDate,
              CONVERT(varchar(10), r.ExpirationDate, 23) AS expirationDate,
              (SELECT e.AllocationStatus FROM paws.vMasterRoleFacts e WHERE e.RoleAssignmentId=r.RoleAssignmentId) AS sourceAllocationStatus,
              r.DoeMappedValue AS doeMappedValue,
              r.DoeOverrideValue AS doeOverrideValue,
              r.SpecialNotes AS specialNotes
         FROM paws.RoleAssignment r
        WHERE r.AcademicYear = @academicYear
          AND r.DoeMappedValue IS NULL
          AND r.DoeOverrideValue IS NULL`,
      { academicYear }
    )
  ]);

  const teachingByFaculty = new Map();
  for (const row of teachingRows) {
    const resolution = resolveTeachingDoe({
      sessionType: toText(row.sessionType),
      teachingRole: toText(row.teachingRole),
      creditedHours: toNumber(row.creditedHours),
      doeQuantity: toNumber(row.doeQuantity),
      doeCredit: null
    });
    addDoeGap(teachingByFaculty, row.facultyId, resolution);
  }

  const roleByFaculty = new Map();
  for (const row of roleRows) {
    const resolution = resolveRoleDoe({
      academicYear: toText(row.academicYear),
      roleType: toText(row.roleType),
      courseOrSubjectOrRotation: toText(row.courseOrSubjectOrRotation),
      courseName: toText(row.courseName),
      details: toText(row.details),
      effectiveDate: toText(row.effectiveDate),
      expirationDate: toText(row.expirationDate),
      sourceAllocationStatus: toText(row.sourceAllocationStatus),
      doeMappedValue: null,
      doeOverrideValue: null,
      specialNotes: toText(row.specialNotes)
    });
    addDoeGap(roleByFaculty, row.facultyId, resolution);
  }

  return {
    teachingByFaculty,
    roleByFaculty,
    teachingTotal: sumDoeGapMap(teachingByFaculty),
    roleTotal: sumDoeGapMap(roleByFaculty)
  };
}

function effectiveDoeSum(storedDoe, calculatedDoe, resolvedCount, lineCount) {
  if (lineCount === 0) return 0;
  if (resolvedCount === 0) return null;
  return (storedDoe || 0) + (calculatedDoe || 0);
}

function createSqlDashboardRepository(db) {
  return {
    async reportFaculty() {
      const rows=await db.query(`SELECT TOP (@limit) f.FacultyId AS facultyId,
        f.PreferredFirstName AS preferredFirstName, f.PreferredLastName AS preferredLastName,
        f.DisplayName AS displayName, f.Rank AS rank, f.Stream AS stream,
        f.Fte AS fte, f.Active AS active FROM paws.Faculty f ORDER BY f.FacultyId`,{limit:10001});
      return rows.map(row=>({facultyId:row.facultyId,preferredFirstName:toText(row.preferredFirstName),preferredLastName:toText(row.preferredLastName),displayName:toText(row.displayName),rank:toText(row.rank),stream:toText(row.stream),fte:toNumber(row.fte),active:toBool(row.active)}));
    },
    // ---------------------------------------------------------------- summary
    // Complete business KPI set for the Dashboard. Faculty-scoped callers
    // receive the same counters narrowed to their own assignments.
    //
    // sessionCount deliberately counts EVERY vCalendarSession row for the year
    // (including the four that carry no SessionAssignment), because the
    // Dashboard reports the canonical session total.
    async summary({ academicYear: year, facultyId = null } = {}) {
      const resolvedYear = resolveAcademicYear(year);
      const scoped = facultyId ? ' AND sa.FacultyId = @facultyId' : '';
      const roleScoped = facultyId ? ' AND ra.FacultyId = @facultyId' : '';
      const afcScoped = facultyId ? ' AND ar.FacultyId = @facultyId' : '';
      // `@facultyId` is ALWAYS referenced by the CTE's
      // `(@facultyId IS NULL OR EXISTS (...))` guard, so it must ALWAYS be
      // supplied. The connection layer deliberately drops null/undefined
      // parameters (`sql-connection.js`), which would leave the statement
      // referencing an undeclared variable and fail with
      // "Must declare the scalar variable @facultyId" -> 503 SQL_UNAVAILABLE.
      // Bind an explicit SQL NULL instead of omitting the parameter.
      const params = { academicYear: resolvedYear, facultyId: facultyId || null };

      // HICC / VISC are matched on `RoleType`, the column that actually carries
      // the vocabulary. See the constant block above for the live evidence.
      const hicc = roleTypeInPredicate('ra.RoleType', HICC_ROLE_TYPES, 'hiccRoleType');
      const visc = roleTypeInPredicate('ra.RoleType', VISC_ROLE_TYPES, 'viscRoleType');
      Object.assign(params, hicc.params, visc.params);

      const rows = await db.query(
        `WITH scoped AS (
             SELECT c.SessionId,
                    c.SessionDate,
                    c.StartTime,
                    c.EndTime,
                    c.CourseCode
             FROM paws.vCalendarSession c
             WHERE c.AcademicYear = @academicYear
               AND (@facultyId IS NULL OR EXISTS (
                   SELECT 1
                   FROM paws.SessionAssignment sa
                   WHERE sa.SessionId = c.SessionId${scoped}
               ))
         )
         SELECT
             (SELECT ${rowCount('f.FacultyId')} FROM paws.Faculty f WHERE f.Active = 1) AS activeFacultyCount,
             (SELECT COUNT(*) FROM scoped) AS sessionCount,
             (SELECT COUNT(DISTINCT s.CourseCode) FROM scoped s) AS courseCount,
             (SELECT COUNT(*)
                FROM scoped s
               WHERE s.StartTime IS NOT NULL
                 AND s.EndTime IS NOT NULL
                 AND s.StartTime >= CONVERT(time(0), '${GRID_START}')
                 AND s.EndTime > s.StartTime) AS gridPositionableCount,
             (SELECT COUNT(*)
                FROM scoped s
               WHERE s.StartTime IS NULL
                  OR s.EndTime IS NULL
                  OR s.StartTime < CONVERT(time(0), '${GRID_START}')
                  OR s.EndTime <= s.StartTime) AS checkNeededCount,
             (SELECT ${rowCount('sa.SessionAssignmentId')}
                FROM paws.SessionAssignment sa
                INNER JOIN paws.vCalendarSession c ON c.SessionId = sa.SessionId
               WHERE c.AcademicYear = @academicYear${scoped}) AS assignmentCount,
             (SELECT ${rowCount('ra.RoleAssignmentId')}
                FROM paws.RoleAssignment ra
               WHERE ra.AcademicYear = @academicYear${roleScoped}) AS roleAssignmentCount,
             (SELECT ${rowCount('ra.RoleAssignmentId')}
                FROM paws.RoleAssignment ra
               WHERE ra.AcademicYear = @academicYear
                 AND ${hicc.sql}${roleScoped}) AS hiccCount,
             (SELECT ${rowCount('ra.RoleAssignmentId')}
                FROM paws.RoleAssignment ra
               WHERE ra.AcademicYear = @academicYear
                 AND ${visc.sql}${roleScoped}) AS viscCount,
             (SELECT ${rowCount('ar.AfcRecordId')} FROM paws.vAfcRecordUnified ar WHERE 1 = 1${afcScoped}) AS afcRecordCount`,
        params
      );

      const row = rows[0] || {};
      return {
        academicYear: resolvedYear,
        activeFacultyCount: toInt(row.activeFacultyCount),
        sessionCount: toInt(row.sessionCount),
        assignmentCount: toInt(row.assignmentCount),
        courseCount: toInt(row.courseCount),
        roleAssignmentCount: toInt(row.roleAssignmentCount),
        hiccCount: toInt(row.hiccCount),
        viscCount: toInt(row.viscCount),
        afcRecordCount: toInt(row.afcRecordCount),
        gridPositionableCount: toInt(row.gridPositionableCount),
        checkNeededCount: toInt(row.checkNeededCount)
      };
    },

    // ---------------------------------------------------------------- faculty
    // Roster. Administrators receive the full active roster; a faculty-scoped
    // caller is narrowed by `facultyId` to exactly its own row.
    async faculty({ academicYear: year, search = null, limit, facultyId = null, status = 'active' } = {}) {
      const resolvedYear = resolveAcademicYear(year);
      const params = { academicYear: resolvedYear, limit: boundLimit(limit) };
      const predicates = [];

      if (status === 'active') predicates.push('f.Active = 1');
      else if (status === 'inactive') predicates.push('f.Active = 0');
      else if (status !== 'all') throw new Error('Invalid Faculty status filter');

      if (facultyId) {
        predicates.push('f.FacultyId = @facultyId');
        params.facultyId = facultyId;
      }

      if (search) {
        predicates.push(`(f.DisplayName LIKE @search ESCAPE '\\' OR ${facultyDisplayNameSql()} LIKE @search ESCAPE '\\' OR f.Email LIKE @search ESCAPE '\\' OR f.Ucid LIKE @search ESCAPE '\\')`);
        params.search = likePattern(search);
      }

      const whereClause = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';

      const rows = await db.query(
        `SELECT TOP (@limit)
             f.FacultyId AS facultyId,
             f.PreferredFirstName AS preferredFirstName,
             f.PreferredLastName AS preferredLastName,
             ${facultyDisplayNameSql()} AS displayName,
             f.Ucid AS ucid,
             f.Email AS email,
             f.RecordType AS recordType,
             f.Stream AS stream,
             f.Rank AS rank,
             f.Fte AS fte,
             f.ReportsToFacultyId AS reportsToFacultyId,
             ${facultyDisplayNameSql('manager')} AS reportsToName,
             f.Active AS active,
             CONVERT(varchar(33), f.UpdatedAtUtc, 126) + 'Z' AS updatedAtUtc,
             profile.TeachingArea AS teachingArea,
             profile.ProfessionalCategory AS professionalCategory,
             (SELECT COUNT(DISTINCT c.SessionId)
                FROM paws.SessionAssignment sa
                INNER JOIN paws.vCalendarSession c ON c.SessionId = sa.SessionId
               WHERE sa.FacultyId = f.FacultyId
                 AND c.AcademicYear = @academicYear) AS sessionCount,
             (SELECT ${rowCount('ra.RoleAssignmentId')}
                FROM paws.RoleAssignment ra
               WHERE ra.FacultyId = f.FacultyId
                 AND ra.AcademicYear = @academicYear) AS roleCount,
             (SELECT ${rowCount('ar.AfcRecordId')}
                FROM paws.vAfcRecordUnified ar
               WHERE ar.FacultyId = f.FacultyId) AS afcCount,
             (SELECT ${rowCount('ja.JointAppointmentId')}
                FROM paws.JointAppointment ja
               WHERE ja.FacultyId = f.FacultyId) AS jointAppointmentCount
         FROM paws.Faculty f
         LEFT JOIN paws.Faculty manager ON manager.FacultyId = f.ReportsToFacultyId
         LEFT JOIN paws.FacultyProfessionalProfile profile ON profile.FacultyId = f.FacultyId
         ${whereClause}
         ORDER BY f.DisplayName, f.FacultyId`,
        params
      );

      return rows.map(row => ({
        facultyId: row.facultyId,
        preferredFirstName: toText(row.preferredFirstName),
        preferredLastName: toText(row.preferredLastName),
        displayName: toText(row.displayName),
        ucid: toText(row.ucid),
        email: toText(row.email),
        recordType: toText(row.recordType),
        stream: toText(row.stream),
        rank: toText(row.rank),
        fte: toNumber(row.fte),
        reportsToFacultyId: toText(row.reportsToFacultyId),
        reportsToName: toText(row.reportsToName),
        active: toBool(row.active),
        updatedAtUtc: row.updatedAtUtc instanceof Date ? row.updatedAtUtc.toISOString() : toText(row.updatedAtUtc),
        teachingArea: toText(row.teachingArea),
        professionalCategory: toText(row.professionalCategory),
        sessionCount: toInt(row.sessionCount),
        roleCount: toInt(row.roleCount),
        afcCount: toInt(row.afcCount),
        jointAppointmentCount: toInt(row.jointAppointmentCount)
      }));
    },

    // ------------------------------------------------------------- AFC list
    // Unified, bounded read surface for the administrator AFC Records tab.
    // Imported and manual records remain separate rows with an explicit
    // SourceKind; no overlap or duplicate business rows are collapsed. This
    // is historical/business evidence, so a later inactive Faculty state must
    // not hide an otherwise valid AFC row.
    async listAfcRecords({ search = null, reason = null, active, limit } = {}) {
      const params = { limit: boundAfcLimit(limit) };
      const predicates = [];
      if (search && String(search).trim()) {
        predicates.push("(f.DisplayName LIKE @search ESCAPE '\\' OR u.ReasonDisplay LIKE @search ESCAPE '\\' OR u.LegacyPurpose LIKE @search ESCAPE '\\' OR u.Notes LIKE @search ESCAPE '\\')");
        params.search = likePattern(search);
      }
      if (reason && String(reason).trim()) {
        predicates.push('(u.ReasonCode = @reason OR (u.ReasonCode IS NULL AND u.ReasonDisplay = @reason))');
        params.reason = String(reason).trim();
      }
      if (active === true || active === false) {
        predicates.push('u.Active = @active');
        params.active = active;
      }
      // An unfiltered list has no predicates at all, so the WHERE clause must
      // be omitted entirely rather than emitted empty.
      const whereClause = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
      const rows = await db.query(
        `SELECT TOP (@limit)
             u.AfcRecordId AS afcRecordId,
             u.FacultyId AS facultyId,
             ${facultyDisplayNameSql()} AS facultyName,
             CONVERT(varchar(10), u.StartDate, 23) AS startDate,
             CONVERT(varchar(10), u.EndDate, 23) AS endDate,
               u.ReasonCode AS reasonCode,
               u.Purpose AS purpose,
               u.ReasonDisplay AS reason,
             u.Notes AS notes,
             u.LegacyPurpose AS legacyPurpose,
             u.Active AS active,
             u.SourceKind AS sourceKind,
             u.CreatedAtUtc AS createdAtUtc,
             u.CreatedByName AS createdByName,
             u.RecordKey AS recordKey,
              u.VersionToken AS versionToken,
              original.DocumentId AS documentId
         FROM paws.vAfcRecordUnified u
         INNER JOIN paws.Faculty f ON f.FacultyId = u.FacultyId
         LEFT JOIN paws.vAfcRecordOriginal original ON u.SourceKind=N'manual' AND original.AfcRecordId=u.AfcRecordId AND original.FacultyId=u.FacultyId
         ${whereClause}
         ORDER BY u.StartDate DESC, f.DisplayName, u.AfcRecordId`,
        params
      );
      return rows.map(row => ({
        afcRecordId: row.afcRecordId,
        facultyId: row.facultyId,
        facultyName: toText(row.facultyName),
        startDate: toText(row.startDate),
        endDate: toText(row.endDate),
        reasonCode: toText(row.reasonCode),
        reason: toText(row.reason),
        notes: toText(row.notes),
        legacyPurpose: toText(row.legacyPurpose),
        active: toBool(row.active),
        sourceKind: toText(row.sourceKind),
        createdAtUtc: row.createdAtUtc || null,
        createdByName: toText(row.createdByName),
        recordKey: toText(row.recordKey),
        versionToken: toText(row.versionToken),documentId:row.documentId||null
      }));
    },

    // -------------------------------------------------------------- facultyById
    // Full single-faculty detail. Inactive records are available only when the
    // caller has already been authorized as an administrator.
    //
    // The six required sections are returned as siblings of `faculty`, never
    // nested inside it.
    async facultyById({ facultyId, academicYear: year, includeInactive = false } = {}) {
      if (!isUuid(facultyId)) return null;
      const resolvedYear = resolveAcademicYear(year);

      const rows = await db.query(
        `SELECT
             f.FacultyId AS facultyId,
             f.RecordType AS recordType,
             f.PreferredFirstName AS preferredFirstName,
             f.PreferredLastName AS preferredLastName,
             ${facultyDisplayNameSql()} AS displayName,
             f.Ucid AS ucid,
             f.Email AS email,
             f.Stream AS stream,
             f.Rank AS rank,
             f.Fte AS fte,
             f.DisplayName AS storedDisplayName,
             f.HrName AS hrName,
             f.HrNameSource AS hrNameSource,
             f.FteSourceReference AS fteSourceReference,
             f.FteSourceRow AS fteSourceRow,
             f.FteSourceUpdatedAtUtc AS fteSourceUpdatedAtUtc,
             f.ReportsToFacultyId AS reportsToFacultyId,
             ${facultyDisplayNameSql('manager')} AS reportsToName,
             f.Active AS active,
             CONVERT(varchar(33), f.UpdatedAtUtc, 126) + 'Z' AS updatedAtUtc
         FROM paws.Faculty f
         LEFT JOIN paws.Faculty manager ON manager.FacultyId = f.ReportsToFacultyId
         WHERE f.FacultyId = @facultyId
           AND (@includeInactive = 1 OR f.Active = 1)`,
        { facultyId, includeInactive: includeInactive ? 1 : 0 }
      );

      const record = rows[0];
      if (!record) return null;

      const [profileRows, jointRows, roleRows, afcRows, assignmentRows, contractTargetRows, contractAllocationRows, doeRuleRows, linkedRows] = await Promise.all([
        // ---------------------------------------------------- professional profile
        db.query(
          `SELECT
               p.TeachingArea AS teachingArea,
               p.ProfessionalCategory AS professionalCategory,
               CONVERT(varchar(10), p.ServiceDate, 23) AS serviceDate,
               p.PriorYearsExperience AS priorYearsExperience,
               p.DvmEarnedDate AS dvmEarnedDate,
               p.DvmType AS dvmType,
               p.MastersEarnedDate AS mastersEarnedDate,
               p.MastersArea AS mastersArea,
               p.PhdEarnedDate AS phdEarnedDate,
               p.PhdArea AS phdArea,
               p.BoardCertifiedDate AS boardCertifiedDate,
               p.BoardCertification AS boardCertification,
               p.BoardCertificationCount AS boardCertificationCount,
               p.AbvmaLicenseNumber AS abvmaLicenseNumber,
               p.AbvmaMemberType AS abvmaMemberType,
               CONVERT(varchar(18), CONVERT(varbinary(8), p.ProfileVersion), 1) AS profileVersion
           FROM paws.FacultyProfessionalProfile p
           WHERE p.FacultyId = @facultyId`,
          { facultyId }
        ),
        // ----------------------------------------------------- joint appointments
        db.query(
          `SELECT
               j.JointAppointmentId AS jointAppointmentId,
               j.HomeFaculty AS homeFaculty,
               j.JointFaculty AS jointFaculty,
               j.FteUcvm AS fteUcvm,
               j.FteOtherFaculty AS fteOtherFaculty,
               CONVERT(varchar(10), j.ExpiryDate, 23) AS expiryDate,
               j.Notes AS notes
           FROM paws.JointAppointment j
           WHERE j.FacultyId = @facultyId
           ORDER BY j.JointAppointmentId`,
          { facultyId }
        ),
        // -------------------------------------------------------- role assignments
        db.query(
          `SELECT
               r.RoleAssignmentId AS roleAssignmentId,
               rs.PeriodsJson AS validityPeriodsJson, CONVERT(varchar(18),CONVERT(varbinary(8),rs.ScheduleVersion),1) AS scheduleVersion,
               r.FacultyResolutionStatus AS facultyResolutionStatus,
               r.AcademicYear AS academicYear,
               r.RoleCategory AS roleCategory,
               r.RoleType AS roleType,
               r.CourseOrSubjectOrRotation AS courseOrSubjectOrRotation,
               r.CourseName AS courseName,
               r.Details AS details,
               CONVERT(varchar(10), r.EffectiveDate, 23) AS effectiveDate,
               CONVERT(varchar(10), r.ExpirationDate, 23) AS expirationDate,
               (SELECT e.AllocationStatus FROM paws.vMasterRoleFacts e WHERE e.RoleAssignmentId=r.RoleAssignmentId) AS sourceAllocationStatus,
              r.DoeMappedValue AS doeMappedValue,
               r.DoeOverrideValue AS doeOverrideValue,
               r.DoeOverrideReason AS doeOverrideReason,
               r.SpecialNotes AS specialNotes
           FROM paws.RoleAssignment r LEFT JOIN paws.RoleAppointmentSchedule rs ON rs.RoleAssignmentId=r.RoleAssignmentId
           WHERE r.FacultyId = @facultyId
             AND r.AcademicYear = @academicYear
           UNION ALL
           SELECT m.AssignmentId,NULL,NULL,N'manual_adjustment',m.AcademicYear,N'Manual DOE adjustment',m.RoleType,
                  m.ScopeText,COALESCE(m.CourseCode,m.SubjectKey),N'Negotiated manual adjustment (additive)',
                  NULL,NULL,NULL,m.DoeValue,NULL,NULL,m.Notes
             FROM paws.ManualDoeAssignment m WHERE m.FacultyId=@facultyId AND m.AcademicYear=@academicYear AND m.Active=1
           ORDER BY roleCategory, roleType, roleAssignmentId`,
          { facultyId, academicYear: resolvedYear }
        ),
        // ------------------------------------------------------------ AFC records
        db.query(
          `SELECT
               a.AfcRecordId AS afcRecordId,
               CONVERT(varchar(10), a.StartDate, 23) AS startDate,
               CONVERT(varchar(10), a.EndDate, 23) AS endDate,
               a.ReasonCode AS reasonCode,
               a.ReasonDisplay AS reason,
               a.Notes AS notes,
               a.LegacyPurpose AS legacyPurpose,
               a.Active AS active,
               a.SourceKind AS sourceKind,
               a.CreatedAtUtc AS createdAtUtc,
               a.CreatedByName AS createdByName,
               a.RecordKey AS recordKey,
               original.DocumentId AS documentId
           FROM paws.vAfcRecordUnified a
           LEFT JOIN paws.vAfcRecordOriginal original ON a.SourceKind=N'manual' AND original.AfcRecordId=a.AfcRecordId AND original.FacultyId=a.FacultyId
           WHERE a.FacultyId = @facultyId
           ORDER BY a.StartDate DESC, a.AfcRecordId`,
          { facultyId }
        ),
        // ---------------------------------------------------- teaching assignments
        db.query(
          `SELECT
               sa.SessionAssignmentId AS sessionAssignmentId,
               c.SessionId AS sessionId,
               c.AcademicYear AS academicYear,
               c.CurriculumYear AS curriculumYear,
               c.CourseCode AS courseCode,
               c.CourseName AS courseName,
               c.Topic AS topic,
               c.SessionType AS sessionType,
               CONVERT(varchar(10), c.SessionDate, 23) AS date,
               CONVERT(varchar(8), c.StartTime, 108) AS startTime,
               CONVERT(varchar(8), c.EndTime, 108) AS endTime,
               c.Room AS room,
               sa.TeachingRole AS teachingRole,
               sa.LabLead AS labLead,
               sa.CreditedHours AS creditedHours,
               sa.DoeRate AS doeRate,
               sa.DoeQuantity AS doeQuantity,
               sa.DoeUnit AS doeUnit,
               sa.DoeCredit AS doeCredit,
               sa.DoeStatus AS doeStatus
           FROM paws.SessionAssignment sa
           INNER JOIN paws.vCalendarSession c ON c.SessionId = sa.SessionId
           WHERE sa.FacultyId = @facultyId
             AND c.AcademicYear = @academicYear
           ORDER BY c.SessionDate, c.StartTime, c.SessionId, sa.SessionAssignmentId`,
          { facultyId, academicYear: resolvedYear }
        ),
        // Contract targets are kept separate from assigned teaching DOE and
        // role DOE. The FacultyId and academic-year predicate is server-side.
        db.query(
          `SELECT t.ContractTeachingDoe AS teachingDoe,
                  t.Source AS source,
                  t.PolicyVersionId AS policyVersionId,
                  p.VersionLabel AS policyVersionLabel,
                  p.SourceReference AS sourceReference
             FROM paws.DoeFacultyTarget t
             LEFT JOIN paws.DoePolicyVersion p
               ON p.PolicyVersionId = t.PolicyVersionId
              AND p.AcademicYear = t.AcademicYear
            WHERE t.FacultyId = @facultyId
              AND t.AcademicYear = @academicYear
              AND t.Active = 1`,
          { facultyId, academicYear: resolvedYear }
        ),
        db.query(
          `SELECT a.CategoryCode AS categoryCode,
                  a.AllocationDoe AS allocationDoe,
                  a.SourceReference AS sourceReference,
                  a.PolicyVersionId AS policyVersionId
             FROM paws.DoeFacultyAllocation a
            WHERE a.FacultyId = @facultyId
              AND a.AcademicYear = @academicYear
              AND a.Active = 1
            ORDER BY a.CategoryCode, a.DoeFacultyAllocationId`,
          { facultyId, academicYear: resolvedYear }
        ),
        db.query(
          `SELECT r.DoeRuleSeedId AS doeRuleId,
                  JSON_VALUE(r.RawJson, '$.ruleCode') AS ruleCode,
                  r.Category AS category,
                  r.RuleLabel AS ruleLabel,
                  r.AcademicYearOrStage AS academicYearOrStage,
                  r.RateOrTierPct AS rateOrTierPct,
                  r.Basis AS basis,
                  r.RequiredInput AS requiredInput,
                  r.CalculationOrNote AS calculationOrNote,
                  COALESCE(NULLIF(r.SourceUrl, N''), p.SourceReference) AS sourceReference,
                  r.PolicyVersionId AS policyVersionId,
                  p.AcademicYear AS academicYear,
                  p.VersionLabel AS policyVersionLabel
             FROM paws.DoeRuleSeed r
             INNER JOIN paws.DoePolicyVersion p ON p.PolicyVersionId = r.PolicyVersionId
            WHERE p.AcademicYear = @academicYear
              AND (p.Active = 1 OR (
                NOT EXISTS (SELECT 1 FROM paws.DoeRuleSeed activeSeed
                  JOIN paws.DoePolicyVersion activeVersion ON activeVersion.PolicyVersionId=activeSeed.PolicyVersionId
                  WHERE activeVersion.AcademicYear=@academicYear AND activeVersion.Active=1)
                AND p.PolicyVersionId=(SELECT TOP(1) evidenceVersion.PolicyVersionId FROM paws.DoePolicyVersion evidenceVersion
                  WHERE evidenceVersion.AcademicYear=@academicYear
                    AND EXISTS (SELECT 1 FROM paws.DoeRuleSeed evidenceSeed WHERE evidenceSeed.PolicyVersionId=evidenceVersion.PolicyVersionId)
                  ORDER BY evidenceVersion.CreatedAtUtc DESC, evidenceVersion.PolicyVersionId)
              ))
            ORDER BY r.Category, r.SourceRow, r.DoeRuleSeedId`,
          { academicYear: resolvedYear }
        ),
        db.query(
          `SELECT
              (SELECT COUNT_BIG(*) FROM paws.UserProfile u WHERE u.FacultyId=@facultyId AND u.Active=1) AS activeUserProfileCount,
              (SELECT COUNT_BIG(*) FROM paws.SessionAssignment sa JOIN paws.vCalendarSession s ON s.SessionId=sa.SessionId
                WHERE sa.FacultyId=@facultyId AND s.AcademicYear=@academicYear AND s.SessionDate>=CONVERT(date,SYSUTCDATETIME())) AS currentTeachingSessionCount,
              (SELECT COUNT_BIG(*) FROM paws.RoleAssignment ra WHERE ra.FacultyId=@facultyId
                AND (ra.EffectiveDate IS NULL OR ra.EffectiveDate<=CONVERT(date,SYSUTCDATETIME()))
                AND (ra.ExpirationDate IS NULL OR CONVERT(date,SYSUTCDATETIME())<ra.ExpirationDate)) AS currentRoleCount,
              (SELECT COUNT_BIG(*) FROM paws.TeachingResponsibilityAssignee a
                WHERE a.FacultyId=@facultyId AND a.AcademicYear=@academicYear
                  AND a.ActiveDate<=CONVERT(date,SYSUTCDATETIME())
                  AND (a.ExpirationDate IS NULL OR CONVERT(date,SYSUTCDATETIME())<a.ExpirationDate)) AS currentTeachingResponsibilityCount`,
          { facultyId, academicYear: resolvedYear }
        )
      ]);

      const profile = profileRows[0] || null;
      const teachingAssignments = assignmentRows.map(row => {
        const assignment = {
          sessionAssignmentId: row.sessionAssignmentId,
          sessionId: row.sessionId,
          academicYear: toText(row.academicYear),
          curriculumYear: toText(row.curriculumYear),
          courseCode: toText(row.courseCode),
          courseName: toText(row.courseName),
          topic: toText(row.topic),
          sessionType: toText(row.sessionType),
          date: toText(row.date),
          startTime: toText(row.startTime),
          endTime: toText(row.endTime),
          room: toText(row.room),
          teachingRole: toText(row.teachingRole),
          labLead: toText(row.labLead),
          creditedHours: toNumber(row.creditedHours),
          doeRate: toNumber(row.doeRate),
          doeQuantity: toNumber(row.doeQuantity),
          doeUnit: toText(row.doeUnit),
          doeCredit: toNumber(row.doeCredit),
          doeStatus: toText(row.doeStatus)
        };
        const doe = resolveTeachingDoe(assignment);
        return {
          ...assignment,
          doeApplicable: doe.applicable,
          calculatedDoeCredit: doe.calculatedDoe,
          effectiveDoeCredit: doe.effectiveDoe,
          doeCalculationStatus: doe.status,
          doeReviewReason: doe.reviewReason,
          doeRuleCode: doe.ruleCode || null,
          doeCalculatorSource: doe.calculatorSource || null,
          doeSource: doe.source
        };
      });

      const checkNeeded = teachingAssignments.filter(assignment => {
        const start = assignment.startTime;
        const end = assignment.endTime;
        if (!start || !end) return true;
        if (start < GRID_START) return true;
        return end <= start;
      }).length;

      return {
        faculty: {
          facultyId: record.facultyId,
          recordType: toText(record.recordType),
          preferredFirstName: toText(record.preferredFirstName),
          preferredLastName: toText(record.preferredLastName),
          displayName: toText(record.displayName),
          storedDisplayName: toText(record.storedDisplayName),
          hrName: toText(record.hrName),
          hrNameSource: toText(record.hrNameSource),
          ucid: toText(record.ucid),
          email: toText(record.email),
          stream: toText(record.stream),
          rank: toText(record.rank),
          fte: toNumber(record.fte),
          fteSourceReference: toText(record.fteSourceReference),
          fteSourceRow: toNumber(record.fteSourceRow),
          fteSourceUpdatedAtUtc: record.fteSourceUpdatedAtUtc || null,
          reportsToFacultyId: toText(record.reportsToFacultyId),
          reportsToName: toText(record.reportsToName),
          active: toBool(record.active),
          updatedAtUtc: toText(record.updatedAtUtc)
        },
        academicYear: resolvedYear,
        professionalProfile: profile
          ? {
              teachingArea: toText(profile.teachingArea),
              professionalCategory: toText(profile.professionalCategory),
              serviceDate: toText(profile.serviceDate),
              priorYearsExperience: toNumber(profile.priorYearsExperience),
              dvmEarnedDate: toText(profile.dvmEarnedDate),
              dvmType: toText(profile.dvmType),
              mastersEarnedDate: toText(profile.mastersEarnedDate),
              mastersArea: toText(profile.mastersArea),
              phdEarnedDate: toText(profile.phdEarnedDate),
              phdArea: toText(profile.phdArea),
              boardCertifiedDate: toText(profile.boardCertifiedDate),
              boardCertification: toText(profile.boardCertification),
              boardCertificationCount: toNumber(profile.boardCertificationCount),
              abvmaLicenseNumber: toText(profile.abvmaLicenseNumber),
              abvmaMemberType: toText(profile.abvmaMemberType),
              profileVersion: toText(profile.profileVersion)
            }
          : null,
        jointAppointments: jointRows.map(row => ({
          jointAppointmentId: row.jointAppointmentId,
          homeFaculty: toText(row.homeFaculty),
          jointFaculty: toText(row.jointFaculty),
          fteUcvm: toNumber(row.fteUcvm),
          fteOtherFaculty: toNumber(row.fteOtherFaculty),
          expiryDate: toText(row.expiryDate),
          notes: toText(row.notes)
        })),
        roles: roleRows.map(row => {
          const role = {
            roleAssignmentId: row.roleAssignmentId,
            validityPeriods: row.validityPeriodsJson == null ? null : JSON.parse(row.validityPeriodsJson),
            scheduleVersion: toText(row.scheduleVersion),
            facultyResolutionStatus: toText(row.facultyResolutionStatus),
            academicYear: toText(row.academicYear),
            roleCategory: toText(row.roleCategory),
            roleType: toText(row.roleType),
            courseOrSubjectOrRotation: toText(row.courseOrSubjectOrRotation),
            courseName: toText(row.courseName),
            details: toText(row.details),
            effectiveDate: toText(row.effectiveDate),
            expirationDate: toText(row.expirationDate),
            sourceAllocationStatus: toText(row.sourceAllocationStatus),
            doeMappedValue: toNumber(row.doeMappedValue),
            doeOverrideValue: toNumber(row.doeOverrideValue),
            doeOverrideReason: toText(row.doeOverrideReason),
            specialNotes: toText(row.specialNotes)
          };
          const doe = role.facultyResolutionStatus === 'manual_adjustment'
            ? { calculatedDoe: null, effectiveDoe: role.doeMappedValue, status: 'manual', source: 'manual_adjustment' }
            : resolveRoleDoe(role);
          return {
            ...role,
            calculatedDoe: doe.calculatedDoe,
            effectiveDoe: doe.effectiveDoe,
            doeCalculationStatus: doe.status,
            doeReviewReason: doe.reviewReason,
            doeRuleCode: doe.ruleCode || null,
            doeCalculatorSource: doe.calculatorSource || null,
            doeSource: doe.source,
            doeCandidates: doe.candidates || null,
            doeCandidateBasis: doe.candidateBasis || null,
            doeCourseUnits: doe.courseUnits ?? null,
            doeHiccDevelopmentApplicable: doe.hiccDevelopmentApplicable ?? null,
            doeCourseEvidenceSource: doe.courseEvidenceSource || null
          };
        }),
        afcRecords: afcRows.map(row => ({
          afcRecordId: row.afcRecordId,
          startDate: toText(row.startDate),
          endDate: toText(row.endDate),
          reasonCode: toText(row.reasonCode),
          purpose: toText(row.purpose),
          reason: toText(row.reason),
          notes: toText(row.notes),
          legacyPurpose: toText(row.legacyPurpose),
          purpose: toText(row.legacyPurpose || row.reason),
          active: toBool(row.active),
          sourceKind: toText(row.sourceKind),
          createdAtUtc: row.createdAtUtc || null,
          createdByName: toText(row.createdByName),
          recordKey: toText(row.recordKey),documentId:row.documentId||null
        })),
        contractDoe: {
          academicYear: resolvedYear,
          teachingDoe: contractTargetRows.length ? toNumber(contractTargetRows[0].teachingDoe) : null,
          source: toText(contractTargetRows[0]?.source),
          policyVersionId: toText(contractTargetRows[0]?.policyVersionId || contractAllocationRows[0]?.policyVersionId),
          policyVersionLabel: toText(contractTargetRows[0]?.policyVersionLabel),
          sourceReference: toText(contractTargetRows[0]?.sourceReference || contractAllocationRows[0]?.sourceReference),
          allocations: contractAllocationRows.map(row => ({
            categoryCode: toText(row.categoryCode),
            allocationDoe: toNumber(row.allocationDoe),
            sourceReference: toText(row.sourceReference)
          }))
        },
        doeRuleBook: {
          academicYear: toText(doeRuleRows[0]?.academicYear || resolvedYear),
          policyVersionId: toText(doeRuleRows[0]?.policyVersionId),
          policyVersionLabel: toText(doeRuleRows[0]?.policyVersionLabel),
          sourceReference: toText(doeRuleRows[0]?.sourceReference),
          rules: doeRuleRows.map(row => ({
            doeRuleId: toText(row.doeRuleId),
            ruleCode: toText(row.ruleCode),
            category: toText(row.category),
            ruleLabel: toText(row.ruleLabel),
            academicYearOrStage: toText(row.academicYearOrStage),
            rateOrTierPct: toText(row.rateOrTierPct),
            basis: toText(row.basis),
            requiredInput: toText(row.requiredInput),
            calculationOrNote: toText(row.calculationOrNote),
            sourceReference: toText(row.sourceReference)
          }))
        },
        teachingAssignments,
        sessionCount: teachingAssignments.length,
        checkNeededCount: checkNeeded,
        linkedRecords: {
          activeUserProfileCount: toInt(linkedRows[0]?.activeUserProfileCount),
          currentTeachingSessionCount: toInt(linkedRows[0]?.currentTeachingSessionCount),
          currentRoleCount: toInt(linkedRows[0]?.currentRoleCount),
          currentTeachingResponsibilityCount: toInt(linkedRows[0]?.currentTeachingResponsibilityCount)
        }
      };
    },

    // ------------------------------------------------------- teaching summary
    // One server-side aggregation for the admin Teaching Summary tab. This
    // deliberately uses separate CTEs for assignments and roles so a faculty
    // member's DOE lines are never multiplied by a cross-join.
    async teachingSummary({ academicYear: year } = {}) {
      const resolvedYear = resolveAcademicYear(year);
      const doeParams = {
        academicYear: resolvedYear,
        doeNa0: DOE_NON_CREDIT_SESSION_TYPES[0],
        doeNa1: DOE_NON_CREDIT_SESSION_TYPES[1]
      };
      const rows = await db.query(
        `WITH teaching AS (
           SELECT sa.FacultyId,
                  SUM(sa.DoeCredit) AS assignedTeachingDoe,
                  SUM(CASE WHEN c.SessionType IS NULL OR c.SessionType NOT IN (@doeNa0, @doeNa1) THEN 1 ELSE 0 END) AS teachingLineCount,
                  SUM(CASE WHEN (c.SessionType IS NULL OR c.SessionType NOT IN (@doeNa0, @doeNa1)) AND sa.DoeCredit IS NOT NULL THEN 1 ELSE 0 END) AS teachingRecordedCount,
                  SUM(CASE WHEN (c.SessionType IS NULL OR c.SessionType NOT IN (@doeNa0, @doeNa1)) AND sa.DoeCredit IS NULL THEN 1 ELSE 0 END) AS teachingMissingCount,
                  SUM(CASE WHEN c.SessionType IN (@doeNa0, @doeNa1) THEN 1 ELSE 0 END) AS teachingNotApplicableCount,
                  SUM(CASE WHEN TRY_CONVERT(int, c.CurriculumYear) = 1 OR CONVERT(varchar(20), c.CurriculumYear) = 'Year 1' THEN 1 ELSE 0 END) AS year1Assignments,
                  SUM(CASE WHEN TRY_CONVERT(int, c.CurriculumYear) = 2 OR CONVERT(varchar(20), c.CurriculumYear) = 'Year 2' THEN 1 ELSE 0 END) AS year2Assignments,
                  SUM(CASE WHEN TRY_CONVERT(int, c.CurriculumYear) = 3 OR CONVERT(varchar(20), c.CurriculumYear) = 'Year 3' THEN 1 ELSE 0 END) AS year3Assignments,
                  SUM(CASE WHEN TRY_CONVERT(int, c.CurriculumYear) = 4 OR CONVERT(varchar(20), c.CurriculumYear) = 'Year 4' THEN 1 ELSE 0 END) AS year4Assignments,
                  SUM(CASE WHEN sa.CreditedHours IS NOT NULL THEN sa.CreditedHours ELSE 0 END) AS creditedHours,
                  COUNT(DISTINCT c.CourseCode) AS courseCount,
                  COUNT(DISTINCT c.SessionId) AS sessionCount
             FROM paws.SessionAssignment sa
             INNER JOIN paws.vCalendarSession c ON c.SessionId = sa.SessionId
            WHERE c.AcademicYear = @academicYear
            GROUP BY sa.FacultyId
         ), roles AS (
           SELECT r.FacultyId,
                  SUM(COALESCE(r.DoeOverrideValue, r.DoeMappedValue)) AS roleDoe,
                  COUNT(r.RoleAssignmentId) AS roleLineCount,
                  SUM(CASE WHEN COALESCE(r.DoeOverrideValue, r.DoeMappedValue) IS NOT NULL THEN 1 ELSE 0 END) AS roleRecordedCount,
                  SUM(CASE WHEN COALESCE(r.DoeOverrideValue, r.DoeMappedValue) IS NULL THEN 1 ELSE 0 END) AS roleMissingCount
             FROM (
               SELECT r.FacultyId,r.RoleAssignmentId,r.AcademicYear,r.DoeOverrideValue,r.DoeMappedValue
                 FROM paws.RoleAssignment r WHERE r.AcademicYear=@academicYear
               UNION ALL
               SELECT m.FacultyId,m.AssignmentId,m.AcademicYear,NULL,m.DoeValue
                 FROM paws.ManualDoeAssignment m WHERE m.AcademicYear=@academicYear AND m.Active=1
             ) r
            WHERE r.AcademicYear = @academicYear
            GROUP BY r.FacultyId
         )
         SELECT f.FacultyId AS facultyId,
                ${facultyDisplayNameSql()} AS displayName,
                CASE WHEN COALESCE(t.teachingLineCount, 0) = 0 THEN 0 ELSE t.assignedTeachingDoe END AS assignedTeachingDoe,
                CASE WHEN COALESCE(r.roleLineCount, 0) = 0 THEN 0 ELSE r.roleDoe END AS roleDoe,
                CASE
                  WHEN COALESCE(t.teachingLineCount, 0) + COALESCE(r.roleLineCount, 0) = 0 THEN 0
                  WHEN COALESCE(t.teachingRecordedCount, 0) + COALESCE(r.roleRecordedCount, 0) = 0 THEN NULL
                  ELSE COALESCE(t.assignedTeachingDoe, 0) + COALESCE(r.roleDoe, 0)
                END AS recordedDoeTotal,
                COALESCE(t.teachingLineCount, 0) AS teachingLineCount,
                COALESCE(t.teachingRecordedCount, 0) AS teachingRecordedCount,
                COALESCE(t.teachingMissingCount, 0) AS teachingMissingCount,
                COALESCE(t.teachingNotApplicableCount, 0) AS teachingNotApplicableCount,
                COALESCE(r.roleLineCount, 0) AS roleLineCount,
                COALESCE(r.roleRecordedCount, 0) AS roleRecordedCount,
                COALESCE(r.roleMissingCount, 0) AS roleMissingCount,
                CASE WHEN COALESCE(t.teachingMissingCount, 0) + COALESCE(r.roleMissingCount, 0) = 0 THEN 1 ELSE 0 END AS doeComplete,
                COALESCE(t.year1Assignments, 0) AS year1Assignments,
                COALESCE(t.year2Assignments, 0) AS year2Assignments,
                COALESCE(t.year3Assignments, 0) AS year3Assignments,
                COALESCE(t.year4Assignments, 0) AS year4Assignments,
                COALESCE(t.creditedHours, 0) AS creditedHours,
                COALESCE(t.courseCount, 0) AS courseCount,
                COALESCE(t.sessionCount, 0) AS sessionCount
           FROM paws.Faculty f
           LEFT JOIN teaching t ON t.FacultyId = f.FacultyId
           LEFT JOIN roles r ON r.FacultyId = f.FacultyId
          WHERE f.Active = 1
          ORDER BY f.DisplayName, f.FacultyId`,
        doeParams
      );
      const gaps = await calculateDoeGapSummary(db, resolvedYear);
      return rows.map(row => {
        const facultyKey = String(row.facultyId);
        const teachingGap = gaps.teachingByFaculty.get(facultyKey) || emptyDoeGapBucket();
        const roleGap = gaps.roleByFaculty.get(facultyKey) || emptyDoeGapBucket();
        const teachingLineCount = toInt(row.teachingLineCount);
        const roleLineCount = toInt(row.roleLineCount);
        const teachingRecordedCount = toInt(row.teachingRecordedCount);
        const roleRecordedCount = toInt(row.roleRecordedCount);
        const teachingCalculatedCount = teachingGap.calculatedCount;
        const roleCalculatedCount = roleGap.calculatedCount;
        const teachingResolvedCount = teachingRecordedCount + teachingCalculatedCount;
        const roleResolvedCount = roleRecordedCount + roleCalculatedCount;
        const teachingMissingCount = Math.max(0, toInt(row.teachingMissingCount) - teachingCalculatedCount);
        const roleMissingCount = Math.max(0, toInt(row.roleMissingCount) - roleCalculatedCount);
        const recordedTeachingDoe = toNumber(row.assignedTeachingDoe);
        const recordedRoleDoe = toNumber(row.roleDoe);
        const assignedTeachingDoe = effectiveDoeSum(recordedTeachingDoe, teachingGap.calculatedDoe, teachingResolvedCount, teachingLineCount);
        const roleDoe = effectiveDoeSum(recordedRoleDoe, roleGap.calculatedDoe, roleResolvedCount, roleLineCount);
        const effectiveResolvedCount = teachingResolvedCount + roleResolvedCount;
        const effectiveDoeTotal = teachingLineCount + roleLineCount === 0
          ? 0
          : effectiveResolvedCount === 0
            ? null
            : (assignedTeachingDoe || 0) + (roleDoe || 0);
        return {
          facultyId: row.facultyId,
          displayName: toText(row.displayName),
          recordedTeachingDoe,
          assignedTeachingDoe,
          recordedRoleDoe,
          roleDoe,
          recordedDoeTotal: toNumber(row.recordedDoeTotal),
          effectiveDoeTotal,
          teachingLineCount,
          teachingRecordedCount,
          teachingCalculatedCount,
          teachingResolvedCount,
          teachingMissingCount,
          teachingNotApplicableCount: toInt(row.teachingNotApplicableCount),
          roleLineCount,
          roleRecordedCount,
          roleCalculatedCount,
          roleResolvedCount,
          roleMissingCount,
          doeComplete: teachingMissingCount + roleMissingCount === 0,
          year1Assignments: toInt(row.year1Assignments),
          year2Assignments: toInt(row.year2Assignments),
          year3Assignments: toInt(row.year3Assignments),
          year4Assignments: toInt(row.year4Assignments),
          creditedHours: toNumber(row.creditedHours),
          courseCount: toInt(row.courseCount),
          sessionCount: toInt(row.sessionCount)
        };
      });
    },

    // --------------------------------------------------------------- roles
    // Read-only role aggregate for the administrator Roles & Appointments tab.
    async roles({ academicYear: year } = {}) {
      const resolvedYear = resolveAcademicYear(year);
      const rows = await db.query(
        `SELECT f.FacultyId AS facultyId,
                ${facultyDisplayNameSql()} AS displayName,
                r.RoleAssignmentId AS roleAssignmentId,
                rs.PeriodsJson AS validityPeriodsJson, CONVERT(varchar(18),CONVERT(varbinary(8),rs.ScheduleVersion),1) AS scheduleVersion,
                r.FacultyResolutionStatus AS facultyResolutionStatus,
                r.AcademicYear AS academicYear,
                r.RoleCategory AS roleCategory,
                r.RoleType AS roleType,
                r.CourseOrSubjectOrRotation AS courseOrSubjectOrRotation,
                r.CourseName AS courseName,
                r.Details AS details,
                CONVERT(varchar(10), r.EffectiveDate, 23) AS effectiveDate,
                CONVERT(varchar(10), r.ExpirationDate, 23) AS expirationDate,
                (SELECT e.AllocationStatus FROM paws.vMasterRoleFacts e WHERE e.RoleAssignmentId=r.RoleAssignmentId) AS sourceAllocationStatus,
              r.DoeMappedValue AS doeMappedValue,
                r.DoeOverrideValue AS doeOverrideValue,
                r.DoeOverrideReason AS doeOverrideReason,
                r.SpecialNotes AS specialNotes
           FROM paws.RoleAssignment r LEFT JOIN paws.RoleAppointmentSchedule rs ON rs.RoleAssignmentId=r.RoleAssignmentId
           INNER JOIN paws.Faculty f ON f.FacultyId = r.FacultyId
          WHERE r.AcademicYear = @academicYear
            AND f.Active = 1
          UNION ALL
          SELECT f.FacultyId,${facultyDisplayNameSql()},m.AssignmentId,NULL,NULL,N'manual_adjustment',m.AcademicYear,
                 N'Manual DOE adjustment',m.RoleType,m.ScopeText,COALESCE(m.CourseCode,m.SubjectKey),
                 N'Negotiated manual adjustment (additive)',NULL,NULL,NULL,m.DoeValue,NULL,NULL,m.Notes
            FROM paws.ManualDoeAssignment m
            INNER JOIN paws.Faculty f ON f.FacultyId=m.FacultyId
           WHERE m.AcademicYear=@academicYear AND m.Active=1 AND f.Active=1
          ORDER BY displayName, roleType, roleAssignmentId`,
        { academicYear: resolvedYear }
      );
      return rows.map(row => {
        const role = {
          facultyId: row.facultyId,
          displayName: toText(row.displayName),
          roleAssignmentId: row.roleAssignmentId,
          validityPeriods: row.validityPeriodsJson == null ? null : JSON.parse(row.validityPeriodsJson),
          scheduleVersion: toText(row.scheduleVersion),
          facultyResolutionStatus: toText(row.facultyResolutionStatus),
          academicYear: toText(row.academicYear),
          roleCategory: toText(row.roleCategory),
          roleType: toText(row.roleType),
          courseOrSubjectOrRotation: toText(row.courseOrSubjectOrRotation),
          courseName: toText(row.courseName),
          details: toText(row.details),
          effectiveDate: toText(row.effectiveDate),
          expirationDate: toText(row.expirationDate),
          sourceAllocationStatus: toText(row.sourceAllocationStatus),
            doeMappedValue: toNumber(row.doeMappedValue),
          doeOverrideValue: toNumber(row.doeOverrideValue),
          doeOverrideReason: toText(row.doeOverrideReason),
          specialNotes: toText(row.specialNotes)
        };
        const doe = role.facultyResolutionStatus === 'manual_adjustment'
          ? { calculatedDoe: null, effectiveDoe: role.doeMappedValue, status: 'manual', source: 'manual_adjustment' }
          : resolveRoleDoe(role);
        return {
          ...role,
          calculatedDoe: doe.calculatedDoe,
          effectiveDoe: doe.effectiveDoe,
          doeCalculationStatus: doe.status,
          doeReviewReason: doe.reviewReason,
          doeRuleCode: doe.ruleCode || null,
          doeCalculatorSource: doe.calculatorSource || null,
          doeSource: doe.source,
          doeCandidates: doe.candidates || null,
          doeCandidateBasis: doe.candidateBasis || null,
          doeCourseUnits: doe.courseUnits ?? null,
          doeHiccDevelopmentApplicable: doe.hiccDevelopmentApplicable ?? null,
          doeCourseEvidenceSource: doe.courseEvidenceSource || null
        };
      });
    },

    // ---------------------------------------------------------- DOE overview
    async doeOverview({ academicYear: year } = {}) {
      const resolvedYear = resolveAcademicYear(year);
      const doeOverviewParams = {
        academicYear: resolvedYear,
        doeNa0: DOE_NON_CREDIT_SESSION_TYPES[0],
        doeNa1: DOE_NON_CREDIT_SESSION_TYPES[1]
      };
      const [rows, contractRows, allocationRows, gaps] = await Promise.all([db.query(
        `WITH teaching AS (
           SELECT sa.DoeCredit
             FROM paws.SessionAssignment sa
             INNER JOIN paws.vCalendarSession c ON c.SessionId = sa.SessionId
            WHERE c.AcademicYear = @academicYear
         ), roles AS (
           SELECT r.RoleAssignmentId,r.DoeMappedValue, r.DoeOverrideValue,r.AcademicYear
             FROM paws.RoleAssignment r
            WHERE r.AcademicYear = @academicYear
           UNION ALL SELECT m.AssignmentId,m.DoeValue,NULL,m.AcademicYear FROM paws.ManualDoeAssignment m WHERE m.AcademicYear=@academicYear AND m.Active=1
         )
         SELECT
           (SELECT COUNT(sa.SessionAssignmentId) FROM paws.SessionAssignment sa INNER JOIN paws.vCalendarSession c ON c.SessionId = sa.SessionId WHERE c.AcademicYear = @academicYear AND (c.SessionType IS NULL OR c.SessionType NOT IN (@doeNa0, @doeNa1))) AS teachingLineCount,
           (SELECT COUNT(sa.SessionAssignmentId) FROM paws.SessionAssignment sa INNER JOIN paws.vCalendarSession c ON c.SessionId = sa.SessionId WHERE c.AcademicYear = @academicYear AND (c.SessionType IS NULL OR c.SessionType NOT IN (@doeNa0, @doeNa1)) AND sa.DoeCredit IS NULL) AS teachingMissingCount,
           (SELECT COUNT(sa.SessionAssignmentId) FROM paws.SessionAssignment sa INNER JOIN paws.vCalendarSession c ON c.SessionId = sa.SessionId WHERE c.AcademicYear = @academicYear AND c.SessionType IN (@doeNa0, @doeNa1)) AS teachingNotApplicableCount,
           (SELECT SUM(sa.DoeCredit) FROM paws.SessionAssignment sa INNER JOIN paws.vCalendarSession c ON c.SessionId = sa.SessionId WHERE c.AcademicYear = @academicYear AND (c.SessionType IS NULL OR c.SessionType NOT IN (@doeNa0, @doeNa1))) AS teachingDoe,
           (SELECT COUNT(sa.SessionAssignmentId) FROM paws.SessionAssignment sa INNER JOIN paws.vCalendarSession c ON c.SessionId = sa.SessionId WHERE c.AcademicYear = @academicYear AND (c.SessionType IS NULL OR c.SessionType NOT IN (@doeNa0, @doeNa1)) AND sa.DoeCredit IS NOT NULL) AS teachingRecordedCount,
           (SELECT COUNT(r.RoleAssignmentId) FROM roles r WHERE r.AcademicYear = @academicYear) AS roleLineCount,
           (SELECT COUNT(r.RoleAssignmentId) FROM roles r WHERE r.AcademicYear = @academicYear AND r.DoeMappedValue IS NULL AND r.DoeOverrideValue IS NULL) AS roleMissingCount,
           (SELECT SUM(COALESCE(r.DoeOverrideValue, r.DoeMappedValue)) FROM roles r WHERE r.AcademicYear = @academicYear) AS roleDoe,
           (SELECT COUNT(r.RoleAssignmentId) FROM roles r WHERE r.AcademicYear = @academicYear AND COALESCE(r.DoeOverrideValue, r.DoeMappedValue) IS NOT NULL) AS roleRecordedCount,
           (SELECT COUNT(r.RoleAssignmentId) FROM roles r WHERE r.AcademicYear = @academicYear AND r.DoeOverrideValue IS NOT NULL) AS overrideCount,
           (SELECT COUNT(r.RoleAssignmentId) FROM roles r WHERE r.AcademicYear = @academicYear AND r.DoeOverrideValue = 0) AS overrideZeroCount,
           (SELECT COUNT(r.RoleAssignmentId) FROM roles r WHERE r.AcademicYear = @academicYear AND r.DoeOverrideValue < 0) AS overrideNegativeCount`,
        doeOverviewParams
      ), db.query(
        `SELECT COUNT(f.FacultyId) AS activeFacultyCount,
                COUNT(t.DoeFacultyTargetId) AS teachingTargetCount
           FROM paws.Faculty f
           LEFT JOIN paws.DoeFacultyTarget t
             ON t.FacultyId = f.FacultyId
            AND t.AcademicYear = @academicYear
            AND t.Active = 1
            AND t.ContractTeachingDoe IS NOT NULL
          WHERE f.Active = 1`,
        { academicYear: resolvedYear }
      ), db.query(
        `SELECT a.CategoryCode AS categoryCode,
                COUNT(a.DoeFacultyAllocationId) AS allocationRowCount,
                COUNT(DISTINCT a.FacultyId) AS facultyCount
           FROM paws.DoeFacultyAllocation a
          WHERE a.AcademicYear = @academicYear
            AND a.Active = 1
          GROUP BY a.CategoryCode
          ORDER BY a.CategoryCode`,
        { academicYear: resolvedYear }
      ), calculateDoeGapSummary(db, resolvedYear)]);
      const row = rows[0] || {};
      const contractCoverageRow = contractRows[0] || {};
      const activeFacultyCount = toInt(contractCoverageRow.activeFacultyCount);
      const teachingTargetCount = toInt(contractCoverageRow.teachingTargetCount);
      const teachingNotApplicableCount = toInt(row.teachingNotApplicableCount);
      const teachingLineCount = toInt(row.teachingLineCount);
      const roleLineCount = toInt(row.roleLineCount);
      const teachingRecordedCount = toInt(row.teachingRecordedCount);
      const roleRecordedCount = toInt(row.roleRecordedCount);
      const teachingCalculatedCount = gaps.teachingTotal.calculatedCount;
      const roleCalculatedCount = gaps.roleTotal.calculatedCount;
      const teachingResolvedCount = teachingRecordedCount + teachingCalculatedCount;
      const roleResolvedCount = roleRecordedCount + roleCalculatedCount;
      const teachingMissingCount = Math.max(0, toInt(row.teachingMissingCount) - teachingCalculatedCount);
      const roleMissingCount = Math.max(0, toInt(row.roleMissingCount) - roleCalculatedCount);
      const recordedTeachingDoe = teachingLineCount === 0 ? 0 : toNumber(row.teachingDoe);
      const recordedRoleDoe = roleLineCount === 0 ? 0 : toNumber(row.roleDoe);
      const teachingDoe = effectiveDoeSum(recordedTeachingDoe, gaps.teachingTotal.calculatedDoe, teachingResolvedCount, teachingLineCount);
      const roleDoe = effectiveDoeSum(recordedRoleDoe, gaps.roleTotal.calculatedDoe, roleResolvedCount, roleLineCount);
      const recordedDoeTotal = teachingLineCount + roleLineCount === 0
        ? 0
        : teachingRecordedCount + roleRecordedCount === 0
          ? null
          : (recordedTeachingDoe || 0) + (recordedRoleDoe || 0);
      const effectiveDoeTotal = teachingLineCount + roleLineCount === 0
        ? 0
        : teachingResolvedCount + roleResolvedCount === 0
          ? null
          : (teachingDoe || 0) + (roleDoe || 0);
      return {
        academicYear: resolvedYear,
        contractTargetCoverage: {
          activeFacultyCount,
          teachingTargetCount,
          missingTeachingTargetCount: Math.max(0, activeFacultyCount - teachingTargetCount),
          coveragePercent: activeFacultyCount ? (teachingTargetCount / activeFacultyCount) * 100 : null,
          allocationCategories: allocationRows.map(category => ({
            categoryCode: toText(category.categoryCode),
            allocationRowCount: toInt(category.allocationRowCount),
            facultyCount: toInt(category.facultyCount)
          }))
        },
        teachingLineCount,
        teachingRecordedCount,
        teachingCalculatedCount,
        teachingResolvedCount,
        teachingMissingCount,
        teachingNotApplicableCount,
        recordedTeachingDoe,
        teachingDoe,
        roleLineCount,
        roleRecordedCount,
        roleCalculatedCount,
        roleResolvedCount,
        roleMissingCount,
        recordedRoleDoe,
        roleDoe,
        recordedDoeTotal,
        effectiveDoeTotal,
        doeStatus: teachingLineCount + roleLineCount === 0
          ? 'none'
          : teachingResolvedCount + roleResolvedCount === 0
            ? 'missing'
            : teachingMissingCount + roleMissingCount > 0 ? 'partial' : 'complete',
        overrideCount: toInt(row.overrideCount),
        overrideZeroCount: toInt(row.overrideZeroCount),
        overrideNegativeCount: toInt(row.overrideNegativeCount),
        partial: teachingMissingCount > 0 || roleMissingCount > 0
      };
    },

    // ---------------------------------------------------- vocabulary inspection
    // Read-only helper. Reports `RoleCategory` AND `RoleType` because the live
    // data proved `RoleCategory` is entirely NULL while `RoleType` carries the
    // real vocabulary — the helper must not hide that.
    async roleCategoryVocabulary() {
      const rows = await db.query(
        `SELECT DISTINCT r.RoleCategory AS roleCategory, r.RoleType AS roleType
           FROM paws.RoleAssignment r
          ORDER BY r.RoleCategory, r.RoleType`
      );
      return rows.map(row => ({
        roleCategory: toText(row.roleCategory),
        roleType: toText(row.roleType)
      }));
    }
  };
}

module.exports = {
  createSqlDashboardRepository,
  DEFAULT_ACADEMIC_YEAR,
  GRID_START,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  AFC_MAX_LIMIT,
  HICC_ROLE_TYPES,
  VISC_ROLE_TYPES,
  HICC_CATEGORY,
  VISC_CATEGORY,
  roleTypeInPredicate,
  isUuid,
  academicYear,
  boundLimit,
  boundAfcLimit,
  likePattern
};
