'use strict';
// Teaching Schedule HICC–CC / VISC directory: role mapping, effective dates, API security and SQL safety.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { classify, calgaryDate, effectivePeriods } = require('../src/roles/role-effective-status');
const { createLeadershipDirectoryApi, buildDirectory } = require('../src/roles/leadership-directory-api');
const { createSqlLeadershipDirectoryRepository, ROLE_TYPES } = require('../src/data/sql-leadership-directory-repository');
const { createLeadershipDirectoryFunctions } = require('../src/runtime/swa-leadership-directory-functions');

const legacy = (effectiveDate, expirationDate) => ({ hasSchedule: false, effectiveDate, expirationDate });
const schedule = periods => ({ hasSchedule: true, periodsJson: JSON.stringify(periods) });
const row = (roleType, scope, facultyName, source = legacy(null, null), extra = {}) => ({
  roleType, recordedScope: scope, courseCode: null, facultyName, facultyKey: facultyName.toLowerCase(),
  effectiveDate: source.effectiveDate ?? null, expirationDate: source.expirationDate ?? null,
  hasSchedule: source.hasSchedule ? 1 : 0, periodsJson: source.periodsJson ?? null, ...extra
});

// ------------------------------------------------------------------ effective dates
test('active today, ending today stays active, ending yesterday is inactive', () => {
  const asOf = '2026-10-22';
  assert.deepEqual(classify(schedule([{ startDate: '2026-07-01', endDate: '2027-06-30' }]), asOf), { status: 'active', startDate: '2026-07-01', endDate: '2027-06-30' });
  assert.equal(classify(schedule([{ startDate: '2026-07-01', endDate: '2026-10-22' }]), asOf).status, 'active');
  assert.equal(classify(schedule([{ startDate: '2026-10-22', endDate: '2026-10-22' }]), asOf).status, 'active');
  const ended = classify(schedule([{ startDate: '2026-07-01', endDate: '2026-10-21' }]), asOf);
  assert.deepEqual(ended, { status: 'inactive', startDate: null, endDate: '2026-10-21', nextStartDate: null });
});

test('future start is upcoming with its own period dates', () => {
  assert.deepEqual(classify(schedule([{ startDate: '2027-01-05', endDate: '2027-06-30' }]), '2026-10-22'), { status: 'upcoming', startDate: '2027-01-05', endDate: '2027-06-30' });
  assert.deepEqual(classify(legacy('2027-07-01', null), '2026-10-22'), { status: 'upcoming', startDate: '2027-07-01', endDate: null });
});

test('multiple periods: the current period end is reported, a gap is inactive with the resume date', () => {
  const periods = [{ startDate: '2026-07-01', endDate: '2026-09-30' }, { startDate: '2026-10-15', endDate: '2026-12-31' }, { startDate: '2027-01-15', endDate: '2027-06-30' }];
  assert.deepEqual(classify(schedule(periods), '2026-11-01'), { status: 'active', startDate: '2026-10-15', endDate: '2026-12-31' }, 'not the maximum later end');
  assert.deepEqual(classify(schedule(periods), '2026-10-05'), { status: 'inactive', startDate: null, endDate: '2026-09-30', nextStartDate: '2026-10-15' });
  assert.deepEqual(classify(schedule(periods), '2027-07-01'), { status: 'inactive', startDate: null, endDate: '2027-06-30', nextStartDate: null });
});

test('null end is open-ended; no dates at all means dates needed, never active or inactive', () => {
  assert.deepEqual(classify(schedule([{ startDate: '2026-07-01', endDate: null }]), '2030-01-01'), { status: 'active', startDate: '2026-07-01', endDate: null });
  assert.deepEqual(classify(legacy(null, null), '2026-10-22'), { status: 'dates-needed', startDate: null, endDate: null });
  assert.deepEqual(classify(legacy(null, '2027-06-30'), '2026-10-22'), { status: 'dates-needed', startDate: null, endDate: '2027-06-30' });
  assert.equal(classify(legacy(null, '2026-06-30'), '2026-10-22').status, 'inactive', 'a recorded end in the past is enough to say it ended');
  assert.equal(classify(legacy('2026-07-01', null), '2026-10-22').status, 'active');
});

test('the schedule takes precedence over legacy dates; an explicitly empty schedule is inactive', () => {
  const both = { hasSchedule: true, periodsJson: JSON.stringify([{ startDate: '2025-07-01', endDate: '2026-06-30' }]), effectiveDate: '2026-07-01', expirationDate: '2027-06-30' };
  assert.equal(classify(both, '2026-10-22').status, 'inactive');
  assert.deepEqual(classify(schedule([]), '2026-10-22'), { status: 'inactive', startDate: null, endDate: null });
  assert.deepEqual(effectivePeriods({ hasSchedule: true, periodsJson: '{bad' }), null);
  assert.equal(classify({ hasSchedule: true, periodsJson: '{bad' }, '2026-10-22').status, 'dates-needed', 'unreadable schedule is not guessed');
  assert.equal(classify({ hasSchedule: true, periodsJson: JSON.stringify([{ startDate: '2026-13-01', endDate: null }]) }, '2026-10-22').status, 'dates-needed');
});

test('Calgary date: midnight and historical daylight-saving boundaries use America/Edmonton, not UTC', () => {
  assert.equal(calgaryDate(new Date('2026-10-22T05:59:59Z')), '2026-10-21', '23:59:59 MDT');
  assert.equal(calgaryDate(new Date('2026-10-22T06:00:00Z')), '2026-10-22', '00:00 MDT');
  // Historical transitions remain stable across tzdata versions. Alberta's
  // November2026 permanent-time policy invalidates assumptions of future fallbacks.
  assert.equal(calgaryDate(new Date('2025-11-02T06:30:00Z')), '2025-11-02', 'before the historical 2025 fallback');
  assert.equal(calgaryDate(new Date('2025-11-03T06:30:00Z')), '2025-11-02', '23:30 MST after the historical fallback');
  assert.equal(calgaryDate(new Date('2025-03-09T08:30:00Z')), '2025-03-09', 'historical spring transition date');
  assert.equal(calgaryDate(new Date('2025-03-09T06:59:00Z')), '2025-03-08');
  // The status changes exactly at Calgary midnight.
  const p = schedule([{ startDate: '2026-07-01', endDate: '2026-10-21' }]);
  assert.equal(classify(p, calgaryDate(new Date('2026-10-22T05:59:59Z'))).status, 'active');
  assert.equal(classify(p, calgaryDate(new Date('2026-10-22T06:00:00Z'))).status, 'inactive');
});

test('future and expired academic years classify from their recorded periods only', () => {
  assert.equal(classify(schedule([{ startDate: '2027-07-01', endDate: '2028-06-30' }]), '2026-10-22').status, 'upcoming');
  assert.equal(classify(schedule([{ startDate: '2025-07-01', endDate: '2026-06-30' }]), '2026-10-22').status, 'inactive');
  assert.equal(classify(legacy(null, null), '2027-10-22').status, 'dates-needed', 'no year-derived dates');
});

test('after an authorized period edit, the same appointment changes status on the next read', () => {
  const before = row('HICC', 'VTMD 200', 'Avery Testwell', schedule([{ startDate: '2026-07-01', endDate: '2027-06-30' }]));
  const after = { ...before, periodsJson: JSON.stringify([{ startDate: '2026-07-01', endDate: '2026-10-01' }]) };
  assert.equal(buildDirectory([before], { academicYear: '2026-27', asOfDate: '2026-10-22' }).hiccCc[0].status, 'active');
  const changed = buildDirectory([after], { academicYear: '2026-27', asOfDate: '2026-10-22' }).hiccCc[0];
  assert.equal(changed.status, 'inactive');
  assert.equal(changed.endDate, '2026-10-01');
});

// ------------------------------------------------------------------ role mapping
test('HICC and Course Coordinator enter HICC–CC, VISC enters VISC only; everything else is excluded', () => {
  const rows = [
    row('HICC', 'VTMD 300', 'B Person', schedule([{ startDate: '2026-07-01', endDate: '2027-06-30' }])),
    row('Course Coordinator', 'VTMD 300', 'A Person'),
    row('VISC', 'Cardiology', 'C Person', legacy('2026-07-01', '2027-06-30')),
    row('Rotation Participant', 'Rotation', 'D Person'),
    row('CCC', 'CCC', 'E Person'),
    row('Designated Rotation Coordinator', 'Rot', 'F Person'),
    row('Course Coordinator / HICC (legacy ambiguous)', 'VTMD 301', 'G Person'),
    row('hicc ', 'VTMD 302', 'H Person'),
    row('Manual DOE adjustment', 'x', 'I Person')
  ];
  const directory = buildDirectory(rows, { academicYear: '2026-27', asOfDate: '2026-10-22' });
  assert.deepEqual(directory.hiccCc.map(e => [e.roleType, e.facultyName]), [['HICC', 'Person, B'], ['Course Coordinator', 'Person, A'], ['HICC', 'Person, H']]);
  assert.deepEqual(directory.visc.map(e => [e.roleType, e.facultyName]), [['VISC', 'Person, C']]);
  assert.deepEqual(ROLE_TYPES, ['HICC', 'Course Coordinator', 'VISC']);
});

test('role mapping trims and canonicalizes casing without accepting similar or inherited names', () => {
  const directory = buildDirectory([
    row(' hicc ', '100', 'A'), row(' course coordinator ', '100', 'B'), row(' vIsC ', 'Anatomy', 'C'),
    row('HICC extra', '100', 'D'), row('toString', '100', 'E'), row('__proto__', '100', 'F')
  ], { academicYear: '2026-27', asOfDate: '2026-10-23' });
  assert.deepEqual(directory.hiccCc.map(entry => entry.roleType), ['HICC', 'Course Coordinator']);
  assert.deepEqual(directory.visc.map(entry => entry.roleType), ['VISC']);
});

test('distinct full scopes survive even when their display labels truncate identically', () => {
  const prefix = 'A'.repeat(220);
  const directory = buildDirectory([
    row('VISC', prefix + ' first', 'Same Person'), row('VISC', prefix + ' second', 'Same Person'),
    row('VISC', prefix + ' first', 'Same Person')
  ], { academicYear: '2026-27', asOfDate: '2026-10-23' });
  assert.equal(directory.visc.length, 2);
  assert.equal(directory.visc[0].scope, directory.visc[1].scope);
  assert.equal(directory.visc[0].scope.length, 200);
});

test('SQL role filtering is case-insensitive even in a case-sensitive database', async () => {
  let query;
  const repository = createSqlLeadershipDirectoryRepository({ query: async sql => { query = sql; return []; } });
  await repository.list({ academicYear: '2026-27' });
  assert.match(query, /UPPER\(LTRIM\(RTRIM\(r\.RoleType\)\)\) COLLATE Latin1_General_100_BIN2 IN \(UPPER\(@roleType0\), UPPER\(@roleType1\), UPPER\(@roleType2\)\)/);
});

test('HICC–CC sorts naturally by course, then HICC before CC, then Faculty; VISC by subject then Faculty', () => {
  const rows = [
    row('Course Coordinator', 'VTMD 1000', 'Zed'), row('HICC', 'VTMD 99', 'Yan'), row('Course Coordinator', 'VTMD 99', 'Abe'),
    row('HICC', 'VTMD 99', 'Bea'), row('HICC', null, 'Nobody'), row('VISC', 'surgery', 'Moe'), row('VISC', 'Anatomy', 'Lee'), row('VISC', 'Anatomy', 'Kim')
  ];
  const directory = buildDirectory(rows, { academicYear: '2026-27', asOfDate: '2026-10-22' });
  assert.deepEqual(directory.hiccCc.map(e => `${e.roleType}|${e.scope}|${e.facultyName}`), [
    'HICC|VTMD 99|Bea', 'HICC|VTMD 99|Yan', 'Course Coordinator|VTMD 99|Abe', 'Course Coordinator|VTMD 1000|Zed', 'HICC|null|Nobody']);
  assert.deepEqual(directory.visc.map(e => `${e.scope}|${e.facultyName}`), ['Anatomy|Kim', 'Anatomy|Lee', 'surgery|Moe']);
});

test('legitimate repeat appointments stay; only genuinely identical records collapse', () => {
  const p = schedule([{ startDate: '2026-07-01', endDate: '2027-06-30' }]);
  const rows = [
    row('HICC', 'VTMD 300', 'Pat', p), row('HICC', 'VTMD 300', 'Pat', p),            // identical -> one
    row('Course Coordinator', 'VTMD 300', 'Pat', p),                                    // other role -> kept
    row('HICC', 'VTMD 301', 'Pat', p),                                                  // other course -> kept
    row('HICC', 'VTMD 300', 'Pat', schedule([{ startDate: '2026-07-01', endDate: '2026-12-31' }])), // other dates -> kept
    row('VISC', 'Anatomy', 'Kim', p), row('VISC', 'Anatomy', 'Lee', p)                  // two faculty, one subject -> both
  ];
  const directory = buildDirectory(rows, { academicYear: '2026-27', asOfDate: '2026-10-22' });
  assert.equal(directory.hiccCc.length, 4);
  assert.equal(directory.visc.length, 2);
  assert.deepEqual(buildDirectory([...rows].reverse(), { academicYear: '2026-27', asOfDate: '2026-10-22' }), directory, 'order-independent');
});

test('missing scope or mapping is reported as null, a verified course code wins, nothing is guessed', () => {
  const directory = buildDirectory([
    row('HICC', null, 'A'), row('HICC', '  vtmd   300 ', 'B', undefined, { courseCode: 'VTMD 300' }), row('VISC', '', 'C')
  ], { academicYear: '2026-27', asOfDate: '2026-10-22' });
  assert.deepEqual(directory.hiccCc.map(e => e.scope), ['VTMD 300', null]);
  assert.equal(directory.visc[0].scope, null);
});

test('the public entry carries only the allow-listed fields', () => {
  const source = { ...row('HICC', 'VTMD 300', 'Pat', schedule([{ startDate: '2026-07-01', endDate: '2027-06-30' }])), doeMappedValue: 3, email: 'p@x', ucid: '123', firebaseUid: 'u', specialNotes: 'n', details: 'd' };
  const [entry] = buildDirectory([source], { academicYear: '2026-27', asOfDate: '2026-10-22' }).hiccCc;
  assert.deepEqual(Object.keys(entry).sort(), ['endDate', 'facultyName', 'roleType', 'scope', 'startDate', 'status']);
  const gap = buildDirectory([row('HICC', 'X', 'Q', schedule([{ startDate: '2026-07-01', endDate: '2026-09-30' }, { startDate: '2027-01-01', endDate: null }]))], { academicYear: '2026-27', asOfDate: '2026-10-22' }).hiccCc[0];
  assert.deepEqual(Object.keys(gap).sort(), ['endDate', 'facultyName', 'nextStartDate', 'roleType', 'scope', 'startDate', 'status']);
});

// ------------------------------------------------------------------ API security
const USERS = {
  fac: { firebaseUid: 'fac', active: true, mustChangePassword: false, baseRole: 'faculty', facultyId: '00000000-0000-4000-8000-000000000001' },
  admin: { firebaseUid: 'admin', active: true, mustChangePassword: false, baseRole: 'administrator' },
  lab: { firebaseUid: 'lab', active: true, mustChangePassword: false, baseRole: 'lab' },
  disabled: { firebaseUid: 'disabled', active: false, mustChangePassword: false, baseRole: 'administrator' },
  forced: { firebaseUid: 'forced', active: true, mustChangePassword: true, baseRole: 'administrator' },
  odd: { firebaseUid: 'odd', active: true, mustChangePassword: false, baseRole: 'superuser' },
  unlinked: { firebaseUid: 'unlinked', active: true, mustChangePassword: false, baseRole: 'faculty', facultyId: null }
};
function api({ rows = [row('HICC', 'VTMD 300', 'Pat', schedule([{ startDate: '2026-07-01', endDate: '2027-06-30' }]))], fail = null } = {}) {
  const calls = [];
  const instance = createLeadershipDirectoryApi({
    verifyToken: async token => { if (token === 'bad') throw new Error('bad'); return { uid: token }; },
    findUser: async uid => USERS[uid] || null,
    repository: { list: async args => { calls.push(args); if (fail) throw fail; return rows; } },
    today: () => '2026-10-22'
  });
  return { instance, calls };
}

test('missing or invalid token is 401; disabled, forced-change, unsupported and unlinked accounts are 403', async () => {
  const { instance, calls } = api();
  assert.equal((await instance.list('', { academicYear: '2026-27' })).status, 401);
  assert.equal((await instance.list('bad', { academicYear: '2026-27' })).status, 401);
  for (const uid of ['disabled', 'forced', 'odd', 'unlinked', 'nobody']) assert.equal((await instance.list(uid, { academicYear: '2026-27' })).status, 403, uid);
  assert.equal(calls.length, 0, 'SQL is never queried for an unauthorized request');
});

test('supported roles receive the directory; academic year is exact and required', async () => {
  const { instance, calls } = api();
  for (const uid of ['fac', 'admin', 'lab']) {
    const result = await instance.list(uid, { academicYear: '2026-27' });
    assert.equal(result.status, 200, uid);
    assert.deepEqual(Object.keys(result.body).sort(), ['academicYear', 'asOfDate', 'hiccCc', 'visc']);
    assert.equal(result.body.asOfDate, '2026-10-22');
  }
  for (const query of [{}, { academicYear: '2026-2027' }, { academicYear: '2026-28' }, { academicYear: '2026' }, { academicYear: '1999-00' }, { academicYear: '2026-27', extra: '1' }, null, []]) {
    const result = await instance.list('admin', query);
    assert.equal(result.status, 400, JSON.stringify(query));
  }
  assert.deepEqual(calls.map(c => c.academicYear), ['2026-27', '2026-27', '2026-27']);
});

test('no DOE or protected identifier appears anywhere in a response built from a full SQL row', async () => {
  const leaky = { ...row('VISC', 'Anatomy', 'Pat'), doeMappedValue: 5, doeOverrideValue: 1, doeOverrideReason: 'x', email: 'pat@example.test', ucid: 'SYN1', firebaseUid: 'syn-x', specialNotes: 'private', details: 'detail', sourceJson: '{}', salary: 1, fte: 1 };
  const { instance } = api({ rows: [leaky] });
  const text = JSON.stringify((await instance.list('fac', { academicYear: '2026-27' })).body);
  for (const forbidden of ['doe', 'Doe', 'email', 'ucid', 'firebase', 'notes', 'Notes', 'detail', 'source', 'salary', 'fte', 'facultyKey', 'appointmentKey', 'pat@example', 'SYN1', 'syn-x', 'private']) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
});

test('SQL unavailability and oversized results fail closed with 503 and no partial data', async () => {
  for (const error of [new Error('connection'), Object.assign(new Error('big'), { code: 'DIRECTORY_TOO_LARGE' })]) {
    const result = await api({ fail: error }).instance.list('admin', { academicYear: '2026-27' });
    assert.equal(result.status, 503);
    assert.deepEqual(Object.keys(result.body), ['error']);
  }
  const failingProfile = createLeadershipDirectoryApi({ verifyToken: async () => ({ uid: 'x' }), findUser: async () => { throw new Error('sql'); }, repository: { list: async () => [] } });
  assert.equal((await failingProfile.list('t', { academicYear: '2026-27' })).status, 503);
});

// ------------------------------------------------------------------ route
test('route: GET only, exact single academicYear parameter, no-store headers', async () => {
  const seen = [];
  const route = createLeadershipDirectoryFunctions({ api: { list: async (token, query) => { seen.push([token, query]); return { status: 200, body: { ok: true } }; } } });
  const req = (url, method = 'GET', auth = 'Bearer tok') => new Request('http://x' + url, { method, headers: { authorization: auth } });
  const ok = await route(req('/api/v1/dashboard/leadership-directory?academicYear=2026-27'));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(seen[0], ['tok', { academicYear: '2026-27' }]);
  assert.equal((await route(req('/api/v1/dashboard/leadership-directory?academicYear=2026-27', 'POST'))).status, 405);
  for (const q of ['', '?academicYear=2026-27&academicYear=2027-28', '?academicYear=2026-27&role=hicc', '?year=2026-27']) {
    assert.equal((await route(req('/api/v1/dashboard/leadership-directory' + q))).status, 400, q);
  }
  assert.equal((await route(req('/api/v1/dashboard/roles?academicYear=2026-27'))).status, 404);
  await route(req('/api/v1/dashboard/leadership-directory?academicYear=2026-27', 'GET', ''));
  assert.equal(seen.at(-1)[0], '', 'missing bearer reaches the API as an empty token (401 there)');
});

test('runtime routes the directory to its own module before the administrator Dashboard API', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'swa-sql-runtime.js'), 'utf8');
  const directory = runtime.indexOf('if(pathname===LEADERSHIP_DIRECTORY_PATH)return leadershipDirectoryRoutes(request);');
  const dashboard = runtime.indexOf("if (pathname.startsWith('/api/v1/dashboard/')) return dashboardRoutes(request);");
  assert.ok(directory > 0 && dashboard > directory);
});

// ------------------------------------------------------------------ SQL repository
test('repository: one read-only parameterised SELECT over granted, non-DOE columns', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'sql-leadership-directory-repository.js'), 'utf8');
  const queries = [];
  const repo = createSqlLeadershipDirectoryRepository({ query: async (text, params) => { queries.push({ text, params }); return []; } });
  assert.deepEqual(await repo.list({ academicYear: '2026-27' }), []);
  assert.equal(queries.length, 1);
  const sql = queries[0].text;
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|CREATE|ALTER|DROP|GRANT|TRUNCATE)\b/i);
  assert.doesNotMatch(sql, /Doe|SpecialNotes|Details|Email|Ucid|FirebaseUid|SourceFacultyName|SourceRow|SourceImportBatchId|CourseId\b|COUNT\(\*\)|staging\./i);
  assert.match(sql, /UPPER\(LTRIM\(RTRIM\(r\.RoleType\)\)\) COLLATE Latin1_General_100_BIN2 IN \(UPPER\(@roleType0\), UPPER\(@roleType1\), UPPER\(@roleType2\)\)/);
  assert.match(sql, /r\.AcademicYear = @academicYear/);
  assert.match(sql, /f\.Active = 1/);
  assert.match(sql, /TOP \(@limitPlusOne\)/);
  assert.deepEqual(queries[0].params, { academicYear: '2026-27', limitPlusOne: 1001, roleType0: 'HICC', roleType1: 'Course Coordinator', roleType2: 'VISC' });
  assert.doesNotMatch(source, /\$\{(?!facultyDisplayNameSql)/, 'no interpolation other than the trusted display-name helper');
  const big = createSqlLeadershipDirectoryRepository({ query: async () => Array.from({ length: 1001 }, () => ({})) });
  await assert.rejects(big.list({ academicYear: '2026-27' }), error => error.code === 'DIRECTORY_TOO_LARGE');
});
