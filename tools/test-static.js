'use strict';
// Runs the dependency-free static test suite and makes skipped tests loud.
//
// Why this exists: without the Firebase emulator running, every emulator-backed
// test file reports as skipped instead of failing. A plain `npm test` therefore
// prints a green-looking result while the entire security-boundary suite silently
// does not execute. This wrapper surfaces that so a local pass is never mistaken
// for a full pass.

const {spawnSync} = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const result = spawnSync('node --test tests/*.test.js', {
  cwd: root,
  shell: true,
  encoding: 'utf8',
  // The integrated suite is large enough that a platform-dependent default
  // child-process buffer can terminate the test runner before it emits TAP
  // summary lines. Keep the wrapper loud about skipped tests without imposing
  // an accidental output-size ceiling.
  maxBuffer: 16 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'inherit']
});

const output = result.stdout || '';

const lines = output.split('\n');
const summaryStart = (() => {
  for (let i = lines.length - 1; i >= 0; i--) if (/^1\.\./.test(lines[i])) return i;
  return Math.max(0, lines.length - 20);
})();
const compactFailure = () => {
  const keep = new Set();
  const marker = /^(?:not ok\b)|ERR_ASSERTION|failureType:|error:|expected:|actual:|operator:|stack:/i;
  lines.forEach((line, index) => {
    if (!marker.test(line)) return;
    for (let i = Math.max(0, index - 12); i <= Math.min(lines.length - 1, index + 28); i++) keep.add(i);
  });
  if (!keep.size) {
    const start = Math.max(0, lines.length - 120);
    for (let i = start; i < lines.length; i++) keep.add(i);
  }
  return [...keep].sort((a,b)=>a-b).map(i=>lines[i]).join('\n');
};

const count = label => {
  const match = output.match(new RegExp('^# ' + label + ' (\\d+)$', 'm'));
  return match ? Number(match[1]) : null;
};

const passed = count('pass');
const failed = count('fail');
const skipped = count('skipped');

if (result.status !== 0 || result.error || result.signal) {
  process.stdout.write(compactFailure() + '\n');
} else {
  process.stdout.write(lines.slice(summaryStart).join('\n') + '\n');
}

if (skipped === null) {
  if (result.error) console.error('Static test runner error:', result.error);
  if (result.signal) console.error('Static test runner signal:', result.signal);
  console.error('Static test runner ended without TAP summary; exit status:', result.status);
  process.exit(result.status === null ? 1 : result.status);
}

if (skipped > 0) {
  const line = '='.repeat(72);
  process.stdout.write([
    '',
    line,
    `WARNING: ${skipped} test(s) were SKIPPED and did NOT run.`,
    '',
    'Emulator-backed tests - including the Firestore rules security-boundary',
    'suites - only execute when the emulator is running. A static run proves',
    'far less than a full run.',
    '',
    'For real coverage run:  npm run test:emulator',
    line,
    ''
  ].join('\n'));
}

if (failed !== null && failed > 0) {
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
