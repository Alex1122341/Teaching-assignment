'use strict';

const { facultyDisplayNameSql } = require('./faculty-display-name');

// Read-only source for the Teaching Schedule HICC–CC / VISC directory.
//
//   * One parameterised SELECT; no INSERT/UPDATE/DELETE/MERGE/EXEC/DDL (asserted by tests).
//   * Reads only columns granted to paws_runtime_read (017, 029, 035): RoleAssignment
//     (RoleAssignmentId, FacultyId, AcademicYear, RoleType, CourseOrSubjectOrRotation,
//     EffectiveDate, ExpirationDate), RoleAppointmentSchedule, the Faculty display-name columns and
//     Course(CourseCode). No DOE, notes, details, source or contact columns are selected.
//   * Exact RoleType values only. The historical combined label
//     'Course Coordinator / HICC (legacy ambiguous)' is deliberately not mapped.
//   * Active Faculty with a resolved FacultyId only, the same population as the administrator
//     Roles tab, for exactly one academic year.
const ROLE_TYPES = Object.freeze(['HICC', 'Course Coordinator', 'VISC']);
const MAX_ROWS = 1000;

function createSqlLeadershipDirectoryRepository(db) {
  if (typeof db?.query !== 'function') throw new TypeError('SQL query required.');
  return Object.freeze({
    async list({ academicYear }) {
      const rows = await db.query(
        `SELECT TOP (@limitPlusOne)
                LTRIM(RTRIM(r.RoleType)) AS roleType,
                NULLIF(LTRIM(RTRIM(r.CourseOrSubjectOrRotation)), N'') AS recordedScope,
                course.CourseCode AS courseCode,
                ${facultyDisplayNameSql('f')} AS facultyName,
                f.PreferredFirstName AS facultyFirstName,
                f.PreferredLastName AS facultyLastName,
                CONVERT(varchar(36), r.FacultyId) AS facultyKey,
                CONVERT(varchar(36), r.RoleAssignmentId) AS appointmentKey,
                CONVERT(varchar(10), r.EffectiveDate, 23) AS effectiveDate,
                CONVERT(varchar(10), r.ExpirationDate, 23) AS expirationDate,
                CASE WHEN rs.RoleAssignmentId IS NULL THEN 0 ELSE 1 END AS hasSchedule,
                rs.PeriodsJson AS periodsJson
           FROM paws.RoleAssignment r
          INNER JOIN paws.Faculty f ON f.FacultyId = r.FacultyId
           LEFT JOIN paws.RoleAppointmentSchedule rs ON rs.RoleAssignmentId = r.RoleAssignmentId
          OUTER APPLY (SELECT CASE WHEN COUNT(c.CourseCode) = 1 THEN MIN(c.CourseCode) END AS CourseCode
                         FROM paws.Course c
                        WHERE c.CourseCode = LTRIM(RTRIM(r.CourseOrSubjectOrRotation))) course
          WHERE r.AcademicYear = @academicYear
            AND f.Active = 1
            AND UPPER(LTRIM(RTRIM(r.RoleType))) COLLATE Latin1_General_100_BIN2 IN (UPPER(@roleType0), UPPER(@roleType1), UPPER(@roleType2))
          ORDER BY r.RoleAssignmentId`,
        { academicYear, limitPlusOne: MAX_ROWS + 1, roleType0: ROLE_TYPES[0], roleType1: ROLE_TYPES[1], roleType2: ROLE_TYPES[2] }
      );
      if (!Array.isArray(rows)) throw new Error('Invalid leadership directory SQL result.');
      if (rows.length > MAX_ROWS) throw Object.assign(new Error('Leadership directory exceeds its bounded size.'), { code: 'DIRECTORY_TOO_LARGE' });
      return rows;
    }
  });
}

module.exports = { createSqlLeadershipDirectoryRepository, ROLE_TYPES, MAX_ROWS };
