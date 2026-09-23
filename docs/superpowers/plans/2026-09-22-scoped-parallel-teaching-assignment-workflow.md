# Scoped Parallel Teaching Assignment Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PAWS normal Teaching Assignment preparation with a course/Subject-scoped parallel contribution workflow while preserving explicit Change Request approvals and authoritative DOE behavior.

**Architecture:** Keep the existing session, assignment, approval, LAB-group, calendar-projection, and DOE engines. Add one pure academic-scope helper and one pure contribution model, then wire them through the existing Work Queue, timetable editor, Firestore rules, and ADFA assignment flow. Normal preparation readiness becomes field-based; explicit routed approvals remain serial and unchanged.

**Tech Stack:** Vanilla JavaScript, Firebase Auth/Firestore, Firestore Security Rules, Node.js `node:test`, `@firebase/rules-unit-testing`, existing PAWS browser-smoke/static build tooling.

**Spec:** `docs/superpowers/specs/2026-09-22-scoped-parallel-teaching-assignment-workflow-design.md`

## Global Constraints

- Execute on the HOME computer in an isolated worktree; do not reconstruct or depend on the unfinished company-computer PR #67 worktree.
- Start from remote branch `feature/scoped-parallel-assignment-workflow`, which was created from `fix/workflow-functional-completion`; merge the latest `origin/main` into the feature worktree before product-code changes.
- Do not merge PR #67, force-push, deploy production Firebase, seed live production data, publish DOE, or modify Azure.
- Normal Teaching Assignment preparation is parallel and field-based; explicit Change Request approval remains a separate serial workflow.
- ADFA readiness requires course, valid date, start, end, session type, and valid Topic. Room, suggestions, notes, LAB groups, and LAB rosters do not block ADFA readiness.
- HICC/VISC authority is based on exact course scope plus optional exact Subject scope; `role == 'hicc'` or `role == 'visc'` alone never grants global authority.
- Subject uses a canonical administrator-maintained `subjectKey`; Topic is free instructional content and never an authorization key.
- Faculty suggestions are advisory only and cannot automatically become `assignments[]`.
- Teaching Assignment notes are readable only by ADFA, Teaching Assignment offices, and scoped Teaching Assignment roles; ordinary Faculty, Other Office, and Student are denied.
- Full LAB roster read is temporarily allowed to every authenticated active PAWS user; roster write remains role-restricted.
- Subject, suggestions, and notes do not by themselves create authoritative DOE or invent new DOE formulas.
- HICC/VISC DOE remains independently calculated per Faculty + role + course + Subject when applicable + Academic Year + active Annual DOE Rule Book.
- Missing or ambiguous DOE course/Subject mapping fails closed; no default DOE percentage may be invented.

## Review Focus

1. **Malformed or stale academic scope data** — an empty, unknown, or malformed `academicScopes` value must fail closed rather than broadening HICC/VISC authority. Task 2 adds explicit malformed-scope tests.
2. **Course/Subject normalization edge cases** — authorization may trim and canonicalize course/Subject keys, but it must never fall back to substring matching. Task 2 tests short-string and cross-Subject attacks.
3. **Concurrent contributor writes** — ADC/LAB/HICC/VISC contributions must live in actor/source-specific documents so one save cannot overwrite another contributor's suggestions or note. Task 5 pins document identity and coexistence.
4. **Missing coarse workload policy** — candidate workload must render `Needs Review` without exposing exact DOE when no approved threshold policy is configured. Task 10 tests this fail-closed display.
5. **Non-scoped session types** — QUIZ/MIDTERM/OSCE/EXAM and unknown types must retain current behavior and receive no invented HICC/VISC workflow. Task 4 keeps explicit regression coverage.

---

### Task 1: Isolated Worktree, Main Merge, and Baseline Gate

**Files:**
- No product-code changes in this task.
- Verify: `package.json`
- Verify: `tests/workflow-functional-completion.test.js`
- Verify: `tests/rules-evaluation-budget.test.js`

**Interfaces:**
- Consumes: remote branch `feature/scoped-parallel-assignment-workflow`.
- Produces: a clean isolated worktree containing the feature branch merged with latest `origin/main`, with recorded green baseline evidence.

- [ ] **Step 1: Create or reuse the isolated HOME worktree using the required worktree sub-skill**

Run the worktree safety checks required by `superpowers:using-git-worktrees`, then enter the isolated feature worktree. The final branch inside the worktree must be:

```bash
git branch --show-current
# feature/scoped-parallel-assignment-workflow
```

- [ ] **Step 2: Fetch and merge latest main into the feature branch**

```bash
git fetch origin
git merge --no-edit origin/main
```

Expected: merge completes without discarding the existing PR #67-derived Work Queue/LAB roster work or the design spec.

- [ ] **Step 3: Install repository dependencies without changing dependency versions**

```bash
npm install
npm --prefix server install
```

Expected: installs the lockfile-declared dependencies. Do not run dependency upgrades.

- [ ] **Step 4: Run the complete pre-change baseline**

```bash
npm test
npm run test:static
npm run test:server
npm run test:emulator
```

Expected: all repository-authoritative suites pass. If a suite fails, stop before product-code changes and identify whether the failure is pre-existing after the merge.

- [ ] **Step 5: Capture the rules-budget baseline**

```bash
node --test tests/rules-evaluation-budget.test.js
```

Expected: PASS. Record the current core ceiling/count in the implementation log so later Firestore-rule changes can be compared against it.

- [ ] **Step 6: Commit the main synchronization if Git created a merge commit**

```bash
git status --short
git log -1 --oneline
git push origin feature/scoped-parallel-assignment-workflow
```

Expected: the remote feature branch contains the merged baseline and no unrelated local changes.

---

### Task 2: Canonical Academic Course/Subject Scope

**Files:**
- Create: `academic-responsibility.js`
- Create: `tests/academic-responsibility.test.js`
- Modify later in this task only if required by static asset loading: `tools/static-assets.json`
- Modify later in this task only if required by browser load order: `index.html`

**Interfaces:**
- Consumes: a user/profile object whose optional `academicScopes` map contains arrays keyed by responsibility.
- Produces:
  - `normalizeCourse(value) -> string`
  - `normalizeSubjectKey(value) -> string`
  - `scopesFor(profile, responsibility) -> Array<{course:string,subjectKey:string}>`
  - `hasScope(profile, responsibility, resource) -> boolean`
  - `responsibilitiesFor(profile, resource) -> string[]`
  - `canEditTopic(profile, resource) -> boolean`
  - `canSuggestFaculty(profile, resource) -> boolean`

- [ ] **Step 1: Write RED tests for course-wide and Subject-limited scope**

Add tests that pin the canonical contract:

```js
test('course-wide scope authorizes every Subject in the exact course',()=>{
 const api=load(),profile={role:'faculty',academicScopes:{hicc:[{course:'VTMD 505'}]}};
 assert.equal(api.hasScope(profile,'hicc',{course:'VTMD 505',subjectKey:'surgery'}),true);
 assert.equal(api.hasScope(profile,'hicc',{course:'VTMD 506',subjectKey:'surgery'}),false);
});

test('Subject-limited scope requires exact course and exact Subject',()=>{
 const api=load(),profile={role:'faculty',academicScopes:{hicc:[{course:'VTMD 506',subjectKey:'surgery'}]}};
 assert.equal(api.hasScope(profile,'hicc',{course:'VTMD 506',subjectKey:'surgery'}),true);
 assert.equal(api.hasScope(profile,'hicc',{course:'VTMD 506',subjectKey:'anesthesia'}),false);
});
```

- [ ] **Step 2: Add RED tests for malformed scopes and substring attacks**

```js
test('malformed academicScopes fail closed',()=>{
 const api=load();
 for(const academicScopes of [null,[],{hicc:'VTMD 505'},{hicc:[{}]},{hicc:[{course:'5'}]}]){
  assert.equal(api.hasScope({role:'hicc',academicScopes},'hicc',{course:'VTMD 505',subjectKey:'surgery'}),false);
 }
});

test('scope matching never uses substring matching',()=>{
 const api=load(),profile={academicScopes:{hicc:[{course:'VTMD 505',subjectKey:'surgery'}]}};
 assert.equal(api.hasScope(profile,'hicc',{course:'VTMD 5050',subjectKey:'surgery'}),false);
 assert.equal(api.hasScope(profile,'hicc',{course:'VTMD 505',subjectKey:'surgery-core'}),false);
});
```

- [ ] **Step 3: Run the new test and verify RED**

```bash
node --test tests/academic-responsibility.test.js
```

Expected: FAIL because `academic-responsibility.js` does not exist.

- [ ] **Step 4: Implement the minimal pure helper**

Implement exact normalized matching:

```js
const normalizeCourse=value=>String(value??'').trim().toUpperCase();
const normalizeSubjectKey=value=>String(value??'').trim().toLowerCase();

function scopesFor(profile,responsibility){
 const rows=profile?.academicScopes?.[String(responsibility||'').trim().toLowerCase()];
 return (Array.isArray(rows)?rows:[])
  .map(row=>({
   course:normalizeCourse(row?.course),
   subjectKey:normalizeSubjectKey(row?.subjectKey)
  }))
  .filter(row=>row.course.length>=4);
}

function hasScope(profile,responsibility,resource){
 const course=normalizeCourse(resource?.course||resource?.courseCode);
 const subjectKey=normalizeSubjectKey(resource?.subjectKey);
 if(!course)return false;
 return scopesFor(profile,responsibility).some(scope=>
  scope.course===course && (!scope.subjectKey || scope.subjectKey===subjectKey)
 );
}
```

`canEditTopic` and `canSuggestFaculty` return true when the profile has a matching HICC or VISC scope. Do not inspect Topic text.

- [ ] **Step 5: Run focused tests**

```bash
node --test tests/academic-responsibility.test.js
```

Expected: PASS.

- [ ] **Step 6: Add the helper to static/browser assets before consumers**

If browser consumers load these modules directly, add `academic-responsibility.js` to `tools/static-assets.json` and load it before `timetable.js` in `index.html`. Add a load-order assertion next to the existing office-capability load-order test.

- [ ] **Step 7: Run static and focused regression tests**

```bash
npm run test:static
node --test tests/office-capabilities.test.js tests/academic-responsibility.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add academic-responsibility.js tests/academic-responsibility.test.js tools/static-assets.json index.html
git commit -m "feat: add scoped academic responsibilities"
```

---

### Task 3: Canonical Subject Catalog and Optional Session Classification

**Files:**
- Create: `subject-catalog.js`
- Create: `tests/subject-catalog.test.js`
- Create: `tests/subject-catalog-security-emulator.test.js`
- Modify: `faculty-admin.html`
- Modify: `faculty-admin.js`
- Modify: `timetable.js`
- Modify: `timetable-selection.js`
- Modify: `firestore.rules`
- Modify: `tools/static-assets.json`
- Modify: `tools/runtime-bundles.json`

**Interfaces:**
- Consumes: administrator-maintained Subject records and existing session objects.
- Produces:
  - `teaching_subjects/{subjectKey}` records with `{key,label,active,updatedBy,updatedAt}`
  - `subject-catalog.normalizeKey(value) -> string`
  - `subject-catalog.validateRecord(record, expectedKey) -> boolean`
  - `subject-catalog.activeOptions(rows) -> Array<{key,label}>`
  - optional session field `subjectKey`
- Security invariant: scoped HICC/VISC users may consume `subjectKey` for authorization but may not change it, preventing self-escalation.

- [ ] **Step 1: Write RED pure-model tests**

```js
test('catalog normalizes stable keys and returns active options only',()=>{
 const api=load();
 const rows=[
  {key:'surgery',label:'Surgery',active:true},
  {key:'anesthesia',label:'Anesthesia',active:false}
 ];
 assert.equal(api.normalizeKey(' Surgery '),'surgery');
 assert.deepEqual(api.activeOptions(rows),[{key:'surgery',label:'Surgery'}]);
});

test('catalog rejects mismatched document identity',()=>{
 const api=load();
 assert.throws(()=>api.validateRecord({key:'surgery',label:'Surgery',active:true},'anesthesia'));
});
```

- [ ] **Step 2: Run pure-model test and verify RED**

```bash
node --test tests/subject-catalog.test.js
```

Expected: FAIL because `subject-catalog.js` does not exist.

- [ ] **Step 3: Implement the minimal Subject catalog helper**

Use a stable lowercase key and a human-readable label. Reject blank keys, blank labels, keys containing whitespace, and document-key mismatches.

A valid record shape is:

```js
{key:'surgery',label:'Surgery',active:true}
```

Do not attach DOE percentages, curriculum stage, or policy-version data to the Teaching Assignment Subject catalog.

- [ ] **Step 4: Add RED Firestore emulator tests**

Pin:

```js
await assertSucceeds(db('faculty').doc('teaching_subjects/surgery').get());
await assertFails(db('faculty').doc('teaching_subjects/surgery').set({key:'surgery',label:'Surgery',active:true}));
await assertSucceeds(db('administrator').doc('teaching_subjects/surgery').set({
 key:'surgery',label:'Surgery',active:true,updatedBy:'administrator',updatedAt:serverTimestamp()
}));
```

Also assert a write where document id and `key` differ is denied.

- [ ] **Step 5: Add Firestore catalog rules**

Add `match /teaching_subjects/{subjectKey}`:
- read: `ready()`
- create/update: existing administrator authority only
- delete: existing administrator authority only
- write shape: exact `key == subjectKey`, non-empty `label`, boolean `active`, standard update metadata

Do not read DOE Subject mappings from the browser to populate this catalog.

- [ ] **Step 6: Add administrator catalog UI**

Add a focused Subject Catalog panel to the existing Faculty Dashboard administrative area. It must allow authorized administrators to:
- list Subject key/label/status
- add a Subject
- rename the display label without changing the stable key
- activate/deactivate a Subject

Do not add DOE configuration controls here.

- [ ] **Step 7: Add optional Subject selection to session editing**

ADC may optionally classify a session with `subjectKey` using only active catalog options. High-trust admin repair paths may also set it.

Rules/UI must enforce:
- `subjectKey` is optional and is not an ADFA readiness gate
- HICC/VISC cannot change `subjectKey`
- Topic remains a separate free-text field
- changing Subject alone does not create authoritative DOE

- [ ] **Step 8: Add static/runtime assets in deterministic order**

Load `subject-catalog.js` before `timetable.js` and before the admin UI consumer. Update `tools/static-assets.json` and `tools/runtime-bundles.json` consistently.

- [ ] **Step 9: Run focused, static, and emulator tests**

```bash
node --test tests/subject-catalog.test.js tests/timetable-selection.test.js
npm run test:static
npm run test:emulator
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add subject-catalog.js tests/subject-catalog.test.js tests/subject-catalog-security-emulator.test.js faculty-admin.html faculty-admin.js timetable.js timetable-selection.js firestore.rules tools/static-assets.json tools/runtime-bundles.json
git commit -m "feat: add canonical teaching subject catalog"
```

---

### Task 4: Parallel Field-Based Preparation Readiness

**Files:**
- Modify: `session-workflow.js`
- Modify: `tests/session-workflow.test.js`
- Modify: `work-queue.js`
- Modify: `tests/work-queue.test.js`
- Modify: `tests/workflow-functional-completion.test.js`

**Interfaces:**
- Consumes: existing session objects and existing LAB roster context.
- Produces:
  - `preparationReadiness(session, context={}) -> {state, skeletonComplete, topicComplete, adfaReady, finalAssigned}`
  - `labOutstanding(session, context={}) -> {applicable, complete, missing:string[]}`
- Preserves: existing `definitionForSession`, `evaluateSessionWorkflow`, and Work Queue view-model APIs where possible.

- [ ] **Step 1: Rewrite the old serial readiness tests into RED target-state tests**

Add/replace focused assertions:

```js
test('LEC room does not block ADFA readiness',()=>{
 const w=load(),state=w.preparationReadiness(lec({room:'',assignments:[]}));
 assert.equal(state.state,'adfa_ready');
 assert.equal(state.adfaReady,true);
});

test('LAB roster and groups do not block ADFA readiness',()=>{
 const w=load(),session=lab({topic:'Neuro',labGroupIds:[]});
 const state=w.preparationReadiness(session,{rosters:{}});
 assert.equal(state.state,'adfa_ready');
 assert.equal(w.labOutstanding(session,{rosters:{}}).complete,false);
});

test('missing Topic blocks ADFA even when skeleton is complete',()=>{
 const w=load(),state=w.preparationReadiness(lec({topic:'',room:''}));
 assert.equal(state.state,'topic_incomplete');
 assert.equal(state.adfaReady,false);
});
```

- [ ] **Step 2: Keep a regression test that unsupported session types remain untouched**

```js
test('non-scoped session types keep no invented preparation workflow',()=>{
 const w=load();
 for(const type of ['QUIZ','MIDTERM','OSCE','EXAM']){
  const value=w.preparationReadiness({id:'x',type,course:'200',date:'2027-01-11',start:'08:00',end:'09:00',topic:'Quiz'});
  assert.equal(value.state,'not_scoped');
 }
});
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test tests/session-workflow.test.js
```

Expected: FAIL because `preparationReadiness` and `labOutstanding` are not exported.

- [ ] **Step 4: Implement field-based readiness without touching explicit approvals**

Implement a dedicated helper rather than reusing Change Request approval state:

```js
function preparationReadiness(session,context={}){
 const type=sessionType(session);
 if(!isScopedType(type))return{state:'not_scoped',skeletonComplete:true,topicComplete:true,adfaReady:false,finalAssigned:hasAssignments(session)};
 const skeletonComplete=present(session,'course')&&hasDate(session)&&present(session,'start')&&present(session,'end')&&Boolean(type);
 const topicComplete=hasTopic(session);
 const finalAssigned=hasAssignments(session);
 const state=!skeletonComplete?'skeleton_incomplete':!topicComplete?'topic_incomplete':finalAssigned?'final_assigned':'adfa_ready';
 return{state,skeletonComplete,topicComplete,adfaReady:skeletonComplete&&topicComplete,finalAssigned};
}
```

`labOutstanding` may reuse existing LAB group/roster completion helpers but must never feed `adfaReady`.

- [ ] **Step 5: Remove blocking serial semantics from normal Work Queue items**

Change normal preparation queue generation so:
- ADC work represents missing skeleton fields.
- LAB work represents LAB Topic/groups/roster outstanding independently.
- ADFA work appears when `preparationReadiness(...).adfaReady === true && !finalAssigned`.
- normal preparation does not emit a disabled `WAITING FOR ADC/LAB` chain.

Keep the explicit Change Request queue untouched.

- [ ] **Step 6: Update Work Queue tests**

Pin that a LAB session with Topic but no roster can expose both:
- LAB outstanding work, and
- ADFA ready work.

Also pin that missing Topic exposes Topic work but not ADFA ready work.

- [ ] **Step 7: Run focused workflow suites**

```bash
node --test tests/session-workflow.test.js tests/work-queue.test.js tests/workflow-functional-completion.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add session-workflow.js work-queue.js tests/session-workflow.test.js tests/work-queue.test.js tests/workflow-functional-completion.test.js
git commit -m "feat: make teaching preparation readiness parallel"
```

---

### Task 5: Four-Source Suggestions and Actor-Scoped Contributions

**Files:**
- Modify: `faculty-suggestions.js`
- Modify: `tests/faculty-suggestions.test.js`
- Create: `assignment-contributions.js`
- Create: `tests/assignment-contributions.test.js`
- Modify: `tools/static-assets.json`
- Modify: `index.html`

**Interfaces:**
- Consumes: existing opaque suggestion candidate keys.
- Produces:
  - `faculty-suggestions.OFFICES = ['adc','lab','hicc','visc']`
  - `assignment-contributions.documentId(sessionId, sourceRole, actorUid) -> string`
  - `assignment-contributions.createContribution({session, sourceRole, actor, suggestions, note, at}) -> contribution`
  - `assignment-contributions.sanitizeContribution(record) -> safe contribution`
  - `assignment-contributions.suggestionsForAdfa(contributions) -> Array<{sourceRole,actorUid,actorDisplayName,suggestions}>`

- [ ] **Step 1: Add RED tests for HICC/VISC suggestions**

```js
test('HICC and VISC may create safe Faculty suggestions',()=>{
 const api=load();
 for(const office of ['hicc','visc']){
  const row=api.createSuggestion({candidateKey:'cand-1',displayName:'Dr X',office,actor:{uid:'u1'}});
  assert.equal(row.suggestedByOffice,office);
 }
});
```

- [ ] **Step 2: Add RED contribution identity/coexistence tests**

```js
test('contribution identity isolates actor and source role',()=>{
 const api=load();
 assert.equal(api.documentId('s1','hicc','u1'),'s1__hicc__u1');
 assert.notEqual(api.documentId('s1','hicc','u1'),api.documentId('s1','hicc','u2'));
 assert.notEqual(api.documentId('s1','hicc','u1'),api.documentId('s1','visc','u1'));
});

test('contributions keep suggestions and notes separate by actor',()=>{
 const api=load(),session={id:'s1',course:'VTMD 505',subjectKey:'surgery'};
 const a=api.createContribution({session,sourceRole:'hicc',actor:{uid:'u1',name:'Dr A'},suggestions:[],note:'HICC note'});
 const b=api.createContribution({session,sourceRole:'lab',actor:{uid:'u2',name:'LAB'},suggestions:[],note:'LAB note'});
 assert.notEqual(api.documentId(a.sessionId,a.sourceRole,a.actorUid),api.documentId(b.sessionId,b.sourceRole,b.actorUid));
 assert.equal(a.note,'HICC note');
 assert.equal(b.note,'LAB note');
});
```

- [ ] **Step 3: Run tests and verify RED**

```bash
node --test tests/faculty-suggestions.test.js tests/assignment-contributions.test.js
```

Expected: FAIL on HICC/VISC office validation and missing contribution module.

- [ ] **Step 4: Extend suggestion sources while preserving privacy guards**

Change only the allowed sources and related error messages/empty metadata. Keep `ALLOWED_KEYS`, `FORBIDDEN_KEYS`, `assertSafe`, and `suggestionToAssignment()` fail-closed behavior.

- [ ] **Step 5: Implement the pure contribution model**

The stored safe shape is:

```js
{
 sessionId:'s1',
 course:'VTMD 505',
 subjectKey:'surgery',
 sourceRole:'hicc',
 actorUid:'u1',
 actorDisplayName:'Dr A',
 suggestions:[{candidateKey:'cand-1',displayName:'Dr X',suggestedByOffice:'hicc',suggestedBy:'u1',suggestedAt:null}],
 note:'HICC note',
 updatedAt:null
}
```

Validate:
- non-empty sessionId/sourceRole/actorUid
- sourceRole in ADC/LAB/HICC/VISC
- note string length <= 2000
- every suggestion passes existing `faculty-suggestions.assertStorable`
- no Faculty ID, UCID, email, exact DOE, AFC reason, HR fields

- [ ] **Step 6: Add browser asset load order**

Load `faculty-suggestions.js` before `assignment-contributions.js`, and both before `timetable.js`.

- [ ] **Step 7: Run focused + static tests**

```bash
node --test tests/faculty-suggestions.test.js tests/assignment-contributions.test.js
npm run test:static
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add faculty-suggestions.js assignment-contributions.js tests/faculty-suggestions.test.js tests/assignment-contributions.test.js tools/static-assets.json index.html
git commit -m "feat: add scoped teaching contributions"
```

---

### Task 6: Scoped Capabilities and Topic Editing Policy

**Files:**
- Modify: `office-capabilities.js`
- Modify: `tests/office-capabilities.test.js`
- Modify: `timetable-selection.js`
- Modify: `tests/timetable-multi-edit-ui.test.js`
- Modify: `timetable.js`

**Interfaces:**
- Consumes: `UCVM_ACADEMIC_RESPONSIBILITY.hasScope(profile,responsibility,session)`.
- Produces capabilities:
  - `canEditScopedTopic`
  - `canSuggestFacultyScoped`
  - existing office capability flags unchanged for ADC/LAB/ADFA.

- [ ] **Step 1: Add RED capability tests**

```js
test('HICC/VISC scoped powers require a matching academic scope',()=>{
 const api=load();
 const profile={role:'faculty',academicScopes:{hicc:[{course:'VTMD 505',subjectKey:'surgery'}]}};
 const allowed=api.forProfile(profile,{course:'VTMD 505',subjectKey:'surgery',responsibilityApi:scopeApi});
 const denied=api.forProfile(profile,{course:'VTMD 505',subjectKey:'anesthesia',responsibilityApi:scopeApi});
 assert.equal(allowed.canEditScopedTopic,true);
 assert.equal(allowed.canSuggestFacultyScoped,true);
 assert.equal(denied.canEditScopedTopic,false);
 assert.equal(denied.canSuggestFacultyScoped,false);
});
```

Keep the existing test that forged `officeAccess` cannot promote HICC/VISC into ADC/LAB/ADFA.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --test tests/office-capabilities.test.js
```

Expected: FAIL because the new capability flags are absent.

- [ ] **Step 3: Add scoped capability flags without turning HICC/VISC into operational offices**

`OFFICES` remains `['adc','lab','adfa']`.

In `forProfile(profile, options)`, after operational office flags, evaluate the injected/global academic-responsibility helper against `options.course` and `options.subjectKey`. Set only `canEditScopedTopic` and `canSuggestFacultyScoped`; do not set `canEditCourseFields`, `canEditInstructor`, or LAB roster/group write permissions.

- [ ] **Step 4: Update timetable field policy**

In `timetable-selection.editPolicy`:
- ADC may edit Topic for LEC/SRL through existing course-field authority.
- LAB may edit Topic for LAB through existing LAB authority.
- scoped HICC/VISC may edit only Topic when `canEditScopedTopic` is true.
- scoped HICC/VISC may not edit course/date/time/type/room/final Faculty assignment.
- Subject selection itself is administrator-managed catalog data; scoped roles consume the canonical key and do not create arbitrary Subject values.

- [ ] **Step 5: Add selection-policy tests**

Pin:
- HICC VTMD 505/Surgery Topic edit allowed.
- same HICC VTMD 505/Anesthesia denied.
- same HICC VTMD 506 denied.
- VISC follows its independent scope.
- normal Faculty denied.
- ADC LEC/SRL Topic remains allowed.
- LAB LAB Topic remains allowed.

- [ ] **Step 6: Run focused suites**

```bash
node --test tests/office-capabilities.test.js tests/timetable-multi-edit-ui.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add office-capabilities.js timetable-selection.js timetable.js tests/office-capabilities.test.js tests/timetable-multi-edit-ui.test.js
git commit -m "feat: enforce course subject teaching scopes"
```

---

### Task 7: Firestore Authorization for Academic Scopes, Contributions, Notes, and Roster Reads

**Files:**
- Modify: `firestore.rules`
- Create: `tests/academic-scope-security-emulator.test.js`
- Create: `tests/assignment-contribution-security-emulator.test.js`
- Modify: `tests/lab-group-security-emulator.test.js`
- Modify: `tests/rules-evaluation-budget.test.js`

**Interfaces:**
- Consumes:
  - `users/{uid}.academicScopes`
  - session `course` and optional `subjectKey`
  - contribution `course`, `subjectKey`, `sourceRole`, `actorUid`
- Produces Firestore permissions for scoped Topic writes and contribution documents.

- [ ] **Step 1: Add RED emulator tests for scoped Topic writes**

Seed users with authoritative scopes and sessions with canonical course/Subject fields.

Required assertions:

```js
await assertSucceeds(hicc505.doc('sessions/s505-surg').update({topic:'Updated',updatedBy:'hicc505',updatedAt:serverTimestamp()}));
await assertFails(hicc505.doc('sessions/s505-anesthesia').update({topic:'Denied',updatedBy:'hicc505',updatedAt:serverTimestamp()}));
await assertFails(hicc505.doc('sessions/s506').update({topic:'Denied',updatedBy:'hicc505',updatedAt:serverTimestamp()}));
```

Also assert `role:'hicc'` with no matching `academicScopes` is denied.

- [ ] **Step 2: Add RED emulator tests for contribution-note privacy**

Pin:
- ADC/LAB/ADFA can read Teaching Assignment contributions needed by their workflow.
- scoped HICC/VISC can read applicable contribution documents in their exact scope.
- actor may write only their own source-role contribution.
- cross-course HICC/VISC contribution write denied.
- ordinary Faculty read denied.
- Other Office read denied.
- a contribution containing forbidden private fields is denied by the rule shape even if the client helper was bypassed.

- [ ] **Step 3: Rewrite roster-read tests to the approved temporary policy**

Replace old expectations that ADC/HICC/VISC/Faculty are denied. New read matrix:

```js
for(const uid of ['developer','owner','administrator','adc','lab','hicc','visc','faculty','other-office']){
 await assertSucceeds(db(uid).doc('lab_group_rosters/g-a').get());
}
```

Keep write assertions restricted to LAB and existing approved administrative/high-trust roles.

- [ ] **Step 4: Run emulator tests and verify RED**

```bash
npm run test:emulator
```

Expected: new scoped/contribution/roster-read tests fail under old rules.

- [ ] **Step 5: Extend the user profile shape for `academicScopes`**

Update user create/update validation so `academicScopes` may be persisted by existing high-trust user-management paths.

Rules must validate:
- map shape
- only approved responsibility keys used in this phase: `hicc`, `visc`, `rotation_coordinator`
- each value is a bounded list of maps
- each scope contains a non-empty course and optional string Subject key
- HICC/VISC role alone does not grant scope

Keep legacy profiles without `academicScopes` valid but with no scoped authority.

- [ ] **Step 6: Add exact-match rule helpers using the already-loaded profile**

Use `profile().academicScopes`; do not add a derived authorization cache.

Create rule helpers conceptually equivalent to:

```text
hasAcademicCourseScope(responsibility, course)
hasAcademicSubjectScope(responsibility, course, subjectKey)
hasAcademicScope(responsibility, course, subjectKey)
```

Firestore rules cannot iterate arbitrary nested maps freely, so choose a bounded representation that the emulator proves fits rule limits. If the map-of-lists representation cannot be validated/evaluated within Firestore Rules constraints, use a bounded flat token list on the same user profile, for example:

```text
academicScopeTokens:
  hicc|VTMD 505|*
  hicc|VTMD 506|surgery
  visc|VTMD 521|imaging
```

The authoritative contract remains exact course + optional Subject; the executor may choose this profile-local encoding only if the emulator proves it safer and the schema docs are updated in the same commit.

- [ ] **Step 7: Add scoped Topic update rule**

Permit changes only to:
- `topic`
- standard update metadata already required by session writes

for a matching HICC/VISC scope. Require the paired sanitized calendar write if the existing session/calendar invariant requires it.

Do not permit scoped roles to change course/date/start/end/type/room/assignments/facultyIds/instructor.

- [ ] **Step 8: Add `session_assignment_contributions/{id}` rules**

Read:
- ADFA/high-trust admin
- ADC/LAB Teaching Assignment office
- matching scoped HICC/VISC

Write:
- the authenticated actor only
- `actorUid == request.auth.uid`
- `sourceRole` matches actor authority
- HICC/VISC course/Subject exact scope required
- safe allowlisted keys only
- note length <= 2000
- suggestions use safe allowlisted fields only
- no UCID/email/facultyId/exact DOE/AFC/HR keys

- [ ] **Step 9: Change roster read helper only**

Set the read predicate to active authenticated PAWS users:

```text
rosterReader() = ready()
```

Do not broaden roster write predicates.

- [ ] **Step 10: Run budget test immediately**

```bash
node --test tests/rules-evaluation-budget.test.js
```

Expected: PASS at or below the existing core ceiling. If it fails, simplify rule expressions before continuing; do not raise the ceiling just to make the change pass.

- [ ] **Step 11: Run complete emulator suite**

```bash
npm run test:emulator
```

Expected: PASS with zero authorization regressions in explicit approval tests.

- [ ] **Step 12: Commit**

```bash
git add firestore.rules tests/academic-scope-security-emulator.test.js tests/assignment-contribution-security-emulator.test.js tests/lab-group-security-emulator.test.js tests/rules-evaluation-budget.test.js
git commit -m "feat: secure scoped teaching contributions"
```

---

### Task 8: Work Queue and Timetable UI for HICC/VISC Contributions

**Files:**
- Modify: `work-queue.js`
- Modify: `tests/work-queue.test.js`
- Modify: `timetable.js`
- Modify: `tests/workflow-functional-completion.test.js`
- Modify: `tests/timetable.test.js`

**Interfaces:**
- Consumes:
  - `UCVM_ACADEMIC_RESPONSIBILITY`
  - `UCVM_ASSIGNMENT_CONTRIBUTIONS`
  - `preparationReadiness`
  - existing `UCVM_PAGE_DATA.openScopedEditor`
- Produces:
  - HICC/VISC scoped Topic work items
  - contribution editor controls for suggestion(s) + actor note
  - contribution Firestore save/load wiring

- [ ] **Step 1: Add RED Work Queue tests for HICC/VISC Topic work**

Pin that:
- missing Topic + matching HICC scope => HICC item
- missing Topic + matching VISC scope => VISC item
- completed Topic => no blocking HICC/VISC item
- optional suggestion/note absence never creates a blocking item
- cross-course/cross-Subject sessions never appear

- [ ] **Step 2: Add RED UI source tests for contribution controls**

The scoped editor must expose, for a contributor:
- Topic field when authorized
- multi-select safe Faculty suggestions
- one actor-owned note textarea
- no final Faculty assignment editor unless ADFA

Use existing source-function/static UI test style rather than brittle full-DOM rewrites.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test tests/work-queue.test.js tests/workflow-functional-completion.test.js tests/timetable.test.js
```

Expected: FAIL because HICC/VISC queue and contribution UI are not wired.

- [ ] **Step 4: Extend Work Queue model without changing explicit approval UI**

Add HICC/VISC preparation items based on:
- matching academic scope
- scoped session type
- missing Topic

Do not add HICC/VISC to `officeAccess`; these are academic responsibility queue items.

- [ ] **Step 5: Extend `openScopedEditor` to academic responsibility stages**

Allow `stage:'hicc'` and `stage:'visc'` only when the live session still matches the current profile's scope. Re-resolve the session and scope at open/save time; never trust the stale Work Queue snapshot.

- [ ] **Step 6: Load and save actor-scoped contribution documents**

For current session + sourceRole + actorUid:
- load that actor's contribution
- load the session's visible contribution set for ADFA/authorized roles
- save suggestions/note to `session_assignment_contributions/{documentId}`
- save Topic through the normal sanitized session+calendar write path
- never put note text into `session_change_log`; audit only a safe fact such as `Teaching Assignment note updated`

- [ ] **Step 7: Keep LAB outstanding independent**

LAB group/roster editor remains accessible and may remain outstanding after ADFA readiness. Saving a roster refreshes LAB context but must not remove ADFA readiness.

- [ ] **Step 8: Run focused tests**

```bash
node --test tests/work-queue.test.js tests/workflow-functional-completion.test.js tests/timetable.test.js tests/timetable-multi-edit-ui.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add work-queue.js timetable.js tests/work-queue.test.js tests/workflow-functional-completion.test.js tests/timetable.test.js tests/timetable-multi-edit-ui.test.js
git commit -m "feat: add scoped contributor work queue"
```

---

### Task 9: ADFA Suggestion Review and Explicit Approve & Submit

**Files:**
- Modify: `timetable.js`
- Modify: `faculty-assignment.js` only if a small source/provenance helper is needed
- Modify: `tests/faculty-assignment.test.js`
- Create: `tests/adfa-assignment-submit.test.js`
- Modify: `tests/workflow-functional-completion.test.js`

**Interfaces:**
- Consumes:
  - `suggestionsForAdfa(contributions)`
  - existing `faculty-assignment.addFaculty/removeFaculty/syncSession`
  - existing timetable save / calendar projection / audit / DOE recalculation adapter
- Produces: an ADFA review UI where accepting suggestions changes only an in-memory editable final selection until explicit `Approve & Submit`.

- [ ] **Step 1: Add RED test that accepting a suggestion does not mutate authoritative assignment**

```js
test('accepting suggestions prepares an editable selection but does not assign automatically',()=>{
 const state=review.acceptSuggestions({session:{assignments:[]},suggestions:[{candidateKey:'c1',displayName:'Dr X'}]});
 assert.equal(state.session.assignments.length,0);
 assert.deepEqual(state.selectedCandidateKeys,['c1']);
});
```

- [ ] **Step 2: Add RED test for multi-Faculty submit provenance**

Pin an ADFA final selection containing:
- two accepted suggestions from different sources
- one manually selected Faculty

Expected authoritative session:
- one session row
- three assignment entries
- each accepted assignment records safe source provenance such as `accepted_suggestion:hicc`
- manual assignment retains existing manual source semantics

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test tests/faculty-assignment.test.js tests/adfa-assignment-submit.test.js
```

Expected: FAIL until review/submit helpers exist.

- [ ] **Step 4: Implement in-memory suggestion acceptance**

Do not call `suggestionToAssignment()`. Resolve accepted opaque candidate keys through the existing private/admin candidate mapping only inside the ADFA-authorized path, then construct final assignment rows with existing `faculty-assignment` helpers.

- [ ] **Step 5: Implement explicit `Approve & Submit`**

The button performs the existing authoritative save path:
- session `assignments[]`
- derived `facultyIds[]`
- derived `instructor`
- sanitized `calendar_sessions`
- audit
- DOE recalculation request when assignment/time facts require it

Do not add a redundant second approval-state machine or `adfaSubmittedAt` marker solely to mirror the assignment write.

- [ ] **Step 6: Add stale-session safety**

Before submit, re-read/re-resolve the live session and reject the save if relevant session fields changed since the ADFA review opened. Reuse the PR #67 stale Work Queue protection pattern.

- [ ] **Step 7: Run focused tests**

```bash
node --test tests/faculty-assignment.test.js tests/adfa-assignment-submit.test.js tests/workflow-functional-completion.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add timetable.js faculty-assignment.js tests/faculty-assignment.test.js tests/adfa-assignment-submit.test.js tests/workflow-functional-completion.test.js
git commit -m "feat: add adfa suggestion review submit"
```

---

### Task 10: Safe Availability and Coarse Workload Projection

**Files:**
- Modify: `data-index.js`
- Modify: `index-maintenance.js`
- Modify: `tests/data-index.test.js`
- Modify: `tests/index-maintenance.test.js`
- Modify: `firestore.rules`
- Create: `tests/faculty-capacity-security-emulator.test.js`
- Modify: `timetable.js`

**Interfaces:**
- Consumes:
  - existing opaque candidate keys
  - existing sanitized unavailable date windows
  - optional approved `settings/faculty_capacity_policy`
  - authoritative/admin-only Faculty workload source during trusted index rebuild
- Produces public-safe `settings/faculty_capacity_index` entries:
  - `key`
  - `name`
  - `availability`: `available|limited|unavailable|unknown`
  - `workload`: `available_capacity|near_load|at_load|overload|needs_review`

- [ ] **Step 1: Add RED tests for safe projection and missing policy**

```js
test('capacity projection contains no exact DOE or private fields',()=>{
 const row=api.buildSafeCapacityEntry({key:'k1',name:'Dr X',workloadPolicy:null});
 assert.deepEqual(Object.keys(row).sort(),['availability','key','name','workload']);
 assert.equal(row.workload,'needs_review');
});

test('missing workload threshold policy fails closed to Needs Review',()=>{
 const row=api.buildSafeCapacityEntry({key:'k1',name:'Dr X',workloadPolicy:null});
 assert.equal(api.capacityDisplay(row).workloadLabel,'Needs Review');
});
```

- [ ] **Step 2: Add RED tests for availability vocabulary**

Map existing safe assessment to:
- definite clear => Available
- possible conflict => Limited
- conflict/AFC date-window conflict => Unavailable
- insufficient timing/data => Unknown

Do not surface AFC reason text.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test tests/data-index.test.js tests/index-maintenance.test.js
```

Expected: FAIL until capacity projection exists.

- [ ] **Step 4: Implement safe projection without inventing thresholds**

If `settings/faculty_capacity_policy` is absent or invalid, emit `needs_review`.

If an approved policy exists, it may define threshold boundaries that the trusted index builder applies to authoritative workload facts. The browser receives only the resulting category, never the numeric DOE, target, variance, or formula.

Do not seed threshold values in this task.

- [ ] **Step 5: Extend derived-index maintenance**

Add `faculty_capacity_index` to the rebuild/verify lifecycle. Reuse existing opaque key ownership from `faculty_swap_map` so candidate identity stays stable.

- [ ] **Step 6: Add Firestore read rule and emulator tests**

Authorized suggestion roles and ADFA may read `faculty_capacity_index`. Other Office is denied if the existing restricted-office policy requires it. Exact DOE collections remain denied to contributor roles.

- [ ] **Step 7: Render only safe labels in contributor and ADFA candidate pickers**

Never ship hidden exact numbers to the client DOM. The UI consumes only the safe projection.

- [ ] **Step 8: Run focused + emulator tests**

```bash
node --test tests/data-index.test.js tests/index-maintenance.test.js
npm run test:emulator
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add data-index.js index-maintenance.js firestore.rules timetable.js tests/data-index.test.js tests/index-maintenance.test.js tests/faculty-capacity-security-emulator.test.js
git commit -m "feat: add safe faculty capacity projection"
```

---

### Task 11: DOE Regression Guards for Subject and Scoped Roles

**Files:**
- Modify: `server/test/calculation-service.test.js`
- Modify: `server/test/workflow-preview-service.test.js`
- Modify: `tests/doe-reconciliation.test.js`
- Modify: `tests/timetable-multi-edit-ui.test.js`
- Production DOE engine files should remain unchanged unless a regression test exposes a real bug.

**Interfaces:**
- Consumes: existing DOE calculation service, policy engine, course mappings, Subject mappings, workflow preview.
- Produces: regression evidence that the Teaching Assignment redesign does not change DOE semantics.

- [ ] **Step 1: Add a test that Subject-only session changes do not force Teaching DOE recalculation when no active teaching rule declares Subject relevance**

Construct before/after assignment facts identical except `subjectKey`. Use an active teaching bundle whose relevant fields do not include `subjectKey`.

Expected: workflow preview reports no Teaching DOE delta/recalculation requirement solely from the Subject change.

- [ ] **Step 2: Add a test that suggestion/note writes never call DOE preparation**

In timetable/source tests, assert contribution-only save code does not call `createDoeAdapter().prepareSession` and does not create `doe_recalculation_requests`.

- [ ] **Step 3: Add HICC per-course DOE tests**

Use two HICC role assignments with the same Faculty and role but different `courseCode` values and distinct active `doe_course_mappings`/rules.

Expected: each line is calculated from its own course mapping; no result is copied from the other course.

- [ ] **Step 4: Add VISC per-Subject/course/year DOE tests**

Use VISC role assignments with distinct `subjectKey` mappings and, where the Rule Book distinguishes them, distinct course/year context.

Expected:
- each assignment resolves its own mapping
- results may differ
- missing Subject mapping throws/returns `SUBJECT_MAPPING_REQUIRED`
- ambiguous mapping fails closed

- [ ] **Step 5: Run DOE suites**

```bash
npm run test:server
node --test tests/doe-reconciliation.test.js tests/timetable-multi-edit-ui.test.js
```

Expected: PASS without hardcoding new HICC/VISC percentages.

- [ ] **Step 6: Commit**

```bash
git add server/test tests/doe-reconciliation.test.js tests/timetable-multi-edit-ui.test.js
git commit -m "test: protect scoped role doe behavior"
```

---

### Task 12: Explicit Approval Regression, Schema Docs, Demo Fixtures, and Full Verification

**Files:**
- Modify: `docs/database/SCHEMA.md`
- Modify: `tools/seed/dataset.js`
- Modify: `tests/seed-dataset.test.js`
- Modify: `tools/browser-smoke.js`
- Modify tests only as needed to reflect the approved normal-preparation behavior; do not relax explicit approval assertions.

**Interfaces:**
- Consumes: all earlier task outputs.
- Produces: documented schema, deterministic demo fixtures, full regression evidence, and a remote feature branch ready for acceptance review.

- [ ] **Step 1: Document the new schema contracts**

Add exact documentation for:
- user academic scope representation
- canonical `subjectKey`
- `session_assignment_contributions`
- temporary all-active-user LAB roster read policy
- `faculty_capacity_index`
- separation between normal preparation and explicit Change Request approval
- DOE independence of role/course/Subject/year

- [ ] **Step 2: Update seed/demo fixtures**

Add deterministic demo profiles/sessions that exercise:
- HICC course-wide scope
- HICC course+Subject scope
- VISC course+Subject scope
- one user holding multiple academic responsibilities
- one LAB session with groups/roster
- one ADFA-ready session without LAB roster completion

Do not seed live Firebase in this task; update repository fixture code only.

- [ ] **Step 3: Add/retain explicit approval regression tests**

The following must remain true:
- later required offices cannot approve before earlier required offices
- Reject and Push Back behavior remains as currently specified
- resubmit/revision behavior remains intact
- normal Teaching Assignment contribution saves create no `change_request*` documents

- [ ] **Step 4: Extend browser smoke**

Pin an end-to-end demo path:
1. ADC skeleton exists.
2. HICC/VISC scoped Topic contribution is visible only where authorized.
3. suggestions/notes coexist.
4. LAB roster is readable by a normal active authenticated user.
5. ADFA becomes ready from skeleton + Topic even if LAB roster is incomplete.
6. ADFA reviews suggestions and submits multiple Faculty.
7. routed Change Request browser smoke still passes unchanged.

- [ ] **Step 5: Run all non-emulator suites**

```bash
npm test
npm run test:static
npm run test:server
```

Expected: PASS.

- [ ] **Step 6: Run the authoritative emulator suite**

```bash
npm run test:emulator
```

Expected: PASS with no skipped authorization tests that should have executed.

- [ ] **Step 7: Run static build and browser smoke**

```bash
node tools/build-static.js
node tools/browser-smoke.js --demo
```

Expected: browser smoke completes successfully, including the existing routed approval path.

- [ ] **Step 8: Re-run the Firestore rules budget guard**

```bash
node --test tests/rules-evaluation-budget.test.js
```

Expected: PASS without increasing the ceiling solely to accommodate this feature.

- [ ] **Step 9: Inspect final diff for forbidden scope changes**

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- firestore.rules approval-lifecycle.js approval-routing.js approval-state.js approval-request.js approval-finalizer.js doe-policy-engine.js
```

Expected:
- intentional Firestore changes are present
- explicit approval lifecycle files are unchanged unless a test-only compatibility fix was strictly necessary and separately reviewed
- DOE engine formulas/rates were not redesigned
- no production deployment configuration was changed unintentionally

- [ ] **Step 10: Commit documentation/fixture/smoke changes**

```bash
git add docs/database/SCHEMA.md tools/seed/dataset.js tests/seed-dataset.test.js tools/browser-smoke.js tests
git commit -m "test: complete scoped workflow acceptance coverage"
```

- [ ] **Step 11: Push the verified feature branch**

```bash
git status --short
git push origin feature/scoped-parallel-assignment-workflow
```

Expected: clean worktree and remote branch updated.

- [ ] **Step 12: Produce the implementation handoff report**

Report:
- final HEAD
- commits by task
- tests executed and results
- Firestore rules budget before/after
- any approved design deviations
- remaining known limitations
- confirmation that no live Firebase/DOE/Azure write/deploy occurred
- confirmation that explicit Change Request approval remained intact
