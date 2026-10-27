'use strict';
// Wires the remaining Beta API areas to demo repositories, in the same way as
// server/src/runtime/swa-sql-runtime.js.

function compose({ store, r, verify, findUser, writeGates, pending }) {
  const repo = (file, factory, area) => r.optional(file, factory, area);
  const doe = {
    engine: repo('./doe.js', 'createDoeEngineRepository', 'DOE'),
    assignment: repo('./doe.js', 'createDoeAssignmentRepository', 'DOE'),
    worksheet: repo('./doe.js', 'createDoeWorksheetRepository', 'DOE'),
    targetOverride: repo('./doe.js', 'createDoeTargetOverrideRepository', 'DOE'),
    policy: repo('./doe.js', 'createDoePolicyRepository', 'DOE'),
    manual: repo('./doe.js', 'createManualDoeRepository', 'DOE')
  };
  const calculationService = require('../../server/src/doe/doe-calculation-service').createDoeCalculationService({ repository: doe.engine });
  const sessionService = require('../../server/src/doe/doe-session-service').createDoeSessionService({ repository: { ...doe.engine, ...doe.assignment }, calculationService });
  const worksheetService = require('../../server/src/doe/doe-worksheet-service').createWorksheetService({ repository: doe.worksheet });
  const policyService = require('../../server/src/doe/doe-policy-service').createDoePolicyService({ repository: { ...doe.engine, ...doe.policy }, calculationService });
  const workflowPreviewService = require('../../server/src/doe/doe-workflow-preview-service').createDoeWorkflowPreviewService({ repository: { ...r.sessions, ...doe.assignment }, worksheetService, calculationService });
  const auth = { verifyToken: verify, findUser };

  const doeRoutes = require('../../server/src/runtime/swa-doe-functions').createDoeFunctions({ api: require('../../server/src/doe/doe-api').createDoeApi({
    ...auth, repository: { ...doe.engine, ...doe.policy }, calculationService, worksheetService, workflowPreviewService,
    assignmentService: require('../../server/src/doe/doe-assignment-service').createDoeAssignmentService({ repository: doe.assignment, calculationService }),
    manualAssignmentService: require('../../server/src/doe/manual-doe-service').createManualDoeService({ repository: doe.manual }),
    targetOverrideService: require('../../server/src/doe/doe-target-override-service').createDoeTargetOverrideService({ repository: doe.targetOverride }),
    policyService, writeGates
  }) });
  const afcRequestApi = require('../../server/src/afc/afc-request-api').createAfcRequestApi({ ...auth, repository: repo('./afc.js', 'createAfcRequestRepository', 'AFC requests'), writeGates });
  const afcApprovalApi = require('../../server/src/afc/afc-approval-api').createAfcApprovalApi({ ...auth, repository: repo('./afc.js', 'createAfcApprovalRepository', 'AFC approvals'), writeGates });
  const afcRequests = require('../../server/src/runtime/swa-afc-request-functions').createAfcRequestFunctions({ api: { ...afcRequestApi, ...afcApprovalApi } });
  const afcArtifactRoutes = require('../../server/src/runtime/swa-afc-artifact-functions').createSwaAfcArtifactFunctions({ api: require('../../server/src/afc/afc-approved-artifact-api').createAfcApprovedArtifactApi({ ...auth, repository: repo('./afc.js', 'createAfcArtifactRepository', 'AFC artifacts'), writeGates }) });
  const teachingAssignmentRoutes = require('../../server/src/runtime/swa-teaching-assignment-functions').createTeachingAssignmentFunctions({ api: require('../../server/src/teaching-assignment/teaching-assignment-api').createTeachingAssignmentApi({ ...auth, repository: repo('./ta.js', 'createTeachingAssignmentRepository', 'Teaching Assignments'), writeGates }) });
  const swapRoutes = require('../../server/src/runtime/swa-swap-functions').createSwapFunctions({ api: require('../../server/src/swap/swap-api').createSwapApi({ ...auth, repository: repo('./swap.js', 'createSwapRepository', 'SWAP'), workflowPreviewService, worksheetService, writeGates }) });
  const cccScheduleRoutes = require('../../server/src/runtime/swa-ccc-schedule-functions').createCccScheduleFunctions({ api: require('../../server/src/ccc/ccc-schedule-api').createCccScheduleApi({ ...auth, repository: repo('./calendar.js', 'createCccScheduleRepository', 'CCC schedule') }) });
  const leadership = require('../../server/src/runtime/swa-leadership-directory-functions');
  const leadershipRoutes = leadership.createLeadershipDirectoryFunctions({ api: require('../../server/src/roles/leadership-directory-api').createLeadershipDirectoryApi({ ...auth, repository: repo('./calendar.js', 'createLeadershipDirectoryRepository', 'Leadership directory') }) });
  const activityRepository = repo('./calendar.js', 'createCalendarActivityRepository', 'Calendar activities');
  const calendarActivityRoutes = require('../../server/src/runtime/swa-calendar-activity-functions').createCalendarActivityFunctions({ api: require('../../server/src/calendar/calendar-activity-api').createCalendarActivityApi({ ...auth, repository: activityRepository, writeGates }) });
  const availabilityRoutes = require('../../server/src/runtime/swa-faculty-availability-functions').createFacultyAvailabilityFunctions({ api: require('../../server/src/availability/faculty-availability-api').createFacultyAvailabilityApi({ ...auth, repository: repo('./calendar.js', 'createFacultyAvailabilityRepository', 'Availability') }) });
  const taskRoutes = require('../../server/src/runtime/swa-scheduling-task-functions').createSchedulingTaskFunctions({ api: require('../../server/src/scheduling/scheduling-task-api').createSchedulingTaskApi({ ...auth, repository: repo('./calendar.js', 'createSchedulingTaskRepository', 'Tasks'), writeGates }) });
  const historyApi = require('../../server/src/history/change-history-api').createChangeHistoryApi({ ...auth, repository: repo('./history.js', 'createChangeHistoryRepository', 'Change history') });
  const historyRoutes = require('../../server/src/runtime/swa-change-history-functions').createChangeHistoryFunctions({ api: historyApi });
  const reportSources = require('../../server/src/reports/report-sources').createReportSources({ dashboard: r.dashboard, sessions: r.sessions, activities: activityRepository, worksheetService, historyApi });
  const reportRoutes = require('../../server/src/runtime/swa-report-functions').createReportFunctions({ api: require('../../server/src/reports/report-api').createReportApi({ ...auth, loadSources: reportSources.load }) });
  const afcFormRoutes = require('../../server/src/runtime/swa-afc-form-functions').createAfcFormFunctions({ api: require('../../server/src/afc/afc-form-api').createAfcFormApi({ ...auth, repository: repo('./afc.js', 'createAfcFormRepository', 'AFC forms'), writeGates, validatePdf: require('./repos/afc.js').validateDemoPdf }) });
  const cccReplacementRoutes = require('../../server/src/runtime/swa-ccc-replacement-functions').createCccReplacementFunctions({ api: require('../../server/src/calendar/ccc-replacement-api').createCccReplacementApi({ ...auth, repository: repo('./calendar.js', 'createCccReplacementRepository', 'CCC replacement'), writeGates }) });
  const traineeApi = require('../../server/src/trainees/trainee-api').createTraineeApi({ ...auth, repository: repo('./trainees.js', 'createTraineeRepository', 'Trainees') });

  async function handle(pathname, request) {
    if (pathname === '/api/v1/reports' || pathname.startsWith('/api/v1/reports/')) return reportRoutes(request);
    if (pathname === '/api/v1/ccc-schedule') return cccScheduleRoutes(request);
    if (pathname === leadership.PATH) return leadershipRoutes(request);
    if (pathname === '/api/v1/afc-forms' || pathname.startsWith('/api/v1/afc-forms/')) return afcFormRoutes(request);
    if (pathname === '/api/v1/ccc-replacements' || pathname.startsWith('/api/v1/ccc-replacements/')) return cccReplacementRoutes(request);
    if (pathname === '/api/v1/change-history' || pathname.startsWith('/api/v1/change-history/')) return historyRoutes(request);
    if (/^\/api\/v1\/faculty\/[^/]+\/availability$/.test(pathname)) return availabilityRoutes(request);
    if (pathname === '/api/v1/scheduling-tasks' || pathname.startsWith('/api/v1/scheduling-tasks/')) return taskRoutes(request);
    if (pathname === '/api/v1/calendar-activities' || pathname.startsWith('/api/v1/calendar-activities/') || pathname === '/api/v1/calendar-activity-imports' || pathname.startsWith('/api/v1/calendar-activity-imports/')) return calendarActivityRoutes(request);
    if (pathname === '/api/v1/swaps' || pathname.startsWith('/api/v1/swaps/')) return swapRoutes(request);
    if (pathname.startsWith('/api/v1/doe/')) return doeRoutes(request);
    if (pathname.startsWith('/api/v1/teaching-assignments/')) return teachingAssignmentRoutes(request);
    if (/^\/api\/v1\/afc-requests\/[^/]+\/approved-artifact\/?$/.test(pathname)) return afcArtifactRoutes(request);
    if (pathname === '/api/v1/afc-requests' || pathname.startsWith('/api/v1/afc-requests/')) return afcRequests(request);
    if (pathname === '/api/v1/support' || pathname.startsWith('/api/v1/support/')) return supportStub(request);
    return null;
  }

  // Developer support delegates to another account in Beta. The demo already
  // has the Role Tester for that, so the endpoint reports no operations.
  async function supportStub(request) {
    const token = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    let decoded; try { decoded = await verify(token); } catch (_) { return { status: 401, jsonBody: { error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } } }; }
    const profile = await findUser(decoded.uid);
    if (!profile || profile.baseRole !== 'developer') return { status: 403, jsonBody: { error: { code: 'ROLE_DENIED', message: 'Developer support is limited to the Developer role.' } } };
    return { status: 200, jsonBody: { accounts: [], operations: [], active: null, demo: true, message: 'In the Frontend Demo, use the Demo Role Tester to view the site as another account.' } };
  }

  return { handle, traineeApi, recalculateSessionDoe: sessionService.recalculate };
}

module.exports = { compose };
