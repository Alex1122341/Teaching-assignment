'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ROOT } = require('./build/frontend-paths');
const { buildStaticBundle, validateOutput, validateSources } = require('./build/static-bundle');

// Retain the existing artifact contract consumed by reviewed release workflows.
const output = path.join(ROOT, '.azure-production');
const app = path.join(output, 'app');
const api = path.join(output, 'api');
validateOutput(ROOT, app);
validateSources(ROOT);
fs.rmSync(output, { recursive: true, force: true });
buildStaticBundle({ root: ROOT, output: app });
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-swa-api.js'), '--output', api], {
  cwd: ROOT,
  stdio: 'inherit'
});
console.log(JSON.stringify({ output, app, api }));
