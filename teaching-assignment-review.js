/* Pure Working Teaching Assignment package review. Authority is explicit caller
 * evidence; these predicates are not a production authorization boundary.
 * Legacy serial approval consumers remain separate.
 */
(function(root, factory) {
  const scheduling = typeof module === 'object' && module.exports
    ? require('./scheduling-core.js') : root?.UCVM_SCHEDULING;
  const api = factory(scheduling);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UCVM_TEACHING_ASSIGNMENT_REVIEW = api;
})(typeof window !== 'undefined' ? window : null, function(scheduling) {
  'use strict';
  if (!scheduling) throw Error('Teaching Assignment review requires scheduling-core.');

  const STATES = Object.freeze(['draft','visc_review','changes_requested','visc_approved',
    'submitted_to_adfad','adfad_finalized']);
  const TYPES = new Set(['LEC','SRL','LAB','QUIZ/MIDTERM','OSCE','EXAM']);
  const PREFIX = 'ta-review-v1:';
  const text = value => typeof value === 'string' ? value.trim() : '';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validRevision = record => Number.isSafeInteger(record?.revision ?? 0) && (record?.revision ?? 0) >= 0;
  const generation = (record,field) => Number.isSafeInteger(record?.[field]) && record[field] >= 0 ? record[field] : null;
  const currentGeneration = record => record?.workingRevision === undefined ? 0 : generation(record,'workingRevision');
  const submittedGeneration = record => generation(record,'submittedWorkingRevision');
  const approvedGeneration = record => generation(record,'viscApprovedWorkingRevision');
  const isFingerprint = value => typeof value === 'string' && value.startsWith(PREFIX) && value.length > PREFIX.length;

  function contentReadiness(session) {
    const row = object(session) ? session : {}, missing = [];
    if (!text(row.course)) missing.push('course');
    if (!scheduling.normalizeDate(row.date)) missing.push('date');
    // Unknown time is a valid legacy record, but is not a known reviewable slot.
    if (scheduling.validateInterval(row.start,row.end,{timeUnknown:row.timeUnknown === true}).status !== 'valid') missing.push('time');
    if (!TYPES.has(text(row.type).toUpperCase())) missing.push('type');
    const topic = text(row.topic), placeholder = topic.toLowerCase().replace(/[^a-z0-9]+/g,'');
    if (!topic || ['tbd','tobedetermined'].includes(placeholder)) missing.push('topic');
    return {ready:missing.length === 0, missing};
  }

  function reviewText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') throw Error('Review fields must be scalar text.');
    return value.trim();
  }
  function clock(value) {
    const raw = reviewText(value), minutes = scheduling.parseTime(raw);
    return minutes === null ? raw : scheduling.formatTime(minutes);
  }
  function reviewFingerprint(sessions, suggestions = []) {
    if (!Array.isArray(sessions) || !sessions.length || !Array.isArray(suggestions)) {
      throw Error('Review requires a nonempty session array and a safe suggestion array.');
    }
    const ids = new Set();
    const rows = sessions.map(row => {
      if (!object(row)) throw Error('Invalid review session.');
      const id = reviewText(row.id || row.sessionId);
      if (!id || ids.has(id) || (row.id && row.sessionId && row.id !== row.sessionId)) {
        throw Error('Review session identities must be nonblank and unique.');
      }
      ids.add(id);
      return [id,reviewText(row.course),reviewText(row.subjectKey),reviewText(row.date),
        clock(row.start),clock(row.end),reviewText(row.type).toUpperCase(),reviewText(row.room),
        reviewText(row.topic),row.timeUnknown === true];
    });
    rows.sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const safeSuggestions = suggestions.map(row => {
      if (!object(row)) throw Error('Invalid safe Faculty suggestion.');
      const sessionId = reviewText(row.sessionId), candidateKey = reviewText(row.candidateKey),
        displayName = reviewText(row.displayName), sourceRole = reviewText(row.sourceRole).toLowerCase();
      if (!ids.has(sessionId) || !candidateKey || !displayName || !['hicc','adc','lab'].includes(sourceRole)) {
        throw Error('Suggestions require an included session, opaque candidate key, display name and source role.');
      }
      return JSON.stringify([sessionId,candidateKey,displayName,sourceRole]);
    });
    // Explicit tuples and code-point sorting avoid property order and locale dependence.
    return PREFIX + JSON.stringify({sessions:rows,suggestions:[...new Set(safeSuggestions)].sort().map(value => JSON.parse(value))});
  }

  function readyFingerprint(sessions, suggestions) {
    if (!Array.isArray(sessions) || !sessions.length || !sessions.every(row => contentReadiness(row).ready)) return '';
    try { return reviewFingerprint(sessions,suggestions); } catch (_) { return ''; }
  }
  function ownsPackage(record, context) {
    return context?.actorRole === 'hicc' && context.ownsPackage === true &&
      Boolean(text(context.actorUid)) && Boolean(text(record?.hiccUid)) && context.actorUid === record.hiccUid;
  }
  function reviewsPackage(record, context) {
    return context?.actorRole === 'visc' && context.canReviewPackage === true && Boolean(text(context.actorUid)) &&
      (!record?.viscUid || context.actorUid === record.viscUid);
  }
  function canSubmitForViscReview(record, sessions, context = {}) {
    if (!ownsPackage(record,context) || !validRevision(record) || (record.revision ?? 0) >= Number.MAX_SAFE_INTEGER) return false;
    const current = readyFingerprint(sessions,context.suggestions ?? []);
    if (!current) return false;
    if (['draft','changes_requested'].includes(record.status)) return true;
    // An approved package changed in Working must explicitly be resubmitted by
    // its HICC owner. It can never carry the earlier decision to a new revision.
    return record.status === 'visc_approved' && isFingerprint(record.viscApprovedFingerprint) &&
      (current !== record.viscApprovedFingerprint || currentGeneration(record) !== approvedGeneration(record));
  }
  function canViscApprove(record, currentFingerprint, context = {}) {
    return record?.status === 'visc_review' && validRevision(record) && record.revision > 0 &&
      currentGeneration(record) !== null && currentGeneration(record) === submittedGeneration(record) &&
      reviewsPackage(record,context) && isFingerprint(currentFingerprint) &&
      record.reviewFingerprint === currentFingerprint &&
      (context.sessions === undefined || readyFingerprint(context.sessions,context.suggestions ?? []) === currentFingerprint);
  }
  function approvedContent(record, currentFingerprint, sessions, suggestions) {
    return validRevision(record) && record.revision > 0 && isFingerprint(currentFingerprint) &&
      currentGeneration(record) !== null && currentGeneration(record) === submittedGeneration(record) &&
      submittedGeneration(record) === approvedGeneration(record) &&
      record.reviewFingerprint === currentFingerprint && record.viscApprovedFingerprint === currentFingerprint &&
      readyFingerprint(sessions,suggestions) === currentFingerprint;
  }
  function canHiccFinalSubmit(record, currentFingerprint, context = {}) {
    return record?.status === 'visc_approved' && ownsPackage(record,context) &&
      approvedContent(record,currentFingerprint,context.sessions,context.suggestions ?? []);
  }
  function canEnterAdfadQueue(record, sessions, suggestions = []) {
    return record?.status === 'submitted_to_adfad' &&
      approvedContent(record,readyFingerprint(sessions,suggestions),sessions,suggestions);
  }

  // Returns a new record; the caller owns storage and any trusted timestamps.
  // adfad_finalized is vocabulary only: there is no finalization action here.
  function transition(record, action, context = {}) {
    const current = readyFingerprint(context.sessions,context.suggestions ?? []);
    if (action === 'submit' && canSubmitForViscReview(record,context.sessions,context)) {
      return {...record,workingRevision:currentGeneration(record) ?? 0,status:'visc_review',revision:(record.revision ?? 0) + 1,
        submittedWorkingRevision:currentGeneration(record) ?? 0,viscApprovedWorkingRevision:null,
        reviewFingerprint:current,viscApprovedFingerprint:'',viscReviewComment:'',
        submittedForReviewAt:null,viscReviewedAt:null,finalSubmittedAt:null,updatedAt:null};
    }
    if (action === 'approve' && canViscApprove(record,current,context)) {
      return {...record,status:'visc_approved',viscApprovedWorkingRevision:currentGeneration(record),viscApprovedFingerprint:current,viscReviewedAt:null,updatedAt:null};
    }
    if (action === 'push_back' && record?.status === 'visc_review' && reviewsPackage(record,context) &&
        validRevision(record) && record.revision > 0 && isFingerprint(record.reviewFingerprint)) {
      const comment = text(context.comment);
      if (comment && comment.length <= 2000) {
        return {...record,status:'changes_requested',viscApprovedWorkingRevision:null,viscApprovedFingerprint:'',viscReviewComment:comment,
          viscReviewedAt:null,finalSubmittedAt:null,updatedAt:null};
      }
    }
    if (action === 'final_submit' && canHiccFinalSubmit(record,current,context)) {
      return {...record,status:'submitted_to_adfad',finalSubmittedAt:null,updatedAt:null};
    }
    throw Error('Teaching Assignment review action is not allowed for this actor, state or content.');
  }

  return Object.freeze({STATES,contentReadiness,reviewFingerprint,canSubmitForViscReview,
    canViscApprove,canHiccFinalSubmit,canEnterAdfadQueue,transition});
});
