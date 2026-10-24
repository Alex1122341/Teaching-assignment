'use strict';

const { createSqlConnection, resolveSqlDriver, parseBooleanFlag } = require('../data/sql-connection');
const { appServiceManagedIdentityTokenWithExpiry } = require('../data/sql-identity');
const { createSqlUserRepository } = require('../data/sql-user-repository');
const { createSqlSessionRepository } = require('../data/sql-session-repository');
const { createSqlDashboardRepository } = require('../data/sql-dashboard-repository');
const { createSqlFacultyAdminRepository } = require('../data/sql-faculty-admin-repository');
const { createSqlDoeTargetRepository } = require('../data/sql-doe-target-repository');
const { createSqlAfcWriteRepository } = require('../data/sql-afc-write-repository');
const { createSqlAfcRequestRepository } = require('../data/sql-afc-request-repository');
const { createSqlAfcApprovalRepository } = require('../data/sql-afc-approval-repository');
const { createSqlAfcArtifactRepository } = require('../data/sql-afc-artifact-repository');
const { createAfcRequestApi } = require('../afc/afc-request-api');
const { createAfcApprovalApi } = require('../afc/afc-approval-api');
const { createAfcApprovedArtifactApi } = require('../afc/afc-approved-artifact-api');
const { createDataApi } = require('../data/data-api');
const { createDashboardApi } = require('../data/dashboard-api');
const { createSwaFunctions } = require('./swa-functions');
const { createSwapApi } = require('../swap/swap-api');
const { createSqlSwapRepository } = require('../data/sql-swap-repository');
const { createSwapFunctions } = require('./swa-swap-functions');
const { createDashboardFunctions } = require('./swa-dashboard-functions');
const { createTraineeApi } = require('../trainees/trainee-api');
const { createSqlTraineeRepository } = require('../data/sql-trainee-repository');
const { createAfcRequestFunctions } = require('./swa-afc-request-functions');
const { createSwaAfcArtifactFunctions } = require('./swa-afc-artifact-functions');
const { createFirebaseVerifier } = require('../auth/firebase-admin');
// Beta's token verifier lives beside this repository's `firebase-sql-auth.js`
// rather than replacing it: that module implements a different "verify and
// provision in one step" contract used by `server/src/server.js`.
const { createFirebaseSqlAuth } = require('../auth/firebase-sql-verify');
const { createWriteGates } = require('../data/write-gates');
const { createSqlTeachingAssignmentWorkflowRepository } = require('../data/sql-teaching-assignment-workflow-repository');
const { createTeachingAssignmentApi } = require('../teaching-assignment/teaching-assignment-api');
const { createTeachingAssignmentFunctions } = require('./swa-teaching-assignment-functions');
const { createSqlDoeEngineRepository } = require('../data/sql-doe-engine-repository');
const { createSqlDoeWorksheetRepository } = require('../data/sql-doe-worksheet-repository');
const { createSqlDoeAssignmentRepository } = require('../data/sql-doe-assignment-repository');
const { createSqlManualDoeRepository } = require('../data/sql-manual-doe-repository');
const { createManualDoeService } = require('../doe/manual-doe-service');
const { createSqlDoeTargetOverrideRepository } = require('../data/sql-doe-target-override-repository');
const { createSqlDoePolicyRepository } = require('../data/sql-doe-policy-repository');
const { createDoeCalculationService } = require('../doe/doe-calculation-service');
const { createDoeSessionService } = require('../doe/doe-session-service');
const { createWorksheetService } = require('../doe/doe-worksheet-service');
const { createDoeAssignmentService } = require('../doe/doe-assignment-service');
const { createDoeTargetOverrideService } = require('../doe/doe-target-override-service');
const { createDoePolicyService } = require('../doe/doe-policy-service');
const { createDoeWorkflowPreviewService } = require('../doe/doe-workflow-preview-service');
const { createDoeApi } = require('../doe/doe-api');
const { createDoeFunctions } = require('./swa-doe-functions');
const { createSupportService } = require('../support/support-service');
const {createCalendarActivityApi}=require('../calendar/calendar-activity-api');
const {createCccScheduleApi}=require('../ccc/ccc-schedule-api');
const {createSqlCccScheduleRepository}=require('../data/sql-ccc-schedule-repository');
const {createCccScheduleFunctions}=require('./swa-ccc-schedule-functions');
const {createLeadershipDirectoryApi}=require('../roles/leadership-directory-api');
const {createSqlLeadershipDirectoryRepository}=require('../data/sql-leadership-directory-repository');
const {createLeadershipDirectoryFunctions,PATH:LEADERSHIP_DIRECTORY_PATH}=require('./swa-leadership-directory-functions');
const {createSqlCalendarActivityRepository}=require('../data/sql-calendar-activity-repository');
const {createCalendarActivityFunctions}=require('./swa-calendar-activity-functions');
const {createSchedulingTaskApi}=require('../scheduling/scheduling-task-api');
const {createSqlSchedulingTaskRepository}=require('../data/sql-scheduling-task-repository');
const {createSchedulingTaskFunctions}=require('./swa-scheduling-task-functions');
const {createFacultyAvailabilityApi}=require('../availability/faculty-availability-api');
const {createSqlFacultyAvailabilityRepository}=require('../data/sql-faculty-availability-repository');
const {createFacultyAvailabilityFunctions}=require('./swa-faculty-availability-functions');
const {createChangeHistoryApi}=require('../history/change-history-api');
const {createSqlChangeHistoryRepository}=require('../data/sql-change-history-repository');
const {createChangeHistoryFunctions}=require('./swa-change-history-functions');
const {createAfcFormApi}=require('../afc/afc-form-api');
const {createSqlAfcFormRepository}=require('../data/sql-afc-form-repository');
const {createAfcFormFunctions}=require('./swa-afc-form-functions');
const {createCccReplacementApi}=require('../calendar/ccc-replacement-api');
const {createSqlCccReplacementRepository}=require('../data/sql-ccc-replacement-repository');
const {createCccReplacementFunctions}=require('./swa-ccc-replacement-functions');

// Credential resolution, in precedence order:
//
//   1. PAWS_SQL_CONNECTION_STRING  -> Beta's connection-string model
//      (managed-identity client id, or msnodesqlv8 Windows auth). Driver and
//      self-signed flags are parsed strictly here, so a bad value fails at
//      composition rather than on the first query.
//   2. AZURE_SQL_SERVER + AZURE_SQL_DATABASE -> this repository's App Service
//      managed-identity access token, refreshed before expiry.
//   3. Neither -> the business database is not configured. This is a valid
//      deployment state, not an error: the application must still start and
//      render, and every business read must answer DATABASE_NOT_CONFIGURED
//      rather than pretending to be an empty database.
//
// No server name, database name or credential is hardcoded.
function connectionOptions(env, overrides = {}) {
  const connectionString = String(env.PAWS_SQL_CONNECTION_STRING || '').trim();
  if (connectionString) {
    return {
      connectionString,
      miClientId: env.PAWS_SQL_MI_CLIENT_ID,
      driver: resolveSqlDriver(env.PAWS_SQL_DRIVER),
      allowSelfSigned: parseBooleanFlag(env.PAWS_SQL_ALLOW_SELF_SIGNED, 'PAWS_SQL_ALLOW_SELF_SIGNED'),
      ...overrides
    };
  }
  const server = String(env.AZURE_SQL_SERVER || '').trim();
  const database = String(env.AZURE_SQL_DATABASE || '').trim();
  if (server && database) {
    return {
      tokenProvider: () => appServiceManagedIdentityTokenWithExpiry({ env }),
      server,
      database,
      ...overrides
    };
  }
  return { ...overrides };
}

function createSwaSqlRuntime({ env = process.env, admin = require('firebase-admin'), sqlModule, sql } = {}) {
  const injectedSql = sqlModule || sql;
  // In connection-string mode the driver module is resolved at composition, as
  // Beta did: Windows integrated auth needs `mssql/msnodesqlv8`, not `mssql`, and
  // resolving it here means a missing or wrong driver fails at startup rather
  // than on the first query. With no database configured nothing is loaded.
  const connectionString = String(env.PAWS_SQL_CONNECTION_STRING || '').trim();
  const sqlClient = injectedSql || (connectionString
    ? require(resolveSqlDriver(env.PAWS_SQL_DRIVER) === 'msnodesqlv8' ? 'mssql/msnodesqlv8' : 'mssql')
    : undefined);
  const db = createSqlConnection(connectionOptions(env, { sqlModule: sqlClient }));
  // The workbook import path is bounded separately because a full-year CCC or
  // activity replacement legitimately runs far longer than a page read.
  const calendarImportDb = createSqlConnection(connectionOptions(env, { sqlModule: sqlClient, requestTimeoutMs: 90000 }));
  const users = createSqlUserRepository(db);
  const sessions = createSqlSessionRepository(db);
  const dashboard = {
    ...createSqlDashboardRepository(db),
    ...createSqlDoeTargetRepository(db)
  };
  const afcWrite = createSqlAfcWriteRepository(db);
  const facultyAdminWrite = createSqlFacultyAdminRepository(db);
  const writeGates = createWriteGates(env);
  const realVerify = createFirebaseSqlAuth({
    verifyIdToken: createFirebaseVerifier({ admin, projectId: env.FIREBASE_PROJECT_ID, serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON }),
    expectedProjectId: env.FIREBASE_PROJECT_ID
  });
  const support=createSupportService({db,verifyToken:realVerify,findUser:users.findByUid});
  const verify=support.verify;
  const doeRepository = createSqlDoeEngineRepository(db);
  const doeAssignmentRepository = createSqlDoeAssignmentRepository(db);
  const doeCalculationService = createDoeCalculationService({ repository: doeRepository });
  const doeSessionService = createDoeSessionService({
    repository: { ...doeRepository, ...doeAssignmentRepository },
    calculationService: doeCalculationService
  });
  const timetable = createSwaFunctions({ api: createDataApi({
    verifyToken: verify,
    findUser: users.findByUid,
    listSessions: sessions.list,
    updateSession: sessions.updateExisting,
    createSession: sessions.createNew,
    createSessionBatch: sessions.createBatch,
    replaceSessionAssignments: sessions.replaceAssignments,
    recalculateSessionDoe: doeSessionService.recalculate,
    health: () => db.health(),
    writeGates
  }) });
  const dashboardRoutes = createDashboardFunctions({
    traineeApi:createTraineeApi({verifyToken:verify,findUser:users.findByUid,repository:createSqlTraineeRepository(db)}),
    api: createDashboardApi({ verifyToken: verify, findUser: users.findByUid, repository: dashboard, writeRepository: { ...afcWrite, ...facultyAdminWrite }, writeGates })
  });
  const afcRequestApi = createAfcRequestApi({
    verifyToken: verify,
    findUser: users.findByUid,
    repository: createSqlAfcRequestRepository(db),
    writeGates
  });
  const afcApprovalApi = createAfcApprovalApi({
    verifyToken: verify,
    findUser: users.findByUid,
    repository: createSqlAfcApprovalRepository(db),
    writeGates
  });
  const afcRequests = createAfcRequestFunctions({
    api: { ...afcRequestApi, ...afcApprovalApi }
  });
  const afcArtifactRoutes = createSwaAfcArtifactFunctions({
    api: createAfcApprovedArtifactApi({
      verifyToken: verify,
      findUser: users.findByUid,
      repository: createSqlAfcArtifactRepository(db),
      writeGates
    })
  });
  const teachingAssignmentRoutes = createTeachingAssignmentFunctions({api:createTeachingAssignmentApi({
    verifyToken:verify,findUser:users.findByUid,repository:createSqlTeachingAssignmentWorkflowRepository(db),writeGates
  })});
  const doeWorksheetRepository = createSqlDoeWorksheetRepository(db);
  const doeWorksheetService = createWorksheetService({ repository: doeWorksheetRepository });
  const doeTargetOverrideRepository = createSqlDoeTargetOverrideRepository(db);
  const doePolicyRepository = createSqlDoePolicyRepository(db);
  const doePolicyService = createDoePolicyService({ repository: { ...doeRepository, ...doePolicyRepository }, calculationService: doeCalculationService });
  const doeWorkflowPreviewService=createDoeWorkflowPreviewService({repository:{...sessions,...doeAssignmentRepository},worksheetService:doeWorksheetService,calculationService:doeCalculationService});
  const doeRoutes = createDoeFunctions({ api: createDoeApi({
    verifyToken: verify,
    findUser: users.findByUid,
    repository: { ...doeRepository, ...doePolicyRepository },
    calculationService: doeCalculationService,
    worksheetService: doeWorksheetService,
    workflowPreviewService: doeWorkflowPreviewService,
    assignmentService: createDoeAssignmentService({ repository: doeAssignmentRepository, calculationService: doeCalculationService }),
    manualAssignmentService: createManualDoeService({ repository: createSqlManualDoeRepository(db) }),
    targetOverrideService: createDoeTargetOverrideService({ repository: doeTargetOverrideRepository }),
    policyService: doePolicyService,
    writeGates
  }) });
  const swapRoutes = createSwapFunctions({api:createSwapApi({
    verifyToken:verify,findUser:users.findByUid,repository:createSqlSwapRepository(db),workflowPreviewService:doeWorkflowPreviewService,worksheetService:doeWorksheetService,writeGates
  })});
  const cccScheduleRoutes=createCccScheduleFunctions({api:createCccScheduleApi({verifyToken:verify,findUser:users.findByUid,repository:createSqlCccScheduleRepository(db)})});
  const leadershipDirectoryRoutes=createLeadershipDirectoryFunctions({api:createLeadershipDirectoryApi({verifyToken:verify,findUser:users.findByUid,repository:createSqlLeadershipDirectoryRepository(db)})});
  const calendarActivityRoutes=createCalendarActivityFunctions({api:createCalendarActivityApi({verifyToken:verify,findUser:users.findByUid,repository:createSqlCalendarActivityRepository(db,{importDb:calendarImportDb}),writeGates})});
  const facultyAvailabilityRoutes=createFacultyAvailabilityFunctions({api:createFacultyAvailabilityApi({verifyToken:verify,findUser:users.findByUid,repository:createSqlFacultyAvailabilityRepository(db)})});
  const schedulingTaskRoutes=createSchedulingTaskFunctions({api:createSchedulingTaskApi({verifyToken:verify,findUser:users.findByUid,repository:createSqlSchedulingTaskRepository(db),writeGates})});
  const historyRoutes=createChangeHistoryFunctions({api:createChangeHistoryApi({verifyToken:verify,findUser:users.findByUid,repository:createSqlChangeHistoryRepository(db)})});
  const afcFormRoutes=createAfcFormFunctions({api:createAfcFormApi({verifyToken:verify,findUser:users.findByUid,repository:createSqlAfcFormRepository(db),writeGates})});
  const cccReplacementRoutes=createCccReplacementFunctions({api:createCccReplacementApi({verifyToken:verify,findUser:users.findByUid,repository:createSqlCccReplacementRepository(db,{importDb:calendarImportDb}),writeGates})});
  const route = async request => {
    const pathname = new URL(request.url).pathname;
    // No business database is a distinct, recoverable state, not an outage.
    // Answering every business route with one typed code lets the UI show
    // "not configured yet" instead of a generic failure, and keeps that clearly
    // different from a configured database that legitimately has no rows.
    //
    // Authentication runs FIRST. Without it an anonymous caller would learn the
    // deployment state from a route it was never authorised to call, and the
    // unconfigured check would silently replace the authorization gate.
    if(!db.isConfigured){
      const header=String(request.headers.get('authorization')||'');
      await realVerify(header.replace(/^Bearer\s+/i,''));
      return{status:503,jsonBody:{error:{code:'DATABASE_NOT_CONFIGURED',message:'The business database is not configured. Business data is unavailable until a database is connected.'}}};
    }
    if(pathname==='/api/v1/ccc-schedule')return cccScheduleRoutes(request);
    if(pathname===LEADERSHIP_DIRECTORY_PATH)return leadershipDirectoryRoutes(request);
    if(pathname==='/api/v1/afc-forms'||pathname.startsWith('/api/v1/afc-forms/'))return afcFormRoutes(request);
    if(pathname==='/api/v1/ccc-replacements'||pathname.startsWith('/api/v1/ccc-replacements/'))return cccReplacementRoutes(request);
    if (pathname==='/api/v1/change-history'||pathname.startsWith('/api/v1/change-history/')) return historyRoutes(request);
    if (/^\/api\/v1\/faculty\/[^/]+\/availability$/.test(pathname))return facultyAvailabilityRoutes(request);
    if (pathname==='/api/v1/scheduling-tasks'||pathname.startsWith('/api/v1/scheduling-tasks/')) return schedulingTaskRoutes(request);
    if (pathname==='/api/v1/calendar-activities'||pathname.startsWith('/api/v1/calendar-activities/')||pathname==='/api/v1/calendar-activity-imports'||pathname.startsWith('/api/v1/calendar-activity-imports/')) return calendarActivityRoutes(request);
    if (pathname === '/api/v1/swaps' || pathname.startsWith('/api/v1/swaps/')) return swapRoutes(request);
    if (pathname.startsWith('/api/v1/doe/')) return doeRoutes(request);
    if (pathname.startsWith('/api/v1/teaching-assignments/')) return teachingAssignmentRoutes(request);
    if (pathname.startsWith('/api/v1/dashboard/')) return dashboardRoutes(request);
    if (/^\/api\/v1\/afc-requests\/[^/]+\/approved-artifact\/?$/.test(pathname)) return afcArtifactRoutes(request);
    if (pathname === '/api/v1/afc-requests' || pathname.startsWith('/api/v1/afc-requests/')) return afcRequests(request);
    return timetable(request);
  };
  const handler = request => support.handle(request,route);
  handler.close = () => Promise.all([db.close(), calendarImportDb.close()]);
  return handler;
}
module.exports={createSwaSqlRuntime,connectionOptions};
