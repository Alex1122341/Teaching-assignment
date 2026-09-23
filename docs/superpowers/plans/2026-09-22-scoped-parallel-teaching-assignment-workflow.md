# PAWS P3.1 Grouped HICC/VISC Teaching Assignment Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the P3.1 PAWS Teaching Assignment workflow: ADC/DVM + LAB + HICC Working preparation, HICC Submit -> VISC Approve/Push Back -> HICC Final Submit -> ADFAD final assignment, plus versioned timetable publication, while preserving explicit Change Request approvals and authoritative DOE behavior.

**Architecture:** Keep `sessions` + `calendar_sessions` as the internal Working source/projection pair. HICC owns its Teaching Assignment package inside an exact Course/Subject scope; VISC reviews all HICC packages in the Teaching Assignment group it leads; only HICC performs Final Submit to ADFAD. ADFAD performs final Faculty assignment. Publication remains a separate versioned release lifecycle. Explicit Change Requests remain a separate serial workflow with published-base stale protection.

**Tech Stack:** Vanilla JavaScript, Firebase Auth/Firestore, Firestore Security Rules, Node.js `node:test`, `@firebase/rules-unit-testing`, existing PAWS browser-smoke/static build tooling.

**Spec:** `docs/superpowers/specs/2026-09-22-scoped-parallel-teaching-assignment-workflow-design.md`

## Global Constraints

- Task 1 baseline is complete and remote branch is clean at `47b2608b137bddaa0ea7bdbb0d67d92d64409fc4`.
- Execute on the HOME isolated worktree and continue on `feature/scoped-parallel-assignment-workflow`.
- Do not reconstruct or merge the company PR #67 handoff branch; it is reference evidence only.
- Do not merge PR #67, rebase, force-push, deploy Firebase/Azure, seed/repair live data, or publish DOE.
- User-facing terminology is now:
  - `ADFAD` instead of `ADFAD`
  - `ADC/DVM` instead of `ADC/DVM`
- Existing technical identifiers such as `adfa`, `adfa_general`, `adfa_regular`, and `adc` remain unchanged unless a later migration is explicitly approved.
- Normal Teaching Assignment flow is:
  - ADC/DVM skeleton + operational setup
  - LAB operational work in parallel
  - responsible HICC prepares its own package
  - HICC Submit for VISC Review
  - VISC Approve or Push Back
  - HICC Final Submit
  - ADFAD final Faculty assignment
- VISC is a group reviewer/leader, not a peer HICC content editor and not the final submitter to ADFAD.
- HICC remains exact Course/Subject scoped.
- VISC review authority comes from Teaching Assignment group leadership, not a VISC Course/Subject token.
- Use a dedicated `teaching_assignment_groups` model; do not repurpose existing `faculty_groups`.
- Working sessions carry trusted `teachingAssignmentGroupId`, `responsibleHiccUid`, and internal `teachingAssignmentSubmissionId`; HICC/VISC cannot self-edit these ownership/package-locator fields.
- HICC package review state is stored separately from explicit Change Request state.
- ADFAD queue entry requires VISC approval of the current package revision plus HICC Final Submit.
- Any review-relevant Working edit after VISC approval invalidates that approval for Final Submit.
- LAB roster/group completion never blocks HICC/VISC review or ADFAD assignment.
- `sessions` remains authoritative Working data.
- `calendar_sessions` remains sanitized Working projection.
- Ordinary Faculty never read Working `sessions`/`calendar_sessions`; they read only active Published releases.
- ADFAD Approve & Submit does not Publish.
- HICC submit/review actions, VISC approval/push-back, Publish, Subject-only changes, suggestions and notes do not trigger authoritative DOE.
- Final ADFAD assignment remains the Teaching Assignment event that may request DOE recalculation when Rule Book-relevant facts changed.
- `other_office` remains deprecated and is removed at T6 only after the approved read-only dependency gate.
- Explicit Change Request approval remains separate and serial; do not reuse its approval records for HICC/VISC package review.

## Review Focus

1. **HICC ownership** — HICC must be both `responsibleHiccUid` and exact Course/Subject authorized.
2. **VISC group boundary** — VISC may review every HICC package in groups it leads, and no package outside those groups.
3. **VISC review-only semantics** — approval/push-back does not grant Topic editing, Final Submit, final Faculty assignment, or Publish.
4. **Revision safety** — HICC Final Submit must fail unless the server-enforced current `workingRevision` still equals the submitted and VISC-approved Working revisions; fingerprint equality is an additional consistency check, not the sole authorization proof.
5. **ADFAD queue gating** — content readiness alone never creates an ADFAD queue item.
6. **LAB independence** — roster/group incompleteness remains visible to LAB but never blocks the HICC/VISC/ADFAD chain.
7. **Working-data leakage** — ordinary Faculty remain denied Working collections.
8. **Publication separation** — ADFAD assignment and timetable Publish remain independent.
9. **Change Request separation** — HICC/VISC review records are not `change_request*` documents.
10. **Terminology** — user-facing text says ADFAD and ADC/DVM while technical keys remain backward-compatible.

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
npm --prefix server install --no-save --no-audit --no-fund --package-lock=false
```

Expected: root dependencies use the committed root `package-lock.json` via `npm ci`. The server currently has no committed `package-lock.json`, so its baseline installation follows the repository's existing `npm install` model. `--no-save` prevents dependency declarations from being written back, and `--package-lock=false` prevents creation of a server lockfile. Task 1 must not change dependency declarations or upgrade dependency versions.

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

### Task 2: Canonical HICC Course/Subject Scope

**Files:**
- Create: `academic-responsibility.js`
- Create: `tests/academic-responsibility.test.js`
- Modify: `tools/static-assets.json`
- Modify: `index.html`

**Interfaces:**
- Consumes: user/profile `academicScopeTokens`.
- Produces:
  - `normalizeCourse(value)`
  - `normalizeSubjectKey(value)`
  - `scopeToken(responsibility, course, subjectKey='*')`
  - `scopesFor(profile, responsibility)`
  - `hasScope(profile, responsibility, resource)`
  - `canHiccEditTopic(profile, resource)`
  - `canHiccSuggestFaculty(profile, resource)`

- [ ] **Step 1: Write RED HICC scope tests**

Pin:
- `hicc|VTMD 505|*` authorizes all Subjects in exact VTMD 505 only.
- `hicc|VTMD 506|surgery` authorizes exact VTMD 506 + surgery only.
- cross-course and cross-Subject denied.
- role `hicc` without matching token grants nothing.
- Topic text never affects authorization.

- [ ] **Step 2: Add malformed/sub-string attack tests**

Fail closed for:
- missing/non-array tokens
- blank token
- missing component
- extra component
- unknown responsibility
- blank/implausibly short course
- blank Subject
- substring attacks such as VTMD 505 vs VTMD 5050 and surgery vs surgery-core.

Allow future `rotation_coordinator` token parsing but do not grant it HICC behavior.

Do not use VISC Course/Subject tokens for Teaching Assignment review authority in P3.1.

- [ ] **Step 3: Verify RED**

```bash
node --test tests/academic-responsibility.test.js
```

Expected: FAIL because helper does not exist.

- [ ] **Step 4: Implement minimal exact-match helper**

Canonical tokens:

```text
hicc|VTMD 505|*
hicc|VTMD 506|surgery
rotation_coordinator|VTMD 590|*
```

Requirements:
- uppercase normalized course
- lowercase normalized Subject
- exact three-part grammar
- `*` = course-wide
- no fuzzy/substring behavior
- malformed tokens ignored/fail closed
- duplicate tokens dedupe
- HICC helper methods consider only HICC scope

Do not implement VISC group authority here; T6 owns the group model.

- [ ] **Step 5: Run focused test**

```bash
node --test tests/academic-responsibility.test.js
```

Expected: PASS.

- [ ] **Step 6: Add browser/static asset load order**

Load `academic-responsibility.js` before `office-capabilities.js` and `timetable.js`.

- [ ] **Step 7: Run regression**

```bash
npm run test:static
node --test tests/office-capabilities.test.js tests/academic-responsibility.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit and push**

```bash
git add academic-responsibility.js tests/academic-responsibility.test.js tools/static-assets.json index.html
git commit -m "feat: add exact hicc academic scopes"
git push origin feature/scoped-parallel-assignment-workflow
```

Stop after T2. Do not start T3 automatically.

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
- Security invariant: HICC uses `subjectKey` for exact Course/Subject authorization; VISC review authority comes from Teaching Assignment group leadership. Neither HICC nor VISC may change `subjectKey` through scoped/review actions.

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

ADC/DVM may optionally classify a session with `subjectKey` using only active catalog options. High-trust admin repair paths may also set it.

Rules/UI must enforce:
- `subjectKey` is optional and is not a HICC package content-readiness gate
- HICC/VISC cannot change `subjectKey` through scoped/review actions
- Topic remains a separate free-text field
- changing Subject alone does not create authoritative DOE
- `subjectKey` is included in the sanitized session/calendar projection because it is non-private scheduling metadata
- ADC/DVM/admin session write allowlists and calendar source matching accept `subjectKey` without automatically advancing HICC/VISC review or ADFAD queue state

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

### Task 4: HICC Package Readiness and VISC Review State Model

**Files:**
- Create: `teaching-assignment-review.js`
- Create: `tests/teaching-assignment-review.test.js`
- Modify: `session-workflow.js`
- Modify: `tests/workflow-functional-completion.test.js`
- Modify: `tools/static-assets.json`
- Modify: `index.html`

**Interfaces:**
- `contentReadiness(session)`
- `reviewFingerprint(sessions, suggestions)`
- `canSubmitForViscReview(package, sessions)`
- `canViscApprove(package, currentFingerprint)`
- `canHiccFinalSubmit(package, currentFingerprint)`
- lifecycle: `draft -> visc_review -> changes_requested|visc_approved -> submitted_to_adfad -> adfad_finalized`

- [ ] **Step 1: RED content-readiness tests**

Required:
- course
- valid date
- start/end
- type
- valid Topic

Not blockers:
- room
- LAB group/roster completion
- optional suggestion/note.

- [ ] **Step 2: RED lifecycle tests**

Pin:
- only HICC can submit own package for VISC review;
- VISC can Approve or Push Back;
- VISC cannot Final Submit;
- HICC cannot Final Submit before VISC approval;
- HICC Final Submit requires exact current approved fingerprint;
- review-relevant edit invalidates prior VISC approval;
- Push Back requires HICC revision/resubmission;
- package review creates no explicit Change Request record.

- [ ] **Step 3: Implement pure review model**

Fingerprint includes reviewed stable package/session facts:
- session IDs
- course/subjectKey
- date/start/end/type/room
- Topic
- safe HICC Faculty suggestions

Exclude:
- private notes
- LAB roster contents
- DOE values.

- [ ] **Step 4: Adapt normal preparation readiness**

`session-workflow.js` may expose content readiness, but fields alone must not create ADFAD readiness.

Do not alter explicit Change Request routing/order.

- [ ] **Step 5: Run focused/static tests**

```bash
node --test tests/teaching-assignment-review.test.js tests/workflow-functional-completion.test.js
npm run test:static
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add teaching-assignment-review.js tests/teaching-assignment-review.test.js session-workflow.js tests/workflow-functional-completion.test.js tools/static-assets.json index.html
git commit -m "feat: add hicc visc review state model"
```

---

### Task 5: ADC/DVM, LAB, and HICC Actor-Scoped Contributions

**Files:**
- Modify: `faculty-suggestions.js`
- Modify: `tests/faculty-suggestions.test.js`
- Create: `assignment-contributions.js`
- Create: `tests/assignment-contributions.test.js`
- Modify: `tools/static-assets.json`
- Modify: `index.html`

**Interfaces:**
- technical contribution sources: `adc`, `lab`, `hicc`
- `documentId(sessionId, sourceRole, actorUid)`
- `createContribution(...)`
- `sanitizeContribution(...)`
- `suggestionsForAdfad(contributions)`

- [ ] **Step 1: RED safe suggestion tests**

ADC/DVM, LAB and HICC may create safe suggestions where permitted.

VISC is not a peer contribution source; VISC review comments belong to the submission/review record.

- [ ] **Step 2: RED actor-isolation tests**

One actor/source document cannot overwrite another actor/source document.

- [ ] **Step 3: Implement safe contribution model**

```js
{
  sessionId,
  course,
  subjectKey,
  sourceRole,       // adc | lab | hicc
  actorUid,
  actorDisplayName,
  suggestions:[{candidateKey,displayName,...safe provenance}],
  note,
  updatedAt
}
```

No UCID/email/raw private Faculty ID/exact DOE/AFC reason/HR data. Note <= 2000 characters.

- [ ] **Step 4: Preserve suggestion-is-not-assignment**

Saving/accepting a suggestion never mutates authoritative `assignments[]`.

- [ ] **Step 5: Asset wiring and tests**

```bash
node --test tests/faculty-suggestions.test.js tests/assignment-contributions.test.js
npm run test:static
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add faculty-suggestions.js assignment-contributions.js tests/faculty-suggestions.test.js tests/assignment-contributions.test.js tools/static-assets.json index.html
git commit -m "feat: add teaching assignment contributions"
```

---

### Task 6: Teaching Assignment Groups, Role Capabilities, User Management, Terminology, and Role Cleanup

**Files:**
- Create: `teaching-assignment-groups.js`
- Create: `tests/teaching-assignment-groups.test.js`
- Modify: `office-capabilities.js`
- Modify: `account-profile.js`
- Modify: `user-management.html`
- Modify: `user-management.js`
- Modify: `timetable-selection.js`
- Modify: `timetable.js`
- Modify relevant user-facing labels/tests
- Create: `tests/other-office-removal.test.js`

- [ ] **Step 1: Read-only `other_office` dependency gate**

No active dependency -> continue removal.

Any active dependency/inability to verify -> STOP before runtime removal.

- [ ] **Step 2: Implement pure Teaching Assignment group helper**

```js
{
  id:'bovine',
  name:'Bovine',
  leaderViscUid:'uid-visc',
  hiccUids:['uid-hicc-a','uid-hicc-b'],
  active:true
}
```

Rules:
- one VISC leader per group in first version
- VISC may lead multiple groups
- HICC membership explicit
- group `id` is immutable and canonical: `^[a-z][a-z0-9_-]{0,63}$`
- export/test deterministic `submissionDocumentId(academicYearKey, groupId, hiccUid)`
  using the locked `ta-sub-v1__...` encoding from the design
- malformed group/package identity fails closed
- existing `faculty_groups` is not reused.

- [ ] **Step 3: User Management Teaching Assignment Groups**

High-trust managers can:
- create/rename/deactivate group
- choose VISC leader
- add/remove HICC members
- assign HICC exact Course/Subject scopes.

Keep existing HICC-owned `faculty_groups` UI separate.

- [ ] **Step 4: Capabilities**

HICC:
- edit/suggest within own exact scope
- submit own package for review
- revise after Push Back
- Final Submit after valid VISC approval.

VISC:
- view all HICC packages/sessions in led groups
- Approve/Push Back
- no direct HICC Topic edit
- no Final Submit
- no final Faculty assignment.

Publish remains high-trust only.

- [ ] **Step 5: Trusted session ownership**

Support:
- `teachingAssignmentGroupId`
- `responsibleHiccUid`
- `teachingAssignmentSubmissionId`

The locator is deterministically derived from the session's canonical
`academicYear`, group and responsible HICC through
`submissionDocumentId(...)`. It is internal-only and must not enter the
calendar or Published projection.

Only trusted admin/ADC/DVM configuration paths set/change these fields.

HICC/VISC cannot self-reassign ownership/group/package. T6 defines the identity
and trusted metadata; T7 owns Firestore enforcement and review-transition
security.

- [ ] **Step 6: User-facing terminology**

Visible labels:
- ADFAD -> ADFAD
- ADC/DVM -> ADC/DVM

Do not rename technical keys/role values/routes/history solely for terminology.

- [ ] **Step 7: Remove `other_office` active support after gate**

Remove active choices/capabilities/provisioning/target runtime support.

Unknown/deprecated role fails closed.

- [ ] **Step 8: Tests**

```bash
node --test tests/teaching-assignment-groups.test.js tests/office-capabilities.test.js tests/account-profile.test.js tests/user-management.test.js tests/timetable-multi-edit-ui.test.js tests/other-office-removal.test.js
npm run test:static
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add teaching-assignment-groups.js office-capabilities.js account-profile.js user-management.html user-management.js timetable-selection.js timetable.js tests tools/static-assets.json tools/runtime-bundles.json
git commit -m "feat: add grouped hicc visc responsibilities"
```

---

### Task 7: Firestore Security for HICC Ownership, VISC Group Review, Submissions, Working Data, and Publication

**Files:**
- Modify: `firestore.rules`
- Modify: `teaching-assignment-review.js`
- Modify: `tests/teaching-assignment-review.test.js`
- Create: `tests/academic-scope-security-emulator.test.js`
- Create: `tests/teaching-assignment-group-security-emulator.test.js`
- Create: `tests/teaching-assignment-submission-security-emulator.test.js`
- Create: `tests/assignment-contribution-security-emulator.test.js`
- Modify: `tests/lab-group-security-emulator.test.js`
- Create/modify publication security emulator tests
- Modify: `tests/rules-evaluation-budget.test.js`

- [ ] **Step 0: Deterministic package identity and direct Rules locator**

Use the locked package identity
`ta-sub-v1__ENC(academicYearKey)__ENC(groupId)__ENC(hiccUid)`.

Do not make Firestore Rules reproduce JavaScript URL encoding. Every P3.1-owned
Working session carries trusted `teachingAssignmentSubmissionId`; HICC/VISC
cannot mutate it. Rules load that package directly and fail closed unless the
package Academic Year, group and HICC exactly match the session's
`academicYear`, `teachingAssignmentGroupId` and `responsibleHiccUid`.

- [ ] **Step 1: HICC exact ownership**

Allow HICC Working read/edit only when:
- `responsibleHiccUid == request.auth.uid`
- exact HICC Course/Subject token matches
- active Teaching Assignment group contains the HICC
- `teachingAssignmentSubmissionId` resolves to the exact matching Academic
  Year/group/HICC package.

HICC/VISC cannot change any trusted ownership/package-locator field.

Deny cross-HICC/course/Subject/package.

- [ ] **Step 2: VISC group review**

Allow VISC read of all HICC Working sessions/submissions in groups it leads.

Deny other groups.

Allow only review transitions:
- `visc_review -> changes_requested`
- `visc_review -> visc_approved`.

Deny VISC content edits, ownership changes, Final Submit, final Faculty assignment.

- [ ] **Step 3: Server-authoritative Working revision and HICC submission transitions**

Extend the package model with `workingRevision` (initial 0),
`submittedWorkingRevision` and `viscApprovedWorkingRevision`.
Keep `revision` as the separate HICC review-round counter.

For every review-relevant session or contribution-suggestion mutation:
- the same atomic write must update the located package
  `workingRevision: N -> N + 1`;
- verify the companion package write with `getAfter()`;
- multiple changed rows in one package/atomic write advance the generation once;
- note-only, roster-only, derived-field-only and timestamp-only writes do not
  advance it.

Freeze review-relevant content during `visc_review`. Deny review-relevant
writes in `submitted_to_adfad` and `adfad_finalized` outside the later
controlled ADFAD assignment path.

HICC Submit/Resubmit:
- allowed from `draft`, `changes_requested`, or stale `visc_approved`;
- increments review `revision`;
- sets `submittedWorkingRevision = workingRevision`;
- records current `reviewFingerprint`;
- clears prior VISC approval generation/fingerprint;
- moves to `visc_review`.

VISC Approve:
- requires `visc_review`;
- requires `workingRevision == submittedWorkingRevision`;
- records `viscApprovedWorkingRevision = workingRevision`;
- copies `reviewFingerprint` into `viscApprovedFingerprint`.

HICC Final Submit requires:
- `visc_approved`;
- responsible HICC actor;
- `workingRevision == submittedWorkingRevision == viscApprovedWorkingRevision`;
- `reviewFingerprint == viscApprovedFingerprint`.

A browser-computed fingerprint alone must never satisfy stale-review security.
Replaying an old approved fingerprint after a review-relevant edit must fail.

- [ ] **Step 4: Contribution/note privacy**

ADC/DVM, LAB and HICC actor documents use exact source/actor rules.

A contribution write resolves its source session and then that session's trusted
submission locator. Changing the safe `suggestions` array is review-relevant
and requires the same atomic `workingRevision + 1` companion package write.
Note-only and actor-display/timestamp-only changes do not advance the package
generation.

`sessionId`, `sourceRole` and `actorUid` are immutable contribution
identity/provenance.

VISC review comment belongs to package review record only.

- [ ] **Step 5: Roster policy**

Every ready user may read under temporary policy.

Writes remain restricted.

Missing referenced LAB group fails closed.

Roster never enters Published release.

- [ ] **Step 6: Working/Published boundary**

Ordinary Faculty cannot read Working collections and can read only active sealed Published release.

HICC/VISC normal Faculty view uses Published; their Teaching Assignment tool uses authorized Working queries.

- [ ] **Step 7: Publication immutability/pointer rules**

Preserve sealed immutability, pointer eligibility, high-trust activation, corrupt-pointer fail-closed behavior and publication privacy.

- [ ] **Step 8: Profile/runtime role validation**

After T6 gate, remove `other_office` runtime authorization.

Validate bounded HICC/future `academicScopeTokens`; do not require VISC Course/Subject token for group review.

- [ ] **Step 9: Rules budget**

```bash
node --test tests/rules-evaluation-budget.test.js
```

Do not raise ceiling just to fit feature.

- [ ] **Step 10: Full emulator**

```bash
npm run test:emulator
```

Expected: PASS including explicit Change Request regression.

- [ ] **Step 11: Commit**

```bash
git add firestore.rules tests
git commit -m "feat: secure grouped teaching assignment review"
```

---

### Task 8: Work Queue and UI for HICC -> VISC -> HICC -> ADFAD, Plus Published Faculty Views

**Files:**
- Modify: `work-queue.js`
- Modify: `timetable.js`
- Modify: `faculty-admin.js`
- Create/modify: `timetable-publication.js`
- Modify corresponding tests/static assets.

**Queue target:**
- ADC/DVM -> incomplete skeleton
- LAB -> LAB operational outstanding
- HICC -> draft work, Push Back work, VISC-approved package awaiting Final Submit
- VISC -> `visc_review` packages for led groups
- ADFAD -> `submitted_to_adfad` packages
- Faculty -> Published only.

- [ ] **Step 1: RED queue tests**

Pin:
- content-ready alone does not create ADFAD item
- HICC Submit creates VISC item
- Push Back creates HICC item
- VISC Approve creates HICC Final Submit item
- only HICC Final Submit creates ADFAD item
- VISC sees all HICC submissions in led group only
- LAB outstanding independent.

- [ ] **Step 2: HICC package UI**

Show own sessions/package status, Submit for VISC Review, Push Back comment, Final Submit only after valid current VISC approval.

- [ ] **Step 3: VISC review UI**

Simple group list:
- HICC
- package status
- included courses/session count
- Open Review
- Approve
- Push Back + comment.

No direct HICC content editing.

- [ ] **Step 4: ADFAD queue UI**

Only `submitted_to_adfad` packages.

ADFAD opens package/session details and final assignment in T9.

- [ ] **Step 5: Published-only Faculty source**

Main Timetable, My Teaching and Faculty Dashboard self-mode use active Published release only.

No Working fallback.

- [ ] **Step 6: HICC/VISC source split**

Normal calendar -> Published.

Teaching Assignment work:
- HICC -> own exact-scope Working
- VISC -> groups led.

No broad Working query + client-only filter.

- [ ] **Step 7: Tests**

```bash
node --test tests/work-queue.test.js tests/workflow-functional-completion.test.js tests/timetable.test.js tests/timetable-multi-edit-ui.test.js tests/faculty.test.js tests/timetable-publication.test.js
npm run test:static
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add work-queue.js timetable.js faculty-admin.js timetable-publication.js tests tools/static-assets.json tools/runtime-bundles.json
git commit -m "feat: add grouped teaching assignment work queue"
```

---

### Task 9: ADFAD Final Assignment, Explicit Publish Timetable, and Published-Base Change Request Protection

**Files:**
- Modify: `timetable.js`
- Modify: `timetable-publication.js`
- Modify: `faculty-assignment.js` only for small provenance helpers if needed
- Modify: `approval-request.js` for Published-base provenance
- Modify: `approval-finalizer.js` for stale-base validation only
- Modify: `firestore.rules` only for approved companion rules
- Add focused assignment/publication/change-request tests.

- [ ] **Step 1: ADFAD gate**

Final assignment is available only for a current package in `submitted_to_adfad`.

Content-ready or VISC-approved alone is insufficient.

- [ ] **Step 2: Suggestion review**

ADFAD may review ADC/DVM/LAB/HICC suggestions, accept subset, remove, or manually choose other Faculty.

Acceptance is in-memory until ADFAD Approve & Submit.

- [ ] **Step 3: Multi-Faculty authoritative submit**

Write:
- Working `assignments[]`
- derived `facultyIds[]`
- derived `instructor`
- Working `calendar_sessions`
- audit
- DOE recalculation only when existing Rule Book says relevant.

Mark package `adfad_finalized` only after assignment succeeds.

- [ ] **Step 4: No DOE from review chain**

No DOE request from:
- HICC Submit for VISC Review
- VISC Approve
- VISC Push Back
- HICC Final Submit
- Publish lifecycle.

- [ ] **Step 5: Versioned timetable publication**

Preserve:
- full Academic-Year candidate
- strict public allowlist
- build -> validate -> seal
- immutable sealed snapshot
- atomic `activeReleaseId`
- concurrent publisher conflict
- restore as new forward release
- old active release remains until successful switch.

Publish authority:
- Developer
- Owner / ADFAD General-equivalent.

ADFAD Regular, ADC/DVM, LAB, HICC, VISC, Faculty cannot Publish.

- [ ] **Step 6: Published privacy**

Exclude contributions, notes, VISC review comments, suggestions, roster/student data, exact DOE, HR/AFC private data, private Faculty IDs and internal review/audit bodies.

- [ ] **Step 7: Published-origin Change Request provenance**

Record immutable `baseReleaseId` plus base-session evidence/fingerprint.

Final apply re-resolves Working state and fails closed when stale.

Do not change ADC/DVM/LAB/ADFAD explicit Change Request approval order.

- [ ] **Step 8: Tests**

Run focused assignment/publication/change-request suites, then:

```bash
npm run test:emulator
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add timetable.js timetable-publication.js faculty-assignment.js approval-request.js approval-finalizer.js firestore.rules tests
git commit -m "feat: add adfad assignment and timetable publication"
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

Authorized suggestion roles and ADFAD may read `faculty_capacity_index` according to their approved role/scope. The deprecated `other_office` role receives no runtime access. Exact DOE collections remain denied to contributor roles.

- [ ] **Step 7: Render only safe labels in contributor and ADFAD candidate pickers**

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

### Task 11: DOE Regression Guards for Subject, HICC/VISC Review, and Scoped Roles

**Files:**
- Modify: `server/test/calculation-service.test.js`
- Modify: `server/test/workflow-preview-service.test.js`
- Modify: `tests/doe-reconciliation.test.js`
- Modify: `tests/timetable-multi-edit-ui.test.js`
- Verify DOE production engine files remain unchanged unless a regression exposes a separately reviewed pre-existing bug.

- [ ] **Step 1: Subject-only regression**

Subject-only Teaching Assignment change does not force Teaching DOE recalculation unless the active Rule Book explicitly declares Subject relevance.

- [ ] **Step 2: HICC/VISC review actions never trigger DOE**

Assert no authoritative DOE preparation/request from:
- HICC Submit for VISC Review
- VISC Approve
- VISC Push Back
- HICC Final Submit
- contribution-only suggestion/note saves
- release build/validate/seal
- active release pointer switch
- republish/restore-release creation.

- [ ] **Step 3: Positive final-assignment regression**

ADFAD authoritative final assignment continues to invoke the existing DOE path when Rule Book-relevant facts changed.

- [ ] **Step 4: HICC role DOE stays per-course/year**

Two HICC role assignments for the same Faculty may produce different DOE results when mappings/rules differ by course/year.

Never copy a prior course result.

- [ ] **Step 5: VISC role DOE stays independent from review authority**

Teaching Assignment group leadership does not itself determine DOE.

VISC DOE remains calculated from existing Rule Book role/course/Subject/year mappings.

Missing/ambiguous Subject mapping fails closed.

- [ ] **Step 6: Run DOE suites**

```bash
npm run test:server
node --test tests/doe-reconciliation.test.js tests/timetable-multi-edit-ui.test.js
```

Expected: PASS without hardcoding new HICC/VISC percentages.

- [ ] **Step 7: Commit**

```bash
git add server/test tests/doe-reconciliation.test.js tests/timetable-multi-edit-ui.test.js
git commit -m "test: protect grouped review doe boundaries"
```

---

### Task 12: Schema, Grouped Review, Explicit Approval, Publication Regression, Demo Fixtures, and Full Verification

**Files:**
- Modify: `docs/database/SCHEMA.md`
- Modify: `tools/seed/dataset.js`
- Modify: `tests/seed-dataset.test.js`
- Modify: `tools/browser-smoke.js`
- Modify/add tests only as needed to reflect the approved P3.1 architecture; do not relax explicit approval/security assertions.

- [ ] **Step 1: Document final schema**

Document:
- HICC `academicScopeTokens`
- canonical `subjectKey`
- trusted session `teachingAssignmentGroupId`
- trusted session `responsibleHiccUid`
- `teaching_assignment_groups`
- `teaching_assignment_submissions`
- submission lifecycle:
  `draft -> visc_review -> changes_requested|visc_approved -> submitted_to_adfad -> adfad_finalized`
- review fingerprint / VISC-approved fingerprint rules
- `session_assignment_contributions`
- temporary roster-read policy
- `faculty_capacity_index`
- Working `sessions` / `calendar_sessions`
- versioned timetable publication schema
- Published-only Faculty views
- Change Request `baseReleaseId`
- no DOE from HICC/VISC review/Publish
- user-facing ADFAD / ADC-DVM terminology with unchanged internal technical keys
- deprecated `other_office` removal.

- [ ] **Step 2: Demo fixtures**

Include a deterministic Bovine-style example:
- one active Teaching Assignment group
- one VISC leader
- multiple HICC members
- HICC course-wide scope
- HICC Course+Subject scope
- HICC Working sessions with trusted ownership fields
- one package in `visc_review`
- one VISC Push Back example
- one package `visc_approved`
- one package `submitted_to_adfad`
- LAB group/roster
- one sealed Published release
- newer Working changes absent from Published release
- no supported `other_office` runtime fixture.

Do not seed live Firebase.

- [ ] **Step 3: Grouped-review regression**

Must prove:
- HICC sees only own assigned exact scope
- VISC sees every HICC package in led group
- VISC sees no package outside led groups
- VISC can Approve/Push Back
- VISC cannot edit HICC content directly
- VISC cannot Final Submit
- HICC Final Submit requires exact server-enforced submitted/approved `workingRevision` equality plus matching VISC-approved fingerprint
- post-approval review-relevant edit atomically advances `workingRevision` and invalidates Final Submit even if a client replays the old approved fingerprint
- only HICC Final Submit creates ADFAD queue eligibility
- LAB roster does not block this chain.

- [ ] **Step 4: Explicit Change Request regression**

Must remain true:
- later offices cannot approve before earlier applicable offices
- Reject, Push Back, resubmit/revision behavior remains intact
- Teaching Assignment package review creates no `change_request*` documents
- Published-origin request preserves `baseReleaseId`
- stale Working base prevents final apply
- routing/order remains ADC/DVM -> LAB -> ADFAD where applicable.

- [ ] **Step 5: Publication/security regression**

Pin:
- Faculty direct Working reads denied
- active sealed release allowed
- inactive/building/failed/unsealed release denied
- sealed release immutable
- unauthorized pointer update denied
- invalid/missing pointer fails closed
- no Working fallback
- strict Published allowlist excludes notes/review comments/suggestions/roster/DOE/HR/private IDs
- Working edits after publish do not mutate active release
- republish creates new version
- concurrent publisher loser conflicts
- inactive/password-change-required user denied
- `other_office` grants no runtime authority.

- [ ] **Step 6: Browser smoke**

Internal Working:
1. ADC/DVM skeleton exists.
2. HICC sees own package only.
3. HICC submits for VISC review.
4. VISC sees all HICC packages in led group.
5. VISC Push Back returns work to HICC.
6. HICC revises/resubmits.
7. VISC approves current fingerprint.
8. HICC Final Submit creates ADFAD queue item.
9. LAB roster may remain incomplete.
10. ADFAD assigns multiple Faculty and finalizes Working assignment.

Published:
11. Faculty still sees prior release before Publish.
12. high-trust publisher builds/validates/seals/activates new release.
13. Faculty Timetable, My Teaching, and Faculty Dashboard self-mode use that Published source.
14. later Working edit remains invisible until republish.
15. no-release/corrupt-pointer states fail closed.
16. explicit Change Request browser smoke remains serial.

- [ ] **Step 7: Run all suites**

```bash
npm test
npm run test:static
npm run test:server
npm run test:emulator
node --test tests/rules-evaluation-budget.test.js
```

Expected: PASS.

- [ ] **Step 8: Build and browser smoke**

```bash
node tools/build-static.js
node tools/browser-smoke.js --demo
```

Expected: PASS.

- [ ] **Step 9: Search final runtime residue**

```bash
git grep -n "other_office" -- ':!docs/**'
git grep -n "ADFA" -- '*.html' '*.js' ':!tests/**'
git grep -n ">ADC<" -- '*.html'
git grep -n "activeReleaseId" .
```

Interpretation:
- `other_office` may remain only in intentional denial/migration tests or historical artifacts
- user-facing production UI should use ADFAD and ADC/DVM
- lowercase/internal `adfa*` and `adc` technical identifiers are allowed
- publication pointer use remains explicit.

- [ ] **Step 10: Inspect protected subsystem diff**

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- firestore.rules approval-lifecycle.js approval-routing.js approval-state.js approval-request.js approval-finalizer.js doe-policy-engine.js
```

Expected:
- grouped review/publication rule changes intentional
- explicit Change Request routing/order not redesigned
- DOE formulas/rates not redesigned
- no deployment config changed unintentionally.

- [ ] **Step 11: Commit docs/fixture/smoke**

```bash
git add docs/database/SCHEMA.md tools/seed/dataset.js tests/seed-dataset.test.js tools/browser-smoke.js tests
git commit -m "test: complete grouped workflow acceptance coverage"
```

- [ ] **Step 12: Push verified feature branch**

```bash
git status --short
git push origin feature/scoped-parallel-assignment-workflow
```

- [ ] **Step 13: Produce implementation handoff report**

Report:
- final HEAD
- commits by task
- tests/results
- rules-budget before/after
- grouped review states/fixtures
- publication schema
- approved deviations/known limitations
- confirmation no live Firebase/DOE/Azure write/deploy occurred
- confirmation explicit Change Request approval order remained intact
- confirmation Faculty have no Working timetable read path
- confirmation `other_office` no longer grants runtime authority
- confirmation user-facing terminology is ADFAD and ADC/DVM.

---

---
