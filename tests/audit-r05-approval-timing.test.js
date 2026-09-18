'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function context(files){
  const ctx={window:{}};
  vm.createContext(ctx);
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
  return ctx.window;
}

function base(){
  return {
    course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,
    date:'2027-03-22',start:'09:00',end:'10:00',timeUnknown:false,
    type:'LAB',topic:'Pre-Op Lab',room:'CSB 116',instructor:'Dr Old'
  };
}

test('R05 scheduling core identifies an invalid timing patch while leaving unrelated edits unchanged',()=>{
  const w=context(['scheduling-core.js']);
  const invalid=w.UCVM_SCHEDULING.validateSessionTimingChange(base(),{start:'11:00',end:'10:00'});
  assert.equal(invalid.status,'invalid');
  assert.equal(invalid.reason,'end_not_after_start');
  assert.deepEqual(Array.from(invalid.changedFields),['start']);

  const unchanged=w.UCVM_SCHEDULING.validateSessionTimingChange(
    {...base(),start:'11:00',end:'10:00'},
    {topic:'Advanced suturing'}
  );
  assert.equal(unchanged.status,'unchanged');
});

test('R05 initial routed request rejects a newly introduced reversed interval',()=>{
  const w=context(['scheduling-core.js','approval-routing.js','approval-request.js']);
  assert.throws(()=>w.UCVM_APPROVAL_REQUEST.buildRecords({
    requestId:'r1',requester:{uid:'u1',name:'Faculty One',role:'hicc'},now:'STAMP',
    payload:{requestType:'session_edit',sessionId:'s1',base:base(),patch:{start:'11:00',end:'10:00'}}
  }),/invalid session timing/i);
});

test('R05 requester resubmission rejects an invalid returned timing edit',()=>{
  const w=context(['scheduling-core.js','approval-routing.js','approval-state.js','approval-lifecycle.js']);
  const request={
    id:'r2',requestType:'session_edit',status:'update_required',revision:1,
    editableFields:['start','end'],basePublic:base(),patchPublic:{start:'09:30',end:'10:30'}
  };
  assert.throws(()=>w.UCVM_APPROVAL_LIFECYCLE.planRequesterResubmission({
    request,publicEdits:{start:'11:00',end:'10:00'},now:'NOW'
  }),/invalid session timing/i);
});

test('R05 public finalizer refuses a reversed interval instead of producing a write plan',()=>{
  const w=context(['scheduling-core.js','calendar-session.js','approval-finalizer.js']);
  const request={
    id:'r3',sessionId:'s1',basePublic:base(),
    patchPublic:{start:'11:00',end:'10:00'}
  };
  const calendar={sessionId:'s1',...base(),instructorNames:['Dr Old']};
  assert.throws(()=>w.UCVM_APPROVAL_FINALIZER.planPublicApply({request,calendar}),/invalid session timing/i);
});

test('R05 mixed Faculty finalizer also refuses invalid public timing before applying assignment data',()=>{
  const w=context(['scheduling-core.js','calendar-session.js','approval-finalizer.js']);
  const source={
    id:'s1',...base(),
    assignments:[{ucid:'f1',name:'Dr Old'},{ucid:'f9',name:'Dr Other'}],
    facultyIds:['f1','f9'],instructor:'Dr Old; Dr Other'
  };
  const request={
    id:'r4',sessionId:'s1',
    basePublic:{...base(),instructor:'Dr Old; Dr Other'},
    patchPublic:{start:'11:00',end:'10:00',instructor:'Dr New'},
    currentFacultyName:'Dr Old',proposedFacultyName:'Dr New'
  };
  const privateRecord={assignmentChange:{assignmentIndex:0,from:{facultyId:'f1'},to:{candidateKey:'opaque'}}};
  assert.throws(()=>w.UCVM_APPROVAL_FINALIZER.planFacultySwap({
    request,source,privateRecord,resolved:{facultyId:'f2',name:'Dr New',kind:'faculty'}
  }),/invalid session timing/i);
});

test('R05 timeUnknown remains valid for approval paths without inventing times',()=>{
  const w=context(['scheduling-core.js','approval-routing.js','approval-request.js']);
  const records=w.UCVM_APPROVAL_REQUEST.buildRecords({
    requestId:'r5',requester:{uid:'u1',name:'Faculty One',role:'hicc'},now:'STAMP',
    payload:{requestType:'session_edit',sessionId:'s1',base:base(),patch:{start:'',end:'',timeUnknown:true}}
  });
  assert.equal(records.publicRecord.patchPublic.timeUnknown,true);
  assert.equal(records.publicRecord.patchPublic.start,'');
  assert.equal(records.publicRecord.patchPublic.end,'');
});
