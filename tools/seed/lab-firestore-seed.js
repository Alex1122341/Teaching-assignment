'use strict';
// Seeds the vista-teaching-lab Firestore with what the PAWS lab application needs
// to actually run: an employment status on the synthetic Faculty records, and
// role assignments the Roles tab and the two directories can display.
//
// Safety rules followed here:
//   * every document is backed up to a local file BEFORE it is touched
//   * only records whose email is on the reserved test domain are modified; a
//     record that looks real is skipped and reported
//   * nothing is deleted
//   * the script is idempotent: re-running it does not duplicate assignments
//
// It prints counts and field names only, never personal values.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('firebase-tools/lib/api');

const PROJECT = 'vista-teaching-lab';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const BACKUP = process.env.PAWS_LAB_BACKUP || 'lab-backup.json';
const DRY_RUN = process.argv.includes('--dry-run');

async function accessToken() {
  const stored = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: stored.tokens.refresh_token,
    client_id: api.clientId(),
    client_secret: api.clientSecret()
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body
  });
  if (!response.ok) throw Error('token exchange failed: ' + response.status);
  return (await response.json()).access_token;
}

const s = value => ({ stringValue: String(value) });
const b = value => ({ booleanValue: Boolean(value) });
const n = value => ({ integerValue: String(value) });
const arr = values => ({ arrayValue: { values: values.map(v => ({ mapValue: { fields: { startDate: s(v.startDate), endDate: v.endDate ? s(v.endDate) : { nullValue: null } } } })) } });

async function list(token, collection) {
  const out = [];
  let pageToken = '';
  do {
    const url = `${BASE}/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw Error(`${collection}: ${response.status}`);
    const json = await response.json();
    out.push(...(json.documents || []));
    pageToken = json.nextPageToken || '';
  } while (pageToken && out.length < 2000);
  return out;
}

async function patch(token, name, fields, mask) {
  if (DRY_RUN) return { dryRun: true };
  const url = `https://firestore.googleapis.com/v1/${name}?${mask.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!response.ok) throw Error(`patch ${name}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function create(token, collection, id, fields) {
  if (DRY_RUN) return { dryRun: true };
  const response = await fetch(`${BASE}/${collection}?documentId=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!response.ok) throw Error(`create ${collection}/${id}: ${response.status} ${await response.text()}`);
  return response.json();
}

function field(doc, name) {
  const value = (doc.fields || {})[name];
  if (!value) return undefined;
  return value.stringValue ?? value.booleanValue ?? value.integerValue;
}

// Assignments to seed. Only synthetic faculty on the reserved domain are used, and
// the role types are the three the directory recognises.
const ASSIGNMENTS = [
  { id: 'ra-hicc-001', facultyIndex: 0, roleType: 'HICC', roleCategory: 'Leadership', scopeKind: 'course', scopeCode: 'VETM 301', periods: [{ startDate: '2026-05-01', endDate: '2027-04-30' }] },
  { id: 'ra-visc-001', facultyIndex: 1, roleType: 'VISC', roleCategory: 'Leadership', scopeKind: 'subject', scopeCode: 'Anatomy', periods: [{ startDate: '2026-05-01', endDate: null }] },
  { id: 'ra-cc-001', facultyIndex: 2, roleType: 'Course Coordinator', roleCategory: 'Coordination', scopeKind: 'course', scopeCode: 'VETM 302', periods: [{ startDate: '2026-05-01', endDate: '2026-12-31' }, { startDate: '2027-01-01', endDate: '2027-04-30' }] },
  { id: 'ra-hicc-002', facultyIndex: 3, roleType: 'HICC', roleCategory: 'Leadership', scopeKind: 'course', scopeCode: 'VETM 401', periods: [{ startDate: '2026-09-01', endDate: '2027-04-30' }] },
  { id: 'ra-visc-002', facultyIndex: 4, roleType: 'VISC', roleCategory: 'Leadership', scopeKind: 'rotation', scopeCode: 'Small Animal', periods: [{ startDate: '2025-05-01', endDate: '2026-04-30' }] }
];

(async () => {
  const token = await accessToken();
  const faculty = await list(token, 'faculty');
  const existingAssignments = await list(token, 'role_assignments').catch(() => []);

  // Back up everything before touching it.
  const backup = { takenAt: new Date().toISOString(), faculty, roleAssignments: existingAssignments };
  if (!DRY_RUN) fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));

  const synthetic = faculty.filter(doc => String(field(doc, 'email') || '').toLowerCase().endsWith('@example.test'));
  const skipped = faculty.length - synthetic.length;
  console.log(`faculty total=${faculty.length} synthetic=${synthetic.length} skippedNonSynthetic=${skipped}`);
  if (skipped) console.log('  (records not on the reserved test domain were left untouched)');

  // 1) Employment status. Only an explicit boolean is written; nothing is inferred.
  let statusWritten = 0;
  for (const doc of synthetic) {
    if (field(doc, 'active') !== undefined) continue;
    await patch(token, doc.name, { active: b(true) }, ['active']);
    statusWritten += 1;
  }
  console.log(`faculty active status written=${statusWritten}${DRY_RUN ? ' (dry run)' : ''}`);

  // 2) Role assignments, only where the target Faculty exists and is synthetic.
  const existingIds = new Set(existingAssignments.map(doc => doc.name.split('/').pop()));
  let created = 0;
  for (const spec of ASSIGNMENTS) {
    if (existingIds.has(spec.id)) continue;
    const person = synthetic[spec.facultyIndex];
    if (!person) continue;
    const facultyId = person.name.split('/').pop();
    await create(token, 'role_assignments', spec.id, {
      facultyId: s(facultyId),
      academicYear: s('2026-27'),
      roleCategory: s(spec.roleCategory),
      roleType: s(spec.roleType),
      scopeKind: s(spec.scopeKind),
      scopeCode: s(spec.scopeCode),
      periods: arr(spec.periods),
      revision: n(1),
      createdAtUtc: { timestampValue: new Date().toISOString() },
      updatedAtUtc: { timestampValue: new Date().toISOString() },
      createdBy: s('seed'),
      updatedBy: s('seed')
    });
    created += 1;
  }
  console.log(`role_assignments created=${created}${DRY_RUN ? ' (dry run)' : ''}`);

  // 3) Verify by reading back through the same API the application uses.
  const after = await list(token, 'role_assignments').catch(() => []);
  const afterFaculty = await list(token, 'faculty');
  const withStatus = afterFaculty.filter(doc => field(doc, 'active') === true).length;
  console.log(`VERIFY role_assignments=${after.length} facultyActive=${withStatus}`);
  console.log(`backup=${DRY_RUN ? '(dry run, none written)' : BACKUP}`);
})().catch(error => { console.log('FAILED:', error.message); process.exitCode = 1; });
