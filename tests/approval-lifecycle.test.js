'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){
  const context={window:{}};
  for(const file of ['scheduling-core.js','approval-routing.js','approval-state.js','approval-lifecycle.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  return context.window.UCVM_APPROVAL_LIFECYCLE;
}
const request={id:'r1',status:'pending',revision:1,editableFields:[],basePublic:{date:'2027-03-22',start:'09:00',end:'10:00',timeUnknown:false,topic:'Old',type:'LAB',instructor:'Dr A'},patchPublic:{date:'2027-03-23',topic:'New'}};
const workflow={requestId:'r1',revision:1,requiredOffices:['adc','lab'],hasFacultyChange:false,finalType:'LAB',scopes:{adc:['date'],lab:['topic'],adfa:[]},scopeSignatures:{adc:'a',lab:'l',adfa:''}};
const approvals={adc:{status:'pending',fields:['date'],scopeSignature:'a'},lab:{status:'approved',fields:['topic'],scopeSignature:'l'}};

test('approve keeps request pending until final apply and updates only current office decision',()=>{
  const api=load(),plan=api.planDecision({request,workflow,approvals,office:'adc',decision:'approve',actor:{uid:'u1',name:'ADC User'},now:'NOW'});
  assert.equal(plan.publicPatch.status,'pending');
  assert.equal(plan.approvalPatches.adc.status,'approved');
  assert.equal(plan.approvalPatches.lab,undefined);
  assert.equal(plan.allRequiredApproved,true);
  assert.equal(plan.audit.office,'adc');
});

test('push back exposes only current office fields and requester message contains no office identity',()=>{
  const api=load(),plan=api.planDecision({request,workflow,approvals,office:'adc',decision:'push_back',message:'Please adjust the date',actor:{uid:'u1',name:'ADC User'},now:'NOW'});
  assert.equal(plan.publicPatch.status,'update_required');
  assert.deepEqual(Array.from(plan.publicPatch.editableFields),['date']);
  assert.equal(plan.publicPatch.requesterMessage,'Please adjust the date');
  assert.equal(plan.publicPatch.requesterMessage.includes('ADC'),false);
  assert.equal(plan.approvalPatches.adc.status,'push_back');
});

test('reject is terminal and cancels other unfinished office approvals',()=>{
  const api=load(),plan=api.planDecision({request,workflow,approvals:{adc:{status:'pending'},lab:{status:'pending'}},office:'lab',decision:'reject',message:'Topic needs revision',actor:{uid:'u2',name:'LAB User'},now:'NOW'});
  assert.equal(plan.publicPatch.status,'rejected');
  assert.equal(plan.approvalPatches.lab.status,'rejected');
  assert.equal(plan.approvalPatches.adc.status,'cancelled');
});

test('withdraw cancels unfinished approvals but preserves approved history',()=>{
  const api=load(),plan=api.planWithdrawal({request:{...request,status:'update_required'},approvals:{adc:{status:'push_back'},lab:{status:'approved'}},actor:{uid:'faculty'},now:'NOW'});
  assert.equal(plan.publicPatch.status,'withdrawn');
  assert.equal(plan.approvalPatches.adc.status,'cancelled');
  assert.equal(plan.approvalPatches.lab,undefined);
});

test('resubmission recomputes routing and reopens ADFA when schedule changed with assigned Faculty',()=>{
  const api=load();
  const current={...request,status:'update_required',revision:2,editableFields:['date'],patchPublic:{date:'2027-03-23',topic:'New'}};
  const oldWorkflow={...workflow,revision:2,requiredOffices:['adc','lab','adfa'],hasFacultyChange:true,scopes:{adc:['date'],lab:['topic'],adfa:['assignments']},scopeSignatures:{adc:'[["date","2027-03-23"]]',lab:'[["topic","New"]]',adfa:'private-assignment-sig'}};
  const plan=api.planResubmission({request:current,workflow:oldWorkflow,approvals:{adc:{status:'push_back',scopeSignature:'[["date","2027-03-23"]]'},lab:{status:'approved',scopeSignature:'[["topic","New"]]'},adfa:{status:'approved',scopeSignature:'private-assignment-sig'}},publicEdits:{date:'2027-03-24'},hasAssignedFaculty:true,now:'NOW'});
  assert.equal(plan.publicPatch.status,'pending');
  assert.equal(plan.publicPatch.revision,3);
  assert.equal(plan.approvals.adc.status,'pending');
  assert.equal(plan.approvals.lab.status,'approved');
  assert.equal(plan.approvals.adfa.status,'pending');
});

test('a second office push back preserves fields already returned by another office',()=>{
  const api=load();
  const plan=api.planDecision({request:{...request,status:'update_required',editableFields:['date']},workflow,approvals:{adc:{status:'push_back'},lab:{status:'pending'}},office:'lab',decision:'push_back',message:'Revise topic',actor:{uid:'lab'},now:'NOW'});
  assert.deepEqual(Array.from(plan.publicPatch.editableFields),['date','topic']);
});

test('ADFA-returned Faculty replacement resubmission changes display name while private scope signature stays internal',()=>{
  const api=load();
  const req={id:'r2',status:'update_required',revision:1,editableFields:['assignments'],basePublic:{type:'LEC',instructor:'Dr Old'},patchPublic:{instructor:'Dr New'},proposedFacultyName:'Dr New'};
  const wf={requestId:'r2',revision:1,requiredOffices:['adfa'],hasFacultyChange:true,finalType:'LEC',scopes:{adc:[],lab:[],adfa:['assignments','instructor']},scopeSignatures:{adc:'',lab:'',adfa:'private-v1'}};
  const plan=api.planResubmission({request:req,workflow:wf,approvals:{adfa:{status:'push_back',scopeSignature:'private-v1'}},publicEdits:{},facultyEdit:{displayName:'Dr Third',scopeSignature:'private-v2'},hasAssignedFaculty:true,now:'NOW'});
  assert.equal(plan.publicPatch.patchPublic.instructor,'Dr Third');
  assert.equal(plan.publicPatch.proposedFacultyName,'Dr Third');
  assert.equal(plan.workflow.scopeSignatures.adfa,'private-v2');
  assert.equal(plan.approvals.adfa.status,'pending');
});

test('requester resubmission can be planned from public request only and leaves unrelated office approvals untouched',()=>{
  const api=load();
  const req={id:'r3',requestType:'session_edit',status:'update_required',revision:1,editableFields:['date'],basePublic:{type:'LAB',date:'2027-03-22',start:'09:00',end:'10:00',timeUnknown:false,topic:'Old',instructor:'Dr A'},patchPublic:{date:'2027-03-23',topic:'Advanced'}};
  const plan=api.planRequesterResubmission({request:req,publicEdits:{date:'2027-03-24'},now:'NOW'});
  assert.equal(plan.publicPatch.revision,2);
  assert.equal(plan.publicPatch.patchPublic.date,'2027-03-24');
  assert.deepEqual(Array.from(plan.workflow.requiredOffices),['adc','lab']);
  assert.equal(plan.approvalWrites.adc.status,'pending');
  assert.equal(plan.approvalWrites.adc.revision,2);
  assert.equal(plan.approvalWrites.adc.id,'r3_adc');
  assert.equal(plan.approvalWrites.lab,undefined);
  assert.deepEqual(Array.from(plan.cancelOffices),[]);
});

test('requester Faculty resubmission resets ADFA without reading internal workflow or approvals',()=>{
  const api=load();
  const req={id:'r4',requestType:'faculty_swap',status:'update_required',revision:2,editableFields:['assignments'],basePublic:{type:'LEC',instructor:'Dr Old'},patchPublic:{instructor:'Dr New'},proposedFacultyName:'Dr New'};
  const plan=api.planRequesterResubmission({request:req,publicEdits:{},facultyEdit:{displayName:'Dr Third',scopeSignature:'faculty-v1:1234'},facultyScopeSignature:'faculty-v1:old',now:'NOW'});
  assert.deepEqual(Array.from(plan.workflow.requiredOffices),['adfa']);
  assert.equal(plan.workflow.hasFacultyChange,true);
  assert.equal(plan.workflow.scopeSignatures.adfa,'faculty-v1:1234');
  assert.equal(plan.approvalWrites.adfa.status,'pending');
  assert.equal(plan.approvalWrites.adfa.revision,3);
  assert.equal(plan.approvalWrites.adfa.id,'r4_adfa');
  assert.equal(plan.publicPatch.proposedFacultyName,'Dr Third');
});

test('requester withdrawal can be planned from public request only without internal approval reads',()=>{
  const api=load();
  const req={id:'r5',requestType:'session_edit',requesterUid:'faculty',status:'update_required',revision:2,editableFields:['date'],basePublic:{type:'LAB',date:'2027-03-22',topic:'Old'},patchPublic:{date:'2027-03-23',topic:'New'}};
  const plan=api.planRequesterWithdrawal({request:req,actor:{uid:'faculty'},now:'NOW'});
  assert.equal(plan.publicPatch.status,'withdrawn');
  assert.deepEqual(Array.from(plan.cancelOffices),['adc','lab']);
});

test('Faculty-returned resubmission may update the requester-safe reason used for Sessional or Other',()=>{
  const api=load();
  const req={id:'r6',requestType:'faculty_swap',status:'update_required',revision:1,editableFields:['assignments'],basePublic:{type:'LEC',instructor:'Dr Old'},patchPublic:{instructor:'Dr New'},proposedFacultyName:'Dr New',reason:''};
  const plan=api.planRequesterResubmission({request:req,facultyEdit:{displayName:'Sessional',scopeSignature:'faculty-v1:special'},facultyScopeSignature:'faculty-v1:old',reason:'Clinical coverage',now:'NOW'});
  assert.equal(plan.publicPatch.reason,'Clinical coverage');
});

test('finalization rejects approved office records whose scope signature no longer matches the current workflow',()=>{
  const api=load();
  const workflow={requiredOffices:['adc','adfa'],scopes:{adc:['date'],adfa:['assignments']},scopeSignatures:{adc:'adc-current',adfa:'adfa-current'}};
  assert.equal(api.requiredApproved(workflow,{adc:{status:'approved',fields:['date'],scopeSignature:'adc-current'},adfa:{status:'approved',fields:['assignments'],scopeSignature:'stale-adfa'}}),false);
  assert.equal(api.requiredApproved(workflow,{adc:{status:'approved',fields:['date'],scopeSignature:'adc-current'},adfa:{status:'approved',fields:['assignments'],scopeSignature:'adfa-current'}}),true);
});

// ---------------------------------------------------------------------------
// Independent ADC/LAB decisions with ADFA as the dependent final stage
// ---------------------------------------------------------------------------
const orderRequest={id:'o1',status:'pending',revision:1,editableFields:[],basePublic:{type:'LAB',date:'2027-05-03',start:'09:00',end:'10:00',topic:'Old',room:'A1'},patchPublic:{date:'2027-05-04',topic:'New'}};
const orderApprovals={adc:{status:'pending',fields:['date'],scopeSignature:'a'},lab:{status:'pending',fields:['topic'],scopeSignature:'l'},adfa:{status:'pending',fields:['assignments'],scopeSignature:'f'}};
const orderWorkflow={requestId:'o1',revision:1,requiredOffices:['adc','lab','adfa'],hasFacultyChange:true,finalType:'LAB',scopes:{adc:['date'],lab:['topic'],adfa:['assignments']},scopeSignatures:{adc:'a',lab:'l',adfa:'f'}};
const decide=(api,office,approvals=orderApprovals,workflow=orderWorkflow,decision='approve',requestValue=orderRequest)=>api.planDecision({request:requestValue,workflow,approvals,office,decision,actor:{uid:'u-'+office,name:office.toUpperCase()},now:'NOW'});

test('LAB may approve its own scope while ADC is still pending',()=>{
 const api=load(),plan=decide(api,'lab');
 assert.equal(plan.approvalPatches.lab.status,'approved');
 assert.equal(plan.approvalPatches.adc,undefined);
 assert.equal(plan.allRequiredApproved,false);
});

test('ADC may approve its own scope while LAB is still pending',()=>{
 const api=load(),plan=decide(api,'adc');
 assert.equal(plan.approvalPatches.adc.status,'approved');
 assert.equal(plan.approvalPatches.lab,undefined);
 assert.equal(plan.allRequiredApproved,false);
});

test('ADFA waits for every required ADC and LAB decision',()=>{
 const api=load();
 assert.throws(()=>decide(api,'adfa'),/ADC must complete this request before ADFA can act on it\./);
 const adcDone={...orderApprovals,adc:{status:'approved',fields:['date'],scopeSignature:'a'}};
 assert.throws(()=>decide(api,'adfa',adcDone),/LAB must complete this request before ADFA can act on it\./);
 const bothDone={...adcDone,lab:{status:'approved',fields:['topic'],scopeSignature:'l'}};
 const plan=decide(api,'adfa',bothDone);
 assert.equal(plan.approvalPatches.adfa.status,'approved');
 assert.equal(plan.allRequiredApproved,true);
});

test('LAB can decide while another office has returned the overall request for update',()=>{
 const api=load(),requestValue={...orderRequest,status:'update_required',editableFields:['date']};
 const approvals={...orderApprovals,adc:{status:'push_back',fields:['date'],scopeSignature:'a'}};
 const plan=decide(api,'lab',approvals,orderWorkflow,'approve',requestValue);
 assert.equal(plan.publicPatch.status,'update_required');
 assert.equal(plan.approvalPatches.lab.status,'approved');
});

test('a request without LAB unlocks ADFA as soon as ADC approves',()=>{
 const api=load();
 const workflow={...orderWorkflow,requiredOffices:['adc','adfa'],scopes:{adc:['date'],lab:[],adfa:['assignments']}};
 const approvals={adc:{status:'pending',fields:['date'],scopeSignature:'a'},adfa:{status:'pending',fields:['assignments'],scopeSignature:'f'}};
 assert.throws(()=>decide(api,'adfa',approvals,workflow),/ADC must complete/);
 const adcApproved={...approvals,adc:{status:'approved',fields:['date'],scopeSignature:'a'}};
 const plan=decide(api,'adfa',adcApproved,workflow);
 assert.equal(plan.approvalPatches.adfa.status,'approved');
 assert.equal(plan.allRequiredApproved,true);
});

test('decision readiness reports ADC and LAB ready independently and ADFA waiting',()=>{
 const api=load();
 assert.deepEqual(JSON.parse(JSON.stringify(api.decisionReadiness({workflow:orderWorkflow,approvals:orderApprovals,office:'adc'}))),{allowed:true,waitingFor:[],reason:'ready'});
 assert.deepEqual(JSON.parse(JSON.stringify(api.decisionReadiness({workflow:orderWorkflow,approvals:orderApprovals,office:'lab'}))),{allowed:true,waitingFor:[],reason:'ready'});
 assert.deepEqual(JSON.parse(JSON.stringify(api.decisionReadiness({workflow:orderWorkflow,approvals:orderApprovals,office:'adfa'}))),{allowed:false,waitingFor:['adc','lab'],reason:'previous_stage_pending'});
 assert.deepEqual(JSON.parse(JSON.stringify(api.decisionReadiness({workflow:orderWorkflow,approvals:orderApprovals,office:'faculty'}))),{allowed:false,waitingFor:[],reason:'not_required'});
});

test('required offices keep stable display order while only ADFA has dependencies',()=>{
 const api=load();
 assert.deepEqual(Array.from(api.orderedOffices({requiredOffices:['adfa','lab','adc']})),['adc','lab','adfa']);
 assert.deepEqual(Array.from(api.previousRequiredOffices(orderWorkflow,'adfa')),['adc','lab']);
 assert.deepEqual(Array.from(api.previousRequiredOffices(orderWorkflow,'adc')),[]);
 assert.deepEqual(Array.from(api.previousRequiredOffices(orderWorkflow,'lab')),[]);
});

test('an office that is not required for the request still cannot act',()=>{
 const api=load();
 const workflow={...orderWorkflow,requiredOffices:['adc','adfa'],scopes:{adc:['date'],lab:[],adfa:['assignments']}};
 assert.throws(()=>decide(api,'lab',orderApprovals,workflow),/This office is not required for the request\./);
});

test('reject and push back stay available regardless of approval dependency',()=>{
 const api=load();
 const rejected=decide(api,'adfa',orderApprovals,orderWorkflow,'reject');
 assert.equal(rejected.publicPatch.status,'rejected');
 const pushed=api.planDecision({request:orderRequest,workflow:orderWorkflow,approvals:orderApprovals,office:'lab',decision:'push_back',message:'LAB returned the topic',actor:{uid:'u-lab',name:'LAB'},now:'NOW'});
 assert.equal(pushed.publicPatch.status,'update_required');
 assert.equal(pushed.publicPatch.requesterMessage,'LAB returned the topic');
});
