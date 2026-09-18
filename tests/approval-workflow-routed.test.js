'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=()=>fs.readFileSync(path.join(root,'approval-workflow.js'),'utf8');

test('workflow distinguishes office approvers from ADFA private approvers',()=>{
 const s=source();
 assert.match(s,/officeForRole/);
 assert.match(s,/isOfficeApprover/);
 assert.match(s,/isAdfaApprover/);
 assert.match(s,/change_request_approvals/);
});

test('ADC and LAB queues are driven by their office approval records rather than broad public request reads',()=>{
 const s=source();
 assert.match(s,/where\('office','==',office\(\)\)/);
 assert.match(s,/officeView\.queueLabel/);
});

test('routed decisions and withdrawal use guarded Firestore transactions',()=>{
 const s=source();
 assert.match(s,/runTransaction/);
 assert.match(s,/lifecycle\.planDecision/);
 assert.match(s,/lifecycle\.planRequesterWithdrawal/);
});

test('faculty-changing routed finalization keeps the migration marker and ADFA-only gate',()=>{
 const s=source();
 assert.match(s,/UCVM_DB_MIGRATION_REVISIT: spark-client-finalizer/);
 assert.match(s,/hasFacultyChange/);
 assert.match(s,/ADFA must complete a request that changes Faculty assignment/);
});

test('routed final apply writes source, sanitized calendar, audit and applied revision',()=>{
 const s=source();
 assert.match(s,/calendar_sessions/);
 assert.match(s,/change_request_audit/);
 assert.match(s,/appliedRevision/);
 assert.match(s,/UCVM_APPROVAL_FINALIZER/);
});

test('Faculty replacement resubmission uses the privacy-safe swap index and writes only an opaque private target',()=>{
 const s=source();
 assert.match(s,/faculty_swap_index/);
 assert.match(s,/facultyEditFromChoice/);
 assert.match(s,/assignmentChange\.to/);
 assert.match(s,/tx\.update\(privateRef/);
});

test('requester withdraw and resubmit never read internal workflow approval or private documents',()=>{
 const s=source();
 const withdraw=s.slice(s.indexOf('async function withdrawRoutedRequest'),s.indexOf('function editInput'));
 const resubmit=s.slice(s.indexOf('async function resubmitRoutedRequest'),s.indexOf('async function resolveRoutedReplacement'));
 assert.match(withdraw,/planRequesterWithdrawal/);
 assert.doesNotMatch(withdraw,/readRoutedBundleTx/);
 assert.match(resubmit,/planRequesterResubmission/);
 assert.doesNotMatch(resubmit,/readRoutedBundleTx/);
 assert.match(resubmit,/facultyScopeSignature/);
});

test('routed final apply stamps source provenance so rules can bind the write to the approved request',()=>{
 const s=source();
 assert.match(s,/approvalRequestId:id/);
 assert.match(s,/approvalRevision:bundle\.request\.revision/);
});

test('Faculty replacement resubmission carries a requester-safe reason for Sessional or Other choices',()=>{
 const s=source();
 assert.match(s,/facultyReason/);
 assert.match(s,/reason:facultyReason/);
});

test('routed ADFA impact hydration reads private assignment context only behind the ADFA gate',()=>{
 const s=source();
 assert.match(s,/function routedSwapImpactHtml/);
 assert.match(s,/async function hydrateApprovalImpacts\(\)\{\s*if\(!isAdfaApprover\(\)\)return/);
 assert.match(s,/PRIVATE_REQUESTS/);
 assert.match(s,/resolveRoutedReplacement\(privateRecord,r\)/);
 assert.match(s,/r\.patchPublic\|\|r\.patch\|\|\{\}/);
});
