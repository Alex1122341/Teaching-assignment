'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWriteGates } = require('../src/data/write-gates');

test('write gate environment is per-domain and fail-closed for missing, false, and non-exact values', () => {
  assert.deepEqual(createWriteGates({}), {
    swapRequest: false, swapDecision: false, swapApply: false, afcSingle: false, afcBatch: false, afcCancel: false, sessionEdit: false, sessionCreate: false,
    afcRequest: false, afcDecision: false, afcArtifact: false, afcFormUpload: false, cccReplaceStage: false, cccReplaceCommit: false,
    taDraft: false, taReview: false, taFinal: false, taPublish: false, facultyAdmin: false,
    doeAdmin: false, doeManualAssignment: false, doePolicyPublish: false, doeRecalculate: false,
    schedulingTaskReview:false,calendarActivityStage:false,calendarActivityCommit:false,calendarActivityTime:false
  });
  assert.deepEqual(createWriteGates({
    PAWS_AFC_SINGLE_WRITE_ENABLED: 'true',
    PAWS_AFC_BATCH_WRITE_ENABLED: 'false',
    PAWS_SESSION_EDIT_WRITE_ENABLED: 'TRUE',
    PAWS_TA_DRAFT_WRITE_ENABLED: 'true',
    PAWS_TA_REVIEW_WRITE_ENABLED: 'true',
    PAWS_TA_FINAL_WRITE_ENABLED: 'false',
    PAWS_TA_PUBLISH_WRITE_ENABLED: 'TRUE',
    PAWS_UNRELATED_WRITE_ENABLED: 'true',
    PAWS_FACULTY_ADMIN_WRITE_ENABLED: 'true'
  }), {
    swapRequest: false, swapDecision: false, swapApply: false, afcSingle: true, afcBatch: false, afcCancel: false, sessionEdit: false, sessionCreate: false,
    afcRequest: false, afcDecision: false, afcArtifact: false, afcFormUpload: false, cccReplaceStage: false, cccReplaceCommit: false,
    taDraft: true, taReview: true, taFinal: false, taPublish: false, facultyAdmin: true,
    doeAdmin: false, doeManualAssignment: false, doePolicyPublish: false, doeRecalculate: false,
    schedulingTaskReview:false,calendarActivityStage:false,calendarActivityCommit:false,calendarActivityTime:false
  });
  assert.deepEqual(createWriteGates({
    PAWS_DOE_ADMIN_WRITE_ENABLED: 'true',
    PAWS_DOE_POLICY_PUBLISH_ENABLED: 'true',
    PAWS_DOE_RECALC_WRITE_ENABLED: 'true'
  }), {
    swapRequest: false, swapDecision: false, swapApply: false, afcSingle: false, afcBatch: false, afcCancel: false, sessionEdit: false, sessionCreate: false,
    afcRequest: false, afcDecision: false, afcArtifact: false, afcFormUpload: false, cccReplaceStage: false, cccReplaceCommit: false,
    taDraft: false, taReview: false, taFinal: false, taPublish: false, facultyAdmin: false,
    doeAdmin: true, doeManualAssignment: false, doePolicyPublish: true, doeRecalculate: true,
    schedulingTaskReview:false,calendarActivityStage:false,calendarActivityCommit:false,calendarActivityTime:false
  });
});
test('calendar activity gates independently require exact lowercase environment true',()=>{
 for(const [key,name] of [['calendarActivityStage','PAWS_CALENDAR_ACTIVITY_STAGE_ENABLED'],['calendarActivityCommit','PAWS_CALENDAR_ACTIVITY_COMMIT_ENABLED'],['calendarActivityTime','PAWS_CALENDAR_ACTIVITY_TIME_ENABLED']]){
  for(const value of [undefined,false,true,1,'false','TRUE',' true '])assert.equal(createWriteGates({[name]:value})[key],false);
  const gates=createWriteGates({[name]:'true'});assert.equal(gates[key],true);
  for(const other of ['calendarActivityStage','calendarActivityCommit','calendarActivityTime'].filter(value=>value!==key))assert.equal(gates[other],false);
 }
});

