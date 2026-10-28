'use strict';
// In-memory PAWS tables for the Frontend Demo, persisted to the tester's own
// browser (localStorage) so edits survive a reload. "Reset demo data" clears it.
const base = require('./dataset.js');
const more = require('./dataset-more.js');

const STORAGE_KEY = 'ucvm-pages-demo-paws-v1';

function buildTables(legacyUsers = []) {
  const faculty = base.facultyRows();
  const courses = base.courseRows();
  const sessions = base.sessionRows(courses, faculty);
  const roles = more.roleRows(courses, faculty);
  return {
    version: 1,
    academicYear: base.ACADEMIC_YEAR,
    faculty,
    users: base.userRows(faculty),
    courses,
    sessions,
    roles,
    afcRecords: more.afcRows(faculty),
    activities: more.activityRows(roles, faculty),
    targets: more.targetRows(faculty),
    history: [],
    extra: {}
  };
}

function createStore({ storage = null, legacyUsers = [], now = () => new Date() } = {}) {
  let tables = null;
  const load = () => {
    if (tables) return tables;
    try {
      const saved = storage && storage.getItem(STORAGE_KEY);
      if (saved) { const parsed = JSON.parse(saved); if (parsed && parsed.version === 1) tables = parsed; }
    } catch (_) { tables = null; }
    if (!tables) tables = buildTables(legacyUsers);
    return tables;
  };
  const save = () => { try { storage && storage.setItem(STORAGE_KEY, JSON.stringify(tables)); } catch (_) { /* quota: keep in memory only */ } };
  return {
    get tables() { return load(); },
    now,
    nowIso: () => now().toISOString(),
    commit: save,
    reset() { tables = null; try { storage && storage.removeItem(STORAGE_KEY); } catch (_) {} },
    // Records a change in the shared history used by Change History / Dashboard History.
    audit(entry) {
      const t = load();
      t.history.unshift({ changeId: `chg-${t.history.length + 1}-${Date.now().toString(36)}`, changedAtUtc: now().toISOString(), ...entry });
    },
    // Lazily created bag for areas that keep extra state (SWAP, TA packages, …).
    bag(name, init) { const t = load(); if (!t.extra[name]) t.extra[name] = init(); return t.extra[name]; }
  };
}

module.exports = { createStore, buildTables, STORAGE_KEY };
