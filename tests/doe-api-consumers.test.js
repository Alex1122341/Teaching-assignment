'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function loadSelection(){
  const context={window:{},Date,console};
  vm.runInNewContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(root,'timetable-selection.js'),'utf8'),context);
  return context.window.UCVM_TIMETABLE_SELECTION;
}
function session(overrides={}){
  return{
    id:'s1',academicYear:'2027-28',date:'2027-09-10',semester:'fall',year:1,course:'VTMD 505',type:'LAB',topic:'Topic',room:'A101',start:'09:00',end:'11:00',
    assignments:[{assignmentId:'s1--assignment--1',ucid:'f1',facultyId:'f1',name:'Faculty One',role:'Lab Primary',creditedHours:2,doeCredit:.42,doePolicyVersionId:'old-v1',doeRuleId:'old-rule',doeRuleKey:'teaching.lab.primary',doeCalculationId:'calc-old'}],facultyIds:['f1'],
    ...overrides
  };
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('timetable API adapter asks the DOE API for a DOE-relevant edit and uses only the server result',async()=>{
  const selection=loadSelection(),calls=[];
  const api={previewSessionChange:async payload=>{calls.push(payload);return{
    session:{...payload.afterSession,assignments:[{...payload.afterSession.assignments[0],creditedHours:3,doeCredit:.63,doePolicyVersionId:'active-v2',doeRuleId:'lab-primary',doeRuleKey:'teaching.lab.primary',doeCalculationId:'calc-server'}]},
    calculationRecords:[{calculationId:'calc-server',resultDoe:.63}],
    doeChanges:[{assignmentId:'s1--assignment--1',oldDoeCredit:.42,newDoeCredit:.63}]
  }}};
  const before=session(),after=plain(before);after.end='12:00';after.assignments[0].doeCredit=99;
  const adapter=selection.createDoeApiAdapter({api});
  const prepared=await adapter.prepareSession(before,after,{trigger:'session_timing_changed'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].afterSession.assignments[0].doeCredit,undefined,'client-authored deterministic DOE must not be sent as an input fact');
  assert.equal(prepared.session.assignments[0].doeCredit,.63);
  assert.equal(prepared.session.assignments[0].doeCalculationId,'calc-server');
  assert.equal(prepared.calculationRecords[0].calculationId,'calc-server');
});

test('timetable API adapter preserves provenance for a server-classified non-DOE change',async()=>{
  const selection=loadSelection(),calls=[];
  const api={previewSessionChange:async payload=>{calls.push(payload);return{session:{...payload.afterSession,assignments:payload.beforeSession.assignments.map(row=>({...row}))},calculationRecords:[],doeChanges:[]}}};
  const before=session(),after=plain(before);after.room='B202';
  const adapter=selection.createDoeApiAdapter({api});
  const prepared=await adapter.prepareSession(before,after,{trigger:'session_updated'});
  assert.equal(calls.length,1);
  assert.equal(prepared.session.assignments[0].doeCalculationId,'calc-old');
  assert.equal(prepared.calculationRecords.length,0);
});

test('DOE API client exposes server workflow preview/write endpoints',async()=>{
  const calls=[];
  const api=require('../doe-api-client.js').createClient({baseUrl:'https://doe.example.test',tokenProvider:async()=> 'token',fetchImpl:async(url,options)=>{
    calls.push({url,options});return{ok:true,status:200,json:async()=>({ok:true})};
  }});
  await api.previewSessionChange({sessionId:'s1'});
  await api.previewFacultyTransfer({sessionId:'s1',assignmentId:'a1',incomingFacultyId:'f2'});
  await api.saveSessionChange({sessionId:'s1'});
  assert.deepEqual(calls.map(row=>[row.url,row.options.method]),[
    ['https://doe.example.test/api/doe/session-changes/preview','POST'],
    ['https://doe.example.test/api/doe/faculty-transfer/preview','POST'],
    ['https://doe.example.test/api/doe/session-changes','POST']
  ]);
});

test('active Timetable, safe swap, and Approval workflow use DOE API consumer methods instead of browser policy engine math',()=>{
  const timetable=fs.readFileSync(path.join(root,'timetable.js'),'utf8');
  const safeSwap=fs.readFileSync(path.join(root,'faculty-swap-safe.js'),'utf8');
  const approval=fs.readFileSync(path.join(root,'approval-workflow.js'),'utf8');
  const runtime=timetable.slice(timetable.indexOf('function getTimetableDoeRuntime'),timetable.indexOf('\n  function',timetable.indexOf('function getTimetableDoeRuntime')+20));
  assert.match(runtime,/UCVM_DOE_API/);
  assert.doesNotMatch(runtime,/UCVM_DOE_POLICY_ENGINE/);
  assert.match(safeSwap,/previewFacultyTransfer/);
  assert.match(approval,/previewFacultyTransfer/);
  assert.match(approval,/previewSessionChange/);
});


test('admin timetable SWAP consumes server faculty impacts instead of adding DOE in the browser',()=>{
  const source=fs.readFileSync(path.join(root,'timetable.js'),'utf8');
  const start=source.indexOf('async function performFacultySwap');
  const end=source.indexOf('\n  async function initializeLiveSchedule',start);
  const fn=source.slice(start,end);
  assert.match(fn,/facultyImpacts/);
  assert.doesNotMatch(fn,/currentNew\s*\+\s*newCredit/);
  const modalStart=source.indexOf('function openFacultySwap');
  const modalEnd=source.indexOf('async function performFacultySwap',modalStart);
  const modal=source.slice(modalStart,modalEnd);
  assert.doesNotMatch(modal,/current\s*\+\s*credit/);
});

test('DOE API client exposes server policy administration actions',async()=>{
  const calls=[];
  const api=require('../doe-api-client.js').createClient({baseUrl:'https://doe.example.test',tokenProvider:async()=> 'token',fetchImpl:async(url,options)=>{
    calls.push({url,options});return{ok:true,status:200,json:async()=>({ok:true})};
  }});
  await api.createPolicyYear({academicYear:'2027-28'});
  await api.cloneAsDraft('v1');
  await api.testRule('v1',{ruleId:'r1'},{hours:2});
  await api.runImpactPreview('v1');
  await api.publish('v1');
  await api.archive('v1');
  await api.previewRecalculate({academicYear:'2027-28',policyVersionId:'v1',scope:'all'});
  await api.runRecalculate({academicYear:'2027-28',policyVersionId:'v1',scope:'all'});
  assert.deepEqual(calls.map(row=>[row.url,row.options.method]),[
    ['https://doe.example.test/api/doe/policy-years','POST'],
    ['https://doe.example.test/api/doe/policy-versions/v1/clone','POST'],
    ['https://doe.example.test/api/doe/drafts/v1/test-rule','POST'],
    ['https://doe.example.test/api/doe/drafts/v1/impact-preview','POST'],
    ['https://doe.example.test/api/doe/drafts/v1/publish','POST'],
    ['https://doe.example.test/api/doe/policy-versions/v1/archive','POST'],
    ['https://doe.example.test/api/doe/recalculate/preview','POST'],
    ['https://doe.example.test/api/doe/recalculate','POST']
  ]);
});


test('DOE API client exposes policy administration reads and Draft writes',async()=>{
  const calls=[];
  const api=require('../doe-api-client.js').createClient({baseUrl:'https://doe.example.test',tokenProvider:async()=> 'token',fetchImpl:async(url,options)=>{
    calls.push({url,options});return{ok:true,status:200,json:async()=>({ok:true})};
  }});
  await api.listPolicies();
  await api.listVersions('p1');
  await api.loadPolicyBundle('v1');
  await api.getImpactPreview('i1');
  await api.saveRule('v1',{ruleId:'r1'});
  await api.saveException('v1',{exceptionId:'e1'});
  assert.deepEqual(calls.map(row=>[row.url,row.options.method]),[
    ['https://doe.example.test/api/doe/policies','GET'],
    ['https://doe.example.test/api/doe/policies/p1/versions','GET'],
    ['https://doe.example.test/api/doe/policy-versions/v1/bundle','GET'],
    ['https://doe.example.test/api/doe/impact-runs/i1','GET'],
    ['https://doe.example.test/api/doe/drafts/v1/rules/r1','PUT'],
    ['https://doe.example.test/api/doe/drafts/v1/exceptions/e1','PUT']
  ]);
});

test('active DOE mutation paths persist timetable changes through server API and never stage calculation evidence in the browser',()=>{
  const timetable=fs.readFileSync(path.join(root,'timetable.js'),'utf8');
  const safeSwap=fs.readFileSync(path.join(root,'faculty-swap-safe.js'),'utf8');
  const approval=fs.readFileSync(path.join(root,'approval-workflow.js'),'utf8');
  for(const [name,source] of [['timetable',timetable],['safe swap',safeSwap],['approval',approval]]){
    assert.doesNotMatch(source,/stageCalculationRecord|UCVM_DOE_POLICY_FIRESTORE/,name);
  }
  const swap=timetable.slice(timetable.indexOf('async function performFacultySwap'),timetable.indexOf('\n  async function initializeLiveSchedule'));
  assert.match(swap,/saveSessionChange/);
  const safe=safeSwap.slice(safeSwap.indexOf('async function safeApproveRequest'),safeSwap.indexOf('\n async function maybeInitializeSwapDirectory'));
  assert.match(safe,/saveSessionChange/);
  const finalize=approval.slice(approval.indexOf('async function finalizeRoutedRequest'),approval.indexOf('\n async function swapImpactHtml'));
  assert.match(finalize,/saveSessionChange/);
});


test('active browser helpers never synthesize DOE from legacy rate times hours',()=>{
 const sourceFunction=require('../test-support/source-function');
 const approvalContext={};vm.createContext(approvalContext);
 vm.runInContext(`const num=v=>v===undefined||v===null||v===''?null:(Number.isFinite(Number(v))?Number(v):null);${sourceFunction('approval-workflow.js','assignmentCredit')}`,approvalContext);
 assert.equal(approvalContext.assignmentCredit({doeCredit:.6,doeRate:.3,creditedHours:2}),.6);
 assert.equal(approvalContext.assignmentCredit({doeRate:.3,creditedHours:2}),null);
 const timetableContext={};vm.createContext(timetableContext);
 vm.runInContext(`${sourceFunction('timetable.js','swapNumeric')}\n${sourceFunction('timetable.js','swapAssignmentCredit')}`,timetableContext);
 assert.equal(timetableContext.swapAssignmentCredit({doeCredit:.6,doeRate:.3,creditedHours:2}),.6);
 assert.equal(timetableContext.swapAssignmentCredit({doeRate:.3,creditedHours:2}),null);
});

test('timetable faculty pickers do not present locally-derived DOE totals as authoritative',()=>{
 const source=fs.readFileSync(path.join(root,'timetable.js'),'utf8');
 assert.doesNotMatch(source,/function buildSwapDoeState\s*\(/);
 const pickerStart=source.indexOf('function selectionFacultyOptions');
 const pickerEnd=source.indexOf('\n  function',pickerStart+20);
 const picker=source.slice(pickerStart,pickerEnd);
 assert.doesNotMatch(picker,/UCVM_FACULTY_DOE|assignedTeachingDOE|__indexAssignedTeachingDOE/);
 assert.match(picker,/server preview/i);
});

test('Firebase-only timetable writes use the queued DOE fallback when HTTP API is absent',()=>{
 const source=fs.readFileSync(path.join(root,'timetable.js'),'utf8');
 const start=source.indexOf('function getTimetableDoeRuntime');
 const end=source.indexOf('\n  function',start+20);
 const fn=source.slice(start,end);
 assert.match(fn,/canQueueSessionChanges/);
 assert.match(fn,/prepareQueuedSessionChange/);
 assert.doesNotMatch(fn,/UCVM_DOE_POLICY_ENGINE/);
});

test('approval and safe-swap session saves allow the Firebase queue without enabling DOE preview math',()=>{
 const approval=fs.readFileSync(path.join(root,'approval-workflow.js'),'utf8');
 const safeSwap=fs.readFileSync(path.join(root,'faculty-swap-safe.js'),'utf8');
 assert.match(approval,/canQueueSessionChanges/);
 assert.match(approval,/method==='saveSessionChange'/);
 assert.match(safeSwap,/canQueueSessionChanges/);
 assert.match(safeSwap,/previewConfigured/);
});

test('queued session preparation strips authoritative DOE evidence and refreshes duration facts',()=>{
 const api=require('../doe-api-client.js'),before=session(),after=plain(before);after.end='12:00';
 const prepared=api.prepareQueuedSessionChange({beforeSession:before,afterSession:after,trigger:'session_updated'});
 const row=prepared.session.assignments[0];
 assert.equal(prepared.queued,true);assert.equal(row.creditedHours,3);
 for(const field of ['doeCredit','doePolicyVersionId','doeRuleId','doeRuleKey','doeCalculationId','doeRate'])assert.equal(row[field],undefined);
 assert.deepEqual(prepared.queue.sourceEntityIds,['s1--assignment--1']);
 assert.deepEqual(prepared.queue.facultyIds,['f1']);
});

test('unconfigured HTTP DOE client fails before attempting a relative network request',async()=>{
 let called=false;
 const api=require('../doe-api-client.js').createClient({baseUrl:'',tokenProvider:async()=> 'token',fetchImpl:async()=>{called=true;return{ok:true,status:200,json:async()=>({})}}});
 await assert.rejects(()=>api.listPolicies(),error=>error?.code==='DOE_API_NOT_CONFIGURED');
 assert.equal(called,false);
});

test('legacy approval apply path persists session changes through the DOE API',()=>{
 const source=fs.readFileSync(path.join(root,'approval-workflow.js'),'utf8');
 const start=source.indexOf('async function approveRequest');
 const end=source.indexOf('\n async function rejectRequest',start);
 const fn=source.slice(start,end);
 assert.match(fn,/saveSessionChange/);
 assert.doesNotMatch(fn,/batch\.set\(ref/);
});

test('Faculty Edit override is saved through DOE target API, not legacy year-suffixed Firestore write',()=>{
 const source=fs.readFileSync(path.join(root,'faculty-admin-enhancements.js'),'utf8');
 assert.match(source,/saveFacultyTarget/);
 const saveExtras=source.slice(source.indexOf('async function saveExtras'),source.indexOf('function appendManagedRoleRows'));
 assert.doesNotMatch(saveExtras,/doeOverride2026_27/);
 assert.doesNotMatch(saveExtras,/db\.collection\('faculty'\)/);
});
