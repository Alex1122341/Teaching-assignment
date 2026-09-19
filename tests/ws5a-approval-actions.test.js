'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path'),sourceFunction=require('../test-support/source-function');
function load(name){const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context);return context.window;}
const scheduling=load('scheduling-core.js').UCVM_SCHEDULING;
const policyFile=fs.existsSync(path.join(__dirname,'..','approval-scheduling.js'))?'approval-scheduling.js':'approval-workflow.js';
const approvalScheduling=load(policyFile).UCVM_APPROVAL_SCHEDULING;
const plain=x=>JSON.parse(JSON.stringify(x));
function harness(kind,{accept=true,otherStart='09:30',otherEnd='10:30',stale=false,unknown=false,edit=false}={}){
 const current={id:'s1',date:'2026-10-01',start:'09:00',end:'10:00',timeUnknown:unknown,course:'304',type:'LEC',topic:'Original',room:'A',assignments:[{ucid:'f1',name:'Outgoing',doeCredit:0.3}]};
 const request={id:'r1',status:'pending',requestType:edit?'session_edit':'faculty_swap',sessionId:'s1',fromFaculty:{facultyId:'f1',name:'Outgoing'},toFaculty:{facultyId:'f2',name:'Incoming',candidateKey:'opaque'},base:{...current},reason:'Test'};
 if(edit){request.patch={start:'bad',end:'10:00'};request.changes=[{field:'start',before:'09:00',after:'bad'}];}if(stale)request.base.topic='Old';
 const peer={id:'s2',date:current.date,start:otherStart,end:otherEnd,course:'315',assignments:[{ucid:'f2',name:'Incoming'}],privateNote:'DO NOT LEAK'},faculty={__id:'f2',preferredFullName:'Incoming',awayFromCampusRecords:[]};
 const writes=[],prompts=[],messages=[],order=[],snap=(id,data)=>({id,exists:!!data,data:()=>data});
 const ref=path=>({path,id:path.split('/').pop(),get:async()=>{order.push(`read:${path}`);return snap(path.split('/').pop(),path==='sessions/s1'?current:path==='change_requests/r1'?request:null)}});
 const batch={set:(r,data)=>writes.push({method:'set',path:r.path,data:plain(data)}),update:(r,data)=>writes.push({method:'update',path:r.path,data:plain(data)}),commit:async()=>order.push('commit')};
 const db={doc:ref,collection:name=>({doc:id=>ref(`${name}/${id||'log1'}`),where:()=>({get:async()=>({docs:[snap('s1',current),snap('s2',peer)]})})}),batch:()=>batch};
 const doeApi={
  previewFacultyTransfer:async()=>({session:{...current,assignments:current.assignments.map(a=>({...a}))},sessionDoeCredit:0.3,incomingDoeCredit:0.3,outgoing:{facultyId:'f1'},incoming:{facultyId:'f2',currentAssignedDoe:1,projectedAssignedDoe:1.3},facultyImpacts:[],calculationRecords:[]}),
  saveSessionChange:async payload=>({session:{...payload.afterSession},doeChanges:[]})
 };
 const context={window:{},db,doeApi,UCVM:{admin:()=>true},UCVM_DATA_INDEX:{sessionFacultyIds:s=>s.assignments.map(a=>a.ucid)},scheduling,approvalScheduling,SESSIONS:'sessions',REQUESTS:'change_requests',LOGS:'session_change_log',user:{uid:'admin1',email:'admin@example.test'},profile:{name:'Admin'},me:{name:'Admin'},requests:[request],sessions:new Map([['s1',current],['s2',peer]]),console,isApprover:()=>true,ensureRequestSessions:async()=>{},ensureApprovalFaculty:async()=>{},ensureFacultySessionContext:async()=>{},resolveFaculty:()=>faculty,sessionHasFaculty:(s,f)=>s.assignments.some(a=>a.ucid===f.__id),facultyName:f=>f?.preferredFullName||'',resolveCandidate:async()=>({faculty,facultyId:'f2',name:'Incoming',special:false}),facultyAliases:()=>new Set(['incoming']),norm:v=>String(v||'').toLowerCase(),ymd:v=>String(v||'').slice(0,10),sameVal:(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null),confirm:message=>{prompts.push(message);order.push('confirm');return accept},stamp:()=> 'SERVER_TIME',toast:message=>messages.push(message),closeModal:()=>{},assignedArray:s=>(s.assignments||[]).map(a=>({...a}))};
 vm.createContext(context);
 const names=kind==='safe'?['specialReplacement','specialLabel','findOutgoingIndex','safeConflictLabel','liveIncomingWarnings','safeApproveRequest']:['timetableCheck','afcCheck','availabilityFor','conflictLabel','availabilityDetail','validateBase','approvalWarnings','approvalConflictOverride','approveRequest'];
 const file=kind==='safe'?'faculty-swap-safe.js':'approval-workflow.js',source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const legacyHelpers=['timeMinutes','overlaps'].filter(name=>source.includes(`function ${name}(`));
 vm.runInContext([...legacyHelpers,...names].map(name=>sourceFunction(file,name)).join('\n'),context);
 return{writes,prompts,messages,order,run:()=>context[kind==='safe'?'safeApproveRequest':'approveRequest']('r1')};
}
for(const kind of ['safe','legacy']){
 test(`${kind} cancellation performs no writes`,async()=>{const h=harness(kind,{accept:false});await h.run();assert.equal(h.writes.length,0);assert.equal(h.prompts.length,1);assert.match(h.prompts[0],/override/i);});
 test(`${kind} confirmation records actor, server timestamp and sanitized conflicts`,async()=>{const h=harness(kind);await h.run();const log=h.writes.find(w=>w.path==='session_change_log/log1');assert.ok(log);assert.equal(log.data.override?.confirmed,true);assert.equal(log.data.override.confirmedBy,'admin1');assert.equal(log.data.override.confirmedAt,'SERVER_TIME');assert.deepEqual(log.data.override.conflicts,[{id:'s2',course:'315',date:'2026-10-01',start:'09:30',end:'10:30'}]);assert.doesNotMatch(JSON.stringify(log.data.override),/DO NOT LEAK|doeCredit|ucid|example.test/);assert.ok(h.order.indexOf('read:sessions/s1')<h.order.indexOf('confirm'));});
 test(`${kind} adjacent session needs no conflict override`,async()=>{const h=harness(kind,{otherStart:'10:00',otherEnd:'11:00'});await h.run();assert.doesNotMatch(h.prompts[0],/conflict detected|override and approve/i);assert.equal(h.writes.find(w=>w.path==='session_change_log/log1').data.override??null,null);});
 test(`${kind} stale request is blocked before prompting or writing`,async()=>{const h=harness(kind,{stale:true});await h.run();assert.equal(h.prompts.length,0);assert.equal(h.writes.length,0);assert.ok(h.messages.some(x=>/changed|blocked/i.test(x)));});
 test(`${kind} unknown target is warned but not recorded as confirmed overlap`,async()=>{const h=harness(kind,{unknown:true});await h.run();assert.match(h.prompts[0],/not specified|incomplete|check needed|unknown/i);assert.equal(h.writes.find(w=>w.path==='session_change_log/log1').data.override??null,null);});
}
test('legacy rejects invalid proposed timing before confirmation',async()=>{const h=harness('legacy',{edit:true});await h.run();assert.equal(h.prompts.length,0);assert.equal(h.writes.length,0);assert.ok(h.messages.some(x=>/valid|time/i.test(x)));});
