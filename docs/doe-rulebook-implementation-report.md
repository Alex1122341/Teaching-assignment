# DOE Rule Book: Implementation and Verification Report (Round 1)

| | |
|---|---|
| Author | Sakib Hossain |
| Date | 2026-10-13 |
| Branch | `feature/doe-round1` (local), created from `main` @ `fb9a0b1` (latest `main` at the time of writing) |
| Scope | The 36-item DOE requirement list: check each item, fix what is missing or broken, test, document |
| Source of rules | *UCVM Workload Guidelines*, updated 2025-12-23, effective 2025-04-01 (Leadership approval 2025-02-26, Faculty Council 2025-03-12) |

## 1. Summary

| Result | Count | Items |
|---|---|---|
| Already implemented on `main`, verified | 27 | 1, 3–7, 9–12, 14, 17–28, 32–34, 36 (item 3 also got a clearer button label) |
| Fixed or completed in this branch | 3 | 2 and 35 (first-publish bug), 31 (DOE Rules page usability) |
| Implemented on the P3 branch, not yet on `main`; **decision needed** | 3 | 13, 15, 16 |
| Not implemented; **policy decision needed** (Round 2) | 2 | 8, 29 |
| Depends on the items above | 1 | 30 |
| **Total** | **36** | |

Nothing in this branch changes DOE rule values, Firestore security rules, live data, deployment, or DOE publication.

## 2. What changed in this branch

### Commit 1 – `fix(doe): allow first publication of an Academic Year with no Active version`

**Problem.** Publish compared the Active version recorded at Impact Preview time with the current Active version, but it also rejected the comparison outright when the recorded value was empty. A brand-new Academic Year (created by *New Policy Year* or *Copy from Previous Year*) has no Active version, and neither does a year whose Active version was archived. So the first Publish always failed with **`PREVIEW_STALE` – "Impact Preview is stale for the current Draft revision"**, and a new year could never become authoritative through the workflow.

**Fix.** The check now uses exact equality. "No Active version at preview" matches "still no Active version at publish". A preview taken before another version became Active is still rejected, so the protection against two administrators publishing at once is unchanged.

| File | Change |
|---|---|
| `doe-policy-service.js` | removed the `!expectedActiveVersionId` rejection in `publish()` |
| `doe-policy-repository.js` | same in the in-memory `publishVersion()` |
| `doe-policy-firestore.js` | same in the transactional Firestore `publishVersion()` (used by the DOE server) |
| `tests/doe-policy-publication.test.js` | +3 tests: first publish succeeds; first publish rejected if another version became Active after preview; re-publish after archive |
| `tests/doe-policy-timetable-integration.test.js` | +2 tests for the Firestore repository (success and concurrency rejection) using a transactional fake |

Three of the five new tests fail on the old code (the two "first publish" success cases and "re-publish after archive"); all five pass on the new code.

### Commit 2 – `feat(doe-rules): explain every disabled DOE Rules action and name the copy target year`

**Problem.** On the Frontend Demo and Firebase Lab sites (no DOE server), and whenever a step was not yet allowed, the buttons were greyed out with no explanation, so the page looked broken. Publish, Archive and Recalculate said "Developer / Owner only" even though ADFA General is also allowed. *Copy from Previous Year* and *Validate Rule Book* stayed clickable in read-only mode and only failed after a click. The copy button did not say which year it would create.

**Fix (screen only; permissions unchanged).**

- New pure function `actionAvailability()` in `doe-policy-admin.js` decides, for each button, whether it is enabled and the reason when it is not. `applyPermissions()` shows that reason as the button tooltip.

| Situation | Message shown |
|---|---|
| Frontend Demo | "Frontend Demo is read-only: connect the DOE server to change or publish DOE rules." |
| Firebase Lab | "Firebase Lab is read-only for DOE rules: the authoritative DOE server is not connected." |
| Role too low (Publish / Archive / Recalculate / Copy) | "ADFA General, Owner or Developer only" |
| Role too low (editing) | "Developer, ADFA General or ADFA Regular only" |
| Active / Archived version selected | "Select a Draft version first. Active and Archived versions are read-only." |
| Draft not validated | "Validate the current Draft revision first." |
| No passing preview | "Run a passing Impact Preview on the current Draft revision first." |
| Archive / Recalculate on a Draft | "Select the Active version first." |
| Copy target already exists | "2027-28 already has a Rule Book. Open it from the Academic Year list instead." |

- The copy button now reads **"Copy 2026-27 → 2027-28"**, and its tooltip explains that every copied item must be reviewed.
- A **next-step line** under the buttons ("Next step: Validate this Draft." → "run Impact Preview" → "Publish") guides the Draft → Validate → Impact Preview → Publish order.
- The existing read-only safety line (`if(state.demoReadOnly)…cap[key]=false`) is kept, and server-side permission checks are untouched.

| File | Change |
|---|---|
| `doe-policy-admin.js` | `actionAvailability()`, rewritten `applyPermissions()`, corrected role text |
| `faculty-admin.html` | `#doe-actions-hint` line under the lifecycle buttons |
| `doe-policy-admin.css` | hide the hint when empty |
| `tests/doe-policy-admin.test.js` | +5 tests (read-only reasons, workflow order, role messages, copy label and duplicate year, page markup) |

## 3. Requirement-by-requirement status

Legend: ✅ implemented and verified · 🔧 fixed in this branch · ⏸ decision needed · ❌ not implemented

| # | Requirement | Status | How it is implemented | Evidence (tests / checks) |
|---|---|---|---|---|
| 1 | Annual DOE Rule Book by Academic Year | ✅ | One policy per year (`ucvm-workload-YYYY-YY`) with numbered versions (Draft / Active / Archived) in `doe_policies`, `doe_policy_versions` | `tests/doe-policy-publication.test.js` (clone, calculateSession uses the year's Active version) |
| 2 | Draft / Validate / Preview / Publish / History | 🔧 | `doe-policy-service.js` lifecycle; History tab reads `doe_audit_log` through the DOE server audit API. **First publish of a new year fixed (commit 1)** | publication tests (incl. 5 new), `tests/doe-policy-preview.test.js`, sandbox walkthrough §4 |
| 3 | Copy previous-year Rule Book | ✅ + 🔧 label | `POST /api/doe/policy-years/{target}/copy-from/{source}` → `rulebook-service.copyAcademicYear` (new IDs, everything marked *Needs Review*, no history or one-time exceptions copied, General/Owner/Developer only, refuses an existing year). Button now names the target year | `server/test/rulebook-service.test.js:49,72,80`, `server/test/doe-routes.test.js:35`, new admin test |
| 4 | Teaching rules Lecture / SRL / Lab Primary / Lab Secondary | ✅ | Seed rules: Lecture 0.30 %/h, SRL 0.30 %/h, Lab Primary 0.21 %/h, Lab Secondary 0.19 %/h (Guideline §6.2 Table 1). *Note:* seed also has Lab Lead 0.21 and Lab Support 0.19, which are not in the guideline (decision §6) | `tools/doe-policy-2026-27-seed.json`, `server/test/guideline-rules.test.js`, `tests/doe-policy-engine.test.js:26` |
| 5 | Course Coordination tiers 1.75 / 3.5 / 7 / 10 / 15 % | ✅ | `role.course-coordinator`, lookup tiers <3, 3–5, 6–9, 10–14, 15+ units | `server/test/guideline-rules.test.js:31`, `tests/doe-policy-engine.test.js:366` |
| 6 | Rotation rules | ✅ | Participant 2.5 %/week; designated rotation coordinator 2 % fixed | seed; `server/test/guideline-rules.test.js:15-16` (parameterized guideline cases) |
| 7 | Supervision rules | ✅ | Undergraduate/summer/intern 1 %, 4th-year preceptor 0.75 %, graduate primary 3 %, co-supervisor 2 %, postdoc 1.5 % per trainee (§6.3 Table 2) | seed; `server/test/guideline-rules.test.js:17-21` |
| 8 | HICC only when applicable | ❌ ⏸ | HICC rule (2 %/unit) applies whenever the role exists; the guideline's "not applicable after the curriculum year is finalized" is not modelled. Round 2 (§6) | `rulebook-service.test.js:105` covers the mapping requirement only |
| 9 | VISC by stage / scope | ✅ | Per-year value lives in that year's Rule Book (2026-27: 5 %, `curriculumStage = year_2`); the 2027-28 Draft must be reviewed to 2.5 % per Guideline Table 3. Subject mapping is required | seed; `rulebook-service.test.js:119` |
| 10 | Mapping separate from rules | ✅ | `doe_course_mappings` / subject mappings stored and edited separately (Course Mapping / VISC Subjects tabs) | `rulebook-service.test.js:149,165,179`, `firestore-repository.test.js:88` |
| 11 | Server-side authoritative engine | ✅ | DOE server (`server/src/doe/*`) calculates; browser pages have no rate table or engine; browser writes to DOE collections are denied | `tests/doe-no-client-policy.test.js` (5 tests), `calculation-service.test.js:66` |
| 12 | Session Teaching DOE separate from Role / Service DOE | ✅ | Worksheet sections `scheduledTeaching`, `roles`, `supervision`, `adjustments` with separate subtotals | `server/test/worksheet-service.test.js:24` |
| 13 | Role Assignment active / expiration date | ⏸ | Not on `main`. Implemented on P3 (`temporal-role-assignment.js`, 9 commits by Alex, 2026-09-23); they do not apply cleanly to `main` (§5) | — |
| 14 | Role Assignment pulls DOE from the Rule Book | ✅ | `calculation-service.saveRoleAssignment` calculates with the Active Rule Book and stores rule, version and calculation ID | `doe-routes.test.js:102`, `firestore-repository.test.js:220` |
| 15 | Role manual override (+ / 0 / −) | ⏸ | On P3 only (signed `doeOverride`); same blocker as #13. Engine already allows signed *adjustment* results | `tests/doe-policy-engine.test.js:174` |
| 16 | Special notes | ⏸ (roles) / ✅ (office override) | Office override stores `overrideNotes`; Rule Book items have `adminNote`. Role notes are on P3 only | code review: `target-service.js:31,36` (`overrideNotes`); no test asserts the notes field |
| 17 | Office DOE Override managed separately | ✅ | `target-service.js` / `doe_faculty_targets`; separate "Office DOE override" section; needs a reason; admin-only; audited | `target-service.test.js:17,26`, `doe-routes.test.js:264` |
| 18 | Effective Target = Contract or approved override | ✅ | `effective = override ?? contractTeachingDoe`, server-side; fails with `DOE_TARGET_UNAVAILABLE` if neither exists | `target-service.test.js:17` (derivation); failure case: code review `target-service.js:35`, not covered by a test |
| 19 | Reserve calculated automatically | ✅ | `reserve-service.applyTeachingReserve` from the Rule Book reserve policy (split ≤ 35 %, ceilings 15 / 7.5 %); no manual entry | `server/test/reserve-service.test.js` (8 tests), `guideline-rules.test.js:45`, `server/test/guideline-scenarios.test.js` (Appendix scenarios 1–5) |
| 20 | FTE, Contract, Teaching and Role DOE separate | ✅ | FTE is an appointment field on the faculty record (Faculty Database); Contract Teaching DOE is its own field; the worksheet uses only Contract + override for the target and keeps Teaching and Role sections separate | code review: `faculty-admin.js` (FTE field), `target-service.js`, `worksheet-service.js` |
| 21 | Summary shows Target / Teaching / Role / Reserve separately | ✅ | Worksheet cards: Assigned Teaching DOE, Scheduled Teaching, Roles, Applied Supervision, Reserve, Effective Target, Remaining / Over, Policy Version | code review `doe-worksheet-view.js:147` (cards; no test checks them); `tests/doe-worksheet-view.test.js:20` (Lookup and DOE List show the same totals) |
| 22 | Impact Preview before publishing | ✅ | Required, and must match the exact Draft revision, rules checksum and dataset checksum | `tests/doe-policy-preview.test.js` (11 tests) |
| 23 | Only Published rules are authoritative | ✅ | Calculations use `currentActiveVersionId` only; Drafts can't be used for calculation or recalculation | `doe-policy-publication.test.js` (calculateSession), `doe-policy-recalculate.test.js:47` |
| 24 | Recalculate | ✅ | Dry run, then chunked execution with resume; General/Owner/Developer only; Active version only | `tests/doe-policy-recalculate.test.js` (13 tests); sandbox: 10/10 rows |
| 25 | Immutable calculation evidence | ✅ | `doe_calculation_records` created once (`EVIDENCE_ALREADY_EXISTS` on rewrite); browser read-only | `calculation-service.test.js:76`, `firestore-repository.test.js:247` |
| 26 | Save Rule Book, rule, inputs, result, ID, timestamp | ✅ | Evidence record: `policyVersionId`, `ruleId`, `ruleKey`, `ruleSnapshot`, `inputsSnapshot`, `parametersSnapshot`, `resultDoe`, `calculationId`, `calculatedAt`, `calculatedBy` | `doe-policy-service.js` `buildCalculationRecord`; the server's record (`server/src/doe/calculation-service.js` `calculationRecordFor`) also stores `factsSnapshot` and `referenceSnapshot`; `doe-policy-publication.test.js` (recordCalculation), `calculation-service.test.js:76` |
| 27 | Fail closed when a rule is uncertain | ✅ | Missing rule, input or mapping, or tied priority, returns an error, not a value | `doe-policy-engine.test.js:70,92`, `calculation-service.test.js:49,58,93` |
| 28 | Needs Review instead of DOE = 0 | ✅ | Worksheet and preview show *Needs Review* / *DOE unavailable*; a real calculated 0 is still shown as 0 | `doe-worksheet-view.test.js:32,41`, `doe-policy-preview.test.js:204,230` |
| 29 | Research / PPVM / Service / Admin from authoritative allocations | ❌ ⏸ | No allocation model yet; these are not inferred from the timetable today either. Round 2 (§6) | — |
| 30 | Beta: full Rule Book + Engine + Role Assignment + Override + Evidence + Audit | ⏸ | Rule Book, Engine, Override, Evidence and Audit are in place; complete once #13/15/16 (and #8, #29) land | all of the above |
| 31 | Dedicated DOE Rule Management page | 🔧 | *DOE Rules* tab in the Faculty Dashboard: rule editor, mappings, References, Reserve, lifecycle buttons. **Now explains every disabled action and shows the next step (commit 2).** Whether a separate standalone page is wanted is a decision (§6) | new admin tests; sandbox §4 |
| 32 | Each year based on the approved guideline | ✅ | Every enabled rule must reference a guideline Reference (`REFERENCE_REQUIRED`) | `guideline-rules.test.js:37` (every seed rule has a Reference); `REFERENCE_REQUIRED` check: code review `server/src/doe/rulebook-service.js:107,112`, no test triggers the rejection |
| 33 | Admins edit values, categories, conditions, mappings, notes, year | ✅ | Rule editor (selectors = conditions, parameters / tiers = values, category, enabled, review status, admin note); mapping and Reference editors; Academic Year = effective year | `tests/doe-policy-admin.test.js:64`, `rulebook-service.test.js:149,194` |
| 34 | Record guideline source per Rule Book | ✅ | References: title, version date, section, table, page, effective date, document link (field available; the 2026-27 seed References have no link yet), review status (e.g. `wg-6-2-t1`, §6.2 Table 1, 2025-12-23) | `guideline-rules.test.js:37`, `tests/doe-rulebook-admin.test.js` |
| 35 | Draft → Validate → Impact Preview → Publish | 🔧 | Enforced by revision and checksum gates; first-publish bug fixed; buttons now explain the order | as #2 |
| 36 | Copy forward must be reviewed before publishing | ✅ | Copied rows are `needs_review`; validation blocks with `ANNUAL_REVIEW_REQUIRED` until each is confirmed or updated | `rulebook-service.test.js:96` |

## 4. Testing

### Automated tests

| Suite | Baseline (`main` @ fb9a0b1) | This branch |
|---|---|---|
| Web (`npm test`) | 932 pass · 1 fail · 112 skipped | **942 pass** · 1 fail · 112 skipped (+10 new tests) |
| Server (`npm --prefix server test`) | 136 pass · 0 fail | **136 pass** · 0 fail |

- **The one failure is environmental and present on `main` too.** `tests/hosting-boundary.test.js` "Azure stages the canonical config…" needs PowerShell (`pwsh`), which the test machine did not have. It should pass on Windows.
- **The 112 skipped tests are Firestore-emulator tests.** The emulator could not be downloaded in the test environment. Please run `npm run test:emulator` on a machine with the Firebase CLI.

### Manual walkthrough with synthetic data

A local sandbox (`doe-sandbox.js`, kept outside the repo) serves the built Frontend Demo and replaces its read-only DOE service with the repo's real `doe-policy-service.js` and in-memory repository, using made-up data (6 faculty, 10 teaching rows, a 2026-27 Active Rule Book and an unpublished 2027-28 Draft). No Firebase or live data is involved.

| Step (ADFA General) | Result |
|---|---|
| 2026-27: Clone as Draft → Validate → Impact Preview → Publish | Each button enabled at the right step; v2 became Active; v1 archived |
| Recalculate | Dry-run confirmation, then "Recalculation complete: 10/10" |
| Archive | v2 archived |
| **2027-28 (never published): Validate → Impact Preview → Publish** | **v1 became Active** (failed with `PREVIEW_STALE` before commit 1) |
| Hover over disabled buttons | Every one shows its reason (table in §2) |
| ADFA Regular | Publish / Archive / Recalculate / Copy disabled with "ADFA General, Owner or Developer only" |
| Plain Frontend Demo (no sandbox) | All write buttons disabled with "Frontend Demo is read-only…", next-step line shows the same |
| Browser errors | none |

Copy from Previous Year is a server-only service (`rulebook-service`), so the sandbox does not run it; it is covered by the server tests listed under #3.

## 5. Role Assignment dates / override / notes (#13, #15, #16): why they are not in this branch

These features already exist on the P3 branch (`feature/scoped-parallel-assignment-workflow`) as 9 commits by Alex on 2026-09-23: `eaa2004`, `b57792c`, `c73336b`, `958eb30`, `57f2456`, `036efa5`, `412fd48`, `e51fd6b`, `c7db624` (temporal role windows, dated assignments, editor, signed override, notes, annual role copy, Calgary date boundaries).

- **The plan:** copy them unchanged, so the later P3 merge would not conflict.
- **What happened:** the first commit does not apply cleanly to `main`. Its edits to `faculty-admin.html` and `tools/static-assets.json` sit next to other P3-only modules (Subject Catalog, Academic Responsibility, etc.) that are not on `main`. As agreed, work stopped there and no adapted version was committed.

Options:
1. **Adapt to `main`.** Bring over only the role-related lines; P3's later merge would then need small manual resolutions in those two files.
2. **Wait for P3 to be merged.** No duplicate work.
3. **Alex decides** which of the two he prefers.

## 6. Decisions needed for Round 2

1. **HICC applicability (#8).** How is a curriculum year marked "finalized"? Proposed design: a yes/no *HICC development applicable* field on each Course Mapping, plus a matching condition on the HICC rule. HICCs keep their course-coordinator credit.
2. **Research / PPVM / Service / Admin (#29).** Categories, who enters them, and whether they count toward the Effective Target. Proposed design: an office-entered, audited allocation per faculty member per year, stored and shown separately from Teaching DOE, written only through the DOE server.
3. **Role features (#13/15/16).** Option 1, 2 or 3 in §5.
4. **Lab Lead / Lab Support rules.** These are in the seed but not in the guideline: keep or remove?
5. **Dedicated page (#31).** Is the DOE Rules tab enough, or is a separate page wanted?
6. **New Faculty Career Development.** The 10 %/year cap is enforced; the guideline's 2-year maximum is not. Not on the list, but worth deciding.

## 7. Not in scope / not done

- **Test gaps found during review:** no automated test covers the `REFERENCE_REQUIRED` rejection, the `DOE_TARGET_UNAVAILABLE` case, Office override notes, or the worksheet summary cards. The code is there (cited in §3); tests could be added in Round 2.

- **Loading the real 2026-27 Rule Book into the live database:** this requires the authorised "Firebase DOE Admin Job" and approval.
- **Changes to DOE values, Firestore rules, deployment, seeding or publication:** none.
- **Pushing:** nothing has been pushed. The branch is delivered as a git bundle.

## 8. How to review and test this branch

```powershell
git fetch C:\path\to\doe-round1.bundle feature/doe-round1:feature/doe-round1
git checkout feature/doe-round1
npm ci; npm --prefix server install
npm test
npm --prefix server test
# optional, needs Firebase CLI:
npm run test:emulator
```

Sandbox walkthrough (synthetic data, nothing real touched):

```powershell
node tools/build-static.js
$z = "0" * 40
node tools/stage-github-pages.js --directory .deploy-static --pr 1 --head-sha $z --build-sha $z
node C:\path\to\doe-sandbox.js .
# open http://127.0.0.1:8770/faculty-admin.html → yellow toolbar: ADFA General → DOE Rules
```
