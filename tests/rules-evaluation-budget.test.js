'use strict';
// Guards the rule evaluation budget recorded as audit finding F11.
//
// The emulator logs showed Firestore refusing to evaluate a write because the
// rule set exceeded its 1000-expression ceiling:
//
//   Unable to evaluate the expression as the maximum of 1000 expressions to
//   evaluate has been reached. for 'update' @ L425
//
// Every get() / getAfter() / exists() / existsAfter() call consumes budget, and
// the routed-approval path chains many of them. Adding companion-write proofs
// increases that cost, so the budget needs an explicit ceiling rather than being
// discovered in production as a rejected write.
//
// This test does not prove the budget is fine - only the emulator can do that.
// It exists to force a review when the call count grows.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rules = fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8');

// Ceilings are the measured baseline at the time of the audit, with a small
// headroom. Raising them is a deliberate act that should be justified by an
// emulator run, not a silent edit.
//
// Baseline measured after the F4 companion-write proof was added.
const CEILING = {
  documentReads: 265,   // get( and getAfter(
  existenceChecks: 60   // exists( and existsAfter(
};

function count(pattern) {
  return (rules.match(pattern) || []).length;
}

test('document reads in the rules stay within the reviewed budget', () => {
  const reads = count(/\bgetAfter\(/g) + count(/(?<!After)\bget\(/g);
  assert.ok(reads <= CEILING.documentReads,
    `rules now make ${reads} document reads (ceiling ${CEILING.documentReads}). ` +
    'Confirm the evaluation budget with `npm run test:emulator` before raising this.');
});

test('existence checks in the rules stay within the reviewed budget', () => {
  const checks = count(/\bexistsAfter\(/g) + count(/(?<!After)\bexists\(/g);
  assert.ok(checks <= CEILING.existenceChecks,
    `rules now make ${checks} existence checks (ceiling ${CEILING.existenceChecks}). ` +
    'Confirm the evaluation budget with `npm run test:emulator` before raising this.');
});

test('the routed approval path still proves its companion writes', () => {
  // These are the guarantees that make an approval meaningful. They must not be
  // removed to save evaluation budget.
  assert.match(rules, /function allRequiredApproved\(id,workflow\)/);
  assert.match(rules, /function requiredApprovalMatches\(id,workflow,office\)/);
  assert.match(rules, /function routedSessionApplyFor\(id,rid\)/);
  assert.match(rules, /function legacyAppliedCompanionWrite\(\)/);
  assert.match(rules, /function calendarMatchesSourceAfter\(id\)/);
});

test('the rule set still denies by default', () => {
  assert.match(rules, /match \/\{document=\*\*\} \{allow read,write: if false;\}/);
});
