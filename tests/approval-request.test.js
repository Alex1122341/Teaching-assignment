'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function load(){
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'approval-routing.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'approval-request.js'),'utf8'),context);
  return context.window.UCVM_APPROVAL_REQUEST;
}

function source(){
  return {
    id:'s1',course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,
    date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Pre-Op Lab',room:'CSB 116',
    instructor:'Jane Smith; Alex Faculty',facultyIds:['1001','1002'],
    assignments:[{ucid:'1001',name:'Jane Smith',doeCredit:1.25,email:'private@u.ca'}],
    awayFromCampusRecords:[{startDate:'2027-03-20',reason:'Private'}]
  };
}

test('public session/request records use strict allowlists and contain no Faculty-private values',()=>{
  const api=load();
  const clean=api.publicSession(source());
  assert.deepEqual(Object.keys(clean),['course','courseName','year','semester','week','date','start','end','timeUnknown','type','topic','room','instructor']);
  const serialized=JSON.stringify(clean);
  for(const forbidden of ['1001','private@u.ca','doeCredit','awayFromCampusRecords','facultyIds','assignments'])assert.equal(serialized.includes(forbidden),false,forbidden);
});

test('session edit creates public request plus ADC/LAB routing with no private record',()=>{
  const api=load();
  const records=api.buildRecords({
    requestId:'r1',requester:{uid:'u1',name:'Faculty One',role:'hicc'},now:'STAMP',
    payload:{requestType:'session_edit',sessionId:'s1',base:source(),patch:{date:'2027-03-23',topic:'Advanced suturing'},reason:'Please update'}
  });
  assert.equal(records.publicRecord.requestSchema,'office-routing-v1');
  assert.equal(records.publicRecord.requesterUid,'u1');
  assert.equal(records.publicRecord.status,'pending');
  assert.deepEqual(Array.from(records.workflow.requiredOffices),['adc','lab']);
  assert.deepEqual(Array.from(records.workflow.scopes.adc),['date']);
  assert.deepEqual(Array.from(records.workflow.scopes.lab),['topic']);
  assert.equal(records.privateRecord,null);
  assert.equal(records.approvals.length,2);
  assert.doesNotMatch(JSON.stringify(records.publicRecord),/1001|private@u\.ca|doeCredit|assignments|facultyIds/);
});

test('faculty swap keeps only display names public and moves assignment references into ADFA-private record',()=>{
  const api=load();
  const records=api.buildRecords({
    requestId:'r2',requester:{uid:'u1',name:'Faculty One',role:'faculty'},now:'STAMP',
    payload:{requestType:'faculty_swap',sessionId:'s1',base:source(),assignmentIndex:0,
      fromFaculty:{facultyId:'1001',name:'Jane Smith'},toFaculty:{candidateKey:'opaque-k2',name:'Dr. New'},reason:'Coverage'}
  });
  assert.deepEqual(Array.from(records.workflow.requiredOffices),['adfa']);
  assert.equal(records.workflow.hasFacultyChange,true);
  assert.equal(records.publicRecord.currentFacultyName,'Jane Smith');
  assert.equal(records.publicRecord.proposedFacultyName,'Dr. New');
  assert.equal(records.publicRecord.patchPublic.instructor,'Dr. New');
  const publicJson=JSON.stringify(records.publicRecord);
  assert.doesNotMatch(publicJson,/1001|opaque-k2|facultyId|candidateKey|assignmentIndex/);
  assert.deepEqual(JSON.parse(JSON.stringify(records.privateRecord.assignmentChange)),{assignmentIndex:0,from:{facultyId:'1001'},to:{candidateKey:'opaque-k2'}});
});

test('submit writes public workflow approvals optional private and audit in one batch',async()=>{
  const api=load(),writes=[];let committed=0,seq=0;
  const db={
    collection(name){return{doc(id){const value=id||`${name}-${++seq}`;return{path:`${name}/${value}`,id:value}}}},
    batch(){return{set(ref,data){writes.push({path:ref.path,data})},async commit(){committed++}}}
  };
  const id=await api.submit({db,requester:{uid:'u1',name:'Faculty One',role:'faculty'},now:'STAMP',payload:{requestType:'faculty_swap',sessionId:'s1',base:source(),assignmentIndex:0,fromFaculty:{facultyId:'1001',name:'Jane Smith'},toFaculty:{candidateKey:'opaque-k2',name:'Dr. New'}}});
  assert.equal(committed,1);
  assert.equal(id,'change_requests-1');
  assert.ok(writes.some(w=>w.path===`change_requests/${id}`));
  assert.ok(writes.some(w=>w.path===`change_request_workflow/${id}`));
  assert.ok(writes.some(w=>w.path===`change_request_approvals/${id}_adfa`));
  assert.ok(writes.some(w=>w.path===`change_request_private/${id}`));
  assert.ok(writes.some(w=>w.path.startsWith('change_request_audit/')));
  const publicWrite=writes.find(w=>w.path===`change_requests/${id}`).data;
  assert.doesNotMatch(JSON.stringify(publicWrite),/1001|opaque-k2|facultyId|candidateKey/);
});

test('faculty resubmission choice returns display data plus opaque private target without exposing Faculty IDs',()=>{
  const api=load();
  const edit=api.facultyEditFromChoice('candidate:opaque-k3',[{key:'opaque-k3',name:'Dr. Third',facultyId:'should-not-leak'}]);
  assert.equal(edit.displayName,'Dr. Third');
  assert.deepEqual(JSON.parse(JSON.stringify(edit.privateTarget)),{candidateKey:'opaque-k3'});
  assert.match(edit.scopeSignature,/^faculty-v1:/);
  assert.doesNotMatch(edit.scopeSignature,/opaque-k3|should-not-leak|Dr\. Third/);
  assert.doesNotMatch(JSON.stringify({displayName:edit.displayName,scopeSignature:edit.scopeSignature}),/opaque-k3|facultyId|should-not-leak/);
});

test('faculty resubmission choice supports Sessional and Other without a candidate key',()=>{
  const api=load();
  const sessional=api.facultyEditFromChoice('special:sessional',[]);
  const other=api.facultyEditFromChoice('special:other',[]);
  assert.deepEqual(JSON.parse(JSON.stringify(sessional.privateTarget)),{kind:'sessional'});
  assert.equal(sessional.displayName,'Sessional');
  assert.deepEqual(JSON.parse(JSON.stringify(other.privateTarget)),{kind:'other'});
  assert.equal(other.displayName,'Other');
});

test('initial Faculty workflow uses the same display-safe deterministic scope signature used by blind resubmission',()=>{
  const api=load();
  const records=api.buildRecords({requestId:'r5',requester:{uid:'u1',name:'Faculty One',role:'faculty'},now:'STAMP',payload:{requestType:'faculty_swap',sessionId:'s1',base:source(),assignmentIndex:0,fromFaculty:{facultyId:'1001',name:'Jane Smith'},toFaculty:{candidateKey:'opaque-k5',name:'Dr. Same Name'}}});
  assert.equal(records.workflow.scopeSignatures.adfa,api.facultyScopeSignature('Dr. Same Name'));
  assert.match(records.workflow.scopeSignatures.adfa,/^faculty-v1:/);
  assert.doesNotMatch(records.workflow.scopeSignatures.adfa,/Dr\. Same Name|opaque-k5/);
});
