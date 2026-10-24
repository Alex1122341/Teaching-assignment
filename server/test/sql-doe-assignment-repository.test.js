'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqlDoeAssignmentRepository } = require('../src/data/sql-doe-assignment-repository');

test('session DOE facts are loaded from the canonical SQL timetable with normalized evidence links', async () => {
  const calls=[];
  const repository = createSqlDoeAssignmentRepository({ query: async (sql, params) => {
    calls.push({ sql, params });
    return sql.includes('FROM paws.Session AS s') ? [{ sessionId: 's', academicYear: '2026-27', curriculumYear: '2', courseCode: 'VTMD 204', sessionType: 'LEC', sessionDate: '2026-09-10', sessionAssignmentId: 'a', facultyId: 'f', teachingRole: 'Lecture', doeRevision: null }] : [];
  } });
  const result = await repository.loadSessionDoeFacts('s');
  assert.equal(result.courseCode, 'VTMD 204');
  assert.equal(result.assignments[0].sessionAssignmentId, 'a');
  assert.equal(calls[0].params.sessionId, 's');
  assert.match(calls[0].sql, /FROM paws\.Session AS s[\s\S]*JOIN paws\.SessionAssignment AS sa/i);
  assert.match(calls[0].sql, /DoeAssignmentFact AS existing ON existing\.SessionAssignmentId=sa\.SessionAssignmentId/i);
  assert.match(calls[1].sql, /NOT EXISTS \(SELECT 1 FROM paws\.SessionAssignment AS sa WHERE sa\.SessionAssignmentId=a\.SessionAssignmentId\)/i);
});

test('removed timetable assignments are deactivated with their old calculation retained and audit logged', async () => {
  let call;
  const repository = createSqlDoeAssignmentRepository({ query: async (sql, params) => { call={sql,params}; return []; } });
  await repository.deactivateOrphanedSessionDoeFacts({ assignmentFactIds: ['a','a','b'], actorUid: 'server-actor' });
  assert.equal(JSON.parse(call.params.idsJson).length,2);
  assert.equal(call.params.actorUid,'server-actor');
  assert.match(call.sql,/SET Active=0,Revision=Revision\+1[\s\S]*INSERT paws\.DoeAuditEvent/i);
  assert.match(call.sql,/preservedCalculationId/i);
  assert.doesNotMatch(call.sql,/DELETE\s+FROM\s+paws\.DoeCalculationRecord/i);
});

test('session DOE persistence inserts immutable evidence and updates its fact pointer atomically', async () => {
  let call;
  const repository = createSqlDoeAssignmentRepository({ query: async (sql, params) => { call = { sql, params }; return []; } });
  await repository.saveSessionDoeCalculations({ actorUid: 'server-actor', trigger: 'session_edit', rows: [{
    assignmentFactId: '11111111-1111-1111-1111-111111111112', sessionAssignmentId: '11111111-1111-1111-1111-111111111112',
    sessionId: '11111111-1111-1111-1111-111111111113', facultyId: '11111111-1111-1111-1111-111111111114',
    academicYear: '2026-27', category: 'teaching', roleType: 'Scheduled Teaching', activityType: 'session',
    scopeText: 'VTMD 204', courseCode: 'VTMD 204', sourceEntityType: 'session_assignment', sourceEntityId: '11111111-1111-1111-1111-111111111112',
    revision: 1, calculationId: '11111111-1111-1111-1111-111111111115', policyVersionId: '11111111-1111-1111-1111-111111111116',
    policyRevision: 3, ruleId: null, ruleKey: null, exceptionId: null, factsSnapshot: { courseCode: 'VTMD 204' },
    inputsSnapshot: {}, parameterSnapshot: {}, ruleSnapshot: { status: 'needs_review' }, referenceSnapshot: null,
    calculationText: 'Needs Review', resultDoe: null, calculationStatus: 'needs_review', calculationTrigger: 'session_edit',
    calculatedBy: 'server-actor', calculatedAt: '2026-10-07T12:00:00.000Z'
  }] });
  assert.equal(call.params.actorUid, 'server-actor');
  assert.match(call.sql, /BEGIN TRANSACTION[\s\S]*INSERT paws\.DoeCalculationRecord[\s\S]*MERGE paws\.DoeAssignmentFact[\s\S]*INSERT paws\.DoeAuditEvent[\s\S]*COMMIT TRANSACTION/i);
  assert.match(call.sql, /Status<>N'active' OR p\.Revision<>i\.policyRevision/i);
  assert.match(call.sql, /WHEN MATCHED THEN UPDATE[\s\S]*CurrentCalculationId=source\.calculationId/i);
  assert.match(call.sql, /calculationStatus=N'needs_review' AND resultDoe IS NOT NULL/i);
  assert.match(call.sql, /CalculationTrigger/);
  assert.match(call.sql, /calculationTrigger/);
  assert.doesNotMatch(call.sql, /\bTrigger\b/);
  assert.equal(JSON.parse(call.params.rowsJson)[0].calculationStatus, 'needs_review');
});

test('assignment persistence is one guarded SQL transaction with immutable calculation and audit evidence', async () => {
  let call;
  const repository = createSqlDoeAssignmentRepository({ query: async (sql, params) => { call = { sql, params }; return [{ assignmentFactId: params.assignmentFactId, revision: params.revision }]; } });
  const assignment = {
    assignmentFactId: '11111111-1111-1111-1111-111111111112', facultyId: '11111111-1111-1111-1111-111111111111',
    academicYear: '2026-27', category: 'course_coordination', roleType: 'Course Coordinator',
    activityType: 'Course Coordinator', scopeText: 'VTMD 204', courseCode: 'VTMD 204', subjectKey: null,
    sessionId: null, sourceEntityType: 'doe_assignment', sourceEntityId: '11111111-1111-1111-1111-111111111112',
    notes: 'source', inputs: { hours: 2, curriculumStage: 'Y2' }, revision: 1, createdBy: 'uid', updatedBy: 'uid'
  };
  const calculation = {
    calculationId: '11111111-1111-1111-1111-111111111113', academicYear: '2026-27', policyVersionId: '11111111-1111-1111-1111-111111111114',
    policyRevision: 4, ruleId: '11111111-1111-1111-1111-111111111115', ruleKey: 'coordination', category: 'course_coordination',
    assignmentId: assignment.assignmentFactId, factsSnapshot: { courseCode: 'VTMD 204' }, inputsSnapshot: { hours: 2 },
    parameterSnapshot: { rate: 6 }, ruleSnapshot: { ruleKey: 'coordination' }, referenceSnapshot: { title: 'UCVM Workload Guidelines' },
    calculationText: '12% DOE', resultDoe: 12, status: 'calculated', calculationTrigger: 'faculty_edit', calculatedBy: 'uid', calculatedAt: '2026-10-07T12:00:00.000Z'
  };
  const auditRecord = { auditEventId: '11111111-1111-1111-1111-111111111116', action: 'doe_assignment_created', after: { resultDoe: 12 }, changedAt: '2026-10-07T12:00:00.000Z' };
  const result = await repository.saveDoeAssignment({ assignment, calculation, auditRecord, expectedRevision: 0 });
  assert.equal(result.revision, 1);
  assert.match(call.sql, /SET XACT_ABORT ON[\s\S]*BEGIN TRANSACTION[\s\S]*COMMIT TRANSACTION[\s\S]*ROLLBACK TRANSACTION/i);
  assert.match(call.sql, /Status=N'active' AND Revision=@policyRevision/i);
  assert.match(call.sql, /INSERT INTO paws\.DoeCalculationRecord/i);
  assert.match(call.sql, /CurrentCalculationId=@calculationId/i);
  assert.match(call.sql, /INSERT INTO paws\.DoeAuditEvent/i);
  assert.match(call.sql, /DELETE FROM paws\.DoeAssignmentFactInput/);
  assert.equal(call.params.assignmentInputsJson, '{"hours":2,"curriculumStage":"Y2"}');
  assert.equal(call.params.policyRevision, 4);
  assert.equal(call.params.resultDoe, 12);
  assert.equal(call.params.referenceJson, '{"title":"UCVM Workload Guidelines"}');
});

test('deactivation is soft, revision guarded, and audited in one transaction', async () => {
  let call;
  const repository = createSqlDoeAssignmentRepository({ query: async (sql, params) => { call = { sql, params }; return []; } });
  await repository.deactivateDoeAssignment({
    actorUid: 'uid', facultyId: '11111111-1111-1111-1111-111111111111', academicYear: '2026-27',
    assignmentFactId: '11111111-1111-1111-1111-111111111112', expectedRevision: 2, reason: 'ended'
  });
  assert.match(call.sql, /SET Active=0,Revision=Revision\+1/i);
  assert.match(call.sql, /AND Active=1 AND Revision=@expectedRevision/i);
  assert.match(call.sql, /INSERT INTO paws\.DoeAuditEvent/i);
  assert.doesNotMatch(call.sql, /DELETE\s+FROM\s+paws\.DoeAssignmentFact/i);
});
