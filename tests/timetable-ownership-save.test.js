'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const calendar=require('../calendar-session.js');
const plain=value=>JSON.parse(JSON.stringify(value));
function load(){
 const window={UCVM:{general:profile=>['developer','owner','adfa_general'].includes(profile?.role)}};
 const context={window,Date};
 for(const file of ['scheduling-core','office-capabilities','session-workflow','subject-catalog','temporal-role-assignment','academic-responsibility','teaching-responsibility','teaching-assignment-groups','timetable-selection'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file+'.js'),'utf8'),context);
 return window.UCVM_TIMETABLE_SELECTION;
}
const source={id:'s1',course:'VTMD 505',courseName:'Surgery',subjectKey:'surgery',year:1,semester:'fall',week:1,date:'2026-10-01',start:'09:00',end:'10:00',timeUnknown:false,type:'LEC',topic:'Surgery',room:'A1',instructor:'Faculty A',assignments:[{facultyId:'private-faculty',ucid:'private-ucid',name:'Faculty A',role:'LEC'}],facultyIds:['private-faculty'],labGroupIds:[]};
const group={id:'surgery',name:'Surgery',active:true,leaderViscResponsibilityId:'visc-surgery',hiccResponsibilityIds:['hicc-surgery']};
const definitions=[{id:'visc-surgery',kind:'visc',active:true},{id:'hicc-surgery',kind:'hicc',groupId:'surgery',active:true,academicScopeTokens:['hicc|VTMD 505|surgery']}];
const packageId='ta-sub-v2__2026-27__surgery__hicc-surgery';
const ownership={academicYear:'2026-27',teachingAssignmentGroupId:group.id,responsibleHiccResponsibilityId:'hicc-surgery',teachingAssignmentSubmissionId:packageId};
function draft(patch={}){return{id:packageId,academicYearKey:'2026-27',groupId:'surgery',hiccResponsibilityId:'hicc-surgery',viscResponsibilityId:'visc-surgery',status:'draft',revision:0,workingRevision:0,submittedWorkingRevision:null,viscApprovedWorkingRevision:null,reviewFingerprint:'',viscApprovedFingerprint:'',viscReviewComment:'',submittedForReviewAt:null,viscReviewedAt:null,finalSubmittedAt:null,updatedBy:'owner',updatedAt:123,...patch};}
function fakeDb({role='owner',profile={},rows=[source],packages=[]}={}){
 const data=new Map([['users/actor',{role,active:true,mustChangePassword:false,...profile}],['teaching_assignment_groups/surgery',group],...definitions.map(row=>['teaching_responsibilities/'+row.id,row]),...rows.flatMap(row=>[['sessions/'+row.id,plain(row)],['calendar_sessions/'+row.id,calendar.fromSource(row,row.id)]]),...packages.map(row=>['teaching_assignment_submissions/'+row.id,row])]);
 let nextId=0;
 const db={data,reads:[],commits:[],beforeCommit:null,collection:name=>({doc:id=>({path:name+'/'+(id||'log'+(++nextId))})}),async runTransaction(callback){
  for(let attempt=0;attempt<3;attempt++){
   const writes=[];
   const tx={get:async ref=>{assert.equal(writes.length,0,'all reads precede writes');db.reads.push(ref.path);const value=data.get(ref.path);return{exists:value!==undefined,data:()=>value===undefined?undefined:plain(value)};},set:(ref,row)=>writes.push(['set',ref.path,plain(row)]),update:(ref,row)=>writes.push(['update',ref.path,plain(row)])};
   const result=await callback(tx);
   if(db.beforeCommit&&await db.beforeCommit(writes,attempt)==='retry')continue;
   for(const [kind,key,row] of writes){if(kind==='update')assert.ok(data.has(key),key);data.set(key,kind==='update'?{...data.get(key),...row}:row);}
   db.commits.push(writes);return result;
  }throw Error('transaction retries exhausted');
 }};return db;
}
function plan(api,original=source,patch=ownership,role='ta_config'){
 return api.planChanges([original],[{...original,...patch,teachingAssignmentSubmissionId:original.teachingAssignmentSubmissionId}],{uid:'actor',role},123,undefined,{role,allowTeachingAssignmentOwnership:true,teachingAssignmentGroups:[group],teachingResponsibilities:definitions});
}
function adapter(api,db,ready=true){return api.createOwnershipAdapter({db,actor:{uid:'actor'},configurationReady:()=>ready,calendarFromSource:calendar.fromSource,sessionCollection:'sessions',logCollection:'session_change_logs'});}
function storeFor(adapter){return{batch:()=>{throw Error('ownership must not use a legacy batch')},commitOwnership:(update,log)=>adapter.save(update,log)};}
test('single-session and batch editors share the review-relevant package revision calculation',()=>{
 const api=load(),before={...source,...ownership},after={...before,subjectKey:'another'},increment=value=>({increment:value});
 assert.equal(api.workingRevisionChange(before,before,{uid:'adc'},123,increment),null);
 assert.equal(api.workingRevisionChange(before,{...before,labGroupIds:['g1']},{uid:'lab'},123,increment),null);
 assert.equal(api.workingRevisionChange(source,{...source,topic:'New'},{uid:'adc'},123,increment),null);
 assert.deepEqual(plain(api.workingRevisionChange(before,after,{uid:'adc'},123,increment)),{id:packageId,data:{workingRevision:{increment:1},workingChange:{kind:'session',id:'s1'},updatedBy:'adc',updatedAt:123}});
});
test('ordinary owned content saves advance each affected package once per atomic batch without invalidating roster-only changes',async()=>{
 const api=load(),originals=['s1','s2'].map(id=>({...source,...ownership,id})),rows=originals.map(row=>({...row,topic:'Revised topic'}));
 const p=api.planChanges(originals,rows,{uid:'adc',role:'adc'},123,undefined,{role:'adc'}),writes=[];
 const store={batch:()=>({update:(ref,data)=>writes.push([ref,plain(data)]),set:(ref,data)=>writes.push([ref,plain(data)]),commit:async()=>{}}),sessionRef:id=>'sessions/'+id,logRef:()=> 'audit/log',packageRef:id=>'packages/'+id,increment:value=>({increment:value})};
 await api.commitPlan(p,store);
 const counters=writes.filter(([ref])=>ref.startsWith('packages/'));assert.equal(counters.length,1);
 assert.deepEqual(counters[0],[`packages/${packageId}`,{workingRevision:{increment:1},workingChange:{kind:'session',id:'s1'},updatedBy:'adc',updatedAt:123}]);
 writes.length=0;
 const lab={...originals[0],type:'LAB'},roster=api.planChanges([lab],[{...lab,labGroupIds:['g1']}],{uid:'lab',role:'lab'},123,undefined,{role:'lab'});
 await api.commitPlan(roster,store);assert.equal(writes.some(([ref])=>ref.startsWith('packages/')),false);
});

test('ownership attachment derives and persists academicYear and refuses clearing or mixed content edits',()=>{
 const api=load(),p=plan(api,source,{teachingAssignmentGroupId:'surgery',responsibleHiccResponsibilityId:'hicc-surgery'});
 assert.deepEqual(plain(p.errors),[]);assert.equal(p.updates[0].data.academicYear,'2026-27');
 const clear=plan(api,{...source,...ownership},{teachingAssignmentGroupId:'',responsibleHiccResponsibilityId:''});
 assert.match(clear.errors.join(' '),/clear.*ownership/i);
 const mixed=plan(api,source,{teachingAssignmentGroupId:'surgery',responsibleHiccResponsibilityId:'hicc-surgery',topic:'Other'},'adc');
 assert.match(mixed.errors.join(' '),/ownership.*separately/i);
});

test('calendar exposes only scalar trusted ownership locators, never package review or private fields',()=>{
 const projected=calendar.fromSource({...source,...ownership,workingRevision:9,reviewFingerprint:'private',actorUid:'private'},'s1');
 for(const [key,value] of Object.entries(ownership).filter(([key])=>key!=='teachingAssignmentSubmissionId'))assert.equal(projected[key],value,key);
 for(const key of ['assignments','facultyIds','workingRevision','reviewFingerprint','actorUid','teachingAssignmentSubmissionId'])assert.equal(key in projected,false,key);
 const malformed=calendar.fromSource({...source,academicYear:{private:true},teachingAssignmentGroupId:['private'],responsibleHiccResponsibilityId:123,teachingAssignmentSubmissionId:{private:true}});
 for(const key of Object.keys(ownership))assert.equal(key in malformed,false,key);
});

test('first ownership attachment creates an empty draft before atomically saving source calendar audit and counter',async()=>{
 const api=load(),db=fakeDb(),p=plan(api,source,{teachingAssignmentGroupId:'surgery',responsibleHiccResponsibilityId:'hicc-surgery'});
 const result=await api.commitPlan(p,storeFor(adapter(api,db)));
 assert.equal(result.completedRows,1);
 assert.equal(db.commits.length,2);
 assert.deepEqual(db.commits[0],[['set','teaching_assignment_submissions/'+packageId,draft({updatedBy:'actor'})]]);
 const writes=db.commits[1];assert.equal(writes.length,4);
 assert.equal(db.data.get('teaching_assignment_submissions/'+packageId).workingRevision,1);
 assert.deepEqual(db.data.get('teaching_assignment_submissions/'+packageId).workingChange,{kind:'session',id:'s1'});
 assert.deepEqual(db.data.get('sessions/s1').assignments,source.assignments);
 assert.deepEqual(db.data.get('calendar_sessions/s1').instructorNames,['Faculty A']);
 assert.equal('teachingAssignmentSubmissionId' in db.data.get('calendar_sessions/s1'),false);
 assert.equal(writes.some(write=>write[1].includes('doe')),false);
 assert.deepEqual(Object.keys(writes.find(write=>write[1]==='sessions/s1')[2]).sort(),[...Object.keys(ownership),'updatedAt','updatedBy'].sort());
});

test('ADC attachment reads sanitized calendar and never private sessions or faculty',async()=>{
 const api=load(),db=fakeDb({role:'adc'}),original={id:'s1',...calendar.fromSource(source,'s1')},p=plan(api,original,{teachingAssignmentGroupId:'surgery',responsibleHiccResponsibilityId:'hicc-surgery'},'adc');
 await api.commitPlan(p,storeFor(adapter(api,db)));
 assert.equal(db.reads.some(ref=>/^(sessions|faculty)\//.test(ref)),false);
 const audit=[...db.data].find(([key])=>key.startsWith('session_change_logs/'))[1];
 assert.equal(JSON.stringify(audit).includes('private-'),false);
 assert.deepEqual(db.data.get('sessions/s1').assignments,source.assignments);
});

test('ownership save rejects untrusted roles, failed configuration evidence, stale source and changed definitions',async()=>{
 const api=load(),p=plan(api,source,{teachingAssignmentGroupId:'surgery',responsibleHiccResponsibilityId:'hicc-surgery'});
 for(const role of ['administrator','hicc','visc','faculty','other_office']){
  const db=fakeDb({role});await assert.rejects(()=>api.commitPlan(p,storeFor(adapter(api,db))),/ownership permission/i);assert.equal(db.commits.length,0,role);
 }
 const unavailable=fakeDb();await assert.rejects(()=>api.commitPlan(p,storeFor(adapter(api,unavailable,false))),/configuration.*unavailable/i);assert.equal(unavailable.commits.length,0);
 const stale=fakeDb();stale.data.get('sessions/s1').topic='Changed';await assert.rejects(()=>api.commitPlan(p,storeFor(adapter(api,stale))),/changed.*reopen/i);assert.equal(stale.commits.length,0);
 const changed=fakeDb();changed.data.set('teaching_responsibilities/hicc-surgery',{...definitions[1],active:false});await assert.rejects(()=>api.commitPlan(p,storeFor(adapter(api,changed))),/active/i);assert.equal(changed.commits.length,0);
});

test('rehome advances both packages from transaction snapshots and rejects either frozen package',async()=>{
 const api=load(),oldId='ta-sub-v2__2026-27__surgery__hicc-old',oldOwnership={...ownership,responsibleHiccResponsibilityId:'hicc-old',teachingAssignmentSubmissionId:oldId},original={...source,...oldOwnership},p=plan(api,original,{responsibleHiccResponsibilityId:'hicc-surgery'});
 const oldPackage=draft({id:oldId,hiccResponsibilityId:'hicc-old',workingRevision:4}),newPackage=draft({workingRevision:8});
 for(const frozen of [false,'old','new']){
  const db=fakeDb({rows:[original],packages:[{...oldPackage,...(frozen==='old'?{status:'visc_review'}:{})},{...newPackage,...(frozen==='new'?{status:'final_submitted'}:{})}]});
  db.data.set('teaching_assignment_groups/surgery',{...group,hiccResponsibilityIds:['hicc-surgery','hicc-old']});db.data.set('teaching_responsibilities/hicc-old',{...definitions[1],id:'hicc-old'});
  if(frozen){await assert.rejects(()=>api.commitPlan(p,storeFor(adapter(api,db))),/frozen/i);assert.equal(db.commits.flat().length,0);continue;}
  let retried=false;db.beforeCommit=(writes)=>{if(!retried&&writes.some(write=>write[1]==='sessions/s1')){retried=true;db.data.set('teaching_assignment_submissions/'+packageId,{...newPackage,workingRevision:11});return'retry';}};
  await api.commitPlan(p,storeFor(adapter(api,db)));
  assert.equal(db.data.get('teaching_assignment_submissions/'+oldId).workingRevision,5);assert.equal(db.data.get('teaching_assignment_submissions/'+packageId).workingRevision,12);
 }
});

test('selected ownership rows retain partial progress and resume without duplicate counters or audits',async()=>{
 const api=load(),rows=[source,{...source,id:'s2'}],db=fakeDb({rows}),plans=rows.map(row=>plan(api,row,{teachingAssignmentGroupId:'surgery',responsibleHiccResponsibilityId:'hicc-surgery'})),p={updates:plans.flatMap(row=>row.updates),logs:plans.flatMap(row=>row.logs),errors:[]};
 db.beforeCommit=writes=>{if(writes.some(write=>write[1]==='sessions/s2'))throw Error('connection failed');};
 await assert.rejects(()=>api.commitPlan(p,storeFor(adapter(api,db)),{chunkSize:20}),error=>{assert.equal(error.completedRows,1);assert.equal(error.resumeFrom,1);assert.equal(error.partialCommit,true);return true;});
 assert.equal(db.data.get('teaching_assignment_submissions/'+packageId).workingRevision,1);
 db.beforeCommit=null;const result=await api.commitPlan(p,storeFor(adapter(api,db)),{resumeFrom:1,chunkSize:20});assert.equal(result.completedRows,2);
 assert.equal(db.data.get('teaching_assignment_submissions/'+packageId).workingRevision,2);assert.equal([...db.data.keys()].filter(key=>key.startsWith('session_change_logs/')).length,2);
});
