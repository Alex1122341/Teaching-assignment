'use strict';

function createSqlManualDoeRepository(db) {
  if (!db?.query) throw new TypeError('SQL query adapter required.');
  return Object.freeze({
    async scopeSuggestions(academicYear) {
      return db.query(`SELECT DISTINCT scopeText,courseCode,subjectKey FROM (
        SELECT r.CourseOrSubjectOrRotation AS scopeText,c.CourseCode,
          CASE WHEN r.RoleType=N'VISC' AND LEN(r.CourseOrSubjectOrRotation)<=128 THEN r.CourseOrSubjectOrRotation END AS subjectKey
        FROM paws.RoleAssignment r
        LEFT JOIN paws.Course c ON r.CourseOrSubjectOrRotation=c.CourseCode
          OR r.CourseOrSubjectOrRotation=c.CourseCode+N': '+c.CourseName
          OR (NULLIF(r.CourseName,N'') IS NOT NULL AND r.CourseName=c.CourseName)
        WHERE (r.AcademicYear=@academicYear OR r.AcademicYear IS NULL)
        UNION ALL SELECT CourseCode,CourseCode,NULL FROM paws.Course
        UNION ALL SELECT CourseCode+N': '+CourseName,CourseCode,NULL FROM paws.Course WHERE LEN(CourseCode+N': '+CourseName)<=256
        UNION ALL SELECT CourseCode,CourseCode,NULL FROM paws.DoeCourseMapping WHERE AcademicYear=@academicYear
        UNION ALL SELECT SubjectKey,NULL,SubjectKey FROM paws.DoeSubjectMapping WHERE AcademicYear=@academicYear
      ) s WHERE NULLIF(LTRIM(RTRIM(scopeText)),N'') IS NOT NULL ORDER BY scopeText`, { academicYear });
    },
    async saveManualAssignment(record) {
      const params = { ...record, courseCode: record.courseCode || null, subjectKey: record.subjectKey || null, notes: record.notes || null,
        // Bind as text so inferred SQL numeric types cannot round signed decimals.
        doeValue: record.doeValue === null ? null : String(record.doeValue) };
      try {
        const rows = await db.query(`EXEC paws.SaveManualDoeAssignment
          @assignmentId=@assignmentId,@facultyId=@facultyId,@academicYear=@academicYear,@expectedRevision=@expectedRevision,
          @roleType=@roleType,@scopeText=@scopeText,@courseCode=@courseCode,@subjectKey=@subjectKey,
          @doeValue=@doeValue,@notes=@notes,@actorUid=@actorUid,@deactivate=@deactivate`, params);
        if (!rows[0]) throw new Error('Manual DOE save returned no record.');
        return rows[0];
      } catch (error) {
        const message = String(error.message || '');
        const code = /MANUAL_DOE_(?:REVISION_CONFLICT|NOT_FOUND|FACULTY_NOT_FOUND|INVALID)/.exec(message)?.[0];
        if (code) error.code = code;
        throw error;
      }
    }
  });
}

module.exports = { createSqlManualDoeRepository };
