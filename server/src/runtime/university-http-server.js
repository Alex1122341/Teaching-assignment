'use strict';

const http = require('node:http');
const { isIP } = require('node:net');
const { createWriteGates } = require('../data/write-gates');

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const ABSOLUTE_MAX_BODY_BYTES = 1024 * 1024;
const BATCH_MAX_BODY_BYTES = ABSOLUTE_MAX_BODY_BYTES;
const FIXED_ERROR = JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' } });

function parseOrigins(value) {
  if (value === undefined || value === null || String(value).trim() === '') return new Set();
  const origins = new Set();
  for (const item of String(value).split(',')) {
    const origin = item.trim();
    let parsed;
    try { parsed = new URL(origin); } catch (_) { throw new Error('PAWS_API_ALLOWED_ORIGINS contains an invalid origin'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) {
      throw new Error('PAWS_API_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths');
    }
    origins.add(origin);
  }
  return origins;
}

function assertLoopbackHost(host) {
  const normalized = String(host || '').toLowerCase();
  if (normalized === 'localhost' || normalized === '::1' || normalized === '127.0.0.1') return normalized;
  const ipVersion = isIP(normalized);
  if (ipVersion === 6 && normalized === '0:0:0:0:0:0:0:1') return '::1';
  throw new Error('University API host must be loopback');
}

function maxBodyBytes(env) {
  if (env.PAWS_API_MAX_BODY_BYTES === undefined) return DEFAULT_MAX_BODY_BYTES;
  const value = String(env.PAWS_API_MAX_BODY_BYTES);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > ABSOLUTE_MAX_BODY_BYTES) {
    throw new Error('PAWS_API_MAX_BODY_BYTES must be from 1 to 1048576');
  }
  return Number(value);
}

function jsonError(status, code, message, headers = {}) {
  return { status, headers, jsonBody: { error: { code, message } } };
}

function runtimeIdentity(env) {
  const releaseSha = env.PAWS_RELEASE_SHA;
  if (typeof releaseSha !== 'string' || !/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new Error('PAWS_RELEASE_SHA must be a lowercase 40-character Git commit SHA');
  }
  const runtimeTrustAnchor = env.PAWS_RUNTIME_TRUST_ANCHOR;
  if (typeof runtimeTrustAnchor !== 'string' || !/^[0-9a-f]{40}$/.test(runtimeTrustAnchor)) {
    throw new Error('PAWS_RUNTIME_TRUST_ANCHOR must be a lowercase 40-character Git commit SHA');
  }
  return Object.freeze({ releaseSha, runtimeTrustAnchor, writeGates: createWriteGates(env) });
}

async function readBody(request, limit) {
  const header = request.headers['content-length'];
  if (header !== undefined && (!/^\d+$/.test(String(header)) || Number(header) > limit)) {
    const error = new Error(Number(header) > limit ? 'BODY_TOO_LARGE' : 'INVALID_CONTENT_LENGTH');
    throw error;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  if (size === 0) return null;
  const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new Error('JSON_REQUIRED');
  const text = Buffer.concat(chunks, size).toString('utf8');
  try { JSON.parse(text); } catch (_) { throw new Error('INVALID_JSON'); }
  return Buffer.from(text, 'utf8');
}

function createUniversityHttpServer({
  runtime,
  env = process.env,
  host = env.PAWS_API_HOST || '127.0.0.1',
  logger = console
} = {}) {
  if (typeof runtime !== 'function') throw new TypeError('runtime must be a request handler');
  const bindHost = assertLoopbackHost(host);
  const origins = parseOrigins(env.PAWS_API_ALLOWED_ORIGINS);
  const bodyLimit = maxBodyBytes(env);
  const identity = runtimeIdentity(env);

  return http.createServer(async (incoming, outgoing) => {
    const origin = incoming.headers.origin;
    const corsHeaders = {};
    if (origin) {
      if (!origins.has(origin)) {
        const denied = jsonError(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed.');
        outgoing.writeHead(denied.status, { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Origin' });
        outgoing.end(JSON.stringify(denied.jsonBody));
        return;
      }
      corsHeaders['Access-Control-Allow-Origin'] = origin;
      corsHeaders.Vary = 'Origin';
      corsHeaders['Access-Control-Expose-Headers'] = 'Server-Timing, Content-Disposition';
    }

    if (incoming.method === 'OPTIONS') {
      const requestedMethod = String(incoming.headers['access-control-request-method'] || '').toUpperCase();
      const requestedHeaders = String(incoming.headers['access-control-request-headers'] || '')
        .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      const allowedHeaders = new Set(['authorization', 'content-type', 'x-paws-support-context']);
      if (!origin || !origins.has(origin) || !['GET', 'POST', 'PATCH', 'PUT'].includes(requestedMethod) ||
          requestedHeaders.some(value => !allowedHeaders.has(value))) {
        outgoing.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Origin' });
        outgoing.end(JSON.stringify({ error: { code: 'CORS_PREFLIGHT_DENIED', message: 'Preflight request is not allowed.' } }));
        return;
      }
      outgoing.writeHead(204, {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-PAWS-Support-Context',
        'Access-Control-Max-Age': '600'
      });
      outgoing.end();
      return;
    }

    const requestPath = new URL(incoming.url || '/', 'http://127.0.0.1').pathname;
    if (requestPath === '/api/health/runtime') {
      if (incoming.method !== 'GET') {
        const payload = JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is allowed.' } });
        outgoing.writeHead(405, {
          ...corsHeaders,
          Allow: 'GET',
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Length': Buffer.byteLength(payload)
        });
        outgoing.end(payload);
        return;
      }
      const payload = JSON.stringify({
        status: 'ok',
        service: 'paws-university-api',
        authority: 'vetmed-ops-sql',
        releaseSha: identity.releaseSha,
        runtimeTrustAnchor: identity.runtimeTrustAnchor,
        writeGates: identity.writeGates
      });
      outgoing.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': Buffer.byteLength(payload)
      });
      outgoing.end(payload);
      return;
    }

    try {
      const bodyLimitForRequest = incoming.method==='POST' && requestPath==='/api/v1/afc-forms' ? 2800000 : incoming.method==='POST' && requestPath==='/api/v1/ccc-replacements' ? 1048576 : requestPath === '/api/v1/sessions/batch' || (incoming.method==='POST' && requestPath==='/api/v1/calendar-activity-imports')
        ? BATCH_MAX_BODY_BYTES
        : bodyLimit;
      const body = await readBody(incoming, bodyLimitForRequest);
      const headers = new Headers();
      for (const name of ['authorization', 'content-type', 'accept', 'x-paws-support-context']) {
        const value = incoming.headers[name];
        if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const init = { method: incoming.method, headers };
      if (body !== null && incoming.method !== 'GET' && incoming.method !== 'HEAD') {
        init.body = body;
        init.duplex = 'half';
      } else if (body !== null) {
        outgoing.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
        outgoing.end(JSON.stringify({ error: { code: 'BODY_NOT_ALLOWED', message: 'Request body is not allowed for this method.' } }));
        return;
      }
      const requestUrl = new URL(incoming.url || '/', 'http://127.0.0.1').toString();
      const result = await runtime(new Request(requestUrl, init));
      const status = Number.isInteger(result && result.status) && result.status >= 100 && result.status <= 599 ? result.status : 503;
      const responseHeaders = { ...corsHeaders };
      const suppliedHeaders = result && result.headers;
      if (suppliedHeaders && typeof suppliedHeaders === 'object') {
        for (const [name, value] of Object.entries(suppliedHeaders)) {
          if (value !== undefined && value !== null) responseHeaders[name] = String(value);
        }
      }
      if(requestPath==='/api/v1/dashboard/trainees/export'&&status===200&&Buffer.isBuffer(result?.body)){
        if(result.body.length>8_388_608)throw Error('Trainee export limit exceeded');
        outgoing.writeHead(status,{...responseHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Length':result.body.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});
        outgoing.end(result.body);return;
      }
      if (result && Object.prototype.hasOwnProperty.call(result, 'binaryBody')) {
        const pdfBytes = Buffer.isBuffer(result.binaryBody)
          ? result.binaryBody
          : result.binaryBody instanceof Uint8Array ? Buffer.from(result.binaryBody) : null;
        const formMatch=/^\/api\/v1\/afc-forms\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/document$/i.exec(requestPath);
        const match = formMatch || /^\/api\/v1\/afc-requests\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/approved-artifact\/?$/i.exec(new URL(incoming.url || '/', 'http://127.0.0.1').pathname);
        if (!pdfBytes || ![200, 201].includes(status) || !match || pdfBytes.length < 1 || pdfBytes.length > (formMatch?2097152:8_388_608)) {
          outgoing.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(FIXED_ERROR) });
          outgoing.end(FIXED_ERROR);
          return;
        }
        const binaryHeaders = {
          ...corsHeaders,
          'Content-Type': 'application/pdf',
          'Content-Length': String(pdfBytes.length),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': `attachment; filename="afc-${formMatch?'form':'approved'}-${match[1]}.pdf"`,
          'Content-Security-Policy': "sandbox; default-src 'none'"
        };
        outgoing.writeHead(status, binaryHeaders);
        outgoing.end(incoming.method === 'HEAD' ? undefined : pdfBytes);
        return;
      }
      let payload = '';
      if (result && Object.prototype.hasOwnProperty.call(result, 'jsonBody') && result.jsonBody !== undefined && status !== 204 && status !== 304) {
        payload = JSON.stringify(result.jsonBody);
        responseHeaders['Content-Type'] = responseHeaders['Content-Type'] || 'application/json; charset=utf-8';
        responseHeaders['Content-Length'] = Buffer.byteLength(payload);
      }
      outgoing.writeHead(status, responseHeaders);
      outgoing.end(incoming.method === 'HEAD' ? undefined : payload);
    } catch (error) {
      if (error && error.message === 'BODY_TOO_LARGE') {
        const response = jsonError(413, 'BODY_TOO_LARGE', 'Request body exceeds the configured limit.');
        outgoing.writeHead(response.status, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
        outgoing.end(JSON.stringify(response.jsonBody));
        return;
      }
      if (error && ['INVALID_CONTENT_LENGTH', 'JSON_REQUIRED', 'INVALID_JSON'].includes(error.message)) {
        const response = jsonError(400, error.message, 'Request must contain valid JSON.');
        outgoing.writeHead(response.status, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
        outgoing.end(JSON.stringify(response.jsonBody));
        return;
      }
      try { if (logger && typeof logger.error === 'function') logger.error({ event: 'paws_api_request_failed' }); } catch (_) {}
      if (!outgoing.headersSent) {
        outgoing.writeHead(503, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(FIXED_ERROR) });
      }
      outgoing.end(FIXED_ERROR);
    }
  });
}

module.exports = {
  createUniversityHttpServer,
  parseOrigins,
  assertLoopbackHost,
  DEFAULT_MAX_BODY_BYTES,
  ABSOLUTE_MAX_BODY_BYTES,
  BATCH_MAX_BODY_BYTES
};
