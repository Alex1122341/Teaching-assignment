'use strict';

const AFC_REQUESTS_PATH = '/api/v1/afc-requests';
const AFC_WRITE_CAPABILITIES_PATH = '/api/v1/afc-requests/write-capabilities';

function bearer(request) {
  const header = request.headers && request.headers.get
    ? request.headers.get('authorization')
    : null;
  return header && header.toLowerCase().startsWith('bearer ') ? header.slice(7) : '';
}

function toHttp(response) {
  return { status: response.status, jsonBody: response.body };
}

function createAfcRequestFunctions({ api }) {
  return async request => {
    try {
      const url = new URL(request.url);
      let pathname = url.pathname;
      while (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
      const token = bearer(request);

      if (pathname === AFC_WRITE_CAPABILITIES_PATH) {
        if (request.method !== 'GET') {
          return {
            status: 405,
            headers: { Allow: 'GET' },
            jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required.' } }
          };
        }
        return toHttp(await api.writeCapabilities(token));
      }

      if (pathname === AFC_REQUESTS_PATH) {
        if (request.method === 'GET') return toHttp(await api.list(token));
        if (request.method === 'POST') {
          let payload;
          try {
            payload = typeof request.json === 'function' ? await request.json() : request.body;
          } catch (_) {
            return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
          }
          return toHttp(await api.submit(token, payload));
        }
        return {
          status: 405,
          headers: { Allow: 'GET, POST' },
          jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or POST required.' } }
        };
      }

      const segments = pathname.split('/');
      const isRequestAction = segments.length === 6
        && segments[1] === 'api'
        && segments[2] === 'v1'
        && segments[3] === 'afc-requests'
        && ['withdraw', 'recommend', 'reject', 'approve'].includes(segments[5]);
      if (isRequestAction) {
        if (request.method !== 'POST') {
          return {
            status: 405,
            headers: { Allow: 'POST' },
            jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } }
          };
        }
        let afcRequestId;
        try {
          afcRequestId = decodeURIComponent(segments[4]);
        } catch (_) {
          return { status: 400, jsonBody: { error: { code: 'INVALID_REQUEST_ID', message: 'AFC request id is not a valid identifier.' } } };
        }

        const action = segments[5];
        if (action === 'withdraw') return toHttp(await api.withdraw(token, afcRequestId));

        let payload;
        try {
          payload = typeof request.json === 'function' ? await request.json() : request.body;
        } catch (_) {
          return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
        }
        return toHttp(await api[action](token, afcRequestId, payload));
      }

      return { status: 404, jsonBody: { error: { code: 'NOT_FOUND', message: 'Route not found.' } } };
    } catch (_) {
      return { status: 503, jsonBody: { error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' } } };
    }
  };
}

module.exports = { createAfcRequestFunctions, AFC_REQUESTS_PATH, AFC_WRITE_CAPABILITIES_PATH };
