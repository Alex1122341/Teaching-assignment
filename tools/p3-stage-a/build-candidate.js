'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BASE_SHA = 'b6e74ff5ff34ef5f3b2541f8a3528341ff38f943';
const EXPECTED_PACKAGE = 'paws-beta-sql-runtime';
const EXPECTED_NODE = '22.x';
const EXPECTED_PDF_LIB = '1.17.1';
const REQUIRED_FILES = [
  'server/package.json',
  'server/package-lock.json',
  'server/src/runtime/university-api.js',
  'server/src/data/sql-afc-request-repository.js',
  'server/src/data/sql-afc-approval-repository.js',
  'server/src/data/sql-afc-artifact-repository.js',
  'server/src/afc/afc-request-api.js',
  'server/src/afc/afc-approval-api.js',
  'server/src/afc/afc-approved-artifact-api.js',
  'server/src/afc/afc-approved-artifact-renderer.js',
  'server/src/afc/assets/absence-from-campus-app.pdf',
];
const OMIT_PATH = /(^|\/)(?:\.git|node_modules|test|tests|__tests__|fixtures|secrets?|credentials?)(?:\/|$)|(^|\/)\.env(?:\.[^/]*)?$|(?:^|\/)(?:service-account|firebase-admin-credentials)(?:\.[^/]*)?$|\.(?:pem|pfx|p12|key)$/i;
const PRIVATE_KEY_MARKER = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertInside(relative, message) {
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(message);
  }
}

function collectFiles(repoRoot) {
  const root = path.resolve(repoRoot);
  const serverRoot = path.join(root, 'server');
  const files = [];
  for (const manifest of ['package.json', 'package-lock.json']) {
    const absolute = path.join(serverRoot, manifest);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Required server manifest is missing: ${manifest}`);
    files.push({ absolute, relative: `server/${manifest}` });
  }

  const walk = (directory, relativeDirectory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = `${relativeDirectory}/${entry.name}`.replaceAll('\\', '/');
      if (OMIT_PATH.test(relative)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Candidate source contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) files.push({ absolute, relative });
    }
  };
  const sourceRoot = path.join(serverRoot, 'src');
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) throw new Error('Required server/src runtime tree is missing');
  walk(sourceRoot, 'server/src');

  const unique = new Map(files.map(file => [file.relative, file]));
  const selected = [...unique.values()].sort((a, b) => a.relative.localeCompare(b.relative, 'en'));
  const selectedNames = new Set(selected.map(file => file.relative));
  for (const required of REQUIRED_FILES) {
    if (!selectedNames.has(required)) throw new Error(`Required accepted P3 runtime file is missing or excluded: ${required}`);
  }
  for (const file of selected) {
    const content = fs.readFileSync(file.absolute);
    if (PRIVATE_KEY_MARKER.test(content.toString('utf8'))) throw new Error(`Candidate source contains a private-key marker: ${file.relative}`);
  }
  return selected;
}

function assertPinnedManifests(repoRoot) {
  const serverRoot = path.join(path.resolve(repoRoot), 'server');
  const packageJson = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package-lock.json'), 'utf8'));
  if (packageJson.name !== EXPECTED_PACKAGE) throw new Error('Unexpected server package name');
  if (packageJson.engines?.node !== EXPECTED_NODE) throw new Error('Server package must pin Node 22.x');
  if (packageJson.dependencies?.['pdf-lib'] !== EXPECTED_PDF_LIB) throw new Error('Server package must pin pdf-lib@1.17.1');
  if (lock.packages?.['']?.dependencies?.['pdf-lib'] !== EXPECTED_PDF_LIB) throw new Error('Server lockfile must pin pdf-lib@1.17.1');
  if (lock.packages?.['node_modules/pdf-lib']?.version !== EXPECTED_PDF_LIB) throw new Error('Locked pdf-lib package version must be 1.17.1');
  return { nodeVersion: EXPECTED_NODE, pdfLibVersion: EXPECTED_PDF_LIB };
}

function buildCandidate({ repoRoot, outputDir, baseSha = BASE_SHA } = {}) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) throw new TypeError('repoRoot is required');
  if (typeof outputDir !== 'string' || !outputDir.trim()) throw new TypeError('outputDir is required');
  if (baseSha !== BASE_SHA) throw new Error(`Candidate must use approved base SHA ${BASE_SHA}`);

  const root = path.resolve(repoRoot);
  const output = path.resolve(outputDir);
  const outputRelative = path.relative(root, output);
  if (outputRelative === '' || (outputRelative !== '..' && !outputRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(outputRelative))) {
    throw new Error('Candidate output must be outside the repository');
  }
  if (fs.existsSync(output) && fs.readdirSync(output).length > 0) throw new Error('Candidate output directory must be empty');

  const pinned = assertPinnedManifests(root);
  const sourceFiles = collectFiles(root);
  const entries = sourceFiles.map(file => ({ path: file.relative, sha256: sha256(fs.readFileSync(file.absolute)) }));
  const inventoryCore = {
    formatVersion: 1,
    baseSha,
    nodeVersion: pinned.nodeVersion,
    pdfLibVersion: pinned.pdfLibVersion,
    files: entries,
  };
  const digest = sha256(`${JSON.stringify(inventoryCore)}\n`);

  fs.mkdirSync(output, { recursive: true });
  for (const file of sourceFiles) {
    const destination = path.join(output, file.relative);
    assertInside(path.relative(output, destination), `Unsafe candidate path: ${file.relative}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file.absolute, destination, fs.constants.COPYFILE_EXCL);
  }
  const inventory = { ...inventoryCore, packageSha256: digest };
  fs.writeFileSync(path.join(output, 'candidate-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
  return {
    baseSha,
    nodeVersion: pinned.nodeVersion,
    pdfLibVersion: pinned.pdfLibVersion,
    files: entries.map(entry => entry.path),
    digest,
    outputDir: output,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  if (outputIndex < 0 || !args[outputIndex + 1]) {
    console.error('Usage: node tools/p3-stage-a/build-candidate.js --output <empty-path>');
    process.exitCode = 2;
  } else {
    try {
      const result = buildCandidate({ repoRoot: path.resolve(__dirname, '../..'), outputDir: args[outputIndex + 1] });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = { buildCandidate, collectFiles, sha256 };
