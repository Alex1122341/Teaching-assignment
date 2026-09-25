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
  // 265 -> 267: approvalOrderSatisfied() adds two getAfter() reads (the earlier
  // ADC and LAB approval documents) so an approval write is rejected unless the
  // preceding applicable stages have already approved. Those reads are only
  // reached on the approve branch, and the serial-order emulator suite
  // (tests/approval-order-security-emulator.test.js) confirms the routed
  // approval path still commits inside the budget.
  documentReads: 267,
  existenceChecks: 60
};
const DOE_CEILING = {
  documentReads: 70,
  existenceChecks: 15
};
const TEACHING_ASSIGNMENT_CEILING = {
  // Separate from routed approvals and DOE: responsibility lookup is its own
  // authorization domain and must not consume either established ceiling.
  documentReads: 7,
  existenceChecks: 1
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
  const doeHelperStart = rules.indexOf('  function doeAdmin()');
  const taHelperStart = rules.indexOf('  function taCanonicalId', doeHelperStart);
  const taHelperEnd = rules.indexOf('  function swapIndexShapeValid', taHelperStart);
  const taMatchStart = rules.indexOf('  match /teaching_assignment_groups/{id}');
  const taMatchEnd = rules.indexOf('  match /faculty_groups/{id}', taMatchStart);
  const doeMatchStart = rules.indexOf('  match /doe_policies/{id}');
  const doeMatchEnd = rules.indexOf('  match /account_audit/{id}', doeMatchStart);
  assert.ok(doeHelperStart >= 0 && taHelperStart > doeHelperStart && taHelperEnd > taHelperStart &&
    taMatchStart > taHelperEnd && taMatchEnd > taMatchStart && doeMatchStart > taMatchEnd && doeMatchEnd > doeMatchStart,
    'Core/Teaching Assignment/DOE rule-domain boundaries must remain explicit for budget review.');
  return {
    doe: rules.slice(doeHelperStart, taHelperStart) + rules.slice(doeMatchStart, doeMatchEnd),
    teachingAssignment: rules.slice(taHelperStart, taHelperEnd) + rules.slice(taMatchStart, taMatchEnd),
    core: rules.slice(0, doeHelperStart) + rules.slice(taHelperEnd, taMatchStart) +
      rules.slice(taMatchEnd, doeMatchStart) + rules.slice(doeMatchEnd)
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

test('Teaching Assignment responsibility lookups stay within their own reviewed budget', () => {
  const domain = splitRuleDomains().teachingAssignment;
  const readValue = reads(domain), checkValue = checks(domain);
  assert.ok(readValue <= TEACHING_ASSIGNMENT_CEILING.documentReads,
    `Teaching Assignment rules now contain ${readValue} document reads (ceiling ${TEACHING_ASSIGNMENT_CEILING.documentReads}).`);
  assert.ok(checkValue <= TEACHING_ASSIGNMENT_CEILING.existenceChecks,
    `Teaching Assignment rules now contain ${checkValue} existence checks (ceiling ${TEACHING_ASSIGNMENT_CEILING.existenceChecks}).`);
});

test('the routed approval path still proves its companion writes', () => {
  // These are the guarantees that make an approval meaningful. Scope/signature
  // integrity is proven when approval records are created/resubmitted; final apply
  // then checks the already-locked records' approved status. Do not remove those
  // proofs merely to save evaluation budget.
  assert.match(rules, /function allRequiredApproved\(id,workflow\)/);
  assert.match(rules, /function approvalMatchesWorkflow\(id,d,workflow\)/);
  assert.match(rules, /validRoutedApprovalCreate\(id\)[^]*approvalMatchesWorkflow|validRoutedApprovalResubmitCreate\(id\)[^]*approvalMatchesWorkflow/);
  assert.match(rules, /function routedSessionApplyFor\(id,rid\)/);
  assert.match(rules, /function legacyAppliedCompanionWrite\(\)/);
  assert.match(rules, /function calendarMatchesSourceAfter\(id\)/);
});

test('the rule set still denies by default', () => {
  assert.match(rules, /match \/\{document=\*\*\} \{allow read,write: if false;\}/);
});
