'use strict';

// Frozen ACA API runtime enforcement.  The API trust anchor is deliberately
// shared with the static runtime freeze: changing the static baseline must
// never leave the API on a different release candidate.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { BASELINE_COMMIT } = require('./beta-freeze');

const API_SOURCE_ROOTS = Object.freeze([
  'swa-api/host.json',
  'swa-api/index.js',
  'swa-api/package.json',
  'swa-api/package-lock.json'
]);
const BUILD_DEFINITION_FILES = Object.freeze(['deploy/aca/Dockerfile']);
// The Windows-hosted University API resolves runtime dependencies from the
// server workspace. Protect its package graph as repository inputs without
// requiring the separate SWA artifact to contain a second nested package.
const REPOSITORY_INPUT_FILES = Object.freeze([
  'server/package.json',
  'server/package-lock.json'
]);

function defaultRoot() { return path.resolve(__dirname, '..'); }

function normalize(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8');
  const out = Buffer.allocUnsafe(source.length);
  let length = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === 0x0d && source[i + 1] === 0x0a) {
      out[length++] = 0x0a;
      i += 1;
    } else {
      out[length++] = source[i];
    }
  }
  return out.subarray(0, length);
}

function bytesMatch(expected, actual) {
  const a = Buffer.isBuffer(expected) ? expected : Buffer.from(expected);
  const b = Buffer.isBuffer(actual) ? actual : Buffer.from(actual);
  return a.equals(b) || normalize(a).equals(normalize(b));
}

function sha256Canonical(buffer) {
  return crypto.createHash('sha256').update(normalize(buffer)).digest('hex');
}

function gitBlob(root, ref) {
  return execFileSync('git', ['cat-file', 'blob', ref], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
}

function gitTreeFiles(root, ref, prefix) {
  const output = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', prefix], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  });
  return output.split(/\r?\n/).filter(Boolean);
}

function baselineCommitExists(root, baselineCommit = BASELINE_COMMIT) {
  try {
    execFileSync('git', ['cat-file', '-e', `${baselineCommit}^{commit}`], { cwd: root, stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
}

function walkFiles(root, relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  const result = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else result.push(path.relative(root, absolute).replaceAll('\\', '/'));
    }
  };
  walk(directory);
  return result;
}

function currentRuntimeFiles({ root = defaultRoot() } = {}) {
  return [...new Set([...API_SOURCE_ROOTS, ...walkFiles(root, 'server/src')])].sort();
}

function baselineRuntimeFiles({ root = defaultRoot(), baselineCommit = BASELINE_COMMIT } = {}) {
  return [...new Set([
    ...API_SOURCE_ROOTS.filter(file => {
      try { gitBlob(root, `${baselineCommit}:${file}`); return true; } catch (_) { return false; }
    }),
    ...gitTreeFiles(root, baselineCommit, 'server/src')
  ])].sort();
}

function runtimeFiles(options = {}) {
  const current = options.currentRuntimeFiles
    ? options.currentRuntimeFiles()
    : currentRuntimeFiles({ root: options.root || defaultRoot() });
  const historical = options.baselineRuntimeFiles
    ? options.baselineRuntimeFiles()
    : baselineRuntimeFiles({ root: options.root || defaultRoot(), baselineCommit: options.baselineCommit || BASELINE_COMMIT });
  return [...new Set([...current, ...historical])].sort();
}

function readBaselineFile({ root = defaultRoot(), baselineCommit = BASELINE_COMMIT, file }) {
  return gitBlob(root, `${baselineCommit}:${file}`);
}

function readWorkingFile({ root = defaultRoot(), file }) {
  return fs.readFileSync(path.join(root, file));
}

function artifactPath(runtimeFile, artifactRoot) {
  if (runtimeFile.startsWith('swa-api/')) return path.join(artifactRoot, runtimeFile.slice('swa-api/'.length));
  return path.join(artifactRoot, runtimeFile);
}

function artifactRuntimeName(runtimeFile) {
  return runtimeFile.startsWith('swa-api/') ? runtimeFile.slice('swa-api/'.length) : runtimeFile;
}

function artifactFiles(artifactRoot) {
  const result = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (path.relative(artifactRoot, absolute).replaceAll('\\', '/') !== 'artifact-inventory.json') {
        result.push(path.relative(artifactRoot, absolute).replaceAll('\\', '/'));
      }
    }
  };
  if (fs.existsSync(artifactRoot)) walk(artifactRoot);
  return result.sort();
}

function verifyArtifactInventory({ artifactRoot, expected }) {
  const inventoryPath = path.join(artifactRoot, 'artifact-inventory.json');
  const drift = [];
  if (!fs.existsSync(inventoryPath)) {
    drift.push({ surface: 'artifact', file: 'artifact-inventory.json', reason: 'missing-in-verified-copy' });
    return drift;
  }
  let declared;
  try { declared = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')); } catch (_) {
    drift.push({ surface: 'artifact', file: 'artifact-inventory.json', reason: 'invalid-inventory' });
    return drift;
  }
  const actual = artifactFiles(artifactRoot);
  if (!Array.isArray(declared) || JSON.stringify([...declared].sort()) !== JSON.stringify(actual)) {
    drift.push({ surface: 'artifact', file: 'artifact-inventory.json', reason: 'artifact-inventory-mismatch' });
  }
  const expectedSet = new Set(expected.map(artifactRuntimeName));
  for (const file of actual) {
    if (!expectedSet.has(file)) drift.push({ surface: 'artifact', file, reason: 'unexpected-artifact-file' });
  }
  return drift;
}

function verifyFreeze(options = {}) {
  const root = options.root || defaultRoot();
  const baselineCommit = options.baselineCommit || BASELINE_COMMIT;
  if (!options.skipCommitCheck && !baselineCommitExists(root, baselineCommit)) {
    throw new Error(`frozen baseline commit ${baselineCommit} is not available in this repository`);
  }
  const files = options.files || runtimeFiles({ ...options, root, baselineCommit });
  const buildDefinitionFiles = options.buildDefinitionFiles || [...BUILD_DEFINITION_FILES];
  const readBaseline = options.readBaselineFile || (({ file }) => readBaselineFile({ root, baselineCommit, file }));
  const readWorking = options.readWorking || (({ file }) => readWorkingFile({ root, file }));
  const drift = [];
  for (const file of files) {
    let baseline;
    try { baseline = readBaseline({ root, baselineCommit, file }); }
    catch (_) { drift.push({ surface: 'runtime', file, reason: 'missing-at-baseline' }); continue; }
    let actual;
    try { actual = readWorking({ root, baselineCommit, file }); }
    catch (_) { drift.push({ surface: 'runtime', file, reason: 'missing-in-verified-copy' }); continue; }
    if (!bytesMatch(baseline, actual)) drift.push({ surface: 'runtime', file, reason: 'content-drift' });
  }
  for (const file of buildDefinitionFiles) {
    let baseline;
    try { baseline = readBaseline({ root, baselineCommit, file }); }
    catch (_) { drift.push({ surface: 'buildDefinition', file, reason: 'missing-at-baseline' }); continue; }
    let actual;
    try { actual = readWorking({ root, baselineCommit, file }); }
    catch (_) { drift.push({ surface: 'buildDefinition', file, reason: 'missing-in-verified-copy' }); continue; }
    if (!bytesMatch(baseline, actual)) drift.push({ surface: 'buildDefinition', file, reason: 'content-drift' });
  }
  const repositoryInputFiles = options.repositoryInputFiles || [...REPOSITORY_INPUT_FILES];
  for (const file of repositoryInputFiles) {
    let baseline;
    try { baseline = readBaseline({ root, baselineCommit, file }); }
    catch (_) { drift.push({ surface: 'repositoryInput', file, reason: 'missing-at-baseline' }); continue; }
    let actual;
    try { actual = readWorking({ root, baselineCommit, file }); }
    catch (_) { drift.push({ surface: 'repositoryInput', file, reason: 'missing-in-verified-copy' }); continue; }
    if (!bytesMatch(baseline, actual)) drift.push({ surface: 'repositoryInput', file, reason: 'content-drift' });
  }
  const result = {
    baselineCommit,
    runtimeFiles: files,
    buildDefinitionFiles,
    repositoryInputFiles,
    protected: files.length + buildDefinitionFiles.length + repositoryInputFiles.length,
    checked: files.length + buildDefinitionFiles.length + repositoryInputFiles.length,
    drift,
    ok: drift.length === 0
  };
  if (options.artifact) {
    const artifactRoot = path.resolve(options.artifact);
    const artifactDrift = verifyArtifactInventory({ artifactRoot, expected: files });
    for (const item of artifactDrift) drift.push(item);
    for (const file of files) {
      let baseline;
      try { baseline = readBaseline({ root, baselineCommit, file }); }
      catch (_) { drift.push({ surface: 'artifact', file: artifactRuntimeName(file), reason: 'missing-at-baseline' }); continue; }
      const packaged = artifactPath(file, artifactRoot);
      if (!fs.existsSync(packaged)) {
        drift.push({ surface: 'artifact', file: artifactRuntimeName(file), reason: 'missing-in-verified-copy' });
      } else if (!bytesMatch(baseline, fs.readFileSync(packaged))) {
        drift.push({ surface: 'artifact', file: artifactRuntimeName(file), reason: 'content-drift' });
      }
    }
    result.artifact = artifactRoot;
    result.drift = drift;
    result.ok = drift.length === 0;
  }
  return result;
}

module.exports = {
  BASELINE_COMMIT,
  API_SOURCE_ROOTS,
  BUILD_DEFINITION_FILES,
  REPOSITORY_INPUT_FILES,
  normalize,
  bytesMatch,
  sha256Canonical,
  baselineCommitExists,
  currentRuntimeFiles,
  baselineRuntimeFiles,
  runtimeFiles,
  readBaselineFile,
  readWorkingFile,
  artifactPath,
  verifyArtifactInventory,
  artifactFiles,
  artifactRuntimeName,
  verifyFreeze
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const artifactAt = argv.indexOf('--artifact');
  const baselineAt = argv.indexOf('--baseline');
  const options = {};
  if (baselineAt >= 0 && argv[baselineAt + 1] && argv[baselineAt + 1] !== BASELINE_COMMIT) {
    console.error(`refusing to use baseline ${argv[baselineAt + 1]}: the frozen baseline is ${BASELINE_COMMIT}`);
    process.exit(1);
  }
  if (artifactAt >= 0) options.artifact = argv[artifactAt + 1] || '';
  const result = verifyFreeze(options);
  if (!result.ok) {
    console.error('frozen Azure beta API baseline check FAILED');
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, baselineCommit: result.baselineCommit, runtimeFiles: result.runtimeFiles, buildDefinitionFiles: result.buildDefinitionFiles, repositoryInputFiles: result.repositoryInputFiles }));
}
