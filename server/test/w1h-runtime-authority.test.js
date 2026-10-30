'use strict';

const { repositoryPath } = require('../../tools/build/frontend-paths');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWriteGates } = require('../src/data/write-gates');
const { createAfcRequestApi } = require('../src/afc/afc-request-api');
const { createAfcApprovalApi } = require('../src/afc/afc-approval-api');
const { createAfcApprovedArtifactApi } = require('../src/afc/afc-approved-artifact-api');
const { createAfcRequestFunctions, AFC_WRITE_CAPABILITIES_PATH } = require('../src/runtime/swa-afc-request-functions');

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const profile = { active: true, mustChangePassword: false, baseRole: 'faculty', facultyId: 'trusted-faculty', displayName: 'Trusted Faculty' };
const auth = { verifyToken: async () => ({ uid: 'trusted-uid' }), findUser: async () => profile };
const adminAuth = { verifyToken: auth.verifyToken, findUser: async () => ({ ...profile, baseRole: 'administrator', facultyId: null }) };

test('W1H adds three independent exact-lowercase true gates and preserves W1C gates', () => {
  assert.deepEqual(createWriteGates({}), {
    swapRequest: false, swapDecision: false, swapApply: false, afcSingle: false, afcBatch: false, afcCancel: false, afcEdit: false, sessionEdit: false, sessionCreate: false,
    afcRequest: false, afcDecision: false, afcArtifact: false, afcFormUpload: false, cccReplaceStage: false, cccReplaceCommit: false,
    taDraft: false, taReview: false, taFinal: false, taPublish: false, facultyAdmin: false,
    doeAdmin: false, doeManualAssignment: false, doePolicyPublish: false, doeRecalculate: false,
    schedulingTaskReview:false,calendarActivityStage:false,calendarActivityCommit:false,calendarActivityTime:false
  });
  assert.deepEqual(createWriteGates({
    PAWS_AFC_SINGLE_WRITE_ENABLED: 'true',
    PAWS_AFC_BATCH_WRITE_ENABLED: 'false',
    PAWS_SESSION_EDIT_WRITE_ENABLED: 'TRUE',
    PAWS_AFC_REQUEST_WRITE_ENABLED: 'true',
    PAWS_AFC_DECISION_WRITE_ENABLED: 'True',
    PAWS_AFC_ARTIFACT_WRITE_ENABLED: '1'
  }), {
    swapRequest: false, swapDecision: false, swapApply: false, afcSingle: true, afcBatch: false, afcCancel: false, afcEdit: false, sessionEdit: false, sessionCreate: false,
    afcRequest: true, afcDecision: false, afcArtifact: false, afcFormUpload: false, cccReplaceStage: false, cccReplaceCommit: false,
    taDraft: false, taReview: false, taFinal: false, taPublish: false, facultyAdmin: false,
    doeAdmin: false, doeManualAssignment: false, doePolicyPublish: false, doeRecalculate: false,
    schedulingTaskReview:false,calendarActivityStage:false,calendarActivityCommit:false,calendarActivityTime:false
  });
  for (const value of [undefined, 'false', 'TRUE', 'True', '1', 'yes', ' true', 'true ']) {
    const env = value === undefined ? {} : { PAWS_AFC_REQUEST_WRITE_ENABLED: value };
    assert.equal(createWriteGates(env).afcRequest, false, String(value));
    assert.equal(createWriteGates({ PAWS_AFC_DECISION_WRITE_ENABLED: value }).afcDecision, false, String(value));
    assert.equal(createWriteGates({ PAWS_AFC_ARTIFACT_WRITE_ENABLED: value }).afcArtifact, false, String(value));
    assert.equal(createWriteGates({ PAWS_AFC_EDIT_WRITE_ENABLED: value }).afcEdit, false, String(value));
  }
  assert.equal(createWriteGates({ PAWS_AFC_EDIT_WRITE_ENABLED: 'true' }).afcEdit, true);
});

test('AFC request submit and withdraw are authenticated but never call repository while lifecycle gate is disabled', async () => {
  let writes = 0;
  const api = createAfcRequestApi({ ...auth, writeGates: {}, repository: {
    submitRequest: async () => { writes++; },
    withdrawRequest: async () => { writes++; }
  } });
  for (const result of [await api.submit('token', {}), await api.withdraw('token', REQUEST_ID)]) {
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'WRITE_DISABLED');
  }
  assert.equal(writes, 0);
});

test('AFC request exact true opens lifecycle gate while other domains remain independent', async () => {
  const calls = [];
  const api = createAfcRequestApi({
    ...auth,
    writeGates: createWriteGates({ PAWS_AFC_REQUEST_WRITE_ENABLED: 'true' }),
    idFactory: () => REQUEST_ID,
    repository: {
      submitRequest: async input => { calls.push(['submit', input]); return { afcRequestId: input.afcRequestId, status: 'pending_report_to' }; },
      withdrawRequest: async input => { calls.push(['withdraw', input]); return { afcRequestId: input.afcRequestId, status: 'withdrawn' }; }
    }
  });
  const submit = await api.submit('token', {
    startDate: '2026-10-05', endDate: '2026-10-05', reason: 'vacation',
    contactAddress: 'Address', contactPhone: '403', termsAccepted: true,
    termsVersion: 'ucvm-afc-terms-page2-v1', termsSource: 'absence-from-campus-app.pdf#page=2',
    applicantSignature: { mode: 'typed', name: 'A', uid: 'trusted-uid', signedAt: '2026-10-05T12:00:00Z', fingerprint: 'a'.repeat(64), attested: true }
  });
  assert.equal(submit.status, 201);
  assert.equal((await api.withdraw('token', REQUEST_ID)).status, 200);
  assert.deepEqual(calls.map(([name]) => name), ['submit', 'withdraw']);
  assert.equal(createWriteGates({ PAWS_AFC_REQUEST_WRITE_ENABLED: 'true' }).afcDecision, false);
});

test('write-capabilities endpoint requires an authenticated GET and advertises only server gates', async () => {
  const api = createAfcRequestApi({
    ...auth,
    writeGates: createWriteGates({ PAWS_AFC_REQUEST_WRITE_ENABLED: 'true', PAWS_AFC_ARTIFACT_WRITE_ENABLED: 'true' }),
    repository: { listRequests: async () => { throw new Error('capability reads must not query request data'); } }
  });
  const route = createAfcRequestFunctions({ api });
  const request = (method, authorization = 'Bearer token') => ({
    method, url: `https://paws.invalid${AFC_WRITE_CAPABILITIES_PATH}`,
    headers: { get: name => name.toLowerCase() === 'authorization' ? authorization : null }
  });
  assert.deepEqual(await route(request('GET')), {
    status: 200,
    jsonBody: { writeCapabilities: { sessionEdit: false, sessionCreate: false, afcSingle: false, afcBatch: false, requestLifecycle: true, decisions: false, approvedArtifactCreation: true, dateChange: false } }
  });
  assert.equal((await route(request('POST'))).status, 405);
  const unauthenticatedRoute = createAfcRequestFunctions({ api: createAfcRequestApi({
    verifyToken: async () => { throw new Error('invalid token'); },
    findUser: auth.findUser,
    writeGates: {}
  }) });
  assert.equal((await unauthenticatedRoute(request('GET', ''))).status, 401);
});

test('AFC recommend, reject and approve fail closed before any write repository call', async () => {
  let writes = 0;
  const api = createAfcApprovalApi({ ...adminAuth, writeGates: {}, repository: {
    recommendRequest: async () => { writes++; },
    rejectRequest: async () => { writes++; },
    approveRequest: async () => { writes++; }
  } });
  for (const result of [
    await api.recommend('token', REQUEST_ID, {}),
    await api.reject('token', REQUEST_ID, {}),
    await api.approve('token', REQUEST_ID, {})
  ]) {
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'WRITE_DISABLED');
  }
  assert.equal(writes, 0);
});

test('approved artifact GET remains available while POST create gate blocks before all repositories', async () => {
  const calls = [];
  const artifact = { afcRequestId: REQUEST_ID, contentType: 'application/pdf', pdfBytes: Buffer.from([1]), byteLength: 1 };
  const api = createAfcApprovedArtifactApi({
    ...adminAuth,
    writeGates: {},
    repository: {
      getApprovedArtifact: async () => { calls.push('get'); return artifact; },
      getApprovedArtifactSource: async () => { calls.push('source'); return { sourceSnapshotJson: '{}' }; },
      createOrGetApprovedArtifact: async () => { calls.push('create'); return artifact; }
    },
    renderer: async () => ({})
  });
  const get = await api.get('token', REQUEST_ID);
  assert.equal(get.status, 200);
  const post = await api.create('token', REQUEST_ID, Buffer.alloc(0));
  assert.equal(post.status, 503);
  assert.equal(post.body.error.code, 'WRITE_DISABLED');
  assert.deepEqual(calls, ['get']);
});

test('W1H migration grants only exact domain procedure execution and deterministic empty-role rollback', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const migration = fs.readFileSync(repositoryPath(__dirname, '..', '..', 'database', 'azure-sql', '018_w1h_afc_runtime_write_roles.sql'), 'utf8');
  for (const role of ['paws_runtime_afc_request_write', 'paws_runtime_afc_decision_write', 'paws_runtime_afc_artifact_write']) assert.match(migration, new RegExp('CREATE ROLE \\[' + role + '\\]', 'i'));
  for (const proc of ['SubmitAfcRequest', 'WithdrawAfcRequest', 'RecommendAfcRequest', 'RejectAfcRequest', 'ApproveAfcRequest', 'CreateOrGetApprovedAfcArtifact']) assert.match(migration, new RegExp('GRANT EXECUTE ON OBJECT::paws_api\\.' + proc, 'i'));
  assert.doesNotMatch(migration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CONTROL)\b/i);
  assert.doesNotMatch(migration, /GRANT\s+EXECUTE\s+ON\s+SCHEMA/i);
  assert.doesNotMatch(migration, /(?:db_owner|db_datawriter|CONTROL\s+DATABASE|ALTER\s+DATABASE|ADD\s+MEMBER)/i);
  assert.match(migration, /DO NOT RUN|PREPARATION ONLY/i);
});
