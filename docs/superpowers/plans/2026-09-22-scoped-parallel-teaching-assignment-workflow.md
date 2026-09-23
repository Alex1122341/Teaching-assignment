# Scoped Parallel Teaching Assignment Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PAWS normal Teaching Assignment preparation with a course/Subject-scoped parallel contribution workflow, add an explicit versioned Working-versus-Published timetable boundary, retire the unused `other_office` placeholder role, and preserve explicit Change Request approvals and authoritative DOE behavior.

**Architecture:** Keep `sessions` + `calendar_sessions` as the internal Working source/projection pair and preserve existing assignment, approval, LAB-group, bulk-import, repair, and DOE engines. Add exact academic scope, actor-scoped contributions, field-based readiness, and a separate versioned `timetable_publications/{academicYearKey}` release family. Ordinary Faculty read only the active sealed Published release; internal roles use Working data according to capability/scope. Explicit routed Change Requests remain serial, with added published-base provenance and stale-apply protection.

**Tech Stack:** Vanilla JavaScript, Firebase Auth/Firestore, Firestore Security Rules, Node.js `node:test`, `@firebase/rules-unit-testing`, existing PAWS browser-smoke/static build tooling.

**Spec:** `docs/superpowers/specs/2026-09-22-scoped-parallel-teaching-assignment-workflow-design.md`

## Global Constraints

- Execute on the HOME computer in an isolated worktree; do not reconstruct or depend on the unfinished company-computer PR #67 worktree.
- Start from remote branch `feature/scoped-parallel-assignment-workflow`, which was created from `fix/workflow-functional-completion`; merge the latest `origin/main` into the feature worktree before product-code changes.
- Company WIP checkpoint `handoff/pr67-phase-a-wip@11b14aea01498efb19a7adca27cb80d69614811c` is reference evidence only. Do not merge or cherry-pick it wholesale. Reimplement only the architecture-independent D1 integrity principle: referenced LAB groups must exist/fail closed, and roster completion does not gate ADFA.
- Do not merge PR #67, force-push, deploy production Firebase, seed live production data, publish DOE, or modify Azure.
- Normal Teaching Assignment preparation is parallel and field-based; explicit Change Request approval remains a separate serial workflow.
- ADFA readiness requires course, valid date, start, end, session type, and valid Topic. Room, suggestions, notes, LAB groups, and LAB rosters do not block ADFA readiness.
- HICC/VISC authority is based on exact course scope plus optional exact Subject scope; `role == 'hicc'` or `role == 'visc'` alone never grants global authority.
- Subject uses a canonical administrator-maintained `subjectKey`; Topic is free instructional content and never an authorization key.
- Faculty suggestions are advisory only and cannot automatically become `assignments[]`.
- Teaching Assignment notes are internal to authorized Teaching Assignment roles and never enter Faculty-facing Published data.
- Full LAB roster read is temporarily allowed to every authenticated, active, password-complete PAWS user; roster write remains role-restricted.
- `sessions` remains the authoritative Working session source.
- `calendar_sessions` remains the sanitized Working projection and must retain the existing paired-write/repair/bulk-import/DOE persistence semantics.
- Do not repurpose `calendar_sessions` as Published data.
- Initial Published storage contract is:
  - `timetable_publications/{academicYearKey}` -> active pointer metadata
  - `timetable_publications/{academicYearKey}/releases/{releaseId}` -> release metadata
  - `timetable_publications/{academicYearKey}/releases/{releaseId}/sessions/{sessionId}` -> immutable Faculty-facing snapshots
- A release covers one complete Academic Year in the first implementation.
- Release lifecycle is `building -> validated -> sealed`; only a sealed release may be activated.
- The Faculty-visible publication event is an atomic `activeReleaseId` pointer switch after the complete candidate is built and validated.
- Working writes after publication never mutate an active/sealed release.
- Republish creates a new release. Restore/rollback is a new forward release derived from a prior sealed snapshot; do not move the pointer backward as the normal rollback mechanism.
- Ordinary Faculty cannot read Working `sessions` or Working `calendar_sessions`; the main Timetable reads the complete active Published release and `My Teaching` filters that same release.
- Faculty Dashboard self-mode and all Faculty self-service/session-data surfaces must use Published data only and must never fall back to Working collections.
- HICC/VISC normal Faculty view uses Published data; their Teaching Assignment tools use separately loaded exact-scope Working data.
- Publish authority is initially limited to Developer and Owner/ADFA General-equivalent high-trust authority. ADFA Regular can finalize assignments but cannot publish.
- `Approve & Submit` is session-level final assignment authority and does not publish.
- `Publish Timetable` is release-level authority and does not assign Faculty or trigger DOE.
- Subject, suggestions, notes, release build/validation/seal, pointer activation, republish, and restore-release creation do not by themselves create authoritative DOE or invent new DOE formulas.
- HICC/VISC DOE remains independently calculated per Faculty + role + course + Subject when applicable + Academic Year + active Annual DOE Rule Book.
- Missing or ambiguous DOE course/Subject mapping fails closed; no default DOE percentage may be invented.
- The legacy `other_office` role is deprecated and receives no new capability. T6 removes it from active runtime support only after a read-only dependency check confirms no active account depends on it; otherwise stop and report the migration requirement.
- Do not introduce a generic replacement for `other_office`; future offices require explicit capabilities/scopes.
- Change Requests created from a Published release retain `baseReleaseId` plus base-session evidence. Final apply must fail closed when current Working state no longer matches the reviewed base; publication provenance must not weaken serial approval order.

## Review Focus

1. **Malformed or stale academic scope data** — an empty, unknown, or malformed `academicScopeTokens` value must fail closed rather than broadening HICC/VISC authority. Task 2 adds explicit malformed-scope tests.
2. **Course/Subject normalization edge cases** — authorization may trim and canonicalize course/Subject keys, but it must never fall back to substring matching. Task 2 tests short-string and cross-Subject attacks.
3. **Concurrent contributor writes** — ADC/LAB/HICC/VISC contributions must live in actor/source-specific documents so one save cannot overwrite another contributor's suggestions or note. Task 5 pins document identity and coexistence.
4. **Missing coarse workload policy** — candidate workload must render `Needs Review` without exposing exact DOE when no approved threshold policy is configured. Task 10 tests this fail-closed display.
5. **Non-scoped session types** — QUIZ/MIDTERM/OSCE/EXAM and unknown types must retain current behavior and receive no invented HICC/VISC workflow. Task 4 keeps explicit regression coverage.
6. **Working-data leakage** — ordinary Faculty must be denied direct SDK/query access to both `sessions` and `calendar_sessions`; UI filtering is not authorization. T7 emulator tests prove direct denial.
7. **Mixed/partial publication** — release documents are built invisibly, validated, sealed, then made visible only by one pointer transaction. T7/T9 pin immutability, pointer eligibility and concurrent-publisher conflict.
8. **Alternate Faculty surfaces** — timetable, My Teaching, Faculty Dashboard self-mode and AFC/page-data integrations must all resolve Published data only. T8 adds source-contract and browser coverage.
9. **Stale Change Request base** — a request originating from an older Published release must not overwrite newer Working state. T9/T12 preserve `baseReleaseId` plus base-session stale checks.
10. **Deprecated role residue** — `other_office` must not survive as an active capability path after T6, while historical audit text may remain.

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
npm ci
npm --prefix server ci
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
- Modify: `tools/static-assets.json`
- Modify: `index.html`

**Interfaces:**
- Consumes: a user/profile object whose optional `academicScopeTokens` list contains exact scope tokens such as `hicc|VTMD 505|*` and `visc|VTMD 521|imaging`.
- Produces:
  - `normalizeCourse(value) -> string`
  - `normalizeSubjectKey(value) -> string`
  - `scopeToken(responsibility, course, subjectKey='*') -> string`
  - `scopesFor(profile, responsibility) -> Array<{course:string,subjectKey:string}>`
  - `hasScope(profile, responsibility, resource) -> boolean`
  - `responsibilitiesFor(profile, resource) -> string[]`
  - `canEditTopic(profile, resource) -> boolean`
  - `canSuggestFaculty(profile, resource) -> boolean`

- [ ] **Step 1: Write RED tests for course-wide and Subject-limited scope**

Add tests that pin the canonical contract:

```js
test('course-wide scope authorizes every Subject in the exact course',()=>{
 const api=load(),profile={role:'faculty',academicScopeTokens:['hicc|VTMD 505|*']};
 assert.equal(api.hasScope(profile,'hicc',{course:'VTMD 505',subjectKey:'surgery'}),true);
 assert.equal(api.hasScope(profile,'hicc',{course:'VTMD 506',subjectKey:'surgery'}),false);
});

test('Subject-limited scope requires exact course and exact Subject',()=>{
 const api=load(),profile={role:'faculty',academicScopeTokens:['hicc|VTMD 506|surgery']};
 assert.equal(api.hasScope(profile,'hicc',{course:'VTMD 506',subjectKey:'surgery'}),true);
 assert.equal(api.hasScope(profile,'hicc',{course:'VTMD 506',subjectKey:'anesthesia'}),false);
});
```

- [ ] **Step 2: Add RED tests for malformed scopes and substring attacks**

```js
test('malformed academicScopeTokens fail closed',()=>{
 const api=load();
 for(const academicScopeTokens of [null,{},[''],['hicc|5|*'],['hicc|VTMD 505'],['unknown|VTMD 505|*']]){
  assert.equal(api.hasScope({role:'hicc',academicScopeTokens},'hicc',{course:'VTMD 505',subjectKey:'surgery'}),false);
 }
});

test('scope matching never uses substring matching',()=>{
 const api=load(),profile={academicScopeTokens:['hicc|VTMD 505|surgery']};
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

const RESPONSIBILITIES=new Set(['hicc','visc','rotation_coordinator']);

function scopeToken(responsibility,course,subjectKey='*'){
 const role=String(responsibility||'').trim().toLowerCase();
 const code=normalizeCourse(course);
 const subject=subjectKey==='*'?'*':normalizeSubjectKey(subjectKey);
 if(!RESPONSIBILITIES.has(role)||code.length<4||(!subject&&subject!=='*'))return'';
 return `${role}|${code}|${subject||'*'}`;
}

function scopesFor(profile,responsibility){
 const role=String(responsibility||'').trim().toLowerCase();
 return (Array.isArray(profile?.academicScopeTokens)?profile.academicScopeTokens:[])
  .map(value=>String(value||'').split('|'))
  .filter(parts=>parts.length===3&&parts[0]===role)
  .map(([,course,subjectKey])=>({course:normalizeCourse(course),subjectKey:subjectKey==='*'?'':normalizeSubjectKey(subjectKey)}))
  .filter(scope=>scope.course.length>=4);
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

Add `academic-responsibility.js` to `tools/static-assets.json` and load it before `office-capabilities.js` and `timetable.js` in `index.html`. Add a load-order assertion next to the existing office-capability load-order test.

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

Implement the Subject Catalog panel in the focused `subject-catalog-admin.js` module and mount it from `faculty-admin.html`. It must allow authorized administrators to:
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
- changing Subject alone does not create authoritative DOE\n- `subjectKey` is included in the sanitized session/calendar projection because it is non-private scheduling metadata\n- ADC/admin session write allowlists and calendar source matching accept `subjectKey` without changing ADFA readiness

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
git add subject-catalog.js subject-catalog-admin.js tests/subject-catalog.test.js tests/subject-catalog-admin.test.js tests/subject-catalog-security-emulator.test.js faculty-admin.html timetable.js timetable-selection.js calendar-session.js tests/calendar-session.test.js firestore.rules tools/static-assets.json tools/runtime-bundles.json
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

### Task 6: Scoped Capabilities, User-Management Scope Assignment, Publication Capability, and Role Cleanup

**Files:**
- Modify: `office-capabilities.js`
- Modify: `account-profile.js`
- Modify: `user-management.html`
- Modify: `user-management.js`
- Modify: `tests/office-capabilities.test.js`
- Modify: `tests/account-profile.test.js`
- Modify: `tests/user-management.test.js`
- Modify: `timetable-selection.js`
- Modify: `tests/timetable-multi-edit-ui.test.js`
- Modify: `timetable.js`
- Modify: provisioning/demo role lists that actively expose `other_office` after the migration gate
- Create: `tests/other-office-removal.test.js`

**Interfaces:**
- Consumes: `UCVM_ACADEMIC_RESPONSIBILITY.hasScope(profile,responsibility,session)`.
- Produces capabilities:
  - `canEditScopedTopic`
  - `canSuggestFacultyScoped`
  - `canPublishTimetable`
  - existing ADC/LAB/ADFA operational flags without broadening HICC/VISC.

- [ ] **Step 1: Perform the read-only `other_office` dependency gate before removal**

Use only existing safe read-only account/user inventory tooling already available to the repository/environment. Do not write live Firebase and do not create an ad hoc production credential flow.

Required result:
- no active account depends on role `other_office` -> continue removal
- any active dependency or inability to obtain trustworthy evidence -> STOP and report the migration requirement before removing runtime acceptance

Historical audit/doc strings do not count as active dependencies.

- [ ] **Step 2: Add RED capability tests**

Pin:
- HICC/VISC powers require a matching `academicScopeTokens` entry.
- cross-course/cross-Subject scope returns false.
- HICC/VISC never gain ADC/LAB/ADFA operational flags from role name or forged `officeAccess`.
- Developer and Owner/ADFA General-equivalent high-trust profiles have `canPublishTimetable == true`.
- ADFA Regular, ADC, LAB, HICC, VISC and Faculty have `canPublishTimetable == false`.
- `other_office` yields no recognized target capability after the approved removal gate.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test tests/office-capabilities.test.js tests/account-profile.test.js tests/other-office-removal.test.js
```

Expected: FAIL before capability/removal work.

- [ ] **Step 4: Add scoped capability flags without turning HICC/VISC into operational offices**

`OFFICES` remains `['adc','lab','adfa']`.

Make `office-capabilities.js` consume the academic responsibility helper. In `forProfile(profile, options)`, evaluate exact scope against `options.course` and `options.subjectKey`.

Set scoped powers only when scope matches. Do not set `canEditCourseFields`, `canEditInstructor`, LAB roster/group write, or Publish authority for HICC/VISC.

Implement `canPublishTimetable` using existing high-trust General/Owner semantics rather than a new generic role.

- [ ] **Step 5: Add academic responsibility assignment to User Management**

Extend User Management so high-trust user managers can add/remove exact scope rows:

```text
Responsibility: HICC
Course: VTMD 505
Subject: All Subjects
=> hicc|VTMD 505|*

Responsibility: VISC
Course: VTMD 521
Subject: Imaging
=> visc|VTMD 521|imaging
```

Requirements:
- course required
- Subject dropdown from active `teaching_subjects`
- `All Subjects` -> `*`
- duplicates rejected
- unknown responsibilities rejected
- ordinary Faculty cannot edit own scopes
- removing a token removes authority on the next authorization check

- [ ] **Step 6: Remove `other_office` from active runtime role support after the gate**

Remove it from:
- active role enums/selection lists
- account-profile accepted target roles
- capability maps
- User Management/provisioning choices
- timetable role branches
- active Firestore role allowlists in T7
- demo/seed supported-role fixtures
- bootstrap supported role options
- runtime/security tests that treat it as supported

Do not rewrite historical documentation/audit fixtures solely to erase the string.

Unknown/deprecated roles must fail closed.

- [ ] **Step 7: Update timetable field policy**

In `timetable-selection.editPolicy`:
- ADC may edit Topic for LEC/SRL through existing course-field authority.
- LAB may edit Topic for LAB through existing LAB authority.
- scoped HICC/VISC may edit only Topic when `canEditScopedTopic` is true.
- scoped HICC/VISC may not edit course/date/time/type/room/subjectKey/final Faculty assignment.
- Subject selection remains admin/ADC-managed canonical classification.

- [ ] **Step 8: Add selection-policy tests**

Pin HICC/VISC exact scope, cross-scope denial, normal Faculty denial, ADC LEC/SRL Topic, LAB LAB Topic, and inability for scoped roles to mutate `subjectKey`.

- [ ] **Step 9: Run focused suites**

```bash
node --test tests/office-capabilities.test.js tests/account-profile.test.js tests/user-management.test.js tests/timetable-multi-edit-ui.test.js tests/other-office-removal.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add office-capabilities.js account-profile.js user-management.html user-management.js timetable-selection.js timetable.js tests/office-capabilities.test.js tests/account-profile.test.js tests/user-management.test.js tests/timetable-multi-edit-ui.test.js tests/other-office-removal.test.js
git commit -m "feat: enforce scoped capabilities and retire placeholder office role"
```

---

### Task 7: Firestore Security for Working Data, Scoped Contributions, Roster Reads, and Versioned Publication

**Files:**
- Modify: `firestore.rules`
- Create: `tests/academic-scope-security-emulator.test.js`
- Create: `tests/assignment-contribution-security-emulator.test.js`
- Modify: `tests/lab-group-security-emulator.test.js`
- Create: `tests/timetable-publication-security-emulator.test.js`
- Create: `tests/timetable-release-immutability-emulator.test.js`
- Create: `tests/timetable-release-visibility-emulator.test.js`
- Modify: `tests/calendar-session-security-emulator.test.js`
- Modify: `tests/office-timetable-security-emulator.test.js`
- Modify: `tests/rules-evaluation-budget.test.js`

**Interfaces:**
- Consumes:
  - `users/{uid}.academicScopeTokens`
  - Working session `course` and optional `subjectKey`
  - contribution `course`, `subjectKey`, `sourceRole`, `actorUid`
  - `timetable_publications/{academicYearKey}.activeReleaseId`
  - release metadata/status and release session snapshots
- Produces:
  - exact-scope Working read/write authorization
  - Faculty denial for Working collections
  - contribution/note authorization
  - temporary roster-read policy
  - active-release-only Faculty read rules
  - sealed-release immutability and publication-pointer authorization.

- [ ] **Step 1: Add RED direct-read emulator tests for the Working/Published boundary**

Prove ordinary Faculty:
- cannot `get` or query `sessions`
- cannot `get` or query `calendar_sessions`
- cannot bypass with a document ID or different query shape
- can read the complete active sealed Published release
- cannot read building, validated-but-unsealed, failed, inactive or guessed release IDs
- cannot read Published data when inactive or password-change-required

These are security-rule assertions, not UI tests.

- [ ] **Step 2: Add RED exact-scope Working read/write tests for HICC/VISC**

Pin:
- course-wide token can query/read that exact course
- Subject token requires exact course + exact `subjectKey`
- cross-course and cross-Subject reads fail
- role name with no matching token fails
- Topic text never grants access
- HICC/VISC cannot mutate `course` or `subjectKey` to move a session into scope
- UI/query shape must include the same exact scope constraints required by rules

Firestore rules do not filter query results; broad HICC/VISC queries must be denied.

- [ ] **Step 3: Add RED contribution/note privacy tests**

Pin:
- ADC/LAB/ADFA/high-trust read workflow contributions
- matching scoped HICC/VISC read applicable contributions only
- actor writes only their own source-role document
- ordinary Faculty read denied
- forbidden private suggestion fields denied
- note body never appears in broad/public audit payloads

- [ ] **Step 4: Rewrite roster-read tests to the approved temporary policy**

Every `ready()` user may read `lab_group_rosters`.

Keep roster writes restricted.

Also pin:
- anonymous/inactive/password-change-required denied
- missing referenced LAB group fails closed in integrity helpers
- roster content is not allowed in `calendar_sessions` or release sessions

- [ ] **Step 5: Add RED release visibility/immutability tests**

Use the locked hierarchy:

```text
timetable_publications/{academicYearKey}
timetable_publications/{academicYearKey}/releases/{releaseId}
timetable_publications/{academicYearKey}/releases/{releaseId}/sessions/{sessionId}
```

Pin:
- Faculty release-session read requires pointer `activeReleaseId == releaseId`
- release metadata must be sealed/eligible
- knowing an inactive release ID grants nothing
- ordinary users cannot create/update/delete release metadata or sessions
- sealed release metadata/sessions cannot be modified
- active release cannot be deleted
- only explicit high-trust Publish authority may change the pointer
- pointer cannot be set to non-sealed/failed/missing release metadata
- missing/corrupt pointer produces denial, never Working fallback

Rules cannot count arbitrary release-session completeness; that remains a trusted application validation in T9.

- [ ] **Step 6: Extend user profile validation for `academicScopeTokens` and remove deprecated runtime role**

Validate:
- bounded list of strings
- exact grammar `responsibility|COURSE|subject`
- responsibility in `hicc|visc|rotation_coordinator`
- bounded components without `|`
- Subject may be `*`
- malformed data fails closed
- role name alone grants no scope

After the T6 migration gate passed, remove `other_office` from active `readySignedIn`/`explicitRole` authorization.

- [ ] **Step 7: Add exact-match rule helpers using the already-loaded profile**

Use `profile().academicScopeTokens`; do not add `user_scopes/{uid}` or query `faculty_groups` for authorization.

Create minimal helpers equivalent to:
- `hasAcademicCourseScope(responsibility, course)`
- `hasAcademicSubjectScope(responsibility, course, subjectKey)`
- `hasAcademicScope(responsibility, course, subjectKey)`

Keep rules-budget cost explicit.

- [ ] **Step 8: Add scoped Working session/calendar rules**

Working authorization target:
- Developer/Owner/ADFA -> authorized full Working access according to existing high-trust policy
- ADC/LAB -> existing Working operational access, with their established private/sanitized boundaries
- HICC/VISC -> exact scoped Working read plus Topic-only write
- ordinary Faculty -> no Working session/calendar read
- deprecated/unknown roles -> fail closed

Preserve the existing `sessions <-> calendar_sessions` paired-write invariant for Working mutations.

- [ ] **Step 9: Add contribution rules**

Safe allowlisted document only:
- actor/source-specific identity
- note <= 2000
- safe suggestions only
- no UCID/email/raw Faculty ID/exact DOE/AFC/HR fields
- exact scope for HICC/VISC writes

- [ ] **Step 10: Add publication rule helpers**

Implement the smallest rule set needed for:
- publisher authority
- pointer-to-sealed-release eligibility
- active-release-only Faculty read
- sealed snapshot immutability
- delete protection
- account readiness

Do not raise the expression ceiling merely to support publication. Keep publication helpers in a distinct/simple rule domain where practical.

- [ ] **Step 11: Run rules-budget guard immediately**

```bash
node --test tests/rules-evaluation-budget.test.js
```

Expected: PASS at or below the reviewed ceilings. If not, simplify before continuing.

- [ ] **Step 12: Run complete emulator suite**

```bash
npm run test:emulator
```

Expected: PASS, including explicit routed-approval regressions.

- [ ] **Step 13: Commit**

```bash
git add firestore.rules tests/academic-scope-security-emulator.test.js tests/assignment-contribution-security-emulator.test.js tests/lab-group-security-emulator.test.js tests/calendar-session-security-emulator.test.js tests/office-timetable-security-emulator.test.js tests/timetable-publication-security-emulator.test.js tests/timetable-release-immutability-emulator.test.js tests/timetable-release-visibility-emulator.test.js tests/rules-evaluation-budget.test.js
git commit -m "feat: enforce working published timetable boundary"
```

---

### Task 8: Work Queue, Scoped Working Queries, and Faculty Published-Only UI

**Files:**
- Modify: `work-queue.js`
- Modify: `tests/work-queue.test.js`
- Create: `timetable-publication.js`
- Create: `tests/timetable-publication.test.js`
- Modify: `timetable.js`
- Modify: `faculty-admin.js`
- Modify: `tests/faculty.test.js`
- Modify: `tests/workflow-functional-completion.test.js`
- Modify: `tests/timetable.test.js`
- Create: `tests/faculty-published-source-contract.test.js`
- Modify: `tools/static-assets.json`
- Modify: `tools/runtime-bundles.json`

**Interfaces:**
- Consumes:
  - `UCVM_ACADEMIC_RESPONSIBILITY`
  - `UCVM_ASSIGNMENT_CONTRIBUTIONS`
  - `preparationReadiness`
  - publication pointer + active release read helper
  - existing `UCVM_PAGE_DATA.openScopedEditor`
- Produces:
  - HICC/VISC scoped Topic work items
  - exact-scope Working queries for contributor tools
  - contribution editor controls
  - Published-only ordinary Faculty Timetable/My Teaching/Faculty Dashboard self-mode
  - safe no-release/corrupt-release state.

- [ ] **Step 1: Add RED Work Queue tests**

Pin:
- missing Topic + matching HICC/VISC scope -> scoped work item
- completed Topic -> no blocking item
- optional suggestion/note absence never blocks
- cross-course/cross-Subject sessions never appear
- LAB roster outstanding remains independent from ADFA readiness

- [ ] **Step 2: Add RED publication read-helper tests**

Create a pure/read-focused `timetable-publication.js` contract.

Pin:
- resolve the Academic-Year pointer first
- load only the pointer-selected sealed release
- no pointer -> explicit `not_published` result
- missing/failed/unsealed/mismatched release -> explicit fail-closed error/result
- never choose "latest" release
- never fall back to `sessions` or `calendar_sessions`
- cache identity is keyed by Academic Year + release ID so mixed-version display cannot occur

Do not add write/publish operations yet; T9 owns publication writes.

- [ ] **Step 3: Add RED source-contract tests for every Faculty-facing path**

Ordinary Faculty must use Published data in:
- main Timetable
- My Teaching
- Faculty Dashboard self-mode
- page-data/AFC integrations that consume timetable sessions

Pin that ordinary Faculty paths do not query `sessions` or `calendar_sessions`.

The main Timetable may show the entire active release. `My Teaching` filters that same already-authorized release.

- [ ] **Step 4: Add RED HICC/VISC scoped-query tests**

HICC/VISC have two data paths:
- normal Faculty view -> Published release
- Teaching Assignment work tools -> Working data queried by exact authorized course/Subject scope

For multiple tokens, execute separate exact queries and merge/dedupe client-side. Never issue a broad query and filter only in the browser.

- [ ] **Step 5: Run focused tests and verify RED**

```bash
node --test tests/work-queue.test.js tests/timetable-publication.test.js tests/faculty-published-source-contract.test.js tests/faculty.test.js tests/workflow-functional-completion.test.js tests/timetable.test.js
```

Expected: FAIL before the read-path changes.

- [ ] **Step 6: Implement the Published resolver and role-correct timetable source**

For ordinary Faculty/HICC/VISC normal calendar view:
- resolve active release for selected Academic Year
- subscribe/load its release-session subcollection
- render Published badge/state
- if no release exists show `Timetable has not yet been published.`
- if pointer/release is invalid show controlled unavailable state
- never expose Working fallback

For ADC/LAB/ADFA/Developer-Owner internal view:
- retain authorized Working source behavior
- label the surface `Working` so it is not confused with Published state

- [ ] **Step 7: Implement HICC/VISC Working contribution loading separately**

Do not reuse the Published session cache for scoped Working tools.

Load exact authorized Working sessions per token and keep this cache separate from Faculty-visible release sessions.

Re-resolve scope on open/save.

- [ ] **Step 8: Extend contribution editor**

Authorized contributor may see:
- Topic when permitted
- safe multi-select Faculty suggestions
- one actor-owned note
- no final assignment editor unless ADFA

Save Topic through Working `sessions + calendar_sessions`; save suggestion/note through actor contribution doc.

- [ ] **Step 9: Convert Faculty Dashboard self-mode to Published sessions**

Replace `listenFacultySessions(facultyId)` as a Working-source dependency for self-service.

Self-mode must consume the active Published release and then filter the user’s own displayed assignments using safe Published fields/current self identity.

Admin mode remains an internal Working/authoritative administrative surface.

- [ ] **Step 10: Preserve LAB independence**

LAB group/roster UI remains available and may stay outstanding after ADFA readiness. Roster updates never change Published data until an explicit future Publish.

- [ ] **Step 11: Run focused + static tests**

```bash
node --test tests/work-queue.test.js tests/timetable-publication.test.js tests/faculty-published-source-contract.test.js tests/faculty.test.js tests/workflow-functional-completion.test.js tests/timetable.test.js tests/timetable-multi-edit-ui.test.js
npm run test:static
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add work-queue.js timetable-publication.js timetable.js faculty-admin.js tools/static-assets.json tools/runtime-bundles.json tests/work-queue.test.js tests/timetable-publication.test.js tests/faculty-published-source-contract.test.js tests/faculty.test.js tests/workflow-functional-completion.test.js tests/timetable.test.js tests/timetable-multi-edit-ui.test.js
git commit -m "feat: separate working and published timetable views"
```

---

### Task 9: ADFA Approve & Submit, Versioned Publish Timetable, and Published-Base Stale Protection

**Files:**
- Modify: `timetable.js`
- Modify: `timetable-publication.js`
- Modify: `faculty-assignment.js` only if a small source/provenance helper is needed
- Modify: `approval-request.js` only for immutable Published-base provenance
- Modify: `approval-finalizer.js` only for stale-base validation; do not alter routing/order
- Modify: `firestore.rules` only if T7 publication/request shape needs a small companion adjustment
- Modify: `tests/faculty-assignment.test.js`
- Create: `tests/adfa-assignment-submit.test.js`
- Create: `tests/adfa-approve-submit-not-publish.test.js`
- Create: `tests/timetable-publication-activation.test.js`
- Create: `tests/timetable-publication-concurrency.test.js`
- Create: `tests/timetable-working-published-isolation.test.js`
- Create: `tests/timetable-publication-private-fields.test.js`
- Create: `tests/timetable-publication-no-doe.test.js`
- Create: `tests/change-request-published-provenance.test.js`
- Create: `tests/change-request-stale-base.test.js`
- Modify: `tests/workflow-functional-completion.test.js`

**Interfaces:**
- Consumes:
  - `suggestionsForAdfa(contributions)`
  - existing multi-Faculty assignment helpers
  - existing authoritative Working save/calendar/audit/DOE adapter
  - `timetable-publication.js` read helper from T8
  - current complete Academic-Year Working dataset
- Produces:
  - ADFA review UI with explicit `Approve & Submit`
  - a separate explicit `Publish Timetable` action for high-trust publishers
  - immutable versioned release build/validate/seal/activate behavior
  - Change Request `baseReleaseId` provenance and stale Working-base protection.

- [ ] **Step 1: Add RED test that suggestion acceptance is in-memory only**

Accepting suggestions prepares an editable selection but does not mutate authoritative `assignments[]` until `Approve & Submit`.

- [ ] **Step 2: Add RED multi-Faculty submit test**

Pin two accepted suggestions from different sources plus one manual Faculty:
- one session
- three assignment entries
- safe provenance
- normal derived `facultyIds`/`instructor`
- no publication pointer mutation

- [ ] **Step 3: Add RED separation tests**

Pin:
- `Approve & Submit` changes Working assignment and may invoke existing DOE recalculation when Rule Book-relevant facts changed
- `Approve & Submit` never creates/seals/activates a timetable release
- `Publish Timetable` never changes authoritative assignments
- Publish build/validate/seal/activate never calls DOE
- Working changes after an active release do not mutate the release snapshot

- [ ] **Step 4: Add RED strict Published-session sanitizer tests**

Implement publication snapshot construction with an explicit allowlist, never `{...session}`.

Allowed display fields should be intentionally enumerated from the approved public scheduling contract, including canonical `subjectKey` where present.

Forbidden in serialized release sessions:
- notes
- contributions
- suggestions
- student/roster data
- exact DOE/target/variance/formula
- AFC/HR details
- private Faculty identifiers
- internal approval/audit bodies

- [ ] **Step 5: Add RED release lifecycle tests**

For one complete Academic Year:
1. read a consistent Working source snapshot
2. compute deterministic `sourceFingerprint`
3. record `basedOnActiveReleaseId`
4. create candidate metadata `building`
5. write all sanitized release-session documents while candidate remains invisible
6. validate expected session count, identity/year, sanitizer shape and source fingerprint
7. mark candidate `validated`
8. seal it
9. activate by one pointer transaction

Pin:
- no partial candidate is Faculty-visible
- failed build leaves old pointer unchanged
- missing/incomplete candidate cannot activate
- sealed release is immutable

- [ ] **Step 6: Add RED concurrent-publisher test**

Publisher A and B build against the same current pointer.

A activates first.

B activation transaction sees that `activeReleaseId` no longer equals `basedOnActiveReleaseId` and fails with a publication conflict.

B must rebuild from current Working state; do not allow blind pointer retry.

- [ ] **Step 7: Implement in-memory suggestion acceptance and explicit ADFA `Approve & Submit`**

Resolve opaque candidate keys only in the authorized ADFA path. Use existing assignment helpers.

Submit performs only:
- Working `sessions.assignments[]`
- derived `facultyIds[]`
- derived `instructor`
- Working `calendar_sessions`
- audit
- DOE recalculation request when existing policy says relevant

No `adfaSubmittedAt` mirror state and no Publish side effect.

- [ ] **Step 8: Implement release builder/validator/sealer**

Extend `timetable-publication.js`.

Requirements:
- build from canonical Working data for exactly one Academic Year
- use explicit snapshot allowlist
- fail if any included session cannot resolve required publication identity/year
- fail on missing referenced LAB group integrity
- roster completion is not a publication-readiness gate
- room may be blank
- optional suggestions/notes irrelevant
- validation rechecks the current Working source fingerprint before seal/activation
- release session count must match the validated source snapshot
- candidate failure records safe metadata only and never alters active pointer

- [ ] **Step 9: Implement explicit high-trust Publish control**

Expose `Publish Timetable` only when `canPublishTimetable` is true.

Do not reuse the legacy `publish-firestore-schedule` label for this semantic action. Rename the old initialization/synchronization control so "Publish" means Faculty release only.

The Publish UI must show:
- Academic Year
- current active release ID/time if present
- Working-vs-Published state
- candidate validation result
- explicit final confirmation

- [ ] **Step 10: Implement atomic activation**

Use a Firestore transaction on the Academic-Year pointer:
- re-read current `activeReleaseId`
- require equality with candidate `basedOnActiveReleaseId`
- require candidate metadata sealed/eligible
- switch to candidate release ID
- write safe publication audit metadata

The activation event is the only Faculty-visible cutover.

- [ ] **Step 11: Implement restore-as-new-release, not pointer rollback**

If restore tooling is included in this phase, it copies a prior sealed snapshot into a new candidate, validates/seals it, and publishes a new release ID.

Do not add "set pointer to arbitrary old release" as a normal rollback control.

- [ ] **Step 12: Add Published provenance to Change Requests**

When a Faculty request originates from Published view:
- record immutable `baseReleaseId`
- retain stable base-session public evidence/fingerprint using the existing request base model
- client cannot alter provenance during later lifecycle steps

Do not change which offices approve the request.

- [ ] **Step 13: Extend final apply stale protection**

Before applying an approved request:
- re-resolve current Working session
- compare current relevant base facts with the request's reviewed base evidence
- if different, fail closed as stale / Needs Review
- an active release change triggers revalidation but need not fail if the specific referenced base/session still matches safely
- missing Working session fails closed
- never recreate a deleted session from a stale Published snapshot
- preserve idempotent apply behavior

- [ ] **Step 14: Run focused suites**

```bash
node --test tests/faculty-assignment.test.js tests/adfa-assignment-submit.test.js tests/adfa-approve-submit-not-publish.test.js tests/timetable-publication.test.js tests/timetable-publication-activation.test.js tests/timetable-publication-concurrency.test.js tests/timetable-working-published-isolation.test.js tests/timetable-publication-private-fields.test.js tests/timetable-publication-no-doe.test.js tests/change-request-published-provenance.test.js tests/change-request-stale-base.test.js tests/workflow-functional-completion.test.js
```

Expected: PASS.

If `firestore.rules` changed in this task, also run:

```bash
npm run test:emulator
```

- [ ] **Step 15: Commit**

```bash
git add timetable.js timetable-publication.js faculty-assignment.js approval-request.js approval-finalizer.js firestore.rules tests/faculty-assignment.test.js tests/adfa-assignment-submit.test.js tests/adfa-approve-submit-not-publish.test.js tests/timetable-publication-activation.test.js tests/timetable-publication-concurrency.test.js tests/timetable-working-published-isolation.test.js tests/timetable-publication-private-fields.test.js tests/timetable-publication-no-doe.test.js tests/change-request-published-provenance.test.js tests/change-request-stale-base.test.js tests/workflow-functional-completion.test.js
git commit -m "feat: add explicit versioned timetable publication"
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

Authorized suggestion roles and ADFA may read `faculty_capacity_index` according to their approved role/scope. The deprecated `other_office` role receives no runtime access. Exact DOE collections remain denied to contributor roles.

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
- Verify production DOE engine files remain unchanged; if a regression test exposes a pre-existing engine bug, stop and report it before modifying DOE production code.

**Interfaces:**
- Consumes: existing DOE calculation service, policy engine, course mappings, Subject mappings, workflow preview.
- Produces: regression evidence that the Teaching Assignment redesign does not change DOE semantics.

- [ ] **Step 1: Add a test that Subject-only session changes do not force Teaching DOE recalculation when no active teaching rule declares Subject relevance**

Construct before/after assignment facts identical except `subjectKey`. Use an active teaching bundle whose relevant fields do not include `subjectKey`.

Expected: workflow preview reports no Teaching DOE delta/recalculation requirement solely from the Subject change.

- [ ] **Step 2: Add tests that contribution and publication actions never call DOE preparation**

In timetable/source tests, assert:
- contribution-only suggestion/note save does not call `createDoeAdapter().prepareSession`
- contribution-only save creates no `doe_recalculation_requests`
- release build/validate/seal creates no DOE work
- active release pointer switch creates no DOE work
- republish/restore-release creation creates no DOE work

Keep the positive regression that authoritative final assignment still invokes the existing DOE path when Rule Book-relevant facts changed.

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

### Task 12: Schema, Explicit Approval and Publication Regression, Demo Fixtures, and Full Verification

**Files:**
- Modify: `docs/database/SCHEMA.md`
- Modify: `tools/seed/dataset.js`
- Modify: `tests/seed-dataset.test.js`
- Modify: `tools/browser-smoke.js`
- Modify/add tests only as needed to reflect the approved architecture; do not relax explicit approval/security assertions.

**Interfaces:**
- Consumes: all T1-T11 outputs.
- Produces: documented schema, deterministic demo fixtures, release/security regression evidence, browser proof, and a remote feature branch ready for independent acceptance review.

- [ ] **Step 1: Document the final schema contracts**

Document:
- `academicScopeTokens` grammar
- canonical `subjectKey`
- `session_assignment_contributions`
- temporary all-ready-user LAB roster read policy
- `faculty_capacity_index`
- Working semantics of `sessions` and `calendar_sessions`
- `timetable_publications/{academicYearKey}` active pointer
- release metadata lifecycle `building -> validated -> sealed`
- immutable release-session snapshot shape
- one-complete-Academic-Year release scope
- publication authority and separation from ADFA final assignment
- Faculty Published-only surfaces
- Change Request `baseReleaseId`/base-session provenance
- DOE non-trigger from publication
- deprecated `other_office` target-runtime removal

- [ ] **Step 2: Update deterministic demo fixtures**

Include:
- HICC course-wide scope
- HICC course+Subject scope
- VISC course+Subject scope
- multiple responsibilities on one user
- LAB group/roster
- ADFA-ready session with incomplete roster
- one sealed active Published release
- newer Working changes not present in that release
- one safe no-release Academic Year fixture
- no supported `other_office` runtime fixture

Do not seed live Firebase.

- [ ] **Step 3: Add/retain explicit Change Request regression**

Must remain true:
- later offices cannot approve before earlier applicable offices
- Reject, Push Back, resubmit/revision behavior remains intact
- normal contribution saves create no `change_request*` documents
- Published-origin request preserves `baseReleaseId`
- stale Working base prevents final apply
- routing/order is unchanged by publication provenance

- [ ] **Step 4: Add publication security/integrity regression matrix**

Pin:
- Faculty direct Working get/query denied
- Faculty direct Working calendar get/query denied
- active sealed release allowed
- guessed inactive release denied
- building/failed/unsealed release denied
- sealed snapshot immutable
- active release delete denied
- unauthorized pointer update denied
- invalid/missing pointer fails closed
- no fallback to Working
- strict Published allowlist excludes note/suggestion/roster/DOE/HR/private IDs
- Working edits after publish do not mutate active release
- republish creates a new version
- concurrent publisher loser conflicts
- inactive/password-change-required user denied
- `other_office` grants no active runtime authority

- [ ] **Step 5: Extend browser smoke**

Pin end-to-end paths:

Internal Working:
1. ADC skeleton exists.
2. HICC/VISC scoped Topic work is visible only in scope.
3. suggestions/notes coexist.
4. normal active authenticated user can read LAB roster.
5. ADFA ready from skeleton + Topic even with incomplete roster.
6. ADFA submits multiple Faculty.
7. Working view reflects final assignment.

Published:
8. before Publish, ordinary Faculty still sees prior active release.
9. high-trust publisher builds/validates/seals/activates a new release.
10. Faculty Timetable switches as one release.
11. My Teaching filters the same active release.
12. Faculty Dashboard self-mode uses the same Published source.
13. later Working edit remains invisible until republish.
14. no-release/corrupt-pointer states show controlled fail-closed UI.
15. routed Change Request browser smoke still passes with serial approval.

- [ ] **Step 6: Run all non-emulator suites**

```bash
npm test
npm run test:static
npm run test:server
```

Expected: PASS.

- [ ] **Step 7: Run authoritative emulator suite**

```bash
npm run test:emulator
```

Expected: PASS with all new security tests executed.

- [ ] **Step 8: Run static build and browser smoke**

```bash
node tools/build-static.js
node tools/browser-smoke.js --demo
```

Expected: PASS, including Published release switch and existing routed approval path.

- [ ] **Step 9: Re-run Firestore rules budget guard**

```bash
node --test tests/rules-evaluation-budget.test.js
```

Expected: PASS without raising a ceiling solely to accommodate the feature.

- [ ] **Step 10: Search for forbidden runtime residue**

```bash
git grep -n "other_office" -- ':!docs/**'
git grep -n "calendar_sessions" timetable.js faculty-admin.js
git grep -n "activeReleaseId" .
```

Expected:
- no active runtime authorization/provisioning support for `other_office`
- historical/migration test text may remain only where intentionally asserting denial
- ordinary Faculty source paths do not use Working `calendar_sessions`
- publication pointer use is explicit and reviewable

- [ ] **Step 11: Inspect final diff for protected subsystems**

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- firestore.rules approval-lifecycle.js approval-routing.js approval-state.js approval-request.js approval-finalizer.js doe-policy-engine.js
```

Expected:
- publication/scoped rule changes are intentional
- approval-request/finalizer changes are limited to approved provenance/stale-base protection
- approval routing/order semantics are unchanged
- DOE formulas/rates are not redesigned
- no deployment configuration changed unintentionally

- [ ] **Step 12: Commit documentation/fixture/smoke changes**

```bash
git add docs/database/SCHEMA.md tools/seed/dataset.js tests/seed-dataset.test.js tools/browser-smoke.js tests
git commit -m "test: complete publication and scoped workflow acceptance coverage"
```

- [ ] **Step 13: Push the verified feature branch**

```bash
git status --short
git push origin feature/scoped-parallel-assignment-workflow
```

Expected: clean worktree and updated remote.

- [ ] **Step 14: Produce implementation handoff report**

Report:
- final HEAD
- commits by task
- tests/results
- rules-budget before/after
- publication schema and active release ID used in demo
- any approved design deviations
- remaining known limitations
- confirmation no live Firebase/DOE/Azure write/deploy occurred
- confirmation explicit Change Request approval order remained intact
- confirmation ordinary Faculty have no Working timetable read path
- confirmation `other_office` no longer grants active runtime authority

---
