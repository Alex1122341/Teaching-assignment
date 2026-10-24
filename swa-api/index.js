'use strict';
const {app}=require('@azure/functions');
const {createSwaSqlRuntime}=require('./server/src/runtime/swa-sql-runtime');
let runtime;
const handle=request=>(runtime||(runtime=createSwaSqlRuntime()))(request);
app.http('paws-health-sql',{methods:['GET'],authLevel:'anonymous',route:'health/sql',handler:handle});
app.http('paws-current-user',{methods:['GET'],authLevel:'anonymous',route:'v1/me',handler:handle});
app.http('paws-sessions',{methods:['GET'],authLevel:'anonymous',route:'v1/sessions',handler:handle});
// BETA-R4D-10A: the Dashboard routes are bound to every common method so the
// runtime — not the Functions host's route matcher — owns the 405 decision.
// Binding GET only would let the host answer a POST with 404 before the handler
// runs, which contradicts the reviewed Dashboard contract (405 + Allow: GET).
const DASHBOARD_METHODS=['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'];
app.http('paws-dashboard-summary',{methods:DASHBOARD_METHODS,authLevel:'anonymous',route:'v1/dashboard/summary',handler:handle});
app.http('paws-dashboard-faculty',{methods:DASHBOARD_METHODS,authLevel:'anonymous',route:'v1/dashboard/faculty',handler:handle});
app.http('paws-dashboard-faculty-id',{methods:DASHBOARD_METHODS,authLevel:'anonymous',route:'v1/dashboard/faculty/{facultyId}',handler:handle});
app.http('paws-dashboard-teaching-summary',{methods:DASHBOARD_METHODS,authLevel:'anonymous',route:'v1/dashboard/teaching-summary',handler:handle});
app.http('paws-dashboard-roles',{methods:DASHBOARD_METHODS,authLevel:'anonymous',route:'v1/dashboard/roles',handler:handle});
app.http('paws-dashboard-doe-overview',{methods:DASHBOARD_METHODS,authLevel:'anonymous',route:'v1/dashboard/doe-overview',handler:handle});
app.http('paws-dashboard-afc-records',{methods:DASHBOARD_METHODS,authLevel:'anonymous',route:'v1/dashboard/afc-records',handler:handle});
app.http('paws-dashboard-afc-records-batch',{methods:DASHBOARD_METHODS,authLevel:'anonymous',route:'v1/dashboard/afc-records/batch',handler:handle});
// The runtime owns method rejection and authentication for every activity route.
for(const [name,route] of [
 ['activities','v1/calendar-activities'],['activity-capabilities','v1/calendar-activities/capabilities'],
 ['activity-imports','v1/calendar-activity-imports'],['activity-import','v1/calendar-activity-imports/{batchId}'],
 ['activity-preview','v1/calendar-activity-imports/{batchId}/preview'],['activity-commit','v1/calendar-activity-imports/{batchId}/commit'],
 ['activity-time','v1/calendar-activities/{activityId}/time-evidence']
])app.http('paws-'+name,{methods:DASHBOARD_METHODS,authLevel:'anonymous',route,handler:handle});
