'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const load=()=>{const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'session-workflow.js'),'utf8'),ctx);return ctx.window.UCVM_SESSION_WORKFLOW;};
// Values built inside the vm realm have foreign prototypes, so arrays and objects
// coming back from the module are copied into this realm before comparison.
const arr=value=>Array.from(value||[]);
const plain=value=>JSON.parse(JSON.stringify(value));

const lec=extra=>({id:'s-lec',type:'LEC',date:'2027-01-11',year:1,course:'200',start:'08:00',end:'09:00',topic:'Intro',room:'A100',...extra});
const lab=extra=>({id:'s-lab',type:'LAB',date:'2027-01-12',year:1,course:'200',start:'13:00',end:'15:00',...extra});
const rosterContext=(ids,count=24)=>({rosters:Object.fromEntries(ids.map(id=>[id,{studentIds:Array.from({length:count},(_,i)=>`300000${String(i).padStart(2,'0')}`)}]))});

// ---------------------------------------------------------------- LEC
test('LEC: a missing ADC required field produces ADC work',()=>{
 const w=load(),session=lec({room:''});
 const items=w.workflowItemsForRole([session],'adc');
 assert.equal(items.length,1);
 assert.equal(items[0].stage,'adc');
 assert.equal(items[0].status,'ready');
 assert.deepEqual(arr(items[0].missing),['room']);
 assert.equal(items[0].sessionId,'s-lec');
});

test('LEC: LAB stage is not applicable and never produces work',()=>{
 const w=load(),session=lec();
 const evaluation=w.evaluateSessionWorkflow(session);
 assert.equal(evaluation.stages.lab.applicable,false);
 assert.equal(evaluation.stages.lab.status,'not_applicable');
 assert.deepEqual(arr(w.workflowItemsForRole([session],'lab')),[]);
 assert.equal(w.previousApplicableStage(session,'adfa'),'adc');
 assert.equal(w.nextApplicableStage(session,'adc'),'adfa');
});

test('LEC: missing faculty assignment is ADFA work',()=>{
 const w=load(),session=lec();
 const items=w.workflowItemsForRole([session],'adfa');
 assert.equal(items.length,1);
 assert.equal(items[0].stage,'adfa');
 assert.equal(items[0].status,'ready');
 assert.deepEqual(arr(items[0].missing),['assignments']);
 assert.equal(w.evaluateSessionWorkflow(lec({assignments:[{facultyId:'f1',name:'Dr A'}]})).complete,true);
});

test('LEC: a missing optional faculty suggestion does not block or create work',()=>{
 const w=load(),session=lec({assignments:[{facultyId:'f1'}]});
 const optional=arr(w.definitionForSession(session).stages.adc.fields).filter(item=>item.required===false).map(item=>item.key);
 assert.deepEqual(optional,['facultySuggestion']);
 assert.equal(w.evaluateSessionWorkflow(session).complete,true);
 assert.deepEqual(arr(w.workflowItemsForRole([session],'adc')),[]);
});

test('LEC: ADFA waits while ADC required work is incomplete',()=>{
 const w=load(),session=lec({topic:''});
 const evaluation=w.evaluateSessionWorkflow(session);
 assert.equal(evaluation.stages.adc.status,'ready');
 assert.equal(evaluation.stages.adfa.status,'waiting');
 assert.equal(evaluation.stages.adfa.waitingFor,'ADC');
});

// ---------------------------------------------------------------- SRL
test('SRL: mirrors LEC scope and stage order',()=>{
 const w=load(),session=lec({type:'SRL'});
 const definition=w.definitionForSession(session);
 assert.equal(definition.scoped,true);
 assert.equal(definition.stages.lab.applicable,false);
 assert.deepEqual(arr(definition.stages.adc.fields).map(f=>f.key),['date','year','course','type','start','end','topic','room','facultySuggestion']);
 const evaluation=w.evaluateSessionWorkflow(session);
 assert.equal(evaluation.stages.adc.status,'complete');
 assert.equal(evaluation.stages.adfa.status,'ready');
 assert.deepEqual(arr(w.workflowItemsForRole([session],'adc')),[]);
 assert.deepEqual(arr(w.workflowItemsForRole([session],'adfa')).map(item=>arr(item.missing)),[['assignments']]);
 assert.equal(w.evaluateSessionWorkflow({...session,date:''}).stages.adc.status,'ready');
});

// ---------------------------------------------------------------- LAB
test('LAB: missing ADC scheduling fields produce ADC work, not LAB work',()=>{
 const w=load(),session=lab({course:''});
 const evaluation=w.evaluateSessionWorkflow(session);
 assert.equal(evaluation.stages.adc.status,'ready');
 assert.deepEqual(arr(w.missingRequiredFields(session,'adc')).map(f=>f.key),['course']);
 assert.deepEqual(arr(w.workflowItemsForRole([session],'adc')).map(i=>i.stage),['adc']);
});

test('LAB: LAB work is waiting while ADC is incomplete',()=>{
 const w=load(),session=lab({start:''});
 const evaluation=w.evaluateSessionWorkflow(session);
 assert.equal(evaluation.stages.lab.status,'waiting');
 assert.equal(evaluation.stages.lab.waitingFor,'ADC');
 const items=w.workflowItemsForRole([session],'lab');
 assert.equal(items.length,1);
 assert.equal(items[0].status,'waiting');
 assert.equal(items[0].waitingFor,'ADC');
});

test('LAB: after ADC completes, missing topic/group/roster makes LAB ready',()=>{
 const w=load(),session=lab();
 const evaluation=w.evaluateSessionWorkflow(session);
 assert.equal(evaluation.stages.adc.status,'complete');
 assert.equal(evaluation.stages.lab.status,'ready');
 assert.deepEqual(arr(evaluation.stages.lab.missing).map(f=>f.key),['topic','labGroups','labRoster']);
});

test('LAB: ADC placeholder TBD is still missing LAB Topic and keeps ADFA waiting',()=>{
 const w=load(),session=lab({topic:'TBD'}),evaluation=w.evaluateSessionWorkflow(session);
 assert.equal(evaluation.stages.adc.status,'complete');
 assert.equal(evaluation.stages.lab.status,'ready');
 assert.deepEqual(arr(evaluation.stages.lab.missing).map(f=>f.key),['topic','labGroups','labRoster']);
 assert.equal(evaluation.stages.adfa.status,'waiting');
 assert.equal(evaluation.stages.adfa.waitingFor,'LAB');
 assert.deepEqual(arr(arr(w.workflowItemsForRole([session],'lab'))[0].missingLabels).map(String),['Topic','LAB group','Group roster']);
 assert.deepEqual(arr(arr(w.workflowItemsForRole([session],'adfa'))[0].missingLabels).map(String),['Faculty assignment']);
});

test('LAB: ADFA waits while LAB is incomplete and becomes ready when LAB completes',()=>{
 const w=load(),session=lab({topic:'Neuro',labGroupIds:['g-a']});
 const incomplete=w.evaluateSessionWorkflow(session,rosterContext([]));
 assert.equal(incomplete.stages.lab.status,'ready');
 assert.equal(incomplete.stages.adfa.status,'waiting');
 assert.equal(incomplete.stages.adfa.waitingFor,'LAB');

 const complete=w.evaluateSessionWorkflow(session,rosterContext(['g-a']));
 assert.equal(complete.stages.lab.status,'complete');
 assert.equal(complete.stages.adfa.status,'ready');
});

test('LAB: every required group needs a roster before LAB completes',()=>{
 const w=load(),session=lab({topic:'Neuro',labGroupIds:['g-a','g-b']});
 const context={rosters:{'g-a':{studentIds:['30012345']},'g-b':{studentIds:[]}}};
 const evaluation=w.evaluateSessionWorkflow(session,context);
 assert.equal(evaluation.stages.lab.status,'ready');
 assert.deepEqual(arr(evaluation.stages.lab.missing).map(f=>f.key),['labRoster']);
 assert.equal(w.isStageComplete(session,'lab',rosterContext(['g-a','g-b'])),true);
});

test('LAB: a missing optional suggestion does not block any stage',()=>{
 const w=load(),session=lab({topic:'Neuro',labGroupIds:['g-a'],assignments:[{facultyId:'f1'}]});
 const context=rosterContext(['g-a']);
 const evaluation=w.evaluateSessionWorkflow(session,context);
 assert.equal(evaluation.complete,true);
 assert.deepEqual(arr(evaluation.activeStages),[]);
 assert.deepEqual(arr(w.workflowItemsForRole([session],'lab',context)),[]);
 assert.deepEqual(arr(w.workflowItemsForRole([session],'adc',context)),[]);
 assert.deepEqual(arr(w.workflowItemsForRole([session],'adfa',context)),[]);
});

test('LAB: an optional suggestion does not change stage completion',()=>{
 const w=load(),session=lab({topic:'Neuro',labGroupIds:['g-a']});
 const context={...rosterContext(['g-a']),suggestions:{adc:[{candidateKey:'k1',displayName:'Dr X'}]}};
 assert.equal(w.evaluateSessionWorkflow(session,context).stages.lab.status,'complete');
 const optional=arr(w.optionalFields(session,'lab'));
 assert.deepEqual(optional.map(f=>f.key),['facultySuggestion']);
 assert.equal(optional.every(f=>f.required===false),true);
});

// ---------------------------------------------------------------- other types
test('other session types get no invented scope',()=>{
 const w=load();
 for(const type of ['QUIZ','MIDTERM','OSCE','EXAM','SEMINAR']){
  const session={id:'x',type,date:'2027-01-11',year:1,course:'200',start:'08:00',end:'09:00'};
  const evaluation=w.evaluateSessionWorkflow(session);
  assert.equal(evaluation.scoped,false,type);
  assert.equal(evaluation.complete,true,type);
  assert.deepEqual(arr(evaluation.activeStages),[],type);
  for(const role of ['adc','lab','adfa','developer'])assert.deepEqual(arr(w.workflowItemsForRole([session],role)),[],type+'/'+role);
 }
});

// ---------------------------------------------------------------- roles + counts
test('stageForRole maps operational roles and never invents a DVM role',()=>{
 const w=load();
 assert.equal(w.stageForRole('adc'),'adc');
 assert.equal(w.stageForRole('lab'),'lab');
 for(const role of ['owner','administrator','admin','adfa_general','adfa_regular'])assert.equal(w.stageForRole(role),'adfa',role);
 assert.equal(w.stageForRole('developer'),'all');
 for(const role of ['faculty','hicc','visc','other_office','dvm',''])assert.equal(w.stageForRole(role),'',String(role));
});

test('Developer work queue covers every stage while office roles see only their own',()=>{
 const w=load(),sessions=[lec({room:''}),lab({course:''})];
 const all=w.workflowItemsForRole(sessions,'developer');
 assert.deepEqual([...new Set(arr(all).map(i=>i.stage))].sort(),['adc','adfa','lab']);
 assert.deepEqual(arr(w.workflowItemsForRole(sessions,'adc')).map(i=>i.stage),['adc','adc']);
 assert.deepEqual(arr(w.workflowItemsForRole(sessions,'lab')).map(i=>i.stage),['lab']);
 assert.deepEqual(arr(w.workflowItemsForRole(sessions,'adfa')).map(i=>i.stage),['adfa','adfa']);
 const counts=plain(w.countItemsForRole(sessions,'developer'));
 assert.equal(counts.total,all.length);
 assert.equal(counts.adc,w.workflowItemsForRole(sessions,'adc').length);
 assert.equal(counts.lab,w.workflowItemsForRole(sessions,'lab').length);
 assert.equal(counts.adfa,w.workflowItemsForRole(sessions,'adfa').length);
 assert.equal(counts.adc+counts.lab+counts.adfa,counts.total);
});

test('workflow items are keyed by sessionId and carry no authoritative copy',()=>{
 const w=load(),items=w.workflowItemsForRole([lec({room:''})],'adc');
 assert.equal(items[0].sessionId,'s-lec');
 assert.equal(typeof items[0].missingLabels[0],'string');
 assert.deepEqual(Object.keys(items[0]).sort(),['missing','missingLabels','office','session','sessionId','sessionType','stage','status','waitingFor'].sort());
});

test('stage order helpers agree with the fixed ADC -> LAB -> ADFA order',()=>{
 const w=load();
 assert.deepEqual(arr(w.STAGES),['adc','lab','adfa']);
 assert.deepEqual(plain(w.ORDER),{adc:0,lab:1,adfa:2});
 assert.equal(w.nextApplicableStage(lab(),'adc'),'lab');
 assert.equal(w.nextApplicableStage(lab(),'lab'),'adfa');
 assert.equal(w.nextApplicableStage(lab(),'adfa'),'');
 assert.equal(w.previousApplicableStage(lab(),'adfa'),'lab');
 assert.equal(w.previousApplicableStage(lec(),'adfa'),'adc');
});
