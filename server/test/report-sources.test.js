'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReportSources}=require('../src/reports/report-sources');
const {validateDefinition,runTable}=require('../src/reports/report-definition');
const F='11111111-1111-4111-8111-111111111111',K='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',S='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333';
function fixture(){
 const data={faculty:[{facultyId:F,preferredFirstName:'Ana',preferredLastName:'de la Cruz',displayName:'Ana de la Cruz',active:true,rank:'Professor',stream:'Teaching',fte:1}],sessions:[{id:S,academicYear:'2026-27',date:'2026-10-01',courseCode:'206',sessionType:'LAB',topic:'Clinical lab',startTime:'09:00:00',endTime:'10:00:00',room:'Lab',assignmentsJson:JSON.stringify([{facultyId:F,teachingRole:'Instructor',displayName:'Ana de la Cruz'},{facultyId:F,teachingRole:'Lab Lead',displayName:'Ana de la Cruz'}])}],teachingSummary:[{facultyId:F,recordedTeachingDoe:4,recordedRoleDoe:5,recordedDoeTotal:9,effectiveDoeTotal:10}],worksheets:[{facultyId:F,academicYear:'2026-27',status:'needs_review',target:{contractTeachingDoe:65},effectiveTargetDoe:60,assignedTeachingDoe:null,remainingDoe:null,scheduledTeachingDoe:4,roleDoe:5,calculationBasis:'recorded_sources',targetPolicyVersionLabel:'Annual2026 v2'}],roles:[{roleAssignmentId:R,facultyId:F,displayName:'Ana de la Cruz',academicYear:'2026-27',roleType:'HICC',courseOrSubjectOrRotation:'206',doeMappedValue:2,effectiveDoe:2,doeSource:'recorded',doeCalculationStatus:'recorded',validityPeriods:[{startDate:'2026-10-01',endDate:'2026-10-31'},{startDate:'2026-12-01',endDate:'2027-01-31'}]}],activities:[{activityId:'a1',facultyKey:K,facultyDisplayName:'Ana de la Cruz',category:'rotation_participant',label:'Rotation',startDate:'2026-10-02',endDate:'2026-10-03',timeEvidence:[]},{activityId:'a2',facultyKey:null,facultyDisplayName:'Locum',staffingKind:'unassigned',staffingLabel:'Locum',category:'ccc',label:'CCC',startDate:'2026-10-04',endDate:'2026-10-04',timeEvidence:[]},{activityId:'a3',facultyKey:'unmapped',facultyDisplayName:'Ana de la Cruz',category:'clinical_day',label:'Clinic',startDate:'2026-10-05',endDate:'2026-10-05',timeEvidence:[]}]};
 const calls=[];const read=(name,fn)=>async options=>{calls.push({name,options});return fn(options);};
 const dependencies={dashboard:{reportFaculty:read('faculty',()=>data.faculty),teachingSummary:read('teachingSummary',()=>data.teachingSummary),roles:read('roles',()=>data.roles)},sessions:{list:read('sessions',()=>data.sessions)},worksheetService:{listFacultyDoe:read('worksheets',()=>data.worksheets)},activities:{list:read('activities',()=>({activities:data.activities,facultyKeys:[{facultyId:F,facultyKey:K}],nextCursor:null}))},historyApi:{query(){throw Error('History was not selected');}}};
 return {data,calls,dependencies,source:createReportSources(dependencies)};
}
const definition=()=>validateDefinition({academicYear:'2026-27',datasets:[{source:'workload',columns:['facultyName','remainingDoe']},{source:'schedule',columns:['facultyName','topic']},{source:'roles',columns:['facultyName','startDate','endDate','effectiveDoe']}]});
test('mixed linked and unresolved assignments keep all display labels without assigning workload by name',async()=>{
 const h=fixture();const linked=JSON.parse(h.data.sessions[0].assignmentsJson);h.data.sessions[0].assignmentsJson=JSON.stringify([...linked,{facultyId:null,sourceFacultyName:'Sam Unlinked',displayName:null}]);h.data.sessions[0].unresolvedAssignmentCount=1;h.data.sessions[0].instructorNames='Ana de la Cruz; Sam Unlinked';
 const result=await h.source.load({definition:definition(),uid:'owner',token:'token'});const row=result.tables.schedule.rows.find(r=>r.sourceKind==='Teaching');assert.equal(row.facultyName,'de la Cruz, Ana; Unlinked, Sam');assert.equal(result.tables.workload.rows[0].teachingCount,1);assert.equal(h.calls.find(c=>c.name==='sessions').options.includeUnresolvedAssignmentLabels,true);
 const filtered=runTable('schedule',result.tables.schedule.rows,validateDefinition({academicYear:'2026-27',datasets:[{source:'schedule',columns:['facultyName'],search:'Sam Unlinked'}]}).datasets[0]);assert.equal(filtered.total,1);
});
test('selected families share trusted reads and preserve exact identity cardinality, periods and authoritative DOE',async()=>{
 const h=fixture(),before=JSON.stringify(h.data),result=await h.source.load({definition:definition(),uid:'owner-1',token:'test-token'});
 const summary=result.tables.workload.rows;assert.equal(summary.length,1);assert.equal(summary[0].facultyName,'de la Cruz, Ana');assert.equal(summary[0].teachingCount,1);assert.equal(summary[0].rotationCount,1);assert.equal(summary[0].cccCount,0);assert.equal(summary[0].otherWorkCount,0);assert.equal(summary[0].appointmentCount,1);assert.equal(summary[0].remainingDoe,null);assert.equal(summary[0].assignedTeachingDoe,null);assert.equal(summary[0].recordedDoeTotal,9);assert.equal(summary[0].effectiveRecordedDoeTotal,10);assert.equal(summary[0].contractTeachingDoe,65);
 const details=result.tables.schedule.rows;assert.equal(details.length,4);assert.equal(details.find(r=>r.type==='Rotation participant').timeDisplay,'08:30–16:30 · Default time');assert.match(details.find(r=>r.type==='Rotation participant').timeStatus,/review/i);assert.equal(details.find(r=>r.type==='LAB').facultyName,'de la Cruz, Ana');assert.ok(details.some(r=>r.facultyName==='Locum'));
 assert.deepEqual(result.tables.roles.rows.map(r=>[r.startDate,r.endDate,r.effectiveDoe]),[['2026-10-01','2026-10-31',2],['2026-12-01','2027-01-31',2]]);assert.equal(result.tables.roles.rows[0].appointment,result.tables.roles.rows[1].appointment);
 assert.match(result.tables.workload.coverage.join(' '),/unmapped|mapping/i);assert.equal(JSON.stringify(h.data),before);
 for(const name of ['faculty','sessions','roles','activities','teachingSummary','worksheets'])assert.equal(h.calls.filter(c=>c.name===name).length,1,name);
 assert.equal(h.calls.find(c=>c.name==='sessions').options.academicYear,'2026-27');assert.equal(h.calls.find(c=>c.name==='activities').options.actorFirebaseUid,'owner-1');assert.equal(h.calls.find(c=>c.name==='activities').options.includeFacultyKeys,true);
});
test('source overflows and repeated activity cursors fail rather than returning partial reports',async()=>{
 const h=fixture();h.data.sessions=Array.from({length:10001},()=>h.data.sessions[0]);
 await assert.rejects(h.source.load({definition:definition(),uid:'owner',token:'token'}),{code:'REPORT_LIMIT'});
 const next=fixture();let reads=0;next.dependencies.activities.list=async()=>({activities:[{...next.data.activities[0],activityId:'range'+(++reads)}],facultyKeys:[],nextCursor:'same-cursor'});
 await assert.rejects(createReportSources(next.dependencies).load({definition:definition(),uid:'owner',token:'token'}),{code:'REPORT_SOURCE_UNAVAILABLE'});assert.equal(reads,2);
});
test('unsupported work categories cannot silently disappear, while Remote work stays outside working reports',async()=>{
 const h=fixture();h.data.activities.push({...h.data.activities[0],activityId:'unexpected',category:'new_unknown_work'});
 await assert.rejects(h.source.load({definition:definition(),uid:'owner',token:'token'}),{code:'REPORT_SOURCE_UNAVAILABLE'});
 h.data.activities.at(-1).category='remote_work';const result=await h.source.load({definition:definition(),uid:'owner',token:'token'});assert.equal(result.tables.schedule.rows.length,4);
});
test('a selected schedule source does not read unrelated DOE/role sources and conflicting mappings fail closed',async()=>{
 const h=fixture(),d=validateDefinition({academicYear:'2026-27',datasets:[{source:'schedule',columns:['facultyName']}]});
 await h.source.load({definition:d,uid:'owner',token:'token'});assert.deepEqual(h.calls.map(c=>c.name).sort(),['activities','faculty','sessions']);
 h.dependencies.activities.list=async()=>({activities:[],nextCursor:null,facultyKeys:[{facultyKey:K,facultyId:F},{facultyKey:K,facultyId:S}]});
 await assert.rejects(createReportSources(h.dependencies).load({definition:d,uid:'owner',token:'token'}),{code:'REPORT_SOURCE_UNAVAILABLE'});
});
test('undated sessions keep their stored academic year; empty appointment periods are not fabricated',async()=>{
 const h=fixture();h.data.sessions[0].date=null;h.data.roles[0].validityPeriods=[];
 const result=await h.source.load({definition:definition(),uid:'owner',token:'token'});
 assert.equal(result.tables.workload.rows[0].teachingCount,1);assert.equal(result.tables.schedule.rows.find(row=>row.sourceKind==='Teaching').startDate,null);
 assert.equal(result.tables.roles.rows.length,1);assert.equal(result.tables.roles.rows[0].period,null);assert.equal(result.tables.roles.rows[0].startDate,null);assert.equal(result.tables.roles.rows[0].periodStatus,'No effective periods');
});
test('a Worksheet from another academic year cannot supply this year DOE',async()=>{
 const h=fixture();h.data.worksheets[0]={...h.data.worksheets[0],academicYear:'2025-26',assignedTeachingDoe:99,remainingDoe:-99};
 const result=await h.source.load({definition:definition(),uid:'owner',token:'token'});assert.equal(result.tables.workload.rows[0].assignedTeachingDoe,null);assert.equal(result.tables.workload.rows[0].remainingDoe,null);assert.equal(result.tables.workload.rows[0].status,'needs_review');
});
test('history reuses authorized pages, preserves raw From/To and carries original expiry',async()=>{
 const h=fixture(),calls=[],operation=i=>({changeDate:'2026-10-12T12:00:00.000Z',title:'Role updated '+i,domain:'Lookup',changeType:'Update',actor:'Pat Owner',records:[{affectedFaculty:'Example, Alex',course:'206',session:'Lab',startDate:null,endDate:null,changes:[{field:'Faculty label',previousValue:'Alex Example',updatedValue:'Example, Alex'}]}]});
 h.dependencies.historyApi={query:async(token,input)=>{calls.push({token,input});return {status:200,body:{snapshot:'opaque',total:2,pageSize:1,offset:0,rows:[operation(1)],expiresAt:'2026-10-25T23:00:00.000Z',coverage:['Recorded SQL events only']}};},page:async(token,input)=>{calls.push({token,input});return {status:200,body:{snapshot:'opaque',total:2,pageSize:1,offset:1,rows:[operation(2)]}};}};
 const source=createReportSources(h.dependencies),d=validateDefinition({academicYear:'2026-27',datasets:[{source:'history',columns:['fromValue','toValue'],filters:[{field:'changedOn',op:'between',value:['2026-10-01','2026-10-31']}]}]});
 const result=await source.load({definition:d,uid:'owner',token:'credential'});assert.equal(result.tables.history.rows.length,2);assert.equal(result.tables.history.rows[0].fromValue,'Alex Example');assert.equal(result.tables.history.rows[0].toValue,'Example, Alex');assert.equal(result.tables.history.rows[0].actor,'Owner, Pat');assert.equal(result.expiresAt,'2026-10-25T23:00:00.000Z');
 assert.deepEqual(calls[0],{token:'credential',input:{scope:'dashboard',academicYear:'2026-27',start:'2026-10-01',end:'2026-11-01'}});assert.deepEqual(calls[1].input,{snapshot:'opaque',offset:1});assert.equal(h.calls.length,0,'history cannot load the private roster or unrelated sources');
});
