'use strict';

const WRITE_DISABLED = Object.freeze({
  status: 503,
  body: { error: { code: 'WRITE_DISABLED', message: 'This write operation is currently disabled.' } }
});

function createWriteGates(env = {}) {
  return Object.freeze({
    schedulingTaskReview: env.PAWS_SCHEDULING_TASK_REVIEW_ENABLED === 'true',
    calendarActivityStage: env.PAWS_CALENDAR_ACTIVITY_STAGE_ENABLED === 'true',
    calendarActivityCommit: env.PAWS_CALENDAR_ACTIVITY_COMMIT_ENABLED === 'true',
    calendarActivityTime: env.PAWS_CALENDAR_ACTIVITY_TIME_ENABLED === 'true',
    swapRequest: env.PAWS_SWAP_REQUEST_WRITE_ENABLED === 'true',
    swapDecision: env.PAWS_SWAP_DECISION_WRITE_ENABLED === 'true',
    swapApply: env.PAWS_SWAP_APPLY_WRITE_ENABLED === 'true',
    afcSingle: env.PAWS_AFC_SINGLE_WRITE_ENABLED === 'true',
    afcBatch: env.PAWS_AFC_BATCH_WRITE_ENABLED === 'true',
    afcCancel: env.PAWS_AFC_CANCEL_WRITE_ENABLED === 'true',
    sessionEdit: env.PAWS_SESSION_EDIT_WRITE_ENABLED === 'true',
    sessionCreate: env.PAWS_SESSION_CREATE_WRITE_ENABLED === 'true',
    afcRequest: env.PAWS_AFC_REQUEST_WRITE_ENABLED === 'true',
    afcDecision: env.PAWS_AFC_DECISION_WRITE_ENABLED === 'true',
    afcArtifact: env.PAWS_AFC_ARTIFACT_WRITE_ENABLED === 'true',
    afcFormUpload: env.PAWS_AFC_FORM_UPLOAD_ENABLED === 'true',
    cccReplaceStage: env.PAWS_CCC_REPLACE_STAGE_ENABLED === 'true',
    cccReplaceCommit: env.PAWS_CCC_REPLACE_COMMIT_ENABLED === 'true',
    taDraft: env.PAWS_TA_DRAFT_WRITE_ENABLED === 'true',
    taReview: env.PAWS_TA_REVIEW_WRITE_ENABLED === 'true',
    taFinal: env.PAWS_TA_FINAL_WRITE_ENABLED === 'true',
    taPublish: env.PAWS_TA_PUBLISH_WRITE_ENABLED === 'true',
    facultyAdmin: env.PAWS_FACULTY_ADMIN_WRITE_ENABLED === 'true',
    doeAdmin: env.PAWS_DOE_ADMIN_WRITE_ENABLED === 'true',
    doeManualAssignment: env.PAWS_DOE_MANUAL_ASSIGNMENT_WRITE_ENABLED === 'true',
    doePolicyPublish: env.PAWS_DOE_POLICY_PUBLISH_ENABLED === 'true',
    doeRecalculate: env.PAWS_DOE_RECALC_WRITE_ENABLED === 'true'
  });
}

function writeDisabled() {
  return { status: WRITE_DISABLED.status, body: { error: { ...WRITE_DISABLED.body.error } } };
}

module.exports = { createWriteGates, writeDisabled };
