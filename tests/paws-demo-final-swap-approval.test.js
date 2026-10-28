'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createStore}=require('../tools/pages-demo-api/store');
const {createSwapRepository,list}=require('../tools/pages-demo-api/repos/swap');
const {createDoeEngineRepository,createDoeWorksheetRepository,createDoeAssignmentRepository}=require('../tools/pages-demo-api/repos/doe');
const {createWorksheetService}=require('../server/src/doe/doe-worksheet-service');
const {createDoeCalculationService}=require('../server/src/doe/doe-calculation-service');
const {createDoeWorkflowPreviewService}=require('../server/src/doe/doe-workflow-preview-service');
const {createSwapApi}=require('../server/src/swap/swap-api');

function setup(){
  const store=createStore();
  const swap=createSwapRepository(store);
  const worksheets=createWorksheetService({repository:createDoeWorksheetRepository(store)});
  const calculations=createDoeCalculationService({repository:createDoeEngineRepository(store)});
  const workflow=createDoeWorkflowPreviewService({repository:createDoeAssignmentRepository(store),worksheetService:worksheets,calculationService:calculations});
  const api=createSwapApi({
    verifyToken:async()=>({uid:'uid-developer'}),
    findUser:async uid=>store.tables.users.find(user=>user.firebaseUid===uid)||null,
    repository:swap,workflowPreviewService:workflow,worksheetService:worksheets,
    writeGates:{swapRequest:true,swapDecision:true,swapApply:true}
  });
  return{store,api,swap,workflow};
}
test('synthetic ADFA SWAP receives usable preview and can apply to the timetable',async()=>{
 const {store,api,swap,workflow}=setup();
 const req=list(store).find(r=>r.status==='pending'&&r.nextStage==='adfa'&&r.changes.replacementCandidateKey);
 assert.ok(req,'the seed must include a ready-to-review ADFA replacement');
 const detail=await api.detail('demo-token',req.requestId);
 assert.equal(detail.status,200,JSON.stringify(detail));
 assert.equal(detail.body.capabilities.canDecide,true);
 const before=store.tables.sessions.find(s=>s.id===req.sessionId);
 const original=before.assignments.find(a=>a.sessionAssignmentId===req.assignmentId);
 const context=await swap.facultyPreviewContext({actorFirebaseUid:'uid-developer',
  sessionId:req.sessionId,assignmentId:req.assignmentId,candidateKey:req.changes.replacementCandidateKey,snapshotToken:req.snapshotToken});
 const doe=await workflow.previewFacultyTransfer({sessionId:req.sessionId,
   outgoingFacultyId:context.outgoingFacultyId,incomingFacultyId:context.incomingFacultyId});
 const response=await api.facultyPreview('demo-token',{
  sessionId:req.sessionId,assignmentId:req.assignmentId,candidateKey:req.changes.replacementCandidateKey,snapshotToken:req.snapshotToken});
 assert.equal(response.status,200,JSON.stringify(response.body));
 assert.ok(['calculated','needs_review'].includes(doe.status));
 assert.equal(response.body.preview.status,doe.status);
 const availability=response.body.preview.availability.status;
 assert.ok(['Available','Unavailable'].includes(availability),JSON.stringify(response.body.preview.availability));
 assert.equal(detail.body.capabilities.canOverride,true,'Developer must be allowed to record a real conflict override at ADFA');
 if(availability==='Unavailable'){
   const refused=await api.decide('demo-token',req.requestId,{expectedRevision:req.revision,decision:'approve',comment:'Missing conflict override'});
   assert.equal(refused.status,409,'A known availability conflict requires explicit override');
   assert.equal(req.status,'pending');
 }
 const decision=await api.decide('demo-token',req.requestId,{
   expectedRevision:req.revision,decision:'approve',comment:'Test-site approval',
   ...(availability==='Unavailable'?{overrideReason:'Synthetic known availability conflict reviewed by Developer'}:{})
 });
 assert.equal(decision.status,200,JSON.stringify(decision.body));
 assert.equal(decision.body.request.status,'applied');
 assert.equal(original.facultyId,context.incomingFacultyId);
});


test('synthetic final approval never marks a request applied when the apply write gate is closed',async()=>{
  const {store,swap}=setup();
  const request=list(store).find(r=>r.status==='pending'&&r.nextStage==='adfa');
  const before=JSON.stringify(store.tables.sessions.find(s=>s.id===request.sessionId));
  await assert.rejects(()=>swap.decide({actorFirebaseUid:'uid-developer',requestId:request.requestId,
    payload:{expectedRevision:request.revision,decision:'approve',comment:'Test',overrideReason:'Testing only'},
    applyEnabled:false}),/disabled/);
  assert.equal(request.status,'pending');
  assert.equal(JSON.stringify(store.tables.sessions.find(s=>s.id===request.sessionId)),before);
});

test('missing or stale synthetic replacement consent and revision cannot be finalized',async()=>{
 const {store,swap}=setup();
 const request=list(store).find(r=>r.status==='pending'&&r.nextStage==='adfa');
 // Give this negative fixture a different ID: the canonical seeded ID is intentionally auto-repaired.
 request.requestId='11111111-1111-4111-8111-111111111111';
 request.history=request.history.filter(x=>x.stage!=='target');
 await assert.rejects(()=>swap.decide({actorFirebaseUid:'uid-developer',requestId:request.requestId,
   payload:{expectedRevision:request.revision,decision:'approve',comment:'Test',overrideReason:'Known conflict'},
   applyEnabled:true}),/consent/);
 assert.equal(request.status,'pending');
});

test('allowing synthetic incomplete DOE requires the explicit GitHub Pages demo flag',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const frontend=fs.readFileSync(path.resolve(__dirname,'../frontend/scripts/swap-workflow-sql.js'),'utf8');
 assert.match(frontend,/const syntheticDemo=root\.UCVM_FRONTEND_DEMO_MODE===true&&Boolean\(root\.UCVM_PAGES_DEMO\)/);
 assert.match(frontend,/const syntheticDoeOnly=syntheticDemo&&!complete/);
 assert.match(frontend,/Testing Site only:/);
});
