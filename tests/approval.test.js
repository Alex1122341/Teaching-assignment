'use strict';
// ---------------------------------------------------------------------------
// Merged domain test file.
//
// This file was assembled from several small single-purpose test files in the
// same domain. No assertion was changed: each source body is preserved verbatim
// inside its own IIFE so top-level declarations from different files cannot
// collide, and the total number of tests is unchanged.
//
// Split it back out by taking each block below to its own file if a failure ever
// needs a narrower blast radius.
// ---------------------------------------------------------------------------

// ------------------------------------------------------------------------
// merged from tests/approval-finalizer.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){
 const context={window:{}};
 for(const file of ['scheduling-core.js','calendar-session.js','approval-finalizer.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),context);
 return context.window.UCVM_APPROVAL_FINALIZER;
}

test('public finalizer protects stale changed fields and preserves display-only instructor data',()=>{
 const api=load();
 const request={id:'r1',sessionId:'s1',basePublic:{date:'2027-03-22',topic:'Old',instructor:'Dr A'},patchPublic:{date:'2027-03-23',topic:'New'}};
 const calendar={sessionId:'s1',course:'505',date:'2027-03-22',start:'09:00',end:'10:00',timeUnknown:false,type:'LAB',topic:'Old',room:'R1',instructor:'Dr A',instructorNames:['Dr A']};
 const plan=api.planPublicApply({request,calendar});
 assert.equal(plan.sourcePatch.date,'2027-03-23');
 assert.equal(plan.calendar.topic,'New');
 assert.equal(plan.calendar.instructor,'Dr A');
 assert.deepEqual(Array.from(plan.calendar.instructorNames),['Dr A']);
 assert.throws(()=>api.planPublicApply({request,calendar:{...calendar,date:'2027-03-21'}}),/changed after the request/);
});

test('faculty swap finalizer changes only the selected assignment and preserves private IDs outside public request',()=>{
 const api=load();
 const source={id:'s1',course:'505',date:'2027-03-22',start:'09:00',end:'10:00',type:'LEC',topic:'Topic',room:'R1',assignments:[{ucid:'f1',name:'Dr Old',doeCredit:1},{ucid:'f9',name:'Dr Other'}],facultyIds:['f1','f9'],instructor:'Dr Old; Dr Other'};
 const request={id:'r1',sessionId:'s1',basePublic:{course:'505',date:'2027-03-22',start:'09:00',end:'10:00',type:'LEC',topic:'Topic',room:'R1',instructor:'Dr Old; Dr Other'},patchPublic:{instructor:'Dr New'},proposedFacultyName:'Dr New'};
 const privateRecord={assignmentChange:{assignmentIndex:0,from:{facultyId:'f1'},to:{candidateKey:'opaque'}}};
 const plan=api.planFacultySwap({request,source,privateRecord,resolved:{facultyId:'f2',name:'Dr New',kind:'faculty'}});
 assert.equal(plan.sourcePatch.assignments[0].ucid,'f2');
 assert.equal(plan.sourcePatch.assignments[1].ucid,'f9');
 assert.deepEqual(Array.from(plan.sourcePatch.facultyIds),['f2','f9']);
 assert.equal(plan.sourcePatch.instructor,'Dr New; Dr Other');
 assert.equal(JSON.stringify(request).includes('f2'),false);
});

test('faculty swap blocks if the outgoing assignment or public stale base changed',()=>{
 const api=load(),source={id:'s1',date:'2027-03-22',start:'09:00',end:'10:00',type:'LEC',topic:'Topic',room:'R1',course:'505',assignments:[{ucid:'x',name:'Someone'}],instructor:'Someone'};
 const request={sessionId:'s1',basePublic:{course:'505',date:'2027-03-22',start:'09:00',end:'10:00',type:'LEC',topic:'Topic',room:'R1',instructor:'Dr Old'},patchPublic:{instructor:'Dr New'}};
 const privateRecord={assignmentChange:{assignmentIndex:0,from:{facultyId:'f1'},to:{candidateKey:'opaque'}}};
 assert.throws(()=>api.planFacultySwap({request,source,privateRecord,resolved:{facultyId:'f2',name:'Dr New'}}),/changed after the request|outgoing instructor/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/approval-indexes.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const indexes=require('../firestore.indexes.json');
function fields(name){return indexes.indexes.filter(i=>i.collectionGroup===name).map(i=>i.fields.map(f=>f.fieldPath));}
test('office approval queue and requester request queries have composite indexes',()=>{
  assert.ok(fields('change_request_approvals').some(f=>f.join(',')==='office,status,updatedAt'));
  assert.ok(fields('change_requests').some(f=>f.join(',')==='requesterUid,requestedAt'));
});
})();

// ------------------------------------------------------------------------
// merged from tests/approval-request-integration.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('shared routed request module is published before both submission clients',()=>{
  const manifest=JSON.parse(read('tools/static-assets.json'));
  assert.ok(manifest.includes('approval-request.js'));
  const index=read('index.html');
  assert.ok(index.indexOf('approval-routing.js')<index.indexOf('approval-request.js'));
  assert.ok(index.indexOf('approval-request.js')<index.indexOf('asset-loader.js'));
  const admin=read('faculty-admin.html');
  assert.ok(admin.indexOf('approval-request.js')>=0);
  assert.ok(admin.indexOf('approval-request.js')<admin.indexOf('faculty-swap-safe.js'));
  const loader=read('asset-loader.js');
  assert.match(loader,/loadScriptOnce\('approval-request\.js','UCVM_APPROVAL_REQUEST'\)/);
  assert.ok(loader.indexOf("approval-request.js")<loader.indexOf("faculty-swap-safe.js"));
});

test('legacy and privacy-safe swap submissions both use the split routed request writer',()=>{
  const workflow=read('approval-workflow.js'),safe=read('faculty-swap-safe.js');
  assert.match(workflow,/UCVM_APPROVAL_REQUEST\.submit\(/);
  assert.match(safe,/UCVM_APPROVAL_REQUEST\.submit\(/);
  assert.doesNotMatch(safe,/db\.collection\(REQUESTS\)\.add\(payload\)/);
  assert.doesNotMatch(workflow,/Request submitted to ADFA for approval\./);
  assert.match(workflow,/Request submitted for approval\./);
  assert.match(safe,/Request submitted for approval\./);
});
})();

// ------------------------------------------------------------------------
// merged from tests/approval-routing.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'approval-routing.js'),'utf8'),context);
  return context.window.UCVM_APPROVAL_ROUTING;
}

test('routes public scheduling fields to ADC and Faculty assignment to ADFA',()=>{
  const api=load();
  const route=api.build({
    base:{date:'2027-03-22',start:'14:45',end:'16:15',type:'LEC',topic:'Old',room:'A',instructor:'Dr A'},
    patch:{date:'2027-03-23',room:'B',instructor:'Dr B'}
  });
  assert.deepEqual([...route.scopes.adc],['date','room']);
  assert.deepEqual([...route.scopes.lab],[]);
  assert.deepEqual([...route.scopes.adfa],['instructor']);
  assert.deepEqual([...route.requiredOffices],['adc','adfa']);
  assert.equal(route.hasFacultyChange,true);
});

test('LAB topic is owned by LAB while ordinary topic is owned by ADC',()=>{
  const api=load();
  const lab=api.build({base:{type:'LAB',topic:'TBD'},patch:{topic:'Microscopy'}});
  assert.deepEqual([...lab.scopes.lab],['topic']);
  assert.deepEqual([...lab.scopes.adc],[]);
  assert.deepEqual([...lab.requiredOffices],['lab']);

  const lec=api.build({base:{type:'LEC',topic:'Old'},patch:{topic:'New'}});
  assert.deepEqual([...lec.scopes.adc],['topic']);
  assert.deepEqual([...lec.scopes.lab],[]);
});

test('type change recomputes topic ownership from the final type',()=>{
  const api=load();
  const toLab=api.build({base:{type:'LEC',topic:'Lecture'},patch:{type:'LAB',topic:'TBD'}});
  assert.deepEqual([...toLab.scopes.adc],['type']);
  assert.deepEqual([...toLab.scopes.lab],['topic']);
  assert.deepEqual([...toLab.requiredOffices],['adc','lab']);

  const fromLab=api.build({base:{type:'LAB',topic:'TBD'},patch:{type:'LEC',topic:'Lecture'}});
  assert.deepEqual([...fromLab.scopes.adc],['topic','type']);
  assert.deepEqual([...fromLab.scopes.lab],[]);
});

test('scope signatures are deterministic regardless of field order or patch key order',()=>{
  const api=load();
  const a=api.scopeSignature(['room','date'],{room:'B',date:'2027-03-23'});
  const b=api.scopeSignature(['date','room'],{date:'2027-03-23',room:'B'});
  assert.equal(a,b);
  assert.equal(a,JSON.stringify([['date','2027-03-23'],['room','B']]));
});
})();

// ------------------------------------------------------------------------
// merged from tests/approval-rules.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');

test('routed approval collections have explicit privacy boundaries',()=>{
  assert.match(rules,/function\s+routedRequest\(/);
  assert.match(rules,/match \/change_request_workflow\/\{id\}/);
  assert.match(rules,/match \/change_request_approvals\/\{id\}/);
  assert.match(rules,/match \/change_request_private\/\{id\}/);
  assert.match(rules,/match \/change_request_audit\/\{id\}/);
  assert.match(rules,/change_request_private[^]*allow read:\s*if\s+adfaApprover\(\)/);
  assert.match(rules,/change_request_workflow[^]*allow read:\s*if\s+officeWorkflowRead\(id\)/);
});

test('public routed requests are allowlisted and legacy private-shaped requests stay ADFA-only',()=>{
  assert.match(rules,/function\s+publicRequestKeysValid\(/);
  assert.match(rules,/requestSchema.*office-routing-v1/);
  assert.match(rules,/function\s+routedRequestRead\(id,d\)/);
  assert.match(rules,/legacyRequestRead\(d\)/);
  assert.match(rules,/publicSessionMapValid\(d\.basePublic\)/);
  assert.match(rules,/publicSessionMapValid\(d\.patchPublic\)/);
});

test('routed lifecycle rules pin office decisions requester transitions private resubmission and final apply',()=>{
  for(const helper of ['validRoutedOfficeDecision','validRoutedRequesterWithdraw','validRoutedRequesterResubmit','validRoutedPrivateResubmit','validRoutedApply'])assert.match(rules,new RegExp(`function\\s+${helper}\\(`),helper);
  assert.match(rules,/function\s+validRoutedRequestUpdate\(/);
  assert.match(rules,/function\s+validRoutedRequesterUpdate\(/);
  assert.match(rules,/function\s+validRoutedOfficeUpdate\(/);
  assert.match(rules,/change_requests[^]*allow update:[^]*routedRequest\(resource\.data\)[^]*validRoutedRequestUpdate\(id\)[^]*validRequestDecision\(\)/);
  assert.match(rules,/change_request_approvals[^]*allow update:[^]*validRoutedOfficeDecision\(id\)/);
  assert.match(rules,/change_request_private[^]*allow update:[^]*validRoutedPrivateResubmit\(id\)/);
});

test('routed public request schema allows terminal and applied metadata but keeps it allowlisted',()=>{
  assert.match(rules,/publicRequestKeysValid[^]*withdrawnBy[^]*withdrawnAt[^]*appliedRevision[^]*appliedAt/);
  assert.match(rules,/status in \['pending','update_required','approved','rejected','withdrawn'\]/);
});

test('non-ADFA final apply is bound to a deterministic request marker on the source session',()=>{
  assert.match(rules,/function\s+routedSessionApply\(id\)/);
  assert.match(rules,/approvalRequestId/);
  assert.match(rules,/approvalRevision/);
  assert.match(rules,/match \/sessions\/\{id\}[^]*routedSessionApply\(id\)/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/approval-scheduling.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'approval-scheduling.js'),'utf8'),context);return context.window.UCVM_APPROVAL_SCHEDULING}
const plain=value=>JSON.parse(JSON.stringify(value));

test('approval scheduling policy requires deliberate override only for real conflicts',()=>{
 const policy=load();
 assert.equal(policy.requiresOverride({status:'conflict'}),true);
 assert.equal(policy.requiresOverride({status:'clear'}),false);
 assert.equal(policy.requiresOverride({status:'check_needed'}),false);
});

test('approval scheduling policy builds a privacy-safe deterministic override audit payload',()=>{
 const policy=load();
 assert.deepEqual(plain(policy.overrideAudit({uid:'admin-1',name:'Admin User'},[{id:'s2',course:'304',date:'2026-10-01',start:'09:00',end:'10:00',ucid:'should-not-copy',doe:99,afcReason:'private'}])),{
  type:'faculty_time_conflict',confirmed:true,confirmedBy:'admin-1',confirmedByName:'Admin User',conflicts:[{id:'s2',course:'304',date:'2026-10-01',start:'09:00',end:'10:00'}]
 });
});
})();

// ------------------------------------------------------------------------
// merged from tests/approval-state.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'approval-state.js'),'utf8'),context);
  return context.window.UCVM_APPROVAL_STATE;
}

test('one rejection terminates the whole request',()=>{
  const api=load();
  const result=api.decide({status:'pending',approvals:{adc:'pending',lab:'approved',adfa:'pending'}},{office:'adc',decision:'reject'});
  assert.equal(result.status,'rejected');
  assert.equal(result.approvals.adc,'rejected');
  assert.equal(result.approvals.lab,'approved');
  assert.equal(result.approvals.adfa,'cancelled');
});

test('push back exposes only the returning office scope',()=>{
  const api=load();
  const result=api.decide({status:'pending',editableFields:[],approvals:{adc:'pending',lab:'approved'}},{office:'adc',decision:'push_back',fields:['date','room']});
  assert.equal(result.status,'update_required');
  assert.deepEqual([...result.editableFields],['date','room']);
  assert.equal(result.approvals.adc,'push_back');
  assert.equal(result.approvals.lab,'approved');
});

test('resubmission preserves unchanged approved scopes but resets returned scopes',()=>{
  const api=load();
  const result=api.planRevision({
    revision:1,status:'update_required',
    approvals:{adc:{status:'push_back',fields:['date'],scopeSignature:'old-a'},lab:{status:'approved',fields:['topic'],scopeSignature:'same-l'}},
    oldSignatures:{adc:'old-a',lab:'same-l'},
    newSignatures:{adc:'new-a',lab:'same-l'},
    changedFields:['date'],hasAssignedFaculty:false,requiredOffices:['adc','lab']
  });
  assert.equal(result.revision,2);
  assert.equal(result.status,'pending');
  assert.equal(result.approvals.adc.status,'pending');
  assert.equal(result.approvals.lab.status,'approved');
});

test('date/time revision with assigned Faculty reopens prior ADFA approval',()=>{
  const api=load();
  const result=api.planRevision({
    revision:3,status:'update_required',
    approvals:{adc:{status:'push_back',fields:['date']},adfa:{status:'approved',fields:['instructor']}},
    oldSignatures:{adc:'a1',adfa:'f1'},newSignatures:{adc:'a2',adfa:'f1'},
    changedFields:['date'],hasAssignedFaculty:true,requiredOffices:['adc','adfa']
  });
  assert.equal(result.approvals.adfa.status,'pending');
});

test('withdraw is allowed only from pending or update_required',()=>{
  const api=load();
  assert.equal(api.withdraw({status:'pending'}).status,'withdrawn');
  assert.equal(api.withdraw({status:'update_required'}).status,'withdrawn');
  assert.throws(()=>api.withdraw({status:'approved'}),/can no longer be withdrawn/i);
  assert.throws(()=>api.withdraw({status:'rejected'}),/can no longer be withdrawn/i);
  assert.throws(()=>api.withdraw({status:'withdrawn'}),/can no longer be withdrawn/i);
});

test('Spark finalizer requires ADFA only when Faculty changes are present',()=>{
  const api=load();
  assert.equal(api.canFinalize({office:'adc',hasFacultyChange:true,allRequiredApproved:true}),false);
  assert.equal(api.canFinalize({office:'lab',hasFacultyChange:true,allRequiredApproved:true}),false);
  assert.equal(api.canFinalize({office:'adfa',hasFacultyChange:true,allRequiredApproved:true}),true);
  assert.equal(api.canFinalize({office:'adfa',hasFacultyChange:true,allRequiredApproved:false}),false);
  assert.equal(api.canFinalize({office:'lab',hasFacultyChange:false,allRequiredApproved:true}),true);
});

test('other pending offices may continue deciding while a request is update_required',()=>{
 const api=load();
 const current={status:'update_required',editableFields:['date'],approvals:{adc:{status:'push_back'},lab:{status:'pending'}}};
 const approved=api.decide(current,{office:'lab',decision:'approve',fields:['topic']});
 assert.equal(approved.status,'update_required');
 assert.equal(approved.approvals.adc.status,'push_back');
 assert.equal(approved.approvals.lab.status,'approved');
});

test('multiple push backs union returned editable fields',()=>{
 const api=load();
 const current={status:'update_required',editableFields:['date'],approvals:{adc:{status:'push_back'},lab:{status:'pending'}}};
 const pushed=api.decide(current,{office:'lab',decision:'push_back',fields:['topic']});
 assert.deepEqual(Array.from(pushed.editableFields),['date','topic']);
});
})();

// ------------------------------------------------------------------------
// merged from tests/approval-workflow-routed.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=()=>fs.readFileSync(path.join(root,'approval-workflow.js'),'utf8');

test('workflow distinguishes office approvers from ADFA private approvers',()=>{
 const s=source();
 assert.match(s,/officeForRole/);
 assert.match(s,/isOfficeApprover/);
 assert.match(s,/isAdfaApprover/);
 assert.match(s,/change_request_approvals/);
});

test('ADC and LAB queues are driven by their office approval records rather than broad public request reads',()=>{
 const s=source();
 assert.match(s,/where\('office','==',office\(\)\)/);
 assert.match(s,/officeView\.queueLabel/);
});

test('routed decisions and withdrawal use guarded Firestore transactions',()=>{
 const s=source();
 assert.match(s,/runTransaction/);
 assert.match(s,/lifecycle\.planDecision/);
 assert.match(s,/lifecycle\.planRequesterWithdrawal/);
});

test('faculty-changing routed finalization keeps the migration marker and ADFA-only gate',()=>{
 const s=source();
 assert.match(s,/UCVM_DB_MIGRATION_REVISIT: spark-client-finalizer/);
 assert.match(s,/hasFacultyChange/);
 assert.match(s,/ADFA must complete a request that changes Faculty assignment/);
});

test('routed final apply writes source, sanitized calendar, audit and applied revision',()=>{
 const s=source();
 assert.match(s,/calendar_sessions/);
 assert.match(s,/change_request_audit/);
 assert.match(s,/appliedRevision/);
 assert.match(s,/UCVM_APPROVAL_FINALIZER/);
});

test('Faculty replacement resubmission uses the privacy-safe swap index and writes only an opaque private target',()=>{
 const s=source();
 assert.match(s,/faculty_swap_index/);
 assert.match(s,/facultyEditFromChoice/);
 assert.match(s,/assignmentChange\.to/);
 assert.match(s,/tx\.update\(privateRef/);
});

test('requester withdraw and resubmit never read internal workflow approval or private documents',()=>{
 const s=source();
 const withdraw=s.slice(s.indexOf('async function withdrawRoutedRequest'),s.indexOf('function editInput'));
 const resubmit=s.slice(s.indexOf('async function resubmitRoutedRequest'),s.indexOf('async function resolveRoutedReplacement'));
 assert.match(withdraw,/planRequesterWithdrawal/);
 assert.doesNotMatch(withdraw,/readRoutedBundleTx/);
 assert.match(resubmit,/planRequesterResubmission/);
 assert.doesNotMatch(resubmit,/readRoutedBundleTx/);
 assert.match(resubmit,/facultyScopeSignature/);
});

test('routed final apply stamps source provenance so rules can bind the write to the approved request',()=>{
 const s=source();
 assert.match(s,/approvalRequestId:id/);
 assert.match(s,/approvalRevision:bundle\.request\.revision/);
});

test('Faculty replacement resubmission carries a requester-safe reason for Sessional or Other choices',()=>{
 const s=source();
 assert.match(s,/facultyReason/);
 assert.match(s,/reason:facultyReason/);
});

test('routed ADFA impact hydration reads private assignment context only behind the ADFA gate',()=>{
 const s=source();
 assert.match(s,/function routedSwapImpactHtml/);
 assert.match(s,/async function hydrateApprovalImpacts\(\)\{\s*if\(!isAdfaApprover\(\)\)return/);
 assert.match(s,/PRIVATE_REQUESTS/);
 assert.match(s,/resolveRoutedReplacement\(privateRecord,r\)/);
 assert.match(s,/r\.patchPublic\|\|r\.patch\|\|\{\}/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/approval-workflow-ui.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'approval-office-view.js'),'utf8'),context);
  return context.window.UCVM_APPROVAL_OFFICE_VIEW;
}

test('office queues use role-specific labels',()=>{
  const api=load();
  assert.equal(api.queueLabel('adc',3),'ADC Approvals (3)');
  assert.equal(api.queueLabel('lab',2),'LAB Approvals (2)');
  assert.equal(api.queueLabel('adfa',1),'Approvals (1)');
});

test('ADC and LAB request view contains display-only Faculty context and no private fields',()=>{
  const api=load();
  const request={
    id:'r1',requestType:'faculty_swap',basePublic:{course:'505',date:'2027-03-22',instructor:'Dr Old'},
    patchPublic:{instructor:'Dr New'},currentFacultyName:'Dr Old',proposedFacultyName:'Dr New',
    facultyId:'SECRET-ID',email:'secret@example.test',doe:42,availability:'private',afc:'private'
  };
  const view=api.requestView({office:'adc',request,approvalMatrix:{adfa:'pending'}});
  assert.equal(view.faculty.proposedName,'Dr New');
  assert.equal(view.faculty.adfaStatus,'pending');
  const json=JSON.stringify(view);
  for(const secret of ['SECRET-ID','secret@example.test','42','private'])assert.equal(json.includes(secret),false);
});

test('field rows mark only the current office scope editable',()=>{
  const api=load();
  const request={basePublic:{date:'2027-03-22',topic:'Old'},patchPublic:{date:'2027-03-23',topic:'New'}};
  const workflow={scopes:{adc:['date'],lab:['topic'],adfa:[]},finalType:'LAB'};
  const adc=api.requestView({office:'adc',request,workflow});
  assert.equal(adc.fields.find(x=>x.field==='date').owned,true);
  assert.equal(adc.fields.find(x=>x.field==='topic').owned,false);
  const lab=api.requestView({office:'lab',request,workflow});
  assert.equal(lab.fields.find(x=>x.field==='date').owned,false);
  assert.equal(lab.fields.find(x=>x.field==='topic').owned,true);
});

test('only ADFA view requests rich private context',()=>{
  const api=load();
  assert.equal(api.canUsePrivateFacultyContext('adc'),false);
  assert.equal(api.canUsePrivateFacultyContext('lab'),false);
  assert.equal(api.canUsePrivateFacultyContext('adfa'),true);
});
})();


test('Developer approval UI exposes ADC LAB and ADFA scopes without changing ordinary role routing',()=>{
 const source=read('approval-workflow.js');
 assert.match(source,/const isDeveloper=\(\)=>role==='developer'/);
 assert.match(source,/approvalOffices=\(\)=>isDeveloper\(\)\?\['adc','lab','adfa'\]/);
 assert.match(source,/routedOfficeActionHtml\(r,currentOffice\)/);
 assert.match(source,/data-office-context/);
 assert.match(source,/Developer · all approval queues/);
 assert.match(source,/officeCaps\.officeForRole\(role\)/);
});
