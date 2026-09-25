'use strict';
// Regenerates firebase-config.js from the Firebase CLI or a supplied web SDK
// configuration. Production builds also inject the public DOE API base URL.
//
//   node tools/build-firebase-config.js --project vista-teaching-lab
//   node tools/build-firebase-config.js --project <id> --app <appId>
//   node tools/build-firebase-config.js --from-json ./local-config.json
//   node tools/build-firebase-config.js --from-json ./prod.json --doe-api-base-url https://example.azurewebsites.net
//
// Generated values are written straight to firebase-config.js and are never
// printed, so this can run in CI without leaking the supplied configuration.
//
// Production builds generate their configuration at build time; the generated
// file is not committed for the production project.

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'firebase-config.js');

function argValue(args,name) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : '';
}

function normalizeDoeApiBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/,'');
  if (!text) return '';
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error('DOE API base URL must be an absolute URL.'); }
  const local = ['localhost','127.0.0.1','0.0.0.0'].includes(String(parsed.hostname || '').toLowerCase());
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new Error('DOE API base URL must use HTTPS unless it targets localhost.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('DOE API base URL must not contain credentials, query parameters, or a fragment.');
  }
  return text;
}

function normalizePawsSessionBackend(value) {
  const backend = String(value || '').trim().toLowerCase() || 'firestore';
  if (!['firestore','azure-sql'].includes(backend)) {
    throw new Error('PAWS session backend must be either "firestore" or "azure-sql".');
  }
  return backend;
}

function render(config,{doeApiBaseUrl='',pawsSessionBackend='firestore'}={}) {
  const apiBase = normalizeDoeApiBaseUrl(doeApiBaseUrl);
  const sessionBackend = normalizePawsSessionBackend(pawsSessionBackend);
  return `'use strict';
// GENERATED FILE - do not edit by hand.
// Regenerate with: node tools/build-firebase-config.js --project <project-id>
//
// See the header comment in the committed template for the full rationale.
(function (root) {
  if (!root) return;

  const config = ${JSON.stringify(config, null, 2)};
  const doeApiBaseUrl = ${JSON.stringify(apiBase)};
  const pawsSessionBackend = ${JSON.stringify(sessionBackend)};

  const host = String((root.location && root.location.hostname) || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || host === '0.0.0.0';

  root.UCVM_FIREBASE_CONFIG = Object.freeze(config);
  root.UCVM_FIREBASE_EMULATOR = isLocal;
  root.UCVM_FIREBASE_PROJECT_ID = config.projectId;
  root.UCVM_DOE_API_BASE_URL = doeApiBaseUrl;
  root.UCVM_PAWS_SESSION_BACKEND = pawsSessionBackend;
})(typeof window !== 'undefined' ? window : null);
`;
}

function normalize(sdkConfig) {
  const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
  const config = {};
  for (const key of required) {
    if (!sdkConfig[key]) throw new Error(`Generated configuration is missing "${key}".`);
    config[key] = sdkConfig[key];
  }
  if (sdkConfig.measurementId) config.measurementId = sdkConfig.measurementId;
  return config;
}

function generate({args=process.argv.slice(2),env=process.env}={}) {
  const fromJson = argValue(args,'--from-json');
  let config;

  if (fromJson) {
    config = normalize(JSON.parse(fs.readFileSync(path.resolve(fromJson), 'utf8')));
  } else {
    const project = argValue(args,'--project') || env.FIREBASE_PROJECT_ID;
    if (!project) throw new Error('Pass --project <project-id>, --from-json <file>, or set FIREBASE_PROJECT_ID.');
    const appId = argValue(args,'--app');
    const command = ['apps:sdkconfig', 'web'];
    if (appId) command.push(appId);
    command.push('--project', project, '--json');
    let raw;
    try {
      raw = execFileSync('firebase', command, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
    } catch {
      throw new Error(`firebase ${command.join(' ')} failed. Is the Firebase CLI installed and logged in?`);
    }
    const parsed = JSON.parse(raw);
    const sdkConfig = parsed?.result?.sdkConfig || parsed?.sdkConfig || parsed;
    config = normalize(sdkConfig);
  }

  const doeApiBaseUrl = normalizeDoeApiBaseUrl(argValue(args,'--doe-api-base-url') || env.DOE_API_BASE_URL || '');
  const pawsSessionBackend = normalizePawsSessionBackend(argValue(args,'--paws-session-backend') || env.PAWS_SESSION_BACKEND || 'firestore');
  return {config,doeApiBaseUrl,pawsSessionBackend};
}

function main() {
  const {config,doeApiBaseUrl,pawsSessionBackend} = generate();
  fs.writeFileSync(target, render(config,{doeApiBaseUrl,pawsSessionBackend}));
  console.log(`Wrote ${path.relative(root, target)} for project "${config.projectId}".`);
  console.log(`DOE API endpoint: ${doeApiBaseUrl ? 'configured' : 'not configured'}.`);
  console.log(`PAWS session backend: ${pawsSessionBackend}.`);
  console.log('Configuration values were not printed.');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`Config generation failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports={argValue,normalizeDoeApiBaseUrl,normalizePawsSessionBackend,render,normalize,generate,main};
