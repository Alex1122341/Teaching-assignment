/* Faculty Dashboard editor for Teaching Subjects, separate from DOE VISC mappings. */
(function(root, factory) {
  const catalog = typeof module === 'object' && module.exports ? require('./subject-catalog.js') : root?.UCVM_SUBJECT_CATALOG;
  const api = factory(catalog);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.UCVM_SUBJECT_CATALOG_ADMIN = api;
    root.addEventListener('ucvm:admin-ready', event => api.init(event.detail));
    root.addEventListener('ucvm:self-ready', () => {
      root.document.querySelector('[data-tab="subjects"]')?.classList.add('hidden');
    });
  }
})(typeof window !== 'undefined' ? window : null, function(catalog) {
  'use strict';
  const roles = new Set(['developer', 'owner', 'administrator', 'admin', 'adfa_general', 'adfa_regular']);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let context = null;

  function canManage(profile) {
    return profile?.active === true && profile.mustChangePassword !== true && roles.has(String(profile.role || '').toLowerCase());
  }
  function newRecord(key, label, uid, updatedAt) {
    const record = {key: catalog.normalizeKey(key), label: String(label ?? '').trim(), active: true,
      updatedBy: uid, updatedAt};
    catalog.validateRecord(record, record.key);
    return record;
  }
  function updatedRecord(existing, label, active, uid, updatedAt) {
    const record = {key: existing?.key, label: String(label ?? '').trim(), active,
      updatedBy: uid, updatedAt};
    catalog.validateRecord(record, record.key);
    return record;
  }
  function message(value, error = false) {
    const node = window.document.getElementById('subject-status');
    if (node) { node.textContent = value; node.setAttribute('role', error ? 'alert' : 'status'); }
  }
  async function load() {
    if (!context) return;
    const {db} = context, host = window.document.getElementById('subject-rows');
    try {
      const snapshot = await db.collection('teaching_subjects').get();
      const rows = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()})).filter(row => {
        try { const {id, ...record} = row; return catalog.validateRecord(record, id); }
        catch (_) { return false; }
      }).sort((a, b) => a.key.localeCompare(b.key));
      host.innerHTML = rows.length ? rows.map(row => `<tr data-subject-row="${esc(row.key)}">
        <td><code>${esc(row.key)}</code></td><td><input class="input" data-subject-label value="${esc(row.label)}" maxlength="100"></td>
        <td>${row.active ? 'Active' : 'Inactive'}</td><td><button type="button" class="btn" data-subject-save="${esc(row.key)}">Save label</button>
        <button type="button" class="btn" data-subject-toggle="${esc(row.key)}">${row.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>`).join('') : '<tr><td colspan="4">No Teaching Subjects have been added.</td></tr>';
      host.querySelectorAll('[data-subject-save]').forEach(button => button.onclick = async () => {
        const row = rows.find(item => item.key === button.dataset.subjectSave);
        if (!row) return;
        await save(row, rowNode(row.key).querySelector('[data-subject-label]').value, row.active);
      });
      host.querySelectorAll('[data-subject-toggle]').forEach(button => button.onclick = async () => {
        const row = rows.find(item => item.key === button.dataset.subjectToggle);
        if (!row) return;
        await save(row, rowNode(row.key).querySelector('[data-subject-label]').value, !row.active);
      });
      message(`${rows.length} Teaching Subject${rows.length === 1 ? '' : 's'} loaded.`);
    } catch (error) { console.error('[Teaching Subjects]', error); message('Could not load Teaching Subjects.', true); }
  }
  function rowNode(key) {
    return [...window.document.querySelectorAll('[data-subject-row]')].find(row => row.dataset.subjectRow === key);
  }
  async function save(existing, label, active) {
    try {
      const {db, user} = context;
      const data = updatedRecord(existing, label, active, user.uid, window.firebase.firestore.FieldValue.serverTimestamp());
      await db.collection('teaching_subjects').doc(existing.key).set(data);
      await load();
    } catch (error) { console.error('[Teaching Subjects]', error); message(error.message || 'Could not save Subject.', true); }
  }
  async function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const {db, user} = context;
      const data = newRecord(form.elements.key.value, form.elements.label.value, user.uid,
        window.firebase.firestore.FieldValue.serverTimestamp());
      await db.runTransaction(async transaction => {
        const ref = db.collection('teaching_subjects').doc(data.key);
        if ((await transaction.get(ref)).exists) throw Error('This Subject key already exists. Its identity cannot be renamed.');
        transaction.set(ref, data);
      });
      form.reset();
      await load();
    } catch (error) { console.error('[Teaching Subjects]', error); message(error.message || 'Could not add Subject.', true); }
  }
  function init(detail) {
    const tab = window.document.querySelector('[data-tab="subjects"]');
    if (!canManage(detail?.profile) || !detail?.db || !detail?.user) { tab?.classList.add('hidden'); context = null; return false; }
    tab?.classList.remove('hidden');
    context = detail;
    const form = window.document.getElementById('subject-form');
    if (form) form.onsubmit = add;
    load();
    return true;
  }
  return Object.freeze({canManage, newRecord, updatedRecord, init, load});
});
