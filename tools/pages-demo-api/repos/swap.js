'use strict';
// SWAP / change requests for the Frontend Demo: context, candidates with
// availability, staged routing (replacement consent, ADC/DVM, LAB, ADFA),
// decisions and apply-to-timetable, mirroring the SQL procedures' JSON.
const { isAdministratorRole } = require('../../../server/src/auth/role-policy.js');
const { sha256Hex, uuidFor } = require('../ids.js');
const { clone, sqlError } = require('./core.js');

const SCHEDULE = ['courseCode', 'date', 'startTime', 'endTime', 'sessionType', 'room'];
const hhmmss = v => v ? (String(v).length === 5 ? v + ':00' : String(v)) : null;
const userOf = (store, uid) => store.tables.users.find(u => u.firebaseUid === uid) || {};
const candidateKey = facultyId => uuidFor(`swap-candidate:${facultyId}`);
const facultyByCandidate = (store, key) => store.tables.faculty.find(f => candidateKey(f.facultyId) === key) || null;
const person = f => f ? { firstName: f.preferredFirstName, lastName: f.preferredLastName, displayName: f.displayName } : null;
const snapshotOf = s => sha256Hex(JSON.stringify([s.id, s.courseCode, s.date, s.startTime, s.endTime, s.sessionType, s.room, s.topic, s.assignments.map(a => a.facultyId + a.teachingRole)]));

function list(store) {
  return store.bag('swaps', () => {
    const t = store.tables;
    const pick = (course, type) => t.sessions.find(s => s.courseCode === course && s.sessionType === type && s.date >= '2026-10-26' && s.startTime);
    const make = (session, i, status, nextStage, changes, requesterUid) => {
      const a = session.assignments[0];
      const replacement = changes.replacementCandidateKey ? facultyByCandidate(store, changes.replacementCandidateKey) : null;
      return { requestId: uuidFor(`swap:${i}`), sessionId: session.id, assignmentId: a.sessionAssignmentId, snapshotToken: snapshotOf(session), revision: 1, status, nextStage, changes, note: i === 0 ? 'Conference travel that week – Petra has agreed to cover.' : 'Room clash with the anatomy lab.', notifyReplacement: Boolean(replacement), requesterUid, createdAtUtc: '2026-10-20T16:00:00.000Z', updatedAtUtc: '2026-10-22T16:00:00.000Z', routing: { needsAdc: SCHEDULE.some(k => k in changes), needsLab: false, needsVisc: false, notifyReplacement: Boolean(replacement) }, history: [], revisions: [{ revision: 1, createdAtUtc: '2026-10-20T16:00:00.000Z', actorUid: requesterUid }] };
    };
    const rows = [];
    const s1 = pick('VTMD 200', 'LEC'), s2 = pick('VTMD 302', 'LAB') || pick('VTMD 304', 'LEC');
    const fac = id => t.faculty.find(f => f.legacyId === id);
    if (s1) rows.push(make(s1, 0, 'pending', 'adfa', { replacementCandidateKey: candidateKey(fac('fac-010').facultyId) }, 'uid-' + (t.faculty.find(f => f.facultyId === s1.assignments[0].facultyId)?.legacyId || 'fac-001')));
    if (s2) rows.push(make(s2, 1, 'pending', 'adc', { room: 'HSB 1403' }, 'uid-' + (t.faculty.find(f => f.facultyId === s2.assignments[0].facultyId)?.legacyId || 'fac-002')));
    return rows;
  });
}

function routingKeys(r) { return [...(r.routing.notifyReplacement ? ['target'] : []), ...(r.routing.needsVisc ? ['visc'] : []), ...(r.routing.needsAdc ? ['adc'] : []), ...(r.routing.needsLab ? ['lab'] : []), 'adfa']; }

function canDecideStage(store, r, uid) {
  const u = userOf(store, uid), role = String(u.baseRole || '').toLowerCase();
  if (r.status !== 'pending') return false;
  if (r.nextStage === 'target') { const f = facultyByCandidate(store, r.changes.replacementCandidateKey); return Boolean(f && u.facultyId === f.facultyId); }
  if (r.nextStage === 'adc') return role === 'adc' || isAdministratorRole(role);
  if (r.nextStage === 'lab') return role === 'lab' || isAdministratorRole(role);
  if (r.nextStage === 'visc') return role === 'visc' || isAdministratorRole(role);
  return isAdministratorRole(role);
}

function canSee(store, r, uid) {
  const u = userOf(store, uid), role = String(u.baseRole || '').toLowerCase();
  if (isAdministratorRole(role) || r.requesterUid === uid || canDecideStage(store, r, uid) || ['adc', 'lab'].includes(role)) return true;
  const session = store.tables.sessions.find(s => s.id === r.sessionId);
  const replacement = facultyByCandidate(store, r.changes.replacementCandidateKey);
  return Boolean(u.facultyId && ((session && session.assignments.some(a => a.facultyId === u.facultyId)) || (replacement && replacement.facultyId === u.facultyId)));
}

function requestJson(store, r, uid) {
  const t = store.tables, session = t.sessions.find(s => s.id === r.sessionId) || {};
  const requester = t.faculty.find(f => f.facultyId === userOf(store, r.requesterUid).facultyId);
  const replacement = facultyByCandidate(store, r.changes.replacementCandidateKey);
  const assignment = (r.original && r.original.assignmentFacultyId) ? t.faculty.find(f => f.facultyId === r.original.assignmentFacultyId) : t.faculty.find(f => f.facultyId === (session.assignments || []).find(a => a.sessionAssignmentId === r.assignmentId)?.facultyId);
  const original = r.original || { courseCode: session.courseCode, date: session.date, startTime: session.startTime, endTime: session.endTime, sessionType: session.sessionType, topic: session.topic, room: session.room };
  return { requestId: r.requestId, sessionId: r.sessionId, assignmentId: r.assignmentId, snapshotToken: r.snapshotToken, revision: r.revision, status: r.status, nextStage: r.status === 'pending' ? r.nextStage : null, courseCode: session.courseCode, date: session.date, academicYear: session.academicYear, topic: session.topic, createdAtUtc: r.createdAtUtc, updatedAtUtc: r.updatedAtUtc, changes: clone(r.changes), note: r.note, notifyReplacement: r.notifyReplacement, isMine: r.requesterUid === uid, requester: person(requester) || { displayName: userOf(store, r.requesterUid).displayName }, replacement: person(replacement), original: { ...original, assignment: person(assignment) }, routing: clone(r.routing) };
}

function detailJson(store, r, uid) {
  const u = userOf(store, uid), admin = isAdministratorRole(u.baseRole), decide = canDecideStage(store, r, uid);
  const actorName = au => { const x = userOf(store, au); const f = store.tables.faculty.find(ff => ff.facultyId === x.facultyId); return person(f) || { displayName: x.displayName || 'PAWS user' }; };
  const requiresOverride = admin && r.status === 'pending' && r.nextStage !== 'adfa';
  return {
    request: requestJson(store, r, uid),
    capabilities: { canRevise: r.requesterUid === uid && ['pending', 'changes_requested'].includes(r.status), canWithdraw: r.requesterUid === uid && ['pending', 'changes_requested'].includes(r.status), canDecide: decide, canOverride: requiresOverride, requiresOverride: false, decisions: decide ? ['approve', 'reject', 'push_back'] : [], editableFields: r.requesterUid === uid ? ['replacementCandidateKey', ...SCHEDULE, 'topic'] : [] },
    history: r.history.map(h => ({ ...h, actor: actorName(h.actorUid) })),
    revisions: r.revisions.map(v => ({ revision: v.revision, createdAtUtc: v.createdAtUtc, actor: actorName(v.actorUid) })),
    notifications: r.notifyReplacement ? [{ revision: r.revision, status: r.history.some(h => h.stage === 'target') ? 'acknowledged' : 'sent' }] : []
  };
}

function availabilityFor(store, session, facultyId) {
  if (!session.date || !session.startTime || !session.endTime) return { status: 'Needs Review', conflicts: [] };
  const t = store.tables;
  const away = t.afcRecords.some(r => r.facultyId === facultyId && r.active && r.startDate <= session.date && r.endDate >= session.date);
  const conflicts = t.sessions.filter(s => s.id !== session.id && s.date === session.date && s.startTime && s.assignments.some(a => a.facultyId === facultyId) && s.startTime < session.endTime && session.startTime < s.endTime).map(s => ({ courseCode: s.courseCode, date: s.date, startTime: s.startTime, endTime: s.endTime, topic: s.topic }));
  return { status: away || conflicts.length ? 'Unavailable' : 'Available', conflicts };
}

function applyChanges(store, r, actorUid) {
  const session = store.tables.sessions.find(s => s.id === r.sessionId);
  if (!session) return;
  const before = clone(session);
  for (const key of [...SCHEDULE, 'topic']) if (r.changes[key] !== undefined) session[key] = key.endsWith('Time') ? hhmmss(r.changes[key]) : r.changes[key];
  if (r.changes.replacementCandidateKey) {
    const incoming = facultyByCandidate(store, r.changes.replacementCandidateKey), a = session.assignments.find(x => x.sessionAssignmentId === r.assignmentId);
    if (incoming && a) { r.original = { ...(r.original || {}), assignmentFacultyId: a.facultyId }; a.facultyId = incoming.facultyId; a.sourceFacultyName = incoming.displayName; }
  }
  session.updatedAtUtc = store.nowIso();
  store.audit({ domain: 'teaching', changeType: 'swap_applied', sessionId: session.id, actorFirebaseUid: actorUid, before, after: clone(session) });
}

function createSwapRepository(store) {
  const find = (id, uid) => { const r = list(store).find(x => x.requestId === id); if (!r || !canSee(store, r, uid)) throw sqlError(53004, 'The request is unavailable in your scope.'); return r; };
  const routeFor = (session, changes, notify) => ({ needsAdc: SCHEDULE.some(k => changes[k] !== undefined) || (changes.topic !== undefined && session.sessionType !== 'LAB'), needsLab: changes.topic !== undefined && session.sessionType === 'LAB', needsVisc: false, notifyReplacement: Boolean(changes.replacementCandidateKey && notify) });
  return {
    async context({ actorFirebaseUid, sessionId }) {
      const t = store.tables, session = t.sessions.find(s => s.id === sessionId);
      if (!session) throw sqlError(53004, 'Session not found');
      const u = userOf(store, actorFirebaseUid), role = String(u.baseRole || '').toLowerCase(), admin = isAdministratorRole(role);
      const own = u.facultyId && session.assignments.some(a => a.facultyId === u.facultyId);
      const hicc = u.facultyId && t.roles.some(r => r.facultyId === u.facultyId && ['HICC', 'Course Coordinator'].includes(r.roleType) && t.courses.some(c => c.catalogLabel === r.courseOrSubjectOrRotation && c.courseCode === session.courseCode));
      if (!(admin || own || hicc || ['adc', 'lab', 'visc'].includes(role))) throw sqlError(53003, 'Session is outside your SWAP scope.');
      const assigned = new Set(session.assignments.map(a => a.facultyId));
      return {
        session: { sessionId: session.id, academicYear: session.academicYear, curriculumYear: session.curriculumYear, courseCode: session.courseCode, courseName: session.courseName, sessionType: session.sessionType, date: session.date, startTime: session.startTime, endTime: session.endTime, topic: session.topic, room: session.room, snapshotToken: snapshotOf(session) },
        assignments: session.assignments.map(a => { const f = t.faculty.find(x => x.facultyId === a.facultyId); return { assignmentId: a.sessionAssignmentId, candidateKey: candidateKey(a.facultyId), displayName: f ? f.displayName : a.sourceFacultyName, canReplace: Boolean(admin || hicc || ['adc', 'lab', 'visc'].includes(role) || a.facultyId === u.facultyId) }; }),
        candidates: t.faculty.filter(f => f.active && !assigned.has(f.facultyId)).map(f => { const av = availabilityFor(store, session, f.facultyId); const linked = t.users.filter(x => x.facultyId === f.facultyId && x.active).length === 1; return { candidateKey: candidateKey(f.facultyId), displayName: f.displayName, availabilityStatus: av.status, available: av.status === 'Available', notifyAvailable: linked, notifyUnavailableReason: linked ? null : 'One active linked account is required.' }; }),
        fields: [['replacementCandidateKey', 'adfa'], ['courseCode', 'adc'], ['date', 'adc'], ['startTime', 'adc'], ['endTime', 'adc'], ['sessionType', 'adc'], ['room', 'adc'], ['topic', session.sessionType === 'LAB' ? 'lab' : 'adc']].map(([key, office]) => ({ key, editable: true, office, reason: null })),
        options: { courses: t.courses.map(c => ({ courseCode: c.courseCode, courseName: c.courseName })), sessionTypes: ['LEC', 'LAB', 'SRL', 'Quiz/Midterm', 'OSCE', 'Exam'] },
        canCreate: true, unavailableReasons: [],
        reviewers: [{ stage: 'visc', available: true }, { stage: 'adc', available: true }, { stage: 'lab', available: true }]
      };
    },
    async queue({ actorFirebaseUid }) {
      const rows = list(store).filter(r => canSee(store, r, actorFirebaseUid));
      return { requests: rows.map(r => ({ ...requestJson(store, r, actorFirebaseUid), canDecide: canDecideStage(store, r, actorFirebaseUid), requiresOverride: false })), notifications: [] };
    },
    async detail({ actorFirebaseUid, requestId }) { return detailJson(store, find(requestId, actorFirebaseUid), actorFirebaseUid); },
    async create({ actorFirebaseUid, payload }) {
      const session = store.tables.sessions.find(s => s.id === payload.sessionId);
      if (!session) throw sqlError(53004, 'Session not found');
      if (snapshotOf(session) !== payload.snapshotToken) throw sqlError(53010, 'The session changed; reload it.');
      const existing = list(store).find(r => r.requestId === payload.requestId);
      if (existing) return detailJson(store, existing, actorFirebaseUid);
      const now = store.nowIso();
      const r = { requestId: payload.requestId, sessionId: session.id, assignmentId: payload.assignmentId || null, snapshotToken: payload.snapshotToken, revision: 1, status: 'pending', nextStage: null, changes: clone(payload.changes), note: payload.note || '', notifyReplacement: payload.notifyReplacement === true, requesterUid: actorFirebaseUid, createdAtUtc: now, updatedAtUtc: now, routing: routeFor(session, payload.changes, payload.notifyReplacement), history: [], revisions: [{ revision: 1, createdAtUtc: now, actorUid: actorFirebaseUid }] };
      r.nextStage = routingKeys(r)[0];
      list(store).unshift(r);
      store.audit({ domain: 'teaching', changeType: 'swap_requested', sessionId: session.id, actorFirebaseUid, after: clone(r.changes) });
      store.commit();
      return detailJson(store, r, actorFirebaseUid);
    },
    async revise({ actorFirebaseUid, requestId, payload }) {
      const r = find(requestId, actorFirebaseUid);
      if (r.requesterUid !== actorFirebaseUid) throw sqlError(53003, 'Only the requester can revise.');
      if (payload.expectedRevision !== r.revision) throw sqlError(53009, 'Revision conflict');
      const session = store.tables.sessions.find(s => s.id === r.sessionId);
      r.changes = clone(payload.changes); r.note = payload.note || r.note; r.notifyReplacement = payload.notifyReplacement === true; if (payload.assignmentId) r.assignmentId = payload.assignmentId;
      r.revision += 1; r.status = 'pending'; r.routing = routeFor(session, r.changes, r.notifyReplacement); r.nextStage = routingKeys(r)[0]; r.updatedAtUtc = store.nowIso();
      r.revisions.push({ revision: r.revision, createdAtUtc: r.updatedAtUtc, actorUid: actorFirebaseUid });
      store.commit();
      return detailJson(store, r, actorFirebaseUid);
    },
    async decide({ actorFirebaseUid, requestId, payload, applyEnabled }) {
      const r = find(requestId, actorFirebaseUid);
      if (payload.expectedRevision !== r.revision) throw sqlError(53009, 'Revision conflict');
      const admin = isAdministratorRole(userOf(store, actorFirebaseUid).baseRole);
      if (!canDecideStage(store, r, actorFirebaseUid)) throw sqlError(53003, 'You cannot decide this stage.');
      const now = store.nowIso();
      r.history.push({ revision: r.revision, stage: r.nextStage, decision: payload.decision, createdAtUtc: now, comment: payload.comment || '', overrideReason: payload.overrideReason || '', actorUid: actorFirebaseUid });
      if (payload.decision === 'reject') r.status = 'rejected';
      else if (payload.decision === 'push_back') r.status = 'changes_requested';
      else {
        const keys = routingKeys(r), index = keys.indexOf(r.nextStage);
        const override = admin && r.nextStage !== 'adfa' && String(payload.overrideReason || '').trim();
        if (r.nextStage === 'adfa' || override) { if (applyEnabled !== false) applyChanges(store, r, actorFirebaseUid); r.status = 'applied'; r.nextStage = null; }
        else r.nextStage = keys[index + 1];
      }
      r.updatedAtUtc = now;
      store.audit({ domain: 'teaching', changeType: `swap_${payload.decision}`, sessionId: r.sessionId, actorFirebaseUid, after: { requestId, status: r.status } });
      store.commit();
      return detailJson(store, r, actorFirebaseUid);
    },
    async withdraw({ actorFirebaseUid, requestId, payload }) {
      const r = find(requestId, actorFirebaseUid);
      if (r.requesterUid !== actorFirebaseUid) throw sqlError(53003, 'Only the requester can withdraw.');
      if (payload.expectedRevision !== r.revision) throw sqlError(53009, 'Revision conflict');
      r.status = 'withdrawn'; r.updatedAtUtc = store.nowIso();
      r.history.push({ revision: r.revision, stage: r.nextStage || 'adfa', decision: 'withdraw', createdAtUtc: r.updatedAtUtc, comment: payload.comment || '', overrideReason: '', actorUid: actorFirebaseUid });
      store.commit();
      return detailJson(store, r, actorFirebaseUid);
    },
    async facultyPreviewContext({ actorFirebaseUid, sessionId, assignmentId, candidateKey: key, snapshotToken }) {
      const session = store.tables.sessions.find(s => s.id === sessionId);
      if (!session) throw sqlError(53004, 'Not found');
      if (snapshotOf(session) !== snapshotToken) throw sqlError(53010, 'Stale');
      if (!isAdministratorRole(userOf(store, actorFirebaseUid).baseRole)) throw sqlError(53003, 'Role denied');
      const a = session.assignments.find(x => x.sessionAssignmentId === assignmentId);
      if (!a) throw sqlError(53004, 'Not found');
      const incoming = key ? facultyByCandidate(store, key) : null;
      const out = store.tables.faculty.find(f => f.facultyId === a.facultyId);
      const av = incoming ? availabilityFor(store, session, incoming.facultyId) : { status: 'Available', conflicts: [] };
      return { academicYear: session.academicYear, outgoingFacultyId: a.facultyId, incomingFacultyId: incoming ? incoming.facultyId : null, outgoingDisplayName: out ? out.displayName : '', teachingRole: a.teachingRole, persistedDoeCredit: a.doeCredit, availabilityStatus: av.status, conflicts: av.conflicts };
    }
  };
}

module.exports = { createSwapRepository, list };
