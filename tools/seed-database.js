'use strict';
// Seeds the VISTA Firestore database from tools/seed/dataset.js.
//
//   node tools/seed-database.js --dry-run
//   node tools/seed-database.js --emulator
//   node tools/seed-database.js --project vista-teaching-lab
//   node tools/seed-database.js --project vista-teaching-lab --verify
//
// Writes go through the Firestore REST API, so this works against the emulator
// (no auth) and against a real project (OAuth token from the Firebase CLI
// credential store). No service-account key is required and no secret is printed.
//
// The seed is idempotent: every document is an upsert, so running it twice
// leaves the database in the same state.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {buildDataset} = require('./seed/dataset.js');

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const useEmulator = flag('--emulator');
const dryRun = flag('--dry-run');
const verifyOnly = flag('--verify');
const projectId = value('--project', process.env.FIRESTORE_PROJECT_ID || 'vista-teaching-lab');
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

// --- Firestore REST value encoding ------------------------------------------

function encodeValue(input) {
  if (input === null || input === undefined) return {nullValue: null};
  if (input instanceof Date) return {timestampValue: input.toISOString()};
  if (typeof input === 'string') return {stringValue: input};
  if (typeof input === 'boolean') return {booleanValue: input};
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`Non-finite number in seed data: ${input}`);
    // Firestore distinguishes int64 from double; rules use `is int`, so this
    // distinction matters.
    return Number.isInteger(input) ? {integerValue: String(input)} : {doubleValue: input};
  }
  if (Array.isArray(input)) return {arrayValue: {values: input.map(encodeValue)}};
  if (typeof input === 'object') return {mapValue: {fields: encodeFields(input)}};
  throw new Error(`Unsupported seed value type: ${typeof input}`);
}

function encodeFields(object) {
  const fields = {};
  for (const [key, val] of Object.entries(object)) {
    if (val === undefined) continue;
    fields[key] = encodeValue(val);
  }
  return fields;
}

function decodeValue(input) {
  if (!input || typeof input !== 'object') return null;
  if ('nullValue' in input) return null;
  if ('stringValue' in input) return input.stringValue;
  if ('booleanValue' in input) return input.booleanValue;
  if ('integerValue' in input) return Number(input.integerValue);
  if ('doubleValue' in input) return input.doubleValue;
  if ('timestampValue' in input) return input.timestampValue;
  if ('arrayValue' in input) return (input.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in input) return decodeFields(input.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [key, val] of Object.entries(fields || {})) out[key] = decodeValue(val);
  return out;
}

// --- transport --------------------------------------------------------------

function loadAccessToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(configPath)) throw new Error('Firebase CLI credentials not found. Run `firebase login`.');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const refreshToken = config?.tokens?.refresh_token;
  if (!refreshToken) throw new Error('No Firebase refresh token. Run `firebase login`.');

  const require2 = createRequire(__filename);
  const api = require2(path.join(__dirname, '..', 'node_modules', 'firebase-tools', 'lib', 'api.js'));

  return (async () => {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: api.clientId(),
        client_secret: api.clientSecret()
      })
    });
    if (!response.ok) throw new Error(`Token exchange failed: HTTP ${response.status}`);
    return (await response.json()).access_token;
  })();
}

async function makeTransport() {
  if (useEmulator) {
    const base = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents`;
    // The Firestore emulator bypasses security rules for the reserved
    // `Bearer owner` token. Seeding is an administrative operation, so rules
    // must not apply; they are exercised separately by the emulator test suite.
    return {
      base,
      headers: {authorization: 'Bearer owner', 'content-type': 'application/json'},
      label: `emulator ${emulatorHost}`
    };
  }
  const token = await loadAccessToken();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  return {base, headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, label: `project ${projectId}`};
}

function documentName(docPath) {
  return `projects/${projectId}/databases/(default)/documents/${docPath}`;
}

async function commit(transport, writes) {
  const response = await fetch(`${transport.base}:commit`, {
    method: 'POST',
    headers: transport.headers,
    body: JSON.stringify({writes})
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Commit failed: HTTP ${response.status} ${text.slice(0, 400)}`);
  }
  return response.json();
}

async function readDocument(transport, docPath) {
  const response = await fetch(`${transport.base}/${docPath}`, {headers: transport.headers});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Read ${docPath} failed: HTTP ${response.status}`);
  const json = await response.json();
  return decodeFields(json.fields || {});
}

// --- main -------------------------------------------------------------------

async function main() {
  const dataset = buildDataset();

  console.log(`Seed source: ${dataset.generatedFrom}`);
  console.log(`Project:     ${projectId}`);
  console.log(`Target:      ${useEmulator ? `emulator at ${emulatorHost}` : 'live Firestore (OAuth)'}`);
  console.log('Document counts:');
  for (const [key, count] of Object.entries(dataset.counts)) console.log(`  ${key.padEnd(18)} ${count}`);

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  const transport = await makeTransport();

  if (verifyOnly) {
    console.log(`\nVerifying ${transport.label} ...`);
    let ok = 0;
    const missing = [];
    for (const document of dataset.documents) {
      const stored = await readDocument(transport, document.path);
      if (stored) ok += 1;
      else missing.push(document.path);
    }
    console.log(`  present: ${ok}/${dataset.documents.length}`);
    if (missing.length) {
      console.log('  MISSING:');
      for (const item of missing.slice(0, 20)) console.log(`    ${item}`);
      process.exit(1);
    }
    console.log('  all seeded documents present.');
    return;
  }

  // Firestore allows at most 500 writes per commit.
  const chunks = [];
  for (let index = 0; index < dataset.documents.length; index += 400) {
    chunks.push(dataset.documents.slice(index, index + 400));
  }

  console.log(`\nWriting to ${transport.label} ...`);
  let written = 0;
  for (const [index, chunk] of chunks.entries()) {
    const writes = chunk.map(document => ({
      update: {name: documentName(document.path), fields: encodeFields(document.data)}
    }));
    await commit(transport, writes);
    written += chunk.length;
    console.log(`  batch ${index + 1}/${chunks.length}: ${written} documents written`);
  }
  console.log(`\nSeeded ${written} documents.`);
  console.log('Re-run with --verify to confirm.');
}

main().catch(error => {
  console.error(`\nSeed failed: ${error.message}`);
  process.exit(1);
});
