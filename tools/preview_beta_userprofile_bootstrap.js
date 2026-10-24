#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fail(message) {
  console.error(message);
  process.exit(2);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const manifestPath = arg('--manifest');
const privateSqlOutput = arg('--private-sql-output');
if (!manifestPath) fail('Usage: preview_beta_userprofile_bootstrap.js --manifest <private.json> [--private-sql-output <path>]');

const payload = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
const exclusions = Array.isArray(payload.exclusions) ? payload.exclusions : [];

if (profiles.length !== 6) fail('Expected exactly 6 SQL UserProfile rows after the approved HICC-2 exclusion.');

const expectedClasses = {
  hicc_faculty: 1,
  dvm_non_faculty: 1,
  lab_non_faculty: 1,
  global_admin: 3
};
const expectedRoles = {
  hicc: 1,
  viewer: 2,
  adfa_general: 2,
  administrator: 1
};

const seenUid = new Set();
const seenEmail = new Set();
const classCounts = {};
const roleCounts = {};
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

for (const profile of profiles) {
  for (const field of ['firebaseUid', 'email', 'displayName', 'baseRole', 'bootstrapClass']) {
    if (!String(profile[field] || '').trim()) fail('Every profile must provide ' + field + '.');
  }
  if (profile.active !== true) fail('Every approved Beta bootstrap profile must be active.');
  if (typeof profile.mustChangePassword !== 'boolean') fail('Every profile must explicitly set mustChangePassword.');

  const uid = String(profile.firebaseUid).trim();
  const email = String(profile.email).trim().toLowerCase();
  const role = String(profile.baseRole).trim().toLowerCase();
  const cls = String(profile.bootstrapClass).trim();

  if (seenUid.has(uid)) fail('Duplicate Firebase UID in bootstrap manifest.');
  if (seenEmail.has(email)) fail('Duplicate email in bootstrap manifest.');
  seenUid.add(uid);
  seenEmail.add(email);
  classCounts[cls] = (classCounts[cls] || 0) + 1;
  roleCounts[role] = (roleCounts[role] || 0) + 1;

  if (cls === 'hicc_faculty') {
    if (role !== 'hicc') fail('HICC-1 bootstrap class must use baseRole hicc.');
    if (!guid.test(String(profile.facultyId || ''))) fail('HICC-1 requires the already reviewed exact SQL FacultyId GUID.');
  } else {
    if (profile.facultyId !== null) fail('DVM, LAB and global/admin accounts must have FacultyId = null.');
  }

  if (cls === 'dvm_non_faculty' || cls === 'lab_non_faculty') {
    if (role !== 'viewer') fail('Current DVM/LAB Beta accounts must preserve their existing viewer base role.');
  }
  if (cls === 'global_admin' && !['adfa_general', 'administrator'].includes(role)) {
    fail('Global/admin bootstrap rows must preserve the approved administrative base role.');
  }
}

for (const [key, count] of Object.entries(expectedClasses)) {
  if ((classCounts[key] || 0) !== count) fail('Unexpected bootstrap class count for ' + key + '.');
}
for (const [key, count] of Object.entries(expectedRoles)) {
  if ((roleCounts[key] || 0) !== count) fail('Unexpected base-role count for ' + key + '.');
}

if (exclusions.length !== 1) fail('Expected exactly one excluded Beta account: HICC-2.');
const exclusion = exclusions[0] || {};
if (exclusion.label !== 'HICC-2' || exclusion.reason !== 'HUMAN_CONFIRMED_DELETE_ACCOUNT') {
  fail('HICC-2 exclusion must be explicit and preserve the approved reason.');
}
if (!String(exclusion.firebaseUid || '').trim()) fail('HICC-2 exclusion must carry its exact Firebase UID in the private manifest.');
if (seenUid.has(String(exclusion.firebaseUid).trim())) fail('Excluded HICC-2 UID must not appear in SQL profiles.');

const normalized = JSON.stringify({
  profiles: profiles.map(p => ({
    firebaseUid: String(p.firebaseUid).trim(),
    email: String(p.email).trim().toLowerCase(),
    displayName: String(p.displayName).trim(),
    baseRole: String(p.baseRole).trim().toLowerCase(),
    facultyId: p.facultyId === null ? null : String(p.facultyId).trim(),
    active: true,
    mustChangePassword: p.mustChangePassword,
    officeName: p.officeName == null ? null : String(p.officeName).trim(),
    bootstrapClass: String(p.bootstrapClass).trim()
  })).sort((a, b) => a.firebaseUid.localeCompare(b.firebaseUid)),
  exclusions: [{
    firebaseUid: String(exclusion.firebaseUid).trim(),
    label: exclusion.label,
    reason: exclusion.reason
  }]
});
const planSha256 = crypto.createHash('sha256').update(normalized).digest('hex');

function sqlLiteral(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return "N'" + String(value).replaceAll("'", "''") + "'";
}
function bit(value) { return value ? '1' : '0'; }

if (privateSqlOutput) {
  const reviewed = JSON.parse(normalized);
  const statements = [
    'SET XACT_ABORT ON;',
    'BEGIN TRANSACTION;',
    "IF EXISTS (SELECT 1 FROM paws.UserProfile) THROW 51020, 'Beta UserProfile bootstrap expects an empty table.', 1;"
  ];
  for (const p of reviewed.profiles) {
    statements.push(
      'INSERT INTO paws.UserProfile (FirebaseUid, Email, DisplayName, BaseRole, FacultyId, Active, MustChangePassword, OfficeName) VALUES (' +
      [
        sqlLiteral(p.firebaseUid),
        sqlLiteral(p.email),
        sqlLiteral(p.displayName),
        sqlLiteral(p.baseRole),
        p.facultyId ? "CONVERT(uniqueidentifier, " + sqlLiteral(p.facultyId) + ')' : 'NULL',
        bit(p.active),
        bit(p.mustChangePassword),
        sqlLiteral(p.officeName)
      ].join(', ') +
      ');'
    );
  }
  statements.push('COMMIT TRANSACTION;');
  fs.mkdirSync(path.dirname(path.resolve(privateSqlOutput)), { recursive: true });
  fs.writeFileSync(privateSqlOutput, statements.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
}

console.log(JSON.stringify({
  mode: 'preview-only',
  writesPerformed: false,
  profileRows: profiles.length,
  excludedRows: exclusions.length,
  roleCounts,
  classCounts,
  planSha256,
  privateSqlGenerated: Boolean(privateSqlOutput)
}, null, 2));
