'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, assetSourcePath, readAssetManifest } = require('./frontend-paths');

function assertNoSymlinks(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Static build path escapes repository.');
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`Static build path must not be a symbolic link: ${current}`);
    }
  }
}

function validateOutput(root, output) {
  const allowed = [path.join(root, '.deploy-static'), path.join(root, '.azure-production', 'app')];
  if (!allowed.includes(output)) throw new Error('Static build output must be an approved artifact directory.');
  assertNoSymlinks(root, output);
}

function validateSources(root = ROOT) {
  return readAssetManifest(root).map(asset => {
    const source = assetSourcePath(root, asset);
    assertNoSymlinks(root, source);
    const stat = fs.statSync(source, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`Required static asset is missing: ${asset}`);
    return { asset, source, bytes: stat.size };
  });
}

function buildStaticBundle({ root = ROOT, output = path.join(root, '.deploy-static') } = {}) {
  root = path.resolve(root);
  output = path.resolve(output);
  validateOutput(root, output);
  // Complete all validation before touching a previously successful artifact.
  const inputs = validateSources(root);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const { asset, source } of inputs) fs.copyFileSync(source, path.join(output, asset));
  return { output, files: inputs.length, bytes: inputs.reduce((sum, input) => sum + input.bytes, 0) };
}

module.exports = { buildStaticBundle, validateOutput, validateSources };
