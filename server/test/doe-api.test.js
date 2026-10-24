'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDoeApi } = require('../src/doe/doe-api');
const { createDoeFunctions } = require('../src/runtime/swa-doe-functions');

function request(url, method='GET', token='ok', body) {
  return { method, url: `https://local${url}`, headers: { get: name => name.toLowerCase()==='authorization' ? `Bearer ${token}` : null }, json: async () => body };
}
function build(role, facultyId=null) {
  const api = createDoeApi({
    verifyToken: async () => ({ uid: 'uid1' }),
    findUser: async () => ({ active: true, mustChangePassword: false, baseRole: role, facultyId }),
    repository: { loadActivePolicy: async academicYear => ({ version:{policyVersionId:'p1',academicYear,status:'active',revision:1},rules:[],exceptions:[] }) },
    calculationService: { preview: async input => ({ ...input, resultDoe: 1 }) },
    worksheetService: {
      buildFacultyWorksheet: async input => ({ ...input, status: 'calculated' }),
      listFacultyDoe: async input => [{ academicYear: input.academicYear }]
    }
  });
  return createDoeFunctions({ api });
}

test('administrator can read the active annual policy', async () => {
  const response = await build('administrator')(request('/api/v1/doe/policy?academicYear=2026-2027'));
  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.policy.version.academicYear, '2026-27');
});

test('DOE capability endpoint returns configured gates only to active administrators',async()=>{
  const make=(role,gates)=>createDoeFunctions({api:createDoeApi({
    verifyToken:async()=>({uid:'u1'}),findUser:async()=>({active:true,baseRole:role}),
    repository:{loadActivePolicy:async()=>null},calculationService:{preview:async()=>({})},writeGates:gates
  })});
  const admin=await make('administrator',{doeAdmin:true,doeManualAssignment:false,doePolicyPublish:false,doeRecalculate:true})(request('/api/v1/doe/write-capabilities'));
  assert.equal(admin.status,200);
  assert.deepEqual(admin.jsonBody.writeCapabilities,{doeAdmin:true,doeManualAssignment:false,doePolicyPublish:false,doeRecalculate:true});
  assert.equal((await make('faculty',{doeAdmin:true})(request('/api/v1/doe/write-capabilities'))).status,403);
  assert.equal((await make('administrator',{})(request('/api/v1/doe/write-capabilities','POST'))).status,405);
});

test('DOE preview is restricted to administrator roles', async () => {
  const fn = build('faculty','11111111-1111-1111-1111-111111111111');
  const denied = await fn(request('/api/v1/doe/preview','POST','ok',{academicYear:'2026-27',facts:{facultyId:'22222222-2222-2222-2222-222222222222'}}));
  assert.equal(denied.status,403);
  const allowed = await build('administrator')(request('/api/v1/doe/preview','POST','ok',{academicYear:'2026-27',facts:{facultyId:'11111111-1111-1111-1111-111111111111'}}));
  assert.equal(allowed.status,200);
});

test('invalid year and invalid preview payload fail before calculation', async () => {
  const fn = build('administrator');
  const invalidYear = await fn(request('/api/v1/doe/policy?academicYear=2026'));
  assert.equal(invalidYear.status,400);
  const invalidPayload = await fn(request('/api/v1/doe/preview','POST','ok',{academicYear:'2026-27',facts:{},resultDoe:99}));
  assert.equal(invalidPayload.status,400);
});

test('preview preserves deterministic mapping and rule review outcomes', async () => {
  const api = createDoeApi({
    verifyToken: async () => ({ uid:'uid1' }),
    findUser: async () => ({ active:true, baseRole:'administrator' }),
    repository: { loadActivePolicy: async () => null },
    calculationService: { preview: async () => { throw Object.assign(new Error('mapping required'), { code:'COURSE_MAPPING_REQUIRED' }); } }
  });
  const fn = createDoeFunctions({ api });
  const response = await fn(request('/api/v1/doe/preview','POST','ok',{academicYear:'2026-27',facts:{category:'hicc',courseCode:'VTMD 204'}}));
  assert.equal(response.status,422);
  assert.equal(response.jsonBody.error.code,'COURSE_MAPPING_REQUIRED');
});

test('unknown paths and unsupported methods are rejected', async () => {
  const fn = build('administrator');
  assert.equal((await fn(request('/api/v1/doe/policy','POST'))).status,405);
  assert.equal((await fn(request('/api/v1/doe/not-real'))).status,404);
});

test('administrator can read the DOE List and an eligible Faculty role can read only its own worksheet', async () => {
  const admin = build('administrator');
  assert.equal((await admin(request('/api/v1/doe/worksheets?academicYear=2026-27'))).status, 200);
  const self = build('faculty','11111111-1111-1111-1111-111111111111');
  const own = await self(request('/api/v1/doe/worksheet?academicYear=2026-27&facultyId=11111111-1111-1111-1111-111111111111'));
  assert.equal(own.status, 200);
  const other = await self(request('/api/v1/doe/worksheet?academicYear=2026-27&facultyId=22222222-2222-2222-2222-222222222222'));
  assert.equal(other.status, 403);
  assert.equal((await self(request('/api/v1/doe/worksheets?academicYear=2026-27'))).status, 403);
});

test('worksheet route rejects unsupported methods and invalid years', async () => {
  const fn = build('administrator');
  assert.equal((await fn(request('/api/v1/doe/worksheet?academicYear=2026-27&facultyId=f1','POST'))).status, 405);
  assert.equal((await fn(request('/api/v1/doe/worksheets?academicYear=2026'))).status, 400);
});

test('DOE assignment writes are both admin-authorized and default-gated', async () => {
  let saves = 0;
  const apiFor = (role, gate) => createDoeApi({
    verifyToken: async () => ({ uid: 'uid1' }),
    findUser: async () => ({ active: true, baseRole: role, facultyId: '11111111-1111-1111-1111-111111111111' }),
    repository: { loadActivePolicy: async () => null },
    calculationService: { preview: async () => ({}) },
    assignmentService: {
      saveDoeAssignment: async input => { saves++; return { assignmentFactId: '11111111-1111-1111-1111-111111111112', resultDoe: 12, revision: 1, actor: input.actor }; },
      deactivateDoeAssignment: async () => ({ active: false })
    },
    writeGates: { doeAdmin: gate }
  });
  const payload = { facultyId: '11111111-1111-1111-1111-111111111111', academicYear: '2026-27', facts: { roleType: 'Course Coordinator', courseCode: 'VTMD 204' } };
  const closed = await apiFor('administrator', false).saveAssignment('ok', payload);
  assert.equal(closed.status, 503);
  assert.equal(saves, 0);
  const denied = await apiFor('faculty', true).saveAssignment('ok', payload);
  assert.equal(denied.status, 403);
  assert.equal(saves, 0);
  const allowed = await apiFor('administrator', true).saveAssignment('ok', payload);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.assignment.resultDoe, 12);
  assert.equal(allowed.body.assignment.actor.uid, 'uid1');
  assert.equal(saves, 1);
});

test('DOE assignment routes enforce methods and authenticated admin capability', async () => {
  const route = build('administrator');
  assert.equal((await route(request('/api/v1/doe/assignments','GET'))).status, 405);
  const denied = await build('faculty')(request('/api/v1/doe/assignments','POST','ok',{
    academicYear: '2026-27', facultyId: '11111111-1111-1111-1111-111111111111', facts: { roleType: 'Course Coordinator' }
  }));
  assert.equal(denied.status, 403);
});

test('DOE target override writes are default-gated and explicit null is the clear operation', async () => {
  const calls = [];
  const buildTarget = (role, gate) => createDoeFunctions({ api: createDoeApi({
    verifyToken: async () => ({ uid: 'uid1' }), findUser: async () => ({ active: true, baseRole: role }),
    repository: { loadActivePolicy: async () => null }, calculationService: { preview: async () => ({}) },
    targetOverrideService: { saveOverride: async input => { calls.push(input); return { effectiveTargetDoe: input.override?.value ?? 40 }; } },
    writeGates: { doeAdmin: gate }
  }) });
  const payload = { academicYear: '2026-27', override: { value: 25, reason: 'RSL' } };
  assert.equal((await buildTarget('administrator', false)(request('/api/v1/doe/targets/11111111-1111-1111-1111-111111111111','PUT','ok',payload))).status, 503);
  assert.equal(calls.length, 0);
  const admin = buildTarget('administrator', true);
  assert.equal((await admin(request('/api/v1/doe/targets/11111111-1111-1111-1111-111111111111','PUT','ok',payload))).status, 200);
  assert.equal(calls[0].actor.uid, 'uid1');
  assert.equal(calls[0].override.value, 25);
  const clear = await admin(request('/api/v1/doe/targets/11111111-1111-1111-1111-111111111111','PUT','ok',{ academicYear: '2026-27', override: null }));
  assert.equal(clear.status, 200);
  assert.equal(calls[1].override, null);
  assert.equal((await buildTarget('faculty', true)(request('/api/v1/doe/targets/11111111-1111-1111-1111-111111111111','PUT','ok',payload))).status, 403);
});

test('annual Rule Book lifecycle endpoints are administrator-only and publishing/recalculation have independent gates', async () => {
  const calls = [];
  const make = (role, gates = {}) => createDoeFunctions({ api: createDoeApi({
    verifyToken: async () => ({ uid: 'admin-uid' }), findUser: async () => ({ active: true, baseRole: role }),
    repository: { loadActivePolicy: async () => null, getPolicyVersion: async id => ({ version: { policyVersionId: id, academicYear: '2026-27', status: 'draft', revision: 2 } }) },
    calculationService: { preview: async () => ({}) },
    policyService: {
      createDraft: async input => { calls.push(['createDraft', input]); return { policyVersionId: 'p-new', status: 'draft' }; },
      saveDraft: async input => { calls.push(['saveDraft', input]); return { revision: 3 }; },
      validateDraft: async input => { calls.push(['validate', input]); return { valid: true }; },
      previewImpact: async input => { calls.push(['impact', input]); return { impactRunId: 'i-1' }; },
      publishDraft: async input => { calls.push(['publish', input]); return { status: 'active' }; },
      copyPreviousYear: async input => ({ ...input, status: 'draft' }),
      listHistory: async year => [{ academicYear: year }], archive: async input => input,
      recalculate: async input => { calls.push(['recalculate', input]); return { created: 1 }; }
    }, writeGates: gates
  }) });
  const admin = make('developer', { doeAdmin: true, doeManualAssignment: false, doePolicyPublish: false, doeRecalculate: false });
  const created = await admin(request('/api/v1/doe/policies/draft', 'POST', 'ok', { academicYear: '2026-27', versionLabel: 'Draft 1', sourceReference: 'UCVM annual guidelines' }));
  assert.equal(created.status, 200);
  const saved = await admin(request('/api/v1/doe/policies/p1/draft', 'PUT', 'ok', { expectedRevision: 2, patch: { rules: [] } }));
  assert.equal(saved.status, 200);
  assert.equal((await admin(request('/api/v1/doe/policies/p1/publish', 'POST', 'ok', { expectedRevision: 2 }))).status, 503);
  assert.equal((await admin(request('/api/v1/doe/recalculate', 'POST', 'ok', { academicYear: '2026-27' }))).status, 503);
  assert.equal((await make('faculty', { doeAdmin: true })(request('/api/v1/doe/policies/p1/validate', 'POST', 'ok', { expectedRevision: 2 }))).status, 403);
  assert.deepEqual(calls[0][1].actorUid, 'admin-uid');
});

test('high-trust DOE policy and global recalculation actions include Developer and require owner/general semantics', async () => {
  const calls = [];
  const make = role => createDoeFunctions({ api: createDoeApi({
    verifyToken: async () => ({ uid: 'actor-uid' }),
    findUser: async () => ({ active: true, baseRole: role }),
    repository: { loadActivePolicy: async () => ({ version: { status: 'active', academicYear: '2026-27' } }) },
    calculationService: { preview: async () => ({}) },
    policyService: {
      publishDraft: async input => { calls.push(['publish', role, input]); return { status: 'active' }; },
      archive: async input => { calls.push(['archive', role, input]); return { status: 'archived' }; },
      recalculate: async input => { calls.push(['recalculate', role, input]); return { recordsCreated: 1 }; }
    },
    writeGates: { doePolicyPublish: true, doeRecalculate: true }
  }) });
  const paths = [
    ['/api/v1/doe/policies/p1/publish', 'POST', { expectedRevision: 2 }],
    ['/api/v1/doe/policies/p1/archive', 'POST', { expectedRevision: 2 }],
    ['/api/v1/doe/recalculate', 'POST', { academicYear: '2026-27' }]
  ];

  for (const role of ['administrator', 'admin', 'adfa_regular']) {
    const fn = make(role);
    for (const [path, method, body] of paths) {
      assert.equal((await fn(request(path, method, 'ok', body))).status, 403, `${role} must be denied ${path}`);
    }
  }
  for (const role of ['developer', 'owner', 'adfa_general']) {
    const fn = make(role);
    for (const [path, method, body] of paths) {
      assert.equal((await fn(request(path, method, 'ok', body))).status, 200, `${role} must be allowed ${path}`);
    }
  }
  assert.equal(calls.length, 9);
});

test('faculty transfer workflow preview is admin-authorized, server-backed, and accepts identities only', async () => {
  let calls = 0;
  const api = createDoeApi({
    verifyToken: async () => ({ uid: 'uid1' }),
    findUser: async () => ({ active: true, baseRole: 'developer' }),
    repository: { loadActivePolicy: async () => null },
    calculationService: { preview: async () => ({}) },
    workflowPreviewService: { previewFacultyTransfer: async input => { calls++; return { status: 'needs_review', ...input, evidencePersisted: false }; } }
  });
  const route = createDoeFunctions({ api });
  const payload = { sessionId: '11111111-1111-4111-8111-111111111111', outgoingFacultyId: '22222222-2222-4222-8222-222222222222', incomingFacultyId: '33333333-3333-4333-8333-333333333333' };
  const preview = await route(request('/api/v1/doe/workflow-preview', 'POST', 'ok', payload));
  assert.equal(preview.status, 200);
  assert.equal(preview.jsonBody.preview.status, 'needs_review');
  assert.equal(preview.jsonBody.preview.evidencePersisted, false);
  assert.equal(calls, 1);
  assert.equal((await route(request('/api/v1/doe/workflow-preview', 'POST', 'ok', { ...payload, sessionId: 's1' }))).status, 400);
  assert.equal(calls, 1);
  assert.equal((await route(request('/api/v1/doe/workflow-preview', 'POST', 'ok', { ...payload, resultDoe: 100 }))).status, 400);
  assert.equal(calls, 1);

  const faculty = createDoeFunctions({ api: createDoeApi({
    verifyToken: async () => ({ uid: 'uid1' }), findUser: async () => ({ active: true, baseRole: 'faculty' }),
    repository: { loadActivePolicy: async () => null }, calculationService: { preview: async () => ({}) },
    workflowPreviewService: { previewFacultyTransfer: async () => { throw new Error('must not run'); } }
  }) });
  assert.equal((await faculty(request('/api/v1/doe/workflow-preview', 'POST', 'ok', payload))).status, 403);
  assert.equal((await route(request('/api/v1/doe/workflow-preview', 'GET'))).status, 405);
});

test('workflow preview maps SQL missing-session and invalid transfer outcomes', async () => {
  const make = error => createDoeFunctions({ api: createDoeApi({
    verifyToken: async () => ({ uid: 'uid1' }), findUser: async () => ({ active: true, baseRole: 'administrator' }),
    repository: { loadActivePolicy: async () => null }, calculationService: { preview: async () => ({}) },
    workflowPreviewService: { previewFacultyTransfer: async () => { throw Object.assign(new Error('preview failed'), { code: error }); } }
  }) });
  const payload = { sessionId: '11111111-1111-4111-8111-111111111111', outgoingFacultyId: '22222222-2222-4222-8222-222222222222', incomingFacultyId: '33333333-3333-4333-8333-333333333333' };
  assert.equal((await make('SESSION_NOT_FOUND')(request('/api/v1/doe/workflow-preview', 'POST', 'ok', payload))).status, 404);
  assert.equal((await make('FACULTY_ALREADY_ASSIGNED')(request('/api/v1/doe/workflow-preview', 'POST', 'ok', payload))).status, 422);
});
