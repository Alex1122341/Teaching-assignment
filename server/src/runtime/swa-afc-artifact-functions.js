'use strict';

const { MAX_PDF_BYTES } = require('../data/sql-afc-artifact-repository');

const ARTIFACT_ROUTE = /^\/api\/v1\/afc-requests\/([^/]+)\/approved-artifact$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearer(request) {
  const header = request.headers && request.headers.get
    ? request.headers.get('authorization')
    : null;
  return header && /^Bearer /i.test(header) ? header.slice(7) : '';
}

function json(response) {
  if (response && response.body && Number.isInteger(response.status)) {
    return { status: response.status, jsonBody: response.body };
  }
  return {
    status: 503,
    jsonBody: { error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' } }
  };
}

function artifactResponse(response, requestId) {
  if (!response || ![200, 201].includes(response.status) || !response.artifact) return json(response);
  const artifact = response.artifact;
  const bytes = Buffer.isBuffer(artifact.pdfBytes)
    ? Buffer.from(artifact.pdfBytes)
    : artifact.pdfBytes instanceof Uint8Array ? Buffer.from(artifact.pdfBytes) : null;
  if (artifact.contentType !== 'application/pdf'
      || !bytes
      || bytes.length < 1
      || bytes.length > MAX_PDF_BYTES
      || Number(artifact.byteLength) !== bytes.length) {
    return {
      status: 500,
      jsonBody: { error: { code: 'ARTIFACT_INTEGRITY_FAILURE', message: 'The approved AFC artifact failed an integrity check.' } }
    };
  }

  return {
    status: response.status,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="afc-approved-${requestId}.pdf"`
    },
    binaryBody: bytes
  };
}

function createSwaAfcArtifactFunctions({ api }) {
  if (!api || typeof api.get !== 'function' || typeof api.create !== 'function') {
    throw new TypeError('The AFC artifact API is required');
  }

  return async request => {
    try {
      const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
      const match = ARTIFACT_ROUTE.exec(pathname);
      if (!match) {
        return { status: 404, jsonBody: { error: { code: 'NOT_FOUND', message: 'Route not found.' } } };
      }
      if (!['GET', 'POST'].includes(request.method)) {
        return {
          status: 405,
          headers: { Allow: 'GET, POST' },
          jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or POST required.' } }
        };
      }

      let requestId;
      try { requestId = decodeURIComponent(match[1]); } catch (_) {
        return { status: 400, jsonBody: { error: { code: 'INVALID_REQUEST_ID', message: 'AFC request id is not a valid identifier.' } } };
      }
      if (!UUID.test(requestId)) {
        return { status: 400, jsonBody: { error: { code: 'INVALID_REQUEST_ID', message: 'AFC request id is not a valid identifier.' } } };
      }

      const token = bearer(request);
      if (request.method === 'GET') return artifactResponse(await api.get(token, requestId), requestId);

      let body;
      try {
        body = request.body === null ? Buffer.alloc(0) : Buffer.from(await request.arrayBuffer());
      } catch (_) {
        return { status: 400, jsonBody: { error: { code: 'ARTIFACT_INPUT_INVALID', message: 'AFC artifact creation accepts only an empty request body.' } } };
      }
      return artifactResponse(await api.create(token, requestId, body), requestId);
    } catch (_) {
      return {
        status: 503,
        jsonBody: { error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' } }
      };
    }
  };
}

module.exports = { createSwaAfcArtifactFunctions, ARTIFACT_ROUTE };
