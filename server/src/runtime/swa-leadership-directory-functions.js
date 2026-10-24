'use strict';

// GET /api/v1/dashboard/leadership-directory?academicYear=YYYY-YY
// Read-only. Sits under /dashboard so Developer Support keeps working, but is routed separately
// from the administrator Dashboard API and returns only the directory allow-list.
const PATH = '/api/v1/dashboard/leadership-directory';
const READ_HEADERS = Object.freeze({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });

function createLeadershipDirectoryFunctions({ api } = {}) {
  if (typeof api?.list !== 'function') throw new Error('Leadership directory API required.');
  return async request => {
    const url = new URL(request.url);
    if (url.pathname !== PATH) return { status: 404, headers: READ_HEADERS, jsonBody: { error: { code: 'NOT_FOUND', message: 'Route not found.' } } };
    if (request.method !== 'GET') return { status: 405, headers: { ...READ_HEADERS, Allow: 'GET' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required.' } } };
    const keys = [...url.searchParams.keys()];
    if (!keys.length || keys.some(key => key !== 'academicYear') || url.searchParams.getAll('academicYear').length !== 1) {
      return { status: 400, headers: READ_HEADERS, jsonBody: { error: { code: 'INVALID_QUERY', message: 'Select a valid academic year.' } } };
    }
    const header = request.headers?.get?.('authorization') || '';
    const token = /^Bearer /i.test(header) ? header.slice(7) : '';
    try {
      const response = await api.list(token, { academicYear: url.searchParams.get('academicYear') });
      return { status: response.status, headers: READ_HEADERS, jsonBody: response.body };
    } catch (_) {
      return { status: 503, headers: READ_HEADERS, jsonBody: { error: { code: 'SERVICE_UNAVAILABLE', message: 'The HICC–CC and VISC lists are temporarily unavailable.' } } };
    }
  };
}

module.exports = { createLeadershipDirectoryFunctions, PATH };
