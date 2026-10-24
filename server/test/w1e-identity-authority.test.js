'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDataApi } = require('../src/data/data-api');
const { createDashboardApi } = require('../src/data/dashboard-api');
const { createAfcRequestApi } = require('../src/afc/afc-request-api');
const { createAfcApprovalApi } = require('../src/afc/afc-approval-api');

const FACULTY_ID = 'faculty-from-sql';

test('Firebase identity is mapped through the SQL UserProfile; token and client role fields cannot elevate it', async () => {
  let lookupUid;
  let sessionScope;
  const api = createDataApi({
    verifyToken: async () => ({ uid: 'firebase-uid', role: 'admin', baseRole: 'owner', facultyId: 'forged-faculty' }),
    findUser: async uid => {
      lookupUid = uid;
      return { email: 'canonical@example.test', displayName: 'Faculty', baseRole: 'faculty', facultyId: FACULTY_ID, active: true, mustChangePassword: false };
    },
    listSessions: async scope => { sessionScope = scope; return []; }
  });

  const me = await api.currentUser('valid-token');
  const sessions = await api.sessions('valid-token', { role: 'admin', baseRole: 'admin', facultyId: 'forged-faculty' });

  assert.equal(lookupUid, 'firebase-uid');
  assert.equal(me.status, 200);
  assert.equal(me.body.profile.role, 'faculty');
  assert.equal(me.body.profile.email, 'canonical@example.test');
  assert.equal(sessions.status, 200);
  assert.equal(sessionScope.facultyId, FACULTY_ID);
});

test('SQL administrator authority is not reduced or selected from Firebase/Firestore role claims', async () => {
  let sessionScope;
  const api = createDataApi({
    verifyToken: async () => ({ uid: 'firebase-uid', role: 'faculty', facultyRoles: ['faculty'], facultyId: 'forged-faculty' }),
    findUser: async () => ({ baseRole: 'adfa_general', facultyId: null, active: true, mustChangePassword: false }),
    listSessions: async scope => { sessionScope = scope; return []; }
  });

  const result = await api.sessions('valid-token', { role: 'faculty', facultyId: 'forged-faculty' });
  assert.equal(result.status, 200);
  assert.equal(sessionScope.facultyId, null);
});

test('authenticated /me returns canonical Developer identity and SQL role, not a lower Firestore compatibility role', async () => {
  const api = createDataApi({
    verifyToken: async () => ({ uid: 'firebase-uid', role: 'adfa_general', email: 'forged@example.test' }),
    findUser: async () => ({ email: 'xinyu.zhu1@ucalgary.ca', displayName: 'Xinyu Zhu', baseRole: 'developer', active: true, mustChangePassword: false }),
    listSessions: async () => []
  });
  const result = await api.currentUser('valid-token');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.profile, {
    email: 'xinyu.zhu1@ucalgary.ca', displayName: 'Xinyu Zhu', role: 'developer',
    facultyId: null, active: true, mustChangePassword: false
  });
});

test('a lower-privilege Firestore compatibility role never substitutes for the SQL Developer profile', async () => {
  let reads = 0;
  const api = createDashboardApi({
    verifyToken: async () => ({ uid: 'firebase-uid', role: 'adfa_general' }),
    findUser: async () => ({ baseRole: 'faculty', facultyId: 'faculty-1', active: true, mustChangePassword: false }),
    repository: { summary: async () => { reads++; return {}; } }
  });

  const result = await api.summary('valid-token');
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'ROLE_DENIED');
  assert.equal(reads, 0);
});

test('dashboard faculty scope is derived only from the SQL profile and rejects forged target FacultyId', async () => {
  let reads = 0;
  const api = createDashboardApi({
    verifyToken: async () => ({ uid: 'firebase-uid', role: 'admin', facultyRoles: ['admin'], facultyId: 'other-faculty' }),
    findUser: async () => ({ baseRole: 'faculty', facultyId: FACULTY_ID, active: true, mustChangePassword: false }),
    repository: { facultyById: async () => { reads++; return {}; } }
  });

  const result = await api.facultyById('valid-token', 'other-faculty');
  assert.equal(result.status, 403);
  assert.equal(reads, 0);
});

test('AFC request and approval routes use SQL BaseRole rather than Firebase role claims', async () => {
  let requestListScope;
  const requestApi = createAfcRequestApi({
    verifyToken: async () => ({ uid: 'firebase-uid', role: 'admin', facultyRoles: ['admin'] }),
    findUser: async () => ({ baseRole: 'faculty', facultyId: FACULTY_ID, active: true, mustChangePassword: false }),
    repository: { listRequests: async scope => { requestListScope = scope; return []; } }
  });
  const listed = await requestApi.list('valid-token');
  assert.equal(listed.status, 200);
  assert.equal(requestListScope.administrator, false);
  assert.equal(requestListScope.actorFirebaseUid, 'firebase-uid');

  const approvalApi = createAfcApprovalApi({
    verifyToken: async () => ({ uid: 'firebase-uid', role: 'admin', facultyRoles: ['admin'] }),
    findUser: async () => ({ baseRole: 'faculty', facultyId: FACULTY_ID, active: true, mustChangePassword: false }),
    repository: { approveRequest: async () => { throw new Error('faculty must not invoke approval'); } }
  });
  const decision = await approvalApi.approve('valid-token', 'b2c0ed27-53e4-4be9-a59a-b2320ff2bb3d', {});
  assert.equal(decision.status, 403);
  assert.equal(decision.body.error.code, 'ROLE_DENIED');
});

test('invalid token, missing/inactive SQL profile and MustChangePassword fail closed before protected reads', async () => {
  const scenarios = [
    { name: 'invalid token', verifyToken: async () => { throw new Error('invalid'); }, findUser: async () => { throw new Error('must not query SQL'); }, status: 401 },
    { name: 'SQL profile lookup unavailable', verifyToken: async () => ({ uid: 'u' }), findUser: async () => { throw new Error('SQL unavailable'); }, status: 503 },
    { name: 'missing SQL profile', verifyToken: async () => ({ uid: 'u' }), findUser: async () => null, status: 403 },
    { name: 'inactive SQL profile', verifyToken: async () => ({ uid: 'u' }), findUser: async () => ({ baseRole: 'administrator', active: false, mustChangePassword: false }), status: 403 },
    { name: 'password change required', verifyToken: async () => ({ uid: 'u' }), findUser: async () => ({ baseRole: 'administrator', active: true, mustChangePassword: true }), status: 403 }
  ];

  for (const scenario of scenarios) {
    let reads = 0;
    const api = createDataApi({
      verifyToken: scenario.verifyToken,
      findUser: scenario.findUser,
      listSessions: async () => { reads++; return []; }
    });
    const result = await api.sessions('token', {});
    assert.equal(result.status, scenario.status, scenario.name);
    assert.equal(reads, 0, scenario.name);
  }
});

test('W1C single-write gate denies when the procedure is otherwise callable; SQL permission errors fail closed when the gate is on', async () => {
  const profile = { displayName: 'Admin', baseRole: 'administrator', active: true, mustChangePassword: false };
  const payload = {
    facultyId: 'b2c0ed27-53e4-4be9-a59a-b2320ff2bb3d',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    reasonCode: 'vacation'
  };
  let writes = 0;

  const gateOff = createDashboardApi({
    verifyToken: async () => ({ uid: 'uid' }),
    findUser: async () => profile,
    repository: { listAfcRecords: async () => [] },
    // A successful fake represents the SQL grant being present; the disabled
    // application gate still prevents the procedure call.
    writeRepository: { createAfcRecord: async () => { writes++; return {}; } },
    writeGates: { afcSingle: false }
  });
  const denied = await gateOff.createAfcRecord('token', payload);
  assert.equal(denied.status, 503);
  assert.equal(denied.body.error.code, 'WRITE_DISABLED');
  assert.equal(writes, 0);

  // Conversely, an enabled gate does not synthesize SQL permissions: a
  // permission-denied procedure call is surfaced as an unavailable write.
  const grantMissing = createDashboardApi({
    verifyToken: async () => ({ uid: 'uid' }),
    findUser: async () => profile,
    repository: { listAfcRecords: async () => [] },
    writeRepository: { createAfcRecord: async () => { writes++; throw Object.assign(new Error('permission denied'), { code: 'SQL_PERMISSION_DENIED' }); } },
    writeGates: { afcSingle: true }
  });
  const failClosed = await grantMissing.createAfcRecord('token', payload);
  assert.equal(failClosed.status, 503);
  assert.equal(failClosed.body.error.code, 'SQL_UNAVAILABLE');
  assert.equal(writes, 1);
});
