/* Exact academic responsibility scopes for Teaching Assignment consumers.
 * Firestore rules must enforce the same boundary for persisted data.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UCVM_ACADEMIC_RESPONSIBILITY = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';

  const RESPONSIBILITIES = new Set(['hicc', 'rotation_coordinator']);
  const COURSE = /^[A-Z]{2,10} [0-9]{3,4}[A-Z]?$/;
  // Match the canonical Teaching Subject key grammar from subject-catalog.js.\n  const SUBJECT = /^[a-z][a-z0-9_-]{0,63}$/;

  function normalizeCourse(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : '';
  }

  function normalizeSubjectKey(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  }

  function scopeToken(responsibility, course, subjectKey = '*') {
    const role = typeof responsibility === 'string' ? responsibility.trim().toLowerCase() : '';
    const normalizedCourse = normalizeCourse(course);
    const normalizedSubject = subjectKey === '*' ? '*' : normalizeSubjectKey(subjectKey);
    if (!RESPONSIBILITIES.has(role) || !COURSE.test(normalizedCourse) ||
        (normalizedSubject !== '*' && !SUBJECT.test(normalizedSubject))) return '';
    return `${role}|${normalizedCourse}|${normalizedSubject}`;
  }

  function scopesFor(profile, responsibility) {
    const role = typeof responsibility === 'string' ? responsibility.trim().toLowerCase() : '';
    if (!RESPONSIBILITIES.has(role) || !Array.isArray(profile?.academicScopeTokens)) return [];
    const valid = new Set();
    for (const value of profile.academicScopeTokens) {
      if (typeof value !== 'string') continue;
      const parts = value.split('|');
      if (parts.length !== 3 || parts[0].trim().toLowerCase() !== role) continue;
      const token = scopeToken(parts[0], parts[1], parts[2]);
      if (token) valid.add(token);
    }
    return [...valid];
  }

  function hasScope(profile, responsibility, resource) {
    const role = typeof responsibility === 'string' ? responsibility.trim().toLowerCase() : '';
    if (!profile || typeof profile !== 'object' ||
        String(profile.role || '').trim().toLowerCase() !== role ||
        !resource || typeof resource !== 'object') return false;
    const course = normalizeCourse(resource.course);
    if (!COURSE.test(course)) return false;
    const subject = normalizeSubjectKey(resource.subjectKey);
    const valid = scopesFor(profile, role);
    return valid.includes(`${role}|${course}|*`) ||
      (SUBJECT.test(subject) && valid.includes(`${role}|${course}|${subject}`));
  }

  function canHiccEditTopic(profile, resource) {
    return hasScope(profile, 'hicc', resource);
  }

  function canHiccSuggestFaculty(profile, resource) {
    return hasScope(profile, 'hicc', resource);
  }

  return Object.freeze({normalizeCourse, normalizeSubjectKey, scopeToken,
    scopesFor, hasScope, canHiccEditTopic, canHiccSuggestFaculty});
});
