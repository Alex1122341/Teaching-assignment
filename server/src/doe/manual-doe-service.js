'use strict';
const { randomUUID } = require('node:crypto');
const { resolveAcademicYear } = require('../data/academic-year');
const ROLES = ['Course Coordinator','HICC','VISC','Course Coordinator / HICC','Rotation / Week Lead','CCC','Trainee / Supervision','Special Project','Other'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = value => String(value ?? '').trim();
const key = value => text(value).replace(/\s+/g,' ').toLowerCase();
const invalid = message => Object.assign(new Error(message), { code: 'MANUAL_DOE_INVALID' });

function createManualDoeService({ repository, idFactory = randomUUID } = {}) {
  if (!repository?.saveManualAssignment || !repository?.scopeSuggestions) throw new TypeError('Manual DOE repository required.');
  async function save({ actorUid, payload, assignmentId = '', deactivate = false }) {
    const allowed = deactivate ? ['academicYear','facultyId','expectedRevision'] : ['academicYear','facultyId','expectedRevision','roleType','scopeText','doeValue','notes','requestId'];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(field => !allowed.includes(field))) throw invalid('Unsupported manual DOE fields.');
    const academicYear = resolveAcademicYear(payload.academicYear), facultyId = text(payload.facultyId);
    const expectedRevision = payload.expectedRevision ?? 0;
    if (!UUID.test(facultyId) || (assignmentId && !UUID.test(assignmentId)) || !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 0 || (assignmentId ? expectedRevision < 1 : expectedRevision !== 0)) throw invalid('Faculty, assignment identity and current revision are required.');
    if (payload.requestId !== undefined && (assignmentId || typeof payload.requestId !== 'string' || !UUID.test(payload.requestId))) throw invalid('New assignment request identity is invalid.');
    let roleType = null, scopeText = null, doeValue = null, notes = null, courseCode = null, subjectKey = null;
    if (!deactivate) {
      roleType = ROLES.find(role => key(role) === key(payload.roleType));
      scopeText = text(payload.scopeText).replace(/\s+/g,' ');
      notes = text(payload.notes);
      doeValue = payload.doeValue;
      if (!roleType || !scopeText || scopeText.length > 256 || notes.length > 1000) throw invalid('A supported role and scope (up to 256 characters) are required.');
      if (typeof doeValue !== 'number' || !Number.isFinite(doeValue) || Math.abs(doeValue) > 999999.999999
        || Math.abs(doeValue * 1e6 - Math.round(doeValue * 1e6)) > 0.001) throw invalid('Enter a finite DOE percentage with at most six decimal places.');
      if (doeValue < 0 && !notes) throw invalid('A negative DOE adjustment requires the negotiated reason in Notes.');
      const options = await repository.scopeSuggestions(academicYear);
      const matches = options.filter(option => key(option.scopeText) === key(scopeText));
      const exact = matches.filter(option => key(option.courseCode) === key(scopeText) || key(option.subjectKey) === key(scopeText));
      const candidates = exact.length ? exact : matches;
      const preferred = candidates.find(option => roleType === 'VISC' ? option.subjectKey : option.courseCode) || candidates[0];
      if (preferred) {
        scopeText = text(preferred.scopeText);
        const courseTags = [...new Set(candidates.map(option => text(option.courseCode)).filter(Boolean))];
        const subjectTags = [...new Set(candidates.map(option => text(option.subjectKey)).filter(Boolean))];
        // Ambiguous names stay editable scope text; do not guess a course identity.
        courseCode = courseTags.length === 1 ? courseTags[0] : null;
        subjectKey = subjectTags.length === 1 ? subjectTags[0] : null;
      }
    }
    return repository.saveManualAssignment({ assignmentId: assignmentId || payload.requestId || idFactory(),facultyId,academicYear,expectedRevision,
      roleType,scopeText,courseCode,subjectKey,doeValue,notes,actorUid:text(actorUid),deactivate });
  }
  return Object.freeze({ save, scopeSuggestions: academicYear => repository.scopeSuggestions(resolveAcademicYear(academicYear)) });
}
module.exports = { createManualDoeService };
