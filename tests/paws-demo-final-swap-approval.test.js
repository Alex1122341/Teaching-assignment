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
 assert.equal(doe.status,'calculated',JSON.stringify({status:doe.status,issues:doe.issueCodes,
  outgoing:doe.outgoing,incoming:doe.incoming},null,2));
 assert.equal(response.body.preview.status,'calculated');
 assert.equal(response.body.preview.availability.status,'Available',JSON.stringify(response.body.preview.availability));
 const decision=await api.decide('demo-token',req.requestId,{expectedRevision:req.revision,decision:'approve',comment:'Test-site approval'});
 assert.equal(decision.status,200,JSON.stringify(decision.body));
 assert.equal(decision.body.request.status,'applied');
 assert.equal(original.facultyId,context.incomingFacultyId);
});
