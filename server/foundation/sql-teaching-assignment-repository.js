'use strict';

function createSqlTeachingAssignmentRepository({query}) {
  if (typeof query !== 'function') throw new Error('A SQL query function is required.');
  const run = (sql, params = {}) => query(sql, params);
  return Object.freeze({
      getActorResponsibilities({facultyId, academicYear, asOfDate}) {
        return run(`SELECT tr.ResponsibilityId AS responsibilityId, tr.Kind AS kind, tr.Label AS label, tr.Active AS active, tra.AcademicYear AS academicYear, tra.FacultyId AS facultyId, tra.AssignmentMode AS assignmentMode, CONVERT(varchar(10), tra.ActiveDate, 23) AS activeDate, CONVERT(varchar(10), tra.ExpirationDate, 23) AS expirationDate FROM paws.TeachingResponsibility tr INNER JOIN paws.TeachingResponsibilityAssignee tra ON tra.ResponsibilityId = tr.ResponsibilityId WHERE tra.FacultyId = @facultyId AND tra.AcademicYear = @academicYear AND tr.Active = 1 AND tra.ActiveDate <= @asOfDate AND @asOfDate < tra.ExpirationDate ORDER BY tr.ResponsibilityId`, {facultyId, academicYear, asOfDate});
    },
    getResponsibility(responsibilityId) {
      return run(`SELECT ResponsibilityId AS responsibilityId, Kind AS kind, Label AS label, Active AS active FROM paws.TeachingResponsibility WHERE ResponsibilityId = @responsibilityId`, {responsibilityId});
    },
    getResponsibilityScopes(responsibilityId) {
      return run(`SELECT trs.ResponsibilityScopeId AS responsibilityScopeId, trs.HiccResponsibilityId AS hiccResponsibilityId, trs.HiccResponsibilityKind AS hiccResponsibilityKind, c.CourseId AS courseId, c.CourseCode AS courseCode, s.SubjectId AS subjectId, s.SubjectKey AS subjectKey FROM paws.TeachingResponsibilityScope trs INNER JOIN paws.Course c ON c.CourseId = trs.CourseId LEFT JOIN paws.Subject s ON s.SubjectId = trs.SubjectId WHERE trs.HiccResponsibilityId = @responsibilityId AND trs.HiccResponsibilityKind = N'hicc' ORDER BY c.CourseCode, s.SubjectKey`, {responsibilityId});
    },
      getResponsibilityAssignees(responsibilityId, academicYear) {
        return run(`SELECT ResponsibilityAssigneeId AS responsibilityAssigneeId, ResponsibilityId AS responsibilityId, AcademicYear AS academicYear, FacultyId AS facultyId, AssignmentMode AS assignmentMode, CONVERT(varchar(10), ActiveDate, 23) AS activeDate, CONVERT(varchar(10), ExpirationDate, 23) AS expirationDate FROM paws.TeachingResponsibilityAssignee WHERE ResponsibilityId = @responsibilityId AND AcademicYear = @academicYear ORDER BY ActiveDate, ExpirationDate, FacultyId`, {responsibilityId, academicYear});
    },
    getGroupsForResponsibility(responsibilityId) {
      return run(`SELECT DISTINCT g.GroupId AS groupId, g.Name AS name, g.LeaderViscResponsibilityId AS leaderViscResponsibilityId, g.LeaderViscResponsibilityKind AS leaderViscResponsibilityKind, g.Active AS active FROM paws.TeachingAssignmentGroup g LEFT JOIN paws.TeachingAssignmentGroupHicc gh ON gh.GroupId = g.GroupId WHERE g.Active = 1 AND (g.LeaderViscResponsibilityId = @responsibilityId OR gh.HiccResponsibilityId = @responsibilityId) ORDER BY g.GroupId`, {responsibilityId});
    },
    getGroupHiccResponsibilities(groupId) {
      return run(`SELECT gh.GroupId AS groupId, gh.HiccResponsibilityId AS hiccResponsibilityId FROM paws.TeachingAssignmentGroupHicc gh INNER JOIN paws.TeachingResponsibility tr ON tr.ResponsibilityId = gh.HiccResponsibilityId AND tr.Kind = N'hicc' WHERE gh.GroupId = @groupId AND gh.HiccResponsibilityKind = N'hicc' ORDER BY gh.HiccResponsibilityId`, {groupId});
    },
    getPackage(academicYear, groupId, hiccResponsibilityId) {
      return run(`SELECT p.TeachingAssignmentPackageId AS packageId, p.PackageIdentity AS packageIdentity, p.AcademicYear AS academicYear, p.GroupId AS groupId, p.HiccResponsibilityId AS hiccResponsibilityId, p.HiccResponsibilityKind AS hiccResponsibilityKind, p.Status AS status, p.WorkingRevision AS workingRevision, p.SubmittedWorkingRevision AS submittedWorkingRevision, p.ViscApprovedWorkingRevision AS viscApprovedWorkingRevision, p.ReviewFingerprint AS reviewFingerprint, p.ViscApprovedFingerprint AS viscApprovedFingerprint, p.ViscReviewComment AS viscReviewComment, p.CreatedAtUtc AS createdAtUtc, p.UpdatedAtUtc AS updatedAtUtc FROM paws.TeachingAssignmentPackage p INNER JOIN paws.TeachingResponsibility p_hicc ON p_hicc.ResponsibilityId = p.HiccResponsibilityId AND p_hicc.Kind = N'hicc' AND p_hicc.Active = 1 WHERE p.AcademicYear = @academicYear AND p.GroupId = @groupId AND p.HiccResponsibilityId = @hiccResponsibilityId`, {academicYear, groupId, hiccResponsibilityId});
    },
    listPackagesForActor(facultyId, academicYear, asOfDate) {
      return run(`SELECT DISTINCT p.TeachingAssignmentPackageId AS packageId, p.PackageIdentity AS packageIdentity, p.AcademicYear AS academicYear, p.GroupId AS groupId, p.HiccResponsibilityId AS hiccResponsibilityId, p.HiccResponsibilityKind AS hiccResponsibilityKind, p.Status AS status, p.WorkingRevision AS workingRevision, p.SubmittedWorkingRevision AS submittedWorkingRevision, p.ViscApprovedWorkingRevision AS viscApprovedWorkingRevision, p.ReviewFingerprint AS reviewFingerprint, p.ViscApprovedFingerprint AS viscApprovedFingerprint, p.ViscReviewComment AS viscReviewComment, p.CreatedAtUtc AS createdAtUtc, p.UpdatedAtUtc AS updatedAtUtc FROM paws.TeachingAssignmentPackage p INNER JOIN paws.TeachingAssignmentGroup g ON g.GroupId = p.GroupId AND g.Active = 1 INNER JOIN paws.TeachingResponsibility p_hicc ON p_hicc.ResponsibilityId = p.HiccResponsibilityId AND p_hicc.Kind = N'hicc' AND p_hicc.Active = 1 INNER JOIN paws.TeachingAssignmentGroupHicc gh ON gh.GroupId = p.GroupId AND gh.HiccResponsibilityId = p.HiccResponsibilityId INNER JOIN paws.TeachingResponsibilityAssignee tra ON tra.AcademicYear = p.AcademicYear AND tra.FacultyId = @facultyId AND tra.ActiveDate <= @asOfDate AND @asOfDate < tra.ExpirationDate INNER JOIN paws.TeachingResponsibility tr ON tr.ResponsibilityId = tra.ResponsibilityId AND tr.Active = 1 WHERE p.AcademicYear = @academicYear AND ((tra.ResponsibilityId = p.HiccResponsibilityId AND tr.Kind = N'hicc') OR (tra.ResponsibilityId = g.LeaderViscResponsibilityId AND tr.Kind = N'visc')) ORDER BY p.PackageIdentity`, {facultyId, academicYear, asOfDate});
    },
    getWorkingSessionOwnership(sessionId) {
      return run(`SELECT tso.SessionOwnershipId AS sessionOwnershipId, tso.SessionId AS sessionId, tso.AcademicYear AS academicYear, tso.TeachingAssignmentGroupId AS groupId, tso.ResponsibleHiccResponsibilityId AS hiccResponsibilityId, tso.TeachingAssignmentPackageId AS packageId, tso.SubjectId AS subjectId, p.PackageIdentity AS packageIdentity FROM paws.TeachingSessionOwnership tso INNER JOIN paws.TeachingAssignmentPackage p ON p.AcademicYear = tso.AcademicYear AND p.GroupId = tso.TeachingAssignmentGroupId AND p.HiccResponsibilityId = tso.ResponsibleHiccResponsibilityId AND p.TeachingAssignmentPackageId = tso.TeachingAssignmentPackageId WHERE tso.SessionId = @sessionId`, {sessionId});
    }
  });
}

module.exports = {createSqlTeachingAssignmentRepository};
