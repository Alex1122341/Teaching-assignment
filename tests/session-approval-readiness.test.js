'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load(){const ctx={window:{}};for(const name of ['scheduling-core','approval-routing','approval-state','approval-lifecycle','session-workflow'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',name+'.js'),'utf8'),ctx);return ctx.window}
const session={id:'s1',type:'LAB',date:'2027-03-22',year:3,course:'505',start:'09:00',end:'10:00',topic:'Topic',labGroupIds:['g1'],assignments:[]};
function bundle(adc='pending',lab='pending'){
 const workflow={requestId:'r1',revision:2,requiredOffices:['adc','lab','adfa'],scopes:{adc:['date'],lab:['topic'],adfa:['assignments']},scopeSignatures:{adc:'date-v2',lab:'topic-v2',adfa:'assignment-v2'}};
 return{id:'r1',sessionId:'s1',status:'pending',requestSchema:'office-routing-v1',revision:2,_workflow:workflow,
 _approvals:Object.fromEntries(['adc','lab','adfa'].map(office=>[office,{requestId:'r1',office,revision:2,status:office==='adc'?adc:office==='lab'?lab:'pending',fields:workflow.scopes[office],scopeSignature:workflow.scopeSignatures[office]}]))};
}
const context=request=>({approvalsReady:true,routedRequests:request?[request]:[],labGroups:[{groupId:'g1',course:'505',active:true,rosterComplete:true}]});
test('ADC field completion does not release LAB until applicable ADC approval completes',()=>{
 const api=load().UCVM_SESSION_WORKFLOW,labWork={...session,topic:'TBD'};
 assert.equal(api.stageStatus(labWork,'lab',context(bundle())).status,'waiting');
 assert.equal(api.stageStatus(labWork,'lab',context(bundle('approved'))).status,'ready');
});
test('LAB work completion does not release ADFA until applicable LAB approval completes',()=>{
 const api=load().UCVM_SESSION_WORKFLOW;
 assert.equal(api.stageStatus(session,'adfa',context(bundle('approved'))).status,'waiting');
 assert.equal(api.stageStatus(session,'adfa',context(bundle('approved','approved'))).status,'ready');
});
test('ordinary preparation and terminal unrelated requests do not invent approval requirements',()=>{
 const api=load().UCVM_SESSION_WORKFLOW;
 for(const req of [null,{...bundle(),status:'withdrawn'},{...bundle(),sessionId:'another-session'}])assert.equal(api.stageStatus(session,'adfa',context(req)).status,'ready');
});
test('missing, stale and scope-mismatched approval evidence fails closed',()=>{
 const api=load().UCVM_SESSION_WORKFLOW;
 const mutations=[r=>r._workflow.revision--,r=>r._approvals.adc.revision--,r=>delete r._approvals.lab,r=>r._approvals.adc.scopeSignature='stale',r=>r._approvals.adc.fields=['room'],r=>r._approvals.adc.requestId='other'];
 for(const mutate of mutations){const request=bundle('approved','approved');mutate(request);assert.equal(api.stageStatus(session,'adfa',context(request)).status,'waiting');}
 assert.equal(api.stageStatus(session,'adfa',{...context(null),approvalsReady:false}).status,'waiting');
});
test('Developer queue visibility preserves prior approval blockers',()=>{
 const api=load().UCVM_SESSION_WORKFLOW;
 const items=api.workflowItemsForRole([session],'developer',context(bundle('approved')));
 assert.equal(items.find(row=>row.stage==='adfa').status,'waiting');
});
test('save readiness also blocks already assigned downstream work while a prior approval is pending',()=>{
 const api=load().UCVM_SESSION_WORKFLOW;
 assert.equal(typeof api.stageReadiness,'function');
 assert.equal(api.stageReadiness({...session,assignments:[{facultyId:'self'}]},'adfa',context(bundle())).allowed,false);
});
test('malformed routed approval requirements cannot release downstream work',()=>{
 const api=load().UCVM_SESSION_WORKFLOW;
 for(const mutate of [r=>r._workflow.requiredOffices=[],r=>r._workflow.requiredOffices=['unknown'],r=>{delete r._workflow.scopes.adc;delete r._approvals.adc.fields;}]){
  const request=bundle('approved','approved');mutate(request);
  assert.equal(api.stageStatus(session,'adfa',context(request)).status,'waiting');
 }
});
