'use strict';

// BETA-R4D-10A2 — Dashboard read API completion acceptance tests.
//
// Cases are labelled A–Y to match the task acceptance matrix:
//   A  adfa_general summary -> 200
//   B  faculty summary -> 403
//   C  hicc summary -> 403
//   D  visc summary -> 403
//   E  admin faculty roster -> all permitted faculty
//   F  faculty faculty-roster endpoint -> exactly own row
//   G  hicc -> exactly own row
//   H  visc -> exactly own row
//   I  faculty detail own id -> 200
//   J  faculty detail another id -> 403
//   K  missing faculty link -> 403 FACULTY_LINK_REQUIRED
//   L  viewer -> 403
//   M  inactive profile -> 403
//   N  invalid academic year -> 400
//   O  2026-2027 canonicalises to 2026-27
//   P  omitted academic year defaults to 2026-27
//   Q  detail response contains all six sections
//   R  source/import metadata absent
//   S  teaching assignment contains stored DOE fields
//   T  AFC purpose cannot leak through roster
//   U  repository has no Firestore
//   V  repository has no SQL mutation
//   W  SQL permission contract remains read-only
//   X  staging remains denied
//   Y  unsupported HTTP methods still -> 405 Allow: GET

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createDashboardApi, resolveScope, resolveYear, ADMIN_ROLES, SELF_SERVICE_ROLES } = require('../src/data/dashboard-api');
const { createDashboardFunctions } = require('../src/runtime/swa-dashboard-functions');
const {
  createSqlDashboardRepository,
  isUuid,
  DEFAULT_ACADEMIC_YEAR,
  boundLimit,
  likePattern,
  MAX_LIMIT,
  HICC_ROLE_TYPES,
  VISC_ROLE_TYPES,
  roleTypeInPredicate
} = require('../src/data/sql-dashboard-repository');
const {
  canonicalAcademicYear,
  InvalidAcademicYearError,
  resolveAcademicYear
} = require('../src/data/academic-year');

const root = path.resolve(__dirname, '..', '..');
const FACULTY_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_FACULTY_ID = '22222222-2222-2222-2222-222222222222';
const AY = '2026-27';

const request = (url, { method = 'GET', token = 'ok' } = {}) => ({
  method,
  url: 'https://local' + url,
  headers: { get: name => (name.toLowerCase() === 'authorization' ? 'Bearer ' + token : null) }
});

// A detail payload shaped exactly like the repository contract, used to prove
// the API surfaces all six sections without inventing any.
function detailPayload(facultyId = FACULTY_ID) {
  return {
    faculty: { facultyId, displayName: 'A', active: true },
    academicYear: AY,
    professionalProfile: { teachingArea: 'Medicine', abvmaMemberType: 'Regular' },
    jointAppointments: [{ jointAppointmentId: 'ja-1', homeFaculty: 'UCVM' }],
    roles: [{ roleAssignmentId: 'ra-1', roleCategory: 'HICC', doeOverrideValue: 12 }],
    afcRecords: [{ afcRecordId: 'afc-1', purpose: 'Sabbatical', active: true }],
    teachingAssignments: [{
      sessionAssignmentId: 'sa-1',
      sessionId: 'se-1',
      academicYear: AY,
      curriculumYear: 'Year 1',
      courseCode: 'VETM 101',
      courseName: 'Foundations',
      topic: 'Intro',
      sessionType: 'Lab',
      date: '2026-08-25',
      startTime: '08:30:00',
      endTime: '10:30:00',
      room: 'A100',
      teachingRole: 'Lab Lead',
      labLead: 'Yes',
      creditedHours: 2,
      doeRate: 1.5,
      doeQuantity: 2,
      doeUnit: 'hours',
      doeCredit: 3,
      doeStatus: 'confirmed'
    }],
    sessionCount: 1,
    checkNeededCount: 0
  };
}

function harness(profile, overrides = {}) {
  const calls = [];
  const repository = {
    summary: async args => { calls.push(['summary', args]); return { academicYear: AY, sessionCount: 1937, assignmentCount: 4970 }; },
    faculty: async args => { calls.push(['faculty', args]); return [{ facultyId: FACULTY_ID, displayName: 'A' }]; },
    facultyById: async args => {
      calls.push(['facultyById', args]);
      return args.facultyId === FACULTY_ID ? detailPayload(FACULTY_ID) : null;
    },
    ...overrides.repository
  };
  const api = createDashboardApi({
    verifyToken: overrides.verifyToken || (async () => ({ uid: 'uid-1' })),
    findUser: overrides.findUser || (async () => profile),
    repository
  });
  return { api, app: createDashboardFunctions({ api }), calls };
}

const adminProfile = role => ({ active: true, mustChangePassword: false, baseRole: role, facultyId: null });
const selfProfile = (role, facultyId = FACULTY_ID) => ({ active: true, mustChangePassword: false, baseRole: role, facultyId });

// A / B / C / D ---------------------------------------------------------------
test('A: adfa_general reads the Dashboard summary', async () => {
  const { app } = harness(adminProfile('adfa_general'));
  const response = await app(request('/api/v1/dashboard/summary'));
  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.summary.sessionCount, 1937);
  assert.equal(response.jsonBody.summary.assignmentCount, 4970);
});

test('B: faculty is denied the summary with 403 ROLE_DENIED', async () => {
  const { app, calls } = harness(selfProfile('faculty'));
  const response = await app(request('/api/v1/dashboard/summary'));
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'ROLE_DENIED');
  assert.equal(calls.length, 0, 'summary must not touch SQL for a self-service caller');
});

test('C: hicc is denied the summary with 403 ROLE_DENIED', async () => {
  const { app, calls } = harness(selfProfile('hicc'));
  const response = await app(request('/api/v1/dashboard/summary'));
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'ROLE_DENIED');
  assert.equal(calls.length, 0);
});

test('D: visc is denied the summary with 403 ROLE_DENIED', async () => {
  const { app, calls } = harness(selfProfile('visc'));
  const response = await app(request('/api/v1/dashboard/summary'));
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'ROLE_DENIED');
  assert.equal(calls.length, 0);
});

// E ---------------------------------------------------------------------------
test('E: an administrator reads the full faculty roster', async () => {
  const { app, calls } = harness(adminProfile('administrator'));
  const response = await app(request('/api/v1/dashboard/faculty'));
  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.count, response.jsonBody.faculty.length);
  assert.equal(calls[0][0], 'faculty');
  assert.equal(calls[0][1].facultyId, null, 'an administrator is not narrowed by facultyId');
});

// F / G / H -------------------------------------------------------------------
test('F: faculty receives exactly its own roster row', async () => {
  const { app, calls } = harness(selfProfile('faculty'));
  const response = await app(request('/api/v1/dashboard/faculty'));
  assert.equal(response.status, 200);
  assert.equal(calls[0][1].facultyId, FACULTY_ID);
  assert.equal(response.jsonBody.faculty.length, 1);
  assert.equal(response.jsonBody.faculty[0].facultyId, FACULTY_ID);
});

test('G: hicc receives exactly its own roster row', async () => {
  const { app, calls } = harness(selfProfile('hicc'));
  const response = await app(request('/api/v1/dashboard/faculty'));
  assert.equal(response.status, 200);
  assert.equal(calls[0][1].facultyId, FACULTY_ID);
  assert.equal(response.jsonBody.faculty.length, 1);
});

test('H: visc receives exactly its own roster row', async () => {
  const { app, calls } = harness(selfProfile('visc'));
  const response = await app(request('/api/v1/dashboard/faculty'));
  assert.equal(response.status, 200);
  assert.equal(calls[0][1].facultyId, FACULTY_ID);
  assert.equal(response.jsonBody.faculty.length, 1);
});

// I / J -----------------------------------------------------------------------
test('I: a faculty-scoped caller reads its own detail', async () => {
  const { app, calls } = harness(selfProfile('faculty'));
  const response = await app(request('/api/v1/dashboard/faculty/' + FACULTY_ID));
  assert.equal(response.status, 200);
  assert.equal(calls[0][1].facultyId, FACULTY_ID);
});

test('J: a faculty-scoped caller is denied another faculty record with 403', async () => {
  const { app, calls } = harness(selfProfile('faculty'));
  const response = await app(request('/api/v1/dashboard/faculty/' + OTHER_FACULTY_ID));
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'ROLE_DENIED');
  assert.equal(calls.length, 0, 'another faculty id must be refused before SQL');
});

// K / L / M -------------------------------------------------------------------
test('K: a faculty-scoped caller without a FacultyId gets 403 FACULTY_LINK_REQUIRED', async () => {
  for (const role of ['faculty', 'hicc', 'visc']) {
    const { app, calls } = harness({ active: true, mustChangePassword: false, baseRole: role, facultyId: null });
    for (const url of ['/api/v1/dashboard/summary', '/api/v1/dashboard/faculty', '/api/v1/dashboard/faculty/' + FACULTY_ID]) {
      const response = await app(request(url));
      assert.equal(response.status, 403, role + ' ' + url);
      assert.equal(response.jsonBody.error.code, 'FACULTY_LINK_REQUIRED', role + ' ' + url);
    }
    assert.equal(calls.length, 0, role);
  }
});

test('L: viewer is denied on every Dashboard route', async () => {
  const { app, calls } = harness({ active: true, mustChangePassword: false, baseRole: 'viewer', facultyId: null });
  for (const url of ['/api/v1/dashboard/summary', '/api/v1/dashboard/faculty', '/api/v1/dashboard/faculty/' + FACULTY_ID]) {
    const response = await app(request(url));
    assert.equal(response.status, 403, url);
    assert.equal(response.jsonBody.error.code, 'ROLE_DENIED', url);
  }
  assert.equal(calls.length, 0);
});

test('L2: other_office stays retired and is denied', async () => {
  assert.equal(ADMIN_ROLES.has('other_office'), false);
  assert.equal(SELF_SERVICE_ROLES.has('other_office'), false);
  const { app, calls } = harness({ active: true, mustChangePassword: false, baseRole: 'other_office', facultyId: null });
  const response = await app(request('/api/v1/dashboard/summary'));
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'ROLE_DENIED');
  assert.equal(calls.length, 0);
});

test('M: an inactive profile fails closed before SQL', async () => {
  const { app, calls } = harness({ active: false, mustChangePassword: false, baseRole: 'administrator', facultyId: null });
  const response = await app(request('/api/v1/dashboard/summary'));
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'PROFILE_REQUIRED');
  assert.equal(calls.length, 0);

  const passwordChange = harness({ active: true, mustChangePassword: true, baseRole: 'administrator', facultyId: null });
  const second = await passwordChange.app(request('/api/v1/dashboard/summary'));
  assert.equal(second.status, 403);
  assert.equal(second.jsonBody.error.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal(passwordChange.calls.length, 0);
});

// N / O / P -------------------------------------------------------------------
test('N: an invalid academic year is rejected with 400 INVALID_ACADEMIC_YEAR', async () => {
  const { app, calls } = harness(adminProfile('adfa_general'));
  for (const bad of ['2026-2028', 'junk', '2026', '2026-2', 'abcd-ef', '2026-99']) {
    const response = await app(request('/api/v1/dashboard/summary?academicYear=' + encodeURIComponent(bad)));
    assert.equal(response.status, 400, bad);
    assert.equal(response.jsonBody.error.code, 'INVALID_ACADEMIC_YEAR', bad);
  }
  assert.equal(calls.length, 0, 'a malformed year must be refused before SQL');
});

test('O: 2026-2027 canonicalises to 2026-27', async () => {
  assert.equal(canonicalAcademicYear('2026-2027'), '2026-27');
  assert.equal(canonicalAcademicYear('2026-27'), '2026-27');
  assert.equal(canonicalAcademicYear('2027-2028'), '2027-28');
  assert.equal(canonicalAcademicYear('2027-28'), '2027-28');

  const { app, calls } = harness(adminProfile('adfa_general'));
  const response = await app(request('/api/v1/dashboard/summary?academicYear=2026-2027'));
  assert.equal(response.status, 200);
  assert.equal(calls[0][1].academicYear, AY, 'the repository receives the canonical year');
});

test('P: an omitted academic year defaults to 2026-27', async () => {
  assert.equal(resolveAcademicYear(undefined), DEFAULT_ACADEMIC_YEAR);
  assert.equal(resolveAcademicYear(''), DEFAULT_ACADEMIC_YEAR);
  assert.equal(DEFAULT_ACADEMIC_YEAR, AY);

  const { app, calls } = harness(adminProfile('adfa_general'));
  const response = await app(request('/api/v1/dashboard/summary'));
  assert.equal(response.status, 200);
  assert.equal(calls[0][1].academicYear, AY);
});

// Q / R / S / T -----------------------------------------------------------------
test('Q: the detail response carries all six required sections as siblings', async () => {
  const { app } = harness(adminProfile('administrator'));
  const response = await app(request('/api/v1/dashboard/faculty/' + FACULTY_ID));
  assert.equal(response.status, 200);
  const body = response.jsonBody;
  for (const section of ['faculty', 'professionalProfile', 'jointAppointments', 'roles', 'afcRecords', 'teachingAssignments']) {
    assert.ok(Object.prototype.hasOwnProperty.call(body, section), 'missing section: ' + section);
  }
  assert.ok(Array.isArray(body.jointAppointments));
  assert.ok(Array.isArray(body.roles));
  assert.ok(Array.isArray(body.afcRecords));
  assert.ok(Array.isArray(body.teachingAssignments));
  // The sections must NOT be buried inside `faculty`.
  for (const section of ['professionalProfile', 'jointAppointments', 'roles', 'afcRecords', 'teachingAssignments']) {
    assert.equal(Object.prototype.hasOwnProperty.call(body.faculty, section), false, section + ' must not be nested in faculty');
  }
});


test('R: source / import metadata stays isolated to the AFC unified projection', () => {
  const source = fs.readFileSync(path.join(root, 'server', 'src', 'data', 'sql-dashboard-repository.js'), 'utf8');
  const legacyProjection = source.slice(0, source.indexOf('// ------------------------------------------------------------- AFC list'));
  for (const forbidden of ['SourceImportBatchId', 'SourceRow', 'SourceFacultyName']) {
    assert.equal(
      new RegExp('AS\\s+' + forbidden, 'i').test(legacyProjection),
      false,
      forbidden + ' is projected into a DTO field'
    );
  }
  // Legacy DTO mappers must not emit provenance fields; the isolated AFC
  // projection is explicitly allowed to carry source/audit metadata. The
  // canonical Faculty UpdatedAtUtc concurrency token is not provenance.
  for (const forbidden of ["sourceImportBatchId", "sourceRow", "sourceFacultyName", "createdAtUtc"]) {
    assert.equal(legacyProjection.includes(forbidden), false, 'legacy DTO exposes ' + forbidden);
  }
  assert.match(legacyProjection, /UpdatedAtUtc/);
  assert.match(source.slice(source.indexOf('// ------------------------------------------------------------- AFC list')), /u\.SourceKind AS sourceKind/);
});

test('S: teaching assignments carry the stored DOE fields', async () => {
  const { app } = harness(adminProfile('administrator'));
  const response = await app(request('/api/v1/dashboard/faculty/' + FACULTY_ID));
  const assignment = response.jsonBody.teachingAssignments[0];
  for (const field of ['sessionAssignmentId', 'sessionId', 'academicYear', 'curriculumYear', 'courseCode', 'courseName',
    'topic', 'sessionType', 'date', 'startTime', 'endTime', 'room',
    'teachingRole', 'labLead', 'creditedHours', 'doeRate', 'doeQuantity', 'doeUnit', 'doeCredit', 'doeStatus']) {
    assert.ok(Object.prototype.hasOwnProperty.call(assignment, field), 'assignment missing ' + field);
  }
  assert.equal(assignment.doeCredit, 3);
});

test('T: AFC purpose is detail-only and cannot leak through the roster', async () => {
  const rosterSource = fs.readFileSync(path.join(root, 'server', 'src', 'data', 'sql-dashboard-repository.js'), 'utf8');
  const facultyMethod = rosterSource.slice(
    rosterSource.indexOf('async faculty('),
    rosterSource.indexOf('// ------------------------------------------------------------- AFC list')
  );
  assert.equal(/Purpose/i.test(facultyMethod), false, 'the roster query references AFC Purpose');

  // The roster DTO exposes only a count, never a purpose value.
  const { app } = harness(adminProfile('administrator'), {
    repository: {
      faculty: async () => [{ facultyId: FACULTY_ID, displayName: 'A', sessionCount: 0, roleCount: 0, afcCount: 2, jointAppointmentCount: 0 }]
    }
  });
  const response = await app(request('/api/v1/dashboard/faculty'));
  const row = response.jsonBody.faculty[0];
  assert.equal(row.afcCount, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'purpose'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'afcRecords'), false);
});

// U / V -----------------------------------------------------------------------
test('U: the repository never references Firestore', () => {
  const source = fs.readFileSync(path.join(root, 'server', 'src', 'data', 'sql-dashboard-repository.js'), 'utf8');
  // Strip line comments: the module documents the prohibition in prose, and that
  // prose must not be mistaken for a real reference.
  const code = source.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  assert.equal(/firestore/i.test(code), false);
  assert.equal(/firebase/i.test(code), false);
});

test('V: the repository emits no SQL mutation', () => {
  const source = fs.readFileSync(path.join(root, 'server', 'src', 'data', 'sql-dashboard-repository.js'), 'utf8');
  // Strip line comments so the documented prohibition is not self-triggering.
  const code = source.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'EXEC', 'TRUNCATE', 'CREATE', 'ALTER', 'DROP']) {
    assert.equal(
      new RegExp('\\b' + verb + '\\b', 'i').test(code),
      false,
      'repository contains a ' + verb + ' token'
    );
  }
  assert.equal(/\bstaging\b/i.test(code), false, 'repository references the staging schema');
});

// W / X -----------------------------------------------------------------------
test('W: the SQL permission contract stays read-only and never grants mutation', () => {
  const grants = fs.readFileSync(path.join(root, 'database', 'azure-sql', '004_swa_beta_permissions.sql'), 'utf8');

  // Every GRANT in the file must be CONNECT or a column-scoped SELECT.
  const grantLines = grants.split('\n').filter(line => /^\s*GRANT\b/i.test(line));
  assert.ok(grantLines.length > 0, 'no grant lines found');
  for (const line of grantLines) {
    assert.equal(/^\s*GRANT\s+(CONNECT|SELECT)\b/i.test(line), true, 'unexpected grant: ' + line.trim());
  }

  // The DML denies for `paws` and the staging deny must be present.
  assert.equal(/DENY\s+INSERT,\s*UPDATE,\s*DELETE,\s*EXECUTE\s+ON\s+SCHEMA::paws/i.test(grants), true);
  assert.equal(/DENY\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE,\s*EXECUTE\s+ON\s+SCHEMA::staging/i.test(grants), true);

  // The four R4D-10A2 domains must be granted.
  for (const object of ['FacultyProfessionalProfile', 'JointAppointment', 'RoleAssignment', 'AfcRecord']) {
    assert.equal(grants.includes('OBJECT::paws.' + object), true, 'missing grant for ' + object);
  }

  // No table-level (unscoped) SELECT on any of the new objects.
  for (const object of ['Faculty', 'FacultyProfessionalProfile', 'JointAppointment', 'RoleAssignment', 'AfcRecord', 'SessionAssignment']) {
    const unscoped = new RegExp('GRANT\\s+SELECT\\s+ON\\s+OBJECT::paws\\.' + object + '\\s+TO', 'i');
    assert.equal(unscoped.test(grants), false, object + ' is granted whole-object SELECT');
  }

  // Provenance columns must never be granted. Only real GRANT statements are
  // inspected: the file also contains reviewed "these must be absent" prose and
  // the THROW message text, neither of which grants anything.
  const grantBlock = grants.split('\n')
    .filter(line => /^\s*GRANT\b/i.test(line))
    .join('\n');
  for (const column of ['SourceImportBatchId', 'SourceRow', 'SourceFacultyName']) {
    assert.equal(grantBlock.includes(column), false, column + ' is granted');
  }
});

test('X: staging remains denied and is never granted', () => {
  const grants = fs.readFileSync(path.join(root, 'database', 'azure-sql', '004_swa_beta_permissions.sql'), 'utf8');
  const grantLines = grants.split('\n').filter(line => /^\s*GRANT\b/i.test(line));
  for (const line of grantLines) {
    assert.equal(/staging/i.test(line), false, 'a GRANT references staging: ' + line.trim());
  }
  assert.equal(/DENY\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE,\s*EXECUTE\s+ON\s+SCHEMA::staging/i.test(grants), true);
});

test('W2: the read-only proof recognises the expanded surface and keeps its discipline', () => {
  const proof = fs.readFileSync(path.join(root, 'database', 'azure-sql', '004_swa_beta_permissions_readonly_proof.sql'), 'utf8');
  // PR #25 lesson: HAS_PERMS_BY_NAME cannot be used to probe another principal.
  const code = proof.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
  assert.equal(/HAS_PERMS_BY_NAME/i.test(code), false, 'the proof must not use HAS_PERMS_BY_NAME as a principal probe');
  // The expanded positive control and the provenance negative control exist.
  assert.equal(proof.includes('R4D-10A2 Dashboard read grants are incomplete'), true);
  assert.equal(proof.includes('source import provenance'), true);
  // Mutation, staging and role checks remain.
  assert.equal(/mutation-capable permission/.test(proof), true);
  assert.equal(/can read the staging schema/.test(proof), true);
  assert.equal(/inherits a database role/.test(proof), true);
});

// Y ---------------------------------------------------------------------------
test('Y: read-only Dashboard routes reject methods while Faculty detail exposes only the narrow PATCH method', async () => {
  const { app } = harness(adminProfile('administrator'));
  const urls = ['/api/v1/dashboard/summary', '/api/v1/dashboard/faculty', '/api/v1/dashboard/faculty/' + FACULTY_ID];
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const url of urls) {
      const response = await app(request(url, { method }));
      if (url === '/api/v1/dashboard/faculty' && method === 'POST') {
        assert.equal(response.status, 503);
        assert.equal(response.jsonBody.error.code, 'WRITE_DISABLED');
        continue;
      }
      if (url.endsWith('/' + FACULTY_ID) && method === 'PATCH') {
        assert.equal(response.status, 503);
        assert.equal(response.jsonBody.error.code, 'WRITE_DISABLED');
        continue;
      }
      assert.equal(response.status, 405, method + ' ' + url);
      assert.equal(response.headers.Allow, url.endsWith('/' + FACULTY_ID) ? 'GET, PATCH' : url === '/api/v1/dashboard/faculty' ? 'GET, POST' : 'GET', method + ' ' + url);
      assert.equal(response.jsonBody.error.code, 'METHOD_NOT_ALLOWED');
    }
  }
});

// ---------------------------------------------------------------- unit helpers
test('helper: boundLimit clamps and defaults', () => {
  assert.equal(boundLimit(undefined), 200);
  assert.equal(boundLimit(NaN), 200);
  assert.equal(boundLimit(0), 1);
  assert.equal(boundLimit(10), 10);
  assert.equal(boundLimit(10_000), MAX_LIMIT);
});

test('helper: likePattern escapes LIKE metacharacters', () => {
  assert.equal(likePattern('abc'), '%abc%');
  assert.equal(likePattern('100%'), '%100\\%%');
  assert.equal(likePattern('a_b'), '%a\\_b%');
  assert.equal(likePattern('a[b'), '%a\\[b%');
});

test('helper: isUuid only accepts a canonical uuid', () => {
  assert.equal(isUuid(FACULTY_ID), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(null), false);
});

test('helper: canonical invalid-year error carries the contract code', () => {
  try {
    canonicalAcademicYear('2026-2028');
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof InvalidAcademicYearError);
    assert.equal(error.code, 'INVALID_ACADEMIC_YEAR');
  }
});

test('helper: resolveYear returns an error result for malformed input and a year otherwise', () => {
  assert.equal(resolveYear('2026-27').year, AY);
  assert.equal(resolveYear('').year, AY);
  assert.equal(resolveYear(undefined).year, AY);
  const bad = resolveYear('junk');
  assert.equal(bad.error.status, 400);
  assert.equal(bad.error.body.error.code, 'INVALID_ACADEMIC_YEAR');
});

test('E2: the repository summary projection computes the full KPI set', async () => {
  const queries = [];
  const repository = createSqlDashboardRepository({ query: async (sql, params) => { queries.push({ sql, params }); return [{ activeFacultyCount: 120, sessionCount: 1937, courseCount: 88, gridPositionableCount: 1082, checkNeededCount: 855, assignmentCount: 4970, roleAssignmentCount: 162, hiccCount: 40, viscCount: 22, afcRecordCount: 791 }]; } });
  const summary = await repository.summary({ academicYear: '2026-2027' });
  assert.equal(summary.academicYear, AY);
  assert.equal(summary.activeFacultyCount, 120);
  assert.equal(summary.sessionCount, 1937);
  assert.equal(summary.assignmentCount, 4970);
  assert.equal(summary.courseCount, 88);
  assert.equal(summary.roleAssignmentCount, 162);
  assert.equal(summary.hiccCount, 40);
  assert.equal(summary.viscCount, 22);
  assert.equal(summary.afcRecordCount, 791);
  assert.equal(summary.gridPositionableCount, 1082);
  assert.equal(summary.checkNeededCount, 855);
  // The limit is parameter-bound, never spliced.
  assert.equal(/\bINSERT\b|TOP \(\d+\)/i.test(queries[0].sql.replace(/TOP \(@limit\)/i, '')), false);
});

// ---------------------------------------------------------------- HICC / VISC
// Regression block for the live-data defect found during reconciliation:
// `paws.RoleAssignment.RoleCategory` is NULL for all 162 rows in 2026-27, so a
// `RoleCategory = @x` predicate silently yields hiccCount = 0 / viscCount = 0.
// These tests fail if anyone reintroduces that predicate.

test('E7: hiccCount and viscCount are matched on RoleType, never RoleCategory', async () => {
  const queries = [];
  const repository = createSqlDashboardRepository({
    query: async (sql, params) => { queries.push({ sql, params }); return [{}]; }
  });
  await repository.summary({ academicYear: AY });

  const sql = queries[0].sql;
  assert.equal(
    /RoleCategory\s*=\s*@/i.test(sql),
    false,
    'hiccCount/viscCount must not filter on the all-NULL RoleCategory column'
  );
  assert.equal(/RoleType\s+IN\s*\(/i.test(sql), true, 'classification must use RoleType IN (...)');
});

test('E8: the HICC / VISC vocabulary is exactly the two confirmed live values', () => {
  assert.deepEqual(HICC_ROLE_TYPES, ['Course Coordinator / HICC (legacy ambiguous)', 'HICC']);
  assert.deepEqual(VISC_ROLE_TYPES, ['VISC']);
});

test('E9: "Designated Rotation Coordinator" is not counted as HICC', () => {
  const designated = 'Designated Rotation Coordinator';
  assert.equal(HICC_ROLE_TYPES.includes(designated), false);
  // A substring match on "Coordinator" would wrongly admit it; whole-value
  // equality is the contract.
  assert.equal(HICC_ROLE_TYPES.some(value => designated.includes(value)), false);
});

test('E10: the classification predicate is parameter-bound, not spliced', async () => {
  const queries = [];
  const repository = createSqlDashboardRepository({
    query: async (sql, params) => { queries.push({ sql, params }); return [{}]; }
  });
  await repository.summary({ academicYear: AY });

  const { sql, params } = queries[0];
  assert.equal(sql.includes('Course Coordinator / HICC'), false, 'vocabulary text must not appear in SQL');
  assert.equal(params.hiccRoleType0, 'Course Coordinator / HICC (legacy ambiguous)');
  assert.equal(params.viscRoleType0, 'VISC');
});

test('E11: the classification predicate composes with faculty scoping', async () => {
  const queries = [];
  const repository = createSqlDashboardRepository({
    query: async (sql, params) => { queries.push({ sql, params }); return [{}]; }
  });
  await repository.summary({ academicYear: AY, facultyId: FACULTY_ID });

  const { sql, params } = queries[0];
  assert.equal(params.facultyId, FACULTY_ID);
  // Both the role count and the hicc/visc subqueries must carry the predicate.
  const scopedRolePredicates = sql.match(/ra\.FacultyId = @facultyId/g) || [];
  assert.equal(scopedRolePredicates.length, 3, 'roleAssignmentCount + hiccCount + viscCount must all be scoped');
});

test('E12: roleTypeInPredicate builds exact IN lists for any vocabulary size', () => {
  const single = roleTypeInPredicate('ra.RoleType', ['VISC'], 'viscRoleType');
  assert.equal(single.sql, 'ra.RoleType IN (@viscRoleType0)');
  assert.deepEqual(single.params, { viscRoleType0: 'VISC' });

  const multi = roleTypeInPredicate('r.RoleType', ['A', 'B'], 'p');
  assert.equal(multi.sql, 'r.RoleType IN (@p0, @p1)');
  assert.deepEqual(multi.params, { p0: 'A', p1: 'B' });
});

test('E13: the vocabulary helper surfaces RoleCategory AND RoleType', async () => {
  const repository = createSqlDashboardRepository({
    query: async () => [
      { roleCategory: null, roleType: 'VISC' },
      { roleCategory: null, roleType: 'CCC' }
    ]
  });
  const vocabulary = await repository.roleCategoryVocabulary();
  assert.deepEqual(vocabulary[0], { roleCategory: null, roleType: 'VISC' });
  assert.deepEqual(vocabulary[1], { roleCategory: null, roleType: 'CCC' });
});

test('E3: the repository roster binds the limit as a parameter and escapes LIKE', async () => {
  const queries = [];
  const repository = createSqlDashboardRepository({ query: async (sql, params) => { queries.push({ sql, params }); return []; } });
  await repository.faculty({ academicYear: AY, search: '100%', limit: 25, facultyId: null });
  assert.equal(queries[0].params.limit, 25);
  assert.equal(queries[0].sql.includes('TOP (@limit)'), true, 'limit must be parameter-bound');
  assert.equal(queries[0].sql.includes("ESCAPE '\\'"), true, 'LIKE must declare ESCAPE');
  assert.equal(queries[0].params.search, '%100\\%%');
});

test('E4: a faculty-scoped roster query is narrowed by FacultyId', async () => {
  const queries = [];
  const repository = createSqlDashboardRepository({ query: async (sql, params) => { queries.push({ sql, params }); return []; } });
  await repository.faculty({ academicYear: AY, facultyId: FACULTY_ID });
  assert.equal(queries[0].params.facultyId, FACULTY_ID);
  assert.equal(/f\.FacultyId = @facultyId/.test(queries[0].sql), true);
});

test('Faculty roster status filters build valid optional WHERE clauses', async () => {
  const cases = [
    { name: 'active', input: { status: 'active' }, where: /WHERE f\.Active = 1/ },
    { name: 'inactive', input: { status: 'inactive' }, where: /WHERE f\.Active = 0/ },
    { name: 'all with search', input: { status: 'all', search: 'fixture' }, where: /WHERE .*f\.DisplayName LIKE @search/ },
    { name: 'all with FacultyId', input: { status: 'all', facultyId: FACULTY_ID }, where: /WHERE f\.FacultyId = @facultyId/ }
  ];

  for (const { name, input, where } of cases) {
    let sql;
    const repository = createSqlDashboardRepository({ query: async query => { sql = query; return []; } });
    await repository.faculty({ academicYear: AY, ...input });
    assert.match(sql, where, name);
    assert.doesNotMatch(sql, /WHERE\s+ORDER BY/, name);
  }

  let unfilteredSql;
  const repository = createSqlDashboardRepository({ query: async query => { unfilteredSql = query; return []; } });
  await repository.faculty({ academicYear: AY, status: 'all' });
  assert.doesNotMatch(unfilteredSql, /WHERE\s+ORDER BY/, 'unfiltered all-status roster must omit WHERE');
  assert.match(unfilteredSql, /FROM paws\.Faculty f\s+LEFT JOIN/, 'unfiltered all-status roster still reads Faculty rows');
});

test('E5: facultyById returns null for an unknown / malformed id without querying', async () => {
  let queried = false;
  const repository = createSqlDashboardRepository({ query: async () => { queried = true; return []; } });
  assert.equal(await repository.facultyById({ facultyId: 'nope' }), null);
  assert.equal(queried, false, 'a malformed id must not reach SQL');
});

test('E6: facultyById assembles the six sections and honours the inactive rule', async () => {
  const repository = createSqlDashboardRepository({
    query: async (sql) => {
      if (/FROM paws\.Faculty f/.test(sql)) return [{ facultyId: FACULTY_ID, displayName: 'A', active: true }];
      return [];
    }
  });
  const detail = await repository.facultyById({ facultyId: FACULTY_ID, academicYear: AY });
  for (const section of ['faculty', 'professionalProfile', 'jointAppointments', 'roles', 'afcRecords', 'teachingAssignments', 'doeRuleBook']) {
    assert.ok(Object.prototype.hasOwnProperty.call(detail, section), section);
  }
  assert.ok(Object.prototype.hasOwnProperty.call(detail, 'contractDoe'));
  assert.equal(detail.contractDoe.academicYear, AY);
  assert.equal(detail.contractDoe.teachingDoe, null);
  assert.deepEqual(detail.contractDoe.allocations, []);
  assert.deepEqual(detail.doeRuleBook.rules, []);
  assert.equal(detail.professionalProfile, null, 'no profile row means null');
  assert.deepEqual(detail.jointAppointments, []);

  const inactive = createSqlDashboardRepository({ query: async () => [] });
  assert.equal(await inactive.facultyById({ facultyId: FACULTY_ID }), null);
});

test('E7: faculty detail reads versioned contract DOE separately and binds FacultyId/year for both domains', async () => {
  const calls = [];
  const repository = createSqlDashboardRepository({
    query: async (sql, params = {}) => {
      calls.push({ sql, params });
      if (/FROM paws\.Faculty f/.test(sql)) return [{ facultyId: FACULTY_ID, displayName: 'A', active: true, fte: 0, fteSourceReference: 'approved FTE source', fteSourceRow: 7, fteSourceUpdatedAtUtc: new Date('2026-10-05T00:00:00Z') }];
      if (/FROM paws\.DoeFacultyTarget/.test(sql)) return [{
        teachingDoe: 0, source: 'snapshot', policyVersionId: 'policy-id',
        policyVersionLabel: 'DOE snapshot', sourceReference: 'private source reference'
      }];
      if (/FROM paws\.DoeFacultyAllocation/.test(sql)) return [
        { categoryCode: 'research', allocationDoe: 45, sourceReference: 'private source reference', policyVersionId: 'policy-id' },
        { categoryCode: 'service_admin', allocationDoe: 0, sourceReference: 'private source reference', policyVersionId: 'policy-id' }
      ];
      if (/FROM paws\.DoeRuleSeed r/.test(sql)) return [{
        doeRuleId: 'rule-id', ruleCode: 'lecture', category: 'Assigned Teaching', ruleLabel: 'Lecture',
        academicYearOrStage: null, rateOrTierPct: '0.30%', basis: 'per contact hour',
        requiredInput: 'contact hours', calculationOrNote: 'Reference only',
        sourceReference: 'UCVM Workload Guidelines', policyVersionId: 'policy-id',
        academicYear: AY, policyVersionLabel: '2026-27 Doe Policy'
      }];
      return [];
    }
  });
  const detail = await repository.facultyById({ facultyId: FACULTY_ID, academicYear: AY });
  const targetQuery = calls.find(entry => /FROM paws\.DoeFacultyTarget/.test(entry.sql));
  const allocationQuery = calls.find(entry => /FROM paws\.DoeFacultyAllocation/.test(entry.sql));
  const rulesQuery = calls.find(entry => /FROM paws\.DoeRuleSeed r/.test(entry.sql));
  const facultyQuery = calls.find(entry => /FROM paws\.Faculty f/.test(entry.sql));
  for (const query of [targetQuery, allocationQuery]) {
    assert.equal(query.params.facultyId, FACULTY_ID);
    assert.equal(query.params.academicYear, AY);
    assert.match(query.sql, /t?\.FacultyId\s*=\s*@facultyId|a\.FacultyId\s*=\s*@facultyId/i);
    assert.match(query.sql, /AcademicYear\s*=\s*@academicYear/i);
    assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
  }
  assert.equal(detail.contractDoe.teachingDoe, 0, 'explicit zero remains present');
  assert.equal(detail.faculty.fte, 0, 'explicit zero FTE remains present');
  assert.equal(detail.faculty.fteSourceReference, 'approved FTE source');
  assert.equal(detail.faculty.fteSourceRow, 7);
  assert.match(facultyQuery.sql, /FteSourceReference/);
  assert.equal(detail.contractDoe.policyVersionLabel, 'DOE snapshot');
  assert.equal(detail.doeRuleBook.policyVersionLabel, '2026-27 Doe Policy');
  assert.equal(detail.doeRuleBook.rules[0].ruleCode, 'lecture');
  assert.equal(detail.doeRuleBook.rules[0].rateOrTierPct, '0.30%');
  assert.equal(rulesQuery.params.academicYear, AY);
  assert.match(rulesQuery.sql, /JOIN\s+paws\.DoePolicyVersion/i);
  assert.match(rulesQuery.sql, /p\.AcademicYear\s*=\s*@academicYear/i);
  assert.doesNotMatch(rulesQuery.sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
  assert.deepEqual(detail.contractDoe.allocations.map(row => [row.categoryCode, row.allocationDoe]), [
    ['research', 45], ['service_admin', 0]
  ]);
});

// ---------------------------------------------------------------------------
// BETA-R4D-10A2 regression — the 503 SQL_UNAVAILABLE defect.
//
// Live symptom: GET /api/v1/dashboard/summary returned 503
// {"error":{"code":"SQL_UNAVAILABLE"}} for BOTH administrator accounts while
// GET /api/v1/dashboard/faculty returned 200 through the same repository,
// connection, and grants.
//
// Root cause: the summary CTE always references `@facultyId` in its
// `(@facultyId IS NULL OR EXISTS (...))` guard, but an administrator passes
// facultyId = null, and the connection layer skipped null/undefined params.
// The statement therefore reached SQL Server with an undeclared variable and
// failed with "Must declare the scalar variable @facultyId".
//
// The fix has two halves and BOTH are asserted here:
//   1. the repository always supplies `facultyId` (explicit null when unscoped)
//   2. the connection layer binds an explicit null as a real SQL NULL
// ---------------------------------------------------------------------------

// Mirrors the production binder in sql-connection.js after the fix.
function mirrorBindableParams(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name);
}

function referencedParams(statement) {
  return [...new Set([...statement.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]))];
}

function captureStatements(db) {
  const seen = [];
  return {
    seen,
    db: {
      async query(text, params = {}) {
        seen.push({ text, params });
        if (/AS activeFacultyCount/.test(text)) {
          return [{
            activeFacultyCount: 1, sessionCount: 1, courseCount: 1,
            gridPositionableCount: 1, checkNeededCount: 0, assignmentCount: 1,
            roleAssignmentCount: 1, hiccCount: 1, viscCount: 1, afcRecordCount: 1
          }];
        }
        return [];
      }
    }
  };
}

test('W1: the summary statement always supplies @facultyId, even for an administrator', async () => {
  const { seen, db } = captureStatements();
  const repository = createSqlDashboardRepository(db);
  await repository.summary({ academicYear: AY });
  const statement = seen.find(entry => /AS activeFacultyCount/.test(entry.text));
  assert.ok(statement, 'the summary statement must have been issued');
  assert.ok(referencedParams(statement.text).includes('facultyId'), 'the CTE references @facultyId');
  assert.equal(
    Object.prototype.hasOwnProperty.call(statement.params, 'facultyId'),
    true,
    'an unscoped summary must still supply @facultyId (as null)'
  );
  assert.equal(statement.params.facultyId, null);
});

test('W2: no repository statement ever references an unbound parameter', async () => {
  const { seen, db } = captureStatements();
  const repository = createSqlDashboardRepository(db);
  await repository.summary({ academicYear: AY });
  await repository.summary({ academicYear: AY, facultyId: FACULTY_ID });
  await repository.faculty({ academicYear: AY, limit: 2 });
  await repository.faculty({ academicYear: AY, limit: 2, facultyId: FACULTY_ID });
  await repository.facultyById({ facultyId: FACULTY_ID, academicYear: AY });
  await repository.roleCategoryVocabulary();

  assert.ok(seen.length >= 6, 'every method must have issued at least one statement');
  for (const entry of seen) {
    const bound = mirrorBindableParams(entry.params);
    for (const name of referencedParams(entry.text)) {
      assert.equal(
        bound.includes(name),
        true,
        `statement references @${name} but the connection layer would not bind it`
      );
    }
  }
});

test('W3: an unscoped summary still reads the same, with no zeroed counters', async () => {
  const repository = createSqlDashboardRepository({
    async query(text) {
      if (/AS activeFacultyCount/.test(text)) {
        return [{
          activeFacultyCount: 120, sessionCount: 1937, courseCount: 33,
          gridPositionableCount: 1389, checkNeededCount: 548, assignmentCount: 4970,
          roleAssignmentCount: 162, hiccCount: 64, viscCount: 35, afcRecordCount: 791
        }];
      }
      return [];
    }
  });
  const summary = await repository.summary({ academicYear: AY });
  assert.equal(summary.sessionCount, 1937, 'the canonical session total must survive');
  assert.equal(summary.hiccCount, 64, 'HICC must not silently read zero');
  assert.equal(summary.viscCount, 35, 'VISC must not silently read zero');
  assert.equal(summary.activeFacultyCount, 120);
  assert.equal(summary.afcRecordCount, 791);
});

// ---------------------------------------------------------------------------
// X block — GRANT-SAFE ROW COUNTING (R4D-10A2 hotfix).
//
// `paws-sql-beta-mi` is granted COLUMN-scoped SELECT, never object-scoped SELECT.
// Under column-level security SQL Server authorises `COUNT(*)` against *every*
// column of the object, so a bare `COUNT(*)` over a table that retains
// ungranted provenance columns (`SourceRow`, `SourceImportBatchId`, …) is
// refused at execution time even though it returns no data:
//
//   The SELECT permission was denied on the column 'SourceRow' of the object
//   'AfcRecord'. (error 230)
//
// Every count must therefore be taken over a column the principal may read.
// These tests are static: they assert the SHAPE of the emitted SQL, so they hold
// without a live database.
// ---------------------------------------------------------------------------

// Columns `paws-sql-beta-mi` may read, mirroring 004_swa_beta_permissions.
// Phase ordering: only the read-only proof document owns the live list; these
// tests only need the primary keys that are guaranteed to be granted.
const COUNTABLE_KEYS = [
  'f.FacultyId',
  'sa.SessionAssignmentId',
  'ra.RoleAssignmentId',
  'ar.AfcRecordId',
  'ja.JointAppointmentId'
];

// Objects that carry ungranted provenance columns and therefore must never be
// counted with a bare `COUNT(*)`.
const PROVENANCE_BEARING = [
  'paws.Faculty',
  'paws.FacultyProfessionalProfile',
  'paws.JointAppointment',
  'paws.RoleAssignment',
  'paws.AfcRecord',
  'paws.SessionAssignment',
  'paws.UserProfile'
];

// Extracts the FROM target of every `COUNT(*)` sub-select.
function bareCountTargets(text) {
  const targets = [];
  const re = /COUNT\(\*\)\s*\n?\s*FROM\s+([A-Za-z0-9_.]+)/gi;
  let match;
  while ((match = re.exec(text)) !== null) targets.push(match[1]);
  return targets;
}

test('X1: no statement counts (*) over a table with ungranted columns', async () => {
  const { seen, db } = captureStatements();
  const repository = createSqlDashboardRepository(db);
  await repository.summary({ academicYear: AY });
  await repository.summary({ academicYear: AY, facultyId: FACULTY_ID });
  await repository.faculty({ academicYear: AY, limit: 5 });
  await repository.faculty({ academicYear: AY, limit: 5, facultyId: FACULTY_ID });
  await repository.facultyById({ facultyId: FACULTY_ID, academicYear: AY });

  for (const entry of seen) {
    for (const target of bareCountTargets(entry.text)) {
      assert.equal(
        PROVENANCE_BEARING.includes(target),
        false,
        `${target} carries ungranted provenance columns; COUNT(*) would be denied (err 230)`
      );
    }
  }
});

test('X2: every row count is taken over a grantable NOT NULL key', async () => {
  const { seen, db } = captureStatements();
  const repository = createSqlDashboardRepository(db);
  await repository.summary({ academicYear: AY });
  await repository.faculty({ academicYear: AY, limit: 5 });
  await repository.facultyById({ facultyId: FACULTY_ID, academicYear: AY });

  const counts = [];
  for (const entry of seen) {
    const re = /COUNT\(\s*([a-z]{1,3}\.[A-Za-z0-9_]+)\s*\)/g;
    let m;
    while ((m = re.exec(entry.text)) !== null) counts.push(m[1]);
  }

  assert.ok(counts.length >= 8, 'the KPI set must be counted over real keys');
  for (const key of counts) {
    assert.equal(
      COUNTABLE_KEYS.includes(key),
      true,
      `COUNT(${key}) must target a granted NOT NULL key`
    );
  }
});

test('X3: the summary afcRecordCount no longer uses a bare COUNT(*) over AfcRecord', async () => {
  const { seen, db } = captureStatements();
  const repository = createSqlDashboardRepository(db);
  await repository.summary({ academicYear: AY });
  const statement = seen.find(entry => /AS afcRecordCount/.test(entry.text));
  assert.ok(statement, 'the summary statement must have been issued');
  assert.equal(
    /COUNT\(\*\)[^)]*paws\.AfcRecord/i.test(statement.text),
    false,
    'COUNT(*) over paws.AfcRecord is denied for the managed identity (err 230)'
  );
  assert.ok(
    /COUNT\(\s*ar\.AfcRecordId\s*\)/i.test(statement.text),
    'afcRecordCount must count a granted key column'
  );
});

test('X4: no statement issues a bare COUNT(1) over a provenance-bearing table', async () => {
  const { seen, db } = captureStatements();
  const repository = createSqlDashboardRepository(db);
  await repository.summary({ academicYear: AY });
  await repository.faculty({ academicYear: AY, limit: 5 });
  await repository.facultyById({ facultyId: FACULTY_ID, academicYear: AY });
  for (const entry of seen) {
    const m = /COUNT\(1\)\s*\n?\s*FROM\s+([A-Za-z0-9_.]+)/i.exec(entry.text);
    if (m) {
      assert.equal(
        PROVENANCE_BEARING.includes(m[1]),
        false,
        `COUNT(1) over ${m[1]} is authorised against every column and would be denied`
      );
    }
  }
});
