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

// The audit ceiling applies to the original routed-approval/core rules. The DOE
// server-authority rules are a disjoint authorization domain: counting their
// helper reads together with every core helper makes the lexical total grow even
// though one Firestore request cannot traverse both rule paths. Keep separate
// growth guards, then rely on the emulator suite for the real per-request budget.
const CORE_CEILING = {
  documentReads: 265,
  existenceChecks: 60
};
const DOE_CEILING = {
  documentReads: 70,
  existenceChecks: 15
};

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}
function reads(source) {
  return count(source, /\bgetAfter\(/g) + count(source, /(?<!After)\bget\(/g);
}
function checks(source) {
  return count(source, /\bexistsAfter\(/g) + count(source, /(?<!After)\bexists\(/g);
}
function splitRuleDomains() {
  const helperStart = rules.indexOf('  function doeAdmin()');
  const helperEnd = rules.indexOf('  function swapIndexShapeValid', helperStart);
  const matchStart = rules.indexOf('  match /doe_policies/{id}');
  const matchEnd = rules.indexOf('  match /account_audit/{id}', matchStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart && matchStart > helperEnd && matchEnd > matchStart,
    'DOE/core rule-domain boundaries must remain explicit for budget review.');
  return {
    doe: rules.slice(helperStart, helperEnd) + rules.slice(matchStart, matchEnd),
    core: rules.slice(0, helperStart) + rules.slice(helperEnd, matchStart) + rules.slice(matchEnd)
  };
}

test('core document reads stay within the reviewed routed-approval budget', () => {
  const value = reads(splitRuleDomains().core);
  assert.ok(value <= CORE_CEILING.documentReads,
    `core rules now contain ${value} document reads (ceiling ${CORE_CEILING.documentReads}). ` +
    'Confirm the evaluation budget with `npm run test:emulator` before raising this.');
});

test('DOE document reads stay within their reviewed domain budget', () => {
  const value = reads(splitRuleDomains().doe);
  assert.ok(value <= DOE_CEILING.documentReads,
    `DOE rules now contain ${value} document reads (ceiling ${DOE_CEILING.documentReads}). ` +
    'Confirm the evaluation budget with `npm run test:emulator` before raising this.');
});

test('core and DOE existence checks stay within their reviewed domain budgets', () => {
  const domains = splitRuleDomains();
  const coreValue = checks(domains.core);
  const doeValue = checks(domains.doe);
  assert.ok(coreValue <= CORE_CEILING.existenceChecks,
    `core rules now contain ${coreValue} existence checks (ceiling ${CORE_CEILING.existenceChecks}).`);
  assert.ok(doeValue <= DOE_CEILING.existenceChecks,
    `DOE rules now contain ${doeValue} existence checks (ceiling ${DOE_CEILING.existenceChecks}).`);
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
