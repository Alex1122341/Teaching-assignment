'use strict';

// BETA-R4D-10A — Dashboard HTTP surface.
//
// Kept separate from the existing timetable wrapper so the reviewed timetable
// runtime stays untouched. Both wrappers are mounted by the same Functions app.
//
// Contract:
//   * Existing Dashboard routes remain GET only. The B1 AFC Records route is
//     the sole exception and accepts GET + POST.
//   * Unauthenticated requests return 401; the API layer decides that, this
//     wrapper only extracts the bearer token.
//   * Unknown paths return 404.

const DASHBOARD_PREFIX = '/api/v1/dashboard/';

function bearer(request) {
  const header = request.headers && request.headers.get
    ? request.headers.get('authorization')
    : null;
  return header && /^Bearer /i.test(header) ? header.slice(7) : '';
}

function createDashboardFunctions({ api,traineeApi }) {
  return async request => {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/+$/, '') || '/';

      if (!pathname.startsWith(DASHBOARD_PREFIX.replace(/\/$/, ''))) {
        return { status: 404, jsonBody: { error: { code: 'NOT_FOUND', message: 'Route not found.' } } };
      }
      if(pathname==='/api/v1/dashboard/trainees'||pathname==='/api/v1/dashboard/trainees/export'){
        const headers={'Cache-Control':'private, no-store'};
        if(request.method!=='GET')return{status:405,headers:{...headers,Allow:'GET'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'GET required.'}}};
        if([...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))return{status:400,headers,jsonBody:{error:{code:'INVALID_TRAINEE_FILTER',message:'Duplicate filters are not supported.'}}};
        if(!traineeApi)return{status:503,headers,jsonBody:{error:{code:'TRAINEE_UNAVAILABLE',message:'Trainee records are temporarily unavailable.'}}};
        const exporting=pathname.endsWith('/export'),result=await traineeApi[exporting?'export':'list'](bearer(request),Object.fromEntries(url.searchParams));
        return{status:result.status,headers:{...headers,...result.headers},...(Buffer.isBuffer(result.body)?{body:result.body}:{jsonBody:result.body})};
      }

      const isAfcRecords = pathname === '/api/v1/dashboard/afc-records';
      const isAfcBatch = pathname === '/api/v1/dashboard/afc-records/batch';
      const afcCancel = /^\/api\/v1\/dashboard\/afc-records\/([^/]+)\/cancel$/.exec(pathname);
      if (afcCancel) {
        if (request.method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } } };
        let payload, id;
        try { id = decodeURIComponent(afcCancel[1]); payload = typeof request.json === 'function' ? await request.json() : request.body; }
        catch (_) { return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON or record identifier is invalid.' } } }; }
        const response = await api.cancelAfcRecord(bearer(request), id, payload);
        return { status: response.status, jsonBody: response.body };
      }
      const afcDates = /^\/api\/v1\/dashboard\/afc-records\/([^/]+)\/dates$/.exec(pathname);
      if (afcDates) {
        if (request.method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } } };
        let payload, id;
        try { id = decodeURIComponent(afcDates[1]); payload = typeof request.json === 'function' ? await request.json() : request.body; }
        catch (_) { return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON or record identifier is invalid.' } } }; }
        const response = await api.updateAfcRecordDates(bearer(request), id, payload);
        return { status: response.status, jsonBody: response.body };
      }
      const facultyUpdate = /^\/api\/v1\/dashboard\/faculty\/([^/]+)$/.exec(pathname);
      const facultyAction = /^\/api\/v1\/dashboard\/faculty\/([^/]+)\/(restore|deactivate)$/.exec(pathname);
      const rolePeriods = /^\/api\/v1\/dashboard\/roles\/([^/]+)\/periods$/.exec(pathname);
      if (rolePeriods) {
        if (request.method !== 'PUT') return {status:405,headers:{Allow:'PUT'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'PUT required.'}}};
        let payload; try {payload=await request.json();} catch {return {status:400,jsonBody:{error:{code:'INVALID_JSON',message:'Invalid JSON.'}}};}
        const response=await api.updateRolePeriods(bearer(request),rolePeriods[1],payload);return {status:response.status,jsonBody:response.body};
      }
      const isFacultyCreate = pathname === '/api/v1/dashboard/faculty' && request.method === 'POST';
      const isFacultyWrite = isFacultyCreate || (!!facultyAction && request.method === 'POST') || (!!facultyUpdate && request.method === 'PATCH');
      if ((facultyAction && request.method !== 'POST') || (facultyUpdate && !['GET', 'PATCH'].includes(request.method))) {
        const allow = facultyAction ? 'POST' : 'GET, PATCH';
        return { status: 405, headers: { Allow: allow }, jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: `${allow} required.` } } };
      }
      if (isAfcBatch && request.method !== 'POST') {
        return {
          status: 405,
          headers: { Allow: 'POST' },
          jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } }
        };
      }
      if (request.method !== 'GET' && !(isAfcRecords && request.method === 'POST') && !(isAfcBatch && request.method === 'POST') && !isFacultyWrite) {
        return {
          status: 405,
          headers: { Allow: isAfcBatch ? 'POST' : isAfcRecords ? 'GET, POST' : facultyAction ? 'POST' : facultyUpdate ? 'GET, PATCH' : pathname === '/api/v1/dashboard/faculty' ? 'GET, POST' : 'GET' },
          jsonBody: { error: { code: 'METHOD_NOT_ALLOWED', message: isAfcBatch ? 'POST required.' : isAfcRecords ? 'GET or POST required.' : facultyAction ? 'POST required.' : facultyUpdate ? 'GET or PATCH required.' : pathname === '/api/v1/dashboard/faculty' ? 'GET or POST required.' : 'GET required.' } }
        };
      }

      const token = bearer(request);
      const academicYear = url.searchParams.get('academicYear');

      if (pathname === '/api/v1/dashboard/afc-records/write-capabilities') {
        const response = await api.afcRecordWriteCapabilities(token);
        return { status: response.status, jsonBody: response.body };
      }

      if (pathname === '/api/v1/dashboard/faculty-admin/write-capabilities') {
        const response = await api.facultyAdminWriteCapabilities(token);
        return { status: response.status, jsonBody: response.body };
      }

      if (isFacultyCreate) {
        let payload;
        try { payload = typeof request.json === 'function' ? await request.json() : request.body; }
        catch (_) { return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } }; }
        const response = await api.createFaculty(token, payload);
        return { status: response.status, jsonBody: response.body };
      }
      if (isFacultyWrite) {
        let payload;
        try { payload = typeof request.json === 'function' ? await request.json() : request.body; }
        catch (_) { return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } }; }
        let facultyId;
        try { facultyId = decodeURIComponent((facultyAction || facultyUpdate)[1]); }
        catch (_) { return { status: 400, jsonBody: { error: { code: 'INVALID_FACULTY_ID', message: 'Faculty id is not a valid identifier.' } } }; }
        const response = facultyAction
          ? await api[facultyAction[2] === 'restore' ? 'restoreFaculty' : 'deactivateFaculty'](token, facultyId, payload)
          : await api.updateFaculty(token, facultyId, payload);
        return { status: response.status, jsonBody: response.body };
      }

      if (isAfcBatch || isAfcRecords) {
        if (isAfcBatch) {
          let payload;
          try {
            payload = typeof request.json === 'function' ? await request.json() : request.body;
          } catch (_) {
            return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
          }
          const response = await api.createAfcManualBatch(token, payload);
          return { status: response.status, jsonBody: response.body };
        }
        if (request.method === 'GET') {
          const active = url.searchParams.get('active');
          const response = await api.afcRecords(token, {
            search: url.searchParams.get('search'),
            reason: url.searchParams.get('reason'),
            active: active === 'true' ? true : active === 'false' ? false : undefined,
            limit: url.searchParams.get('limit') === null ? undefined : Number(url.searchParams.get('limit'))
          });
          return { status: response.status, jsonBody: response.body };
        }
        let payload;
        try {
          payload = typeof request.json === 'function' ? await request.json() : request.body;
        } catch (_) {
          return { status: 400, jsonBody: { error: { code: 'INVALID_JSON', message: 'Request JSON is invalid.' } } };
        }
        const response = await api.createAfcRecord(token, payload);
        return { status: response.status, jsonBody: response.body };
      }

      if (pathname === '/api/v1/dashboard/summary') {
        const response = await api.summary(token, { academicYear });
        return { status: response.status, jsonBody: response.body };
      }

      if (pathname === '/api/v1/dashboard/faculty') {
        const limit = url.searchParams.get('limit');
        const response = await api.faculty(token, {
          academicYear,
          search: url.searchParams.get('search'),
          limit: limit === null ? undefined : Number(limit),
          status: url.searchParams.get('status') || 'active'
        });
        return { status: response.status, jsonBody: response.body };
      }

      if (pathname === '/api/v1/dashboard/teaching-summary') {
        const response = await api.teachingSummary(token, { academicYear });
        return { status: response.status, jsonBody: response.body };
      }

      if (pathname === '/api/v1/dashboard/roles') {
        const response = await api.roles(token, { academicYear });
        return { status: response.status, jsonBody: response.body };
      }

      if (pathname === '/api/v1/dashboard/doe-targets') {
        const response = await api.doeTargets(token, { academicYear });
        return { status: response.status, jsonBody: response.body };
      }

      if (pathname === '/api/v1/dashboard/doe-overview') {
        const response = await api.doeOverview(token, { academicYear });
        return { status: response.status, jsonBody: response.body };
      }

      const match = /^\/api\/v1\/dashboard\/faculty\/([^/]+)$/.exec(pathname);
      if (match) {
        let facultyId;
        try {
          facultyId = decodeURIComponent(match[1]);
        } catch (_) {
          return { status: 400, jsonBody: { error: { code: 'INVALID_FACULTY_ID', message: 'Faculty id is not a valid identifier.' } } };
        }
        const response = await api.facultyById(token, facultyId, { academicYear });
        return { status: response.status, jsonBody: response.body };
      }

      return { status: 404, jsonBody: { error: { code: 'NOT_FOUND', message: 'Route not found.' } } };
    } catch (_) {
      return {
        status: 503,
        jsonBody: { error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' } }
      };
    }
  };
}

module.exports = { createDashboardFunctions, DASHBOARD_PREFIX };
