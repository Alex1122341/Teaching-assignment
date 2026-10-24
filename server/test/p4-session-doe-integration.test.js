'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDataApi } = require('../src/data/data-api');

const SESSION_ID = '6f3636d9-55f5-4b26-9a74-040d6d5f3351';

function build({ recalculator, update = async () => ({ id: SESSION_ID, academicYear: '2026-27' }), create = async input => ({ id: SESSION_ID, ...input.session }), replace = async input => ({ id: input.sessionId }) } = {}) {
  return createDataApi({
    verifyToken: async () => ({ uid: 'admin-uid' }),
    findUser: async () => ({ active: true, baseRole: 'administrator', displayName: 'Admin' }),
    listSessions: async () => [],
    updateSession: update,
    createSession: create,
    replaceSessionAssignments: replace,
    health: async () => true,
    writeGates: { sessionEdit: true, sessionCreate: true },
    recalculateSessionDoe: recalculator
  });
}

test('P4 timetable edit invokes the server DOE recalculator and returns its status with the saved session', async () => {
  const calls = [];
  const api = build({ recalculator: async input => { calls.push(input); return { status: 'needs_review', issueCodes: ['COURSE_MAPPING_REQUIRED'] }; } });
  const response = await api.updateExistingSession('firebase-token', SESSION_ID, { courseCode: 'VTMD 204' });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ sessionId: SESSION_ID, actor: { uid: 'admin-uid', name: 'Admin' }, trigger: 'session_edit' }]);
  assert.deepEqual(response.body.doe, { status: 'needs_review', issueCodes: ['COURSE_MAPPING_REQUIRED'] });
});

test('P4 session create and assignment replacement both invoke server DOE recalculation', async () => {
  const calls=[];
  const api=build({recalculator:async input=>{calls.push(input);return {status:'calculated',assignmentCount:1};}});
  const created=await api.createSession('firebase-token',{academicYear:'2026-27',curriculumYear:'2',courseCode:'VTMD 204',sessionType:'LEC',date:'2026-09-10',startTime:'09:00',endTime:'10:00',topic:'Lecture',assignments:[{facultyId:'6f3636d9-55f5-4b26-9a74-040d6d5f3351',teachingRole:'Lecture'}]});
  assert.equal(created.status,201);
  assert.equal(created.body.doe.status,'calculated');
  const replaced=await api.replaceSessionAssignments('firebase-token',SESSION_ID,{assignments:[{facultyId:'6f3636d9-55f5-4b26-9a74-040d6d5f3351',teachingRole:'Lecture'}]});
  assert.equal(replaced.status,200);
  assert.deepEqual(calls.map(call=>call.trigger),['session_create','session_assignment_replacement']);
  assert.deepEqual(calls.map(call=>call.actor.uid),['admin-uid','admin-uid']);
});

test('P4 timetable edit reports DOE persistence failure instead of implying recalculation succeeded', async () => {
  const api = build({ recalculator: async () => { throw new Error('storage unavailable'); } });
  const response = await api.updateExistingSession('firebase-token', SESSION_ID, { topic: 'Updated topic' });

  assert.equal(response.status, 200);
  assert.equal(response.body.doe.status, 'needs_review');
  assert.equal(response.body.doe.issueCodes[0], 'DOE_RECALCULATION_FAILED');
});
