'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');

test('routed approval collections have explicit privacy boundaries',()=>{
  assert.match(rules,/function\s+routedRequest\(/);
  assert.match(rules,/match \/change_request_workflow\/\{id\}/);
  assert.match(rules,/match \/change_request_approvals\/\{id\}/);
  assert.match(rules,/match \/change_request_private\/\{id\}/);
  assert.match(rules,/match \/change_request_audit\/\{id\}/);
  assert.match(rules,/change_request_private[^]*allow read:\s*if\s+adfaApprover\(\)/);
  assert.match(rules,/change_request_workflow[^]*allow read:\s*if\s+officeWorkflowRead\(id\)/);
});

test('public routed requests are allowlisted and legacy private-shaped requests stay ADFA-only',()=>{
  assert.match(rules,/function\s+publicRequestKeysValid\(/);
  assert.match(rules,/requestSchema.*office-routing-v1/);
  assert.match(rules,/function\s+routedRequestRead\(id,d\)/);
  assert.match(rules,/legacyRequestRead\(d\)/);
  assert.match(rules,/publicSessionMapValid\(d\.basePublic\)/);
  assert.match(rules,/publicSessionMapValid\(d\.patchPublic\)/);
});

test('routed lifecycle rules pin office decisions requester transitions private resubmission and final apply',()=>{
  for(const helper of ['validRoutedOfficeDecision','validRoutedRequesterWithdraw','validRoutedRequesterResubmit','validRoutedPrivateResubmit','validRoutedApply'])assert.match(rules,new RegExp(`function\\s+${helper}\\(`),helper);
  assert.match(rules,/function\s+validRoutedRequestUpdate\(/);
  assert.match(rules,/function\s+validRoutedRequesterUpdate\(/);
  assert.match(rules,/function\s+validRoutedOfficeUpdate\(/);
  assert.match(rules,/change_requests[^]*allow update:[^]*routedRequest\(resource\.data\)[^]*validRoutedRequestUpdate\(id\)[^]*validRequestDecision\(\)/);
  assert.match(rules,/change_request_approvals[^]*allow update:[^]*validRoutedOfficeDecision\(id\)/);
  assert.match(rules,/change_request_private[^]*allow update:[^]*validRoutedPrivateResubmit\(id\)/);
});

test('routed public request schema allows terminal and applied metadata but keeps it allowlisted',()=>{
  assert.match(rules,/publicRequestKeysValid[^]*withdrawnBy[^]*withdrawnAt[^]*appliedRevision[^]*appliedAt/);
  assert.match(rules,/status in \['pending','update_required','approved','rejected','withdrawn'\]/);
});

test('non-ADFA final apply is bound to a deterministic request marker on the source session',()=>{
  assert.match(rules,/function\s+routedSessionApply\(id\)/);
  assert.match(rules,/approvalRequestId/);
  assert.match(rules,/approvalRevision/);
  assert.match(rules,/match \/sessions\/\{id\}[^]*routedSessionApply\(id\)/);
});
