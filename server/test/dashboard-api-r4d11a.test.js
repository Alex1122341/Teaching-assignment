'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDashboardApi } = require('../src/data/dashboard-api');
const { createDashboardFunctions } = require('../src/runtime/swa-dashboard-functions');
const { createSqlDashboardRepository } = require('../src/data/sql-dashboard-repository');

const FACULTY_ID = '11111111-1111-1111-1111-111111111111';
const request = (url, { method = 'GET' } = {}) => ({
  method,
  url: 'https://local' + url,
  headers: { get: name => name.toLowerCase() === 'authorization' ? 'Bearer ok' : null }
});

function harness(profile, overrides = {}) {
  const calls = [];
  const repository = {
    teachingSummary: async args => { calls.push(['teachingSummary', args]); return [{ facultyId: FACULTY_ID, displayName: 'A', assignedTeachingDoe: 1, roleDoe: 2, recordedDoeTotal: 3, effectiveDoeTotal: 3, doeComplete: true }]; },
    roles: async args => { calls.push(['roles', args]); return [{ facultyId: FACULTY_ID, roleType: 'VISC', doeMappedValue: 1, doeOverrideValue: null }]; },
    doeOverview: async args => { calls.push(['doeOverview', args]); return { academicYear: '2026-27', recordedDoeTotal: 3, effectiveDoeTotal: 3, partial: false }; },
    ...overrides.repository
  };
  const api = createDashboardApi({
    verifyToken: async () => ({ uid: 'uid-1' }),
    findUser: async () => profile,
    repository
  });
  return { app: createDashboardFunctions({ api }), calls };
}

const admin = { active: true, mustChangePassword: false, baseRole: 'adfa_general', facultyId: null };
const self = { active: true, mustChangePassword: false, baseRole: 'faculty', facultyId: FACULTY_ID };

test('admin aggregate routes return read-only DTOs and bind academic year', async () => {
  const { app, calls } = harness(admin);
  const summary = await app(request('/api/v1/dashboard/teaching-summary?academicYear=2026-27'));
  const roles = await app(request('/api/v1/dashboard/roles?academicYear=2026-27'));
  const doe = await app(request('/api/v1/dashboard/doe-overview?academicYear=2026-27'));
  assert.equal(summary.status, 200);
  assert.equal(summary.jsonBody.teachingSummary[0].recordedDoeTotal, 3);
  assert.equal(summary.jsonBody.teachingSummary[0].effectiveDoeTotal, 3);
  assert.equal(roles.status, 200);
  assert.equal(roles.jsonBody.roles[0].roleType, 'VISC');
  assert.equal(doe.status, 200);
  assert.equal(doe.jsonBody.doeOverview.partial, false);
  assert.deepEqual(calls.map(([name, args]) => [name, args.academicYear]), [
    ['teachingSummary', '2026-27'],
    ['roles', '2026-27'],
    ['doeOverview', '2026-27']
  ]);
});

test('self-service and denied roles cannot read cross-faculty aggregate tabs', async () => {
  for (const profile of [self, { ...admin, baseRole: 'viewer' }, { ...admin, baseRole: 'other_office' }]) {
    const { app, calls } = harness(profile);
    for (const path of ['teaching-summary', 'roles', 'doe-overview']) {
      const response = await app(request('/api/v1/dashboard/' + path));
      assert.equal(response.status, 403, path);
      assert.equal(response.jsonBody.error.code, 'ROLE_DENIED', path);
    }
    assert.equal(calls.length, 0);
  }
});

test('non-GET aggregate requests are rejected with Allow GET', async () => {
  const { app } = harness(admin);
  for (const path of ['teaching-summary', 'roles', 'doe-overview']) {
    const response = await app(request('/api/v1/dashboard/' + path, { method: 'POST' }));
    assert.equal(response.status, 405, path);
    assert.equal(response.headers.Allow, 'GET');
  }
});

test('repository teaching summary uses one aggregate plus bounded DOE-gap evidence queries without detail fanout', async () => {
  const queries = [];
  const repository = createSqlDashboardRepository({ query: async (sql, params) => { queries.push({ sql, params }); return []; } });
  const rows = await repository.teachingSummary({ academicYear: '2026-27' });
  assert.deepEqual(rows, []);
  assert.equal(queries.length, 3);
  assert.equal(queries[0].params.academicYear, '2026-27');
  assert.equal(queries[0].params.doeNa0, 'Quiz/Midterm');
  assert.equal(queries[0].params.doeNa1, 'OSCE');
  assert.match(queries[0].sql, /SessionType[\s\S]*NOT IN \(@doeNa0, @doeNa1\)/i);
  assert.match(queries[0].sql, /GROUP BY/i);
  assert.match(queries[0].sql, /DoeCredit/i);
  assert.match(queries[0].sql, /RoleAssignment/i);
  assert.match(queries[1].sql, /sa\.DoeCredit IS NULL/i);
  assert.match(queries[1].sql, /NOT IN \(@doeNa0, @doeNa1\)/i);
  assert.match(queries[2].sql, /r\.DoeMappedValue IS NULL/i);
  assert.match(queries[2].sql, /r\.DoeOverrideValue IS NULL/i);
});

test('repository teaching summary fills deterministic DOE gaps without changing recorded audit totals', async () => {
  const repository = createSqlDashboardRepository({ query: async sql => {
    if (/WITH teaching AS/.test(sql)) return [{
      facultyId: FACULTY_ID,
      displayName: 'A',
      assignedTeachingDoe: 1,
      roleDoe: 2,
      recordedDoeTotal: 3,
      teachingLineCount: 2,
      teachingRecordedCount: 1,
      teachingMissingCount: 1,
      teachingNotApplicableCount: 0,
      roleLineCount: 2,
      roleRecordedCount: 1,
      roleMissingCount: 1,
      doeComplete: 0,
      year1Assignments: 2,
      year2Assignments: 0,
      year3Assignments: 0,
      year4Assignments: 0,
      creditedHours: 3,
      courseCount: 1,
      sessionCount: 2
    }];
    if (/sa\.DoeCredit IS NULL/.test(sql)) return [{
      facultyId: FACULTY_ID,
      sessionType: 'LEC',
      teachingRole: 'Lecture',
      creditedHours: 2,
      doeQuantity: null,
      doeCredit: null
    }];
    if (/r\.DoeMappedValue IS NULL/.test(sql)) return [{
      facultyId: FACULTY_ID,
      academicYear: '2026-27',
      roleType: 'VISC',
      courseOrSubjectOrRotation: 'Subject A',
      doeMappedValue: null,
      doeOverrideValue: null
    }];
    return [];
  } });
  const [row] = await repository.teachingSummary({ academicYear: '2026-27' });
  assert.equal(row.recordedTeachingDoe, 1);
  assert.equal(row.assignedTeachingDoe, 1.6);
  assert.equal(row.teachingCalculatedCount, 1);
  assert.equal(row.teachingResolvedCount, 2);
  assert.equal(row.teachingMissingCount, 0);
  assert.equal(row.recordedRoleDoe, 2);
  assert.equal(row.roleDoe, 7);
  assert.equal(row.roleCalculatedCount, 1);
  assert.equal(row.roleResolvedCount, 2);
  assert.equal(row.roleMissingCount, 0);
  assert.equal(row.recordedDoeTotal, 3);
  assert.equal(row.effectiveDoeTotal, 8.6);
  assert.equal(row.doeComplete, true);
});

test('repository effective role DOE preserves zero and negative overrides', async () => {
  const repository = createSqlDashboardRepository({ query: async () => [
    { roleAssignmentId: 1, facultyId: FACULTY_ID, displayName: 'A', roleType: 'VISC', doeMappedValue: 1.5, doeOverrideValue: 0 },
    { roleAssignmentId: 2, facultyId: FACULTY_ID, displayName: 'A', roleType: 'CCC', doeMappedValue: 1.5, doeOverrideValue: -0.5 }
  ] });
  const roles = await repository.roles({ academicYear: '2026-27' });
  assert.equal(roles[0].effectiveDoe, 0);
  assert.equal(roles[1].effectiveDoe, -0.5);
});

test('repository preserves dated prorated stored role DOE without full-year mismatch', async () => {
  const repository = createSqlDashboardRepository({ query: async () => [{
    roleAssignmentId: 1,
    facultyId: FACULTY_ID,
    displayName: 'A',
    academicYear: '2026-27',
    roleType: 'HICC',
    courseOrSubjectOrRotation: 'VTMD 420: Sick Animals-Integument, MSK',
    effectiveDate: '2026-09-01',
    expirationDate: '2027-03-01',
    doeMappedValue: 3,
    doeOverrideValue: null
  }] });
  const [role] = await repository.roles({ academicYear: '2026-27' });
  assert.equal(role.calculatedDoe, 6);
  assert.equal(role.effectiveDoe, 3);
  assert.equal(role.doeSource, 'mapped');
  assert.equal(role.doeCalculationStatus, 'mapped');
  assert.equal(role.doeReviewReason, null);
});

test('repository role calculator fills deterministic VISC gaps but leaves CCC without shifts unresolved', async () => {
  const repository = createSqlDashboardRepository({ query: async () => [
    { roleAssignmentId: 1, facultyId: FACULTY_ID, displayName: 'A', academicYear: '2026-27', roleType: 'VISC', courseOrSubjectOrRotation: 'Subject A', doeMappedValue: null, doeOverrideValue: null },
    { roleAssignmentId: 2, facultyId: FACULTY_ID, displayName: 'A', academicYear: '2026-27', roleType: 'CCC', courseOrSubjectOrRotation: 'CCC shifts', doeMappedValue: null, doeOverrideValue: null }
  ] });
  const roles = await repository.roles({ academicYear: '2026-27' });
  assert.equal(roles[0].effectiveDoe, 5);
  assert.equal(roles[0].doeSource, 'calculator');
  assert.equal(roles[0].doeRuleCode, 'visc_2026_27');
  assert.equal(roles[1].effectiveDoe, null);
  assert.equal(roles[1].doeReviewReason, 'ccc-shift-count-required');
});

test('repository exposes full-year legacy HICC/course-coordinator candidates without choosing a role', async () => {
  const repository = createSqlDashboardRepository({ query: async () => [{
    roleAssignmentId: 1,
    facultyId: FACULTY_ID,
    displayName: 'A',
    academicYear: '2026-27',
    roleType: 'Course Coordinator / HICC (legacy ambiguous)',
    courseOrSubjectOrRotation: 'VTMD 420: Sick Animals-Integument, MSK',
    doeMappedValue: null,
    doeOverrideValue: null
  }] });
  const roles = await repository.roles({ academicYear: '2026-27' });
  assert.equal(roles[0].effectiveDoe, null);
  assert.equal(roles[0].doeReviewReason, 'legacy-course-coordinator-hicc-role-must-be-resolved');
  assert.deepEqual(roles[0].doeCandidates, {
    courseCoordinatorDoe: 3.5,
    courseCoordinatorRuleCode: 'course_coordination_3_5',
    hiccDoe: 6,
    hiccRuleCode: 'hicc_curriculum_development'
  });
  assert.equal(roles[0].doeCandidateBasis, 'full-year-reference-before-proration');
  assert.equal(roles[0].doeCourseUnits, 3);
});

test('repository DOE overview keeps unresolved calculator gaps explicit', async () => {
  const repository = createSqlDashboardRepository({ query: async sql => {
    if (/AS teachingLineCount/.test(sql)) return [{
      teachingLineCount: 2, teachingMissingCount: 1, teachingNotApplicableCount: 0, teachingDoe: 0, teachingRecordedCount: 1,
      roleLineCount: 1, roleMissingCount: 1, roleDoe: null, roleRecordedCount: 0,
      overrideCount: 1, overrideZeroCount: 1, overrideNegativeCount: 0
    }];
    if (/AS activeFacultyCount/.test(sql)) return [{ activeFacultyCount: 0, teachingTargetCount: 0 }];
    if (/FROM paws\.DoeFacultyAllocation/.test(sql)) return [];
    if (/sa\.DoeCredit IS NULL/.test(sql)) return [{ facultyId: FACULTY_ID, sessionType: 'LEC', teachingRole: null, creditedHours: 1, doeQuantity: null }];
    if (/r\.DoeMappedValue IS NULL/.test(sql)) return [{ facultyId: FACULTY_ID, academicYear: '2026-27', roleType: 'CCC', courseOrSubjectOrRotation: 'CCC shifts' }];
    return [];
  } });
  const overview = await repository.doeOverview({ academicYear: '2026-27' });
  assert.equal(overview.partial, true);
  assert.equal(overview.teachingDoe, 0);
  assert.equal(overview.roleDoe, null);
  assert.equal(overview.recordedDoeTotal, 0);
  assert.equal(overview.effectiveDoeTotal, 0);
  assert.equal(overview.teachingCalculatedCount, 0);
  assert.equal(overview.roleCalculatedCount, 0);
  assert.equal(overview.teachingMissingCount, 1);
  assert.equal(overview.roleMissingCount, 1);
  assert.equal(overview.overrideZeroCount, 1);
});

test('repository DOE overview preserves legitimate zero when no DOE lines exist', async () => {
  const repository = createSqlDashboardRepository({ query: async sql => {
    if (/AS teachingLineCount/.test(sql)) return [{
      teachingLineCount: 0, teachingRecordedCount: 0, teachingMissingCount: 0, teachingNotApplicableCount: 0, teachingDoe: null,
      roleLineCount: 0, roleRecordedCount: 0, roleMissingCount: 0, roleDoe: null,
      overrideCount: 0, overrideZeroCount: 0, overrideNegativeCount: 0
    }];
    if (/AS activeFacultyCount/.test(sql)) return [{ activeFacultyCount: 0, teachingTargetCount: 0 }];
    return [];
  } });
  const overview = await repository.doeOverview({ academicYear: '2026-27' });
  assert.equal(overview.teachingDoe, 0);
  assert.equal(overview.roleDoe, 0);
  assert.equal(overview.recordedDoeTotal, 0);
  assert.equal(overview.effectiveDoeTotal, 0);
  assert.equal(overview.doeStatus, 'none');
});

test('repository DOE overview fills deterministic teaching and role gaps through the shared calculator', async () => {
  const repository = createSqlDashboardRepository({ query: async sql => {
    if (/AS teachingLineCount/.test(sql)) return [{
      teachingLineCount: 1, teachingRecordedCount: 0, teachingMissingCount: 1, teachingNotApplicableCount: 0, teachingDoe: null,
      roleLineCount: 1, roleRecordedCount: 0, roleMissingCount: 1, roleDoe: null,
      overrideCount: 0, overrideZeroCount: 0, overrideNegativeCount: 0
    }];
    if (/AS activeFacultyCount/.test(sql)) return [{ activeFacultyCount: 1, teachingTargetCount: 0 }];
    if (/sa\.DoeCredit IS NULL/.test(sql)) return [{ facultyId: FACULTY_ID, sessionType: 'LEC', teachingRole: 'Lecture', creditedHours: 2, doeQuantity: null }];
    if (/r\.DoeMappedValue IS NULL/.test(sql)) return [{ facultyId: FACULTY_ID, academicYear: '2026-27', roleType: 'VISC', courseOrSubjectOrRotation: 'Subject A' }];
    return [];
  } });
  const overview = await repository.doeOverview({ academicYear: '2026-27' });
  assert.equal(overview.recordedDoeTotal, null);
  assert.equal(overview.teachingDoe, 0.6);
  assert.equal(overview.roleDoe, 5);
  assert.equal(overview.effectiveDoeTotal, 5.6);
  assert.equal(overview.teachingCalculatedCount, 1);
  assert.equal(overview.roleCalculatedCount, 1);
  assert.equal(overview.teachingResolvedCount, 1);
  assert.equal(overview.roleResolvedCount, 1);
  assert.equal(overview.teachingMissingCount, 0);
  assert.equal(overview.roleMissingCount, 0);
  assert.equal(overview.partial, false);
  assert.equal(overview.doeStatus, 'complete');
});

test('DOE overview keeps contract target coverage separate from assigned teaching and role DOE', async () => {
  const repository = createSqlDashboardRepository({ query: async sql => {
    if (/AS teachingLineCount/.test(sql)) return [{
      teachingLineCount: 4879, teachingMissingCount: 0, teachingNotApplicableCount: 91, teachingDoe: 0, teachingRecordedCount: 4879,
      roleLineCount: 162, roleMissingCount: 78, roleDoe: 12, roleRecordedCount: 84,
      overrideCount: 0, overrideZeroCount: 0, overrideNegativeCount: 0
    }];
    if (/AS activeFacultyCount/.test(sql)) return [{ activeFacultyCount: 120, teachingTargetCount: 112 }];
    if (/FROM paws\.DoeFacultyAllocation/.test(sql)) return [
      { categoryCode: 'research', allocationRowCount: 76, facultyCount: 76 },
      { categoryCode: 'service_admin', allocationRowCount: 111, facultyCount: 111 }
    ];
    return [];
  } });
  const result = await repository.doeOverview({ academicYear: '2026-27' });
  assert.deepEqual(result.contractTargetCoverage, {
    activeFacultyCount: 120,
    teachingTargetCount: 112,
    missingTeachingTargetCount: 8,
    coveragePercent: 93.33333333333333,
    allocationCategories: [
      { categoryCode: 'research', allocationRowCount: 76, facultyCount: 76 },
      { categoryCode: 'service_admin', allocationRowCount: 111, facultyCount: 111 }
    ]
  });
  assert.equal(result.teachingMissingCount, 0);
  assert.equal(result.teachingNotApplicableCount, 91);
  assert.equal(result.roleMissingCount, 78);
  assert.equal(result.recordedDoeTotal, 12);
  assert.equal(result.effectiveDoeTotal, 12);
  assert.equal(result.teachingCalculatedCount, 0);
  assert.equal(result.roleCalculatedCount, 0);
});
