'use strict';

const PROFILE_FIELDS = Object.freeze([
  'teachingArea', 'professionalCategory', 'serviceDate', 'priorYearsExperience', 'dvmEarnedDate', 'dvmType',
  'mastersEarnedDate', 'mastersArea', 'phdEarnedDate', 'phdArea', 'boardCertifiedDate', 'boardCertification',
  'boardCertificationCount', 'abvmaLicenseNumber', 'abvmaMemberType'
]);

function facultyDto(row) {
  if (!row) return null;
  const text = value => value === null || value === undefined ? null : String(value);
  const number = value => value === null || value === undefined ? null : Number(value);
  return {
    facultyId: text(row.facultyId), preferredFirstName: text(row.preferredFirstName), preferredLastName: text(row.preferredLastName),
    displayName: text(row.displayName), ucid: text(row.ucid), email: text(row.email), recordType: text(row.recordType),
    stream: text(row.stream), rank: text(row.rank), fte: number(row.fte), reportsToFacultyId: text(row.reportsToFacultyId),
    active: row.active === true || row.active === 1, updatedAtUtc: row.updatedAtUtc instanceof Date ? row.updatedAtUtc.toISOString() : text(row.updatedAtUtc),
    profileVersion: text(row.profileVersion),
    professionalProfile: Object.fromEntries(PROFILE_FIELDS.map(field => [field, field.endsWith('Count') || field === 'priorYearsExperience' ? number(row[field]) : text(row[field])]))
  };
}

function createSqlFacultyAdminRepository(db) {
  const run = (procedure, params) => db.query(
    `EXEC paws_api.${procedure}\n${Object.keys(params).map(key => `@${key} = @${key}`).join(',\n')}`,
    params
  );
  const paramsForUpdate = input => ({
    FacultyId: input.facultyId, ExpectedUpdatedAtUtc: input.expectedUpdatedAtUtc,
    ExpectedProfileVersion: input.expectedProfileVersion, ActorFirebaseUid: input.actorFirebaseUid,
    PreferredFirstName: input.preferredFirstName, PreferredLastName: input.preferredLastName, DisplayName: input.displayName,
    Ucid: input.ucid, Email: input.email, RecordType: input.recordType, Stream: input.stream, Rank: input.rank,
    Fte: input.fte, ReportsToFacultyId: input.reportsToFacultyId,
    TeachingArea: input.professionalProfile.teachingArea, ProfessionalCategory: input.professionalProfile.professionalCategory,
    ServiceDate: input.professionalProfile.serviceDate, PriorYearsExperience: input.professionalProfile.priorYearsExperience,
    DvmEarnedDate: input.professionalProfile.dvmEarnedDate, DvmType: input.professionalProfile.dvmType,
    MastersEarnedDate: input.professionalProfile.mastersEarnedDate, MastersArea: input.professionalProfile.mastersArea,
    PhdEarnedDate: input.professionalProfile.phdEarnedDate, PhdArea: input.professionalProfile.phdArea,
    BoardCertifiedDate: input.professionalProfile.boardCertifiedDate, BoardCertification: input.professionalProfile.boardCertification,
    BoardCertificationCount: input.professionalProfile.boardCertificationCount,
    AbvmaLicenseNumber: input.professionalProfile.abvmaLicenseNumber, AbvmaMemberType: input.professionalProfile.abvmaMemberType
  });
  return Object.freeze({
    async updateRolePeriods(input) {
      const rows = await run('SetRoleAppointmentPeriods', {RoleAssignmentId:input.roleAssignmentId,ExpectedVersion:input.expectedVersion,PeriodsJson:JSON.stringify(input.periods),ActorFirebaseUid:input.actorFirebaseUid});
      return rows[0] || null;
    },
    async updateFaculty(input) {
      const rows = await run('UpdateFaculty', paramsForUpdate(input));
      return facultyDto(rows[0]);
    },
    async deactivateFaculty(input) {
      const rows = await run('DeactivateFaculty', {
        FacultyId: input.facultyId, ExpectedUpdatedAtUtc: input.expectedUpdatedAtUtc, ActorFirebaseUid: input.actorFirebaseUid
      });
      return facultyDto(rows[0]);
    },
    async restoreFaculty(input) {
      const rows = await run('RestoreFaculty', {
        FacultyId: input.facultyId, ExpectedUpdatedAtUtc: input.expectedUpdatedAtUtc, ActorFirebaseUid: input.actorFirebaseUid
      });
      return facultyDto(rows[0]);
    }
  });
}

module.exports = { createSqlFacultyAdminRepository, facultyDto, PROFILE_FIELDS };
