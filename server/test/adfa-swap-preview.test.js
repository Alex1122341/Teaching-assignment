'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSwapApi}=require('../src/swap/swap-api');
const {createSwapFunctions}=require('../src/runtime/swa-swap-functions');
const {createSqlSwapRepository}=require('../src/data/sql-swap-repository');
const {createDoeWorkflowPreviewService}=require('../src/doe/doe-workflow-preview-service');
const {createWorksheetService}=require('../src/doe/doe-worksheet-service');
const {createDoeCalculationService}=require('../src/doe/doe-calculation-service');
const SESSION='11111111-1111-4111-8111-111111111111';
const ASSIGNMENT='22222222-2222-4222-8222-222222222222';
const CANDIDATE='33333333-3333-4333-8333-333333333333';
const SNAPSHOT='a'.repeat(64);
const OUT='44444444-4444-4444-8444-444444444444',IN='55555555-5555-4555-8555-555555555555';
function integration({baseRole='adfa_regular',missingTarget=false,contractTeachingDoe=18,sqlFailure=null,availabilityStatus='Available'}={}){
 const context={academicYear:'2026-27',outgoingFacultyId:OUT,incomingFacultyId:IN,assignmentId:ASSIGNMENT,candidateKey:CANDIDATE,outgoingDisplayName:'Outgoing synthetic',incomingDisplayName:'Incoming synthetic',teachingRole:'Primary',persistedDoeCredit:0.42,availabilityStatus,conflicts:[],snapshotToken:SNAPSHOT,email:'PRIVATE EMAIL',afcPurpose:'PRIVATE PURPOSE'};
 const repository=createSqlSwapRepository({query:async(sql)=>{
  if(!sql.startsWith('EXEC paws_api.GetAdfaSwapFacultyPreview'))throw Error('Unexpected SQL boundary');
  if(sqlFailure)throw Object.assign(Error('PRIVATE SQL ERROR'),{number:sqlFailure});
  return[{responseJson:JSON.stringify(context)}];
 }});
 const line=(id,value)=>({lineId:id,category:'teaching',sourceEntityType:'session_assignment',sourceEntityId:id,resultDoe:value,status:'calculated',policyVersionId:'policy-1'});
 const worksheetService=createWorksheetService({repository:{getFacultyWorksheetSource:async id=>({facultyId:id,academicYear:'2026-27',stream:'clinical',policyStatus:'consistent',supervisionDataAvailable:true,target:{contractTeachingDoe,effectiveTargetDoe:missingTarget?null:20},reservePolicy:{splitThreshold:35,splitRatio:0.5,highTeachingTraineeCeiling:15,teachingFocusedTraineeCeiling:7.5,rollingAverageYears:3},lines:id===OUT?[line(ASSIGNMENT,2),line('other',10)]:[line('incoming-other',5)]})}});
 const calculationService=createDoeCalculationService({repository:{loadActivePolicy:async()=>({version:{policyVersionId:'policy-1',academicYear:'2026-27',revision:1,status:'active'},rules:[{ruleId:'rule-1',ruleKey:'lecture',category:'teaching',activityType:'LEC',priority:1,calculationMode:'per_hour',resultKind:'credit',enabled:true,parameters:[{name:'rate',valueNumber:2}],inputs:[{inputName:'hours',required:true}],selectors:[{field:'activityType',operator:'equals',valueText:'LEC'}]}],references:[],exceptions:[],courseMappings:[],subjectMappings:[]})}});
 const workflowPreviewService=createDoeWorkflowPreviewService({repository:{loadSessionDoeFacts:async()=>({sessionId:SESSION,academicYear:'2026-27',curriculumYear:'2',courseCode:'SYNTHETIC',sessionType:'LEC',sessionDate:'2026-11-05',startTime:'09:00',endTime:'10:00',assignments:[{sessionAssignmentId:ASSIGNMENT,facultyId:OUT,teachingRole:'Primary',creditedHours:1}]})},worksheetService,calculationService});
 const api=createSwapApi({verifyToken:async()=>({uid:'synthetic'}),findUser:async()=>({active:true,baseRole}),repository,workflowPreviewService,worksheetService});
 return{route:createSwapFunctions({api}),context};
}
function request(values={}){
 return new Request('http://local/api/v1/swaps/faculty-preview?'+new URLSearchParams({sessionId:SESSION,assignmentId:ASSIGNMENT,candidateKey:CANDIDATE,snapshotToken:SNAPSHOT,...values}),{headers:{authorization:'Bearer synthetic'}});
}

test('SWAP distinguishes the recorded contract DOE from the effective target and current remaining DOE',async()=>{
 const response=await integration().route(request());
 assert.equal(response.status,200);
 const p=response.jsonBody.preview;
 assert.equal(p.incoming.current.contractDoe,18);
 assert.equal(p.incoming.current.targetDoe,20);
 assert.equal(p.incoming.current.remainingDoe,15);
 assert.equal(p.incoming.projected.remainingDoe,13);
 assert.equal(p.outgoing.current.contractDoe,18);
 assert.doesNotMatch(JSON.stringify(p),/PRIVATE|overrideReason|overrideNotes/);
});

// Break caught: routing an ordinary faculty/office user into the privileged DOE preview.
test('non-ADFA users cannot read another faculty member DOE through the SWAP preview',async()=>{
 for(const baseRole of ['faculty','hicc','visc','adc','lab','other_office']){
  const api=createSwapApi({verifyToken:async()=>({uid:'synthetic'}),findUser:async()=>({active:true,baseRole}),repository:{}});
  const response=await createSwapFunctions({api})(request());
  assert.equal(response.status,403,baseRole);
  assert.equal(response.jsonBody.error.code,'ROLE_DENIED');
 }
});

// Break caught: client arithmetic, wrong assignment/candidate resolution, or private DTO leakage.
test('ADFA reads actual current and projected DOE through the authenticated SWAP route',async()=>{
 const response=await integration().route(request());
 assert.equal(response.status,200);
 const preview=response.jsonBody.preview;
 assert.equal(preview.status,'calculated');
 assert.equal(preview.assignment.persistedDoeCredit,0.42);
 assert.deepEqual(preview.outgoing.current,{status:'calculated',contractDoe:18,currentDoe:12,targetDoe:20,remainingDoe:8});
 assert.deepEqual(preview.outgoing.projected,{status:'calculated',contractDoe:18,currentDoe:10,targetDoe:20,remainingDoe:10});
 assert.deepEqual(preview.incoming.current,{status:'calculated',contractDoe:18,currentDoe:5,targetDoe:20,remainingDoe:15});
 assert.deepEqual(preview.incoming.projected,{status:'calculated',contractDoe:18,currentDoe:7,targetDoe:20,remainingDoe:13});
 assert.equal(preview.sessionDoeCredit,2);
 assert.equal(preview.outgoing.deltaDoe,-2);
 assert.equal(preview.incoming.deltaDoe,2);
 assert.equal(preview.availability.status,'Available');
 assert.equal(preview.evidencePersisted,false);
 assert.doesNotMatch(JSON.stringify(preview),/PRIVATE|facultyId|44444444|55555555/);
});

// Break caught: duplicate query keys silently overriding the candidate checked by an administrator.
test('SWAP preview rejects duplicate and unexpected query inputs',async()=>{
 const route=integration().route;
 const original=request();
 for(const suffix of ['&candidateKey='+CANDIDATE,'&actorFirebaseUid=spoof','&resultDoe=100']){
  const response=await route(new Request(original.url+suffix,{headers:original.headers}));
  assert.equal(response.status,400);
 }
});

// Break caught: administrator UI privilege inferred from a browser role instead of authenticated SQL profile.
test('only ADFA-equivalent SQL roles receive the DOE preview capability',async()=>{
 for(const [baseRole,expected] of [['adfa_general',true],['adfa_regular',true],['owner',true],['administrator',true],['developer',true],['faculty',false]]){
  const api=createSwapApi({verifyToken:async()=>({uid:'synthetic',role:'owner'}),findUser:async()=>({active:true,baseRole}),repository:{}});
  const response=await createSwapFunctions({api})(new Request('http://local/api/v1/swaps/capabilities',{headers:{authorization:'Bearer synthetic'}}));
  assert.equal(response.jsonBody.canPreviewDoe,expected,baseRole);
 }
});

test('missing DOE target remains Needs Review rather than becoming a zero',async()=>{
 const response=await integration({missingTarget:true}).route(request());
 assert.equal(response.status,200);
 assert.equal(response.jsonBody.preview.status,'needs_review');
 assert.equal(response.jsonBody.preview.incoming.projected.currentDoe,null);
 assert.equal(response.jsonBody.preview.incoming.current.targetDoe,null);
 assert.equal(response.jsonBody.preview.incoming.current.contractDoe,18);
});

test('SWAP preserves a zero contract and never substitutes the effective target for a missing contract',async()=>{
 for(const contractTeachingDoe of [null,0]){
  const response=await integration({contractTeachingDoe}).route(request());
  assert.equal(response.status,200);
  assert.equal(response.jsonBody.preview.incoming.current.contractDoe,contractTeachingDoe);
  assert.equal(response.jsonBody.preview.incoming.current.targetDoe,20);
 }
});

test('stale SQL snapshot and inactive candidate fail with safe errors',async()=>{
 for(const [sqlFailure,status] of [[53010,409],[53004,404],[53003,403],[12345,503]]){
  const response=await integration({sqlFailure}).route(request());
  assert.equal(response.status,status);
  assert.doesNotMatch(JSON.stringify(response.jsonBody),/PRIVATE/);
 }
});

// Break caught: the production runtime mounts the endpoint without its real DOE services.
test('real runtime exposes read-only preview with unavailable source data marked Needs Review',async()=>{
 const {createSwaSqlRuntime}=require('../src/runtime/swa-sql-runtime');
 const h=integration();
 class Pool{
  async connect(){return this;}async close(){}
  request(){const args={};return{input(k,v){args[k]=v;return this;},async query(sql){
   if(sql.includes('FROM paws.UserProfile'))return{recordset:[{firebaseUid:'synthetic',active:true,baseRole:'adfa_regular',mustChangePassword:false}]};
   if(sql.includes('GetAdfaSwapFacultyPreview'))return{recordset:[{responseJson:JSON.stringify(h.context)}]};
   if(sql.includes('FROM paws.Session AS s'))return{recordset:[{sessionId:SESSION,academicYear:'2026-27',sessionType:'LEC',sessionDate:'2026-11-05',startTime:'09:00',endTime:'10:00',sessionAssignmentId:ASSIGNMENT,facultyId:OUT,teachingRole:'Primary',creditedHours:1}]};
   if(/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql))throw Error('Preview attempted a business write');
   return{recordset:[]};
  }};}
 }
 const project='synthetic-project',runtime=createSwaSqlRuntime({env:{FIREBASE_PROJECT_ID:project,PAWS_SQL_CONNECTION_STRING:'Server=localhost;Database=VetMed-Ops;Encrypt=true;',PAWS_SQL_DRIVER:'tedious'},admin:{initializeApp:()=>({}),auth:()=>({verifyIdToken:async()=>({uid:'synthetic',aud:project,iss:'https://securetoken.google.com/'+project})})},sql:{ConnectionPool:Pool}});
 try{const response=await runtime(request());assert.equal(response.status,200);assert.equal(response.jsonBody.preview.status,'needs_review');assert.equal(response.jsonBody.preview.evidencePersisted,false);}finally{await runtime.close();}
});
