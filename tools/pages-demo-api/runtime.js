'use strict';
// Frontend Demo PAWS runtime: the real server API code from server/src, wired
// to in-memory repositories instead of SQL. Mirrors server/src/runtime/
// swa-sql-runtime.js so routes, validation, roles and responses match Beta.
const { createDataApi } = require('../../server/src/data/data-api');
const { createSwaFunctions } = require('../../server/src/runtime/swa-functions');
const { createDashboardApi } = require('../../server/src/data/dashboard-api');
const { createDashboardFunctions } = require('../../server/src/runtime/swa-dashboard-functions');
const repos = require('./repos/index.js');

const PROJECT = 'pages-demo';
const ALL_WRITES = new Proxy({}, { get: (_, key) => key === 'then' ? undefined : true });

// Any area not yet backed by demo data answers like a temporarily unavailable
// service rather than throwing out of the API layer.
function pending(area) {
  return new Proxy({}, { get: (_, key) => key === 'then' ? undefined : async () => { throw Object.assign(new Error(`${area} is not available in the Frontend Demo yet.`), { code: 'DEMO_AREA_PENDING' }); } });
}

function verifyDemoToken(token) {
  const match = /^demo-token-(.+)$/.exec(String(token || ''));
  if (!match) throw Object.assign(new Error('Authentication required'), { status: 401 });
  return { uid: match[1], aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}` };
}

function createDemoRuntime(store) {
  const r = repos.create(store, { pending });
  const verify = async token => verifyDemoToken(token);
  const findUser = r.users.findByUid;
  const writeGates = ALL_WRITES;
  const routes = require('./routes.js').compose({ store, r, verify, findUser, writeGates, pending });
  const timetable = createSwaFunctions({ api: createDataApi({
    verifyToken: verify, findUser,
    listSessions: r.sessions.list, updateSession: r.sessions.updateExisting, createSession: r.sessions.createNew,
    createSessionBatch: r.sessions.createBatch, replaceSessionAssignments: r.sessions.replaceAssignments,
    recalculateSessionDoe: routes.recalculateSessionDoe, health: async () => true, writeGates
  }) });
  const dashboardRoutes = createDashboardFunctions({
    traineeApi: routes.traineeApi,
    api: createDashboardApi({ verifyToken: verify, findUser, repository: r.dashboard, writeRepository: { ...r.afcWrite, ...r.facultyAdmin }, writeGates })
  });
  const route = async request => {
    const pathname = new URL(request.url).pathname;
    const special = await routes.handle(pathname, request);
    if (special) return special;
    if (pathname.startsWith('/api/v1/dashboard/')) return dashboardRoutes(request);
    return timetable(request);
  };
  return route;
}

module.exports = { createDemoRuntime, verifyDemoToken, PROJECT };
