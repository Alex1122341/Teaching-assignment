'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sourceFunction=require('../test-support/source-function');
const root=path.resolve(__dirname,'..');
function loadCore(){const context={window:{},Date};vm.runInNewContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);return context.window.UCVM_SCHEDULING;}
function timetable(names,extra={}){const context={window:{},scheduling:loadCore(),...extra};vm.createContext(context);vm.runInContext(names.map(name=>sourceFunction('timetable.js',name)).join('\n'),context);return context;}

test('unknown target timing remains check_needed even with plausible stored times or no peers',()=>{assert.equal(loadCore().findFacultyConflicts({date:'2026-10-01',start:'09:00',end:'10:00',timeUnknown:true}).status,'check_needed');});
test('a row without an id is not excluded when no exclusion is requested',()=>{assert.equal(loadCore().findFacultyConflicts({date:'2026-10-01',start:'09:00',end:'10:00',sessions:[{date:'2026-10-01',start:'09:30',end:'10:30'}],isAssigned:()=>true}).status,'conflict');});
test('calendar layout never positions unknown, reversed, or malformed intervals',()=>{
 const api=timetable(['timeToMinutes','layoutDaySessions']);
 const rows=api.layoutDaySessions([{id:'valid',start:'09:00',end:'10:00'},{id:'adjacent',start:'10:00',end:'11:00'},{id:'unknown',start:'09:00',end:'10:00',timeUnknown:true},{id:'bad',start:'bad',end:'10:00'},{id:'reverse',start:'11:00',end:'10:00'}]);
 assert.deepEqual(Array.from(rows,r=>r.session.id),['valid','adjacent']);assert.ok(rows.every(row=>row.laneCount===1&&Number.isFinite(row.startM)&&Number.isFinite(row.endM)));
});
test('duration fallback preserves null and explicit credited hours including zero',()=>{
 const api=timetable(['blockHours','swapNumeric','swapAssignmentHours','defaultTeachingRole','finalizeInstructorAssignments']);
 assert.equal(api.blockHours('bad','10:00'),null);assert.equal(api.blockHours('09:00','10:00',{timeUnknown:true}),null);
 assert.equal(api.swapAssignmentHours({},{start:'bad',end:'10:00'}),null);assert.equal(api.swapAssignmentHours({creditedHours:0},{timeUnknown:true}),0);assert.equal(api.swapAssignmentHours({creditedHours:2},{start:'09:00',end:'10:00'}),2);
 const unrated=api.finalizeInstructorAssignments([{name:'Faculty',creditedHours:null}],'LEC','bad','10:00','Topic')[0];assert.equal(unrated.creditedHours,null);assert.equal(unrated.doeCredit,undefined);
 assert.equal(api.finalizeInstructorAssignments([{name:'Faculty',creditedHours:2}],'LEC','09:00','10:00','Topic')[0].creditedHours,2);
});
test('candidate assessment never reports Available for unknown or reversed timing',()=>{
 const index=require('../data-index.js'),candidate={name:'Sample Faculty',aliases:['Sample Faculty'],unavailableRanges:[]};
 for(const target of [{id:'target',date:'2026-10-01',start:'09:00',end:'10:00',timeUnknown:true},{id:'target',date:'2026-10-01',start:'10:00',end:'09:00'},{id:'target',date:'2026-02-30',start:'09:00',end:'10:00'}]){const result=index.assessSwapCandidate(candidate,[],target);assert.equal(result.available,null);assert.equal(index.swapCandidateDisplay(result).label,'Check needed');}
 const check=index.assessSwapCandidate(candidate,[{id:'bad-peer',date:'2026-10-01',start:'10:00',end:'09:00',assignments:[{name:'Sample Faculty',ucid:'private-id'}]}],{id:'target',date:'2026-10-01',start:'08:00',end:'11:00'});assert.equal(check.available,null);assert.doesNotMatch(JSON.stringify(check),/private-id/);
});
test('runtime entry points load the core before data-index and approval policy before consumers',()=>{
 for(const file of ['index.html','faculty-admin.html','user-management.html']){const html=fs.readFileSync(path.join(root,file),'utf8');assert.ok(html.indexOf('scheduling-core.js')>=0,file);assert.ok(html.indexOf('scheduling-core.js')<html.indexOf('data-index.js'),file);}
 for(const file of ['index.html','faculty-admin.html']){const html=fs.readFileSync(path.join(root,file),'utf8');assert.ok(html.indexOf('approval-scheduling.js')>=0,file);assert.ok(html.indexOf('approval-scheduling.js')<html.indexOf('faculty-access.js'),file);}
});
function reviewHarness(accept=true){
 const prompts=[],faculty={__id:'f1',preferredFullName:'Test Faculty'};
 const api=timetable(['timetableAvailability','facultyAssignmentAvailability','timetableConflictLabel','assignmentAvailabilityDetail','reviewSchedulingChanges','confirmSchedulingChanges'],{pageSessions:()=>[],facultyForAssignment:()=>faculty,facultyAvailability:()=>({available:true}),sessionHasFaculty:s=>(s.assignments||[]).some(a=>a.ucid==='f1'),approvalScheduling:require('../approval-scheduling.js'),currentUser:{uid:'admin1',name:'Admin'},firebase:{firestore:{FieldValue:{serverTimestamp:()=> 'SERVER_TIME'}}},confirm:text=>{prompts.push(text);return accept}});
 return{api,prompts};
}
const changedRow=(id,start,end)=>({id,date:'2026-10-01',start,end,course:'304',assignments:[{ucid:'f1',name:'Test Faculty'}]});
test('multi-edit checks the final proposed schedule rather than removed old times',()=>{const {api}=reviewHarness();const review=api.reviewSchedulingChanges([changedRow('a','09:00','10:00'),changedRow('b','10:00','11:00')],[changedRow('b','09:30','10:30')]);assert.ok(review.every(row=>row.conflicts.length===0&&row.checks.length===0));});
test('bulk rows are checked against each other with separate audited overrides',()=>{const {api,prompts}=reviewHarness();const overrides=api.confirmSchedulingChanges([changedRow('a','09:00','10:00'),changedRow('b','09:30','10:30')],[]);assert.equal(prompts.length,1);assert.match(prompts[0],/override/i);assert.equal(overrides.get('a').conflicts[0].id,'b');assert.equal(overrides.get('b').conflicts[0].id,'a');assert.equal(overrides.get('a').confirmedAt,'SERVER_TIME');});
test('canceling direct or batch confirmation produces no approval payload',()=>{const {api}=reviewHarness(false);assert.equal(api.confirmSchedulingChanges([changedRow('a','09:00','10:00')],[changedRow('b','09:30','10:30')]),null);});
test('unknown-time rows remain discoverable without invented clock placement',()=>{const {unpositionedSessionsHtml}=timetable(['unpositionedSessionsHtml'],{escapeHtml:v=>String(v??'')});const html=unpositionedSessionsHtml([{id:'unknown',date:'2026-10-01',course:'304',topic:'Unknown topic',start:'',end:'',timeUnknown:true}]);assert.match(html,/unknown/);assert.match(html,/Check needed/);assert.doesNotMatch(html,/top:|height:/);});
test('single, bulk and multi-edit writers invoke the common deliberate conflict review',()=>{for(const name of ['saveBulkSessions','saveSelectedChanges','performFacultySwap'])assert.match(sourceFunction('timetable.js',name),/confirmSchedulingChanges\(/,name);assert.match(fs.readFileSync(path.join(root,'timetable.js'),'utf8'),/session-form[^]*?confirmSchedulingChanges\(/);});
test('multi-edit save passes stable session ids into conflict review',async()=>{
 // The selection policy derives field ownership from the canonical modules, so the
 // harness must expose them. ADC owns the scheduling fields this test changes;
 // ADFA is faculty-only and would (correctly) refuse a time change.
 const window={UCVM_SCHEDULING:loadCore()};const selContext={window};
 for(const file of ['office-capabilities.js','session-workflow.js','timetable-selection.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),selContext);
 const original={...changedRow('stable-id','09:00','10:00'),year:1,type:'LEC',topic:'Topic',facultyIds:['f1']},changed={...original,start:'09:30',end:'10:30'};let reviewed;
 // The serializer is covered by its own assertion elsewhere; stub it so this test
 // stays focused on the stable ids handed to conflict review.
 const api=timetable(['saveSelectedChanges'],{window,firestoreSafeSessionPatch:row=>row,canEdit:()=>true,canSelectSessions:()=>true,capabilities:()=>({canEditInstructor:true,canEditCourseFields:true}),selectionRole:()=> 'adc',$:()=>({dataset:{},classList:{add(){},remove(){},toggle(){}},textContent:'',disabled:false}),selectedSessionOriginals:new Map([['stable-id',original]]),sessionSelection:{ids:()=>['stable-id']},readSelectionRows:()=>[changed],subjectOptions:[],facultyDirectory:[{__id:'f1'}],firebase:{firestore:{FieldValue:{serverTimestamp:()=> 'SERVER'}}},ensureSessionsForDates:async()=>{},buildSelectionLabRosterPlans:()=>({plans:[],errors:[]}),labRosterAuditChanges:()=>[],currentUser:{uid:'admin1'},getTimetableDoeRuntime:()=>({adapter:{prepareSession:async(_before,after)=>({session:after,calculationRecords:[],doeChanges:[]})},repository:{stageCalculationRecord:()=>{}}}),doeAuditChanges:()=>[],confirmSchedulingChanges:rows=>{reviewed=rows;return null},toast:()=>{}});await api.saveSelectedChanges();assert.deepEqual(Array.from(reviewed,row=>row.id),['stable-id']);
});
test('force-refresh reloads cached approval dates and removes stale sessions',async()=>{
 let reads=0;const state={SESSIONS:'sessions',sessions:new Map([['old',{id:'old',date:'2026-10-01'}]]),approvalSessionDatesLoaded:new Set(['2026-10-01']),ymd:v=>String(v||'').slice(0,10),db:{collection:()=>({where:()=>({get:async()=>{reads++;return{docs:[{id:'new',data:()=>({date:'2026-10-01'})}]}}})})}};
 vm.createContext(state);vm.runInContext(sourceFunction('approval-workflow.js','ensureFacultySessionContext'),state);await state.ensureFacultySessionContext([{sessionId:'old'}],true);assert.equal(reads,1);assert.equal(state.sessions.has('old'),false);assert.equal(state.sessions.has('new'),true);
});
test('force-refresh reloads AFC details instead of prior hydrated objects',async()=>{
 let reads=0;const old={__id:'f1'},state={isAdfaApprover:()=>true,isApprover:()=>true,requests:[],approvalFacultyLoaded:true,approvalFaculty:[old],approvalFacultyById:new Map([['f1',old]]),requestFacultyIds:()=>['f1'],db:{collection:()=>({doc:()=>({get:async()=>{reads++;return{exists:true,id:'f1',data:()=>({awayFromCampusRecords:[{startDate:'2026-10-01',endDate:'2026-10-01'}]})}}})})}};
 vm.createContext(state);vm.runInContext(sourceFunction('approval-workflow.js','ensureApprovalFaculty'),state);await state.ensureApprovalFaculty([],true);assert.equal(reads,1);assert.equal(state.approvalFacultyById.get('f1').awayFromCampusRecords.length,1);
});
test('instructor finalization retains explicit DOE credit and unknown inferred hours',()=>{
 const api=timetable(['blockHours','swapNumeric','defaultTeachingRole','finalizeInstructorAssignments']);assert.equal(api.finalizeInstructorAssignments([{name:'Faculty',creditedHours:2,doeCredit:8}],'LEC','09:00','10:00','Topic')[0].doeCredit,8);
 const unknown=api.finalizeInstructorAssignments([{name:'Faculty'}],'LEC','09:00','10:00','Topic',{timeUnknown:true})[0];assert.equal(unknown.creditedHours,null);assert.equal(unknown.doeCredit,undefined);
});
