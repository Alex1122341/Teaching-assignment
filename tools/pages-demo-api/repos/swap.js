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
  const items = store.bag('swaps', () => {
    const t = store.tables;
    const pick = (course, type) => t.sessions.find(s => s.courseCode === course && s.sessionType === type && s.date >= '2026-10-26' && s.startTime);
    const make = (session, i, status, nextStage, changes, requesterUid) => {
      const a = session.assignments[0];
      const replacement = changes.replacementCandidateKey ? facultyByCandidate(store, changes.replacementCandidateKey) : null;
      const consentUid = replacement && nextStage !== 'target' && targetUidFor(store, changes.replacementCandidateKey, true);
      const priorConsent = consentUid
        ? [{revision:1,stage:'target',decision:'approve',createdAtUtc:'2026-10-21T16:00:00.000Z',
           comment:'Synthetic replacement consent fixture',overrideReason:'',actorUid:consentUid}]
        : [];
      return { requestId: uuidFor(`swap:${i}`), sessionId: session.id, assignmentId: a.sessionAssignmentId, snapshotToken: snapshotOf(session), revision: 1, status, nextStage, changes, note: i === 0 ? 'Conference travel that week – Petra has agreed to cover.' : 'Room clash with the anatomy lab.', notifyReplacement: Boolean(replacement), requesterUid, createdAtUtc: '2026-10-20T16:00:00.000Z', updatedAtUtc: '2026-10-22T16:00:00.000Z', routing: { needsAdc: SCHEDULE.some(k => k in changes), needsLab: false, needsVisc: false, notifyReplacement: Boolean(replacement) }, history: priorConsent, revisions: [{ revision: 1, createdAtUtc: '2026-10-20T16:00:00.000Z', actorUid: requesterUid }] };
    };
    const rows = [];
    const s1 = pick('VTMD 200', 'LEC'), s2 = pick('VTMD 302', 'LAB') || pick('VTMD 304', 'LEC');
    const fac = id => t.faculty.find(f => f.legacyId === id);
    if (s1) rows.push(make(s1, 0, 'pending', 'adfa', { replacementCandidateKey: candidateKey(fac('fac-010').facultyId) }, 'uid-' + (t.faculty.find(f => f.facultyId === s1.assignments[0].facultyId)?.legacyId || 'fac-001')));
    if (s2) rows.push(make(s2, 1, 'pending', 'adc', { room: 'HSB 1403' }, 'uid-' + (t.faculty.find(f => f.facultyId === s2.assignments[0].facultyId)?.legacyId || 'fac-002')));
    return rows;
  });
  // Repair only the known historic synthetic fixture. Existing testers have
  // persisted this request at ADFA but the original seed omitted target consent.
  const seeded = items.find(row => row.requestId === uuidFor('swap:0') && row.status === 'pending'
    && row.nextStage === 'adfa' && row.notifyReplacement === true
    && !row.history.some(h => h.stage === 'target'));
  if (seeded) {
    const targetUid = targetUidFor(store, seeded.changes.replacementCandidateKey, true);
    if (targetUid) {
      seeded.history.push({revision:seeded.revision,stage:'target',decision:'approve',
        createdAtUtc:'2026-10-21T16:00:00.000Z',comment:'Synthetic replacement consent fixture',
        overrideReason:'',actorUid:targetUid});
      store.commit();
    }
  }
  return items;
}

function routingKeys(r) { return [...(r.routing.notifyReplacement ? ['target'] : []), ...(r.routing.needsVisc ? ['visc'] : []), ...(r.routing.needsAdc ? ['adc'] : []), ...(r.routing.needsLab ? ['lab'] : []), 'adfa']; }

// Mirror the SQL approval authority: only senior ADFA roles can override
// intermediate office stages, and replacement consent cannot be fabricated.
const canOverrideStage = role => ['developer', 'owner', 'adfa_general'].includes(role);
function targetUidFor(store, key, notified) {
  if (!notified) return null;
  const target = facultyByCandidate(store, key);
  if (!target) return null;
  const users = store.tables.users.filter(user => user.facultyId === target.facultyId && user.active === true && user.mustChangePassword !== true);
  return users.length === 1 ? users[0].firebaseUid : null;
}
function scopedVisc(store, request, user) {
  const session = store.tables.sessions.find(s => s.id === request.sessionId);
  if (!session?.subjectKey || !user.facultyId) return false;
  return store.tables.roles.some(role => role.roleType === 'VISC'
    && role.facultyId === user.facultyId && role.academicYear === session.academicYear
    && (!role.effectiveDate || role.effectiveDate <= session.date)
    && (!role.expirationDate || role.expirationDate >= session.date)
    && String(role.courseOrSubjectOrRotation).toLowerCase() === String(session.subjectKey).toLowerCase());
}
function canDecideStage(store, r, uid) {
  const u = userOf(store, uid), role = String(u.baseRole || '').toLowerCase();
  if (r.status !== 'pending') return false;
  if (r.nextStage === 'target') return targetUidFor(store, r.changes.replacementCandidateKey, r.notifyReplacement) === uid;
  if (r.nextStage === 'adfa') return isAdministratorRole(role);
  if (r.nextStage === 'adc') return role === 'adc' || canOverrideStage(role);
  if (r.nextStage === 'lab') return role === 'lab' || canOverrideStage(role);
  if (r.nextStage === 'visc') return role === 'visc' && scopedVisc(store, r, u) || canOverrideStage(role);
  return false;
}
function canSee(store, r, uid) {
  const u = userOf(store, uid), role = String(u.baseRole || '').toLowerCase();
  if (isAdministratorRole(role) || r.requesterUid === uid || canDecideStage(store, r, uid) || ['adc', 'lab'].includes(role) || role === 'visc' && scopedVisc(store, r, u)) return true;
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
  const requiresOverride = canOverrideStage(String(u.baseRole || '').toLowerCase()) && r.status === 'pending' && r.nextStage !== 'adfa';
  return {
    request: requestJson(store, r, uid),
    capabilities: { canRevise: r.requesterUid === uid && ['pending', 'changes_requested'].includes(r.status), canWithdraw: r.requesterUid === uid && ['pending', 'changes_requested'].includes(r.status), canDecide: decide, canOverride: canOverrideStage(String(u.baseRole || '').toLowerCase()) && decide, requiresOverride: requiresOverride && decide, decisions: decide ? ['approve', 'reject', 'push_back'] : [], editableFields: r.requesterUid === uid ? ['replacementCandidateKey', ...SCHEDULE, 'topic'] : [] },
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
  const routeFor = (session, changes, notify, creatorRole = '') => ({ needsAdc: SCHEDULE.some(k => changes[k] !== undefined) || (changes.topic !== undefined && session.sessionType !== 'LAB'), needsLab: changes.topic !== undefined && (session.sessionType === 'LAB' || changes.sessionType === 'LAB'), needsVisc: Boolean(changes.replacementCandidateKey && !notify && ['faculty', 'hicc', 'visc'].includes(creatorRole)), notifyReplacement: Boolean(changes.replacementCandidateKey && notify) });
  return {
    async context({ actorFirebaseUid, sessionId }) {
      const t = store.tables, session = t.sessions.find(s => s.id === sessionId);
      if (!session) throw sqlError(53004, 'Session not found');
      const u = userOf(store, actorFirebaseUid), role = String(u.baseRole || '').toLowerCase(), admin = isAdministratorRole(role);
      const own = u.facultyId && session.assignments.some(a => a.facultyId === u.facultyId);
      if (!(admin || own || ['adc', 'lab'].includes(role) || role === 'visc' && scopedVisc(store, {sessionId}, u))) throw sqlError(53003, 'Session is outside your SWAP scope.');
      const assigned = new Set(session.assignments.map(a => a.facultyId));
      return {
        session: { sessionId: session.id, academicYear: session.academicYear, curriculumYear: session.curriculumYear, courseCode: session.courseCode, courseName: session.courseName, sessionType: session.sessionType, date: session.date, startTime: session.startTime, endTime: session.endTime, topic: session.topic, room: session.room, snapshotToken: snapshotOf(session) },
        assignments: session.assignments.map(a => { const f = t.faculty.find(x => x.facultyId === a.facultyId); return { assignmentId: a.sessionAssignmentId, candidateKey: candidateKey(a.facultyId), displayName: f ? f.displayName : a.sourceFacultyName, canReplace: Boolean(admin || ['adc', 'lab'].includes(role) || role === 'visc' && scopedVisc(store, {sessionId}, u) || a.facultyId === u.facultyId) }; }),
        candidates: t.faculty.filter(f => f.active && !assigned.has(f.facultyId)).map(f => { const av = availabilityFor(store, session, f.facultyId); const linked = t.users.filter(x => x.facultyId === f.facultyId && x.active).length === 1; return { candidateKey: candidateKey(f.facultyId), displayName: f.displayName, availabilityStatus: av.status, available: av.status === 'Available', notifyAvailable: linked, notifyUnavailableReason: linked ? null : 'One active linked account is required.' }; }),
        fields: [['replacementCandidateKey', 'adfa'], ['courseCode', 'adc'], ['date', 'adc'], ['startTime', 'adc'], ['endTime', 'adc'], ['sessionType', 'adc'], ['room', 'adc'], ['topic', session.sessionType === 'LAB' ? 'lab' : 'adc']].map(([key, office]) => ({ key, editable: Boolean(admin || key === 'replacementCandidateKey' && (own || ['adc', 'lab'].includes(role) || role === 'visc' && scopedVisc(store, {sessionId}, u)) || key !== 'replacementCandidateKey' && role === office), office, reason: null })),
        options: { courses: t.courses.map(c => ({ courseCode: c.courseCode, courseName: c.courseName })), sessionTypes: ['LEC', 'LAB', 'SRL', 'Quiz/Midterm', 'OSCE', 'Exam'] },
        canCreate: true, unavailableReasons: [],
        reviewers: [{ stage: 'visc', available: t.users.some(account => account.baseRole === 'visc' && account.active && scopedVisc(store, {sessionId}, account)) }, { stage: 'adc', available: t.users.some(account => account.baseRole === 'adc' && account.active) }, { stage: 'lab', available: t.users.some(account => account.baseRole === 'lab' && account.active) }]
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
      const actor = userOf(store, actorFirebaseUid), role = String(actor.baseRole || '').toLowerCase();
      const admin = isAdministratorRole(role), own = actor.facultyId && session.assignments.some(a => a.facultyId === actor.facultyId);
      const visc = role === 'visc' && scopedVisc(store, {sessionId:session.id}, actor);
      if (!(admin || own || visc || ['adc', 'lab'].includes(role))) throw sqlError(53003, 'Session is outside your SWAP scope.');
      if (payload.changes?.replacementCandidateKey && own && !admin && !visc && !['adc', 'lab'].includes(role) && !session.assignments.some(a => a.sessionAssignmentId === payload.assignmentId && a.facultyId === actor.facultyId)) throw sqlError(53003, 'You may replace only your own session assignment.');
      for (const field of Object.keys(payload.changes || {})) {
        const eligible = admin || field === 'replacementCandidateKey' && (own || visc || ['adc', 'lab'].includes(role))
          || field === 'topic' && (session.sessionType === 'LAB' ? role === 'lab' : role === 'adc')
          || ['courseCode', 'date', 'startTime', 'endTime', 'sessionType', 'room'].includes(field) && role === 'adc';
        if (!eligible) throw sqlError(53003, 'This role cannot propose that SWAP field.');
      }
      if (snapshotOf(session) !== payload.snapshotToken) throw sqlError(53010, 'The session changed; reload it.');
      const existing = list(store).find(r => r.requestId === payload.requestId);
      if (existing) return detailJson(store, existing, actorFirebaseUid);
      const now = store.nowIso();
      if (payload.notifyReplacement === true && !targetUidFor(store, payload.changes?.replacementCandidateKey, true)) throw sqlError(53001, 'Replacement consent requires exactly one active linked account.');
      const routing = routeFor(session, payload.changes, payload.notifyReplacement, role);
      if (routing.needsVisc && !store.tables.users.some(u => u.baseRole === 'visc' && u.active && !u.mustChangePassword && scopedVisc(store, {sessionId:session.id}, u))) throw sqlError(53001, 'No scoped VISC reviewer is assigned.');
      const r = { requestId: payload.requestId, sessionId: session.id, assignmentId: payload.assignmentId || null, snapshotToken: payload.snapshotToken, revision: 1, status: 'pending', nextStage: null, changes: clone(payload.changes), note: payload.note || '', notifyReplacement: payload.notifyReplacement === true, requesterUid: actorFirebaseUid, originRole: role, createdAtUtc: now, updatedAtUtc: now, routing, history: [], revisions: [{ revision: 1, createdAtUtc: now, actorUid: actorFirebaseUid }] };
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
      if (payload.notifyReplacement === true && !targetUidFor(store, payload.changes?.replacementCandidateKey, true)) throw sqlError(53001, 'Replacement consent requires exactly one active linked account.');
      r.changes = clone(payload.changes); r.note = payload.note || r.note; r.notifyReplacement = payload.notifyReplacement === true; if (payload.assignmentId) r.assignmentId = payload.assignmentId;
      r.revision += 1; r.status = 'pending'; r.routing = routeFor(session, r.changes, r.notifyReplacement, r.originRole || String(userOf(store, r.requesterUid).baseRole || '').toLowerCase()); r.nextStage = routingKeys(r)[0]; r.updatedAtUtc = store.nowIso();
      r.revisions.push({ revision: r.revision, createdAtUtc: r.updatedAtUtc, actorUid: actorFirebaseUid });
      store.commit();
      return detailJson(store, r, actorFirebaseUid);
    },
    async decide({ actorFirebaseUid, requestId, payload, applyEnabled }) {
      const r = find(requestId, actorFirebaseUid);
      if (payload.expectedRevision !== r.revision) throw sqlError(53009, 'Revision conflict');
      const decisionRole = String(userOf(store, actorFirebaseUid).baseRole || '').toLowerCase();
      const admin = isAdministratorRole(decisionRole);
      if (!canDecideStage(store, r, actorFirebaseUid)) throw sqlError(53003, 'You cannot decide this stage.');
      if (payload.overrideReason && !canOverrideStage(decisionRole)) throw sqlError(53003, 'Only senior ADFA can record an override.');
      if (canOverrideStage(decisionRole) && r.nextStage !== 'adfa' && !String(payload.overrideReason || '').trim()) throw sqlError(53003, 'A recorded override reason is required for an administrative early decision.');
      const willApply = payload.decision === 'approve' && (r.nextStage === 'adfa' || canOverrideStage(decisionRole) && Boolean(String(payload.overrideReason || '').trim()));
      if (willApply) {
        if (applyEnabled !== true) throw sqlError(53011, 'Final SWAP application is disabled.');
        const session = store.tables.sessions.find(row => row.id === r.sessionId);
        if (!session || snapshotOf(session) !== r.snapshotToken) throw sqlError(53010, 'The source session changed; reload the approval.');
        if (r.changes.replacementCandidateKey) {
          const incoming = facultyByCandidate(store, r.changes.replacementCandidateKey);
          const outgoing = session.assignments.find(row => row.sessionAssignmentId === r.assignmentId);
          if (!incoming?.active || !outgoing || incoming.facultyId === outgoing.facultyId || session.assignments.some(a => a.facultyId === incoming.facultyId))
            throw sqlError(53011, 'The proposed replacement is not a valid active, distinct faculty assignment.');
          if (r.notifyReplacement === true && !r.history.some(h => h.revision === r.revision && h.stage === 'target' && h.decision === 'approve'))
            throw sqlError(53011, 'Replacement consent is not recorded for this revision.');
          const availability = availabilityFor(store, session, incoming.facultyId);
          if (availability.status === 'Needs Review') throw sqlError(53011, 'Replacement availability cannot be verified.');
          if (availability.status === 'Unavailable' && !(canOverrideStage(decisionRole) && String(payload.overrideReason || '').trim()))
            throw sqlError(53011, 'A known faculty availability conflict requires an authorized recorded override.');
        }
      }
      const now = store.nowIso();
      r.history.push({ revision: r.revision, stage: r.nextStage, decision: payload.decision, createdAtUtc: now, comment: payload.comment || '', overrideReason: payload.overrideReason || '', actorUid: actorFirebaseUid });
      if (payload.decision === 'reject') r.status = 'rejected';
      else if (payload.decision === 'push_back') r.status = 'changes_requested';
      else {
        const keys = routingKeys(r), index = keys.indexOf(r.nextStage);
        const override = canOverrideStage(decisionRole) && r.nextStage !== 'adfa' && String(payload.overrideReason || '').trim();
        if (r.nextStage === 'adfa' || override) { applyChanges(store, r, actorFirebaseUid); r.status = 'applied'; r.nextStage = null; }
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
