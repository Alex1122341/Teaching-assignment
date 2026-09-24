'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const review = require('../teaching-assignment-review.js');
const scheduling = require('../scheduling-core.js');

const session = (patch = {}) => ({id:'s1', course:'VTMD 506', date:'2027-09-08',
  start:'09:00', end:'10:00', type:'LEC', topic:'Pre-operative Management', ...patch});
const draft = (patch = {}) => ({academicYearKey:'2027-28', groupId:'g1', hiccUid:'h1',
  viscUid:'v1', status:'draft', revision:0, ...patch});
const hicc = (patch = {}) => ({actorUid:'h1', actorRole:'hicc', ownsPackage:true,
  sessions:[session()], suggestions:[], ...patch});
const visc = (patch = {}) => ({actorUid:'v1', actorRole:'visc', canReviewPackage:true,
  sessions:[session()], suggestions:[], ...patch});
const suggestion = (patch = {}) => ({sessionId:'s1', candidateKey:'opaque-a',
  displayName:'Faculty A', sourceRole:'hicc', ...patch});
const fingerprint = () => review.reviewFingerprint([session()], []);
const submitted = () => review.transition(draft(), 'submit', hicc());
const approved = () => review.transition(submitted(), 'approve', visc());

test('content readiness requires only scheduling content, even for LAB', () => {
  for (const type of ['LEC','SRL','LAB','Quiz/Midterm','OSCE','Exam']) {
    assert.deepEqual(review.contentReadiness(session({type, room:'', subjectKey:'', assignments:[],
      suggestions:[], labGroupIds:[], rosters:{}, contributorNote:'', doeCredit:null})), {ready:true, missing:[]});
  }
});
for (const [patch, field] of [
  [{course:''},'course'], [{date:'2027-02-30'},'date'], [{start:''},'time'],
  [{end:'09:00'},'time'], [{end:'08:00'},'time'], [{start:'25:00'},'time'],
  [{type:''},'type'], [{type:'invented'},'type'], [{topic:' \n '},'topic'], [{topic:'TBD'},'topic']
]) test(`content readiness rejects ${JSON.stringify(patch)}`, () => {
  const result = review.contentReadiness(session(patch));
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes(field));
});
test('unknown time remains canonical unknown and cannot certify review readiness', () => {
  const row = session({start:'', end:'', timeUnknown:true});
  assert.equal(scheduling.validateSessionTiming(row).status, 'unknown');
  assert.equal(review.contentReadiness(row).ready, false);
});
test('canonical scheduling accepts equivalent clock formats', () => {
  assert.equal(review.contentReadiness(session({start:'9:00 AM',end:'10:00 AM'})).ready, true);
});

test('fingerprint is deterministic across input order, object order and safe suggestion duplicates', () => {
  const s1 = session(), s2 = session({id:'s2', type:'LAB'});
  const a = suggestion(), b = suggestion({sessionId:'s2',candidateKey:'opaque-b',displayName:'Faculty B'});
  const expected = review.reviewFingerprint([s1,s2],[a,b]);
  assert.equal(review.reviewFingerprint([s2,{...s1}],[b,a,a]), expected);
  assert.equal(review.reviewFingerprint([Object.fromEntries(Object.entries(s1).reverse()),s2],[a,b]), expected);
  assert.equal(review.reviewFingerprint([session({start:'9:00 AM'}),s2],[a,b]), expected);
});
for (const [field,value] of Object.entries({id:'s2',course:'VTMD 507',subjectKey:'surgery',
  date:'2027-09-09',start:'09:15',end:'10:15',type:'LAB',room:'A100',topic:'New Topic'})) {
  test(`${field} invalidates the reviewed fingerprint`, () => {
    assert.notEqual(review.reviewFingerprint([session({[field]:value})],[]), fingerprint());
  });
}
test('included sessions and safe Faculty suggestions are review-relevant', () => {
  assert.notEqual(review.reviewFingerprint([session(),session({id:'s2'})],[]), fingerprint());
  const base = review.reviewFingerprint([session()],[suggestion()]);
  assert.notEqual(base, fingerprint());
  for (const patch of [{candidateKey:'opaque-b'},{displayName:'Renamed Faculty'},{sourceRole:'adc'}]) {
    assert.notEqual(review.reviewFingerprint([session()],[suggestion(patch)]), base);
  }
});
test('review fingerprint requires explicit safe suggestion provenance', () => {
  const missingSource = {sessionId:'s1',candidateKey:'opaque-a',displayName:'Faculty A'};
  assert.throws(() => review.reviewFingerprint([session()],[missingSource]), /source role|suggestions require/i);
  for (const sourceRole of ['adc','lab','hicc']) {
    assert.doesNotThrow(() => review.reviewFingerprint([session()],[suggestion({sourceRole})]));
  }
});

test('private and volatile fields never enter a fingerprint', () => {
  const privateData = {contributorNote:'PRIVATE NOTE',viscReviewComment:'PRIVATE REVIEW',
    studentIds:['SECRET STUDENT'],labGroupIds:['group'],rosters:{group:['student']},
    doeCredit:99,afcReason:'SECRET AFC',hr:{salary:123},updatedAt:'later',selected:true,
    facultyIds:['PRIVATE FACULTY'],assignments:[{ucid:'PRIVATE UCID'}]};
  assert.equal(review.reviewFingerprint([session(privateData)],[]), fingerprint());
  const result = review.reviewFingerprint([session(privateData)],[suggestion(privateData)]);
  assert.equal(result, review.reviewFingerprint([session()],[suggestion()]));
  assert.doesNotMatch(result,/PRIVATE|SECRET|salary|studentIds|doeCredit/);
});
test('malformed, ambiguous session identities and private-ID-only suggestions fail closed', () => {
  for (const rows of [[],[session({id:''})],[session(),session()],[null]]) {
    assert.throws(() => review.reviewFingerprint(rows,[]));
    assert.equal(review.canSubmitForViscReview(draft(),rows,hicc()), false);
  }
  for (const suggestions of [[{sessionId:'s1',ucid:'private-id',name:'Faculty'}],
    [suggestion({sessionId:'not-in-package'})],[suggestion({candidateKey:''})]]) {
    assert.throws(() => review.reviewFingerprint([session()],suggestions));
  }
});

test('HICC submits its own ready package and pins its first revision', () => {
  assert.equal(review.canSubmitForViscReview(draft(),[session()],hicc()), true);
  const result = submitted();
  assert.equal(result.status,'visc_review');
  assert.equal(result.revision,1);
  assert.equal(result.reviewFingerprint,fingerprint());
  assert.equal(result.workingRevision,0);
  assert.equal(result.submittedWorkingRevision,0);
  assert.equal(result.viscApprovedWorkingRevision,null);
  assert.equal(result.viscApprovedFingerprint,'');
  assert.equal(draft().status,'draft');
});
test('package ownership is explicit and cannot come from role alone', () => {
  for (const ctx of [hicc({actorUid:'h2'}),hicc({ownsPackage:false}),
    hicc({ownsPackage:undefined}),visc(),{}]) {
    assert.equal(review.canSubmitForViscReview(draft(),[session()],ctx),false);
    assert.throws(() => review.transition(draft(),'submit',ctx));
  }
  assert.equal(review.canSubmitForViscReview(draft({hiccUid:'h2'}),[session()],hicc()),false);
});
test('VISC approval requires explicit authority and the submitted current fingerprint', () => {
  const record = submitted();
  assert.equal(review.canViscApprove(record,fingerprint(),visc()),true);
  for (const ctx of [hicc(),visc({canReviewPackage:false}),visc({actorUid:'v2'}),
    visc({canReviewPackage:undefined,academicScopeTokens:['hicc|VTMD 506|*']})]) {
    assert.equal(review.canViscApprove(record,fingerprint(),ctx),false);
  }
  assert.equal(review.canViscApprove(record,review.reviewFingerprint([session({room:'A100'})],[]),visc()),false);
  const result = approved();
  assert.equal(result.status,'visc_approved');
  assert.equal(result.viscApprovedFingerprint,fingerprint());
  assert.equal(result.viscApprovedWorkingRevision,0);
  assert.equal(result.revision,1);
});
test('VISC Push Back requires a bounded nonblank comment and explicit resubmission', () => {
  for (const comment of ['', ' \n ', 'x'.repeat(2001)]) {
    assert.throws(() => review.transition(submitted(),'push_back',visc({comment})));
  }
  const pushed = review.transition(submitted(),'push_back',visc({comment:'Clarify Topic'}));
  assert.equal(pushed.status,'changes_requested');
  assert.equal(pushed.viscReviewComment,'Clarify Topic');
  assert.throws(() => review.transition(pushed,'approve',visc()));
  assert.throws(() => review.transition(pushed,'final_submit',hicc()));
  const revised = session({topic:'Revised Topic'});
  const resubmitted = review.transition(pushed,'submit',hicc({sessions:[revised]}));
  assert.equal(resubmitted.status,'visc_review');
  assert.equal(resubmitted.revision,2);
  assert.equal(resubmitted.viscApprovedFingerprint,'');
  assert.equal(resubmitted.reviewFingerprint,review.reviewFingerprint([revised],[]));
});
test('workingRevision makes a prior VISC approval stale even when the browser fingerprint is replayed', () => {
  const record = approved();
  const edited = {...record,workingRevision:record.workingRevision + 1};
  assert.equal(edited.reviewFingerprint,record.reviewFingerprint);
  assert.equal(edited.viscApprovedFingerprint,record.viscApprovedFingerprint);
  assert.equal(review.canHiccFinalSubmit(edited,fingerprint(),hicc()),false);
  assert.throws(()=>review.transition(edited,'final_submit',hicc()));
  const resubmitted=review.transition(edited,'submit',hicc());
  assert.equal(resubmitted.status,'visc_review');
  assert.equal(resubmitted.revision,2);
  assert.equal(resubmitted.submittedWorkingRevision,1);
  assert.equal(resubmitted.viscApprovedWorkingRevision,null);
  const reapproved=review.transition(resubmitted,'approve',visc());
  assert.equal(reapproved.viscApprovedWorkingRevision,1);
  assert.equal(review.canHiccFinalSubmit(reapproved,fingerprint(),hicc()),true);
});

test('missing or null VISC approved generation never certifies final submit',()=>{
  const record=approved();
  for(const value of [null,undefined,-1,1]){
    const candidate={...record,viscApprovedWorkingRevision:value};
    if(value===undefined)delete candidate.viscApprovedWorkingRevision;
    assert.equal(review.canHiccFinalSubmit(candidate,fingerprint(),hicc()),false);
  }
});

test('HICC final submission needs exact approval and current ready content', () => {
  const record = approved();
  assert.equal(review.canHiccFinalSubmit(record,fingerprint(),hicc()),true);
  assert.equal(review.canHiccFinalSubmit(record,fingerprint(),hicc({sessions:undefined})),false);
  assert.equal(review.canHiccFinalSubmit(record,fingerprint(),hicc({sessions:[session({topic:''})]})),false);
  assert.equal(review.canHiccFinalSubmit(record,fingerprint(),hicc({actorUid:'h2'})),false);
  assert.equal(review.canHiccFinalSubmit(record,fingerprint(),visc()),false);
  const final = review.transition(record,'final_submit',hicc());
  assert.equal(final.status,'submitted_to_adfad');
  assert.equal(review.canEnterAdfadQueue(final,[session()]),true);
  for (const unsubmitted of [draft(),submitted(),record]) {
    assert.equal(review.canEnterAdfadQueue(unsubmitted,[session()]),false);
  }
});
test('blank room allows review but a later Room edit invalidates approval and queue eligibility', () => {
  const record = approved(), rows = [session({room:'A100'})];
  const current = review.reviewFingerprint(rows,[]);
  assert.equal(review.contentReadiness(rows[0]).ready,true);
  assert.equal(review.canHiccFinalSubmit(record,current,hicc({sessions:rows})),false);
  assert.equal(review.canHiccFinalSubmit(record,fingerprint(),hicc({sessions:rows})),false);
  assert.throws(() => review.transition(record,'final_submit',hicc({sessions:rows})));
  const final = review.transition(record,'final_submit',hicc());
  assert.equal(review.canEnterAdfadQueue(final,rows),false);
});
test('stale approval requires an explicit HICC resubmission before VISC can approve again', () => {
  const record = approved(), rows = [session({room:'A100'})];
  assert.throws(() => review.transition(record,'approve',visc({sessions:rows})));
  const renewed = review.transition(record,'submit',hicc({sessions:rows}));
  assert.equal(renewed.status,'visc_review');
  assert.equal(renewed.revision,2);
  assert.equal(renewed.viscApprovedFingerprint,'');
  assert.throws(() => review.transition(record,'submit',hicc()));
});
test('denied lifecycle transitions cannot bypass review or finalize ADFAD work', () => {
  for (const [record,action,ctx] of [[draft(),'approve',visc()],[draft(),'final_submit',hicc()],
    [submitted(),'final_submit',hicc()],[submitted(),'approve',hicc()],
    [submitted(),'push_back',hicc({comment:'reason'})],[approved(),'final_submit',visc()],
    [draft(),'adfad_finalize',hicc()],[draft({status:'adfad_finalized'}),'submit',hicc()]]) {
    assert.throws(() => review.transition(record,action,ctx));
  }
});
test('pure transitions leave inputs unchanged and do not implement persistence or other workflows', () => {
  const record = Object.freeze(draft()), rows = Object.freeze([Object.freeze(session())]);
  const result = review.transition(record,'submit',hicc({sessions:rows}));
  assert.equal(record.status,'draft');
  assert.equal(result.status,'visc_review');
  const source = fs.readFileSync(path.join(__dirname,'../teaching-assignment-review.js'),'utf8');
  assert.doesNotMatch(source,/change_requests|change_request_workflow|change_request_approvals|session_assignment_contributions|doe_recalculation_requests|timetable_publications|firebase|fetch\(|Date\.now|Math\.random/);
});
test('browser and Node produce the same fingerprint without Node crypto', () => {
  const context = {window:{}};
  for (const file of ['scheduling-core.js','teaching-assignment-review.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  }
  assert.equal(context.window.UCVM_TEACHING_ASSIGNMENT_REVIEW.reviewFingerprint([session()],[]),fingerprint());
});
