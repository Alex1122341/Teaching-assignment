/* HICC–CC / VISC directory: READ-ONLY reconciliation for ITAPPVETOPSDB01 / VetMed-Ops.
   Run as the Owner (or the PAWS runtime identity) before and after release. SELECT only;
   changes nothing. Compare with the Stage API response of
   GET /api/v1/dashboard/leadership-directory?academicYear=2026-27. */
SET NOCOUNT ON;
DECLARE @AcademicYear nvarchar(32) = N'2026-27';

-- 1. Rows per exact RoleType (directory population: active Faculty only).
SELECT LTRIM(RTRIM(r.RoleType)) AS RoleType,
       COUNT(r.RoleAssignmentId) AS AllRows,
       SUM(CASE WHEN f.Active = 1 THEN 1 ELSE 0 END) AS ActiveFacultyRows,
       SUM(CASE WHEN r.FacultyId IS NULL THEN 1 ELSE 0 END) AS UnresolvedFacultyRows,
       SUM(CASE WHEN rs.RoleAssignmentId IS NOT NULL THEN 1 ELSE 0 END) AS WithSchedule,
       SUM(CASE WHEN rs.RoleAssignmentId IS NULL AND r.EffectiveDate IS NULL AND r.ExpirationDate IS NULL THEN 1 ELSE 0 END) AS NoDatesNoSchedule,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(r.CourseOrSubjectOrRotation)), N'') IS NULL THEN 1 ELSE 0 END) AS ScopeNotRecorded
  FROM paws.RoleAssignment r
  LEFT JOIN paws.Faculty f ON f.FacultyId = r.FacultyId
  LEFT JOIN paws.RoleAppointmentSchedule rs ON rs.RoleAssignmentId = r.RoleAssignmentId
 WHERE r.AcademicYear = @AcademicYear
   AND LTRIM(RTRIM(r.RoleType)) IN (N'HICC', N'Course Coordinator', N'VISC', N'Course Coordinator / HICC (legacy ambiguous)')
 GROUP BY LTRIM(RTRIM(r.RoleType))
 ORDER BY RoleType;

-- 2. Every RoleType value present this year (to confirm nothing else should be in the lists).
SELECT LTRIM(RTRIM(RoleType)) AS RoleType, COUNT(RoleAssignmentId) AS Rows
  FROM paws.RoleAssignment WHERE AcademicYear = @AcademicYear
 GROUP BY LTRIM(RTRIM(RoleType)) ORDER BY Rows DESC;

-- 3. Scope labels that match a Course code exactly (shown as the canonical code) vs. recorded text.
SELECT LTRIM(RTRIM(r.RoleType)) AS RoleType,
       SUM(CASE WHEN c.CourseCode IS NOT NULL THEN 1 ELSE 0 END) AS CourseCodeMatched,
       SUM(CASE WHEN c.CourseCode IS NULL THEN 1 ELSE 0 END) AS RecordedScopeShown
  FROM paws.RoleAssignment r
  INNER JOIN paws.Faculty f ON f.FacultyId = r.FacultyId AND f.Active = 1
  OUTER APPLY (SELECT CASE WHEN COUNT(c.CourseCode) = 1 THEN MIN(c.CourseCode) END AS CourseCode
                 FROM paws.Course c WHERE c.CourseCode = LTRIM(RTRIM(r.CourseOrSubjectOrRotation))) c
 WHERE r.AcademicYear = @AcademicYear AND LTRIM(RTRIM(r.RoleType)) IN (N'HICC', N'Course Coordinator', N'VISC')
 GROUP BY LTRIM(RTRIM(r.RoleType));
