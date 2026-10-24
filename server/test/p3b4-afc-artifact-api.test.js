'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { RENDERER_VERSION } = require('../src/afc/afc-approved-artifact-renderer');
const { createAfcApprovedArtifactApi } = require('../src/afc/afc-approved-artifact-api');

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID_2 = '33333333-3333-4333-8333-333333333333';
const SOURCE_JSON = '{"afcRequestId":"22222222-2222-4222-8222-222222222222","status":"approved"}';
const SOURCE_SHA256 = Buffer.alloc(32, 0x11);
const TEMPLATE_SHA256 = Buffer.from('481677829217736B15CB3CBB010F49CB553A8664FE53F8604782093E99896547', 'hex');
const NO_ARTIFACT = Object.assign(new Error('not available'), { code: 'ARTIFACT_NOT_FOUND', status: 404 });

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest();
}

function profile(baseRole = 'faculty', overrides = {}) {
  return { active: true, mustChangePassword: false, baseRole, facultyId: 'faculty-1', ...overrides };
}

function makeRendered(overrides = {}) {
  const pdfBytes = Buffer.from('%PDF-rendered-approved-request');
  return {
    pdfBytes,
    pdfSha256: digest(pdfBytes),
    byteLength: pdfBytes.length,
    rendererVersion: RENDERER_VERSION,
    templateSha256: Buffer.from(TEMPLATE_SHA256),
    ...overrides,
  };
}

function makeStoredArtifact(overrides = {}) {
  const pdfBytes = Buffer.from('%PDF-stored-authoritative-artifact');
  return {
    afcArtifactId: '44444444-4444-4444-8444-444444444444',
    afcRequestId: REQUEST_ID,
    contentType: 'application/pdf',
    pdfBytes,
    pdfSha256: digest(pdfBytes),
    byteLength: pdfBytes.length,
    sourceSnapshotSha256: Buffer.from(SOURCE_SHA256),
    templateSha256: Buffer.from(TEMPLATE_SHA256),
    rendererVersion: '1.0.0',
    createdAtUtc: '2026-10-04T14:00:00.000Z',
    ...overrides,
  };
}

function makeHarness({
  allowedUids = new Set(['uid-requester']),
  profiles = { 'uid-requester': profile() },
  existingArtifact = null,
  render = async () => makeRendered(),
  sourceSnapshotJson = SOURCE_JSON,
  sourceSnapshotSha256 = SOURCE_SHA256,
  repositoryOverrides = {},
} = {}) {
  const calls = { verifyToken: 0, findUser: 0, get: [], source: [], render: 0, create: [] };
  const stored = makeStoredArtifact();
  const repository = {
    async getApprovedArtifact(input) {
      calls.get.push(input);
      if (existingArtifact) return existingArtifact;
      throw NO_ARTIFACT;
    },
    async getApprovedArtifactSource(input) {
      calls.source.push(input);
      if (!allowedUids.has(input.actorFirebaseUid)) throw NO_ARTIFACT;
      return { sourceSnapshotJson, sourceSnapshotSha256: Buffer.from(sourceSnapshotSha256) };
    },
    async createOrGetApprovedArtifact(input) {
      calls.create.push(input);
      return stored;
    },
    ...repositoryOverrides,
  };
  const api = createAfcApprovedArtifactApi({
    verifyToken: async token => {
      calls.verifyToken++;
      if (!token || token === 'invalid-token') throw new Error('private token verification detail');
      return { uid: token, aud: 'paws-beta' };
    },
    findUser: async uid => {
      calls.findUser++;
      return profiles[uid] || null;
    },
    repository,
    writeGates: { afcArtifact: true },
    renderer: async snapshot => {
      calls.render++;
      assert.equal(snapshot, sourceSnapshotJson);
      return render(snapshot);
    },
  });
  return { api, calls, repository, stored };
}

test('missing and invalid Firebase tokens return 401 before SQL or rendering', async () => {
  const { api, calls } = makeHarness();
  const missing = await api.get('', REQUEST_ID);
  const invalid = await api.create('invalid-token', REQUEST_ID, Buffer.alloc(0));

  assert.deepEqual(missing, { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } } });
  assert.deepEqual(invalid, missing);
  assert.equal(calls.findUser, 0);
  assert.equal(calls.get.length, 0);
  assert.equal(calls.source.length, 0);
  assert.equal(calls.render, 0);
});

test('inactive and password-change-required profiles cannot retrieve or create artifacts', async () => {
  for (const [uid, p, expectedCode] of [
    ['uid-inactive', profile('faculty', { active: false }), 'PROFILE_REQUIRED'],
    ['uid-change-password', profile('administrator', { mustChangePassword: true, facultyId: null }), 'PASSWORD_CHANGE_REQUIRED'],
  ]) {
    const { api, calls } = makeHarness({ profiles: { [uid]: p } });
    const response = await api.create(uid, REQUEST_ID, Buffer.alloc(0));
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, expectedCode);
    assert.equal(calls.get.length, 0);
    assert.equal(calls.source.length, 0);
    assert.equal(calls.render, 0);
  }
});

test('requester, actual Reports-To/Admin approvers, and active administrator pass only token UID to SQL', async () => {
  const actors = [
    ['uid-requester', profile('faculty')],
    ['uid-reports-to', profile('hicc')],
    ['uid-admin-approver', profile('visc')],
    ['uid-active-admin', profile('adfa_general', { facultyId: null })],
  ];

  for (const [uid, actorProfile] of actors) {
    const { api, calls } = makeHarness({ allowedUids: new Set([uid]), profiles: { [uid]: actorProfile } });
    const response = await api.create(uid, REQUEST_ID, Buffer.alloc(0));
    assert.equal(response.status, 201, uid);
    assert.deepEqual(calls.get[0], { afcRequestId: REQUEST_ID, actorFirebaseUid: uid });
    assert.deepEqual(calls.source[0], { afcRequestId: REQUEST_ID, actorFirebaseUid: uid });
    assert.deepEqual(Object.keys(calls.create[0]).sort(), [
      'actorFirebaseUid', 'afcRequestId', 'byteLength', 'pdfBytes', 'pdfSha256',
      'rendererVersion', 'sourceSnapshotSha256', 'templateSha256',
    ]);
    assert.equal(calls.create[0].actorFirebaseUid, uid);
    assert.equal(calls.create[0].afcRequestId, REQUEST_ID);
  }
});

test('absent, unapproved, and unrelated requests are indistinguishable as not found', async () => {
  const responses = [];
  for (const state of ['absent', 'unapproved', 'unrelated']) {
    const uid = state === 'unrelated' ? 'uid-unrelated' : 'uid-requester';
    const { api } = makeHarness({
      profiles: { [uid]: profile() },
      allowedUids: new Set(),
      repositoryOverrides: {
        async getApprovedArtifactSource() { throw NO_ARTIFACT; },
      },
    });
    responses.push(await api.create(uid, REQUEST_ID, Buffer.alloc(0)));
  }

  assert.deepEqual(responses[0], { status: 404, body: { error: { code: 'ARTIFACT_NOT_FOUND', message: 'The approved AFC artifact is not available.' } } });
  assert.deepEqual(responses[1], responses[0]);
  assert.deepEqual(responses[2], responses[0]);
  for (const response of responses) assert.equal(Object.hasOwn(response, 'artifact'), false);
});

test('only an authorized approved request with no stored artifact can enter the render-and-create path', async () => {
  const notAuthorized = Object.assign(new Error('not available'), { code: 'REQUEST_NOT_FOUND', status: 404 });
  const { api, calls } = makeHarness({ repositoryOverrides: {
    async getApprovedArtifact() { throw notAuthorized; },
  } });
  const response = await api.create('uid-requester', REQUEST_ID, Buffer.alloc(0));
  assert.deepEqual(response, { status: 404, body: { error: { code: 'REQUEST_NOT_FOUND', message: 'The approved AFC artifact is not available.' } } });
  assert.equal(calls.source.length, 0);
  assert.equal(calls.render, 0);
  assert.equal(calls.create.length, 0);
});

test('invalid request identifiers and non-empty create bodies stop before repository access', async () => {
  const { api, calls } = makeHarness();
  const invalidId = await api.create('uid-requester', 'not-a-uuid', Buffer.alloc(0));
  const nonEmptyBody = await api.create('uid-requester', REQUEST_ID, Buffer.from('{}'));

  assert.equal(invalidId.status, 400);
  assert.equal(invalidId.body.error.code, 'INVALID_REQUEST_ID');
  assert.equal(nonEmptyBody.status, 400);
  assert.equal(nonEmptyBody.body.error.code, 'ARTIFACT_BODY_NOT_ALLOWED');
  assert.equal(calls.get.length, 0);
  assert.equal(calls.source.length, 0);
  assert.equal(calls.render, 0);
});

test('GET returns stored bytes and never loads a source, renders, or creates', async () => {
  const existing = makeStoredArtifact();
  const { api, calls } = makeHarness({ existingArtifact: existing, render: async () => { throw new Error('must not render'); } });
  const response = await api.get('uid-requester', REQUEST_ID);

  assert.equal(response.status, 200);
  assert.equal(response.artifact, existing);
  assert.deepEqual(calls.get, [{ afcRequestId: REQUEST_ID, actorFirebaseUid: 'uid-requester' }]);
  assert.equal(calls.source.length, 0);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.render, 0);
});

test('POST returns an existing artifact unchanged without rerendering', async () => {
  const existing = makeStoredArtifact();
  const { api, calls } = makeHarness({ existingArtifact: existing, render: async () => { throw new Error('must not render'); } });
  const response = await api.create('uid-requester', REQUEST_ID, Buffer.alloc(0));

  assert.equal(response.status, 200);
  assert.equal(response.artifact, existing);
  assert.equal(calls.source.length, 0);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.render, 0);
});

test('POST renders authorized SQL snapshot and returns SQL persisted bytes, not renderer bytes', async () => {
  const { api, calls, stored } = makeHarness();
  const response = await api.create('uid-requester', REQUEST_ID, Buffer.alloc(0));

  assert.equal(response.status, 201);
  assert.equal(response.artifact, stored);
  assert.notDeepEqual(response.artifact.pdfBytes, makeRendered().pdfBytes);
  assert.deepEqual(calls.create[0], {
    afcRequestId: REQUEST_ID,
    actorFirebaseUid: 'uid-requester',
    sourceSnapshotSha256: SOURCE_SHA256,
    pdfBytes: makeRendered().pdfBytes,
    pdfSha256: makeRendered().pdfSha256,
    byteLength: makeRendered().byteLength,
    templateSha256: TEMPLATE_SHA256,
    rendererVersion: RENDERER_VERSION,
  });
});

test('oversized renderer output fails closed before SQL persistence', async () => {
  const oversized = Buffer.alloc(8_388_609);
  const { api, calls } = makeHarness({ render: async () => makeRendered({ pdfBytes: oversized, pdfSha256: digest(oversized), byteLength: oversized.length }) });
  const response = await api.create('uid-requester', REQUEST_ID, Buffer.alloc(0));

  assert.equal(response.status, 413);
  assert.equal(response.body.error.code, 'ARTIFACT_TOO_LARGE');
  assert.equal(Object.hasOwn(response, 'artifact'), false);
  assert.equal(calls.create.length, 0);
});

test('renderer output with a different template hash fails closed before SQL persistence', async () => {
  const { api, calls } = makeHarness({ render: async () => makeRendered({ templateSha256: Buffer.alloc(32, 0x33) }) });
  const response = await api.create('uid-requester', REQUEST_ID, Buffer.alloc(0));

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'ARTIFACT_RENDER_FAILED');
  assert.equal(Object.hasOwn(response, 'artifact'), false);
  assert.equal(calls.create.length, 0);
});

test('renderer output with an unexpected renderer version fails closed before SQL persistence', async () => {
  const { api, calls } = makeHarness({ render: async () => makeRendered({ rendererVersion: '9.9.9' }) });
  const response = await api.create('uid-requester', REQUEST_ID, Buffer.alloc(0));

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'ARTIFACT_RENDER_FAILED');
  assert.equal(Object.hasOwn(response, 'artifact'), false);
  assert.equal(calls.create.length, 0);
});

test('renderer output with a mismatched byte length fails closed before SQL persistence', async () => {
  const { api, calls } = makeHarness({ render: async () => makeRendered({ byteLength: 1 }) });
  const response = await api.create('uid-requester', REQUEST_ID, Buffer.alloc(0));

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'ARTIFACT_RENDER_FAILED');
  assert.equal(Object.hasOwn(response, 'artifact'), false);
  assert.equal(calls.create.length, 0);
});

test('source-hash conflicts return a bounded 409 and never expose rendered bytes', async () => {
  const { api, calls } = makeHarness({
    repositoryOverrides: {
      async createOrGetApprovedArtifact() { throw Object.assign(new Error('raw SQL conflict with source and PDF data'), { code: 'ARTIFACT_SOURCE_CHANGED', status: 409 }); },
    },
  });
  const response = await api.create('uid-requester', REQUEST_ID, Buffer.alloc(0));

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'ARTIFACT_SOURCE_CHANGED');
  assert.doesNotMatch(JSON.stringify(response), /raw SQL|PDF-rendered|source and PDF data/i);
  assert.equal(Object.hasOwn(response, 'artifact'), false);
  assert.equal(calls.render, 1);
});

test('concurrent creates return identical persisted bytes with one insert and one audit outcome', async () => {
  let persisted = null;
  let gate = Promise.resolve();
  let inserts = 0;
  let audits = 0;
  const repositoryOverrides = {
    async createOrGetApprovedArtifact() {
      const previous = gate;
      let release;
      gate = new Promise(resolve => { release = resolve; });
      await previous;
      try {
        if (!persisted) {
          await new Promise(resolve => setTimeout(resolve, 5));
          persisted = makeStoredArtifact();
          inserts++;
          audits++;
        }
        return persisted;
      } finally {
        release();
      }
    },
  };
  const { api } = makeHarness({ repositoryOverrides });
  const [first, second] = await Promise.all([
    api.create('uid-requester', REQUEST_ID, Buffer.alloc(0)),
    api.create('uid-requester', REQUEST_ID, Buffer.alloc(0)),
  ]);

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(inserts, 1);
  assert.equal(audits, 1);
  assert.deepEqual(first.artifact.pdfBytes, second.artifact.pdfBytes);
  assert.equal(first.artifact, second.artifact);
});

test('renderer failures never return or persist PDF bytes', async () => {
  const failed = makeHarness({ render: async () => { throw Object.assign(new Error('sensitive renderer details'), { code: 'ARTIFACT_RENDER_FAILED' }); } });
  const failedResponse = await failed.api.create('uid-requester', REQUEST_ID, Buffer.alloc(0));
  assert.equal(failedResponse.status, 500);
  assert.equal(failedResponse.body.error.code, 'ARTIFACT_RENDER_FAILED');
  assert.equal(Object.hasOwn(failedResponse, 'artifact'), false);
  assert.equal(failed.calls.create.length, 0);
});

test('renderer output with a PDF hash mismatch fails closed before SQL persistence', async () => {
  const invalid = makeHarness({ render: async () => makeRendered({ pdfSha256: Buffer.alloc(32) }) });
  const invalidResponse = await invalid.api.create('uid-requester', REQUEST_ID, Buffer.alloc(0));
  assert.equal(invalidResponse.status, 500);
  assert.equal(invalidResponse.body.error.code, 'ARTIFACT_RENDER_FAILED');
  assert.equal(Object.hasOwn(invalidResponse, 'artifact'), false);
  assert.equal(invalid.calls.create.length, 0);
});
