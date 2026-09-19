'use strict';
// Regenerates firebase-config.js from the Firebase CLI.
//
//   node tools/build-firebase-config.js --project vista-teaching-lab
//   node tools/build-firebase-config.js --project <id> --app <appId>
//   node tools/build-firebase-config.js --from-json ./local-config.json
//
// The generated values are written straight to firebase-config.js and are never
// printed, so this can run in a CI log without leaking configuration.
//
// Production builds generate their own configuration at deploy time; the
// generated file is not committed for the production project.

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'firebase-config.js');

const args = process.argv.slice(2);
const value = name => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : '';
};

function render(config) {
  return `'use strict';
// GENERATED FILE - do not edit by hand.
// Regenerate with: node tools/build-firebase-config.js --project <project-id>
//
// See the header comment in the committed template for the full rationale.
(function (root) {
  if (!root) return;

  const config = ${JSON.stringify(config, null, 2)};

  const host = String((root.location && root.location.hostname) || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || host === '0.0.0.0';

  root.UCVM_FIREBASE_CONFIG = Object.freeze(config);
  root.UCVM_FIREBASE_EMULATOR = isLocal;
  root.UCVM_FIREBASE_PROJECT_ID = config.projectId;
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

function main() {
  const fromJson = value('--from-json');
  let config;

  if (fromJson) {
    config = normalize(JSON.parse(fs.readFileSync(path.resolve(fromJson), 'utf8')));
  } else {
    const project = value('--project') || process.env.FIREBASE_PROJECT_ID;
    if (!project) throw new Error('Pass --project <project-id>, --from-json <file>, or set FIREBASE_PROJECT_ID.');
    const appId = value('--app');
    const command = ['apps:sdkconfig', 'web'];
    if (appId) command.push(appId);
    command.push('--project', project, '--json');
    let raw;
    try {
      raw = execFileSync('firebase', command, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
    } catch (error) {
      throw new Error(`firebase ${command.join(' ')} failed. Is the Firebase CLI installed and logged in?`);
    }
    const parsed = JSON.parse(raw);
    const sdkConfig = parsed?.result?.sdkConfig || parsed?.sdkConfig || parsed;
    config = normalize(sdkConfig);
  }

  fs.writeFileSync(target, render(config));
  console.log(`Wrote ${path.relative(root, target)} for project "${config.projectId}".`);
  console.log('Values were not printed.');
}

try {
  main();
} catch (error) {
  console.error(`Config generation failed: ${error.message}`);
  process.exit(1);
}
