# DOE Policy Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace scattered and hard-coded DOE logic with a versioned, storage-agnostic policy engine and Faculty Dashboard DOE Rules administration workflow that can later move from Firestore to Azure SQL without redesigning the calculation layer.

**Architecture:** Build a pure safe-formula parser and DOE policy engine first, put persistence behind a repository contract, then add the Faculty Dashboard DOE Rules UI and lifecycle service. Seed 2026-27 from current behavior with explicit exceptions, prove parity, then cut Timetable and Faculty Dashboard over to the canonical engine while preserving historical calculation provenance.

**Tech Stack:** Browser JavaScript plus CommonJS-compatible UMD modules, Firebase Auth and Firestore compat SDK, Firebase Emulator Suite, Node node:test, GitHub Pages test site, Azure Static Web Apps build pipeline.

**Spec:** docs/superpowers/specs/2026-09-18-doe-policy-engine-design.md

## Global Constraints

- Policies are versioned by Academic Year plus Policy Version.
- Lifecycle is exactly draft, active, archived.
- Published versions are immutable; edits require a new Draft version.
- ADFA Regular may create/edit Drafts, Validate, and run Impact Preview.
- Only ADFA General / Owner may Publish, Archive Active policy, or Recalculate.
- Publish requires successful current Validation plus Impact Preview for the exact Draft revision, policy checksum, and input dataset checksum.
- Any Draft mutation invalidates prior preview evidence.
- Advanced Formula is a restricted DSL. Never use eval, Function, dynamic import, arbitrary property access, DOM/browser/Firebase/network access, or arbitrary function invocation.
- Missing or invalid required input fails closed; never silently convert it to zero.
- Policy Exceptions require reason and source reference and take precedence over generic rules.
- DOE-relevant session changes recalculate with the current Active policy for that Academic Year. Non-DOE changes retain historical DOE and policy version.
- Historical calculation records preserve rule, input, and parameter snapshots.
- Existing operational/prorated/source-reconciled 2026-27 values become Exceptions when no defensible general formula exists.
- Firestore is accessed only through the repository boundary so a future Azure SQL repository can replace it.
- No Cloud Functions.
- No production deployment is authorized by this plan.
- Workflow remains feature branch -> TDD -> Test CI -> Firebase emulator -> GitHub Pages test site -> manual acceptance -> explicit merge authorization -> main verification -> separate production authorization.

---

## File Structure

### New runtime modules

- doe-formula.js — safe tokenization, parsing, AST validation, evaluation.
- doe-policy-engine.js — rule validation, matching, calculation, target calculation, DOE-relevant change detection.
- doe-policy-repository.js — persistence-neutral contract and domain normalization.
- doe-policy-firestore.js — Firestore implementation of the contract.
- doe-policy-service.js — Draft lifecycle, validation, preview, publication, calculation records, recalculation.
- doe-policy-admin.js — Faculty Dashboard DOE Rules UI.
- doe-policy-admin.css — DOE Rules UI styling.

### New tests

- tests/doe-formula.test.js
- tests/doe-policy-engine.test.js
- tests/doe-policy-repository.test.js
- tests/doe-policy-security-emulator.test.js
- tests/doe-policy-admin.test.js
- tests/doe-policy-preview.test.js
- tests/doe-policy-publication.test.js
- tests/doe-policy-migration.test.js
- tests/doe-policy-timetable-integration.test.js
- tests/doe-policy-recalculate.test.js

### Existing files expected to change

- faculty-admin.html
- faculty-admin.js
- faculty-admin-enhancements.js
- faculty-doe.js
- timetable.js
- timetable-selection.js
- data-index.js
- index-maintenance.js
- firestore.rules
- tools/static-assets.json
- tests/runtime-assets.test.js
- existing timetable/faculty/emulator tests where canonical behavior changes

---

### Task 1: Safe Advanced Formula DSL

**Files:**
- Create: doe-formula.js
- Create: tests/doe-formula.test.js

**Interfaces:**
- Produces UCVM_DOE_FORMULA.parse(source)
- Produces UCVM_DOE_FORMULA.validate(source,{allowedIdentifiers})
- Produces UCVM_DOE_FORMULA.evaluate(sourceOrAst,scope)
- Typed errors include FORMULA_PARSE_ERROR, FORMULA_IDENTIFIER_NOT_ALLOWED, FORMULA_FUNCTION_NOT_ALLOWED, FORMULA_DIVIDE_BY_ZERO, OUTPUT_NON_FINITE.

- [x] **Step 1: Write the failing tests**

~~~js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const FORMULA=require('../doe-formula.js');

test('evaluates allowed DOE expressions deterministically',()=>{
  assert.equal(FORMULA.evaluate('hours * rate',{hours:6,rate:.30}),1.8);
  assert.equal(FORMULA.evaluate('min(trainees * rate, cap)',{trainees:12,rate:.5,cap:4}),4);
  assert.equal(FORMULA.evaluate('trainees <= 2 ? trainees * .5 : 1 + (trainees - 2) * .25',{trainees:4}),1.5);
});

test('rejects identifiers outside the declared DOE inputs and parameters',()=>{
  assert.throws(
    ()=>FORMULA.validate('hours * hiddenRate',{allowedIdentifiers:['hours','rate']}),
    error=>error.code==='FORMULA_IDENTIFIER_NOT_ALLOWED'
  );
});

test('rejects executable JavaScript and property traversal',()=>{
  for(const source of [
    'window.alert(1)',
    'firebase.firestore()',
    'constructor.constructor("return 1")()',
    'faculty.__proto__',
    'Math.max(hours,1)',
    'hours = 10'
  ]) assert.throws(()=>FORMULA.validate(source,{allowedIdentifiers:['hours']}));
});

test('fails closed on divide by zero',()=>{
  assert.throws(
    ()=>FORMULA.evaluate('hours / divisor',{hours:2,divisor:0}),
    error=>error.code==='FORMULA_DIVIDE_BY_ZERO'
  );
});
~~~

- [x] **Step 2: Run RED**

~~~bash
node --test tests/doe-formula.test.js
~~~

Expected: FAIL because doe-formula.js does not exist.

- [x] **Step 3: Implement a recursive-descent parser**

The AST is restricted to these node types:

~~~js
{type:'number',value:0.3}
{type:'identifier',name:'hours'}
{type:'binary',operator:'*',left,right}
{type:'unary',operator:'-',argument}
{type:'conditional',test,consequent,alternate}
{type:'call',name:'min',args:[]}
~~~

Allowed functions:

~~~js
const SAFE_FUNCTIONS=Object.freeze({
  min:Math.min,
  max:Math.max,
  round:Math.round,
  floor:Math.floor,
  ceil:Math.ceil,
  abs:Math.abs
});
~~~

Do not implement strings, member access, brackets, assignment, loops, object construction, or function declarations.

- [x] **Step 4: Implement identifier validation and evaluation**

Validation walks the AST and rejects every identifier not present in allowedIdentifiers. Evaluation resolves values only from the supplied scope and rejects non-finite values.

- [x] **Step 5: Run GREEN**

~~~bash
node --test tests/doe-formula.test.js
npm test
~~~

Expected: PASS.

- [x] **Step 6: Commit**

~~~bash
git add doe-formula.js tests/doe-formula.test.js
git commit -m "feat: add safe DOE formula engine"
~~~


**Task 1 verification:** exact branch head `887f816e7193d35e61854ababddb911f42875c7c` — Test #216 `Run static and unit tests` completed successfully. The formula module remains UMD/CommonJS-compatible and exposes `parse`, `validate`, and `evaluate` with typed fail-closed errors.

---

### Task 2: Pure DOE Policy Engine

**Files:**
- Create: doe-policy-engine.js
- Create: tests/doe-policy-engine.test.js
- Modify: faculty-doe.js
- Modify: tests/faculty-doe.test.js

**Interfaces:**
- Consumes UCVM_DOE_FORMULA.
- Produces validatePolicy(bundle).
- Produces matchRule(bundle,context).
- Produces calculate(bundle,context).
- Produces calculateTarget(bundle,facultyContext).
- Produces isDoeRelevantChange(before,after,ruleInputs).

Expected calculation result shape:

~~~js
{
  ok:true,
  academicYear:'2027-28',
  policyVersionId:'ucvm-workload-2027-28-v2',
  ruleId:'rule-lecture',
  ruleKey:'teaching.lecture.standard',
  source:'rule',
  inputs:{hours:6},
  parameters:{rate:.30},
  ruleSnapshot:{calculationMode:'per_hour',formulaText:'hours * rate'},
  resultDoe:1.8
}
~~~

- [ ] **Step 1: Write failing engine tests**

~~~js
const bundle={
  version:{policyVersionId:'ucvm-workload-2027-28-v2',academicYear:'2027-28',status:'active'},
  rules:[{
    ruleId:'r1',
    ruleKey:'teaching.lecture.standard',
    category:'teaching',
    calculationMode:'per_hour',
    resultKind:'credit',
    priority:100,
    enabled:true,
    selectors:[{field:'activityType',operator:'equals',valueText:'LEC'}],
    inputs:[{inputName:'hours',required:true}],
    parameters:[{name:'rate',valueNumber:.30}]
  }],
  exceptions:[]
};
assert.equal(ENGINE.calculate(bundle,{academicYear:'2027-28',activityType:'LEC',hours:6}).resultDoe,1.8);
~~~

Also prove:
- exact Exception beats generic rule;
- same-priority matches return RULE_AMBIGUOUS;
- missing required input returns INPUT_MISSING;
- no match returns RULE_NOT_FOUND;
- credit result cannot be negative;
- adjustment result may be signed;
- declared rule inputs control DOE-relevant edit detection.

- [ ] **Step 2: Run RED**

~~~bash
node --test tests/doe-policy-engine.test.js
~~~

Expected: FAIL.

- [ ] **Step 3: Implement deterministic selector matching**

Supported operators:
- equals
- not_equals
- in
- not_in
- gt
- gte
- lt
- lte

Exception matching is first. Generic rules then use explicit priority. Equal top priority is an error; never use array order as a hidden tie-breaker.

- [ ] **Step 4: Implement structured calculation modes**

~~~text
fixed                -> fixed
per_hour             -> hours * rate
per_shift            -> shifts * rate
per_week             -> weeks * rate
per_trainee          -> trainees * rate
capped               -> min(baseValue, cap)
minimum              -> max(baseValue, minimum)
percentage_of_target -> targetDoe * rate
prorated             -> baseDoe * fte
tiered                -> ordered tier evaluation
~~~

Tiered evaluation stays inside the engine rather than generating JavaScript.

- [ ] **Step 5: Implement validatePolicy**

Return typed errors/warnings for duplicate rule keys, malformed selectors, missing required parameters, unsafe/unknown formula identifiers, tier overlaps/gaps, invalid exceptions, ambiguous matching, circular dependencies, and invalid output rules.

- [ ] **Step 6: Implement DOE-relevant change detection**

~~~js
assert.equal(
  ENGINE.isDoeRelevantChange({hours:2,room:'A'},{hours:2,room:'B'},['hours']),
  false
);
assert.equal(
  ENGINE.isDoeRelevantChange({hours:2},{hours:3},['hours']),
  true
);
~~~

- [ ] **Step 7: Preserve faculty-doe.js compatibility**

Keep override, contract, effectiveTarget, and targetLabel exports working for existing callers. New policy-aware target evaluation may be added, but do not create a second independent target algorithm.

- [ ] **Step 8: Run tests**

~~~bash
node --test tests/doe-formula.test.js tests/doe-policy-engine.test.js tests/faculty-doe.test.js tests/doe-canonical-consistency.test.js
npm test
~~~

Expected: PASS.

- [ ] **Step 9: Commit**

~~~bash
git add doe-policy-engine.js faculty-doe.js tests/doe-policy-engine.test.js tests/faculty-doe.test.js
git commit -m "feat: add canonical DOE policy engine"
~~~

---

### Task 3: Repository Contract, Firestore Adapter, and Security

**Files:**
- Create: doe-policy-repository.js
- Create: doe-policy-firestore.js
- Create: tests/doe-policy-repository.test.js
- Create: tests/doe-policy-security-emulator.test.js
- Modify: firestore.rules

**Interfaces:**
- Produces createFirestoreRepository({db,fieldValue}).
- Engine receives plain objects and ISO/date strings, never Firestore snapshots or Timestamp objects.

- [ ] **Step 1: Write repository contract tests**

Exercise:

~~~js
await repo.listPolicies();
await repo.getPolicy('ucvm-workload-2027-28');
await repo.listVersions('ucvm-workload-2027-28');
await repo.getVersion('ucvm-workload-2027-28-v1');
await repo.listRules(versionId);
await repo.saveDraftRule(rule,expectedRevision);
await repo.deleteDraftRule(ruleId,expectedRevision);
await repo.listExceptions(versionId);
await repo.saveException(exception,expectedRevision);
await repo.createImpactRun(run);
await repo.saveImpactRows(runId,rows);
await repo.appendAudit(event);
await repo.createCalculationRecord(record);
~~~

Assert stable business IDs and normalized timestamps.

- [ ] **Step 2: Run RED**

~~~bash
node --test tests/doe-policy-repository.test.js
~~~

Expected: FAIL.

- [ ] **Step 3: Implement collection mapping**

Use top-level collections:

~~~text
doe_policies
doe_policy_versions
doe_rules
doe_rule_selectors
doe_rule_parameters
doe_rule_tiers
doe_rule_inputs
doe_exceptions
doe_impact_runs
doe_impact_rows
doe_publications
doe_calculation_records
doe_audit_log
~~~

Only the adapter owns Firestore paths/timestamps.

- [ ] **Step 4: Implement optimistic Draft revision control**

A Draft write transaction:
1. loads parent version;
2. requires status draft;
3. requires revision equals expectedRevision;
4. writes child mutation;
5. increments revision;
6. clears lastImpactRunId/current preview freshness evidence;
7. appends audit.

Return POLICY_REVISION_CONFLICT on stale edit.

- [ ] **Step 5: Write emulator tests RED**

Create ADFA General, ADFA Regular, faculty, HICC, VISC, ADC, and LAB users.

Prove:
- Regular can edit Draft;
- Regular cannot activate;
- Regular cannot archive Active;
- Regular cannot execute recalculation path;
- General can perform permitted publication transition;
- non-admin roles cannot write DOE configuration;
- Active/Archived rules are immutable;
- publication/calculation/audit evidence is append-only.

- [ ] **Step 6: Implement Firestore Rules**

Use existing UCVM capability helpers. Authorization must be based on authenticated profile, not policy document role strings.

- [ ] **Step 7: Run tests**

~~~bash
node --test tests/doe-policy-repository.test.js
npm run test:emulator
~~~

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add doe-policy-repository.js doe-policy-firestore.js firestore.rules tests/doe-policy-repository.test.js tests/doe-policy-security-emulator.test.js
git commit -m "feat: add DOE repository and security rules"
~~~

---

### Task 4: DOE Policy Service and Version Lifecycle

**Files:**
- Create: doe-policy-service.js
- Create: tests/doe-policy-publication.test.js

**Interfaces:**
- createService({repository,engine,actorProvider,datasetProvider,clock})
- createPolicyYear
- cloneAsDraft
- validateDraft
- runImpactPreview
- publish
- archive
- calculateSession
- recordCalculation

- [ ] **Step 1: Write lifecycle tests RED**

Prove:
- Regular may clone/edit/validate/preview;
- Regular publish returns PERMISSION_DENIED;
- General publish without current preview returns PREVIEW_REQUIRED;
- Draft edit after preview returns PREVIEW_STALE;
- publish records exact revision/checksum/impactRunId;
- previous Active becomes Archived while new version becomes Active;
- Active cannot be edited.

- [ ] **Step 2: Implement capability gates**

Browser wiring uses existing UCVM.admin and UCVM.general. Pure tests inject capability functions.

- [ ] **Step 3: Implement canonical checksums**

Canonicalize and sort policy records by stable IDs before hashing. Hash exact policy revision and relevant dataset projection; do not hash UI state.

- [ ] **Step 4: Implement lifecycle state guards**

Publish compares policyVersionId, revision, policyChecksum, inputDatasetChecksum, and passed impact status before state change.

- [ ] **Step 5: Run tests**

~~~bash
node --test tests/doe-policy-publication.test.js tests/doe-policy-engine.test.js tests/doe-policy-repository.test.js
npm test
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add doe-policy-service.js tests/doe-policy-publication.test.js
git commit -m "feat: add DOE draft and publication service"
~~~

---

### Task 5: Faculty Dashboard DOE Rules Tab and Editors

**Files:**
- Create: doe-policy-admin.js
- Create: doe-policy-admin.css
- Create: tests/doe-policy-admin.test.js
- Modify: faculty-admin.html
- Modify: faculty-admin.js

**Interfaces:**
- Top-level tab data-tab="doe-rules".
- Root section id="doe-rules-view".
- Sections: Teaching Rules, Role Rules, Supervision & Complex, Target Rules, Exceptions.

- [ ] **Step 1: Write static/UI tests RED**

Assert:
- DOE Rules tab and section exist;
- self-service mode cannot initialize/show DOE Rules;
- Regular can see Draft editing/Validate/Preview but not execute Publish/Recalculate;
- General can see full lifecycle controls;
- module load order is correct.

- [ ] **Step 2: Add first-class HTML structure**

Top controls:
- Academic Year
- Policy Version
- lifecycle status
- New Policy Year
- Clone as Draft
- Validate
- Impact Preview
- Publish
- Archive
- Recalculate

Add rules table, editor root, exceptions table/editor, preview root.

- [ ] **Step 3: Extend faculty-admin.js tab handling**

Include doe-rules in setTab section switching. Self mode hides it and does not construct repository/service.

- [ ] **Step 4: Implement Rule table**

Columns:

~~~text
Rule ID
Name
Applies To
Calculation Mode
Rate / Parameters
Cap
Formula
Guideline Reference
Effective Status
Actions
~~~

Active/Archived rows read-only.

- [ ] **Step 5: Implement Structured Builder**

Fields:
- category
- selectors
- calculation mode
- allowed inputs
- parameters
- tiers
- result kind
- priority
- guideline reference
- source type
- enabled state

- [ ] **Step 6: Implement Advanced Formula toggle**

Formula text is validated only through doe-formula.js and engine validation.

- [ ] **Step 7: Implement Test Rule panel**

Example:

~~~text
Result: 1.80% DOE
Rule: teaching.lecture.standard
Inputs: hours = 6
Parameters: rate = 0.30
~~~

Missing input renders the typed error, never 0%.

- [ ] **Step 8: Implement Exceptions editor**

Require defined scope, fixed DOE, reason, source reference, and policy version.

- [ ] **Step 9: Run tests**

~~~bash
node --test tests/doe-policy-admin.test.js tests/faculty-self-dashboard.test.js
npm test
~~~

Expected: PASS.

- [ ] **Step 10: Commit**

~~~bash
git add doe-policy-admin.js doe-policy-admin.css faculty-admin.html faculty-admin.js tests/doe-policy-admin.test.js
git commit -m "feat: add Faculty Dashboard DOE Rules editor"
~~~

---

### Task 6: Mandatory Validation and Impact Preview

**Files:**
- Create: tests/doe-policy-preview.test.js
- Modify: doe-policy-service.js
- Modify: doe-policy-admin.js

**Interfaces:**
- validateDraft(policyVersionId)
- runImpactPreview(policyVersionId,dataset)
- Preview records exact policy revision, policy checksum, input dataset checksum.

- [ ] **Step 1: Write preview tests RED**

Prove:
- validation errors block successful preview;
- preview mutates no canonical faculty/session DOE;
- current vs Draft DOE differences are reported;
- policy mutation makes preview stale;
- relevant input dataset change makes preview stale;
- blocking errors lock Publish;
- large variance can be warning-only.

- [ ] **Step 2: Build deterministic dataset projection**

Include only stable IDs and DOE-relevant inputs. Sort faculty/session/assignment records before hashing. Exclude UI state and Firestore Timestamp objects.

- [ ] **Step 3: Implement simulation**

For each relevant item:
1. read stored/current DOE;
2. calculate Draft DOE;
3. collect affected rules;
4. collect typed warnings/errors;
5. aggregate faculty totals.

Do not write sessions, faculty, calendar_sessions, or indexes.

- [ ] **Step 4: Persist impact header plus row records**

Use doe_impact_runs and doe_impact_rows.

- [ ] **Step 5: Wire UI**

Display faculty checked, calculations checked, faculty changed, large increases/decreases, errors, warnings.

Any Draft save immediately marks Impact Preview OUTDATED and disables Publish.

- [ ] **Step 6: Run tests**

~~~bash
node --test tests/doe-policy-preview.test.js tests/doe-policy-publication.test.js
npm test
npm run test:emulator
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add doe-policy-service.js doe-policy-admin.js tests/doe-policy-preview.test.js
git commit -m "feat: require DOE validation and impact preview"
~~~

---

### Task 7: 2026-27 Seed, Exceptions, and Shadow Parity

**Files:**
- Create: tests/doe-policy-migration.test.js
- Create: tools/doe-policy-2026-27-seed.json
- Modify: doe-policy-service.js only if seed/import helper is needed.

**Interfaces:**
- Seed contains general rule definitions only.
- Private faculty-specific exceptions are generated from authorized source data at migration time and are not committed to the repository.

- [ ] **Step 1: Write migration tests RED**

Seed must reproduce current explicit timetable behavior:

~~~text
Lecture       0.30% per credited hour
SRL           0.30% per credited hour
Lab Lead      0.21% per credited hour
Lab Primary   0.21% per credited hour
Lab Support   0.19% per credited hour
Lab Secondary 0.19% per credited hour
~~~

Representative parity tolerance: 0.01 percentage points.

- [ ] **Step 2: Create stable rule keys**

~~~text
teaching.lecture.standard
teaching.srl.standard
teaching.lab.lead
teaching.lab.primary
teaching.lab.support
teaching.lab.secondary
~~~

Mark source as migration/current operational behavior unless a real guideline citation exists.

- [ ] **Step 3: Implement exception migration planner**

Classification:
- safe general rule;
- existing fixed/prorated/source-reconciled value -> Exception;
- unresolved -> review error.

Exception shape includes facultyId, category, assignment, fixedDoe, reason, sourceReference.

Never infer a formula from one observed numeric result.

- [ ] **Step 4: Implement shadow parity report**

Per faculty report:
- old total;
- engine total;
- difference;
- rule-explained amount;
- exception-explained amount;
- unresolved amount.

Unexplained numeric difference over 0.01 percentage points blocks migration acceptance.

- [ ] **Step 5: Run tests**

~~~bash
node --test tests/doe-policy-migration.test.js
npm test
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add tools/doe-policy-2026-27-seed.json tests/doe-policy-migration.test.js doe-policy-service.js
git commit -m "feat: seed 2026-27 DOE policy with parity checks"
~~~

---

### Task 8: Timetable Cutover and Historical Calculation Provenance

**Files:**
- Create: tests/doe-policy-timetable-integration.test.js
- Modify: timetable.js
- Modify: timetable-selection.js
- Modify existing timetable tests as needed.

**Interfaces:**
- Persisted assignment retains doeCredit plus doePolicyVersionId, doeRuleId, doeRuleKey, doeCalculationId.
- Full immutable snapshot is appended to doe_calculation_records.

- [ ] **Step 1: Write integration tests RED**

Prove:
1. New Lecture uses Active policy instead of a local 0.30 map.
2. Room-only edit preserves DOE and original policy/calculation.
3. Duration/credited-hours edit recalculates with current Active version.
4. Teaching-role edit recalculates.
5. Missing policy/input blocks DOE-relevant save, not 0.
6. Successful recalculation records old/new DOE and policy in audit/evidence.

Add a static assertion that the private hard-coded timetable rate map is removed after cutover.

- [ ] **Step 2: Add a small timetable DOE adapter**

Responsibilities:
- resolve Academic Year;
- load/cache Active policy through service;
- build context;
- calculate;
- return assignment provenance.

It must not know Firestore DOE collection names.

- [ ] **Step 3: Replace local rate calculations in all assignment writers**

Cover:
- single editor reconciliation;
- instructor finalization;
- new assignment row;
- multi-session editing.

Existing stored assignments stay readable.

- [ ] **Step 4: Apply DOE-relevant change detection**

Current teaching rules declare duration/credited-hours/role/type inputs. Room/Topic/Notes are not relevant unless a future rule explicitly declares them.

- [ ] **Step 5: Pair canonical DOE write with evidence**

Where existing transaction/batch flow permits, write session update, calendar update, session audit, and DOE calculation record together.

Do not create a new calculation record for a non-DOE edit.

- [ ] **Step 6: Remove doeRateForRole hard-coded map after parity is green**

The rates live in policy data.

- [ ] **Step 7: Run tests**

~~~bash
node --test tests/doe-policy-timetable-integration.test.js tests/timetable-selection.test.js tests/timetable-multi-edit-ui.test.js
npm test
npm run test:emulator
~~~

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add timetable.js timetable-selection.js tests/doe-policy-timetable-integration.test.js tests/timetable-selection.test.js tests/timetable-multi-edit-ui.test.js
git commit -m "feat: calculate timetable DOE from active policy"
~~~

---

### Task 9: Faculty DOE Aggregation, Target Rules, and Derived Indexes

**Files:**
- Modify: faculty-admin.js
- Modify: faculty-admin-enhancements.js
- Modify: faculty-doe.js
- Modify: data-index.js
- Modify: index-maintenance.js
- Modify: tests/faculty-doe.test.js
- Modify: tests/doe-canonical-consistency.test.js
- Modify: tests/data-index.test.js
- Modify: tests/index-maintenance.test.js

**Interfaces:**
- Assigned DOE is canonical persisted earned/role/supervision/exception/adjustment DOE.
- Target DOE comes through canonical target evaluation while preserving Contract and Override source values.

- [ ] **Step 1: Write canonical consistency tests RED**

Assert:
- DOE List does not own a separate calculation algorithm;
- approved Override still replaces Contract target for comparison;
- derived indexes equal canonical persisted DOE aggregation;
- historical explanation uses stored calculation snapshot;
- missing rule/input is unavailable/error, not zero.

- [ ] **Step 2: Move target evaluation behind engine/service**

Keep faculty-doe.js as compatibility facade only. Do not erase original Contract DOE or override record.

- [ ] **Step 3: Update DOE List**

Display:
- Assigned DOE;
- Effective Target;
- Remaining / Overage;
- Policy Version;
- Calculation status.

- [ ] **Step 4: Update faculty profile explanation**

Show policy, rule, inputs, parameters, result, calculated time, trigger from historical calculation record.

- [ ] **Step 5: Keep indexes derived**

data-index.js and index-maintenance.js aggregate persisted canonical doeCredit. They do not parse/evaluate formula text.

- [ ] **Step 6: Run tests**

~~~bash
node --test tests/faculty-doe.test.js tests/doe-canonical-consistency.test.js tests/data-index.test.js tests/index-maintenance.test.js
npm test
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add faculty-admin.js faculty-admin-enhancements.js faculty-doe.js data-index.js index-maintenance.js tests/faculty-doe.test.js tests/doe-canonical-consistency.test.js tests/data-index.test.js tests/index-maintenance.test.js
git commit -m "feat: unify faculty DOE reporting on policy engine"
~~~

---

### Task 10: General-Only Recalculate with Dry Run and Resume

**Files:**
- Create: tests/doe-policy-recalculate.test.js
- Modify: doe-policy-service.js
- Modify: doe-policy-admin.js
- Modify: firestore.rules
- Modify: tests/doe-policy-security-emulator.test.js

**Interfaces:**
- previewRecalculate({academicYear,policyVersionId,scope})
- runRecalculate({academicYear,policyVersionId,scope,resumeFrom,batchId,onProgress})

- [ ] **Step 1: Write recalculate tests RED**

Prove:
- Regular cannot execute;
- General must select Active policy;
- dry run writes nothing canonical;
- execution writes calculation evidence and updates source DOE;
- failed chunk exposes partialCommit, completedRows, resumeFrom, batchId;
- resume skips committed rows;
- derived index refresh follows successful canonical writes.

- [ ] **Step 2: Implement dry-run planner**

Return faculty affected, assignments affected, role/supervision affected, old versions, new Active version, changed DOE count, errors, warnings.

- [ ] **Step 3: Implement chunked execution**

Follow existing resumable batch patterns. Use stable recalculationBatchId and record it on committed calculation records.

- [ ] **Step 4: Wire General-only UI**

Require explicit confirmation showing Academic Year and Active version. Regular can see permission explanation but cannot execute.

- [ ] **Step 5: Extend emulator security**

Prove Regular cannot write the administrative recalculation path.

- [ ] **Step 6: Run tests**

~~~bash
node --test tests/doe-policy-recalculate.test.js
npm test
npm run test:emulator
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add doe-policy-service.js doe-policy-admin.js firestore.rules tests/doe-policy-recalculate.test.js tests/doe-policy-security-emulator.test.js
git commit -m "feat: add resumable DOE recalculation workflow"
~~~

---

### Task 11: Static Asset Graph and Load Order

**Files:**
- Modify: tools/static-assets.json
- Modify: faculty-admin.html
- Modify: index.html
- Modify: tests/runtime-assets.test.js

**Interfaces:**
- New runtime modules deploy on GitHub Pages and Azure build.
- Dependencies load before consumers.

- [ ] **Step 1: Write runtime asset test RED**

Require:
- doe-formula.js
- doe-policy-engine.js
- doe-policy-repository.js
- doe-policy-firestore.js
- doe-policy-service.js
- doe-policy-admin.js
- doe-policy-admin.css

Current manifest count is 56. Seven new deployable assets means expected count 63 unless implementation deliberately removes/adds another runtime asset; if so, make the test assert the exact resulting graph and document the delta.

- [ ] **Step 2: Assert script order**

Formula before Engine; repository/firestore before service; service before timetable/admin consumers. Timetable must not load the DOE Rules admin controller.

- [ ] **Step 3: Update manifest and HTML**

Add stylesheet only to Faculty Dashboard. Add calculation/service modules to pages that consume them.

- [ ] **Step 4: Run tests**

~~~bash
node --test tests/runtime-assets.test.js
npm test
npm run test:emulator
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add tools/static-assets.json faculty-admin.html index.html tests/runtime-assets.test.js
git commit -m "build: deploy DOE policy runtime assets"
~~~

---

### Task 12: End-to-End Verification and Manual Acceptance Build

**Files:**
- Modify tests only if verification exposes a real uncovered regression.
- Never weaken a valid assertion simply to make CI green.

**Interfaces:**
- Exact feature head passes Test and Firebase emulator suites.
- GitHub Pages fixed test site is the acceptance target.
- No production deployment.

- [ ] **Step 1: Run complete static/unit tests**

~~~bash
npm test
~~~

Expected: zero failures.

- [ ] **Step 2: Run complete emulator tests**

~~~bash
npm run test:emulator
~~~

Expected: zero failures.

- [ ] **Step 3: Verify hard-coded Timetable DOE map is gone**

Search source for the old Lecture 0.30 / Lab 0.21 / 0.19 calculation map. Expected: canonical values are policy data; UI code calls Engine/service.

- [ ] **Step 4: Verify permission evidence**

Confirm tests demonstrate:
- Regular edits Draft;
- Regular cannot Publish/Recalculate;
- General can Publish after current Preview;
- Faculty/HICC/VISC/ADC/LAB cannot edit policies;
- Active/Archived policy immutable.

- [ ] **Step 5: Push implementation branch and create PR**

PR body includes architecture summary, migration strategy, TDD RED/GREEN evidence, exact CI run IDs and SHA, Firestore collections/rules changed, and explicit statement that production was not deployed.

- [ ] **Step 6: Wait for exact-head Test and GitHub Pages success**

Do not request manual acceptance before both workflows are green on the exact PR head.

- [ ] **Step 7: Manual acceptance checklist**

Ask the user to verify:

~~~text
1. ADFA Regular opens DOE Rules and can clone/create/edit Draft, Validate, and run Impact Preview.
2. ADFA Regular cannot Publish, Archive Active, or Recalculate.
3. ADFA General/Owner can perform full lifecycle actions.
4. Active policy is read-only; Clone as Draft creates a new version.
5. Teaching, Role, Supervision & Complex, Target, and Exceptions sections render.
6. Structured Builder Test Rule calculates correctly.
7. Advanced Formula accepts safe expressions and rejects unsafe/unknown identifiers.
8. Exception cannot save without reason/source.
9. Draft mutation after Preview marks Preview OUTDATED and locks Publish.
10. Impact Preview shows current DOE, Draft DOE, difference, affected rules, warnings/errors.
11. Blocking validation/calculation errors lock Publish.
12. New/DOE-relevant Timetable edit uses current Active policy and stores provenance.
13. Room/Topic-only edit retains DOE and policy version.
14. Faculty DOE List/profile totals match canonical persisted calculations.
15. Historical explanation shows stored policy/rule/input snapshot.
16. Recalculate dry-run shows impact before writing.
17. Only General can execute Recalculate and a partial run can resume.
18. 2026-27 migrated teaching rates match current behavior and non-generalizable operational values appear as Exceptions.
~~~

- [ ] **Step 8: Stop before merge**

Do not merge until the user explicitly accepts the DOE feature.

Do not trigger Azure Production deployment as part of acceptance; production requires separate explicit authorization.
