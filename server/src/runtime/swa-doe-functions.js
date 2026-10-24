'use strict';

const PREFIX = '/api/v1/doe';
const bearer = request => {
  const header = request.headers?.get?.('authorization') || '';
  return /^Bearer /i.test(header) ? header.slice(7) : '';
};

function createDoeFunctions({ api } = {}) {
  if (!api) throw new TypeError('DOE API is required.');
  return async request => {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (!path.startsWith(`${PREFIX}/`)) return { status: 404, jsonBody: { error: { code: 'NOT_FOUND', message: 'Route not found.' } } };
      const token = bearer(request);
      if (path === `${PREFIX}/manual-scope-suggestions`) {
        if (request.method !== 'GET') return { status: 405, headers: { Allow: 'GET' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required.' } } };
        const result = await api.manualScopeSuggestions(token, { academicYear: url.searchParams.get('academicYear') });
        return { status: result.status, jsonBody: result.body };
      }
      const manualMatch = /^\/api\/v1\/doe\/manual-assignments(?:\/([^/]+))?$/.exec(path);
      if (manualMatch) {
        const id = manualMatch[1] ? decodeURIComponent(manualMatch[1]) : '';
        if (id ? !['PATCH','DELETE'].includes(request.method) : request.method !== 'POST') return { status: 405, headers: { Allow: id ? 'PATCH, DELETE' : 'POST' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported manual DOE method.' } } };
        let payload;
        try { payload = typeof request.json === 'function' ? await request.json() : request.body; } catch (_) { payload = null; }
        const result = await api.saveManualAssignment(token, payload, id, request.method === 'DELETE');
        return { status: result.status, jsonBody: result.body };
      }
      if (path === `${PREFIX}/write-capabilities`) {
        if (request.method !== 'GET') return { status: 405, headers: { Allow: 'GET' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required.' } } };
        const result = await api.writeCapabilities(token);
        return { status: result.status, jsonBody: result.body };
      }
      if (path === `${PREFIX}/policy-version`) {
        if (request.method !== 'GET') return { status: 405, headers: { Allow: 'GET' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required.' } } };
        const result = await api.policyVersion(token, { policyVersionId: url.searchParams.get('policyVersionId') });
        return { status: result.status, jsonBody: result.body };
      }
      if (path === `${PREFIX}/history`) {
        if (request.method !== 'GET') return { status: 405, headers: { Allow: 'GET' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required.' } } };
        const result = await api.policyHistory(token, { academicYear: url.searchParams.get('academicYear') });
        return { status: result.status, jsonBody: result.body };
      }
      if (path === `${PREFIX}/policies/draft` || path === `${PREFIX}/policies/copy`) {
        if (request.method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } } };
        let payload;
        try { payload = typeof request.json === 'function' ? await request.json() : request.body; } catch (_) { payload = null; }
        if (!payload || typeof payload !== 'object') return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
        const result = path.endsWith('/copy') ? await api.copyPolicy(token, payload) : await api.createPolicyDraft(token, payload);
        return { status: result.status, jsonBody: result.body };
      }
      const policyAction = /^\/api\/v1\/doe\/policies\/([^/]+)\/(validate|impact|publish|archive)$/.exec(path);
      if (policyAction) {
        const method = policyAction[2] === 'validate' || policyAction[2] === 'impact' || policyAction[2] === 'publish' || policyAction[2] === 'archive' ? 'POST' : 'POST';
        if (request.method !== method) return { status: 405, headers: { Allow: method }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: `${method} required.` } } };
        let payload;
        try { payload = typeof request.json === 'function' ? await request.json() : request.body; } catch (_) { payload = null; }
        if (!payload || typeof payload !== 'object') return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
        const id = decodeURIComponent(policyAction[1]);
        const action = policyAction[2];
        const result = action === 'validate' ? await api.validatePolicyDraft(token, id, payload)
          : action === 'impact' ? await api.previewPolicyImpact(token, id, payload)
          : action === 'publish' ? await api.publishPolicyDraft(token, id, payload)
          : await api.archivePolicy(token, id, payload);
        return { status: result.status, jsonBody: result.body };
      }
      const policyDraft = /^\/api\/v1\/doe\/policies\/([^/]+)\/draft$/.exec(path);
      if (policyDraft) {
        if (request.method !== 'PUT') return { status: 405, headers: { Allow: 'PUT' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'PUT required.' } } };
        let payload;
        try { payload = typeof request.json === 'function' ? await request.json() : request.body; } catch (_) { payload = null; }
        if (!payload || typeof payload !== 'object') return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
        const result = await api.savePolicyDraft(token, decodeURIComponent(policyDraft[1]), payload);
        return { status: result.status, jsonBody: result.body };
      }
      if (path === `${PREFIX}/recalculate`) {
        if (request.method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } } };
        let payload;
        try { payload = typeof request.json === 'function' ? await request.json() : request.body; } catch (_) { payload = null; }
        if (!payload || typeof payload !== 'object') return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
        const result = await api.recalculate(token, payload);
        return { status: result.status, jsonBody: result.body };
      }
      if (path === `${PREFIX}/policy`) {
        if (request.method !== 'GET') return { status: 405, headers: { Allow: 'GET' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required.' } } };
        const result = await api.activePolicy(token, { academicYear: url.searchParams.get('academicYear') });
        return { status: result.status, jsonBody: result.body };
      }
      if (path === `${PREFIX}/preview`) {
        if (request.method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } } };
        let payload;
        try { payload = typeof request.json === 'function' ? await request.json() : request.body; }
        catch (_) { payload = null; }
        if (payload === null) return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
        const result = await api.preview(token, payload);
        return { status: result.status, jsonBody: result.body };
      }
      if (path === `${PREFIX}/workflow-preview`) {
        if (request.method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } } };
        let payload;
        try { payload = typeof request.json === 'function' ? await request.json() : request.body; }
        catch (_) { payload = null; }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
        const result = await api.previewWorkflow(token, payload);
        return { status: result.status, jsonBody: result.body };
      }
      if (path === `${PREFIX}/worksheet`) {
        if (request.method !== 'GET') return { status: 405, headers: { Allow: 'GET' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required.' } } };
        const result = await api.worksheet(token, {
          academicYear: url.searchParams.get('academicYear'), facultyId: url.searchParams.get('facultyId')
        });
        return { status: result.status, jsonBody: result.body };
      }
      if (path === `${PREFIX}/worksheets`) {
        if (request.method !== 'GET') return { status: 405, headers: { Allow: 'GET' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required.' } } };
        const result = await api.listWorksheets(token, { academicYear: url.searchParams.get('academicYear') });
        return { status: result.status, jsonBody: result.body };
      }
      if (path === `${PREFIX}/assignments` || /^\/api\/v1\/doe\/assignments\/[^/]+$/.test(path)) {
        const match = /^\/api\/v1\/doe\/assignments\/([^/]+)$/.exec(path);
        const methodAllowed = path === `${PREFIX}/assignments` ? request.method === 'POST' : ['PATCH','DELETE'].includes(request.method);
        if (!methodAllowed) return { status: 405, headers: { Allow: path === `${PREFIX}/assignments` ? 'POST' : 'PATCH, DELETE' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported DOE assignment method.' } } };
        let payload;
        if (['POST','PATCH'].includes(request.method) || request.method === 'DELETE') {
          try { payload = typeof request.json === 'function' ? await request.json() : request.body; }
          catch (_) { payload = null; }
        }
        if (payload === null || payload === undefined) return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
        let result;
        if (path === `${PREFIX}/assignments` && request.method === 'POST') result = await api.saveAssignment(token, payload);
        else if (match && request.method === 'PATCH') result = await api.saveAssignment(token, payload, { assignmentFactId: decodeURIComponent(match[1]) });
        else if (match && request.method === 'DELETE') result = await api.deactivateAssignment(token, payload, decodeURIComponent(match[1]));
        else return { status: 404, jsonBody: { error: { code: 'NOT_FOUND', message: 'DOE assignment route not found.' } } };
        return { status: result.status, jsonBody: result.body };
      }
      const targetMatch = /^\/api\/v1\/doe\/targets\/([^/]+)$/.exec(path);
      if (targetMatch) {
        if (request.method !== 'PUT') return { status: 405, headers: { Allow: 'PUT' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'PUT required.' } } };
        let payload;
        try { payload = typeof request.json === 'function' ? await request.json() : request.body; }
        catch (_) { payload = null; }
        if (payload === null || payload === undefined) return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
        const result = await api.saveTargetOverride(token, decodeURIComponent(targetMatch[1]), payload);
        return { status: result.status, jsonBody: result.body };
      }
      return { status: 404, jsonBody: { error: { code: 'NOT_FOUND', message: 'Route not found.' } } };
    } catch (_) {
      return { status: 503, jsonBody: { error: { code: 'SERVICE_UNAVAILABLE', message: 'The DOE service is temporarily unavailable.' } } };
    }
  };
}

module.exports = { createDoeFunctions, DOE_PREFIX: PREFIX };
