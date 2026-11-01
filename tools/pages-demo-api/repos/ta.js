'use strict';
// Teaching Assignment packages for the Frontend Demo: HICC draft -> VISC review
// -> HICC final submit -> ADFAD finalization -> published release snapshots.
const { isAdministratorRole } = require('../../../server/src/auth/role-policy.js');
const { uuidFor } = require('../ids.js');
const { clone, sqlError } = require('./core.js');
const { assertAssignable } = require('../faculty-activation.js');

const userOf = (store, uid) => store.tables.users.find(u => u.firebaseUid === uid) || {};
const conflict = () => Object.assign(new Error('Revision conflict'), { number: 52109, code: 'REVISION_CONFLICT' });
const name = (store, id) => (store.tables.faculty.find(f => f.facultyId === id) || {}).displayName || '';

function state(store) {
  return store.bag('teachingAssignments', () => {
    const t = store.tables, year = t.academicYear;
    const hiccRoles = t.roles.filter(r => r.roleType === 'HICC' && r.academicYear === year && (!r.expirationDate || r.expirationDate >= '2026-10-15'));
    const statuses = ['draft', 'visc_review', 'changes_requested', 'visc_approved', 'submitted_to_adfad', 'adfad_finalized'];
    const packages = hiccRoles.slice(0, 8).map((role, i) => {
      const course = t.courses.find(c => c.catalogLabel === role.courseOrSubjectOrRotation) || {};
      const sessions = t.sessions.filter(s => s.courseCode === course.courseCode).slice(0, 6).map(s => ({ sessionId: s.id, courseCode: s.courseCode, courseName: s.courseName, topic: s.topic, sessionDate: s.date, startTime: s.startTime, endTime: s.endTime, sessionType: s.sessionType, room: s.room, assignments: s.assignments.map(a => ({ facultyId: a.facultyId, facultyName: name(store, a.facultyId), teachingRole: a.teachingRole || '' })) }));
      const status = statuses[i % statuses.length];
      const workingRevision = status === 'draft' ? 1 : 2;
      return { packageId: uuidFor(`ta-package:${role.roleAssignmentId}`), academicYear: year, groupId: `G${1 + (i % 3)}`, groupName: ['Bovine', 'Companion animal', 'Foundations'][i % 3], hiccLabel: `${course.courseCode || ''} · ${name(store, role.facultyId)}`, packageIdentity: `${course.courseCode} HICC package`, responsibleHiccResponsibilityId: role.roleAssignmentId, hiccFacultyId: role.facultyId, status, workingRevision, approvedRevision: ['visc_approved', 'submitted_to_adfad', 'adfad_finalized'].includes(status) ? workingRevision : null, submittedRevision: status === 'draft' ? null : workingRevision, dueAtUtc: '2026-11-30T23:59:00.000Z', updatedAtUtc: '2026-10-20T16:00:00.000Z', revisions: [{ revisionNumber: 1, sessions: clone(sessions), note: 'Initial proposal' }, ...(workingRevision > 1 ? [{ revisionNumber: 2, sessions: clone(sessions), note: 'Updated after review' }] : [])], reviews: status === 'changes_requested' ? [{ revisionNumber: 2, decision: 'push_back', comment: 'Please balance lab sessions across the team.', createdAtUtc: '2026-10-18T16:00:00.000Z', actorName: 'VISC Lead' }] : ['visc_approved', 'submitted_to_adfad', 'adfad_finalized'].includes(status) ? [{ revisionNumber: 2, decision: 'approved', comment: '', createdAtUtc: '2026-10-19T16:00:00.000Z', actorName: 'VISC Lead' }] : [], contributions: i % 2 ? [{ revisionNumber: workingRevision, sessionId: sessions[0]?.sessionId, suggestedDisplayName: name(store, t.faculty[(i + 3) % 14].facultyId), suggestedByOffice: 'lab', note: 'Available for this lab', createdAtUtc: '2026-10-17T16:00:00.000Z' }] : [], finalization: status === 'adfad_finalized' ? sessions.flatMap(s => s.assignments.map(a => ({ sessionId: s.sessionId, facultyId: a.facultyId, teachingRole: a.teachingRole }))) : [], activities: [{ eventType: 'package_created', occurredAtUtc: '2026-10-01T16:00:00.000Z', actorName: 'PAWS', revisionNumber: 1 }] };
    });
    const finalized = packages.filter(p => p.status === 'adfad_finalized');
    const releases = finalized.length ? [{ releaseId: uuidFor('ta-release:1'), academicYear: year, versionNumber: 1, isCurrent: true, publishedAtUtc: '2026-10-21T16:00:00.000Z', publishedBy: 'ADFA General', publicationNote: 'First 2026-27 release', publishedSessionCount: finalized.reduce((n, p) => n + p.revisions.at(-1).sessions.length, 0), sessions: finalized.flatMap(p => clone(p.revisions.at(-1).sessions)) }] : [];
    return { packages, releases };
  });
}

function inScope(store, p, { facultyId, role }) {
  if (isAdministratorRole(role)) return true;
  if (role === 'hicc') return p.hiccFacultyId === facultyId;
  if (role === 'visc') return ['visc_review', 'changes_requested', 'visc_approved'].includes(p.status) || p.groupId === 'G1';
  return false;
}
const queueRow = p => ({ packageId: p.packageId, academicYear: p.academicYear, groupId: p.groupId, groupName: p.groupName, hiccLabel: p.hiccLabel, responsibleHiccResponsibilityId: p.responsibleHiccResponsibilityId, status: p.status, workingRevision: p.workingRevision, dueAtUtc: p.dueAtUtc, lastActivityAtUtc: p.updatedAtUtc, nextAction: null, warning: null, courseCode: p.revisions.at(-1).sessions[0]?.courseCode || '', courseName: p.revisions.at(-1).sessions[0]?.courseName || '' });
const packageView = p => { const { hiccFacultyId, activities, ...rest } = p; return clone(rest); };

function createTeachingAssignmentRepository(store) {
  const find = (id, scope) => { const p = state(store).packages.find(x => x.packageId === id); return p && (!scope || inScope(store, p, scope)) ? p : null; };
  const touch = (p, uid, eventType) => { p.updatedAtUtc = store.nowIso(); p.activities.unshift({ eventType, occurredAtUtc: p.updatedAtUtc, actorName: userOf(store, uid).displayName || 'PAWS user', revisionNumber: p.workingRevision }); store.commit(); return packageView(p); };
  return {
    async listWorkQueue(scope) { return state(store).packages.filter(p => p.academicYear === scope.academicYear && inScope(store, p, scope)).map(queueRow); },
    async listContributionTargets({ academicYear }) { return state(store).packages.filter(p => p.academicYear === academicYear && ['draft', 'changes_requested', 'visc_review'].includes(p.status)).flatMap(p => p.revisions.at(-1).sessions.map(s => ({ packageId: p.packageId, academicYear: p.academicYear, groupName: p.groupName, hiccLabel: p.hiccLabel, status: p.status, revisionNumber: p.workingRevision, sessionId: s.sessionId, courseCode: s.courseCode, topic: s.topic, sessionDate: s.sessionDate, teachingRole: s.assignments[0]?.teachingRole || '' }))); },
    async getPackage(scope) { const p = find(scope.packageId, scope); return p ? packageView(p) : null; },
    async getHistory(scope) { const p = find(scope.packageId, scope); return p ? { packageId: p.packageId, activities: clone(p.activities) } : null; },
    async getPublishedRelease({ academicYear, facultyId, role }) {
      const release = state(store).releases.find(r => r.academicYear === academicYear && r.isCurrent);
      if (!release) return null;
      const view = clone(release);
      if (!isAdministratorRole(role)) view.sessions = view.sessions.filter(s => s.assignments.some(a => a.facultyId === facultyId));
      return view;
    },
    async listPublicationHistory({ academicYear }) { return state(store).releases.filter(r => r.academicYear === academicYear).map(({ sessions, ...rest }) => clone(rest)); },
    async saveDraft({ packageId, expectedWorkingRevision, sessions, revisionNote, actorFirebaseUid }) {
      const p = find(packageId); if (!p) throw sqlError(52111, 'Package not found');
      if (p.workingRevision !== expectedWorkingRevision) throw conflict();
      if (!['draft', 'changes_requested'].includes(p.status)) throw sqlError(52102, 'The package is not editable in its current stage.');
      const base = p.revisions.at(-1).sessions;
      const next = base.map(s => { const edit = sessions.find(x => x.sessionId === s.sessionId); return edit ? { ...s, assignments: (edit.assignments || []).map(a => ({ facultyId: a.facultyId, facultyName: name(store, a.facultyId), teachingRole: a.teachingRole || '' })) } : s; });
      for(const edit of sessions) {
        const corresponding=next.find(s=>s.sessionId===edit.sessionId);
        if(corresponding)for(const a of corresponding.assignments||[])
          if(a.facultyId)assertAssignable(store,a.facultyId,corresponding.sessionDate);
      }
      p.workingRevision += 1; p.revisions.push({ revisionNumber: p.workingRevision, sessions: next, note: revisionNote || '' }); p.status = 'draft';
      return touch(p, actorFirebaseUid, 'draft_saved');
    },
    async submit({ packageId, expectedWorkingRevision, actorFirebaseUid }) {
      const p = find(packageId); if (!p) throw sqlError(52111, 'Not found');
      if (p.workingRevision !== expectedWorkingRevision) throw conflict();
      if (!['draft', 'changes_requested'].includes(p.status)) throw sqlError(52103, 'Only a draft can be submitted.');
      p.status = 'visc_review'; p.submittedRevision = p.workingRevision;
      return touch(p, actorFirebaseUid, 'submitted_to_visc');
    },
    async review({ packageId, revisionNumber, decision, comment, actorFirebaseUid }) {
      const p = find(packageId); if (!p) throw sqlError(52111, 'Not found');
      if (p.status !== 'visc_review') throw sqlError(52104, 'The package is not waiting for VISC review.');
      if (p.workingRevision !== revisionNumber) throw conflict();
      p.reviews.push({ revisionNumber, decision, comment: comment || '', createdAtUtc: store.nowIso(), actorName: userOf(store, actorFirebaseUid).displayName });
      p.status = decision === 'approved' ? 'visc_approved' : 'changes_requested'; if (decision === 'approved') p.approvedRevision = revisionNumber;
      return touch(p, actorFirebaseUid, decision === 'approved' ? 'visc_approved' : 'visc_push_back');
    },
    async addContribution({ packageId, revisionNumber, sessionId, suggestedDisplayName, suggestedByOffice, note, actorFirebaseUid }) {
      const p = find(packageId); if (!p) throw sqlError(52111, 'Not found');
      if (p.workingRevision !== revisionNumber) throw conflict();
      p.contributions.push({ revisionNumber, sessionId, suggestedDisplayName, suggestedByOffice, note: note || '', createdAtUtc: store.nowIso() });
      return touch(p, actorFirebaseUid, 'contribution_added');
    },
    async finalSubmit({ packageId, expectedWorkingRevision, actorFirebaseUid }) {
      const p = find(packageId); if (!p) throw sqlError(52111, 'Not found');
      if (p.workingRevision !== expectedWorkingRevision) throw conflict();
      if (p.status !== 'visc_approved') throw sqlError(52105, 'VISC approval is required before final submit.');
      p.status = 'submitted_to_adfad';
      return touch(p, actorFirebaseUid, 'submitted_to_adfad');
    },
    async saveFinalization({ packageId, expectedWorkingRevision, assignments, finalNote, actorFirebaseUid }) {
      const p = find(packageId); if (!p) throw sqlError(52111, 'Not found');
      if (p.workingRevision !== expectedWorkingRevision) throw conflict();
      if (!['submitted_to_adfad', 'adfad_finalized'].includes(p.status)) throw sqlError(52106, 'The package has not been submitted to ADFAD.');
      const currentSessions=p.revisions.at(-1).sessions;
      for(const a of assignments) {
        const session=currentSessions.find(s=>s.sessionId===a.sessionId);
        if(a.facultyId)assertAssignable(store,a.facultyId,session?.sessionDate);
      }
      p.finalization = assignments.map(a => ({ sessionId: a.sessionId, facultyId: a.facultyId, teachingRole: a.teachingRole || '', facultyName: name(store, a.facultyId) }));
      p.finalNote = finalNote || ''; p.status = 'adfad_finalized';
      return touch(p, actorFirebaseUid, 'adfad_finalized');
    },
    async publish({ academicYear, publicationNote, actorFirebaseUid }) {
      const s = state(store), finalized = s.packages.filter(p => p.academicYear === academicYear && p.status === 'adfad_finalized');
      if (!finalized.length) throw sqlError(52107, 'There are no finalized packages to publish.');
      for (const r of s.releases) if (r.academicYear === academicYear) r.isCurrent = false;
      const sessions = finalized.flatMap(p => p.revisions.at(-1).sessions.map(sess => ({ ...clone(sess), assignments: p.finalization.filter(f => f.sessionId === sess.sessionId).map(f => ({ facultyId: f.facultyId, facultyName: name(store, f.facultyId), teachingRole: f.teachingRole })) })));
      const release = { releaseId: uuidFor(`ta-release:${academicYear}:${s.releases.length + 1}:${Date.now()}`), academicYear, versionNumber: s.releases.filter(r => r.academicYear === academicYear).length + 1, isCurrent: true, publishedAtUtc: store.nowIso(), publishedBy: userOf(store, actorFirebaseUid).displayName, publicationNote: publicationNote || '', publishedSessionCount: sessions.length, sessions };
      s.releases.unshift(release); store.commit();
      const { sessions: _omit, ...summary } = release;
      return summary;
    }
  };
}

module.exports = { createTeachingAssignmentRepository };
