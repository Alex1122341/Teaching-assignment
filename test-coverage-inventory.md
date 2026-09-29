# Test Coverage Inventory: P3.1 Tasks T1–T12

**PAWS support task 3**, a read-only research deliverable.

| | |
|---|---|
| Repository | `Alex1122341/Teaching-assignment` |
| Tests reviewed | `origin/feature/scoped-parallel-assignment-workflow` @ `6ce74ef`, where T1–T12 are implemented. Read through a detached scratch worktree; nothing was checked out on, committed to, or pushed to that branch. |
| Compared against | `origin/main` @ `5ecbb39`. The branch's merge base with `main` is `16ff0cd`, so the branch is **5 commits behind `main`** (the Azure SQL work). |
| Requirements source | `docs/superpowers/plans/2026-09-22-scoped-parallel-teaching-assignment-workflow.md` (P3.1 plan, 1,360 lines): each task's RED/"Pin"/"Must prove" lists and implementation requirements |
| Changes made | None. No test, code or rules file was modified. Tests were *run* only in the scratch worktree (see §5). |

## Status legend

| Status | Meaning |
|---|---|
| **Covered** | At least one test asserts the requirement at the right layer. A Firestore-rules requirement needs an emulator test; a pure helper needs a unit test. |
| **Partially Covered** | Only part of the requirement is asserted, **or** it is asserted only at a weaker layer: a source-text regex, a capability flag without rules enforcement, or pre-existing behaviour not yet tied to the P3 gate. |
| **Missing** | No test asserts it. |
| **Duplicate** | The requirement is covered, but two or more tests assert the same thing at the same layer. Duplicates across layers (unit + emulator) are intentional and not counted as Duplicate. |
| *N/A (process)* | A plan step that is an action (merge, install, dependency gate), not a testable behaviour. Listed for completeness. |

---

## 1. Summary

| Task | Covered | Partial | Missing | Duplicate | N/A | Overall |
|---|---:|---:|---:|---:|---:|---|
| T1 Baseline gate | 1 | 1 | 0 | 0 | 3 | Mostly process |
| T2 HICC Course/Subject scope | 7 | 0 | 0 | 0 | 0 | **Complete** |
| T3 Subject catalog | 8 | 1 | 0 | 1 | 0 | **Complete** (1 partial) |
| T4 Review state model | 10 | 1 | 0 | 0 | 0 | **Complete** (1 partial) |
| T5 Contributions | 6 | 0 | 0 | 0 | 0 | **Complete** |
| T6 Groups, capabilities, roles | 6 | 2 | 0 | 1 | 1 | **Mostly complete** |
| T7 Firestore security | 10 | 2 | 2 | 0 | 0 | **Core done; publication + Faculty boundary missing; 1 conflict** |
| T8 Work Queue + Published views | 0 | 1 | 5 | 0 | 0 | **Not started** |
| T9 ADFAD assignment + Publish + CR | 0 | 3 | 5 | 0 | 0 | **Not started** |
| T10 Capacity projection | 0 | 0 | 5 | 0 | 0 | **Not started** |
| T11 DOE regression guards | 1 | 3 | 1 | 1 | 0 | **Partial** |
| T12 Acceptance / fixtures / smoke | 0 | 4 | 3 | 0 | 0 | **Not started** |
| **Total (95 rows: 91 testable + 4 process)** | **49** | **18** | **21** | **3** | **4** | |

Key findings:

1. **T2–T6 are well covered.** They include new unit files (`academic-responsibility`, `subject-catalog*`, `teaching-assignment-review`, `assignment-contributions`, `teaching-assignment-groups`, `teaching-responsibility`, `other-office-removal`, `timetable-ownership-save`) and strong additions to existing suites. All 299 unit tests in the T2–T8-related files pass (§5).
2. **T7's core rules are covered by emulator tests**, mainly `teaching-assignment-submission-security-emulator` (25 checks), `assignment-contribution-security-emulator` (10) and `teaching-responsibility-security-emulator` (5). **None of the 163 emulator checks could be executed here** because the Firestore emulator download is blocked, so their pass/fail status is unverified.
3. **Nothing exists yet for T8–T10, or for the publication parts of T7, T11 and T12.** There is no `timetable-publication.js`, no `timetable_publications`/`activeReleaseId`/`baseReleaseId` test, no `faculty_capacity_index`, no HICC/VISC Work Queue item, and no Published-only Faculty source. `teaching-assignment-review.test.js:229` explicitly asserts that `timetable_publications` is *absent* from the review module.
4. **A test contradicts the spec on roster reads** (T7.5): the plan and spec §10.1 say every ready user may read LAB rosters; the branch rule and test deny Faculty/Administrator (§4, C1).
5. **Six test files the plan names do not exist.** Their coverage either moved elsewhere or is missing:

   | Planned file | Where its coverage is now |
   |---|---|
   | `academic-scope-security-emulator` | Moved: `teaching-assignment-submission-security-emulator` |
   | `teaching-assignment-group-security-emulator` | Moved: `teaching-responsibility-security-emulator` + submission emulator |
   | `calendar-session.test.js` | Moved: `calendar.test.js` |
   | `timetable-publication` | Missing |
   | `faculty-capacity-security-emulator` | Missing |
   | `seed-dataset` | Missing |

---

## 2. Requirement matrix

Test references are `file:line` on the P3 branch; `tests/` is omitted unless ambiguous. "(new)" marks files added on the branch; everything else existed on `main`, possibly modified.

### T1: Isolated Worktree, Main Merge, Baseline Gate

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| T1.1 | Worktree on `feature/scoped-parallel-assignment-workflow` | *N/A (process)* | — |
| T1.2 | Merge latest `origin/main` without losing PR #67 Work Queue / LAB roster work | Partially Covered | The LAB roster/Work Queue behaviours are pinned by `workflow-functional-completion.test.js:97–295` (new). However, the branch is **5 commits behind `main`** (the Azure SQL cutover), so "latest main" is not currently true. |
| T1.3 | `npm ci` / server install without dependency changes | *N/A (process)* | — |
| T1.4 | All suites green before product changes | *N/A (process)* | Current state: see §5 |
| T1.5 | Rules-budget baseline recorded | Covered | `rules-evaluation-budget.test.js` (6 tests; `+ Teaching Assignment responsibility lookups stay within their own reviewed budget`) |

### T2: Canonical HICC Course/Subject Scope

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| T2.1 | `hicc\|VTMD 505\|*` authorizes all Subjects in that exact course only | Covered | `academic-responsibility.test.js:27` (new) |
| T2.2 | `hicc\|VTMD 506\|surgery` authorizes exact Course + Subject only; cross-course/Subject denied | Covered | `academic-responsibility:36` |
| T2.3 | Role `hicc` without a token grants nothing | Covered | `academic-responsibility:58` |
| T2.4 | Topic text never affects authorization | Covered | `academic-responsibility:50` |
| T2.5 | Malformed/blank/extra/unknown tokens and substring attacks fail closed; duplicates dedupe; normalization | Covered | `academic-responsibility:12, :19, :67, :77` |
| T2.6 | `rotation_coordinator` parsed but grants no HICC behaviour; no VISC Course/Subject tokens for review | Covered | `academic-responsibility:87`; `teaching-responsibility.test.js:49` (new) |
| T2.7 | Asset load order: before `office-capabilities.js` and `timetable.js` | Covered | `academic-responsibility:94` |

### T3: Canonical Subject Catalog and Optional Session Classification

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| T3.1 | Pure model: stable key normalization, active options only, reject identity mismatch/blank/whitespace | Covered | `subject-catalog.test.js:6, :15, :27` (new) |
| T3.2 | Rules: `teaching_subjects` readable by `ready()` only | Covered | `subject-catalog-security-emulator.test.js:44` (new; inactive/password/anonymous denied) |
| T3.3 | Rules: create/update/delete by existing administrators only | Covered | `subject-catalog-security-emulator:52` |
| T3.4 | Rules: write shape exact, id≠key denied | Covered | `subject-catalog-security-emulator:66` |
| T3.5 | Admin UI: list/add/rename label without key change/activate-deactivate; no DOE controls | Covered | `subject-catalog-admin.test.js:6, :19` (new) |
| T3.6 | ADC/DVM may classify with an **active** Subject only | Covered | `subject-catalog-security-emulator:78`; `timetable-selection.test.js` `+ only ADC scheduling authority can classify a selected session with an active Subject` |
| T3.7 | HICC/VISC cannot change `subjectKey` through scoped/review actions | Partially Covered | HICC and LAB: `subject-catalog-security-emulator:96`. **VISC** is not asserted specifically for `subjectKey` (only the general "VISC … cannot edit content", `teaching-assignment-submission-security-emulator:95`). |
| T3.8 | `subjectKey` is optional and not a readiness gate | Covered | `teaching-assignment-review.test.js:31–33` (new) is ready with `subjectKey:''` |
| T3.9 | Subject-only change creates no authoritative DOE | **Duplicate** | `timetable-selection.test.js` `+ a Subject-only selection update does not request DOE recalculation` **and** `timetable-multi-edit-ui.test.js` `+ … a Subject-only save bypasses DOE work`. Both are unit/source tests on the same save path. |
| T3.10 | `subjectKey` included in the sanitized calendar projection | Covered | `calendar.test.js` `+ calendar sanitizer carries only a canonical optional Subject key, never Topic-derived or private fields` |

### T4: HICC Package Readiness and VISC Review State Model

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| T4.1 | Readiness requires course, valid date, start/end, type, valid Topic | Covered | `teaching-assignment-review.test.js:31, :46, :51` (new) |
| T4.2 | Room, LAB group/roster, suggestion/note are not blockers | Covered | `teaching-assignment-review:31, :196` |
| T4.3 | Only HICC submits its own package | Covered | `teaching-assignment-review:106, :118` |
| T4.4 | VISC can Approve or Push Back; Push Back needs a comment | Covered | `teaching-assignment-review:126, :140` |
| T4.5 | VISC cannot Final Submit; HICC cannot Final Submit before approval | Covered | `teaching-assignment-review:182, :215` |
| T4.6 | Final Submit requires the exact current approved fingerprint | Covered | `teaching-assignment-review:156, :173, :182` |
| T4.7 | Review-relevant edit invalidates approval; resubmission required | Covered | `teaching-assignment-review:65, :196, :206` |
| T4.8 | Fingerprint includes IDs/course/subject/date/time/type/room/Topic/safe suggestions; excludes notes, roster, DOE | Covered | `teaching-assignment-review:55, :65, :69, :77, :85, :95, :231` |
| T4.9 | Package review creates no explicit Change Request record | Partially Covered | This is only a **source-text regex** (`teaching-assignment-review:229` asserts that the module source doesn't mention `change_request*`). No emulator or integration test shows that a review transition writes no `change_request*` document. |
| T4.10 | `session-workflow.js` content readiness never creates ADFAD readiness | Covered | `workflow-functional-completion.test.js:11, :39` (new) |
| T4.11 | Explicit Change Request routing/order unchanged | Covered | `approval-order-security-emulator.test.js:37–89` (existing, unmodified) |

### T5: ADC/DVM, LAB and HICC Actor-Scoped Contributions

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| T5.1 | ADC/DVM, LAB, HICC create safe suggestions | Covered | `assignment-contributions.test.js:18` (new) |
| T5.2 | VISC (and other roles) are not contribution sources | Covered | `assignment-contributions:27` (rejects `visc`, `adfad`, `faculty`, `other_office`, …) |
| T5.3 | One actor/source cannot overwrite another | Covered | Unit: `assignment-contributions:35, :60, :145`. Rules: `assignment-contribution-security-emulator.test.js:39, :67` (new) |
| T5.4 | No UCID/email/private ID/exact DOE/AFC/HR in contributions | Covered | Unit: `assignment-contributions:71, :83, :97`; `faculty-suggestions.test.js` (4 new tests). Rules: `assignment-contribution-security-emulator:30` |
| T5.5 | Note ≤ 2,000 characters | Covered | `assignment-contributions:107` |
| T5.6 | Saving/accepting a suggestion never mutates `assignments[]`; asset wiring | Covered | `assignment-contributions:180, :202` |

### T6: Groups, Role Capabilities, User Management, Terminology, Role Cleanup

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| T6.1 | Read-only `other_office` dependency gate | *N/A (process)* | Related fixture evidence: `other-office-removal.test.js:11` (seed keeps Other Office only as an inactive legacy fixture) |
| T6.2 | Group helper: stable responsibility IDs, slug grammar, deterministic `ta-sub-v2` locator, fail closed, `faculty_groups` not reused | Covered | `teaching-assignment-groups.test.js:13–78` (8 tests, new) |
| T6.3 | VISC may lead multiple groups only by explicit configuration | Covered | `teaching-assignment-groups:51, :62`; `teaching-responsibility.test.js:59` |
| T6.4 | User Management: create/rename/deactivate groups and responsibilities; choose VISC leader; add/remove HICC | Partially Covered | Covered: separation from `faculty_groups`, active-Subject scope editor, safe degrade (`user-management.test.js`, 8 new tests). Rules: `teaching-responsibility-security-emulator:27, :84`. **No test exercises group rename/deactivate or leader change in the UI.** |
| T6.5 | Dated assignee windows; split/restore coverage; reject overlap; Calgary dates | Covered | `teaching-responsibility:12, :24, :35, :97, :105`; `temporal-role-assignment.test.js` (7, new); `user-management` (overlap/revision tests) |
| T6.6 | HICC/VISC capabilities (HICC edit/submit/final; VISC review-only; role name alone grants nothing) | Covered | `office-capabilities.test.js`: 4 new tests (time-bounded HICC; role name alone; VISC review-only; VISC name alone) |
| T6.7 | Publish is high-trust only (capability) | Partially Covered | Capability flag only: `office-capabilities` `+ timetable publication is limited to Developer and Owner ADFAD General-equivalent authority`. No Publish action exists yet, so enforcement is untested (see T9.5). |
| T6.8 | Trusted session ownership fields; locator derived, internal only; HICC/VISC cannot self-reassign | Covered | `timetable-selection.test.js` (7 new ownership tests); `timetable-ownership-save.test.js` (9, new); rules: `teaching-assignment-submission-security-emulator:113, :158` |
| T6.9 | User-facing terminology ADFAD, ADC/DVM; technical keys unchanged | Covered | `user-management` `+ account rendering displays ADC/DVM and ADFAD while preserving technical office keys`; label assertions in `work-queue`, `session-workflow`, `page-modules`, `approval-lifecycle` |
| T6.10 | `other_office` active support removed; unknown/deprecated role fails closed | **Duplicate** | The same capability-level assertion appears in `other-office-removal.test.js:36` ("no runtime office or timetable capability") **and** `office-capabilities.test.js` `+ retired Other Office fails closed without calendar or operational authority`. Also covered (not duplicated) by provisioning `other-office-removal:21, :32`, UI `:43`, portal `:50`, and rules `security-emulator.test.js:14`, `assignment-contribution-security-emulator:80`, `teaching-assignment-submission-security-emulator:254`. |

### T7: Firestore Security

All T7 evidence is emulator tests, which were **not executed** in this review (§5).

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| T7.0 | Direct package locator load; mismatched year/group/responsibility fails closed; current-duty assignee window (`activeAt ≤ now < expiresAt`) | Covered | `teaching-assignment-submission-security-emulator.test.js:72, :95, :98, :216` (new) |
| T7.1 | HICC exact ownership: responsibility + window + Course/Subject + group + locator; deny cross-scope | Covered | `teaching-assignment-submission-security-emulator:81, :95, :98, :205` |
| T7.2 | VISC reads all packages in led groups only; review transitions only; no content edit/final submit | Covered | `teaching-assignment-submission-security-emulator:72, :95, :118, :131, :233` |
| T7.3 | Server `workingRevision` N→N+1 atomically; one bump per batch; note/roster/timestamp-only don't bump; freeze in `visc_review`; exact revision equality at approve and final submit; replay fails | Covered | `teaching-assignment-submission-security-emulator:87, :105, :118, :125, :173, :190`; `assignment-contribution-security-emulator:52, :60, :93` |
| T7.4 | Contribution privacy: exact source/actor; suggestions bump revision; identity immutable | Covered | `assignment-contribution-security-emulator:23, :30, :39, :47, :67` |
| T7.5 | Roster: **every ready user may read** (temporary policy); writes restricted; missing LAB group fails closed | Partially Covered, **conflict** | Writes and missing-group: `lab-group-security-emulator.test.js` (6 new tests). The read policy is **contradicted**: `lab-group-security-emulator:86` asserts Faculty/Administrator *cannot* read rosters, matching branch rule `rosterReader()` (`firestore.rules:351`, developer/general/lab only). See §4 C1. |
| T7.6 | Ordinary Faculty cannot read Working collections; read only the active sealed release | **Missing** (Published half); Partially Covered (Working half) | Only **TA-owned** Working data is proven denied (`teaching-assignment-submission-security-emulator:23, :72`; `assignment-contribution-security-emulator:47`). No test denies Faculty reads of non-owned `sessions`/`calendar_sessions`; on the branch those are still allowed (see `faculty-data-path-audit.md`). No Published-read test. |
| T7.7 | Publication immutability, pointer eligibility, high-trust activation, corrupt-pointer fail-closed, privacy | **Missing** | No publication rules exist |
| T7.8 | `other_office` runtime authorization removed | Covered | `security-emulator.test.js:14`; `assignment-contribution-security-emulator:80`; `teaching-assignment-submission-security-emulator:254` |
| T7.9 | Validate bounded HICC `academicScopeTokens`; no VISC Course/Subject token needed | Covered | `teaching-responsibility-security-emulator:43, :71`; `teaching-responsibility:49, :83` |
| T7.10 | Rules budget not raised to fit the feature | Covered | `rules-evaluation-budget.test.js` (+1 TA budget test); write-budget checks `assignment-contribution-security-emulator:98`, `teaching-assignment-submission-security-emulator:275`, `lab-group-security-emulator` (8 groups) |
| T7.11 | Full emulator incl. explicit Change Request regression | Partially Covered | The suites exist (`approval-order-security-emulator`, `approval-lifecycle-security-emulator`, `ws5b-security-matrix-emulator`) but were **not run** here |
| T7.12 | Scoped HICC/VISC see only the sanitized owned calendar, never private legacy assignments | Covered | `teaching-assignment-submission-security-emulator:23, :32, :264, :271` |
| T7.13 | Trusted package creation and attach/rehome/delete are high trust with atomic generation | Covered | `teaching-assignment-submission-security-emulator:139, :149, :158, :173, :190` |

### T8: Work Queue and UI, plus Published Faculty Views

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| T8.1 | Queue: content-ready alone makes no ADFAD item; HICC Submit → VISC item; Push Back → HICC item; Approve → HICC Final Submit item; only Final Submit → ADFAD item; VISC led-group only; LAB independent | Partially Covered | Only "content-ready alone ≠ ADFAD" is asserted (`workflow-functional-completion.test.js:11`). `work-queue.js` has no `visc_review`/`submitted_to_adfad`/package logic, and `work-queue.test.js:71` still asserts HICC/VISC get **no** queue items. |
| T8.2 | HICC package UI: status, Submit, Push Back comment, Final Submit only after valid approval | **Missing** | — |
| T8.3 | VISC review UI: group list, Open Review, Approve, Push Back; no content edit | **Missing** | — |
| T8.4 | ADFAD queue shows only `submitted_to_adfad` packages | **Missing** | — |
| T8.5 | Main Timetable, My Teaching, Faculty Dashboard self-mode read the active Published release only; no Working fallback | **Missing** | Planned `tests/timetable-publication.test.js` does not exist |
| T8.6 | HICC/VISC normal calendar Published; TA work uses scoped Working queries; no broad query + client filter | **Missing** | Scoped reads are proven at the rules layer (T7.12), but no test covers the client source split |

### T9: ADFAD Final Assignment, Explicit Publish, Published-Base Change Requests

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| T9.1 | Final assignment only for current `submitted_to_adfad` package | **Missing** | Pure-model transitions to `adfad_finalized` are exercised (`teaching-assignment-review:215`), but there is no gate on the real assignment path |
| T9.2 | ADFAD reviews suggestions; accepts a subset in memory until Approve & Submit | **Missing** | — |
| T9.3 | Multi-Faculty authoritative submit writes `assignments[]`, `facultyIds`, `instructor`, calendar, audit; package `adfad_finalized` only after success | Partially Covered | The existing multi-Faculty assignment behaviour is covered (`faculty-assignment.test.js:13–95`), but it is not tied to the package gate or the `adfad_finalized` transition |
| T9.4 | No DOE from HICC Submit/VISC Approve/Push Back/Final Submit/Publish | Partially Covered | Source-text regex only (`teaching-assignment-review:229`: module source contains no `doe_recalculation_requests`). No emulator/integration assertion; nothing for Publish. |
| T9.5 | Versioned publication: candidate → validate → seal, immutable, atomic `activeReleaseId`, concurrent conflict, restore as forward release; Publish authority | **Missing** | Only the capability flag exists (T6.7) |
| T9.6 | Published privacy allowlist | **Missing** | Related calendar-sanitizer tests exist for the *Working* projection (`calendar.test.js`, `timetable-ownership-save:64`) but none for a release |
| T9.7 | Change Request `baseReleaseId` + base evidence; stale apply fails closed | **Missing** | — |
| T9.8 | Explicit Change Request approval order unchanged | Partially Covered | `approval-order-security-emulator` (existing) protects order, but is not re-run against Published-origin requests |

### T10: Safe Availability and Coarse Workload Projection

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| T10.1 | Capacity entry has only `key,name,availability,workload`; missing policy → `needs_review` | **Missing** | No `buildSafeCapacityEntry`/`faculty_capacity_index` anywhere in tests |
| T10.2 | Availability vocabulary mapping; no AFC reason | **Missing** | — |
| T10.3 | `faculty_capacity_index` in the derived-index rebuild/verify lifecycle | **Missing** | `index-maintenance.test.js`/`data-index.test.js` unchanged on branch |
| T10.4 | Rules: authorized roles read; `other_office` none; exact DOE denied | **Missing** | Planned `faculty-capacity-security-emulator` does not exist |
| T10.5 | UI renders safe labels only; no hidden numbers in the DOM | **Missing** | — |

### T11: DOE Regression Guards

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| T11.1 | Subject-only change doesn't force Teaching DOE unless the Rule Book declares Subject relevance | **Duplicate** (for the non-trigger half) | Same pair as T3.9. The "unless the Rule Book declares relevance" branch is covered server-side by `server/test/calculation-service.test.js:93` |
| T11.2 | No DOE from HICC/VISC review actions, contribution saves, release build/validate/seal, pointer switch, republish | Partially Covered | Contribution and ownership-only saves: `timetable-selection` `+ Teaching Assignment ownership-only update does not request DOE recalculation`, `timetable-multi-edit-ui` `+ … metadata-only saves bypass DOE`. Review actions: source regex only (T9.4). Release lifecycle: **missing** (no code). The planned edits to `calculation-service`/`workflow-preview-service`/`doe-reconciliation` tests were not made. |
| T11.3 | ADFAD final assignment still invokes the DOE path when facts change | Partially Covered | Pre-existing: `server/test/workflow-preview-service.test.js:37, :54`; `doe-policy-timetable-integration.test.js`. Not tied to the package-gated assignment (T9.1). |
| T11.4 | Two HICC role assignments for the same Faculty can differ by course/year; never copy a prior result | Partially Covered | `calculation-service:35` covers one HICC course mapping; no two-course/different-result test |
| T11.5 | VISC DOE independent of group leadership; missing/ambiguous Subject mapping fails closed | Covered | Fail-closed: `calculation-service:49, :58, :93`; leadership carries no DOE/scope: `teaching-responsibility:49, :65` |
| T11.6 | No hardcoded HICC/VISC percentages | **Missing** | No test guards against hardcoded rates |

### T12: Schema, Regression, Demo Fixtures, Full Verification

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| T12.1 | `SCHEMA.md` documents the final schema | **Missing** | Documentation, not a test; `docs/database/SCHEMA.md` has no Teaching Assignment/responsibility entries yet |
| T12.2 | Demo fixtures: Bovine group, VISC leader, HICC scopes, packages in each state, Lisa/Bill handoff, sealed release, no `other_office` runtime | Partially Covered | Planned `seed-dataset.test.js` doesn't exist and `tools/seed/dataset.js` has no Teaching Assignment fixtures. `demo-data-consistency.test.js` (new) covers the existing Change Request/calendar fixtures, and `other-office-removal:11` the inactive legacy fixture. |
| T12.3 | Grouped-review regression (10 "must prove" items) | Partially Covered | 9 of 10 are proven at the rules layer by T7 emulator tests (T7.1–T7.3; LAB independence via T4.2). Missing: "only HICC Final Submit creates ADFAD queue eligibility" at the queue level (T8.1). |
| T12.4 | Explicit Change Request regression incl. `baseReleaseId` and stale-base | Partially Covered | Order/Reject/Push Back are covered by existing approval emulator suites. `baseReleaseId` and stale-base are missing (T9.7). "TA review creates no `change_request*`" is source-regex only (T4.9). |
| T12.5 | Publication/security regression (13 pins) | Partially Covered | Covered: "inactive/password-change-required denied" (e.g. `subject-catalog-security-emulator:44`) and "`other_office` no authority" (T7.8). The other 11 publication pins are **missing**. |
| T12.6 | Browser smoke: 16-step Working + Published flow | **Missing** | `tools/browser-smoke.js` has no Teaching Assignment/package/release steps |
| T12.7 | Runtime residue greps (`other_office`, `ADFA`, `>ADC<`, `activeReleaseId`) | **Missing** | A process check, not automated; `other-office-removal` partially enforces the first |

---

## 3. Duplicates (same assertion, same layer)

| # | Requirement | Tests | Note |
|---|---|---|---|
| D1 | Subject-only save does not request DOE (T3.9 / T11.1) | `timetable-selection.test.js` "a Subject-only selection update does not request DOE recalculation"; `timetable-multi-edit-ui.test.js` "Subject selection uses the active catalog and a Subject-only save bypasses DOE work" | The first tests the selection module; the second is a source-shape test over the same save path. Low cost, but one could be dropped. |
| D2 | Ownership/metadata-only save does not request DOE (T11.2) | `timetable-selection.test.js` "Teaching Assignment ownership-only update does not request DOE recalculation"; `timetable-multi-edit-ui.test.js` "Teaching Assignment ownership participates in stale checks and metadata-only saves bypass DOE" | Same pattern as D1 |
| D3 | Retired `other_office` has no runtime capability (T6.10) | `other-office-removal.test.js:36`; `office-capabilities.test.js` "retired Other Office fails closed without calendar or operational authority" | Both are unit tests of `office-capabilities.forRole('other_office')` |

Layered coverage that is **not** a duplicate: Bill/Lisa handoff (pure responsibility `teaching-responsibility:12`, pure review `teaching-assignment-review:239`, rules `teaching-assignment-submission-security-emulator:216`); fingerprint replay (unit `:156`, rules `:125`); package locator absent from calendar (`timetable-multi-edit-ui`, `timetable-ownership-save:64`, `calendar.test.js`).

---

## 4. Conflicts and observations (reported, not changed)

**C1. The roster read policy contradicts the spec.** Plan T7 Step 5 and spec §10.1 say: "For the current phase, the full LAB roster is readable by every authenticated, active PAWS user." The branch rule `rosterReader()` (`firestore.rules:351`) allows only Developer/General/LAB, and `lab-group-security-emulator.test.js:86` pins that Faculty and Administrator **cannot** read rosters. Either the test and rule are an intentional tightening that needs recording as an approved deviation, or they diverge from the approved spec. This is a decision for the implementation owner.

**C2. The planned test files differ from the actual ones.**

| Planned | Actual |
|---|---|
| `academic-scope-security-emulator`, `teaching-assignment-group-security-emulator` | Folded into `teaching-assignment-submission-security-emulator`, `teaching-responsibility-security-emulator` and `tests/helpers/teaching-assignment-security.js` |
| `calendar-session.test.js` | `calendar.test.js` |
| `timetable-publication`, `faculty-capacity-security-emulator`, `seed-dataset` | Absent: their tasks (T8–T10, T12) have not started |

**C3. Emulator coverage is unverified here.** 163 checks, including every T7 rules test, skip unless `FIRESTORE_EMULATOR_HOST` is set. The Firestore emulator JAR download (`storage.googleapis.com`) is blocked in this environment, so I couldn't confirm they pass. The P3 branch should be run with `npm run test:emulator` before relying on the Covered marks in T3.2–T3.4, T5.3–T5.4 and T7.

**C4. Some assertions rely on the source text.** T4.9 (no `change_request*`) and T9.4 (no DOE from review) are regexes over `teaching-assignment-review.js`. They prove the *pure module* has no such calls, but not that the integrated UI flow (T8) won't. Behavioural tests should replace them when T8/T9 land.

**C5. A test will need to change in T8.** `work-queue.test.js:71` currently asserts HICC/VISC produce no queue items, but T8 requires HICC and VISC package items, so T8 must update it.

---

## 5. Test execution evidence (scratch worktree only)

Environment: detached worktree of the P3 branch @ `6ce74ef`, `npm ci --ignore-scripts`, Node test runner. **No test files were modified.**

| Command | Result |
|---|---|
| `node --test tests/*.test.js` | 1,298 tests: **1,134 pass, 1 fail, 163 skipped** |
| — the 1 failure | `hosting-boundary.test.js:77` "Azure stages the canonical config…": `spawnSync pwsh ENOENT` (PowerShell not installed here). Environmental, not a P3 defect. |
| — the 163 skips | Emulator-gated checks (`{skip:!enabled}`), including all T3/T5/T7 security-emulator tests |
| T2–T8-related unit files (19 files: `academic-responsibility`, `subject-catalog*`, `teaching-assignment-review`, `assignment-contributions`, `faculty-suggestions`, `teaching-assignment-groups`, `teaching-responsibility`, `temporal-role-assignment`, `other-office-removal`, `office-capabilities`, `user-management`, `timetable-selection`, `timetable-multi-edit-ui`, `timetable-ownership-save`, `workflow-functional-completion`, `calendar`, `rules-evaluation-budget`, `work-queue`) | **299 / 299 pass** |
| `npm --prefix server test` | **124 / 124 pass** |
| `npm run test:emulator` | **Not run**: emulator download blocked (403 from `storage.googleapis.com`) |

---

## 6. Method

1. Read the full P3.1 plan and extracted every requirement per task from its RED/"Pin"/"Must prove"/"Required" lists and the implementation rules, giving 95 rows (91 testable, 4 process steps).
2. Listed test files added or modified on the P3 branch versus `main` (17 added, 29 modified, plus `tools/browser-smoke.js` and `tools/seed/dataset.js`) and extracted every test title. For modified files, I extracted the added and removed titles from the diff.
3. Searched all tests for each requirement's key terms (`visc_review`, `submitted_to_adfad`, `timetable_publications`, `activeReleaseId`, `baseReleaseId`, `faculty_capacity_index`, `academicScopeTokens`, `lab_group_rosters`, `change_request`, `doe`, and others), then read the matching tests to confirm what each one actually asserts.
4. Checked the corresponding production code where a test's scope was unclear, for example that `work-queue.js` has no package logic and that `rosterReader()` excludes Faculty.
5. Ran the non-emulator and server suites in the scratch worktree to record the current pass state.
