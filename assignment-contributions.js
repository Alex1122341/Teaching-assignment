/* Pure actor-scoped Teaching Assignment suggestions, never final assignments.
 * This validates domain identity only; production authorization and trusted
 * persistence belong to the later security layer. No session is modified.
 */
(function(root, factory) {
  const node = typeof module === 'object' && module.exports;
  const candidates = node ? require('./faculty-suggestions.js') : root?.UCVM_FACULTY_SUGGESTIONS;
  const subjects = node ? require('./subject-catalog.js') : root?.UCVM_SUBJECT_CATALOG;
  const api = factory(candidates, subjects);
  if (node) module.exports = api;
  if (root) root.UCVM_ASSIGNMENT_CONTRIBUTIONS = api;
})(typeof window !== 'undefined' ? window : null, function(candidates, subjects) {
  'use strict';
  if (!candidates?.safeCandidate || !subjects?.normalizeKey) {
    throw Error('Assignment contributions requires faculty-suggestions and subject-catalog.');
  }
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  function identity(value, field) {
    if (typeof value !== 'string' || !value || value !== value.trim() ||
        value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
      throw Error(`Invalid contribution ${field} identity.`);
    }
    return value;
  }

  function documentId(sessionId, sourceRole, actorUid) {
    identity(sessionId, 'sessionId');
    identity(actorUid, 'actorUid');
    if (!candidates.CONTRIBUTION_SOURCES.includes(sourceRole)) throw Error('Invalid contribution sourceRole.');
    // Escape underscores as well as path separators: encoded components cannot
    // contain the __ delimiter. Escaping % prevents pre-encoded collisions.
    const encode = value => encodeURIComponent(value).replace(/_/g, '%5F');
    const id = `ac-v1__${encode(sessionId)}__${sourceRole}__${encode(actorUid)}`;
    // Encoded output is ASCII, so length equals the Firestore UTF-8 byte count.
    if (id.length > 1500) throw Error('Contribution document identity exceeds 1500 bytes.');
    return id;
  }

  function optionalText(record, field, limit) {
    if (typeof record[field] !== 'string' || record[field].trim().length > limit) {
      throw Error(`Invalid contribution ${field}; expected text up to ${limit} characters.`);
    }
    return record[field].trim();
  }

  function timestamp(value) {
    if (value === null || (Number.isSafeInteger(value) && value >= 0)) return value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
      const date = new Date(value);
      if (Number.isFinite(date.getTime()) && date.toISOString() === value) return value;
    }
    throw Error('Invalid contribution updatedAt timestamp.');
  }

  function safeSuggestions(rows) {
    if (!Array.isArray(rows)) throw Error('Contribution suggestions must be an array.');
    const byKey = new Map();
    for (const row of rows) {
      const safe = candidates.safeCandidate(row);
      const previous = byKey.get(safe.candidateKey);
      if (previous && previous.displayName !== safe.displayName) throw Error('Conflicting duplicate candidate key.');
      byKey.set(safe.candidateKey, safe);
    }
    return [...byKey.values()].sort((a, b) => compare(a.candidateKey, b.candidateKey));
  }

  function normalize(record, expectedId, requireStoredId) {
    if (!object(record)) throw Error('Invalid contribution record.');
    candidates.assertSafe(record);
    const id = documentId(record.sessionId, record.sourceRole, record.actorUid);
    if ((requireStoredId && record.id === undefined && expectedId === undefined) ||
        (record.id !== undefined && record.id !== id) ||
        (expectedId !== undefined && expectedId !== id)) {
      throw Error('Contribution document identity mismatch.');
    }
    const out = {id, sessionId:record.sessionId, sourceRole:record.sourceRole,
      actorUid:record.actorUid, suggestions:safeSuggestions(record.suggestions)};
    for (const field of ['course', 'actorDisplayName']) {
      if (record[field] !== undefined) out[field] = optionalText(record, field, 200);
    }
    if (record.subjectKey !== undefined) {
      if (!record.subjectKey || subjects.normalizeKey(record.subjectKey) !== record.subjectKey) {
        throw Error('Invalid canonical contribution subjectKey.');
      }
      out.subjectKey = record.subjectKey;
    }
    if (record.note !== undefined) out.note = optionalText(record, 'note', 2000);
    if (record.updatedAt !== undefined) out.updatedAt = timestamp(record.updatedAt);
    return out;
  }

  // Creation derives identity; a supplied id must still agree with all fields.
  function createContribution(record) { return normalize(record, undefined, false); }

  // Stored reads must supply their document id, either on the row or separately.
  // A storage adapter should always pass the actual document id as expectedId.
  function sanitizeContribution(record, expectedId) { return normalize(record, expectedId, true); }

  function suggestionsForAdfad(contributions) {
    if (!Array.isArray(contributions)) throw Error('Contributions must be an array.');
    const byId = new Map();
    for (const record of contributions) {
      const safe = sanitizeContribution(record);
      const previous = byId.get(safe.id);
      // Conflicting snapshots are rejected even if only their private notes or
      // timestamps differ. Never silently choose a snapshot by input order.
      if (previous && JSON.stringify(previous) !== JSON.stringify(safe)) {
        throw Error('Conflicting duplicate contribution identity.');
      }
      byId.set(safe.id, safe);
    }
    const output = [];
    for (const row of [...byId.values()].sort((a, b) => compare(a.id, b.id))) {
      for (const candidate of row.suggestions) {
        const safe = {sessionId:row.sessionId, candidateKey:candidate.candidateKey,
          displayName:candidate.displayName, sourceRole:row.sourceRole, contributionId:row.id};
        if (row.actorDisplayName !== undefined) safe.actorDisplayName = row.actorDisplayName;
        output.push(safe);
      }
    }
    return output;
  }

  return Object.freeze({documentId, createContribution, sanitizeContribution, suggestionsForAdfad});
});
