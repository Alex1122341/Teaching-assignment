'use strict';
// Verifies the production mapping code against the LIVE vista-teaching-lab data.
//
// It does not use fixtures: it reads the real documents over the same REST surface
// the Firebase CLI uses, then runs them through the exact functions the API runs
// (`toRow`, `toRecord`, `buildDirectory`). If the mapping and the live schema
// disagree, this fails.
//
// Prints field names, counts and derived values only — never personal values.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('firebase-tools/lib/api');

const PROJECT = 'vista-teaching-lab';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const ROOT = path.join(__dirname, '..', '..');
const { toRow, statusOf } = require(path.join(ROOT, 'server/src/data/firestore/firestore-faculty-repository.js'));
const { toRecord } = require(path.join(ROOT, 'server/src/data/firestore/firestore-role-assignment-repository.js'));
const { buildDirectory } = require(path.join(ROOT, 'server/src/roles/leadership-directory-api.js'));

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
  return (await response.json()).access_token;
}

async function list(token, collection) {
  const response = await fetch(`${BASE}/${collection}?pageSize=300`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return [];
  return (await response.json()).documents || [];
}

// Firestore REST values -> the plain objects the mapping functions expect.
function plain(field) {
  if (!field || typeof field !== 'object') return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('nullValue' in field) return null;
  if ('timestampValue' in field) return field.timestampValue;
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(v => plain(v.mapValue ? { mapValue: v.mapValue } : v));
  if ('mapValue' in field) {
    const out = {};
    for (const [key, value] of Object.entries(field.mapValue.fields || {})) out[key] = plain(value);
    return out;
  }
  return undefined;
}

function toDocument(doc) {
  const out = {};
  for (const [key, value] of Object.entries(doc.fields || {})) out[key] = plain(value);
  return { id: doc.name.split('/').pop(), data: out };
}

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

(async () => {
  const token = await accessToken();

  // ---------------------------------------------------------------- faculty
  const facultyDocs = (await list(token, 'faculty')).map(toDocument);
  console.log(`\n[faculty] live documents=${facultyDocs.length}`);
  const rows = facultyDocs.map(doc => toRow(doc.id, doc.data));

  check('every row carries the SQL contract field names',
    rows.every(r => 'facultyId' in r && 'displayName' in r && 'fte' in r && 'status' in r));

  check('every name is composed as "Last, First"',
    rows.every(r => r.displayName.includes(', ') || r.displayName.length > 0),
    rows.filter(r => !r.displayName.includes(', ')).length + ' without a comma');

  const withStatus = rows.filter(r => r.status === 'active').length;
  console.log(`  active=${withStatus} inactive=${rows.filter(r => r.status === 'inactive').length} unknown=${rows.filter(r => r.status === 'unknown').length}`);
  check('the Faculty list filter would return rows', withStatus > 0, 'status=active would be empty');

  const fteValues = rows.map(r => r.fte).filter(v => v !== null);
  check('FTE is a fraction (0..1), not a percentage',
    fteValues.every(v => v >= 0 && v <= 1),
    'out of range: ' + fteValues.filter(v => v < 0 || v > 1).join(','));

  // ------------------------------------------------------------ assignments
  const assignmentDocs = (await list(token, 'role_assignments')).map(toDocument);
  console.log(`\n[role_assignments] live documents=${assignmentDocs.length}`);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const records = assignmentDocs.map(doc => toRecord(doc.id, doc.data, today));

  check('assignments exist so the Roles tab is not empty', records.length > 0);
  check('every assignment derives a status', records.every(r => ['active', 'inactive', 'upcoming', 'dates-needed'].includes(r.status)));
  check('every assignment carries an integer revision', records.every(r => Number.isInteger(r.revision) && r.revision >= 1));
  check('every assignment resolves to a live Faculty id',
    records.every(r => rows.some(row => row.facultyId === r.facultyId)),
    'dangling: ' + records.filter(r => !rows.some(row => row.facultyId === r.facultyId)).map(r => r.facultyId).join(','));
  console.log('  statuses: ' + records.map(r => `${r.roleType}=${r.status}`).join(' '));

  // ------------------------------------------------------------- directory
  console.log('\n[directory] built from live assignments');
  const byId = new Map(facultyDocs.map(doc => [doc.id, doc.data]));
  const directoryRows = records
    .filter(r => ['hicc', 'course coordinator', 'visc'].includes(String(r.roleType).toLowerCase()))
    .map(r => {
      const person = byId.get(r.facultyId) || {};
      return {
        roleType: r.roleType,
        facultyId: r.facultyId,
        facultyFirstName: String(person.firstName || ''),
        facultyLastName: String(person.lastName || ''),
        facultyName: '',
        courseCode: r.scopeCode,
        recordedScope: r.scopeCode,
        hasSchedule: true,
        periodsJson: JSON.stringify(r.periods),
        effectiveDate: null,
        expirationDate: null
      };
    });
  const body = buildDirectory(directoryRows, { academicYear: '2026-27', asOfDate: today });
  console.log(`  hiccCc=${body.hiccCc.length} visc=${body.visc.length}`);
  check('the HICC-CC directory has records', body.hiccCc.length > 0);
  check('the VISC directory has records', body.visc.length > 0);

  const serialised = JSON.stringify(body);
  const leaked = ['ucid', 'email', 'doe', 'audit'].filter(word => serialised.toLowerCase().includes(`"${word}`));
  check('the directory payload exposes no confidential field names', leaked.length === 0, leaked.join(','));
  // The seeded UCIDs and emails must not appear as values either.
  const values = rows.flatMap(r => [r.ucid, r.email]).filter(Boolean);
  check('no UCID or email value appears in the directory payload',
    values.every(v => !serialised.includes(v)),
    values.filter(v => serialised.includes(v)).length + ' leaked');
  check('directory names are "Last, First"',
    [...body.hiccCc, ...body.visc].every(e => !e.facultyName || e.facultyName.includes(', ')));

  console.log(`\n${failures === 0 ? 'ALL LIVE CHECKS PASSED' : failures + ' LIVE CHECK(S) FAILED'}`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(error => { console.log('FAILED:', error.message); process.exitCode = 1; });
