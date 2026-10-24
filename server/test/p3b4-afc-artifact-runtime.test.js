'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSwaAfcArtifactFunctions } = require('../src/runtime/swa-afc-artifact-functions');

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x25]);

function request(path, { method = 'GET', token = 'firebase-token', body } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', 'Bearer ' + token);
  const init = { method, headers };
  if (body !== undefined) init.body = body;
  return new Request('https://local' + path, init);
}

test('GET returns only stored PDF bytes with exact private download headers', async () => {
  const calls = [];
  const route = createSwaAfcArtifactFunctions({ api: {
    get: async (token, id) => {
      calls.push(['get', token, id]);
      return { status: 200, artifact: { contentType: 'application/pdf', pdfBytes: PDF_BYTES, byteLength: PDF_BYTES.length } };
    },
    create: async () => { throw new Error('GET must not create'); }
  } });

  const response = await route(request('/api/v1/afc-requests/' + REQUEST_ID + '/approved-artifact'));
  assert.equal(response.status, 200);
  assert.deepEqual(response.binaryBody, PDF_BYTES);
  assert.deepEqual(response.headers, {
    'Content-Type': 'application/pdf',
    'Content-Length': String(PDF_BYTES.length),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="afc-approved-${REQUEST_ID}.pdf"`
  });
  assert.deepEqual(calls, [['get', 'firebase-token', REQUEST_ID]]);
  assert.equal(Object.hasOwn(response, 'jsonBody'), false);
});

test('POST passes an empty body to idempotent creation and returns the stored bytes', async () => {
  const calls = [];
  const route = createSwaAfcArtifactFunctions({ api: {
    get: async () => { throw new Error('POST must not use GET'); },
    create: async (token, id, body) => {
      calls.push([token, id, Buffer.from(body)]);
      return { status: 201, artifact: { contentType: 'application/pdf', pdfBytes: PDF_BYTES, byteLength: PDF_BYTES.length } };
    }
  } });

  const response = await route(request('/api/v1/afc-requests/' + REQUEST_ID + '/approved-artifact', { method: 'POST' }));
  assert.equal(response.status, 201);
  assert.deepEqual(response.binaryBody, PDF_BYTES);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['firebase-token', REQUEST_ID, Buffer.alloc(0)]);
});

test('POST forwards body bytes to the API and keeps its non-empty-body error as JSON', async () => {
  const calls = [];
  const route = createSwaAfcArtifactFunctions({ api: {
    get: async () => { calls.push(['get']); return {}; },
    create: async (token, id, body) => {
      calls.push(['create', token, id, Buffer.from(body)]);
      return { status: 400, body: { error: { code: 'ARTIFACT_BODY_NOT_ALLOWED', message: 'AFC artifact creation does not accept a request body.' } } };
    }
  } });
  const response = await route(request('/api/v1/afc-requests/' + REQUEST_ID + '/approved-artifact', {
    method: 'POST', body: '{}'
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(response.jsonBody, { error: { code: 'ARTIFACT_BODY_NOT_ALLOWED', message: 'AFC artifact creation does not accept a request body.' } });
  assert.equal(Object.hasOwn(response, 'binaryBody'), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['create', 'firebase-token', REQUEST_ID, Buffer.from('{}')]);
});

test('fixed API errors remain JSON and never include partial PDF bytes', async () => {
  const route = createSwaAfcArtifactFunctions({ api: {
    get: async () => ({ status: 404, body: { error: { code: 'ARTIFACT_NOT_FOUND', message: 'The approved AFC artifact is not available.' } } }),
    create: async () => { throw new Error('not used'); }
  } });
  const response = await route(request('/api/v1/afc-requests/' + REQUEST_ID + '/approved-artifact'));

  assert.equal(response.status, 404);
  assert.deepEqual(response.jsonBody, { error: { code: 'ARTIFACT_NOT_FOUND', message: 'The approved AFC artifact is not available.' } });
  assert.equal(Object.hasOwn(response, 'binaryBody'), false);
});

test('unsupported methods and unsafe artifact metadata fail closed', async () => {
  const route = createSwaAfcArtifactFunctions({ api: {
    get: async () => ({ status: 200, artifact: { contentType: 'text/plain', pdfBytes: PDF_BYTES } }),
    create: async () => ({ status: 201, artifact: { contentType: 'application/pdf', pdfBytes: PDF_BYTES, byteLength: PDF_BYTES.length } })
  } });

  const unsupported = await route(request('/api/v1/afc-requests/' + REQUEST_ID + '/approved-artifact', { method: 'DELETE' }));
  assert.equal(unsupported.status, 405);
  assert.deepEqual(unsupported.headers, { Allow: 'GET, POST' });
  assert.equal(Object.hasOwn(unsupported, 'binaryBody'), false);

  const invalidArtifact = await route(request('/api/v1/afc-requests/' + REQUEST_ID + '/approved-artifact'));
  assert.equal(invalidArtifact.status, 500);
  assert.deepEqual(invalidArtifact.jsonBody, { error: { code: 'ARTIFACT_INTEGRITY_FAILURE', message: 'The approved AFC artifact failed an integrity check.' } });
  assert.equal(Object.hasOwn(invalidArtifact, 'binaryBody'), false);
});

test('actual SQL runtime mounts the artifact route and rejects anonymous callers before SQL access', async () => {
  const { createSwaSqlRuntime } = require('../src/runtime/swa-sql-runtime');
  let sqlQueries = 0;
  class FakePool {
    async connect() { return this; }
    request() { return { input() { return this; }, async query() { sqlQueries++; return { recordset: [] }; } }; }
    async close() {}
  }
  const runtime = createSwaSqlRuntime({
    env: {
      FIREBASE_PROJECT_ID: 'test-project',
      PAWS_SQL_CONNECTION_STRING: 'Server=localhost;Database=VetMed-Ops;Encrypt=true;',
      PAWS_SQL_DRIVER: 'tedious'
    },
    admin: {},
    sql: { ConnectionPool: FakePool }
  });

  try {
    const response = await runtime(request('/api/v1/afc-requests/' + REQUEST_ID + '/approved-artifact'));
    assert.equal(response.status, 401);
    assert.deepEqual(response.jsonBody, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
    assert.equal(Object.hasOwn(response, 'binaryBody'), false);
    assert.equal(sqlQueries, 0);
  } finally {
    await runtime.close();
  }
});
