'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const site=path.join(root,'.deploy-static');
const metadataPath=path.join(root,'.deploy-metadata','deployment-assets.json');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function readDeploymentMetadata(){return JSON.parse(fs.readFileSync(metadataPath,'utf8'))}
function bundlePathMap(metadata=readDeploymentMetadata()){
 return new Map((metadata.bundles||[]).map(bundle=>[bundle.logicalOutput||bundle.output,bundle.output]));
}
const CLOUD_FIREBASE_HOSTS=new Set(['firestore.googleapis.com','identitytoolkit.googleapis.com','securetoken.googleapis.com']);
const PAGE_EXPECTATIONS=Object.freeze([
 {page:'index.html',titles:['UCVM Timetable - Workload Guideline DOE V9.7'],requiredLogical:'bundles/timetable-app.bundle.js'},
 {page:'faculty-admin.html',titles:['Faculty Dashboard'],requiredLogical:'bundles/faculty-runtime-main.bundle.js'},
 {page:'user-management.html',titles:['UCVM · User Management','UCVM Timetable - Workload Guideline DOE V9.7'],requiredLogical:'bundles/user-management.bundle.js'},
 {page:'password.html',titles:['UCVM · Change Password','UCVM Timetable - Workload Guideline DOE V9.7'],requiredLogical:'bundles/shared-auth.bundle.js'}
]);
const AUTH_FIXTURE=Object.freeze({
 projectId:'vista-teaching-lab',
 email:'browser.smoke@ucalgary.ca',
 password:'BrowserSmoke-2026!'
});
function emulatorOrigin(value,fallback){
 const raw=String(value||fallback).trim().replace(/^https?:\/\//,'').replace(/\/$/,'');
 return `http://${raw}`;
}
async function createAuthenticatedFixture({
 authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST,
 firestoreHost=process.env.FIRESTORE_EMULATOR_HOST,
 fixture=AUTH_FIXTURE
}={}){
 if(!authHost||!firestoreHost)throw Error('Authenticated browser smoke requires Auth and Firestore emulators.');
 const authOrigin=emulatorOrigin(authHost,'127.0.0.1:9099');
 const firestoreOrigin=emulatorOrigin(firestoreHost,'127.0.0.1:8080');
 const signUp=await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email:fixture.email,password:fixture.password,returnSecureToken:true})
 });
 if(!signUp.ok)throw Error(`Auth emulator fixture creation failed: HTTP ${signUp.status} ${(await signUp.text()).slice(0,300)}`);
 const account=await signUp.json(),uid=String(account.localId||'');
 if(!uid)throw Error('Auth emulator fixture did not return a UID.');
 const fields={
  name:{stringValue:'Browser Smoke Owner'},
  email:{stringValue:fixture.email},
  role:{stringValue:'adfa_general'},
  active:{booleanValue:true},
  mustChangePassword:{booleanValue:false},
  updatedBy:{stringValue:uid}
 };
 const profile=await fetch(`${firestoreOrigin}/v1/projects/${fixture.projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}`,{
  method:'PATCH',
  headers:{authorization:'Bearer owner','content-type':'application/json'},
  body:JSON.stringify({fields})
 });
 if(!profile.ok)throw Error(`Firestore emulator profile creation failed: HTTP ${profile.status} ${(await profile.text()).slice(0,300)}`);
 return{uid,email:fixture.email,password:fixture.password};
}

function safeStaticPath(siteRoot,requestUrl){
 let pathname;
 try{pathname=decodeURIComponent(new URL(requestUrl,'http://127.0.0.1').pathname)}catch{return null}
 const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');
 if(!relative||relative.includes('\0'))return null;
 const base=path.resolve(siteRoot),candidate=path.resolve(base,relative),prefix=base.endsWith(path.sep)?base:base+path.sep;
 return candidate.startsWith(prefix)?candidate:null;
}
function contentType(filename){
 const ext=path.extname(filename).toLowerCase();
 return({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.pdf':'application/pdf'}[ext]||'application/octet-stream');
}
function cloneSmoke(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value))}
function createRulebookSmokeState(){
 const policy={policyId:'smoke-policy-2026-27',academicYear:'2026-27',name:'UCVM Workload 2026-27',currentActiveVersionId:'smoke-policy-2026-27-v1'};
 const version={
  policyVersionId:'smoke-policy-2026-27-v1',policyId:policy.policyId,academicYear:policy.academicYear,versionNumber:1,status:'active',revision:3,
  name:'2026-27 active smoke policy',lastValidationPassed:true,lastValidatedRevision:3,rulesChecksum:'smoke-checksum-active-v1',
  lastImpactRunId:'smoke-impact-active-v1',lastImpactRevision:3,lastImpactChecksum:'smoke-checksum-active-v1',lastImpactDatasetChecksum:'smoke-dataset-active-v1',
  reservePolicy:{strategy:'flexible_teaching_reserve',splitThreshold:20,splitRatio:.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:20,rollingAverageYears:3,referenceId:'ref-smoke',reviewStatus:'reviewed'}
 };
 const reference={referenceId:'ref-smoke',policyVersionId:version.policyVersionId,academicYear:policy.academicYear,title:'UCVM Workload Guidelines',versionDate:'2026-07-01',section:'6.4',table:'Table 3',page:5,effectiveDate:'2026-07-01',reviewStatus:'reviewed',adminNote:'Browser smoke reference'};
 const rule={
  ruleId:'smoke-rule-lecture',policyVersionId:version.policyVersionId,ruleKey:'teaching.lecture',name:'Lecture standard rate',category:'teaching',
  calculationMode:'rate',resultKind:'credit',priority:10,enabled:true,reviewStatus:'reviewed',referenceId:reference.referenceId,guidelineReference:'§6.4 · Table 3',sourceType:'workload_guideline',mappingRequirement:'course',
  selectors:[{selectorId:'smoke-selector-lecture',field:'activityType',operator:'equals',valueText:'Lecture'}],
  inputs:[{ruleInputId:'smoke-input-hours',inputName:'hours',inputType:'number',source:'assignment.creditedHours',required:true}],
  parameters:[{parameterId:'smoke-param-rate',name:'rate',valueNumber:14,unit:'% DOE/h',required:true}],tiers:[]
 };
 const courseMapping={mappingId:'course-existing',policyVersionId:version.policyVersionId,academicYear:policy.academicYear,courseCode:'VTMD 204',unitCount:2,referenceId:reference.referenceId,reviewStatus:'reviewed',adminNote:'Existing smoke mapping',enabled:true};
 const bundle={policy:cloneSmoke(policy),version:cloneSmoke(version),references:[cloneSmoke(reference)],rules:[cloneSmoke(rule)],exceptions:[],courseMappings:[cloneSmoke(courseMapping)],subjectMappings:[]};
 return{
  policy,
  versions:new Map([[version.policyVersionId,cloneSmoke(version)]]),
  bundles:new Map([[version.policyVersionId,bundle]]),
  impactRuns:new Map([['smoke-impact-active-v1',{impactRunId:'smoke-impact-active-v1',policyVersionId:version.policyVersionId,policyRevision:3,policyChecksum:version.rulesChecksum,inputDatasetChecksum:version.lastImpactDatasetChecksum,status:'passed',facultyCount:1,calculationCount:2,changedFacultyCount:0,largeIncreaseCount:0,largeDecreaseCount:0,errorCount:0,warningCount:0,rows:[]}]]),
  audits:[],
  nextImpact:1,
  nextBatch:1
 };
}
function smokeRulebookBundle(state,versionId){return state?.bundles?.get(String(versionId||''))||null}
function invalidateSmokeDraft(bundle){
 const version=bundle.version;version.revision=Number(version.revision||0)+1;version.lastValidationPassed=false;version.lastValidatedRevision=null;version.rulesChecksum='';
 version.lastImpactRunId='';version.lastImpactRevision=null;version.lastImpactChecksum='';version.lastImpactDatasetChecksum='';
 stateVersionSync(bundle);
}
function stateVersionSync(bundle){
 const state=bundle.__state;if(state)state.versions.set(bundle.version.policyVersionId,cloneSmoke(bundle.version));
 delete bundle.__state;
}
function doeRulebookSmokeResponse(state,requestUrl,method='GET',body={}){
 if(!state)return null;
 const parsed=new URL(String(requestUrl||'/'),'http://127.0.0.1'),path=parsed.pathname,verb=String(method||'GET').toUpperCase();
 if(!path.startsWith('/__doe-smoke/api/doe/'))return null;
 const respond=(statusCode,payload)=>({statusCode,body:cloneSmoke(payload)});
 if(verb==='GET'&&path==='/__doe-smoke/api/doe/policies')return respond(200,[state.policy]);
 let match=path.match(/^\/__doe-smoke\/api\/doe\/policies\/([^/]+)\/versions$/);
 if(verb==='GET'&&match){
  const policyId=decodeURIComponent(match[1]);
  return respond(200,[...state.versions.values()].filter(row=>row.policyId===policyId).sort((a,b)=>Number(a.versionNumber||0)-Number(b.versionNumber||0)));
 }
 match=path.match(/^\/__doe-smoke\/api\/doe\/policy-versions\/([^/]+)\/bundle$/);
 if(verb==='GET'&&match){
  const bundle=smokeRulebookBundle(state,decodeURIComponent(match[1]));
  return bundle?respond(200,bundle):respond(404,{code:'POLICY_VERSION_NOT_FOUND',message:'Smoke Policy Version not found.'});
 }
 match=path.match(/^\/__doe-smoke\/api\/doe\/policy-versions\/([^/]+)\/audit$/);
 if(verb==='GET'&&match)return respond(200,state.audits.filter(row=>row.policyVersionId===decodeURIComponent(match[1])));
 match=path.match(/^\/__doe-smoke\/api\/doe\/impact-runs\/([^/]+)$/);
 if(verb==='GET'&&match){
  const run=state.impactRuns.get(decodeURIComponent(match[1]));
  return run?respond(200,run):respond(404,{code:'IMPACT_RUN_NOT_FOUND',message:'Smoke Impact Preview not found.'});
 }
 match=path.match(/^\/__doe-smoke\/api\/doe\/policy-versions\/([^/]+)\/clone$/);
 if(verb==='POST'&&match){
  const source=smokeRulebookBundle(state,decodeURIComponent(match[1]));
  if(!source)return respond(404,{code:'POLICY_VERSION_NOT_FOUND',message:'Smoke source Policy Version not found.'});
  const numbers=[...state.versions.values()].filter(row=>row.policyId===source.version.policyId).map(row=>Number(row.versionNumber||0));
  const versionNumber=Math.max(0,...numbers)+1,policyVersionId=`${source.version.policyId}-v${versionNumber}`;
  const version={...cloneSmoke(source.version),policyVersionId,versionNumber,status:'draft',revision:0,name:`${source.version.academicYear} smoke Draft v${versionNumber}`,lastValidationPassed:false,lastValidatedRevision:null,rulesChecksum:'',lastImpactRunId:'',lastImpactRevision:null,lastImpactChecksum:'',lastImpactDatasetChecksum:''};
  const reversion=row=>({...cloneSmoke(row),policyVersionId,academicYear:version.academicYear,reviewStatus:row.reviewStatus==='reviewed'?'updated':row.reviewStatus});
  const bundle={policy:cloneSmoke(state.policy),version,rules:(source.rules||[]).map(reversion),exceptions:(source.exceptions||[]).map(reversion),references:(source.references||[]).map(reversion),courseMappings:(source.courseMappings||[]).map(reversion),subjectMappings:(source.subjectMappings||[]).map(reversion)};
  state.versions.set(policyVersionId,cloneSmoke(version));state.bundles.set(policyVersionId,bundle);state.audits.push({policyVersionId,academicYear:version.academicYear,action:'draft_cloned',entityType:'policy_version',changedAt:'2026-09-20T04:00:00Z',changedByName:'Browser Smoke Owner'});
  return respond(200,{version});
 }
 match=path.match(/^\/__doe-smoke\/api\/doe\/drafts\/([^/]+)\/rules\/([^/]+)$/);
 if(verb==='PUT'&&match){
  const versionId=decodeURIComponent(match[1]),bundle=smokeRulebookBundle(state,versionId);
  if(!bundle||bundle.version.status!=='draft')return respond(409,{code:'DRAFT_REQUIRED',message:'Smoke Draft is required.'});
  const rule={...(body?.rule||{}),policyVersionId:versionId,ruleId:decodeURIComponent(match[2])},at=(bundle.rules||[]).findIndex(row=>row.ruleId===rule.ruleId);
  if(at>=0)bundle.rules[at]=cloneSmoke(rule);else bundle.rules.push(cloneSmoke(rule));
  bundle.__state=state;invalidateSmokeDraft(bundle);state.bundles.set(versionId,bundle);
  state.audits.push({policyVersionId:versionId,academicYear:bundle.version.academicYear,action:'rule_saved',entityType:'rule',entityId:rule.ruleId,changedAt:'2026-09-20T04:01:00Z',changedByName:'Browser Smoke Owner'});
  return respond(200,bundle);
 }
 match=path.match(/^\/__doe-smoke\/api\/doe\/drafts\/([^/]+)\/(course|subject)-mappings\/([^/]+)$/);
 if(verb==='PUT'&&match){
  const versionId=decodeURIComponent(match[1]),type=match[2],bundle=smokeRulebookBundle(state,versionId);
  if(!bundle||bundle.version.status!=='draft')return respond(409,{code:'DRAFT_REQUIRED',message:'Smoke Draft is required.'});
  const key=type==='course'?'courseMappings':'subjectMappings',mapping={...(body?.mapping||{}),mappingId:decodeURIComponent(match[3]),policyVersionId:versionId,academicYear:bundle.version.academicYear};
  const rows=bundle[key]||[],at=rows.findIndex(row=>row.mappingId===mapping.mappingId);if(at>=0)rows[at]=cloneSmoke(mapping);else rows.push(cloneSmoke(mapping));bundle[key]=rows;
  bundle.__state=state;invalidateSmokeDraft(bundle);state.bundles.set(versionId,bundle);
  state.audits.push({policyVersionId:versionId,academicYear:bundle.version.academicYear,action:`${type}_mapping_saved`,entityType:`${type}_mapping`,entityId:mapping.mappingId,changedAt:'2026-09-20T04:02:00Z',changedByName:'Browser Smoke Owner'});
  return respond(200,mapping);
 }
 match=path.match(/^\/__doe-smoke\/api\/doe\/drafts\/([^/]+)\/validate$/);
 if(verb==='POST'&&match){
  const versionId=decodeURIComponent(match[1]),bundle=smokeRulebookBundle(state,versionId);
  if(!bundle||bundle.version.status!=='draft')return respond(409,{code:'DRAFT_REQUIRED',message:'Smoke Draft is required.'});
  const checksum=`smoke-checksum-r${bundle.version.revision}`;bundle.version.lastValidationPassed=true;bundle.version.lastValidatedRevision=bundle.version.revision;bundle.version.rulesChecksum=checksum;state.versions.set(versionId,cloneSmoke(bundle.version));
  state.audits.push({policyVersionId:versionId,academicYear:bundle.version.academicYear,action:'draft_validated',entityType:'policy_version',changedAt:'2026-09-20T04:03:00Z',changedByName:'Browser Smoke Owner'});
  return respond(200,{valid:true,errors:[],warnings:[],policyChecksum:checksum});
 }
 match=path.match(/^\/__doe-smoke\/api\/doe\/drafts\/([^/]+)\/impact-preview$/);
 if(verb==='POST'&&match){
  const versionId=decodeURIComponent(match[1]),bundle=smokeRulebookBundle(state,versionId),version=bundle?.version;
  if(!bundle||version.status!=='draft')return respond(409,{code:'DRAFT_REQUIRED',message:'Smoke Draft is required.'});
  if(version.lastValidationPassed!==true||Number(version.lastValidatedRevision)!==Number(version.revision)||!version.rulesChecksum)return respond(409,{code:'VALIDATION_REQUIRED',message:'Validate the current smoke Draft first.'});
  const impactRunId=`smoke-impact-${state.nextImpact++}`,run={impactRunId,policyVersionId:versionId,policyRevision:version.revision,policyChecksum:version.rulesChecksum,inputDatasetChecksum:'smoke-dataset-current',status:'passed',facultyCount:1,calculationCount:2,changedFacultyCount:1,affectedFacultyCount:1,affectedCalculationCount:2,increaseCount:1,decreaseCount:0,unchangedCount:0,newNeedsReviewCount:0,resolvedCurrentGapCount:0,missingMappingCount:0,largestIncreaseDoe:6,largestDecreaseDoe:null,largeIncreaseCount:1,largeDecreaseCount:0,errorCount:0,warningCount:1,rows:[{facultyId:'fac-001',currentDoe:40,draftDoe:46,difference:6,impactStatus:'increase',calculationCount:2,affectedRules:['teaching.lecture'],warnings:[{code:'LARGE_INCREASE',message:'Review increase'}],errors:[]}]};
  state.impactRuns.set(impactRunId,run);version.lastImpactRunId=impactRunId;version.lastImpactRevision=version.revision;version.lastImpactChecksum=version.rulesChecksum;version.lastImpactDatasetChecksum=run.inputDatasetChecksum;state.versions.set(versionId,cloneSmoke(version));
  state.audits.push({policyVersionId:versionId,academicYear:version.academicYear,action:'impact_preview_completed',entityType:'policy_version',changedAt:'2026-09-20T04:04:00Z',changedByName:'Browser Smoke Owner'});
  return respond(200,run);
 }
 match=path.match(/^\/__doe-smoke\/api\/doe\/drafts\/([^/]+)\/publish$/);
 if(verb==='POST'&&match){
  const versionId=decodeURIComponent(match[1]),bundle=smokeRulebookBundle(state,versionId),version=bundle?.version;
  if(!bundle||version.status!=='draft')return respond(409,{code:'DRAFT_REQUIRED',message:'Smoke Draft is required.'});
  const current=version.lastValidationPassed===true&&Number(version.lastValidatedRevision)===Number(version.revision)&&version.lastImpactRunId&&Number(version.lastImpactRevision)===Number(version.revision)&&version.lastImpactChecksum===version.rulesChecksum&&!!version.lastImpactDatasetChecksum;
  if(!current)return respond(409,{code:'IMPACT_PREVIEW_REQUIRED',message:'A current passing smoke Impact Preview is required.'});
  for(const [id,row] of state.versions){if(row.policyId===version.policyId&&row.status==='active'){row.status='archived';state.versions.set(id,row);const old=state.bundles.get(id);if(old)old.version.status='archived'}}
  version.status='active';state.policy.currentActiveVersionId=versionId;bundle.policy.currentActiveVersionId=versionId;state.versions.set(versionId,cloneSmoke(version));
  state.audits.push({policyVersionId:versionId,academicYear:version.academicYear,action:'policy_published',entityType:'policy_version',changedAt:'2026-09-20T04:05:00Z',changedByName:'Browser Smoke Owner'});
  return respond(200,version);
 }
 if(verb==='POST'&&path==='/__doe-smoke/api/doe/recalculate/preview'){
  const version=state.versions.get(String(body?.policyVersionId||''));if(!version||version.status!=='active')return respond(409,{code:'ACTIVE_POLICY_REQUIRED',message:'Select the Active smoke policy.'});
  return respond(200,{academicYear:version.academicYear,policyVersionId:version.policyVersionId,scope:'all',facultyAffected:1,assignmentsAffected:3,roleSupervisionAffected:0,changedDoeCount:1,errors:[],warnings:[],rows:[{facultyId:'fac-001',currentDoe:40,nextDoe:42,difference:2}]});
 }
 if(verb==='POST'&&path==='/__doe-smoke/api/doe/recalculate'){
  const version=state.versions.get(String(body?.policyVersionId||''));if(!version||version.status!=='active')return respond(409,{code:'ACTIVE_POLICY_REQUIRED',message:'Select the Active smoke policy.'});
  const batchId=`smoke-recalc-${state.nextBatch++}`;state.audits.push({policyVersionId:version.policyVersionId,academicYear:version.academicYear,action:'recalculation_completed',entityType:'recalculation',entityId:batchId,changedAt:'2026-09-20T04:06:00Z',changedByName:'Browser Smoke Owner'});
  return respond(200,{batchId,status:'completed',completedRows:3,totalRows:3,resumeFrom:3});
 }
 return null;
}
async function readSmokeJson(req){
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Error('Browser smoke request body is too large.');chunks.push(chunk)}
 if(!chunks.length)return{};
 const raw=Buffer.concat(chunks).toString('utf8').trim();if(!raw)return{};
 try{return JSON.parse(raw)}catch{throw Error('Browser smoke request body is not valid JSON.')}
}
function doeSmokeResponse(requestUrl,method='GET'){
 const parsed=new URL(String(requestUrl||'/'),'http://127.0.0.1');
 if(!parsed.pathname.startsWith('/__doe-smoke/api/doe/'))return null;
 if(String(method||'GET').toUpperCase()!=='GET')return{statusCode:405,body:{code:'SMOKE_READ_ONLY',message:'DOE browser smoke endpoint is read-only.'}};
 const year=String(parsed.searchParams.get('academicYear')||'2026-27');
 const reference={title:'UCVM Workload Guidelines',section:'6.4',table:'Table 3',page:5};
 const roleAssignment={assignmentFactId:'role-smoke-hicc',roleType:'HICC',courseCode:'VTMD 204',subjectKey:'',resultDoe:12,status:'calculated',ruleKey:'role.hicc',ruleId:'rule-hicc-smoke',reference};
 const summary={
  facultyId:'browser-smoke-faculty',displayName:'Browser Smoke Faculty',academicYear:year,policyVersionId:'ucvm-workload-smoke-v1',status:'calculated',
  lastCalculatedAt:'2026-09-20T01:00:00Z',target:{effectiveTargetDoe:40,overrideDoe:null,overrideReason:'',source:'contract'},
  roleAssignmentCount:1,roleAssignments:[roleAssignment],teachingLineCount:1,supervisionLineCount:0,adjustmentLineCount:0,serverFactCount:2,unratedLineCount:0,missingMappingCount:0,issueCount:0,issueCodes:[],
  scheduledTeachingDoe:28,roleDoe:12,rawSupervisionDoe:0,appliedSupervisionDoe:0,adjustmentDoe:0,assignedTeachingDoe:40,effectiveTargetDoe:40,remainingDoe:0
 };
 const explainSummary={...summary,facultyId:'fac-001',displayName:'Avery Lindqvist'};
 const mappingSummary={
  facultyId:'browser-smoke-mapping',displayName:'Browser Smoke Mapping',academicYear:year,policyVersionId:'ucvm-workload-smoke-v1',status:'needs_review',
  lastCalculatedAt:'2026-09-20T01:00:00Z',target:{effectiveTargetDoe:30,overrideDoe:null,overrideReason:'',source:'contract'},
  roleAssignmentCount:1,roleAssignments:[],teachingLineCount:0,supervisionLineCount:0,adjustmentLineCount:0,serverFactCount:1,unratedLineCount:1,missingMappingCount:1,issueCount:1,issueCodes:['COURSE_MAPPING_REQUIRED'],
  scheduledTeachingDoe:null,roleDoe:null,rawSupervisionDoe:0,appliedSupervisionDoe:0,adjustmentDoe:0,assignedTeachingDoe:null,effectiveTargetDoe:30,remainingDoe:null
 };
 const worksheet={
  facultyId:summary.facultyId,displayName:summary.displayName,academicYear:year,policyVersionId:summary.policyVersionId,status:'calculated',lastCalculatedAt:summary.lastCalculatedAt,
  target:{effectiveTargetDoe:40,overrideDoe:null,overrideReason:'',source:'contract'},reserve:{initialTraineeReserve:0,rawSupervisionDoe:0,appliedSupervision:0,unappliedSupervision:0},
  totals:{scheduledTeachingDoe:28,roleDoe:12,rawSupervisionDoe:0,appliedSupervisionDoe:0,adjustmentDoe:0,assignedTeachingDoe:40,effectiveTargetDoe:40,remainingDoe:0},
  sections:{scheduledTeaching:{subtotal:28},roles:{subtotal:12},supervision:{rawSubtotal:0,appliedSubtotal:0},adjustments:{subtotal:0}},errors:[],
  lines:[
   {lineId:'session-smoke--assignment-smoke',category:'teaching',sourceEntityType:'session_assignment',sourceEntityId:'session-smoke',label:'Browser Smoke Lecture',calculationText:'2 h × 14.00% DOE/h = 28.00%',resultDoe:28,status:'calculated',policyVersionId:summary.policyVersionId,ruleId:'rule-lecture-smoke',ruleKey:'teaching.lecture',reference,calculationId:'calc-smoke-lecture',calculatedAt:'2026-09-20T01:00:00Z',explanation:{rule:{name:'Lecture standard rate',calculationMode:'rate',category:'teaching'},facts:{activityType:'Lecture',teachingRole:'Primary Instructor',courseCode:'VETM 301'},inputs:{hours:2},parameters:{rate:14},trigger:'session_assignment',source:'active_policy'}},
   {lineId:'role-smoke-hicc',category:'role',sourceEntityType:'doe_assignment',sourceEntityId:'role-smoke-hicc',assignmentFactId:'role-smoke-hicc',roleType:'HICC',courseCode:'VTMD 204',label:'HICC · VTMD 204',calculationText:'Rule Book role assignment',resultDoe:12,status:'calculated',policyVersionId:summary.policyVersionId,ruleId:'rule-hicc-smoke',ruleKey:'role.hicc',reference,calculationId:'calc-smoke-hicc'}
  ]
 };
 const explainWorksheet={...worksheet,facultyId:'fac-001',displayName:'Avery Lindqvist'};
 if(parsed.pathname==='/__doe-smoke/api/doe/list')return{statusCode:200,body:[summary,mappingSummary,explainSummary]};
 if(parsed.pathname==='/__doe-smoke/api/doe/policies')return{statusCode:200,body:[]};
 if(parsed.pathname==='/__doe-smoke/api/doe/faculty/browser-smoke-faculty/role-assignments')return{statusCode:200,body:[{...roleAssignment,academicYear:year,facultyId:summary.facultyId,active:true,doeCredit:12,doeRuleKey:roleAssignment.ruleKey,doeRuleId:roleAssignment.ruleId}]};
 if(parsed.pathname==='/__doe-smoke/api/doe/faculty/browser-smoke-faculty/worksheet')return{statusCode:200,body:worksheet};
 if(parsed.pathname==='/__doe-smoke/api/doe/faculty/fac-001/worksheet')return{statusCode:200,body:explainWorksheet};
 return{statusCode:404,body:{code:'SMOKE_ROUTE_NOT_FOUND',message:'Unsupported DOE browser smoke route.'}};
}
function createStaticServer(siteRoot=site){
 const rulebookState=createRulebookSmokeState();
 return http.createServer(async(req,res)=>{
  try{
   const method=String(req.method||'GET').toUpperCase(),body=method==='GET'||method==='HEAD'?{}:await readSmokeJson(req);
   const rulebook=doeRulebookSmokeResponse(rulebookState,req.url||'/',method,body);
   if(rulebook){res.writeHead(rulebook.statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(rulebook.body));return}
   const smoke=doeSmokeResponse(req.url||'/',method);
   if(smoke){res.writeHead(smoke.statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(smoke.body));return}
   const filename=safeStaticPath(siteRoot,req.url||'/');
   if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404,{'content-type':'text/plain'});res.end('Not found');return}
   res.writeHead(200,{'content-type':contentType(filename),'cache-control':'no-store'});
   fs.createReadStream(filename).pipe(res);
  }catch(error){res.writeHead(500,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({code:'SMOKE_SERVER_ERROR',message:error?.message||String(error)}))}
 });
}
function chromeCandidates(env=process.env){
 return[env.CHROME_PATH,env.CHROME_BIN,'google-chrome-stable','google-chrome','chromium','chromium-browser'].filter((value,index,all)=>value&&all.indexOf(value)===index);
}
function findChrome(env=process.env){
 for(const candidate of chromeCandidates(env)){
  const result=spawnSync(candidate,['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(!result.error&&result.status===0)return candidate;
 }
 return'';
}
async function waitForDebugPort(userDataDir,child,timeoutMs=15000){
 const active=path.join(userDataDir,'DevToolsActivePort'),started=Date.now();
 while(Date.now()-started<timeoutMs){
  if(child.exitCode!==null)throw Error(`Chrome exited before DevTools became available (exit ${child.exitCode}).`);
  if(fs.existsSync(active)){
   const [port]=fs.readFileSync(active,'utf8').trim().split(/\r?\n/);
   if(/^\d+$/.test(port))return Number(port);
  }
  await wait(100);
 }
 throw Error('Timed out waiting for Chrome DevTools port.');
}
async function newTarget(port){
 const response=await fetch(`http://127.0.0.1:${port}/json/new?about%3Ablank`,{method:'PUT'});
 if(!response.ok)throw Error(`Chrome target creation failed: HTTP ${response.status}`);
 return response.json();
}
async function closeTarget(port,id){
 try{await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(id)}`)}catch{}
}
async function connectCdp(url){
 if(typeof WebSocket!=='function')throw Error('This browser smoke test requires the Node.js WebSocket global (Node 22+).');
 const ws=new WebSocket(url),pending=new Map(),listeners=new Set();
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Timed out opening Chrome DevTools WebSocket.')),10000);
  ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
  ws.addEventListener('error',event=>{clearTimeout(timer);reject(Error(`Chrome DevTools WebSocket error: ${event?.message||'unknown'}`))},{once:true});
 });
 ws.addEventListener('message',event=>{
  let message;
  try{message=JSON.parse(typeof event.data==='string'?event.data:Buffer.from(event.data).toString('utf8'))}catch{return}
  if(message.id&&pending.has(message.id)){
   const item=pending.get(message.id);pending.delete(message.id);clearTimeout(item.timer);
   if(message.error)item.reject(Error(`${item.method}: ${message.error.message||JSON.stringify(message.error)}`));else item.resolve(message.result||{});
   return;
  }
  for(const listener of listeners)listener(message);
 });
 let nextId=0;
 function send(method,params={}){
  const id=++nextId;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(id);const detail=method==='Runtime.evaluate'&&params?.expression?` · ${String(params.expression).replace(/\s+/g,' ').slice(0,220)}`:'';reject(Error(`Chrome DevTools command timed out: ${method}${detail}`))},15000);
   pending.set(id,{resolve,reject,timer,method});
   ws.send(JSON.stringify({id,method,params}));
  });
 }
 function on(listener){listeners.add(listener);return()=>listeners.delete(listener)}
 function close(){try{ws.close()}catch{}}
 return{send,on,close};
}
function waitForEvent(cdp,method,timeoutMs=20000){
 return new Promise((resolve,reject)=>{
  let off=()=>{};
  const timer=setTimeout(()=>{off();reject(Error(`Timed out waiting for Chrome event: ${method}`))},timeoutMs);
  off=cdp.on(message=>{if(message.method!==method)return;clearTimeout(timer);off();resolve(message.params||{})});
 });
}
function exceptionText(details={}){
 const exception=details.exception||{};
 return String(exception.description||exception.value||details.text||'Unknown browser exception');
}
function localAssetFailure(url,origin){
 try{
  const parsed=new URL(url);
  if(parsed.origin!==origin)return false;
  return /\.(?:html|js|css|json)(?:$|[?#])/i.test(parsed.pathname);
 }catch{return false}
}
async function evaluateState(cdp){
 const expression=`(()=>({
  title:document.title,
  ready:document.readyState,
  href:location.href,
  emulator:window.UCVM_FIREBASE_EMULATOR===true,
  demo:window.UCVM_FRONTEND_DEMO_MODE===true,
  demoBackend:window.UCVM_PAGES_DEMO?.backend||'',
  demoDoeAuthoritative:window.UCVM_PAGES_DEMO?.doeAuthoritative,
  demoUid:window.firebase?.auth?.().currentUser?.uid||'',
  demoToolbar:!!document.getElementById('ucvm-pages-demo-toolbar'),
  demoToolbarTitle:(document.querySelector('#ucvm-pages-demo-toolbar .demo-title')?.textContent||'').trim(),
  demoSelectedRole:(document.querySelector('#ucvm-pages-demo-toolbar select option:checked')?.textContent||'').trim(),
  reconciliationTab:!!document.getElementById('doe-reconciliation-tab'),
  hasFirebase:typeof window.firebase==='object',
  hasUcvm:typeof window.UCVM==='object',
  runtimeError:(document.getElementById('runtime-error')?.textContent||'').trim()
 }))()`;
 for(let attempt=0;attempt<20;attempt++){
  try{
   const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
   if(result.exceptionDetails)throw Error(exceptionText(result.exceptionDetails));
   if(result.result?.value)return result.result.value;
  }catch(error){if(attempt===19)throw error}
  await wait(150);
 }
 throw Error('Could not evaluate browser state.');
}
async function inspectPage({debugPort,origin,expectation,bundlePaths,demoMode=false}){
 const target=await newTarget(debugPort),cdp=await connectCdp(target.webSocketDebuggerUrl);
 const requests=new Map(),requested=[],exceptions=[],assetFailures=[],cloudRequests=[];
 const off=cdp.on(message=>{
  const params=message.params||{};
  if(message.method==='Runtime.exceptionThrown')exceptions.push(exceptionText(params.exceptionDetails));
  if(message.method==='Network.requestWillBeSent'){
   const url=params.request?.url||'';requests.set(params.requestId,url);requested.push(url);
   try{if(CLOUD_FIREBASE_HOSTS.has(new URL(url).hostname))cloudRequests.push(url)}catch{}
  }
  if(message.method==='Network.loadingFailed'){
   const url=requests.get(params.requestId)||'';
   if(localAssetFailure(url,origin))assetFailures.push(`${url}: ${params.errorText||'loading failed'}`);
  }
  if(message.method==='Network.responseReceived'){
   const response=params.response||{},url=response.url||requests.get(params.requestId)||'';
   if(Number(response.status)>=400&&localAssetFailure(url,origin))assetFailures.push(`${url}: HTTP ${response.status}`);
  }
 });
 try{
  await Promise.all([cdp.send('Runtime.enable'),cdp.send('Page.enable'),cdp.send('Network.enable')]);
  const load=waitForEvent(cdp,'Page.loadEventFired');
  const navigation=await cdp.send('Page.navigate',{url:`${origin}/${expectation.page}`});
  if(navigation.errorText)throw Error(`${expectation.page}: navigation failed: ${navigation.errorText}`);
  await load;
  await wait(1800);
  const state=await evaluateState(cdp);
  const requiredAsset=bundlePaths.get(expectation.requiredLogical);
  if(!requiredAsset)throw Error(`${expectation.page}: missing generated bundle mapping for ${expectation.requiredLogical}`);
  const requiredUrl=`${origin}/${requiredAsset}`;
  const requestedRequired=requested.some(url=>url.split(/[?#]/)[0]===requiredUrl);
  const problems=[];
  if(!expectation.titles.includes(state.title))problems.push(`unexpected title "${state.title}"`);
  if(state.ready!=='complete')problems.push(`document.readyState=${state.ready}`);
  if(demoMode){
   if(!state.demo)problems.push('Pages Frontend Demo mode is not enabled');
   if(state.demoBackend!=='browser-memory')problems.push(`unexpected demo backend "${state.demoBackend}"`);
   if(state.demoDoeAuthoritative!==false)problems.push('Pages demo must keep authoritative DOE disabled');
   if(state.demoUid!=='uid-developer')problems.push(`Pages demo must default to Developer, got "${state.demoUid}"`);
   if(!state.demoToolbar)problems.push('Pages demo toolbar is missing');
   if(state.demoToolbarTitle!=='DEMO ROLE TESTER')problems.push(`unexpected demo role tester title "${state.demoToolbarTitle}"`);
   if(!/Developer/i.test(state.demoSelectedRole))problems.push(`Developer is not selected in demo role tester: "${state.demoSelectedRole}"`);
  }else if(!state.emulator)problems.push('Firebase emulator mode is not enabled');
  if(!state.hasFirebase)problems.push('Firebase SDK global is missing');
  if(!state.hasUcvm)problems.push('UCVM shared runtime global is missing');
  if(state.runtimeError)problems.push(state.runtimeError);
  if(!requestedRequired)problems.push(`required generated asset was not requested: ${requiredAsset}`);
  if(exceptions.length)problems.push(`uncaught browser exception(s): ${exceptions.join(' | ')}`);
  if(assetFailures.length)problems.push(`local asset failure(s): ${assetFailures.join(' | ')}`);
  if(cloudRequests.length)problems.push(`unexpected Firebase cloud request(s) in ${demoMode?'Pages demo':'emulator smoke'}: ${cloudRequests.join(' | ')}`);
  if(problems.length)throw Error(`${expectation.page}: ${problems.join('; ')}`);
  if(demoMode&&expectation.page==='faculty-admin.html'){
   if(!state.reconciliationTab)throw Error('faculty-admin.html: DOE Reconciliation tab is missing in Frontend Demo');
   const open=await cdp.send('Runtime.evaluate',{expression:`(()=>{document.getElementById('doe-reconciliation-tab')?.click();return true})()`,returnByValue:true});
   if(open.exceptionDetails)throw Error(`faculty-admin.html: could not open DOE Reconciliation: ${exceptionText(open.exceptionDetails)}`);
   await waitForCondition(cdp,`(()=>{const body=document.getElementById('doe-reconciliation-body'),note=document.querySelector('#doe-reconciliation-view .doe-note');return body&&body.querySelectorAll('tr').length>0&&/Frontend Demo reconciliation/i.test(note?.textContent||'')&&!/DOE data is not configured/i.test(body.textContent||'')})()`,'Frontend Demo DOE reconciliation',12000);
   const recon=await cdp.send('Runtime.evaluate',{expression:`(()=>({rows:document.querySelectorAll('#doe-reconciliation-body tr').length,queue:document.querySelectorAll('#doe-reconciliation-queue-body tr').length,text:(document.getElementById('doe-reconciliation-body')?.textContent||'').trim()}))()`,returnByValue:true});
   if(recon.exceptionDetails)throw Error(`faculty-admin.html: DOE Reconciliation inspection failed: ${exceptionText(recon.exceptionDetails)}`);
   if(Number(recon.result?.value?.rows||0)<1)throw Error('faculty-admin.html: DOE Reconciliation rendered no demo rows');
   const reconciliationText=String(recon.result?.value?.text||'');
   for(const label of ['Matched','DOE Difference','Missing Mapping','Needs Review','Legacy Only','Server Only'])if(!reconciliationText.includes(label))throw Error('faculty-admin.html: DOE Reconciliation demo is missing status '+label);
   await verifyDemoRoleSwitching(cdp);
  }
  return{page:expectation.page,finalUrl:state.href,title:state.title,requiredAsset,requests:requested.filter(url=>url.startsWith(origin)).length};
 }finally{
  off();cdp.close();await closeTarget(debugPort,target.id);
 }
}
async function waitForCondition(cdp,expression,label,timeoutMs=12000){
 const started=Date.now();
 while(Date.now()-started<timeoutMs){
  const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(`${label}: ${exceptionText(result.exceptionDetails)}`);
  if(result.result?.value)return result.result.value;
  await wait(200);
 }
 throw Error(`Timed out waiting for authenticated browser state: ${label}`);
}
async function switchDemoRole(cdp,uid,label){
 const load=waitForEvent(cdp,'Page.loadEventFired');
 const expression="(()=>{const select=document.querySelector('#ucvm-pages-demo-toolbar select');if(!select)return{ok:false,reason:'toolbar select missing'};const option=[...select.options].find(item=>item.value==="+JSON.stringify(uid)+");if(!option)return{ok:false,reason:'role option missing'};select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));return{ok:true,uid:option.value,text:option.textContent}})()";
 const change=await cdp.send('Runtime.evaluate',{expression,returnByValue:true});
 if(change.exceptionDetails)throw Error('faculty-admin.html: '+label+' role selection failed: '+exceptionText(change.exceptionDetails));
 if(!change.result?.value?.ok)throw Error('faculty-admin.html: '+label+' role selection failed: '+(change.result?.value?.reason||'unknown error'));
 await load;
 await wait(350);
 return change.result.value;
}
async function verifyDemoRoleSwitching(cdp){
 await switchDemoRole(cdp,'uid-fac-001','Faculty');
 await waitForCondition(cdp,"(()=>document.body.classList.contains('faculty-self-mode')&&window.firebase?.auth?.().currentUser?.uid==='uid-fac-001'&&/Faculty/i.test(document.querySelector('#ucvm-pages-demo-toolbar select option:checked')?.textContent||'')&&document.getElementById('user-management-link')?.classList.contains('hidden'))()",'Faculty demo role permissions',12000);
 await switchDemoRole(cdp,'uid-developer','Developer');
 await waitForCondition(cdp,"(()=>!document.body.classList.contains('faculty-self-mode')&&window.firebase?.auth?.().currentUser?.uid==='uid-developer'&&/Developer/i.test(document.querySelector('#ucvm-pages-demo-toolbar select option:checked')?.textContent||'')&&!document.getElementById('user-management-link')?.classList.contains('hidden')&&!!document.getElementById('doe-reconciliation-tab'))()",'Developer demo role permissions',12000);
}
async function authenticatedOwnerSmoke({debugPort,origin,fixture,bundlePaths}){
 const target=await newTarget(debugPort),cdp=await connectCdp(target.webSocketDebuggerUrl);
 const requests=new Map(),exceptions=[],assetFailures=[],cloudRequests=[];
 const off=cdp.on(message=>{
  const params=message.params||{};
  if(message.method==='Runtime.exceptionThrown')exceptions.push(exceptionText(params.exceptionDetails));
  if(message.method==='Network.requestWillBeSent'){
   const url=params.request?.url||'';requests.set(params.requestId,url);
   try{if(CLOUD_FIREBASE_HOSTS.has(new URL(url).hostname))cloudRequests.push(url)}catch{}
  }
  if(message.method==='Network.loadingFailed'){
   const url=requests.get(params.requestId)||'';
   if(localAssetFailure(url,origin))assetFailures.push(`${url}: ${params.errorText||'loading failed'}`);
  }
  if(message.method==='Network.responseReceived'){
   const response=params.response||{},url=response.url||requests.get(params.requestId)||'';
   if(Number(response.status)>=400&&localAssetFailure(url,origin))assetFailures.push(`${url}: HTTP ${response.status}`);
  }
 });
 const navigate=async page=>{
  const load=waitForEvent(cdp,'Page.loadEventFired');
  const navigation=await cdp.send('Page.navigate',{url:`${origin}/${page}`});
  if(navigation.errorText)throw Error(`${page}: navigation failed: ${navigation.errorText}`);
  await load;await wait(400);
 };
 try{
  await Promise.all([cdp.send('Runtime.enable'),cdp.send('Page.enable'),cdp.send('Network.enable')]);
  await navigate('index.html');
  const loginExpression=`(async()=>{sessionStorage.setItem('ucvm-admin-default-landing',${JSON.stringify(fixture.uid)});const credential=await firebase.auth().signInWithEmailAndPassword(${JSON.stringify(fixture.email)},${JSON.stringify(fixture.password)});return{uid:credential.user.uid,email:credential.user.email}})()`;
  const login=await cdp.send('Runtime.evaluate',{expression:loginExpression,returnByValue:true,awaitPromise:true});
  if(login.exceptionDetails)throw Error(`owner sign-in failed: ${exceptionText(login.exceptionDetails)}`);
  if(login.result?.value?.uid!==fixture.uid)throw Error('Authenticated smoke signed in an unexpected UID.');
  await waitForCondition(cdp,`(()=>firebase.auth().currentUser?.uid===${JSON.stringify(fixture.uid)}&&!document.body.classList.contains('auth-locked')&&!document.getElementById('manage-users-btn')?.classList.contains('hidden'))()`,'Timetable owner access');

  const afcAsset=bundlePaths.get('bundles/afc-pdf.lazy.bundle.js');
  const approvalAsset=bundlePaths.get('bundles/approval-workflow.lazy.bundle.js');
  if(!afcAsset||!approvalAsset)throw Error('Authenticated smoke is missing hashed lazy bundle mappings.');
  const afcLazy=await cdp.send('Runtime.evaluate',{
   expression:`(async()=>{const api=await window.UCVM_ASSETS.ensureAfcPdf();const expected=${JSON.stringify(afcAsset)};const scripts=[...document.scripts].filter(script=>String(script.src||'').endsWith('/'+expected));const bytes=await api.render({facultySnapshot:{ucid:'f1'},facultyId:'f1',facultyName:'Browser Smoke Owner',workDays:1,startDate:'2026-10-01',endDate:'2026-10-01',reason:'vacation',contactAddress:'2500 University Drive NW',contactPhone:'403-555-1212',termsVersion:'ucvm-afc-terms-page2-v1',applicantSignature:{mode:'typed',name:'Browser Smoke Owner',uid:${JSON.stringify(fixture.uid)},email:${JSON.stringify(fixture.email)},account:${JSON.stringify(fixture.email)},signedAt:new Date().toISOString(),fingerprint:'browser-smoke'}});const doc=await PDFLib.PDFDocument.load(bytes);return{ok:!!api,values:!!window.UCVM_AFC_FORM_VALUES,pdf:!!window.UCVM_AFC_PDF,scripts:scripts.length,pages:doc.getPageCount()}})()`,
   returnByValue:true,
   awaitPromise:true
  });
  if(afcLazy.exceptionDetails)throw Error(`AFC lazy bundle failed: ${exceptionText(afcLazy.exceptionDetails)}`);
  if(!afcLazy.result?.value?.ok||!afcLazy.result?.value?.values||!afcLazy.result?.value?.pdf)throw Error('AFC lazy bundle did not expose the expected runtime globals.');
  if(afcLazy.result?.value?.scripts!==1)throw Error(`AFC hashed lazy bundle loaded ${afcLazy.result?.value?.scripts||0} times; expected exactly once.`);if(afcLazy.result?.value?.pages!==1)throw Error(`Approved AFC PDF contains ${afcLazy.result?.value?.pages||0} pages; expected exactly one form page.`);

  const approvalLazy=await cdp.send('Runtime.evaluate',{
   expression:`(async()=>{await window.UCVM_ASSETS.ensureApprovalWorkflow();const expected=${JSON.stringify(approvalAsset)};const scripts=[...document.scripts].filter(script=>String(script.src||'').endsWith('/'+expected));return{handoff:window.UCVM_SAFE_SWAP_HANDOFF?.mode||'',scripts:scripts.length}})()`,
   returnByValue:true,
   awaitPromise:true
  });
  if(approvalLazy.exceptionDetails)throw Error(`Approval lazy bundle failed: ${exceptionText(approvalLazy.exceptionDetails)}`);
  if(approvalLazy.result?.value?.handoff!=='direct-session-modal')throw Error('Approval lazy bundle did not execute the compatibility handoff first.');
  if(approvalLazy.result?.value?.scripts!==1)throw Error(`Approval lazy bundle loaded ${approvalLazy.result?.value?.scripts||0} times; expected exactly once.`);

  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const mockBase=location.origin+'/__doe-smoke';window.UCVM_CONFIG={...(window.UCVM_CONFIG||{}),doeApiBaseUrl:mockBase};let explicit='';Object.defineProperty(window,'UCVM_DOE_API_BASE_URL',{configurable:true,get(){return explicit||mockBase},set(value){const next=String(value||'').trim();if(next)explicit=next}})})()`});
  await navigate('faculty-admin.html');
  await waitForCondition(cdp,`(()=>document.getElementById('auth-gate')?.classList.contains('hidden')===true&&document.getElementById('admin-chip')?.textContent.includes('Browser Smoke Owner'))()`,'Faculty Dashboard owner access');
  await waitForCondition(cdp,`(()=>!!document.getElementById('doe-list-tab')&&!!document.querySelector('script[data-ucvm-faculty-admin-enhancements]'))()`,'DOE List deferred enhancement');
  const doeNavigation=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const tab=document.getElementById('doe-list-tab'),list=document.getElementById('doe-list-view'),rules=document.getElementById('doe-rules-view');tab?.click();return{tab:!!tab,listVisible:!!list&&!list.classList.contains('hidden'),rulesHidden:!!rules&&rules.classList.contains('hidden')}})()`,
   returnByValue:true
  });
  if(doeNavigation.exceptionDetails)throw Error(`DOE List navigation smoke failed: ${exceptionText(doeNavigation.exceptionDetails)}`);
  if(!doeNavigation.result?.value?.tab||!doeNavigation.result?.value?.listVisible||!doeNavigation.result?.value?.rulesHidden)throw Error('DOE List deferred enhancement did not own the Faculty Dashboard panel state.');
  await waitForCondition(cdp,`(()=>{const text=document.getElementById('doe-list-body')?.textContent||'';return text.includes('Browser Smoke Faculty')&&text.includes('40.00%')&&text.includes('ucvm-workload-smoke-v1')})()`,'DOE mocked server summary render');
  const doeWorksheet=await cdp.send('Runtime.evaluate',{
   expression:`(async()=>{const worksheet=await window.UCVM_DOE_API.getFacultyWorksheet('browser-smoke-faculty','2026-27');const host=document.createElement('div');host.id='doe-smoke-worksheet-render';host.innerHTML=window.UCVM_DOE_WORKSHEET_VIEW.worksheetHtml(worksheet);document.getElementById('doe-list-view')?.appendChild(host);return{configured:window.UCVM_DOE_API.isConfigured(),base:window.UCVM_DOE_API.baseUrl(),text:host.textContent}})()`,
   returnByValue:true,awaitPromise:true
  });
  if(doeWorksheet.exceptionDetails)throw Error(`DOE worksheet render smoke failed: ${exceptionText(doeWorksheet.exceptionDetails)}`);
  const rendered=doeWorksheet.result?.value||{};
  if(!rendered.configured||!String(rendered.base||'').includes('/__doe-smoke'))throw Error('DOE browser smoke did not use the local read-only server endpoint.');
  if(!String(rendered.text||'').includes('Teaching DOE · server worksheet')||!String(rendered.text||'').includes('40.00%')||!String(rendered.text||'').includes('calc-smoke-lecture'))throw Error('DOE browser smoke did not render authoritative Worksheet totals and calculation evidence.');

  const reconciliationNavigation=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const tab=document.getElementById('doe-reconciliation-tab'),view=document.getElementById('doe-reconciliation-view');tab?.click();return{tab:!!tab,visible:!!view&&!view.classList.contains('hidden')}})()`,
   returnByValue:true
  });
  if(reconciliationNavigation.exceptionDetails)throw Error(`DOE Reconciliation navigation smoke failed: ${exceptionText(reconciliationNavigation.exceptionDetails)}`);
  if(!reconciliationNavigation.result?.value?.tab||!reconciliationNavigation.result?.value?.visible)throw Error('DOE Reconciliation tab did not become visible.');
  await waitForCondition(cdp,`(()=>{const queue=document.getElementById('doe-reconciliation-queue-body')?.textContent||'',all=document.getElementById('doe-reconciliation-body')?.textContent||'',summary=document.getElementById('doe-reconciliation-summary')?.textContent||'';return queue.includes('Browser Smoke Mapping')&&queue.includes('Missing Mapping')&&queue.includes('COURSE MAPPING REQUIRED')&&all.includes('Browser Smoke Faculty')&&summary.includes('Action queue')})()`,'DOE Reconciliation work queue render');

  const lookupOpen=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const tab=[...document.querySelectorAll('.tab')].find(node=>node.dataset.tab==='lookup');tab?.click();for(const id of ['lookup-search','filter-campus','filter-rank']){const node=document.getElementById(id);if(!node)continue;node.value='';node.dispatchEvent(new Event(id==='lookup-search'?'input':'change',{bubbles:true}))}return{tab:!!tab}})()`,
   returnByValue:true
  });
  if(lookupOpen.exceptionDetails)throw Error(`DOE explanation Lookup navigation failed: ${exceptionText(lookupOpen.exceptionDetails)}`);
  if(!lookupOpen.result?.value?.tab)throw Error('DOE explanation smoke could not find the Faculty Lookup tab.');
  try{
   await waitForCondition(cdp,`(()=>!!document.querySelector('.person-row[data-id="fac-001"]'))()`,'DOE explanation Faculty row');
  }catch(error){
   const diagnostic=await cdp.send('Runtime.evaluate',{expression:`(()=>({tab:[...document.querySelectorAll('.tab')].find(node=>node.classList.contains('active'))?.dataset.tab||'',ids:[...document.querySelectorAll('.person-row')].slice(0,30).map(node=>node.dataset.id),profile:(document.getElementById('profile-pane')?.textContent||'').slice(0,500)}))()`,returnByValue:true});
   throw Error(`${error.message}; lookup diagnostic: ${JSON.stringify(diagnostic.result?.value||{})}`);
  }
  const facultyClick=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const row=document.querySelector('.person-row[data-id="fac-001"]');row?.click();return{row:!!row,active:row?.classList.contains('active')||false}})()`,
   returnByValue:true
  });
  if(facultyClick.exceptionDetails)throw Error(`DOE explanation Faculty selection failed: ${exceptionText(facultyClick.exceptionDetails)}`);
  if(!facultyClick.result?.value?.row)throw Error('DOE explanation smoke could not select fac-001 from Faculty Lookup.');
  try{
   await waitForCondition(cdp,`(()=>!!document.querySelector('#profile-pane [data-doe-explain-line="session-smoke--assignment-smoke"]'))()`,'DOE explanation trigger render');
  }catch(error){
   const diagnostic=await cdp.send('Runtime.evaluate',{expression:`(()=>({activeId:document.querySelector('.person-row.active')?.dataset.id||'',profile:(document.getElementById('profile-pane')?.textContent||'').slice(0,1200),buttons:[...document.querySelectorAll('#profile-pane [data-doe-explain-line]')].map(node=>node.dataset.doeExplainLine)}))()`,returnByValue:true});
   throw Error(`${error.message}; explanation diagnostic: ${JSON.stringify(diagnostic.result?.value||{})}`);
  }
  const explainClick=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const button=document.querySelector('#profile-pane [data-doe-explain-line="session-smoke--assignment-smoke"]');button?.click();const modal=document.getElementById('doe-explain-modal'),body=document.getElementById('doe-explain-body');return{button:!!button,visible:!!modal&&!modal.classList.contains('hidden'),text:body?.textContent||''}})()`,
   returnByValue:true
  });
  if(explainClick.exceptionDetails)throw Error(`DOE explanation modal click failed: ${exceptionText(explainClick.exceptionDetails)}`);
  const explanation=explainClick.result?.value||{};
  if(!explanation.button||!explanation.visible)throw Error('DOE explanation modal did not open from the Faculty profile.');
  for(const required of ['Lecture standard rate','Primary Instructor','Hours','2','Rate','14','ucvm-workload-smoke-v1','teaching.lecture','calc-smoke-lecture','UCVM Workload Guidelines']){
   if(!String(explanation.text||'').includes(required))throw Error(`DOE explanation modal render missing "${required}".`);
  }

  const rulebookOpen=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{window.confirm=()=>true;const tab=[...document.querySelectorAll('.tab')].find(node=>node.dataset.tab==='doe-rules');tab?.click();return{tab:!!tab}})()`,
   returnByValue:true
  });
  if(rulebookOpen.exceptionDetails)throw Error(`Rule Book navigation failed: ${exceptionText(rulebookOpen.exceptionDetails)}`);
  if(!rulebookOpen.result?.value?.tab)throw Error('Rule Book smoke could not find the DOE Rules tab.');
  await waitForCondition(cdp,`(()=>{const status=document.getElementById('doe-policy-status')?.textContent||'',version=document.getElementById('doe-policy-version')?.value||'',clone=document.getElementById('doe-clone-draft');return status.includes('ACTIVE')&&version==='smoke-policy-2026-27-v1'&&clone&&!clone.disabled})()`,'Rule Book Active policy loaded');
  process.stdout.write('Rule Book smoke checkpoint: active policy loaded.\n');

  const cloneDraft=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{document.getElementById('doe-clone-draft')?.click();return true})()`,
   returnByValue:true
  });
  if(cloneDraft.exceptionDetails)throw Error(`Rule Book clone failed: ${exceptionText(cloneDraft.exceptionDetails)}`);
  await waitForCondition(cdp,`(()=>{const status=document.getElementById('doe-policy-status')?.textContent||'',version=document.getElementById('doe-policy-version')?.value||'',validate=document.getElementById('doe-validate'),preview=document.getElementById('doe-preview'),publish=document.getElementById('doe-publish');return status.includes('DRAFT')&&status.includes('revision 0')&&version==='smoke-policy-2026-27-v2'&&validate&&!validate.disabled&&preview?.disabled===true&&publish?.disabled===true})()`,'Rule Book Draft loaded');
  process.stdout.write('Rule Book smoke checkpoint: Draft cloned.\n');

  const openRule=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const button=document.querySelector('.doe-edit-rule[data-rule-id="smoke-rule-lecture"]');button?.click();return{button:!!button,visible:!document.getElementById('doe-rule-editor')?.classList.contains('hidden')}})()`,
   returnByValue:true
  });
  if(openRule.exceptionDetails)throw Error(`Rule Book rule editor failed: ${exceptionText(openRule.exceptionDetails)}`);
  if(!openRule.result?.value?.button||!openRule.result?.value?.visible)throw Error('Rule Book smoke could not open the Draft rule editor.');
  const editRule=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const name=document.getElementById('doe-rule-name'),rate=document.querySelector('#doe-parameter-rows .doe-parameter-value'),review=document.getElementById('doe-rule-review-status');if(name)name.value='Lecture operational smoke rate';if(rate)rate.value='15';if(review)review.value='reviewed';document.getElementById('doe-rule-save')?.click();return{name:!!name,rate:!!rate}})()`,
   returnByValue:true
  });
  if(editRule.exceptionDetails)throw Error(`Rule Book rule save failed: ${exceptionText(editRule.exceptionDetails)}`);
  if(!editRule.result?.value?.name||!editRule.result?.value?.rate)throw Error('Rule Book smoke could not edit the Draft lecture rule.');
  await waitForCondition(cdp,`(()=>{const status=document.getElementById('doe-policy-status')?.textContent||'',modal=document.getElementById('doe-rule-editor'),row=document.querySelector('[data-doe-rule-id="smoke-rule-lecture"]')?.textContent||'';return modal?.classList.contains('hidden')&&status.includes('revision 1')&&row.includes('Lecture operational smoke rate')})()`,'Rule Book Draft rule save');
  process.stdout.write('Rule Book smoke checkpoint: rule saved.\n');

  const mappingPanel=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const tab=[...document.querySelectorAll('[data-doe-rulebook-tab]')].find(node=>node.dataset.doeRulebookTab==='course-mapping');tab?.click();const panel=document.querySelector('[data-doe-rulebook-panel="course-mapping"]'),add=document.getElementById('doe-add-course-mapping');const panelVisible=!!panel&&!panel.classList.contains('hidden'),addEnabled=!!add&&!add.disabled;if(panelVisible&&addEnabled)add.click();return{tab:!!tab,panelVisible,addEnabled,visible:!document.getElementById('doe-mapping-editor')?.classList.contains('hidden')}})()`,
   returnByValue:true
  });
  if(mappingPanel.exceptionDetails)throw Error(`Rule Book mapping editor failed: ${exceptionText(mappingPanel.exceptionDetails)}`);
  if(!mappingPanel.result?.value?.tab||!mappingPanel.result?.value?.visible)throw Error('Rule Book smoke could not open the Course Mapping editor.');
  const saveMapping=await cdp.send('Runtime.evaluate',{
   expression:`(()=>{const set=(id,value)=>{const node=document.getElementById(id);if(node)node.value=value;return !!node};const course=set('doe-mapping-course-code','VTMD 999'),units=set('doe-mapping-unit-count','2'),reference=set('doe-mapping-reference-id','ref-smoke'),review=set('doe-mapping-review-status','reviewed');set('doe-mapping-admin-note','Browser smoke mapping');document.getElementById('doe-mapping-save')?.click();return{course,units,reference,review}})()`,
   returnByValue:true
  });
  if(saveMapping.exceptionDetails)throw Error(`Rule Book mapping save failed: ${exceptionText(saveMapping.exceptionDetails)}`);
  if(!Object.values(saveMapping.result?.value||{}).every(Boolean))throw Error('Rule Book smoke could not populate the Course Mapping editor.');
  await waitForCondition(cdp,`(()=>{const status=document.getElementById('doe-policy-status')?.textContent||'',modal=document.getElementById('doe-mapping-editor'),mapping=document.getElementById('doe-course-mapping-body')?.textContent||'',impact=document.getElementById('doe-impact-preview')?.textContent||'',preview=document.getElementById('doe-preview'),publish=document.getElementById('doe-publish');return modal?.classList.contains('hidden')&&status.includes('revision 2')&&mapping.includes('VTMD 999')&&impact.includes('OUTDATED')&&preview?.disabled===true&&publish?.disabled===true})()`,'Rule Book stale gates after edit');
  process.stdout.write('Rule Book smoke checkpoint: mapping saved and stale gates enforced.\n');

  const validateDraft=await cdp.send('Runtime.evaluate',{expression:`(()=>{document.getElementById('doe-validate')?.click();return true})()`,returnByValue:true});
  if(validateDraft.exceptionDetails)throw Error(`Rule Book validation failed: ${exceptionText(validateDraft.exceptionDetails)}`);
  await waitForCondition(cdp,`(()=>{const impact=document.getElementById('doe-impact-preview')?.textContent||'',preview=document.getElementById('doe-preview'),publish=document.getElementById('doe-publish');return impact.includes('Validation is current')&&preview?.disabled===false&&publish?.disabled===true})()`,'Rule Book validation gate');
  process.stdout.write('Rule Book smoke checkpoint: validation current.\n');

  const impactPreview=await cdp.send('Runtime.evaluate',{expression:`(()=>{document.getElementById('doe-preview')?.click();return true})()`,returnByValue:true});
  if(impactPreview.exceptionDetails)throw Error(`Rule Book Impact Preview failed: ${exceptionText(impactPreview.exceptionDetails)}`);
  await waitForCondition(cdp,`(()=>{const impact=document.getElementById('doe-impact-preview')?.textContent||'',publish=document.getElementById('doe-publish');return impact.includes('Impact Preview PASSED')&&impact.includes('Attention queue')&&impact.includes('Increase')&&impact.includes('Largest increase')&&impact.includes('40.00% → 46.00%')&&impact.includes('Review increase')&&publish?.disabled===false})()`,'Rule Book Impact Preview gate');
  process.stdout.write('Rule Book smoke checkpoint: Impact Preview passed.\n');

  const publishDraft=await cdp.send('Runtime.evaluate',{expression:`(()=>{document.getElementById('doe-publish')?.click();return true})()`,returnByValue:true});
  if(publishDraft.exceptionDetails)throw Error(`Rule Book publish failed: ${exceptionText(publishDraft.exceptionDetails)}`);
  await waitForCondition(cdp,`(()=>{const status=document.getElementById('doe-policy-status')?.textContent||'',version=document.getElementById('doe-policy-version')?.value||'',recalculate=document.getElementById('doe-recalculate');return status.includes('ACTIVE')&&version==='smoke-policy-2026-27-v2'&&recalculate?.disabled===false})()`,'Rule Book publish transition');
  process.stdout.write('Rule Book smoke checkpoint: Draft published.\n');

  const recalculate=await cdp.send('Runtime.evaluate',{expression:`(()=>{window.confirm=()=>true;document.getElementById('doe-recalculate')?.click();return true})()`,returnByValue:true});
  if(recalculate.exceptionDetails)throw Error(`Rule Book recalculation failed: ${exceptionText(recalculate.exceptionDetails)}`);
  await waitForCondition(cdp,`(()=>{const text=document.getElementById('doe-recalculate-status')?.textContent||'';return text.includes('Recalculation complete: 3/3')&&text.includes('Derived indexes refreshed')})()`,'Rule Book recalculation dry-run and execution');
  process.stdout.write('Rule Book smoke checkpoint: recalculation completed.\n');

  await navigate('user-management.html');
  await waitForCondition(cdp,`(()=>document.getElementById('content')?.hidden===false&&document.getElementById('accounts')?.hidden===false&&document.getElementById('identity')?.textContent.includes('Browser Smoke Owner'))()`,'User Management owner access');

  await wait(500);
  const problems=[];
  if(exceptions.length)problems.push(`uncaught browser exception(s): ${exceptions.join(' | ')}`);
  if(assetFailures.length)problems.push(`local asset failure(s): ${assetFailures.join(' | ')}`);
  if(cloudRequests.length)problems.push(`unexpected Firebase cloud request(s): ${cloudRequests.join(' | ')}`);
  if(problems.length)throw Error(`authenticated owner smoke: ${problems.join('; ')}`);
  return{pages:['index.html','faculty-admin.html','user-management.html'],uid:fixture.uid};
 }finally{
  off();cdp.close();await closeTarget(debugPort,target.id);
 }
}
async function run(){
 const authenticated=process.argv.includes('--authenticated');
 const demoMode=process.argv.includes('--demo');
 if(authenticated&&demoMode)throw Error('--authenticated and --demo are mutually exclusive smoke modes.');
 if(!fs.existsSync(metadataPath))throw Error('Build .deploy-static before running browser smoke.');
 const bundlePaths=bundlePathMap();
 const authFixture=authenticated?await createAuthenticatedFixture():null;
 const chrome=findChrome();
 if(!chrome)throw Error(`Chrome/Chromium was not found. Tried: ${chromeCandidates().join(', ')}`);
 const server=createStaticServer(site);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const address=server.address(),origin=`http://127.0.0.1:${address.port}`;
 const userDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ucvm-browser-smoke-'));
 let stderr='';
 const child=spawn(chrome,[
  '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  '--no-first-run','--no-default-browser-check','--disable-component-update',
  '--remote-debugging-port=0',`--user-data-dir=${userDataDir}`,'about:blank'
 ],{stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',chunk=>{stderr+=chunk.toString()});
 try{
  const debugPort=await waitForDebugPort(userDataDir,child);
  const results=[];
  for(const expectation of PAGE_EXPECTATIONS)results.push(await inspectPage({debugPort,origin,expectation,bundlePaths,demoMode}));
  process.stdout.write(`Browser smoke passed ${results.length}/${PAGE_EXPECTATIONS.length} pages in ${demoMode?'Pages Frontend Demo':'emulator'} mode.\n`);
  for(const item of results)process.stdout.write(`- ${item.page}: ${item.requiredAsset} loaded; ${item.requests} local requests; final ${item.finalUrl}\n`);
  if(authFixture){
   const owner=await authenticatedOwnerSmoke({debugPort,origin,fixture:authFixture,bundlePaths});
   process.stdout.write(`Authenticated owner smoke passed ${owner.pages.length}/${owner.pages.length} protected pages: ${owner.pages.join(', ')}.\n`);
  }
  return results;
 }catch(error){
  if(stderr.trim())process.stderr.write(`Chrome stderr (tail):\n${stderr.slice(-5000)}\n`);
  throw error;
 }finally{
  if(child.exitCode===null){
   child.kill('SIGTERM');
   for(let i=0;i<20&&child.exitCode===null;i++)await wait(100);
   if(child.exitCode===null){
    child.kill('SIGKILL');
    for(let i=0;i<20&&child.exitCode===null;i++)await wait(100);
   }
  }
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(userDataDir,{recursive:true,force:true,maxRetries:8,retryDelay:100});
 }
}
if(require.main===module)run().catch(error=>{console.error(error.stack||error);process.exit(1)});
module.exports={PAGE_EXPECTATIONS,CLOUD_FIREBASE_HOSTS,AUTH_FIXTURE,readDeploymentMetadata,bundlePathMap,emulatorOrigin,createAuthenticatedFixture,safeStaticPath,contentType,chromeCandidates,findChrome,localAssetFailure,doeSmokeResponse,createRulebookSmokeState,doeRulebookSmokeResponse,createStaticServer};
