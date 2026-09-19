'use strict';
// Prevents the emulator flakiness recorded as audit finding F8.
//
// Two emulator test files that share a Firebase project id share emulator state:
// whichever runs first leaves documents behind, and the other can then pass or
// fail depending on ordering. That is exactly what was observed - a security
// suite failed all cases in isolation but passed when run after other files.
//
// A flaky *security* test is worse than no test, because a green run stops being
// evidence. This guard makes the isolation requirement explicit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const testsDir = path.join(root, 'tests');

// Guard files that inspect the suite rather than exercising the emulator.
const GUARDS = new Set(['emulator-isolation.test.js']);

function emulatorTestFiles() {
  return fs.readdirSync(testsDir)
    .filter(name => !GUARDS.has(name))
    .filter(name => /emulator.*\.test\.js$|security-emulator.*\.test\.js$/.test(name))
    .sort();
}

function projectIdOf(source) {
  const match = source.match(/projectId:\s*'([^']+)'/) || source.match(/PROJECT_ID\s*=\s*'([^']+)'/);
  return match ? match[1] : null;
}

test('every emulator test file declares its own project id', () => {
  const files = emulatorTestFiles();
  assert.ok(files.length >= 10, `expected the emulator suite to be substantial, found ${files.length} files`);
  for (const file of files) {
    const id = projectIdOf(fs.readFileSync(path.join(testsDir, file), 'utf8'));
    assert.ok(id, `${file} does not declare a projectId, so it cannot be isolated`);
  }
});

test('no two emulator test files share a project id', () => {
  const seen = new Map();
  const collisions = [];
  for (const file of emulatorTestFiles()) {
    const id = projectIdOf(fs.readFileSync(path.join(testsDir, file), 'utf8'));
    if (!id) continue;
    if (seen.has(id)) collisions.push(`${id}: ${seen.get(id)} and ${file}`);
    else seen.set(id, file);
  }
  assert.deepEqual(collisions, [], `emulator project id collisions:\n${collisions.join('\n')}`);
});

test('emulator test files clear Firestore before seeding', () => {
  for (const file of emulatorTestFiles()) {
    const source = fs.readFileSync(path.join(testsDir, file), 'utf8');
    if (!/withSecurityRulesDisabled/.test(source)) continue; // nothing seeded
    assert.match(source, /clearFirestore\(\)/, `${file} seeds state without clearing Firestore first`);
  }
});

test('the emulator suite runs test files serially', () => {
  // clearFirestore() clears the whole emulator, not one project namespace. When
  // node:test runs files in parallel, one file's clear() wipes another file's
  // fixtures mid-test, which is the actual root cause of the flakiness. Serial
  // execution is the fix, so the flag is asserted rather than assumed.
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['test:emulator'], /--test-concurrency=1/,
    'test:emulator must run with --test-concurrency=1; clearFirestore() is not project-scoped');
});

test('emulator test files skip cleanly when the emulator is absent', () => {
  for (const file of emulatorTestFiles()) {
    const source = fs.readFileSync(path.join(testsDir, file), 'utf8');
    assert.match(source, /FIRESTORE_EMULATOR_HOST/, `${file} does not guard on FIRESTORE_EMULATOR_HOST`);
  }
});
