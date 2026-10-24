'use strict';

function database(permission) {
  return { class: 0, state: 'G', permission, schema: null, object: null, column: null, scope: 'DATABASE' };
}

function schema(name, permission) {
  return { class: 3, state: 'D', permission, schema: name, object: null, column: null, scope: 'SCHEMA' };
}

function object(name, objectName, permission = 'SELECT') {
  return { class: 1, state: 'G', permission, schema: name, object: objectName, column: null, scope: 'OBJECT' };
}

function column(name, objectName, columnName) {
  return { class: 1, state: 'G', permission: 'SELECT', schema: name, object: objectName, column: columnName, scope: 'COLUMN' };
}

const preB1Contract = [
  database('CONNECT'),
  object('paws', 'vCalendarSession'),
  ...['FirebaseUid', 'DisplayName', 'BaseRole', 'FacultyId', 'Active', 'MustChangePassword']
    .map(name => column('paws', 'UserProfile', name)),
  ...['SessionAssignmentId', 'SessionId', 'FacultyId', 'TeachingRole', 'LabLead', 'CreditedHours', 'DoeRate', 'DoeQuantity', 'DoeUnit', 'DoeCredit', 'DoeStatus']
    .map(name => column('paws', 'SessionAssignment', name)),
  ...['FacultyId', 'RecordType', 'PreferredFirstName', 'PreferredLastName', 'DisplayName', 'Ucid', 'Email', 'Stream', 'Rank', 'Fte', 'ReportsToFacultyId', 'Active']
    .map(name => column('paws', 'Faculty', name)),
  ...['FacultyId', 'TeachingArea', 'ProfessionalCategory', 'ServiceDate', 'PriorYearsExperience', 'DvmEarnedDate', 'DvmType', 'MastersEarnedDate', 'MastersArea', 'PhdEarnedDate', 'PhdArea', 'BoardCertifiedDate', 'BoardCertification', 'BoardCertificationCount', 'AbvmaLicenseNumber', 'AbvmaMemberType']
    .map(name => column('paws', 'FacultyProfessionalProfile', name)),
  ...['JointAppointmentId', 'FacultyId', 'HomeFaculty', 'JointFaculty', 'FteUcvm', 'FteOtherFaculty', 'ExpiryDate', 'Notes']
    .map(name => column('paws', 'JointAppointment', name)),
  ...['RoleAssignmentId', 'FacultyId', 'FacultyResolutionStatus', 'AcademicYear', 'RoleCategory', 'RoleType', 'CourseOrSubjectOrRotation', 'CourseName', 'Details', 'EffectiveDate', 'ExpirationDate', 'DoeMappedValue', 'DoeOverrideValue', 'DoeOverrideReason', 'SpecialNotes']
    .map(name => column('paws', 'RoleAssignment', name)),
  ...['AfcRecordId', 'FacultyId', 'StartDate', 'EndDate', 'Purpose', 'Active']
    .map(name => column('paws', 'AfcRecord', name)),
  ...['INSERT', 'UPDATE', 'DELETE', 'EXECUTE'].map(permission => schema('paws', permission)),
  ...['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE'].map(permission => schema('staging', permission))
];

const b1Permissions = [
  object('paws', 'vAfcRecordUnified'),
  object('paws_api', 'CreateAfcRecord', 'EXECUTE')
];

const postB1Contract = [...preB1Contract, ...b1Permissions];

function permissionKey(row) {
  return [row.grantee || 'runtime', row.class, row.state, row.permission, row.schema || '', row.object || '', row.column || '', row.scope].join('|');
}

function evaluateContract(rows, expected) {
  const actualKeys = rows.map(permissionKey);
  const expectedKeys = expected.map(permissionKey);
  const actualSet = new Set(actualKeys);
  const expectedSet = new Set(expectedKeys);
  return {
    ok: actualKeys.length === actualSet.size
      && actualSet.size === expectedSet.size
      && [...actualSet].every(key => expectedSet.has(key)),
    unexpected: [...actualSet].filter(key => !expectedSet.has(key)),
    missing: [...expectedSet].filter(key => !actualSet.has(key)),
    duplicate: actualKeys.length !== actualSet.size
  };
}

function evaluatePublicContract(rows) {
  const unexpected = rows.filter(row => {
    if ((row.grantee || 'runtime') !== 'public' || !['G', 'W'].includes(row.state)) return false;
    if (row.class === 0) return !(row.permission === 'CONNECT' && row.state === 'G');
    return row.class === 3
      ? ['paws', 'paws_api', 'staging'].includes(row.schema)
      : row.class === 1 && ['paws', 'paws_api', 'staging'].includes(row.schema);
  });
  return { ok: unexpected.length === 0, unexpected };
}

module.exports = {
  b1Permissions,
  evaluateContract,
  evaluatePublicContract,
  postB1Contract,
  preB1Contract
};
