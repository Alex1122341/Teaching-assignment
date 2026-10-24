'use strict';

const { createRequestTiming } = require('../perf/request-timing');

function bearer(request) {
  const h = request.headers && request.headers.get ? request.headers.get('authorization') : null;
  return h && /^Bearer /i.test(h) ? h.slice(7) : '';
}

function response(status, body, timing) {
  const value = timing && timing.serverTiming();
  if (!value) return { status, jsonBody: body };
  return {
    status,
    jsonBody: body,
    headers: {
      'Server-Timing': value,
      'Access-Control-Expose-Headers': 'Server-Timing'
    }
  };
}

function createSwaFunctions({ api, createTiming = createRequestTiming }) {
  return async request => {
    let timing = null;
    try {
      const url = new URL(request.url);
      const token = bearer(request);
      let r;
      if (url.pathname === '/api/v1/sessions/batch') {
        if (request.method !== 'POST') {
          r = { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } }, headers: { Allow: 'POST' } };
        } else {
          let payload;
          try { payload = typeof request.json === 'function' ? await request.json() : request.body; }
          catch (_) { return response(400, { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } }, timing); }
          r = await api.createSessionBatch(token, payload);
        }
      } else if (/^\/api\/v1\/sessions\/[^/]+\/assignments\/?$/.test(url.pathname)) {
        if (request.method !== 'PATCH') {
          r = { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'PATCH required.' } }, headers: { Allow: 'PATCH' } };
        } else {
          let sessionId;
          try { sessionId = decodeURIComponent(url.pathname.replace(/\/$/, '').split('/').at(-2)); }
          catch (_) { return response(400, { error: { code: 'INVALID_SESSION_ID', message: 'The session id is invalid.' } }, timing); }
          let payload;
          try { payload = typeof request.json === 'function' ? await request.json() : request.body; }
          catch (_) { return response(400, { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } }, timing); }
          r = await api.replaceSessionAssignments(token, sessionId, payload);
        }
      } else if (/^\/api\/v1\/sessions\/[^/]+\/?$/.test(url.pathname)) {
        if (request.method !== 'PATCH') {
          r = { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'PATCH required.' } }, headers: { Allow: 'PATCH' } };
        } else {
          let sessionId;
          try { sessionId = decodeURIComponent(url.pathname.replace(/\/$/, '').split('/').pop()); }
          catch (_) { return response(400, { error: { code: 'INVALID_SESSION_ID', message: 'The session id is invalid.' } }, timing); }
          let patch;
          try { patch = typeof request.json === 'function' ? await request.json() : request.body; }
          catch (_) { return response(400, { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } }, timing); }
          r = await api.updateExistingSession(token, sessionId, patch);
        }
      } else if (url.pathname === '/api/v1/sessions' && request.method === 'POST') {
        let payload;
        try { payload = typeof request.json === 'function' ? await request.json() : request.body; }
        catch (_) { return response(400, { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } }, timing); }
        r = await api.createSession(token, payload);
      } else if (request.method !== 'GET') {
        r = { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required.' } } };
      } else if (url.pathname === '/api/health/sql') {
        r = await api.health();
      } else if (url.pathname === '/api/v1/me') {
        timing = createTiming();
        r = await api.currentUser(token, timing);
      } else if (url.pathname === '/api/v1/sessions') {
        r = await api.sessions(token, { start: url.searchParams.get('start'), end: url.searchParams.get('end') });
      } else {
        r = { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Route not found.' } } };
      }
      const outgoing = response(r.status, r.body, timing);
      if (r.headers) outgoing.headers = { ...(outgoing.headers || {}), ...r.headers };
      return outgoing;
    } catch (_) {
      return response(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' } }, timing);
    }
  };
}

module.exports = { createSwaFunctions };
