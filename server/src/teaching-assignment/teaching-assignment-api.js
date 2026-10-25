'use strict';

const {writeDisabled} = require('../data/write-gates');
const {ADMINISTRATOR_ROLES, normalizeBaseRole} = require('../auth/role-policy');

const ADMIN = ADMINISTRATOR_ROLES;
const YEAR = /^[1-9]\d{3}-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ok = (body={}) => ({status:200,body});
const fail = (status,code,message) => ({status,body:{error:{code,message}}});
const roleOf = user => normalizeBaseRole(user?.baseRole) || String(user?.baseRole || '').trim().toLowerCase();

function validYear(value) {
  const match=YEAR.exec(String(value || ''));
  return Boolean(match && Number(match[1]) === (Number(String(value).slice(0,4))+1)%100);
}
function onlyKeys(payload, keys) {
  return payload && typeof payload==='object' && !Array.isArray(payload) && Object.keys(payload).every(key=>keys.has(key));
}
function conflict(error) {
  return [52113,52120,52131,52140,52151].includes(Number(error?.number || error?.code));
}

function createTeachingAssignmentApi({verifyToken,findUser,repository,writeGates={}}) {
  if (!verifyToken || !findUser || !repository) throw new Error('Teaching Assignment auth and repository dependencies are required.');
  async function actor(token) {
    if (!token) return {response:fail(401,'UNAUTHENTICATED','A Firebase bearer token is required.')};
    let decoded;
    try { decoded=await verifyToken(token); } catch (_) { return {response:fail(401,'UNAUTHENTICATED','The Firebase bearer token is invalid.')}; }
    const uid=String(decoded?.uid || '').trim();
    if (!uid) return {response:fail(401,'UNAUTHENTICATED','The Firebase identity is unavailable.')};
    const user=await findUser(uid);
    if (!user || user.active!==true) return {response:fail(403,'PROFILE_REQUIRED','An active user profile is required.')};
    if (user.mustChangePassword===true) return {response:fail(403,'PASSWORD_CHANGE_REQUIRED','Password change is required before access.')};
    return {uid,user,role:roleOf(user)};
  }
  async function invoke(method,args,key=null) {
    try {
      const value=await repository[method](args);
      if (value===null && ['getPackage','getHistory','getPublishedRelease'].includes(method)) return fail(404,'NOT_FOUND','The requested Teaching Assignment record was not found in the authorized scope.');
      return ok(key?{[key]:value}:value);
    }
    catch (error) {
      if (conflict(error)) return fail(409,'REVISION_CONFLICT','The workflow changed. Reload it and retry against the current revision.');
      const n=Number(error?.number || error?.code);
      if (n>=52100 && n<52200) return fail(n===52111?404:400,'TEACHING_ASSIGNMENT_INVALID',String(error.message || 'The workflow request was rejected.'));
      return fail(503,'SERVICE_UNAVAILABLE','The workflow service is temporarily unavailable.');
    }
  }
  function allowed(a, roles) { return roles.has(a.role); }
  function enabled(key) { return writeGates[key] === true; }

  return Object.freeze({
    async writeCapabilities(token) {
      const a=await actor(token); if (a.response) return a.response;
      return ok({writeCapabilities:{taDraft:enabled('taDraft'),taReview:enabled('taReview'),taFinal:enabled('taFinal'),taPublish:enabled('taPublish')}});
    },
    async workQueue(token,{academicYear}={}) {
      const a=await actor(token); if (a.response) return a.response;
      if (!validYear(academicYear)) return fail(400,'INVALID_ACADEMIC_YEAR','A valid academic year is required.');
      if (!['hicc','visc'].includes(a.role) && !ADMIN.has(a.role)) return fail(403,'WORK_QUEUE_DENIED','This profile cannot view the work queue.');
      return invoke('listWorkQueue',{actorFirebaseUid:a.uid,facultyId:a.user.facultyId || null,role:a.role,academicYear},'workQueue');
    },
    async contributionTargets(token,{academicYear}={}) {
      const a=await actor(token); if (a.response) return a.response;
      if (!validYear(academicYear)) return fail(400,'INVALID_ACADEMIC_YEAR','A valid academic year is required.');
      if (!['adc','lab'].includes(a.role)) return fail(403,'CONTRIBUTION_TARGETS_DENIED','Only approved contribution offices can view suggestion targets.');
      return invoke('listContributionTargets',{academicYear},'targets');
    },
    async getPackage(token,packageId) {
      const a=await actor(token); if (a.response) return a.response;
      if (!UUID.test(String(packageId || ''))) return fail(400,'INVALID_PACKAGE_ID','The package identifier is invalid.');
      if (!['hicc','visc'].includes(a.role) && !ADMIN.has(a.role)) return fail(403,'PACKAGE_DENIED','This profile cannot view working packages.');
      return invoke('getPackage',{packageId,actorFirebaseUid:a.uid,facultyId:a.user.facultyId || null,role:a.role});
    },
    async history(token,packageId) {
      const a=await actor(token); if (a.response) return a.response;
      if (!UUID.test(String(packageId || ''))) return fail(400,'INVALID_PACKAGE_ID','The package identifier is invalid.');
      if (!['hicc','visc'].includes(a.role) && !ADMIN.has(a.role)) return fail(403,'HISTORY_DENIED','This profile cannot view workflow history.');
      return invoke('getHistory',{packageId,actorFirebaseUid:a.uid,facultyId:a.user.facultyId || null,role:a.role});
    },
    async published(token,{academicYear}={}) {
      const a=await actor(token); if (a.response) return a.response;
      if (!validYear(academicYear)) return fail(400,'INVALID_ACADEMIC_YEAR','A valid academic year is required.');
      if (!ADMIN.has(a.role) && !['faculty','hicc','visc'].includes(a.role)) return fail(403,'PUBLISHED_READ_DENIED','This profile cannot view published teaching assignments.');
      if (['faculty','hicc','visc'].includes(a.role) && !a.user.facultyId) return fail(403,'FACULTY_LINK_REQUIRED','A linked Faculty record is required to view published assignments.');
      return invoke('getPublishedRelease',{academicYear,actorFirebaseUid:a.uid,facultyId:a.user.facultyId || null,role:a.role});
    },
    async publicationHistory(token,{academicYear}={}) {
      const a=await actor(token); if (a.response) return a.response;
      if (!validYear(academicYear)) return fail(400,'INVALID_ACADEMIC_YEAR','A valid academic year is required.');
      return invoke('listPublicationHistory',{academicYear,actorFirebaseUid:a.uid,facultyId:a.user.facultyId || null,role:a.role},'releases');
    },
    async saveDraft(token,payload) {
      const a=await actor(token); if (a.response) return a.response;
      if (!enabled('taDraft')) return writeDisabled();
      if (!onlyKeys(payload,new Set(['packageId','expectedWorkingRevision','sessions','revisionNote'])) || !UUID.test(String(payload.packageId || '')) || !Number.isInteger(payload.expectedWorkingRevision) || payload.expectedWorkingRevision<0 || !Array.isArray(payload.sessions) || payload.sessions.length>200 || (payload.revisionNote!==undefined && (typeof payload.revisionNote!=='string' || payload.revisionNote.length>1000))) return fail(400,'INVALID_DRAFT','The draft request contains invalid or unsupported fields.');
      if (a.role!=='hicc') return fail(403,'HICC_REQUIRED','Only the current HICC assignee can edit this package.');
      return invoke('saveDraft',{packageId:payload.packageId,expectedWorkingRevision:payload.expectedWorkingRevision,sessions:payload.sessions,revisionNote:payload.revisionNote || null,actorFirebaseUid:a.uid});
    },
    async addContribution(token,packageId,payload) {
      const a=await actor(token); if (a.response) return a.response;
      if (!enabled('taDraft')) return writeDisabled();
      if (!UUID.test(String(packageId || '')) || !onlyKeys(payload,new Set(['revisionNumber','sessionId','candidateKey','suggestedDisplayName','note'])) || !Number.isInteger(payload.revisionNumber) || payload.revisionNumber<1 || !UUID.test(String(payload.sessionId || '')) || typeof payload.candidateKey!=='string' || !payload.candidateKey.trim() || payload.candidateKey.length>128 || typeof payload.suggestedDisplayName!=='string' || !payload.suggestedDisplayName.trim() || payload.suggestedDisplayName.length>260 || (payload.note!==undefined && (typeof payload.note!=='string' || payload.note.length>1000))) return fail(400,'INVALID_CONTRIBUTION','An opaque candidate and bounded display suggestion are required.');
      if (!['adc','lab','hicc'].includes(a.role)) return fail(403,'CONTRIBUTOR_REQUIRED','Only an approved contribution actor can add a suggestion.');
      return invoke('addContribution',{packageId,revisionNumber:payload.revisionNumber,sessionId:payload.sessionId,candidateKey:payload.candidateKey.trim(),suggestedDisplayName:payload.suggestedDisplayName.trim(),suggestedByOffice:a.role,note:payload.note || null,actorFirebaseUid:a.uid});
    },
    async submit(token,packageId,payload) {
      const a=await actor(token); if (a.response) return a.response;
      if (!enabled('taDraft')) return writeDisabled();
      if (!UUID.test(String(packageId || '')) || !onlyKeys(payload,new Set(['expectedWorkingRevision'])) || !Number.isInteger(payload.expectedWorkingRevision) || payload.expectedWorkingRevision<1) return fail(400,'INVALID_SUBMISSION','A package and current working revision are required.');
      if (a.role!=='hicc') return fail(403,'HICC_REQUIRED','Only the current HICC assignee can submit this package.');
      return invoke('submit',{packageId,expectedWorkingRevision:payload.expectedWorkingRevision,actorFirebaseUid:a.uid});
    },
    async review(token,packageId,payload) {
      const a=await actor(token); if (a.response) return a.response;
      if (!enabled('taReview')) return writeDisabled();
      if (!UUID.test(String(packageId || '')) || !onlyKeys(payload,new Set(['revisionNumber','decision','comment'])) || !Number.isInteger(payload.revisionNumber) || payload.revisionNumber<1 || !['approved','push_back'].includes(payload.decision) || (payload.comment!==undefined && (typeof payload.comment!=='string' || payload.comment.length>2000)) || (payload.decision==='push_back' && !String(payload.comment || '').trim())) return fail(400,'INVALID_REVIEW','A review decision and (for push-back) a reason are required.');
      if (a.role!=='visc') return fail(403,'VISC_REQUIRED','Only a current VISC group lead can review this package.');
      return invoke('review',{packageId,revisionNumber:payload.revisionNumber,decision:payload.decision,comment:payload.comment || null,actorFirebaseUid:a.uid});
    },
    async finalSubmit(token,packageId,payload) {
      const a=await actor(token); if (a.response) return a.response;
      if (!enabled('taDraft')) return writeDisabled();
      if (!UUID.test(String(packageId || '')) || !onlyKeys(payload,new Set(['expectedWorkingRevision'])) || !Number.isInteger(payload.expectedWorkingRevision) || payload.expectedWorkingRevision<1) return fail(400,'INVALID_FINAL_SUBMISSION','A current revision is required.');
      if (a.role!=='hicc') return fail(403,'HICC_REQUIRED','Only the current HICC assignee can final-submit this package.');
      return invoke('finalSubmit',{packageId,expectedWorkingRevision:payload.expectedWorkingRevision,actorFirebaseUid:a.uid});
    },
    async saveFinalization(token,packageId,payload) {
      const a=await actor(token); if (a.response) return a.response;
      if (!enabled('taFinal')) return writeDisabled();
      if (!UUID.test(String(packageId || '')) || !onlyKeys(payload,new Set(['expectedWorkingRevision','assignments','finalNote'])) || !Number.isInteger(payload.expectedWorkingRevision) || payload.expectedWorkingRevision<1 || !Array.isArray(payload.assignments) || payload.assignments.length>200 || (payload.finalNote!==undefined && (typeof payload.finalNote!=='string' || payload.finalNote.length>2000))) return fail(400,'INVALID_FINAL_ASSIGNMENT','The final assignment request is invalid.');
      if (!ADMIN.has(a.role)) return fail(403,'ADFAD_REQUIRED','An ADFAD administrator is required for final assignment.');
      return invoke('saveFinalization',{packageId,expectedWorkingRevision:payload.expectedWorkingRevision,assignments:payload.assignments,finalNote:payload.finalNote || null,actorFirebaseUid:a.uid});
    },
    async publish(token,payload) {
      const a=await actor(token); if (a.response) return a.response;
      if (!enabled('taPublish')) return writeDisabled();
      if (!onlyKeys(payload,new Set(['academicYear','publicationNote'])) || !validYear(payload.academicYear) || (payload.publicationNote!==undefined && (typeof payload.publicationNote!=='string' || payload.publicationNote.length>2000))) return fail(400,'INVALID_PUBLICATION','A valid academic year is required.');
      if (!ADMIN.has(a.role)) return fail(403,'ADFAD_REQUIRED','An ADFAD administrator is required to publish.');
      return invoke('publish',{academicYear:payload.academicYear,publicationNote:payload.publicationNote || null,actorFirebaseUid:a.uid});
    }
  });
}

module.exports={createTeachingAssignmentApi,validYear};
