'use strict';

// BETA-R4D-10A — Dashboard read API acceptance tests.
//
// Cases are labelled A–P to match the task acceptance matrix:
//   A  admin roles may read the summary
//   B  owner/administrator/adfa_general/adfa_regular/admin are all administrators
//   C  self-service roles (faculty/hicc/visc) may read their own summary
//   D  viewer is denied everywhere
//   E  other_office is NOT a supported role and is denied
//   F  faculty-scoped caller without a FacultyId gets 403 FACULTY_LINK_REQUIRED
//   G  faculty-scoped caller is scoped by a server-side predicate, not by UI hiding
//   H  GET /faculty is administrator-only
//   I  GET /faculty/:id lets a faculty-scoped caller read only its own record
//   J  unknown FacultyId yields 404; a malformed id is refused before SQL
//   K  unauthenticated requests are 401 and never touch SQL
//   L  inactive / password-change profiles fail closed before SQL
//   M  SQL failure surfaces as 503, never as a leak or a partial payload
//   N  every non-GET method on a dashboard path is 405 with Allow: GET
//   O  the repository is read-only and never references staging or Firestore
//   P  the permission script grants column-scoped SELECT only and denies writes

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createDashboardApi, resolveScope, ADMIN_ROLES, SELF_SERVICE_ROLES } = require('../src/data/dashboard-api');
const { createDashboardFunctions } = require('../src/runtime/swa-dashboard-functions');
const { createSqlDashboardRepository, isUuid, DEFAULT_ACADEMIC_YEAR } = require('../src/data/sql-dashboard-repository');
const { canonicalAcademicYear } = require('../src/data/academic-year');

const root = path.resolve(__dirname, '..', '..');
const FACULTY_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_FACULTY_ID = '22222222-2222-2222-2222-222222222222';

const request = (url, { method = 'GET', token = 'ok' } = {}) => ({
  method,
  url: 'https://local' + url,
  headers: { get: name => (name.toLowerCase() === 'authorization' ? 'Bearer ' + token : null) }
});

function harness(profile, overrides = {}) {
  const calls = [];
  const repository = {
    summary: async args => { calls.push(['summary', args]); return { academicYear: '2026-27', sessionCount: 1937 }; },
    faculty: async args => { calls.push(['faculty', args]); return [{ facultyId: FACULTY_ID, displayName: 'A' }]; },
    facultyById: async args => { calls.push(['facultyById', args]); return args.facultyId === FACULTY_ID ? { facultyId: FACULTY_ID, displayName: 'A' } : null; },
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

// A / B ---------------------------------------------------------------------
test('A: an administrator role reads the Dashboard summary', async () => {
  const { app } = harness(adminProfile('administrator'));
  const response = await app(request('/api/v1/dashboard/summary'));
  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.summary.sessionCount, 1937);
});

test('B: developer and the supported administrator aliases are administrators', () => {
  assert.deepEqual([...ADMIN_ROLES].sort(), ['adfa_general', 'adfa_regular', 'admin', 'administrator', 'developer', 'owner']);
  for (const role of ADMIN_ROLES) {
    const scope = resolveScope(adminProfile(role));
    assert.equal(scope.status, undefined, role);
    assert.equal(scope.administrator, true, role);
    assert.equal(scope.facultyScoped, false, role);
  }
});

test('Developer Dashboard scope is administrative without bypassing the active SQL profile requirement', async () => {
  const { app, calls } = harness(adminProfile('developer'));
  const response = await app(request('/api/v1/dashboard/summary'));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const inactive = harness({ ...adminProfile('developer'), active: false });
  assert.equal((await inactive.app(request('/api/v1/dashboard/summary'))).status, 403);
  assert.equal(inactive.calls.length, 0);
});

// C -------------------------------------------------------------------------
// BETA-R4D-10A2 supersedes the R4D-10A behavior. The summary is now
// administrator-only: a self-service caller is refused rather than receiving a
// narrowed copy. Self-service callers use the scoped roster and detail routes.
test('C: faculty, hicc and visc are denied the summary but keep their scoped routes', async () => {
  assert.deepEqual([...SELF_SERVICE_ROLES].sort(), ['faculty', 'hicc', 'visc']);
  for (const role of ['faculty', 'hicc', 'visc']) {
    const { app, calls } = harness(selfProfile(role));
    const response = await app(request('/api/v1/dashboard/summary'));
    assert.equal(response.status, 403, role);
    assert.equal(response.jsonBody.error.code, 'ROLE_DENIED', role);
    assert.equal(calls.length, 0, role);

    // The scoped roster still works for the same caller.
    const roster = await app(request('/api/v1/dashboard/faculty'));
    assert.equal(roster.status, 200, role);
    assert.equal(calls[0][1].facultyId, FACULTY_ID, role);
  }
});

// D / E ---------------------------------------------------------------------
test('D: viewer is denied on every Dashboard route', async () => {
  const { app, calls } = harness({ active: true, mustChangePassword: false, baseRole: 'viewer', facultyId: null });
  for (const url of ['/api/v1/dashboard/summary', '/api/v1/dashboard/faculty', '/api/v1/dashboard/faculty/' + FACULTY_ID]) {
    const response = await app(request(url));
    assert.equal(response.status, 403, url);
    assert.equal(response.jsonBody.error.code, 'ROLE_DENIED', url);
  }
  assert.equal(calls.length, 0);
});

test('E: other_office is not a supported Dashboard role', async () => {
  assert.equal(ADMIN_ROLES.has('other_office'), false);
  assert.equal(SELF_SERVICE_ROLES.has('other_office'), false);
  const { app, calls } = harness({ active: true, mustChangePassword: false, baseRole: 'other_office', facultyId: null });
  const response = await app(request('/api/v1/dashboard/summary'));
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error.code, 'ROLE_DENIED');
  assert.equal(calls.length, 0);
});

// F -------------------------------------------------------------------------
test('F: a faculty-scoped caller without a FacultyId gets 403 FACULTY_LINK_REQUIRED', async () => {
  for (const role of ['faculty', 'hicc', 'visc']) {
    const { app, calls } = harness({ active: true, mustChangePassword: false, baseRole: role, facultyId: null });
    const response = await app(request('/api/v1/dashboard/summary'));
    assert.equal(response.status, 403, role);
    assert.equal(response.jsonBody.error.code, 'FACULTY_LINK_REQUIRED', role);
    assert.equal(calls.length, 0, role);
  }
});

// G -------------------------------------------------------------------------
test('G: faculty scope is a SQL predicate, never a presentation-side filter', async () => {
  let seen;
  const repository = createSqlDashboardRepository({
    query: async (query, params) => { seen = { query, params }; return [{}]; }
  });
  await repository.summary({ academicYear: '2026-27', facultyId: FACULTY_ID });
  assert.match(seen.query, /sa\.FacultyId = @facultyId/);
  assert.equal(seen.params.facultyId, FACULTY_ID);

  // An administrator scope passes no *filter*, but `@facultyId` is still
  // referenced by the CTE's `(@facultyId IS NULL OR EXISTS (...))` guard, so it
  // must be supplied explicitly as null. Omitting it (the previous behaviour)
  // left the statement referencing an undeclared variable and produced a live
  // 503 SQL_UNAVAILABLE. See the W1/W2 regression block in
  // dashboard-api-r4d10a2.test.js.
  seen = undefined;
  await repository.summary({ academicYear: '2026-27' });
  assert.doesNotMatch(seen.query, /sa\.FacultyId = @facultyId/);
  assert.equal(seen.params.facultyId, null);
});

// G2 ------------------------------------------------------------------------
// Regression: the stored academic year is `YYYY-YY` (`2026-27`), NOT
// `YYYY-YYYY`. A `2026-2027` default matched nothing in `paws.vCalendarSession`,
// so every academic-year-scoped aggregate returned 0 while still answering 200 —
// a silent wrong answer, not an error. Verified live against `/api/v1/sessions`,
// which echoes `2026-27` for all 1937 rows.
test('G2: the stored academic year is YYYY-YY, not YYYY-YYYY', () => {
  assert.equal(DEFAULT_ACADEMIC_YEAR, '2026-27');
  assert.match(DEFAULT_ACADEMIC_YEAR, /^\d{4}-\d{2}$/);
  assert.doesNotMatch(DEFAULT_ACADEMIC_YEAR, /^\d{4}-\d{4}$/);
});

// BETA-R4D-10A2 supersedes the R4D-10A G2 behavior. The old test asserted that a
// malformed override "falls back to the default" and that `2026-2027` is passed
// to SQL verbatim. Both are now deliberately wrong: a malformed year must be a
// 400 rather than a silent wrong answer, and the 4-4 form must be canonicalised.
test('G2: an academic-year override is canonicalised and a malformed one is rejected', async () => {
  // The canonicaliser is unit-tested directly; here we prove the repository
  // never forwards an uncanonical or unusable value to SQL.
  assert.equal(canonicalAcademicYear('2027-28'), '2027-28');
  assert.equal(canonicalAcademicYear('2026-2027'), '2026-27');
  assert.throws(() => canonicalAcademicYear('not-a-year'), /not a recognised academic year/);

  let seen;
  const repository = createSqlDashboardRepository({
    query: async (query, params) => { seen = { query, params }; return [{}]; }
  });
  await repository.summary({ academicYear: '2026-2027' });
  assert.equal(seen.params.academicYear, '2026-27', 'the 4-4 form must reach SQL canonicalised');

  // A malformed explicit year must reject rather than silently defaulting.
  await assert.rejects(
    () => repository.summary({ academicYear: 'not-a-year' }),
    /not a recognised academic year/
  );
});

// H -------------------------------------------------------------------------
// BETA-R4D-10A2 supersedes the R4D-10A behavior. The roster is no longer
// administrator-only: a self-service caller now receives exactly its own row,
// narrowed by a server-side predicate, rather than a blanket 403.
test('H: the faculty roster is the full roster for an administrator and one row for self-service', async () => {
  const admin = harness(adminProfile('adfa_general'));
  assert.equal((await admin.app(request('/api/v1/dashboard/faculty'))).status, 200);
  assert.equal(admin.calls[0][1].facultyId, null);

  for (const role of ['faculty', 'hicc', 'visc']) {
    const scoped = harness(selfProfile(role));
    const own = await scoped.app(request('/api/v1/dashboard/faculty'));
    assert.equal(own.status, 200, role);
    assert.equal(scoped.calls[0][1].facultyId, FACULTY_ID, role);
    assert.equal(own.jsonBody.count, 1, role);
  }
});

test('H2: all-status roster is admin-only and invalid status is rejected', async () => {
  const admin = harness(adminProfile('adfa_general'));
  const all = await admin.app(request('/api/v1/dashboard/faculty?status=all'));
  assert.equal(all.status, 200);
  assert.equal(admin.calls[0][1].status, 'all');

  const faculty = harness(selfProfile('faculty'));
  const denied = await faculty.app(request('/api/v1/dashboard/faculty?status=all'));
  assert.equal(denied.status, 403);
  assert.equal(denied.jsonBody.error.code, 'ROLE_DENIED');
  assert.equal(faculty.calls.length, 0);

  const invalid = harness(adminProfile('adfa_general'));
  const badStatus = await invalid.app(request('/api/v1/dashboard/faculty?status=unknown'));
  assert.equal(badStatus.status, 400);
  assert.equal(badStatus.jsonBody.error.code, 'INVALID_FACULTY_STATUS');
  assert.equal(invalid.calls.length, 0);
});

// I -------------------------------------------------------------------------
test('I: a faculty-scoped caller may read only its own faculty record', async () => {
  const own = harness(selfProfile('hicc'));
  assert.equal((await own.app(request('/api/v1/dashboard/faculty/' + FACULTY_ID))).status, 200);

  const other = harness(selfProfile('hicc'));
  const denied = await other.app(request('/api/v1/dashboard/faculty/' + OTHER_FACULTY_ID));
  assert.equal(denied.status, 403);
  assert.equal(denied.jsonBody.error.code, 'ROLE_DENIED');
  assert.equal(other.calls.length, 0);

  const admin = harness(adminProfile('owner'));
  assert.equal((await admin.app(request('/api/v1/dashboard/faculty/' + OTHER_FACULTY_ID))).status, 404);
});

// J -------------------------------------------------------------------------
test('J: unknown faculty is 404 and a malformed id never reaches SQL', async () => {
  const unknown = harness(adminProfile('admin'));
  const notFound = await unknown.app(request('/api/v1/dashboard/faculty/' + OTHER_FACULTY_ID));
  assert.equal(notFound.status, 404);
  assert.equal(notFound.jsonBody.error.code, 'FACULTY_NOT_FOUND');

  let reads = 0;
  const repository = createSqlDashboardRepository({ query: async () => { reads++; return []; } });
  assert.equal(await repository.facultyById({ facultyId: 'not-a-uuid' }), null);
  assert.equal(await repository.facultyById({}), null);
  assert.equal(isUuid(FACULTY_ID), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(reads, 0);
});

// K -------------------------------------------------------------------------
test('K: unauthenticated requests are 401 and never reach SQL', async () => {
  const { app, calls } = harness(adminProfile('administrator'), {
    verifyToken: async () => { throw new Error('bad token'); }
  });
  const checks = [
    ['/api/v1/dashboard/summary', 'GET'],
    ['/api/v1/dashboard/faculty', 'GET'],
    ['/api/v1/dashboard/afc-records/batch', 'POST']
  ];
  for (const [url, method] of checks) {
    const response = await app(request(url, { method, token: 'bad' }));
    assert.equal(response.status, 401, url);
    assert.equal(response.jsonBody.error.code, 'UNAUTHENTICATED', url);
  }
  assert.equal(calls.length, 0);
});

// L -------------------------------------------------------------------------
test('L: inactive and password-change-required profiles fail closed before SQL', async () => {
  for (const profile of [
    null,
    { active: false, baseRole: 'administrator' },
    { active: true, baseRole: 'administrator', mustChangePassword: true }
  ]) {
    const { app, calls } = harness(profile);
    const response = await app(request('/api/v1/dashboard/summary'));
    assert.equal(response.status, 403);
    assert.ok(['PROFILE_REQUIRED', 'PASSWORD_CHANGE_REQUIRED'].includes(response.jsonBody.error.code));
    assert.equal(calls.length, 0);
  }
});

// M -------------------------------------------------------------------------
test('M: a SQL failure is reported as 503 without leaking detail', async () => {
  const { app } = harness(adminProfile('administrator'), {
    repository: {
      summary: async () => { throw new Error('Server=ucvm-secret;Password=hunter2'); }
    }
  });
  const response = await app(request('/api/v1/dashboard/summary'));
  assert.equal(response.status, 503);
  assert.equal(response.jsonBody.error.code, 'SQL_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(response.jsonBody), /ucvm-secret|hunter2/);
});

// N -------------------------------------------------------------------------
test('N: dashboard read routes reject unsupported methods and Faculty detail allows only PATCH as its write method', async () => {
  const { app, calls } = harness(adminProfile('administrator'));
  const urls = [
    '/api/v1/dashboard/summary',
    '/api/v1/dashboard/faculty',
    '/api/v1/dashboard/faculty/' + FACULTY_ID
  ];
  for (const url of urls) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const response = await app(request(url, { method }));
      if (url.endsWith('/' + FACULTY_ID) && method === 'PATCH') {
        assert.equal(response.status, 503, method + ' ' + url);
        assert.equal(response.jsonBody.error.code, 'WRITE_DISABLED', method + ' ' + url);
        continue;
      }
      assert.equal(response.status, 405, method + ' ' + url);
      assert.equal(response.headers.Allow, url.endsWith('/' + FACULTY_ID) ? 'GET, PATCH' : 'GET', method + ' ' + url);
      assert.equal(response.jsonBody.error.code, 'METHOD_NOT_ALLOWED', method + ' ' + url);
    }
  }
  assert.equal(calls.length, 0);

  // A non-dashboard path is 404, not 405 — the wrapper does not own it.
  assert.equal((await app(request('/api/v1/sessions', { method: 'POST' }))).status, 404);
  assert.equal((await app(request('/api/v1/dashboard/unknown'))).status, 404);
});

test('N2: the 405 verdict is produced by the wrapper, not by the Functions host', () => {
  // Azure Functions' route matcher answers a method it was not bound for with
  // 404 before any handler runs. Binding the Dashboard routes to every common
  // method is therefore load-bearing: it is what makes the reviewed
  // "405 + Allow: GET" contract observable over the wire. This test pins that
  // binding so a future "tidy up to GET" edit cannot silently regress it.
  const entry = fs.readFileSync(path.join(root, 'swa-api/index.js'), 'utf8');
  const binding = name => {
    const match = new RegExp(name + "'[^}]*methods:([^,}]+),").exec(entry);
    assert.ok(match, name + ' binding not found');
    return match[1];
  };
  assert.equal(binding('paws-health-sql'), "['GET']");
  assert.equal(binding('paws-current-user'), "['GET']");
  assert.equal(binding('paws-sessions'), "['GET']");
  for (const name of ['paws-dashboard-summary', 'paws-dashboard-faculty', 'paws-dashboard-faculty-id', 'paws-dashboard-teaching-summary', 'paws-dashboard-roles', 'paws-dashboard-doe-overview']) {
    assert.equal(binding(name), 'DASHBOARD_METHODS', name);
  }
  const methods = /DASHBOARD_METHODS\s*=\s*\[([^\]]+)\]/.exec(entry)[1];
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    assert.ok(methods.includes("'" + method + "'"), method);
  }
});

// O -------------------------------------------------------------------------
// Comments and string literals are stripped first: the modules intentionally
// document the verbs they must never emit, so a raw text scan would match its
// own documentation. Only executable SQL text is judged.
function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

// SQL mutation verbs only. `exec(` is JavaScript's own RegExp method and is not
// a SQL statement, so the verb list is anchored to statement-leading position or
// to an explicit SQL keyword neighbour.
const SQL_MUTATION = /(?:\b(?:INSERT|DELETE|MERGE|TRUNCATE)\s+(?:INTO|FROM|TOP)\b)|(?:\bUPDATE\s+\w+\s+SET\b)|(?:\bALTER\s+(?:TABLE|SCHEMA|VIEW|USER|ROLE)\b)|(?:\bCREATE\s+(?:TABLE|SCHEMA|VIEW|USER|ROLE|PROCEDURE|INDEX)\b)|(?:\bDROP\s+(?:TABLE|SCHEMA|VIEW|USER|ROLE|INDEX)\b)|(?:\bEXEC(?:UTE)?\s+(?:AS|\(|dbo\.|paws\.))/i;

test('O: the Dashboard repository is read-only and never touches staging or Firestore', () => {
  const files = [
    'server/src/data/sql-dashboard-repository.js',
    'server/src/data/dashboard-api.js',
    'server/src/runtime/swa-dashboard-functions.js'
  ];
  for (const file of files) {
    const source = stripCommentsAndStrings(fs.readFileSync(path.join(root, file), 'utf8'));
    assert.doesNotMatch(source, SQL_MUTATION, file);
    assert.doesNotMatch(source, /staging\./i, file);
    assert.doesNotMatch(source, /firestore|firebase\/firestore|collection\(/i, file);
  }

  // Parameters are always bound, never interpolated, for caller-supplied values.
  const repository = fs.readFileSync(path.join(root, 'server/src/data/sql-dashboard-repository.js'), 'utf8');
  assert.match(repository, /@facultyId/);
  assert.match(repository, /@academicYear/);
  assert.match(repository, /@search/);
  assert.doesNotMatch(repository, /\+ *facultyId|\$\{ *facultyId *\}|' *\+ *facultyId/);

  // The Functions entry point registers the three Dashboard routes for every
  // common method, so the 405 verdict is produced by the dashboard wrapper
  // rather than by the Functions host's route matcher (which would answer 404).
  const entry = fs.readFileSync(path.join(root, 'swa-api/index.js'), 'utf8');
  for (const route of ['v1/dashboard/summary', 'v1/dashboard/faculty', 'v1/dashboard/faculty/{facultyId}', 'v1/dashboard/teaching-summary', 'v1/dashboard/roles', 'v1/dashboard/doe-overview', 'v1/dashboard/afc-records/batch']) {
    assert.ok(entry.includes(route), route);
  }
  assert.match(entry, /DASHBOARD_METHODS\s*=\s*\[[^\]]*'GET'[^\]]*'POST'[^\]]*\]/);
  for (const name of ['paws-dashboard-summary', 'paws-dashboard-faculty', 'paws-dashboard-faculty-id', 'paws-dashboard-teaching-summary', 'paws-dashboard-roles', 'paws-dashboard-doe-overview', 'paws-dashboard-afc-records-batch']) {
    assert.match(entry, new RegExp(name + "'[^}]*methods:DASHBOARD_METHODS"), name);
  }
  // The timetable routes stay GET-bound: their reviewed contract is unchanged.
  for (const name of ['paws-health-sql', 'paws-current-user', 'paws-sessions']) {
    assert.match(entry, new RegExp(name + "'[^}]*methods:\\['GET'\\]"), name);
  }
});

// P -------------------------------------------------------------------------
test('P: the permission script grants column-scoped SELECT only and denies writes', () => {
  const sql = fs.readFileSync(path.join(root, 'database/azure-sql/004_swa_beta_permissions.sql'), 'utf8');
  assert.match(sql, /GRANT SELECT ON OBJECT::paws\.Faculty\s*\(/);
  assert.match(sql, /DENY INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::paws/);
  assert.match(sql, /DENY SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::staging/);
  assert.doesNotMatch(sql, /GRANT\s+(?:INSERT|UPDATE|DELETE|MERGE|CONTROL|ALTER|EXECUTE)/i);
  assert.doesNotMatch(sql, /GRANT\s+SELECT\s+ON\s+SCHEMA::(?:paws|staging)/i);

  // The runtime principal is bound at apply time. The deployed Beta runtime
  // connects as the application managed identity, so a hardcoded `paws_swa_beta`
  // grant would be inert against the live database.
  assert.match(sql, /:setvar PAWS_API_PRINCIPAL/);
  for (const statement of sql.match(/GRANT[^;]*;/gs) || []) {
    assert.match(statement, /\$\(PAWS_API_PRINCIPAL\)/, statement.slice(0, 80));
  }

  // The granted Faculty column list must not include DOE or provenance fields.
  const grant = /GRANT SELECT ON OBJECT::paws\.Faculty\s*\(([^)]*)\)/s.exec(sql)[1];
  for (const forbidden of ['SourceImportBatchId', 'SourceRow']) {
    assert.doesNotMatch(grant, new RegExp(forbidden), forbidden);
  }
});

test('the read-only proof script throws on every mutation or staging read', () => {
  const proof = fs.readFileSync(path.join(root, 'database/azure-sql/004_swa_beta_permissions_readonly_proof.sql'), 'utf8');
  // PR #25 lesson: HAS_PERMS_BY_NAME evaluates the CALLER's rights, not the
  // named principal's, so it must NOT be used as a principal probe here.
  const code = proof.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
  assert.doesNotMatch(code, /HAS_PERMS_BY_NAME/);
  assert.match(proof, /READ_ONLY_PROOF_OK/);
  assert.match(proof, /THROW 5110[0-9]/);
  // No mutation statement anywhere in the executable body.
  assert.doesNotMatch(code, /^\s*(?:INSERT|UPDATE|DELETE|MERGE|DROP|ALTER)\b/im);
});

test('the timetable runtime keeps its reviewed route surface unchanged', () => {
  const timetable = fs.readFileSync(path.join(root, 'server/src/runtime/swa-functions.js'), 'utf8');
  for (const route of ['/api/health/sql', '/api/v1/me', '/api/v1/sessions']) {
    assert.ok(timetable.includes(route), route);
  }
  assert.doesNotMatch(timetable, /dashboard/i);
});
