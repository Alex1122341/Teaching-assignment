'use strict';
// ---------------------------------------------------------------------------
// Merged domain test file.
//
// This file was assembled from several small single-purpose test files in the
// same domain. No assertion was changed: each source body is preserved verbatim
// inside its own IIFE so top-level declarations from different files cannot
// collide, and the total number of tests is unchanged.
//
// Split it back out by taking each block below to its own file if a failure ever
// needs a narrower blast radius.
// ---------------------------------------------------------------------------

// ------------------------------------------------------------------------
// merged from tests/afc-form-state.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load(){
 const context={window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','afc-form-state.js'),'utf8'),context);
 return context.window.UCVM_AFC_FORM_STATE;
}

test('vacation waits for timetable lookup and only asks for coverage when teaching exists',()=>{
 const policy=load();
 assert.deepEqual(JSON.parse(JSON.stringify(policy.fields({reason:'vacation',rangeReady:false,loading:false,sessionCount:0}))),{showPurpose:false,requirePurpose:false,showCoverage:false,requireCoverage:false,coverageMessage:''});
 assert.equal(policy.fields({reason:'vacation',rangeReady:true,loading:true,sessionCount:0}).coverageMessage,'Checking teaching assignments…');
 assert.deepEqual(JSON.parse(JSON.stringify(policy.fields({reason:'vacation',rangeReady:true,loading:false,sessionCount:0}))),{showPurpose:false,requirePurpose:false,showCoverage:false,requireCoverage:false,coverageMessage:'Coverage arrangements: None needed'});
 assert.equal(policy.fields({reason:'vacation',rangeReady:true,loading:false,sessionCount:2}).showCoverage,true);
});

test('business or other shows purpose only after a valid date range is selected',()=>{
 const policy=load();
 assert.equal(policy.fields({reason:'business_other',rangeReady:false,loading:false,sessionCount:0}).showPurpose,false);
 const ready=policy.fields({reason:'business_other',rangeReady:true,loading:false,sessionCount:0});
 assert.equal(ready.showPurpose,true);
 assert.equal(ready.requirePurpose,true);
});
})();

// ------------------------------------------------------------------------
// merged from tests/afc-form-values.test.js
// ------------------------------------------------------------------------
(() => {
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('AFC form values normalize allowlisted dropdown values and contact details', () => {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'afc-form-values.js'), 'utf8'), context);
  const api = context.window.UCVM_AFC_FORM_VALUES;

  assert.equal(api.PRIMARY_DEPARTMENT, '30060 - Faculty of Veterinary Medicine');
  assert.equal(api.rank(' Assistant Professor '), 'Assistant Professor - AC0003');
  assert.equal(api.rank('Associate Professor (Teaching)'), 'Associate Professor (Teaching) - AC0007');
  assert.equal(api.rank('Unknown'), '');
  assert.equal(api.appointment('Tenure'), 'With Tenure');
  assert.equal(api.appointment('tenure-track'), 'Tenure-track');
  assert.equal(api.appointment('unrecognized'), '');
  const contact = api.contact({contactAddress: ' 2500 University Dr ', contactPhone: ' 403-555-1212 '});
  assert.equal(contact.address, '2500 University Dr');
  assert.equal(contact.phone, '403-555-1212');
});

test('AFC PDF loader uses one lazy helper bundle with canonical values before the renderer', () => {
  const loader = fs.readFileSync(path.join(root, 'asset-loader.js'), 'utf8');
  const bundles = JSON.parse(fs.readFileSync(path.join(root, 'tools/runtime-bundles.json'), 'utf8'));
  const afc = bundles.lazyBundles.find(bundle => bundle.output === 'bundles/afc-pdf.lazy.bundle.js');
  assert.deepEqual(afc.sources, ['afc-form-values.js','afc-pdf-browser.js']);
  assert.match(loader, /loadScriptOnce\('bundles\/afc-pdf\.lazy\.bundle\.js','UCVM_AFC_PDF'\)/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'tools/static-assets.json'), 'utf8')).includes('afc-form-values.js'));
});
})();

// ------------------------------------------------------------------------
// merged from tests/afc-policy.test.js
// ------------------------------------------------------------------------
(() => {
const test = require('node:test');
const assert = require('node:assert/strict');
const {workDays, validateDraft, nextStatus, HOLIDAYS} = require('../test-support/afc-policy');
const closures=require('../university-closures');

test('workdays exclude weekends and official UCalgary closures', () => {
  assert.equal(HOLIDAYS.has('2026-09-30'), true);
  assert.equal(workDays('2026-09-28', '2026-10-02'), 4);
  assert.equal(workDays('2026-12-21', '2027-01-04'), 5);
});

test('AFC policy derives its closure dates from the shared catalog',()=>{
  assert.equal(HOLIDAYS.size,closures.entries.length);
  for(const row of closures.entries)assert.equal(HOLIDAYS.has(row.date),true,row.date);
});

test('Business or Other requires purpose and destination', () => {
  assert.throws(() => validateDraft({startDate:'2026-10-01',endDate:'2026-10-02',reason:'business_other',signatureName:'Alex Zhu',attested:true,teachingSessions:[]}), /purpose and destination/i);
});

test('teaching assignments require coverage', () => {
  assert.throws(() => validateDraft({startDate:'2026-10-01',endDate:'2026-10-02',reason:'vacation',signatureName:'Alex Zhu',attested:true,teachingSessions:[{id:'s1'}]}), /coverage/i);
});

test('AFC workflow requires report-to recommendation before final approval unless ADFA signs on behalf', () => {
  assert.equal(nextStatus('submit', {reportToUid:'ad-1'}), 'pending_report_to');
  assert.equal(nextStatus('submit', {reportToUid:''}), 'pending_admin');
  assert.equal(nextStatus('recommend', {status:'pending_report_to'}), 'pending_admin');
  assert.equal(nextStatus('approve', {status:'pending_admin'}), 'approved');
});

test('new AFC drafts require bounded contact details', () => {
  const valid = {startDate:'2026-10-01',endDate:'2026-10-02',reason:'vacation',signatureName:'Alex Zhu',attested:true,teachingSessions:[],contactAddress:'2500 University Drive NW',contactPhone:'403-555-1212'};
  assert.equal(validateDraft(valid), 2);
  assert.throws(() => validateDraft({...valid, contactAddress:' '}), /address/i);
  assert.throws(() => validateDraft({...valid, contactAddress:'a'.repeat(501)}), /address/i);
  assert.throws(() => validateDraft({...valid, contactPhone:' '}), /phone/i);
  assert.throws(() => validateDraft({...valid, contactPhone:'1'.repeat(51)}), /phone/i);
});

test('AFC requester withdrawal is terminal from either pending state', () => {
  assert.equal(nextStatus('withdraw', {status:'pending_report_to'}), 'withdrawn');
  assert.equal(nextStatus('withdraw', {status:'pending_admin'}), 'withdrawn');
  assert.throws(() => nextStatus('withdraw', {status:'approved'}), /cannot/i);
  assert.throws(() => nextStatus('approve', {status:'withdrawn'}), /cannot/i);
});
})();

// ------------------------------------------------------------------------
// merged from tests/afc-ui.test.js
// ------------------------------------------------------------------------
(() => {
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('timetable exposes the AFC request panel', () => {
  assert.match(html, /id="afc-request-btn"/);
  assert.match(html, /id="afc-panel"/);
  assert.match(html, /asset-loader\.js/);
  assert.doesNotMatch(html, /pdf-lib/);
  assert.match(html, /afc-workflow\.js/);
});

test('AFC source, single-page application, and Terms ship as distinct PDF assets', () => {
  const sourcePdf=fs.readFileSync(path.join(root,'absence-from-campus-app.pdf'));
  const application=fs.readFileSync(path.join(root,'absence-from-campus-app-v2.pdf'));
  const terms=fs.readFileSync(path.join(root,'absence-from-campus-terms.pdf'));
  for(const file of [sourcePdf,application,terms]) assert.equal(file.subarray(0,5).toString('ascii'),'%PDF-');
  assert.notDeepEqual(sourcePdf,application);
  assert.notDeepEqual(application,terms);
  assert.ok(terms.length<application.length,'Terms asset should remain smaller than the application template');
});

test('AFC UI collects dates, conditional details, terms acceptance, and electronic signature', () => {
  const source = fs.readFileSync(path.join(root, 'afc-workflow.js'), 'utf8');
  for (const field of ['startDate','endDate','reason','purposeDestination','coverage','applicantSignature','UCVM_SIGNATURE','afc-view-terms','afc-terms-accepted','termsAcceptedAt','termsVersion','termsSource']) assert.match(source, new RegExp(field));
  assert.match(source,/Open the AFC Terms & Conditions before signing/);
  assert.match(source,/AFC_TERMS_SOURCE='absence-from-campus-app\.pdf#page=2'/);
  assert.match(source,/AFC_TERMS_VIEW_ASSET='absence-from-campus-terms\.pdf'/);
  assert.match(source,/frame\.onload=\(\)=>\{termsViewed=true/);
  assert.match(source,/absence-from-campus-app\.pdf#page=2/);
  assert.match(fs.readFileSync(path.join(root, 'afc-actions.js'), 'utf8'), /pdf_chunks/);
});

test('approved AFC PDF uses the versioned single-page template and never strips pages at runtime', () => {
  const source=fs.readFileSync(path.join(root,'afc-pdf-browser.js'),'utf8');
  assert.match(source,/AFC_APPLICATION_TEMPLATE='absence-from-campus-app-v2\.pdf'/);
  assert.match(source,/pdf\.getPageCount\(\)!==1/);
  assert.match(source,/AFC application template must contain exactly one page/);
  assert.doesNotMatch(source,/removePage\(/);
});

test('AFC UI requires contact details for each new request', () => {
  const source = fs.readFileSync(path.join(root, 'afc-workflow.js'), 'utf8');
  assert.match(source, /name="contactAddress"[^>]*required[^>]*maxlength="500"/);
  assert.match(source, /name="contactPhone"[^>]*required[^>]*maxlength="50"/);
  assert.match(source, /contactAddress=String\(d\.get\('contactAddress'\)\|\|''\)\.trim\(\)/);
  assert.match(source, /contactPhone=String\(d\.get\('contactPhone'\)\|\|''\)\.trim\(\)/);
  assert.match(source, /coverage,contactAddress,contactPhone/);
  assert.match(source, /termsAccepted:true,termsVersion:AFC_TERMS_VERSION,termsSource:AFC_TERMS_SOURCE,termsAcceptedAt:stamp\(\),workDays/);
});

test('AFC teaching matches render as a vertical sorted list', () => {
  const source = fs.readFileSync(path.join(root, 'afc-workflow.js'), 'utf8');
  assert.match(source, /class="afc-teaching-list"/);
  assert.match(source, /String\(a\.date\|\|''\)\.localeCompare\(String\(b\.date\|\|''\)\)/);
  assert.match(source, /String\(a\.start\|\|''\)\.localeCompare\(String\(b\.start\|\|''\)\)/);
  assert.match(source, /String\(a\.course\|\|''\)\.localeCompare\(String\(b\.course\|\|''\)\)/);
  assert.match(source, /String\(a\.topic\|\|a\.type\|\|''\)\.localeCompare\(String\(b\.topic\|\|b\.type\|\|''\)\)/);
  assert.doesNotMatch(source, /teaching assignment\(s\) found:.*\.join/);
});

test('AFC requester can withdraw only pending requests and withdrawn has a terminal label', () => {
  const source = fs.readFileSync(path.join(root, 'afc-workflow.js'), 'utf8');
  assert.match(source, /withdrawn:'Withdrawn'/);
  assert.match(source, /requesterUid===uid\(\).*\['pending_report_to','pending_admin'\]\.includes\(r\.status\)/);
  assert.match(source, /data-afc-withdraw/);
  assert.match(source, /UCVM_AFC_ACTIONS\.withdraw/);
});
})();

// ------------------------------------------------------------------------
// merged from tests/afc-withdraw-rules.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const actions=fs.readFileSync(path.join(root,'afc-actions.js'),'utf8');
const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');

test('AFC action module exposes requester-only transactional withdrawal with audit',()=>{
 assert.match(actions,/async function withdraw\(/);
 assert.match(actions,/runTransaction/);
 assert.match(actions,/Only the requester can withdraw this AFC request/);
 assert.match(actions,/\['pending_report_to','pending_admin'\]/);
 assert.match(actions,/status:'withdrawn'/);
 assert.match(actions,/action:'afc_withdraw'/);
 assert.match(actions,/return\{decide,withdraw\}/);
});

test('Firestore rules permit only the legal requester withdrawal field set',()=>{
 assert.match(rules,/function\s+afcWithdraw\(/);
 assert.match(rules,/resource\.data\.status in \['pending_report_to','pending_admin'\]/);
 assert.match(rules,/request\.resource\.data\.status == 'withdrawn'/);
 assert.match(rules,/withdrawnBy == request\.auth\.uid/);
 assert.match(rules,/affectedKeys\(\)\.hasOnly\(\['status','withdrawnBy','withdrawnAt','updatedAt'\]\)/);
 assert.match(rules,/afc_requests[^]*allow update:[^]*afcWithdraw\(\)/);
});

test('Firestore AFC create rule requires versioned Terms & Conditions evidence',()=>{
 assert.match(rules,/termsAccepted == true/);
 assert.match(rules,/termsVersion == 'ucvm-afc-terms-page2-v1'/);
 assert.match(rules,/termsSource == 'absence-from-campus-app\.pdf#page=2'/);
 assert.match(rules,/termsAcceptedAt == request\.time/);
});
})();
