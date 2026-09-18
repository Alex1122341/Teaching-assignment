'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function loadRequestApi(){
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'approval-routing.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'approval-request.js'),'utf8'),context);
  return context.window.UCVM_APPROVAL_REQUEST;
}

function loadFinalizer(){
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'calendar-session.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'approval-finalizer.js'),'utf8'),context);
  return context.window.UCVM_APPROVAL_FINALIZER;
}

function source(){
  return {
    id:'s1',course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,
    date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Pre-Op Lab',room:'CSB 116',
    instructor:'Jane Smith; Alex Faculty',facultyIds:['1001','1002'],
    assignments:[{ucid:'1001',name:'Jane Smith',doeCredit:1.25},{ucid:'1002',name:'Alex Faculty',doeCredit:1}]
  };
}

test('R04 mixed Faculty swap preserves Date and LAB Topic in one routed request',()=>{
  const api=loadRequestApi();
  const records=api.buildRecords({
    requestId:'r-r04',
    requester:{uid:'u1',name:'Faculty One',role:'faculty'},
    now:'STAMP',
    payload:{
      requestType:'faculty_swap',
      sessionId:'s1',
      base:source(),
      patch:{date:'2027-03-23',topic:'Advanced suturing'},
      assignmentIndex:0,
      fromFaculty:{facultyId:'1001',name:'Jane Smith'},
      toFaculty:{candidateKey:'opaque-k2',name:'Dr. New'},
      reason:'Coverage and schedule update'
    }
  });

  assert.equal(records.publicRecord.patchPublic.date,'2027-03-23');
  assert.equal(records.publicRecord.patchPublic.topic,'Advanced suturing');
  assert.equal(records.publicRecord.patchPublic.instructor,'Dr. New');
  assert.deepEqual(Array.from(records.workflow.requiredOffices),['adc','lab','adfa']);
  assert.deepEqual(Array.from(records.workflow.scopes.adc),['date']);
  assert.deepEqual(Array.from(records.workflow.scopes.lab),['topic']);
  assert.deepEqual(Array.from(records.workflow.scopes.adfa),['assignments','instructor']);
  assert.ok(records.privateRecord);
});

test('R04 final Faculty apply combines approved public edits with the assignment change atomically',()=>{
  const api=loadFinalizer();
  const current=source();
  const request={
    id:'r-r04',
    sessionId:'s1',
    basePublic:{
      course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,
      date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Pre-Op Lab',room:'CSB 116',
      instructor:'Jane Smith; Alex Faculty'
    },
    patchPublic:{date:'2027-03-23',topic:'Advanced suturing',instructor:'Dr. New'},
    currentFacultyName:'Jane Smith',
    proposedFacultyName:'Dr. New'
  };
  const privateRecord={assignmentChange:{assignmentIndex:0,from:{facultyId:'1001'},to:{candidateKey:'opaque-k2'}}};

  const plan=api.planFacultySwap({
    request,
    source:current,
    privateRecord,
    resolved:{facultyId:'1003',name:'Dr. New',kind:'faculty'}
  });

  assert.equal(plan.sourcePatch.date,'2027-03-23');
  assert.equal(plan.sourcePatch.topic,'Advanced suturing');
  assert.equal(plan.sourcePatch.assignments[0].ucid,'1003');
  assert.equal(plan.sourcePatch.assignments[1].ucid,'1002');
  assert.deepEqual(Array.from(plan.sourcePatch.facultyIds),['1003','1002']);
  assert.equal(plan.sourcePatch.instructor,'Dr. New; Alex Faculty');
  assert.equal(plan.calendar.date,'2027-03-23');
  assert.equal(plan.calendar.topic,'Advanced suturing');
  assert.equal(plan.calendar.instructor,'Dr. New; Alex Faculty');
  assert.deepEqual(new Set(plan.changedFields),new Set(['date','topic','assignments','facultyIds','instructor']));
});
