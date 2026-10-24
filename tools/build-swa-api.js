'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_FILES = ['package.json', 'package-lock.json', 'host.json', 'index.js'];

function buildSwaApi({ root }) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('A repository root is required');
  }

  const repositoryRoot = fs.realpathSync(path.resolve(root));
  const source = path.join(repositoryRoot, 'swa-api');
  const serverSource = path.join(repositoryRoot, 'server', 'src');
  const outputParent = path.join(repositoryRoot, '.azure-production');
  const output = path.join(outputParent, 'api');
  const expectedOutput = path.resolve(repositoryRoot, '.azure-production', 'api');

  if (path.resolve(output) !== expectedOutput) {
    throw new Error('SWA API output must be .azure-production/api');
  }
  for (const name of SOURCE_FILES) {
    if (!fs.existsSync(path.join(source, name))) {
      throw new Error(`Missing SWA API source: ${name}`);
    }
  }
  if (!fs.statSync(serverSource, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Missing server/src API source');
  }

  fs.mkdirSync(outputParent, { recursive: true });
  if (fs.lstatSync(outputParent).isSymbolicLink()) {
    throw new Error('SWA API output parent must not be a symbolic link');
  }
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) {
    throw new Error('SWA API output must not be a symbolic link');
  }

  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const name of SOURCE_FILES) {
    fs.copyFileSync(path.join(source, name), path.join(output, name));
  }
  fs.cpSync(serverSource, path.join(output, 'server', 'src'), { recursive: true });

  const inventory = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else inventory.push(path.relative(output, entryPath).replaceAll('\\', '/'));
    }
  }
  walk(output);
  fs.writeFileSync(path.join(output, 'artifact-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);

  return { output, files: inventory.length };
}

function runCli() {
  const root = path.resolve(__dirname, '..');
  const outputArgumentIndex = process.argv.indexOf('--output');
  const requestedOutput = outputArgumentIndex >= 0 ? process.argv[outputArgumentIndex + 1] : undefined;
  const expectedOutput = path.join(root, '.azure-production', 'api');
  if (requestedOutput && path.resolve(requestedOutput) !== path.resolve(expectedOutput)) {
    throw new Error('SWA API output must be .azure-production/api');
  }
  const result = buildSwaApi({ root });
  console.log(JSON.stringify(result));
}

if (require.main === module) runCli();

module.exports = { buildSwaApi };
