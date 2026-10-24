'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDashboardApi } = require('../src/data/dashboard-api');
const { createDashboardFunctions } = require('../src/runtime/swa-dashboard-functions');
const { createWriteGates } = require('../src/data/write-gates');
const { createSqlDashboardRepository } = require('../src/data/sql-dashboard-repository');
const ID = '22222222-2222-4222-8222-222222222222';
function harness({ role = 'administrator', gates = { afcCancel: true }, fail, tokenValid = true } = {}) {
  const calls = [];
  const api = createDashboardApi({
    verifyToken: async () => { if (!tokenValid) throw Error('invalid'); return { uid: 'trusted-uid' }; },
    findUser: async () => ({ active: true, baseRole: role, displayName: 'Trusted Admin', facultyId: ID }),
    writeGates: gates,
    repository: {},
    writeRepository: { cancelAfcRecord: async input => { calls.push(input); if (fail) throw fail; return { afcRecordId: ID, active: false, sourceKind: input.sourceKind }; } }
  });
  const app = createDashboardFunctions({ api });
  const request = (body, method = 'POST', suffix = `${ID}/cancel`) => app({ method, url: `https://local/api/v1/dashboard/afc-records/${suffix}`, headers: { get: () => 'Bearer token' }, json: async () => body });
  return { api, request, calls };
}
const body = { sourceKind: 'manual', expectedVersion: '00000000000000AB' };
test('AFC cancellation rejects anonymous and faculty callers before any mutation', async () => {
  for (const options of [{ tokenValid: false }, { role: 'faculty' }, { role: 'hicc' }]) {
    const h = harness(options); const response = await h.request(body);
    assert.equal(response.status, options.tokenValid === false ? 401 : 403);
    assert.equal(h.calls.length, 0);
  }
});
test('AFC cancellation has its own fail-closed gate independent of creation', async () => {
  assert.equal(createWriteGates({ PAWS_AFC_SINGLE_WRITE_ENABLED: 'true' }).afcCancel, false);
  const h = harness({ gates: { afcSingle: true } });
  assert.equal((await h.request(body)).jsonBody.error.code, 'WRITE_DISABLED');
  assert.equal(h.calls.length, 0);
});
test('AFC cancellation requires an exact source and optimistic version', async () => {
  const h = harness();
  for (const input of [{}, { ...body, sourceKind: 'request' }, { ...body, expectedVersion: '' }, { ...body, expectedVersion: '00000000000000ABextra' }]) {
    assert.equal((await h.request(input)).status, 400);
  }
  assert.equal((await h.request(body, 'POST', 'bad-id/cancel')).status, 400);
  assert.equal(h.calls.length, 0);
});
test('AFC cancellation trusts server identity and returns the inactive row for both sources', async () => {
  for (const sourceKind of ['manual', 'import']) {
    const h = harness(); const response = await h.request({ ...body, sourceKind, actorFirebaseUid: 'spoof', actorName: 'spoof' });
    assert.equal(response.status, 200);
    assert.equal(response.jsonBody.afcRecord.active, false);
    assert.equal(h.calls[0].actorFirebaseUid, 'trusted-uid');
    assert.equal(h.calls[0].actorName, 'Trusted Admin');
    assert.equal(h.calls[0].afcRecordId, ID);
  }
});
test('AFC cancellation reports stale, missing and unavailable SQL results without false success', async () => {
  for (const [number, status, code] of [[53604, 409, 'AFC_RECORD_CHANGED'], [53603, 404, 'AFC_RECORD_NOT_FOUND'], [53602, 403, 'ROLE_DENIED'], [999, 503, 'SQL_UNAVAILABLE']]) {
    const h = harness({ fail: { number } }); const response = await h.request(body);
    assert.equal(response.status, status); assert.equal(response.jsonBody.error.code, code);
  }
});
test('AFC cancellation endpoint rejects methods other than POST', async () => {
  const h = harness();
  for (const method of ['GET', 'DELETE', 'PATCH']) assert.equal((await h.request(body, method)).status, 405);
  assert.equal(h.calls.length, 0);
});
test('AFC list passes the SQL concurrency token through the repository and API to the row action',async()=>{
  const repository=createSqlDashboardRepository({query:async()=>[{afcRecordId:ID,sourceKind:'manual',active:true,versionToken:'00000000000000AB'}]});
  const api=createDashboardApi({verifyToken:async()=>({uid:'user'}),findUser:async()=>({active:true,baseRole:'administrator'}),repository});
  const response=await api.afcRecords('token');
  assert.equal(response.body.afcRecords[0].versionToken,'00000000000000AB');
});
