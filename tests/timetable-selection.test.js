'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function load(){
 const context={window:{},Date};
 vm.runInNewContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
 // Field ownership is derived from the canonical modules, so the harness must load them.
 vm.runInNewContext(fs.readFileSync(path.join(root,'office-capabilities.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(root,'session-workflow.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(root,'subject-catalog.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(root,'temporal-role-assignment.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(root,'academic-responsibility.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(root,'teaching-responsibility.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(root,'teaching-assignment-groups.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(root,'timetable-selection.js'),'utf8'),context);
 return context.window.UCVM_TIMETABLE_SELECTION;
}
const plain=value=>JSON.parse(JSON.stringify(value));
const baseSession={id:'s1',date:'2026-10-07',year:1,course:'204',type:'LEC',start:'08:30',end:'09:30',topic:'Passports',room:'A101',assignments:[{ucid:'1001',name:'Alex Faculty',role:'Lecture'}],facultyIds:['1001']};

test('only ADC scheduling authority can classify a selected session with an active Subject',()=>{
 const api=load(),original={...baseSession,subjectKey:''},actor={uid:'adc',role:'adc'};
 assert.equal(api.editPolicy('adc',original).fields.subjectKey,true);
 for(const role of ['lab','hicc','visc','faculty'])assert.equal(api.editPolicy(role,original).fields.subjectKey,false,role);
 const row={...original,subjectKey:'surgery'};
 const allowed=plain(api.planChanges([original],[row],actor,123,undefined,{role:'adc',activeSubjectKeys:['surgery']}));
 assert.deepEqual(allowed.errors,[]);
 assert.deepEqual(allowed.updates[0].data,{subjectKey:'surgery'});
 assert.equal(allowed.logs[0].after.topic,'Passports');
 const arbitrary=api.planChanges([original],[row],actor,123,undefined,{role:'adc',activeSubjectKeys:['anesthesia']});
 assert.ok(arbitrary.errors.some(error=>/active subject/i.test(error)));
 const labOriginal={...original,type:'LAB',topic:'TBD'};
 const denied=api.planChanges([labOriginal],[{...labOriginal,subjectKey:'surgery'}],{uid:'lab',role:'lab'},123,undefined,{role:'lab',activeSubjectKeys:['surgery']});
 assert.ok(denied.errors.some(error=>/cannot change subjectKey/i.test(error)));
});

test('LAB can save owned fields on legacy sessions whose missing subjectKey renders as an empty locked control',()=>{
 const api=load(),original={...baseSession,type:'LAB',topic:'TBD',labGroupIds:['g1']};
 delete original.subjectKey;
 const row={...plain(original),subjectKey:'',topic:'Venipuncture',labGroupIds:['g1','g2']};
 const plan=plain(api.planChanges([original],[row],{uid:'lab',role:'lab'},123,undefined,{role:'lab',activeSubjectKeys:[]}));
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.updates.length,1);
 assert.deepEqual(plan.updates[0].data,{topic:'Venipuncture',labGroupIds:['g1','g2']});
 assert.equal(Object.prototype.hasOwnProperty.call(plan.updates[0].data,'subjectKey'),false);
 const denied=api.planChanges([original],[{...row,subjectKey:'surgery'}],{uid:'lab',role:'lab'},123,undefined,{role:'lab',activeSubjectKeys:['surgery']});
 assert.ok(denied.errors.some(error=>/cannot change subjectKey/i.test(error)));
});

test('a Subject-only selection update does not request DOE recalculation',async()=>{
 const api=load(),original={...baseSession,subjectKey:''},row={...original,subjectKey:'surgery'};
 assert.equal(api.onlySubjectChanged(original,row),true);
 assert.equal(api.onlySubjectChanged(original,{...row,topic:'Changed'}),false);
 const plan=api.planChanges([original],[row],{uid:'adc',role:'adc'},123,undefined,{role:'adc',activeSubjectKeys:['surgery']});
 assert.deepEqual(plain(plan.errors),[]);
 const writes=[],store={batch:()=>({update:(ref,data)=>writes.push(['update',ref,data]),set:(ref,data)=>writes.push(['set',ref,data]),commit:async()=>{}}),sessionRef:id=>'sessions/'+id,
  calendarRef:id=>'calendar_sessions/'+id,calendarFromSource:(data,id)=>({sessionId:id,subjectKey:data.subjectKey}),logRef:()=> 'logs/a',queueRef:()=> 'doe/q',queueData:()=>({trigger:'subject-only'})};
 await api.commitPlan(plan,store);
 assert.equal(writes.some(write=>write[1]==='doe/q'),false);
});

test('selection module requires the canonical scheduling core',()=>{
 const context={window:{},Date};
 assert.throws(()=>vm.runInNewContext(fs.readFileSync(path.join(root,'timetable-selection.js'),'utf8'),context),/scheduling core/i);
});

test('selection persists by session id, toggles, clears, and enforces 200 limit',()=>{
 const selection=load().create(200);
 for(let i=1;i<=200;i++)assert.equal(selection.toggle(`s${i}`),true);
 assert.equal(selection.size,200);
 assert.equal(selection.has('s42'),true);
 assert.throws(()=>selection.toggle('s201'),/200/);
 assert.equal(selection.toggle('s42'),false);
 assert.equal(selection.has('s42'),false);
 assert.deepEqual(plain(selection.ids()).slice(0,2),['s1','s2']);
 selection.clear();assert.equal(selection.size,0);
});

test('row validation reports exact row and field failures',()=>{
 const api=load(),faculty=new Map([['1001',{__id:'1001',preferredFullName:'Alex Faculty'}]]);
 assert.deepEqual(plain(api.validateRow(baseSession,1,faculty)),[]);
 const invalid={...baseSession,date:'2026-02-30',year:5,course:' ',type:'',start:'10:00',end:'09:00',facultyIds:['missing'],assignments:[]};
 const errors=plain(api.validateRow(invalid,4,faculty));
 for(const text of ['Row 4: date','Row 4: year','Row 4: course','Row 4: type','Row 4: end time','Row 4: assigned faculty'])assert.ok(errors.some(error=>error.toLowerCase().includes(text.toLowerCase())),text);
});

test('row validation delegates timing to the core and preserves unknown-time sessions',()=>{
 const api=load(),faculty=new Map([['1001',true]]);
 assert.deepEqual(plain(api.validateRow({...baseSession,start:'10:00',end:'11:00'},1,faculty)),[]);
 assert.ok(api.validateRow({...baseSession,start:'10:00',end:'10:00'},1,faculty).some(error=>/end time/i.test(error)));
 assert.ok(api.validateRow({...baseSession,start:'11:00',end:'10:00'},1,faculty).some(error=>/end time/i.test(error)));
 assert.deepEqual(plain(api.validateRow({...baseSession,start:'',end:'',timeUnknown:true},1,faculty)),[]);
});

test('change planner suppresses unchanged rows and pairs each update with one audit log',()=>{
 const api=load(),actor={uid:'admin-1',email:'admin@ucalgary.ca',name:'Admin User'},timestamp={server:true};
 assert.equal(api.planChanges([baseSession],[plain(baseSession)],actor,timestamp).updates.length,0);
 const edited={...plain(baseSession),topic:'Updated topic',room:'B202',assignments:[{facultyId:'1002',name:'Blair Faculty',role:'Lecture'}],facultyIds:['1002']};
 const plan=plain(api.planChanges([baseSession],[edited],actor,timestamp));
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.updates.length,1);assert.equal(plan.logs.length,1);
 assert.equal(plan.updates[0].id,'s1');
 assert.deepEqual(plan.updates[0].data.facultyIds,['1002']);
 assert.equal(plan.logs[0].sessionId,'s1');
 assert.equal(plan.logs[0].action,'batch_update');
 assert.equal(plan.logs[0].changedBy,'admin-1');
 assert.equal(plan.logs[0].before.topic,'Passports');
 assert.equal(plan.logs[0].after.topic,'Updated topic');
 assert.deepEqual(plan.logs[0].changes.map(change=>change.field),['topic','room','assignments']);
 assert.deepEqual(plan.logs[0].changes.find(change=>change.field==='topic'),{field:'topic',label:'Topic',before:'Passports',after:'Updated topic'});
 assert.deepEqual(plan.logs[0].changes.find(change=>change.field==='assignments'),{field:'assignments',label:'Faculty',before:['Alex Faculty'],after:['Blair Faculty']});
});

test('batch selection restores the view that was active when selection began',()=>{
 const flow=load().createViewFlow();
 assert.equal(flow.begin('week'),'week');
 assert.equal(flow.review(),'list');
 assert.equal(flow.finish(),'week');
 assert.equal(flow.begin('month'),'month');
 assert.equal(flow.finish(),'month');
});

test('change planner returns errors without update or audit entries',()=>{
 const api=load(),bad={...plain(baseSession),id:'s1',start:'11:00',end:'10:00'};
 const plan=plain(api.planChanges([baseSession],[bad],{uid:'u'},123));
 assert.ok(plan.errors.some(error=>error.includes('Row 1')));
 assert.equal(plan.updates.length,0);assert.equal(plan.logs.length,0);
});

test('selected rows ignore normal filters, preserve selection order, and exclude CCC records',()=>{
 const api=load(),selection=api.create();selection.toggle('future-hidden');selection.toggle('visible');selection.toggle('ccc-row');
 const rows=api.selectedRows([{id:'visible'},{id:'ccc-row',isCcc:true},{id:'future-hidden'}],selection.ids());
 assert.deepEqual(plain(rows.map(row=>row.id)),['future-hidden','visible']);
});

test('read-only synthetic records cannot be selected by any office role',()=>{
 const api=load();
 for(const role of ['adfa_general','adc','lab']){
  assert.equal(api.editPolicy(role,{isUniversityClosure:true,type:'CLOSURE'}).canSelect,false);
  assert.equal(api.editPolicy(role,{isCcc:true,type:'CCC'}).canSelect,false);
 }
 const rows=api.selectedRows(
  [{id:'normal'},{id:'ccc',isCcc:true},{id:'closed',isUniversityClosure:true}],
  ['normal','ccc','closed']
 );
 assert.deepEqual(plain(rows.map(row=>row.id)),['normal']);
});

test('atomic save performs two paired operations per changed session and none for invalid plans',async()=>{
 const api=load(),operations=[],batch={update:(ref,data)=>operations.push(['update',ref,data]),set:(ref,data)=>operations.push(['set',ref,data]),commit:async()=>operations.push(['commit'])};
 let afterCommit=0;
 const store={batch:()=>batch,sessionRef:id=>`sessions/${id}`,logRef:()=>`logs/${operations.length}`,afterCommit:async()=>{afterCommit++}};
 const invalid=await api.commitPlan({updates:[],logs:[],errors:['Row 1: invalid']},store);
 assert.equal(invalid.committed,false);assert.equal(operations.length,0);
 const plan={errors:[],updates:[],logs:[]};for(let i=0;i<200;i++){plan.updates.push({id:`s${i}`,data:{topic:`T${i}`}});plan.logs.push({sessionId:`s${i}`,action:'batch_update'})}
 const result=await api.commitPlan(plan,store);
 assert.equal(result.committed,true);assert.equal(result.operations,400);assert.equal(operations.filter(x=>x[0]==='update').length,200);assert.equal(operations.filter(x=>x[0]==='set').length,200);assert.equal(operations.at(-1)[0],'commit');assert.equal(afterCommit,1);
});

test('ADC and LAB edit policies expose only their owned timetable fields',()=>{
 const api=load();
 const adc=plain(api.editPolicy('adc',{type:'LEC'}));
 assert.equal(adc.canSelect,true);
 for(const field of ['date','year','course','type','start','end','topic','room'])assert.equal(adc.fields[field],true,field);
 assert.equal(adc.fields.faculty,false);
 const adcLab=plain(api.editPolicy('adc',{type:'LAB'}));
 assert.equal(adcLab.fields.topic,false);
 const lab=plain(api.editPolicy('lab',{type:'LAB'}));
 // LAB works from the Work Queue, so it does not get unrestricted general selection.
 assert.equal(lab.canSelect,false);
 assert.equal(lab.fields.topic,true);
 for(const field of ['date','year','course','type','start','end','room','faculty'])assert.equal(lab.fields[field],false,field);
 const labNonLab=plain(api.editPolicy('lab',{type:'LEC'}));
 assert.equal(labNonLab.canSelect,false);
});

test('progressive commit keeps each source calendar and audit row together and reports progress',async()=>{
 const api=load(),commits=[],progress=[];
 const store={
  batch:()=>{const ops=[];return{update:(ref,data)=>ops.push(['update',ref,data]),set:(ref,data)=>ops.push(['set',ref,data]),commit:async()=>commits.push(ops)}} ,
  sessionRef:id=>`sessions/${id}`,
  calendarRef:id=>`calendar/${id}`,
  logRef:()=>`logs/${Math.random()}`,
  calendarFromSource:(row,id)=>({sessionId:id,topic:row.topic}),
  onProgress:p=>progress.push(p)
 };
 const plan={errors:[],updates:[],logs:[]};
 for(let i=0;i<45;i++){
  plan.updates.push({id:`s${i}`,data:{topic:`T${i}`},after:{id:`s${i}`,topic:`T${i}`}});
  plan.logs.push({sessionId:`s${i}`,action:'batch_update'});
 }
 const result=await api.commitPlan(plan,store,{chunkSize:20});
 assert.equal(result.committed,true);
 assert.equal(result.completedRows,45);
 assert.equal(commits.length,3);
 assert.deepEqual(commits.map(batch=>batch.length),[60,60,15]);
 assert.equal(commits[0][0][1],'sessions/s0');
 assert.equal(commits[0][1][1],'calendar/s0');
 assert.match(commits[0][2][1],/^logs\//);
 assert.deepEqual(progress.map(p=>p.completedRows),[20,40,45]);
});

test('commitPlan can keep a non-authoritative DOE queue request in the same source/calendar/audit batch',async()=>{
 const api=load(),commits=[];
 const store={
  batch:()=>{const ops=[];return{update:(ref,data)=>ops.push(['update',ref,data]),set:(ref,data)=>ops.push(['set',ref,data]),commit:async()=>commits.push(ops)}},
  sessionRef:id=>`sessions/${id}`,
  calendarRef:id=>`calendar/${id}`,
  logRef:()=>`logs/l1`,
  calendarFromSource:(row,id)=>({sessionId:id,topic:row.topic}),
  queueRef:()=>({id:'q1',path:'doe_recalculation_requests/q1'}),
  queueData:(update,log,ref)=>({requestId:ref.id,sessionId:update.id,status:'pending',requestedAt:log.changedAt})
 };
 const plan={errors:[],updates:[{id:'s1',data:{topic:'New'},after:{id:'s1',topic:'New'}}],logs:[{sessionId:'s1',changedAt:'STAMP'}]};
 const result=await api.commitPlan(plan,store);
 assert.equal(result.committed,true);assert.equal(result.operations,4);
 assert.equal(commits.length,1);assert.equal(commits[0].length,4);
 assert.equal(commits[0][0][1],'sessions/s1');assert.equal(commits[0][1][1],'calendar/s1');assert.equal(commits[0][2][1],'logs/l1');
 assert.equal(commits[0][3][1].path,'doe_recalculation_requests/q1');assert.equal(commits[0][3][2].status,'pending');
});

test('progressive commit stops after a failed batch and exposes a resumable row offset',async()=>{
 const api=load();let attempt=0;
 const store={
  batch:()=>{const ops=[];return{update:(ref,data)=>ops.push(['update',ref,data]),set:(ref,data)=>ops.push(['set',ref,data]),commit:async()=>{attempt++;if(attempt===2)throw Error('network')}}},
  sessionRef:id=>`sessions/${id}`,calendarRef:id=>`calendar/${id}`,logRef:()=>`logs/${Math.random()}`,calendarFromSource:(row,id)=>({sessionId:id,topic:row.topic})
 };
 const plan={errors:[],updates:[],logs:[]};for(let i=0;i<25;i++){plan.updates.push({id:`s${i}`,data:{topic:`T${i}`},after:{id:`s${i}`,topic:`T${i}`}});plan.logs.push({sessionId:`s${i}`})}
 await assert.rejects(()=>api.commitPlan(plan,store,{chunkSize:20}),error=>{
  assert.equal(error.partialCommit,true);
  assert.equal(error.completedRows,20);
  assert.equal(error.resumeFrom,20);
  return true;
 });
});

test('ADC change planning writes only public owned fields and forces LAB topic to TBD',()=>{
 const api=load(),original={...plain(baseSession),type:'LEC',topic:'Lecture topic',instructor:'Alex Faculty'};
 const edited={...plain(original),type:'LAB',topic:'should not persist',date:'2026-10-08'};
 const plan=plain(api.planChanges([original],[edited],{uid:'adc-1',name:'ADC'},123,new Map(),{role:'adc'}));
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.updates.length,1);
 assert.equal(plan.updates[0].data.type,'LAB');
 assert.equal(plan.updates[0].data.topic,'TBD');
 for(const privateField of ['assignments','facultyIds','instructor','labDetails'])assert.equal(Object.hasOwn(plan.updates[0].data,privateField),false,privateField);
});

test('LAB change planning requires an assigned group, allows owned LAB fields, and rejects non-LAB rows',()=>{
 const api=load(),lab={...plain(baseSession),type:'LAB',topic:'Old',instructor:'Alex Faculty',labGroupIds:['g-a']};
 const edited={...plain(lab),topic:'New'};
 const plan=plain(api.planChanges([lab],[edited],{uid:'lab-1',name:'LAB'},123,new Map(),{role:'lab'}));
 assert.deepEqual(plan.errors,[]);
 assert.deepEqual(plan.updates[0].data,{topic:'New'});
 // A locked field is refused explicitly rather than silently dropped.
 const missingGroup=plain(api.planChanges([{...plain(lab),labGroupIds:[]}],[{...plain(lab),labGroupIds:[],topic:'New'}],{uid:'lab-1'},123,new Map(),{role:'lab'}));
 assert.ok(missingGroup.errors.some(error=>/at least one LAB group is required/i.test(error)),JSON.stringify(missingGroup.errors));
 const locked=plain(api.planChanges([lab],[{...plain(lab),topic:'New',room:'Blocked'}],{uid:'lab-1'},123,new Map(),{role:'lab'}));
 assert.ok(locked.errors.some(error=>/LAB cannot change room/i.test(error)),JSON.stringify(locked.errors));
 const nonLab=plain(api.planChanges([baseSession],[{...plain(baseSession),topic:'Nope'}],{uid:'lab-1'},123,new Map(),{role:'lab'}));
 assert.ok(nonLab.errors.some(error=>/LAB sessions only/i.test(error)));
});

test('client batch writer rejects DOE calculation evidence so authoritative records stay server-side',async()=>{
 const api=load(),commits=[];
 const store={
  batch:()=>{const ops=[];return{update:(ref,data)=>ops.push(['update',ref,data]),set:(ref,data)=>ops.push(['set',ref,data]),commit:async()=>commits.push(ops)}},
  sessionRef:id=>`sessions/${id}`,
  calendarRef:id=>`calendar/${id}`,
  logRef:()=>`logs/1`,
  calendarFromSource:(row,id)=>({sessionId:id,topic:row.topic})
 };
 const record={calculationId:'calc-1',sessionId:'s1',assignmentId:'a1',resultDoe:.84};
 const plan={errors:[],updates:[{id:'s1',data:{topic:'T1'},after:{id:'s1',topic:'T1'},calculationRecords:[record]}],logs:[{sessionId:'s1',action:'batch_update'}]};
 await assert.rejects(()=>api.commitPlan(plan,store),/server-side DOE API/i);
 assert.equal(commits.length,0);
});


test('Developer selection policy exposes every editable timetable field',()=>{
 const api=load(),policy=plain(api.editPolicy('developer',{type:'LAB'}));
 assert.equal(policy.canSelect,true);
 for(const field of Object.keys(policy.fields))assert.equal(policy.fields[field],true,field);
});

test('trusted config path can set stable Teaching Assignment ownership and derives ta-sub-v2 locator',()=>{
 const api=load(),original={...baseSession,course:'VTMD 204',semester:'fall'},row={...original,teachingAssignmentGroupId:'bovine',responsibleHiccResponsibilityId:'hicc-bovine'};
 const groups=[{id:'bovine',name:'Bovine',leaderViscResponsibilityId:'visc-bovine',hiccResponsibilityIds:['hicc-bovine'],active:true}];
 const responsibilities=[
  {id:'visc-bovine',kind:'visc',label:'Bovine VISC',active:true},
  {id:'hicc-bovine',kind:'hicc',groupId:'bovine',label:'Bovine HICC',academicScopeTokens:['hicc|VTMD 204|*'],active:true}
 ];
 const plan=plain(api.planChanges([original],[row],{uid:'adc',role:'adc'},123,undefined,{role:'adc',allowTeachingAssignmentOwnership:true,teachingAssignmentGroups:groups,teachingResponsibilities:responsibilities}));
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.updates[0].data.teachingAssignmentGroupId,'bovine');
 assert.equal(plan.updates[0].data.responsibleHiccResponsibilityId,'hicc-bovine');
 assert.match(plan.updates[0].data.teachingAssignmentSubmissionId,/^ta-sub-v2__/);
 assert.equal(plan.logs[0].changes.some(change=>change.field==='teachingAssignmentSubmissionId'),true);
});

test('HICC VISC and ordinary Faculty cannot self-reassign trusted ownership',()=>{
 const api=load(),original={...baseSession,semester:'fall',teachingAssignmentGroupId:'bovine',responsibleHiccResponsibilityId:'hicc-bovine',teachingAssignmentSubmissionId:'ta-sub-v2__2026-27__bovine__hicc-bovine'};
 const changed={...original,responsibleHiccResponsibilityId:'hicc-other'};
 for(const role of ['hicc','visc','faculty']){
  const plan=api.planChanges([original],[changed],{uid:role,role},123,undefined,{role});
  assert.ok(plan.errors.some(error=>/cannot change responsibleHiccResponsibilityId/i.test(error)),role);
 }
});

test('trusted ownership fails closed for partial missing or out-of-group identities',()=>{
 const api=load(),original={...baseSession,course:'VTMD 204',semester:'fall'},responsibilities=[
  {id:'visc-bovine',kind:'visc',label:'Bovine VISC',active:true},
  {id:'hicc-bovine',kind:'hicc',groupId:'bovine',label:'Bovine HICC',academicScopeTokens:['hicc|VTMD 204|*'],active:true},
  {id:'hicc-equine',kind:'hicc',groupId:'equine',label:'Equine HICC',academicScopeTokens:['hicc|VTMD 204|*'],active:true}
 ],groups=[{id:'bovine',name:'Bovine',leaderViscResponsibilityId:'visc-bovine',hiccResponsibilityIds:['hicc-bovine'],active:true}];
 const options={role:'adc',allowTeachingAssignmentOwnership:true,teachingAssignmentGroups:groups,teachingResponsibilities:responsibilities};
 assert.ok(api.planChanges([original],[{...original,teachingAssignmentGroupId:'bovine'}],{role:'adc'},123,undefined,options).errors.some(error=>/set together/i.test(error)));
 assert.ok(api.planChanges([original],[{...original,teachingAssignmentGroupId:'missing',responsibleHiccResponsibilityId:'hicc-bovine'}],{role:'adc'},123,undefined,options).errors.some(error=>/active Teaching Assignment group/i.test(error)));
 assert.ok(api.planChanges([original],[{...original,teachingAssignmentGroupId:'bovine',responsibleHiccResponsibilityId:'hicc-equine'}],{role:'adc'},123,undefined,options).errors.some(error=>/does not belong/i.test(error)));
});

test('trusted caller cannot forge the derived Teaching Assignment submission locator',()=>{
 const api=load(),original={...baseSession,course:'VTMD 204',semester:'fall',teachingAssignmentGroupId:'bovine',responsibleHiccResponsibilityId:'hicc-bovine',teachingAssignmentSubmissionId:'ta-sub-v2__2026-27__bovine__hicc-bovine'};
 const row={...original,teachingAssignmentSubmissionId:'forged-package'};
 const groups=[{id:'bovine',name:'Bovine',leaderViscResponsibilityId:'visc-bovine',hiccResponsibilityIds:['hicc-bovine'],active:true}],responsibilities=[{id:'visc-bovine',kind:'visc',label:'Bovine VISC'},{id:'hicc-bovine',kind:'hicc',groupId:'bovine',label:'Bovine HICC',academicScopeTokens:['hicc|VTMD 204|*']}];
 const plan=api.planChanges([original],[row],{uid:'adc',role:'adc'},123,undefined,{role:'adc',allowTeachingAssignmentOwnership:true,teachingAssignmentGroups:groups,teachingResponsibilities:responsibilities});
 assert.ok(plan.errors.some(error=>/cannot change teachingAssignmentSubmissionId/i.test(error)));
});

test('Teaching Assignment ownership-only update does not request DOE recalculation',async()=>{
 const api=load(),original={...baseSession,course:'VTMD 204',semester:'fall'},row={...original,teachingAssignmentGroupId:'bovine',responsibleHiccResponsibilityId:'hicc-bovine'};
 const groups=[{id:'bovine',name:'Bovine',leaderViscResponsibilityId:'visc-bovine',hiccResponsibilityIds:['hicc-bovine'],active:true}],responsibilities=[{id:'visc-bovine',kind:'visc',label:'Bovine VISC'},{id:'hicc-bovine',kind:'hicc',groupId:'bovine',label:'Bovine HICC',academicScopeTokens:['hicc|VTMD 204|*']}];
 const plan=api.planChanges([original],[row],{uid:'adc',role:'adc'},123,undefined,{role:'adc',allowTeachingAssignmentOwnership:true,teachingAssignmentGroups:groups,teachingResponsibilities:responsibilities});
 assert.deepEqual(plain(plan.errors),[]);
 assert.equal(api.onlyNonDoeMetadataChanged(plan.logs[0].before,plan.logs[0].after),true);
 const writes=[],store={batch:()=>({update:(ref,data)=>writes.push(['update',ref,data]),set:(ref,data)=>writes.push(['set',ref,data]),commit:async()=>{}}),sessionRef:id=>'sessions/'+id,calendarRef:id=>'calendar/'+id,calendarFromSource:(data,id)=>({sessionId:id,course:data.course}),logRef:()=> 'logs/a',queueRef:()=> 'doe/q',queueData:()=>({trigger:'ownership-only'})};
 await api.commitPlan(plan,store);
 assert.equal(writes.some(write=>write[1]==='doe/q'),false);
});
