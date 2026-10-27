'use strict';

// Source layout is independent of the public URLs in static-assets.json.
// Build output remains flat, so existing bookmarks and runtime URLs do not change.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const DIRECTORIES = Object.freeze({ '.html': 'pages', '.js': 'scripts', '.css': 'styles', '.pdf': 'assets' });
// Beta read `tools/static-assets.json`. In this repository that filename already
// belongs to the pre-existing Firestore application's manifest, which feeds
// tools/build-static.js. The PAWS manifest therefore lives beside it as
// `static-assets.paws.json`. Prefer the PAWS manifest and fall back to the
// original name so this module still works if the two are ever consolidated.
function loadManifest() {
  const paws = path.join(__dirname, '..', 'static-assets.paws.json');
  return require(fs.existsSync(paws) ? paws : path.join(__dirname, '..', 'static-assets.json'));
}
const published = new Set(loadManifest());
const revisionLayouts = new Map();

function frontendRelativePath(asset) {
  if (typeof asset !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(asset) || asset.includes('..')) {
    throw new Error(`Unsafe static asset path: ${asset}`);
  }
  const directory = DIRECTORIES[path.extname(asset)];
  if (!directory) throw new Error(`Unsupported static asset type: ${asset}`);
  return `frontend/${directory}/${asset}`;
}

function assetSourcePath(root, asset) {
  return path.join(root, frontendRelativePath(asset));
}

// Explicit source lookup for tests/tools, not a monkey-patch of fs or require.
// Only manifest-declared public names at this repository root are translated.
function repositoryPath(...parts) {
  const candidate = path.resolve(...parts);
  const relative = path.relative(ROOT, candidate).split(path.sep).join('/');
  return published.has(relative) ? assetSourcePath(ROOT, relative) : candidate;
}

function sourcePathAtCommit(root, ref, asset) {
  if (!published.has(asset)) return asset;
  const key = `${root}\0${ref}`;
  const immutable = /^[0-9a-f]{40}$/i.test(ref);
  let organized = immutable ? revisionLayouts.get(key) : undefined;
  if (organized === undefined) {
    // Read the requested Git revision, not mutable working-tree layout.
    const marker = execFileSync('git', ['ls-tree', '--name-only', ref, '--', 'frontend/README.md'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    organized = marker === 'frontend/README.md';
    if (immutable) revisionLayouts.set(key, organized);
  }
  return organized ? frontendRelativePath(asset) : asset;
}

function readAssetManifest(root = ROOT) {
  // The PAWS manifest is tools/static-assets.paws.json in this repository;
  // tools/static-assets.json belongs to the legacy web/ application.
  const pawsManifest = path.join(root, 'tools/static-assets.paws.json');
  const manifestPath = fs.existsSync(pawsManifest) ? pawsManifest : path.join(root, 'tools/static-assets.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('Static asset manifest must be a non-empty array.');
  if (new Set(manifest).size !== manifest.length) throw new Error('Static asset manifest contains duplicates.');
  for (const asset of manifest) frontendRelativePath(asset);
  return manifest;
}

module.exports = { ROOT, DIRECTORIES, frontendRelativePath, assetSourcePath, repositoryPath, sourcePathAtCommit, readAssetManifest };
