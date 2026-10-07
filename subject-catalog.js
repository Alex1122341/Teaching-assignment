/* Canonical Teaching Subject metadata. This is separate from DOE mappings. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UCVM_SUBJECT_CATALOG = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';

  const KEY = /^[a-z][a-z0-9_-]{0,63}$/;
  const FIELDS = ['key', 'label', 'active', 'updatedBy', 'updatedAt'];

  function normalizeKey(value) {
    if (typeof value !== 'string') return '';
    const key = value.trim().toLowerCase();
    return KEY.test(key) ? key : '';
  }

  function validateRecord(record, expectedKey) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        typeof expectedKey !== 'string' || !expectedKey || normalizeKey(expectedKey) !== expectedKey ||
        record.key !== expectedKey ||
        typeof record.label !== 'string' || !record.label.trim() || record.label.length > 100 ||
        typeof record.active !== 'boolean' ||
        Object.keys(record).some(field => !FIELDS.includes(field))) {
      throw new Error('Invalid Teaching Subject record.');
    }
    return true;
  }

  function activeOptions(rows) {
    if (!Array.isArray(rows)) return [];
    const seen = new Set();
    const options = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string') continue;
      const {id, ...record} = row;
      try { validateRecord(record, id); } catch (_) { continue; }
      if (!record.active || seen.has(id)) continue;
      seen.add(id);
      options.push({key: id, label: record.label.trim()});
    }
    return options.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  }

  return Object.freeze({normalizeKey, validateRecord, activeOptions});
});
