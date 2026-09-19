'use strict';
// Guards against dangling documentation references.
//
// This was a real problem. `docs/testing/2026-09-17-ws5b-progress.md` in main
// points at `docs/superpowers/plans/2026-09-17-approval-routing-roles-privacy.md`,
// but that plan existed only on abandoned branches and was missing from main.
// Four design documents in total were orphaned that way - roughly 2,700 lines of
// design record that main referenced but did not contain.
//
// They have been recovered into docs/superpowers/. This test keeps it that way:
// any document that references another document by path must point at a file
// that actually exists.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const docsRoot = path.join(root, 'docs');

function markdownFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

// Only repo-relative document paths, so external URLs and code identifiers are ignored.
const REFERENCE = /(?<![\w/])(docs\/[A-Za-z0-9._/-]+\.md)/g;

test('every document path referenced from docs/ resolves to a real file', () => {
  const missing = [];
  for (const file of markdownFiles(docsRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(REFERENCE)) {
      const target = path.join(root, match[1]);
      if (!fs.existsSync(target)) {
        missing.push(`${path.relative(root, file)} -> ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, [], `dangling document references:\n${missing.join('\n')}`);
});

test('the design documents recovered from abandoned branches are present', () => {
  // These four lived only on transport branches while main referenced them.
  for (const name of [
    'docs/superpowers/plans/2026-09-17-approval-routing-roles-privacy.md',
    'docs/superpowers/plans/2026-09-17-workstream-5-self-review-amendments.md',
    'docs/superpowers/specs/2026-09-17-approval-routing-roles-privacy-design.md',
    'docs/superpowers/specs/2026-09-17-approval-routing-spark-finalization-addendum.md'
  ]) {
    assert.ok(fs.existsSync(path.join(root, name)), `${name} is missing`);
  }
});

test('no transport scaffolding is tracked in the repository', () => {
  // The abandoned branches carried base64 patch fragments and marker files used
  // to move large patches between branches. None of that belongs in the tree.
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(b64|part\d*|patch|gz|xz)$/.test(entry.name)
        || /^(DO_NOT_USE|STOP_TRANSPORT_PLACEHOLDERS|transport-|BRANCH_SETUP_NOTE)/.test(entry.name)) {
        offenders.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], `transport scaffolding is tracked:\n${offenders.join('\n')}`);
});
