'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {
 PAGE_EXPECTATIONS,CLOUD_FIREBASE_HOSTS,AUTH_FIXTURE,bundlePathMap,emulatorOrigin,safeStaticPath,contentType,chromeCandidates,localAssetFailure,doeSmokeResponse,createRulebookSmokeState,doeRulebookSmokeResponse
}=require('../tools/browser-smoke.js');

test('browser smoke covers every generated application page',()=>{
 assert.deepEqual(PAGE_EXPECTATIONS.map(item=>item.page),['index.html','faculty-admin.html','user-management.html','password.html']);
 for(const item of PAGE_EXPECTATIONS)assert.match(item.requiredLogical,/^bundles\/.+\.bundle\.js$/);
});

test('browser smoke explicitly rejects Firebase cloud endpoints',()=>{
 for(const host of ['firestore.googleapis.com','identitytoolkit.googleapis.com','securetoken.googleapis.com'])assert.ok(CLOUD_FIREBASE_HOSTS.has(host));
});

test('static smoke server cannot escape the deployment directory',()=>{
 const site=path.resolve('/tmp/ucvm-site');
 assert.equal(safeStaticPath(site,'/index.html'),path.join(site,'index.html'));
 assert.equal(safeStaticPath(site,'/bundles/a.bundle.js'),path.join(site,'bundles/a.bundle.js'));
 assert.equal(safeStaticPath(site,'/%2e%2e%2ffirestore.rules'),null);
 assert.equal(safeStaticPath(site,'/%00bad'),null);
});

test('browser smoke MIME and local-asset filters cover runtime files',()=>{
 assert.match(contentType('x.js'),/javascript/);
 assert.match(contentType('x.css'),/text\/css/);
 assert.match(contentType('x.pdf'),/application\/pdf/);
 assert.equal(localAssetFailure('http://127.0.0.1:8765/a.js','http://127.0.0.1:8765'),true);
 assert.equal(localAssetFailure('https://www.gstatic.com/firebase.js','http://127.0.0.1:8765'),false);
});

test('Chrome discovery keeps environment overrides ahead of runner defaults',()=>{
 const candidates=chromeCandidates({CHROME_PATH:'/custom/chrome',CHROME_BIN:'/custom/bin'});
 assert.deepEqual(candidates.slice(0,2),['/custom/chrome','/custom/bin']);
 assert.ok(candidates.includes('google-chrome'));
});

test('authenticated smoke fixture is isolated and uses an allowed UCVM email',()=>{
 assert.equal(AUTH_FIXTURE.projectId,'vista-teaching-lab');
 assert.match(AUTH_FIXTURE.email,/@ucalgary\.ca$/);
 assert.ok(AUTH_FIXTURE.password.length>=12);
 assert.equal(emulatorOrigin('127.0.0.1:9099'),'http://127.0.0.1:9099');
 assert.equal(emulatorOrigin('http://localhost:8080/'),'http://localhost:8080');
});

test('authenticated browser smoke exercises the AFC lazy helper bundle',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'..','tools/browser-smoke.js'),'utf8');
 assert.match(source,/UCVM_ASSETS\.ensureAfcPdf\(\)/);
 assert.match(source,/UCVM_AFC_FORM_VALUES/);
 assert.match(source,/UCVM_AFC_PDF/);
});

test('authenticated browser smoke verifies one centralized approval lazy bundle',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'..','tools/browser-smoke.js'),'utf8');
 assert.match(source,/UCVM_ASSETS\.ensureApprovalWorkflow\(\)/);
 assert.match(source,/approval-workflow\.lazy\.bundle\.js/);
 assert.match(source,/UCVM_SAFE_SWAP_HANDOFF/);
 assert.match(source,/expected exactly once/);
});

test('browser smoke resolves logical bundle names to hashed deployment paths',()=>{
 const map=bundlePathMap({bundles:[
  {logicalOutput:'bundles/timetable-app.bundle.js',output:'bundles/timetable-app.bundle.0123456789ab.js'},
  {logicalOutput:'bundles/afc-pdf.lazy.bundle.js',output:'bundles/afc-pdf.lazy.bundle.abcdef012345.js'}
 ]});
 assert.equal(map.get('bundles/timetable-app.bundle.js'),'bundles/timetable-app.bundle.0123456789ab.js');
 assert.equal(map.get('bundles/afc-pdf.lazy.bundle.js'),'bundles/afc-pdf.lazy.bundle.abcdef012345.js');
});


test('authenticated browser smoke exercises deferred DOE List navigation',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'..','tools/browser-smoke.js'),'utf8');
 assert.match(source,/DOE List deferred enhancement/);
 assert.match(source,/doe-list-tab/);
 assert.match(source,/doe-list-view/);
 assert.match(source,/doe-rules-view/);
});


test('browser smoke DOE endpoint is read-only and returns authoritative summary plus worksheet fixtures',()=>{
 const list=doeSmokeResponse('/__doe-smoke/api/doe/list?academicYear=2026-27','GET');
 assert.equal(list.statusCode,200);
 assert.equal(list.body[0].facultyId,'browser-smoke-faculty');
 assert.equal(list.body[0].assignedTeachingDoe,40);
 assert.equal(list.body[0].roleAssignmentCount,1);
 assert.equal(list.body[1].facultyId,'browser-smoke-mapping');
 assert.equal(list.body[1].status,'needs_review');
 assert.equal(list.body[1].missingMappingCount,1);
 assert.ok(list.body[1].issueCodes.includes('COURSE_MAPPING_REQUIRED'));
 const worksheet=doeSmokeResponse('/__doe-smoke/api/doe/faculty/browser-smoke-faculty/worksheet?academicYear=2026-27','GET');
 assert.equal(worksheet.statusCode,200);
 assert.equal(worksheet.body.totals.assignedTeachingDoe,40);
 assert.equal(worksheet.body.lines[0].calculationId,'calc-smoke-lecture');
 const denied=doeSmokeResponse('/__doe-smoke/api/doe/recalculate','POST');
 assert.equal(denied.statusCode,405);
});

test('authenticated browser smoke renders mocked server DOE values in the generated Faculty Dashboard',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'..','tools/browser-smoke.js'),'utf8');
 assert.match(source,/__doe-smoke/);
 assert.match(source,/Browser Smoke Faculty/);
 assert.match(source,/40\.00%/);
 assert.match(source,/Teaching DOE · server worksheet/);
});


test('authenticated browser smoke opens DOE Reconciliation and renders the Needs Review queue',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'..','tools/browser-smoke.js'),'utf8');
 assert.match(source,/doe-reconciliation-tab/);
 assert.match(source,/doe-reconciliation-queue-body/);
 assert.match(source,/Browser Smoke Mapping/);
 assert.match(source,/COURSE_MAPPING_REQUIRED/);
 assert.match(source,/DOE Reconciliation work queue render/);
});


test('DOE browser smoke fixture carries structured explanation evidence for an existing Faculty profile',()=>{
 const worksheet=doeSmokeResponse('/__doe-smoke/api/doe/faculty/fac-001/worksheet?academicYear=2026-27','GET');
 assert.equal(worksheet.statusCode,200);
 const line=worksheet.body.lines[0];
 assert.equal(line.lineId,'session-smoke--assignment-smoke');
 assert.equal(line.explanation.inputs.hours,2);
 assert.equal(line.explanation.parameters.rate,14);
 assert.equal(line.explanation.rule.name,'Lecture standard rate');
 assert.equal(line.explanation.facts.teachingRole,'Primary Instructor');
 assert.equal(line.calculationId,'calc-smoke-lecture');
});

test('authenticated browser smoke opens a DOE explanation modal from the generated Faculty profile',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'..','tools/browser-smoke.js'),'utf8');
 assert.match(source,/data-doe-explain-line/);
 assert.match(source,/doe-explain-modal/);
 assert.match(source,/Lecture standard rate/);
 assert.match(source,/Primary Instructor/);
 assert.match(source,/calc-smoke-lecture/);
 assert.match(source,/DOE explanation modal render/);
});


test('Rule Book browser mock preserves Draft gate state through edit, validation, impact, publish, and recalculation',()=>{
 const state=createRulebookSmokeState();
 const call=(url,method='GET',body)=>doeRulebookSmokeResponse(state,url,method,body);
 const policies=call('/__doe-smoke/api/doe/policies');
 assert.equal(policies.statusCode,200);
 assert.equal(policies.body[0].currentActiveVersionId,'smoke-policy-2026-27-v1');

 const cloned=call('/__doe-smoke/api/doe/policy-versions/smoke-policy-2026-27-v1/clone','POST',{});
 assert.equal(cloned.body.version.status,'draft');
 assert.equal(cloned.body.version.versionNumber,2);
 const draftId=cloned.body.version.policyVersionId;

 const saved=call(`/__doe-smoke/api/doe/drafts/${draftId}/rules/smoke-rule-lecture`,'PUT',{rule:{
  ruleId:'smoke-rule-lecture',policyVersionId:draftId,ruleKey:'teaching.lecture',name:'Lecture smoke revised',category:'teaching',
  calculationMode:'rate',resultKind:'credit',priority:10,enabled:true,reviewStatus:'reviewed',parameters:[{parameterId:'rate',name:'rate',valueNumber:15,unit:'% DOE/h'}],selectors:[],inputs:[],tiers:[]
 }});
 assert.equal(saved.body.version.revision,1);
 assert.equal(saved.body.version.lastValidationPassed,false);
 assert.equal(saved.body.version.lastImpactRunId,'');

 const mapping=call(`/__doe-smoke/api/doe/drafts/${draftId}/course-mappings/course-smoke`,'PUT',{mapping:{mappingId:'course-smoke',courseCode:'VTMD 999',unitCount:2,referenceId:'ref-smoke',reviewStatus:'reviewed',enabled:true}});
 assert.equal(mapping.statusCode,200);
 const bundleAfterMapping=call(`/__doe-smoke/api/doe/policy-versions/${draftId}/bundle`);
 assert.equal(bundleAfterMapping.body.version.revision,2);
 assert.equal(bundleAfterMapping.body.courseMappings.some(row=>row.courseCode==='VTMD 999'),true);

 const validation=call(`/__doe-smoke/api/doe/drafts/${draftId}/validate`,'POST',{});
 assert.equal(validation.body.valid,true);
 const validated=call(`/__doe-smoke/api/doe/policy-versions/${draftId}/bundle`).body.version;
 assert.equal(validated.lastValidatedRevision,2);
 assert.equal(validated.lastValidationPassed,true);
 assert.ok(validated.rulesChecksum);

 const preview=call(`/__doe-smoke/api/doe/drafts/${draftId}/impact-preview`,'POST',{});
 assert.equal(preview.body.status,'passed');
 const previewed=call(`/__doe-smoke/api/doe/policy-versions/${draftId}/bundle`).body.version;
 assert.equal(previewed.lastImpactRevision,2);
 assert.equal(previewed.lastImpactChecksum,previewed.rulesChecksum);
 assert.ok(previewed.lastImpactDatasetChecksum);

 const published=call(`/__doe-smoke/api/doe/drafts/${draftId}/publish`,'POST',{});
 assert.equal(published.body.status,'active');
 assert.equal(call('/__doe-smoke/api/doe/policies').body[0].currentActiveVersionId,draftId);

 const dryRun=call('/__doe-smoke/api/doe/recalculate/preview','POST',{academicYear:'2026-27',policyVersionId:draftId,scope:'all'});
 assert.equal(dryRun.body.errors.length,0);
 assert.equal(dryRun.body.changedDoeCount,1);
 const executed=call('/__doe-smoke/api/doe/recalculate','POST',{academicYear:'2026-27',policyVersionId:draftId,scope:'all'});
 assert.equal(executed.body.completedRows,3);
 assert.equal(executed.body.totalRows,3);
});

test('authenticated Chrome smoke exercises Rule Book Draft gates without Azure or live DOE writes',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'..','tools/browser-smoke.js'),'utf8');
 assert.match(source,/Rule Book Draft loaded/);
 assert.match(source,/Rule Book stale gates after edit/);
 assert.match(source,/Rule Book validation gate/);
 assert.match(source,/Rule Book Impact Preview gate/);
 assert.match(source,/Rule Book publish transition/);
 assert.match(source,/Rule Book recalculation dry-run and execution/);
});


test('Pages staged browser smoke verifies demo mode without cloud backend writes',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'..','tools/browser-smoke.js'),'utf8');
 assert.match(source,/process\.argv\.includes\('--demo'\)/);
 assert.match(source,/UCVM_FRONTEND_DEMO_MODE/);
 assert.match(source,/browser-memory/);
 assert.match(source,/demoDoeAuthoritative!==false/);
 assert.match(source,/Pages demo toolbar is missing/);
 assert.match(source,/unexpected Firebase cloud request\(s\) in \$\{demoMode\?'Pages demo':'emulator smoke'\}/);
});
