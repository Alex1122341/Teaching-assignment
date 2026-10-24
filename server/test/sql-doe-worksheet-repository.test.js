'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqlDoeWorksheetRepository } = require('../src/data/sql-doe-worksheet-repository');

test('DOE worksheet repository joins only current immutable calculation evidence for active assignments', async () => {
  const calls = [];
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    if (/FROM paws\.Faculty AS f/i.test(sql)) return [{ facultyId: 'faculty-1', displayName: 'Test Faculty', stream: 'clinical' }];
    if (/FROM paws\.DoeFacultyTarget/i.test(sql)) return [{ facultyId: 'faculty-1', contractTeachingDoe: 40, overrideDoe: null, effectiveTargetDoe: 40 }];
    if (/FROM paws\.DoePolicyVersion/i.test(sql)) return [{ policyVersionId: 'policy-1', status: 'active', revision: 2 }];
    if (/FROM paws\.DoeRuleParameter/i.test(sql)) return [
      { name: 'splitThreshold', valueNumber: 35 }, { name: 'splitRatio', valueNumber: 0.5 },
      { name: 'highTeachingTraineeCeiling', valueNumber: 15 }, { name: 'teachingFocusedTraineeCeiling', valueNumber: 7.5 },
      { name: 'rollingAverageYears', valueNumber: 3 }
    ];
    if (/FROM paws\.SessionAssignment/i.test(sql)) return [{ sessionAssignmentId: 'session-assignment-1', facultyId: 'faculty-1', doeCredit: 4 }];
    if (/FROM paws\.DoeAssignmentFact AS a/i.test(sql)) return [{
      assignmentFactId: 'assignment-1', facultyId: 'faculty-1', academicYear: '2026-27', category: 'role', roleType: 'Course Coordinator',
      courseCode: 'VTMD 204', sourceEntityType: 'doe_assignment', sourceEntityId: 'assignment-1', active: true,
      resultDoe: 12, calculationStatus: 'calculated', policyVersionId: 'policy-1', ruleId: 'rule-1', ruleKey: 'course-coord',
      referenceSnapshotJson: '{"title":"UCVM Workload Guidelines"}', calculatedAt: '2026-10-07T00:00:00.000Z'
    }];
    return [];
  } };
  const repository = createSqlDoeWorksheetRepository(db);
  const worksheetSource = await repository.getFacultyWorksheetSource('faculty-1', '2026-27');
  assert.equal(worksheetSource.lines[0].assignmentFactId, 'assignment-1');
  assert.equal(worksheetSource.lines[0].resultDoe, 12);
  assert.equal(worksheetSource.lines[0].reference.title, 'UCVM Workload Guidelines');
  assert.equal(worksheetSource.lines[1].status, 'stored');
  assert.equal(worksheetSource.lines[1].legacyResultDoe, 4);
  assert.equal(worksheetSource.lines[1].resultDoe, 4);
  assert.equal(worksheetSource.policyStatus, 'consistent');
  assert.ok(calls.every(call => call.params.academicYear === '2026-27'));
  assert.ok(calls.some(call => /LEFT JOIN paws\.DoeCalculationRecord[\s\S]*a\.Active=1/i.test(call.sql)));
  assert.ok(calls.some(call => /FROM paws\.DoeRuleParameter AS p[\s\S]*r\.Enabled=1 AND r\.ReviewStatus=N'approved'/i.test(call.sql)));
});

test('DOE worksheet list uses one bounded SQL read per source category and includes inactive fixture records', async () => {
  const calls = [];
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    if (/FROM paws\.Faculty AS f/i.test(sql)) return [
      { facultyId: 'active-1', displayName: 'Active', stream: 'clinical' },
      { facultyId: 'inactive-1', displayName: 'Fixture', stream: 'clinical' }
    ];
    return [];
  } };
  const repository = createSqlDoeWorksheetRepository(db);
  const sources = await repository.listFacultyWorksheetSources('2026-27');
  assert.deepEqual(sources.map(row => row.facultyId), ['active-1', 'inactive-1']);
  assert.equal(calls.length, 9);
  assert.ok(calls.some(call => /TOP \(@limit\)/i.test(call.sql)));
  assert.ok(calls.every(call => call.params.academicYear === '2026-27'));
});

