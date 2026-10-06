# DOE Test Inventory

**PAWS support task 6**, a read-only research deliverable.

| | |
|---|---|
| Repository | `Alex1122341/Teaching-assignment` |
| Baseline | `origin/main` @ `7eb209f` (2026-10-05), the latest at time of writing. The two commits since the last report (`99bcde4`, `7eb209f`) are Lab provisioning/workflow fixes and don't touch DOE code. |
| Also checked | `origin/feature/scoped-parallel-assignment-workflow` @ `6ce74ef` (P3; unchanged since 2026-09-25), which adds temporal role-assignment DOE changes |
| Scope | DOE-related tests, Course/Subject mappings, Rule Book paths, workflow preview / session save, worksheet/target/reserve, reconciliation, role assignments, queue processor, and the browser/rules boundary |
| Constraint honoured | **Missing tests only.** This report doesn't propose or change any DOE formula, rate, mapping, threshold or tolerance. Every "missing test" describes behaviour **already present in the code** that has no test pinning it. Where a test would touch a value (e.g. the reconciliation tolerance), it is described as "at the existing value", without a number. |
| Changes made | None. Tests were run read-only in a scratch copy (§5). |

---

## 1. Summary

In brief:

- **42 DOE test files on `main`**:
  - **27 client-side** files under `tests/`, with **224 tests**, 12 of them Firestore-emulator checks.
  - **15 DOE server** files under `server/test/`, part of a 21-file, **136-test** server suite. The other 6 cover the API host and Azure SQL.
- **All non-emulator DOE tests pass** on `main` (212/212 client and 136/136 server) and on the P3 branch's server suite (124/124). The 12 DOE emulator checks were **not executed**, because the emulator download is blocked in this environment.
- **Strong coverage:** formula evaluator safety; policy engine precedence and fail-closed rules; Impact Preview and publication gates (exact revision, dataset checksum, stale evidence); recalculation (dry run, chunking, resume); the browser cannot compute or write DOE; Workload Guideline Appendix scenarios; reserve logic; worksheet fail-closed behaviour.
- **Main gaps (27 missing tests, §4):**
  1. **Academic Year derivation for sessions** is implemented in three places and tested in none.
  2. **Mapping ambiguity** (`COURSE_MAPPING_AMBIGUOUS`, `SUBJECT_MAPPING_AMBIGUOUS`) has no test, and neither does exception ambiguity (`EXCEPTION_AMBIGUOUS`).
  3. **Workflow preview server behaviour** beyond 5 happy-path tests: the error contracts, "unchanged facts keep stored DOE", duration refresh, relevance from mapping/exception inputs, and no-write on calculation failure are untested. The older browser-engine tests for these paths cover code that is no longer the active runtime.
  4. **Reconciliation edge cases:** the tolerance boundary, no-evidence, role-count mismatch, error/unavailable states, ambiguity codes and summary counts.
  5. **Rule Book lifecycle edges:** archive, invalid year, copy-size limit, invalid reference/review status, and Draft child deletion.
  6. **P3 branch:** the non-consecutive role-copy year, invalid override, and the T11 regression guards from the plan.

| Area | Test files | Tests | Coverage verdict |
|---|---:|---:|---|
| A. Formula evaluator + policy engine | 3 | 31 | Strong; 2 gaps |
| B. Course/Subject mappings | 5 (shared) | ~12 | Partial; ambiguity untested |
| C. Rule Book lifecycle (Draft, validate, preview, publish, archive, copy, references/reserve, history) | 9 | ~85 | Strong; edge gaps |
| D. Workflow preview / session save | 3 | 5 server + ~20 client adapter | **Weak** at the service level |
| E. Worksheet / target / reserve / DOE list | 6 | ~55 | Good; error-path gaps |
| F. Reconciliation | 2 | 8 (+ shared list tests) | Partial |
| G. Role assignments | 3 (+P3 additions) | 5 (main) / 9 (P3) | Partial on P3 |
| H. Queue processor, admin job, migration, seed | 4 | 25 | Good |
| I. Browser/rules boundary | 5 | ~40 | Strong (emulator part unexecuted) |
| J. API packaging / deployment / production gate | 4 | 9 | Adequate |

---

## 2. Inventory of DOE tests (`main` @ `7eb209f`)

The "Module(s) under test" column is taken from each file's `require`/`readFileSync` targets.

### 2.1 Client-side (`tests/`)

| File | Tests | Module(s) under test | What it pins |
|---|---:|---|---|
| `doe-formula.test.js` | 9 | `doe-formula.js` | Precedence, comparisons, approved helpers only, declared identifiers only, rejects executable JS, fails closed on missing/non-finite/div-by-zero, AST not code, typed parse errors |
| `doe-policy-engine.test.js` | 14 | `doe-policy-engine.js` | Per-hour rule with provenance; exception precedence; priority + `RULE_AMBIGUOUS`; missing input/rule fail closed; selector operators; calculation modes; signed adjustment vs non-negative credit; target rules; `validatePolicy` (duplicates, tier overlap, params, cycles); lookup tiers |
| `doe-policy-repository.test.js` | 8 | `doe-policy-repository.js` | Collection map, optimistic revision, Active/Archived not editable, append-only evidence, timestamp normalization |
| `doe-policy-preview.test.js` | 11 | engine + repository + service | Impact Preview: no source mutation, exact-revision validation, blocking errors, variance warning-only, dataset checksum, staleness, deterministic IDs, unavailable ≠ zero, summary |
| `doe-policy-publication.test.js` | 12 | engine + repository + service | Regular validates but can't publish; General needs current preview; rejects old revision/changed dataset/changed Active; archives the previous Active on publish; immutability; checksum stability; clone; `calculateSession` uses Active; immutable provenance |
| `doe-policy-recalculate.test.js` | 13 | admin + engine + repository + service + server policy-admin | Regular can't recalculate; Active required; dry run; chunked writes + derived index; partial-commit resume; budget; confirmation text; rules server-only |
| `doe-policy-migration.test.js` | 8 | engine + service | 2026-27 seed completeness; stable exception IDs; reproduces timetable rates; planner never infers formulas; shadow parity |
| `doe-policy-timetable-integration.test.js` | 9 | engine + firestore + repository + service + timetable | **Legacy browser-engine path**: new Lecture uses Active policy; room-only edit preserves DOE; duration/role edits recalc; missing input blocks save; audit evidence; swap via API |
| `doe-policy-admin.test.js` | 12 | `doe-policy-admin.js` | DOE Rules tab; API-only; role gates; Rule Builder normalization; server Rule Test; exception reason/scope; Impact renderer; Demo mode |
| `doe-rulebook-admin.test.js` | 11 | rulebook-admin + api-client + policy-admin | Annual Rule Book workspace, review states, mapping editor (Course/VISC), References/Reserve editors, history via server audit |
| `doe-policy-mapping-rules.test.js` | 1 (parameterised) | `firestore.rules` | Each DOE config collection is admin-readable and client read-only |
| `doe-policy-security-emulator.test.js` | 12 | rules (emulator) | Read/write boundaries for config, mappings, evidence, assignments, recalculation pairing. **Skipped here** |
| `doe-api-consumers.test.js` | 16 | api-client + timetable/approval/swap/session consumers | Browser uses only server DOE results; queued fallback strips evidence; unconfigured client fails early; legacy approval apply via API |
| `doe-no-client-policy.test.js` | 5 | page manifests | No browser engine or rate tables at runtime; DOE collections client read-only |
| `doe-canonical-consistency.test.js` | 5 | data-index + faculty-doe + Dashboard | Canonical target/assigned aggregation; no legacy-rate derivation; historical snapshots |
| `doe-worksheet-view.test.js` | 6 | `doe-worksheet-view.js` | Shared totals; Needs Review ≠ zero; real zero kept; provenance; API cache; fail closed when API unavailable |
| `doe-web-functional-completion.test.js` | 22 | worksheet-view + server worksheet-service | Dashboard DOE list/roles/KPI use the authoritative bulk summary; role editor; target saves invalidate the cache |
| `doe-explainability.test.js` | 4 | `doe-worksheet-view.js` | Explanation normalization, escaping, Explain controls |
| `doe-reconciliation.test.js` | 8 | worksheet-view + server worksheet-service | Status classification (matched, different, legacy-only, server-only, needs-review, missing-mapping), counts, work queue, bulk summary metadata, admin-only tab |
| `doe-assignment-migration.test.js` | 5 | `tools/plan-doe-assignment-migration.js` | Legacy HICC → fact candidate; parity mismatch unresolved; fixed-exception candidate; dry run; no write path |
| `firebase-doe-admin.test.js` | 9 | `tools/run-doe-admin-job.js` | Lab-locked CLI; typed confirmation; queue processor recalc/retry/scope/credited-hours refresh |
| `seed-doe-policy.test.js` | 3 | engine + legacy runtime + seed | Synthetic lab policy; every seeded assignment calculable; assignment-level source IDs |
| `doe-api-packaging.test.js`, `doe-api-deployment-workflow.test.js`, `production-doe-api-gate.test.js` | 1 + 3 + 4 | build/deploy tools | Packaging, manual exact-main deploy, no embedded credentials, production health/CORS/SQL gate |
| `policy.test.js`, `sessional-tab.test.js`, `office-timetable-rules.test.js` | 5 + 1 + 2 | rules / Dashboard | Adjacent role and audit policy; Sessional tab |

### 2.2 Server-side (`server/test/`)

| File | Tests | Module under test | What it pins |
|---|---:|---|---|
| `calculation-service.test.js` | 6 | `calculation-service.js` | HICC course mapping + database rate; **missing course mapping fails closed**; `RULE_AMBIGUOUS`; client `doeCredit` ignored; evidence only when persisting; **database-declared subject mapping requirement fails closed** |
| `firestore-repository.test.js` | 17 | `firestore-repository.js` | Active bundle incl. references + **annual mappings**; **mapping lookup year-scoped, fail closed**; Draft-only writes; worksheet source joins; fail closed on mixed versions/missing evidence; atomic role/session/target persistence; Draft mapping revision invalidates evidence; legacy target fallback |
| `rulebook-service.test.js` | 11 | `rulebook-service.js` | Copy year (config only, General/Owner only, refuses existing target); validation blocks copied-needs-review, **HICC missing course mapping**, **VISC missing subject mapping**; complete Draft validates; Draft mapping saves (admin only, fail closed); Needs Review / Retired mapping states; references + reserve |
| `policy-admin-service.test.js` | 8 | `policy-admin-service.js` | Server executes calculations for the actor; server Rule Test; bundle reads/Draft saves; legacy impact rows; recalculation provenance; policy year read; audit history |
| `doe-routes.test.js` | 16 | `routes/doe-routes.js` | Every DOE route's role gate (General vs Administrator aliases, Faculty self-only worksheet, admin-only list/targets/mappings/recalc/audit) |
| `workflow-preview-service.test.js` | 5 | `workflow-preview-service.js` | Transfer preview projections; client DOE ignored; save persists server DOE + evidence; new-session save; non-Faculty assignment has no DOE |
| `worksheet-service.test.js` | 6 | `worksheet-service.js` | Totals + reserve once; fail closed on a missing line / mixed versions; historical results don't drift; DOE list from the same contract; one bulk load |
| `reserve-service.test.js` | 8 | `reserve-service.js` | Reserve branches at the database-configured ceilings; supervision window; fail closed on missing/invalid policy |
| `guideline-scenarios.test.js` | 5 | `reserve-service.js` | Workload Guideline Appendix scenarios 1–5 reproduced |
| `guideline-rules.test.js` | 4 (+param) | engine + 2026-27 seed | Seed rules match the guideline; fixed course-coordination bands; references; reserve params in config |
| `target-service.test.js` | 2 | `target-service.js` | Contract/effective target derived server-side; non-admin and override-without-reason rejected |
| `legacy-policy-runtime.test.js` | 3 | `legacy-policy-runtime.js` | Impact dataset uses persisted evidence; stable annual facts; recalculation provenance |
| `role-assignment.test.js` | 2 (P3: 6) | `calculation-service.js` | Server-side role DOE + atomic evidence; non-admin denied. P3 adds date/override independence, invalid window, annual copy, non-empty target refusal. |
| `role-assignment-management.test.js` | 2 | `calculation-service.js` | List + deactivate with audit; refuses non-role/non-admin. P3: annual records + `effectiveStatus`. |
| `role-assignment-routes.test.js` | 1 | routes | Admin-only, identifiers preserved |

The other server tests (`app`, `server-wiring`, `data-routes`, `sql-*`, `firebase-sql-auth`) cover the API host and the Azure SQL session/user paths, not DOE logic.

---

## 3. Coverage by the four requested lenses

### 3.1 Mappings (annual Course/Subject)

| Behaviour in code | Tested? | Evidence |
|---|---|---|
| Mapping lookup scoped to Academic Year, fail closed | ✅ | `firestore-repository:88` |
| Missing **course** mapping fails closed at calculation | ✅ | `calculation-service:49` |
| Rule-declared **subject** mapping requirement fails closed | ✅ | `calculation-service:93` |
| Annual validation blocks active HICC without course mapping / VISC without subject mapping | ✅ | `rulebook-service:105, :119` |
| Draft mapping save: admin only, invalid facts fail closed, revision invalidates evidence | ✅ | `rulebook-service:149, :165`; `firestore-repository:285` |
| Needs Review stays; Retired mapping disabled | ✅ | `rulebook-service:179` |
| Mapping collections are client read-only | ✅ (static) / ⚠️ (emulator unexecuted) | `doe-policy-mapping-rules`; `doe-policy-security-emulator:202, :219` |
| **Multiple enabled course mappings → `COURSE_MAPPING_AMBIGUOUS`** | ❌ | `calculation-service.js:26`, `firestore-repository.js`: no test asserts it |
| **Multiple enabled subject mappings → `SUBJECT_MAPPING_AMBIGUOUS`** | ❌ | `calculation-service.js:33`: no test asserts it |
| Mapping-sourced input absent (`REQUIRED_INPUT_MISSING`) | ❌ | `calculation-service.js`: not asserted |
| Reconciliation treats `*_MAPPING_AMBIGUOUS` codes as Missing Mapping | ❌ | `doe-worksheet-view.js` `isMappingCode`: only `*_MAPPING_REQUIRED` is tested |

### 3.2 Rule Book paths

| Path | Tested? | Evidence |
|---|---|---|
| Draft edit with optimistic revision; Active/Archived immutable | ✅ | `doe-policy-repository:68, :91`; `doe-policy-publication:219` |
| Validate exact revision + checksum | ✅ | `doe-policy-publication:91`; `doe-policy-preview:115` |
| Impact Preview (non-mutating, staleness, deterministic, unavailable ≠ zero) | ✅ | `doe-policy-preview` (11) |
| Publish gates (General only, current preview, stale dataset/Active) and archive of the previous Active | ✅ | `doe-policy-publication:102–192` |
| Clone into the next Draft | ✅ | `doe-policy-publication:259` |
| Annual copy year (config only, General/Owner, refuses existing) | ✅ | `rulebook-service:49, :72, :80` |
| References + Reserve Draft writes | ✅ | `rulebook-service:194`; `doe-routes:247` |
| History/audit | ✅ | `policy-admin-service:119`; `doe-routes:287` |
| Recalculation (dry run, chunks, resume, Active only, Regular denied) | ✅ | `doe-policy-recalculate` (13) |
| **Stand-alone Archive** (`archive()` / `repository.archiveVersion`) | ❌ | Only route gating (`doe-routes:68, :76`) and delegation (`policy-admin-service:34`) are tested; the archive behaviour itself isn't |
| **`createPolicyYear` invalid year (`ACADEMIC_YEAR_INVALID`), existing policy/version (`POLICY_ALREADY_EXISTS`, `POLICY_VERSION_ALREADY_EXISTS`)** | ❌ | Not asserted |
| **Draft child deletion** (`deleteDraftRule`, `deleteSelector`, `deleteParameter`, `deleteTier`, `deleteRuleInput`, `deleteException`) with revision/preview invalidation | ❌ | No test references the repository delete methods |
| **Copy-year size limit (`POLICY_COPY_TOO_LARGE`)**, **invalid reference (`REFERENCE_INVALID`)**, **invalid annual review status (`ANNUAL_REVIEW_STATUS_INVALID`)** | ❌ | Not asserted |

### 3.3 Workflow preview and session save

| Behaviour in `server/src/doe/workflow-preview-service.js` | Tested at the server? | Notes |
|---|---|---|
| Transfer preview projections (current/projected) | ✅ | `:20` |
| Client-supplied DOE ignored / stripped | ✅ | `:31, :37, :70` |
| New canonical session can be saved | ✅ | `:54` |
| Non-Faculty assignment gets no DOE/evidence | ✅ | `:70` |
| **Academic Year derivation** (`academicYearForSession`: explicit wins; winter → prior start year; otherwise Jan–Apr → prior; invalid date → `ACADEMIC_YEAR_REQUIRED` 422) | ❌ | Also duplicated in `doe-api-client.js` and `tools/run-doe-admin-job.js`; **no test anywhere calls `academicYearForSession`** |
| **Unchanged DOE-relevant facts preserve stored `doeCredit` + provenance** | ❌ server | Only the legacy browser-engine test (`doe-policy-timetable-integration:68`) covers this, and `doe-no-client-policy` confirms that engine is no longer the active runtime |
| **Duration change refreshes `creditedHours` unless explicitly changed** | ❌ server | Covered only for the queued path (`firebase-doe-admin:96, :111`) |
| **Relevance derived from rule selectors/inputs, `course_mapping.*`/`subject_mapping.*` sources, and exception scopes** (`relevantFields`) | ❌ | A course/subject change under a mapping-sourced rule must trigger recalculation; untested |
| **Error contracts**: `SESSION_ID_REQUIRED`, `SESSION_NOT_FOUND` (no canonical and no after), `ASSIGNMENT_NOT_FOUND`, `FACULTY_ID_REQUIRED`, `SESSION_WRITE_REPOSITORY_REQUIRED` | ❌ | Not asserted |
| **Calculation failure during save → no repository write** | ❌ | E.g. a missing mapping should propagate with zero `saveSessionCalculationBundle` calls |
| **Faculty impact with unavailable current/target → `null` projected/remaining** (not zero) | ❌ | `impactRow()` |
| **Removed assignment → negative delta for that Faculty** | ⚠️ partial | Implied by the transfer test only |
| **Save when the canonical session changed after preview** | ❌ | `saveSessionChange` re-reads canonical; no test records that behaviour (see `change-request-regression.md` R1) |

### 3.4 Reconciliation (`doe-worksheet-view.js` `reconcileFaculty` / `buildReconciliationRows` / `workQueue` / `summarizeReconciliation`)

| Behaviour | Tested? | Evidence |
|---|---|---|
| matched / different_doe / legacy_only / server_only / needs_review / missing_mapping | ✅ | `doe-reconciliation:10, :23` |
| Source-role and server-fact counts; work queue excludes matched | ✅ | `doe-reconciliation:45` |
| Bulk summary metadata; admin-only; Demo mode | ✅ | `doe-reconciliation:64–120` |
| **Difference exactly at vs just above the existing tolerance; negative differences** | ❌ | Uses `Math.abs(difference) > tolerance`; the boundary is untested |
| **Neither server nor legacy evidence → needs_review + `no_evidence` flag** | ❌ | — |
| **`role_count_mismatch` flag** | ❌ | — |
| **`status` `error`/`unavailable`, `unratedLineCount > 0`, or `issueCount > 0` without codes → needs_review; auto codes `DOE_CALCULATION_ERROR` / `DOE_NEEDS_REVIEW`** | ❌ | Only `status:'needs_review'` with explicit codes is tested |
| **`*_MAPPING_AMBIGUOUS` codes → missing_mapping** | ❌ | — |
| **`summarizeReconciliation` counts (total, per status, actionable)** | ❌ | No test references it |
| **Full `workQueue` priority order** (missing_mapping → needs_review → legacy_only → different_doe → server_only) | ⚠️ partial | One two-row case only |

---

## 4. Missing tests

Each item names existing behaviour and where it lives. None of them requires or implies a change to formulas, rates, mappings, thresholds or tolerances.

### Engine and mappings

| ID | Missing test | Code location | Layer |
|---|---|---|---|
| M1 | Two equally-matching enabled exceptions → `EXCEPTION_AMBIGUOUS` (fail closed) | `doe-policy-engine.js` | unit |
| M2 | Lookup-tier value with no matching tier → `TIER_NOT_FOUND`; malformed tier/parameter/mode/input → `TIER_INVALID`, `PARAMETER_INVALID`, `CALCULATION_MODE_INVALID`, `INPUT_INVALID` | `doe-policy-engine.js` | unit |
| M3 | Multiple enabled course mappings for one course/year → `COURSE_MAPPING_AMBIGUOUS` (calculation service **and** repository lookup) | `server/src/doe/calculation-service.js:26`; `firestore-repository.js` | server unit |
| M4 | Multiple enabled subject mappings → `SUBJECT_MAPPING_AMBIGUOUS` | `calculation-service.js:33`; `firestore-repository.js` | server unit |
| M5 | Rule input sourced from a mapping field that the mapping lacks → `REQUIRED_INPUT_MISSING` | `calculation-service.js` | server unit |

### Rule Book lifecycle

| ID | Missing test | Code location | Layer |
|---|---|---|---|
| M6 | Archive: role gate at the service, effect on version status and the policy's active pointer, archiving a Draft vs an Active version, `REPOSITORY_CAPABILITY_MISSING` | `doe-policy-service.js` `archive()`; repository `archiveVersion` | unit |
| M7 | `createPolicyYear` rejects a bad year format (`ACADEMIC_YEAR_INVALID`) and duplicate policy/version IDs (`POLICY_ALREADY_EXISTS`, `POLICY_VERSION_ALREADY_EXISTS`) | `doe-policy-service.js:656`; `doe-policy-repository.js` | unit |
| M8 | Draft child deletes (rule, selector, parameter, tier, rule input, exception) enforce optimistic revision, invalidate validation/preview evidence, and are refused on Active/Archived | `doe-policy-repository.js` / `doe-policy-firestore.js` delete methods | unit |
| M9 | Copy-year refuses oversized copies (`POLICY_COPY_TOO_LARGE`); Reference save rejects invalid input (`REFERENCE_INVALID`); invalid annual review status rejected (`ANNUAL_REVIEW_STATUS_INVALID`) | `firestore-repository.js`; `rulebook-service.js` | server unit |

### Workflow preview and session save

| ID | Missing test | Code location | Layer |
|---|---|---|---|
| M10 | `academicYearForSession`: explicit `academicYear` wins; winter semester maps to the prior start year; no semester and month ≤ April maps to the prior start year; invalid date → `ACADEMIC_YEAR_REQUIRED` (422). The same cases are needed for the two duplicate implementations. | `server/src/doe/workflow-preview-service.js:11`; `doe-api-client.js`; `tools/run-doe-admin-job.js` | server unit + unit |
| M11 | Server preview/save: an edit that changes no DOE-relevant fact preserves the stored `doeCredit`, policy version, rule and calculation IDs, and makes no calculation call | `workflow-preview-service.js` (`factsChanged` branch) | server unit |
| M12 | Server preview/save: a start/end change recomputes `creditedHours` when it wasn't explicitly changed, and keeps an explicit `creditedHours` | `workflow-preview-service.js` | server unit |
| M13 | `relevantFields`: a course change under a rule with a `course_mapping.*` input, a `subjectKey` change under `subject_mapping.*`, and exception scopes (faculty/session/course/role/assignment/date) each mark the edit DOE-relevant | `workflow-preview-service.js` `relevantFields` | server unit |
| M14 | Error contracts: `SESSION_ID_REQUIRED`, `SESSION_NOT_FOUND`, `ASSIGNMENT_NOT_FOUND`, `FACULTY_ID_REQUIRED`, `SESSION_WRITE_REPOSITORY_REQUIRED` | `workflow-preview-service.js` | server unit |
| M15 | A calculation error during `saveSessionChange` (e.g. missing/ambiguous mapping) propagates and results in **zero** `saveSessionCalculationBundle` calls | `workflow-preview-service.js:138` | server unit |
| M16 | Faculty impact rows keep `null` projected/remaining when the worksheet's current or target DOE is unavailable | `workflow-preview-service.js` `impactRow` | server unit |
| M17 | A removed assignment yields a negative delta and an impact row for the outgoing Faculty member (outside the transfer helper) | `workflow-preview-service.js` | server unit |
| M18 | Document current behaviour when the canonical session differs from the caller's `beforeSession` at save time (no assertion of desired behaviour, just pin what happens today) | `workflow-preview-service.js` `saveSessionChange` | server unit |

### Worksheet, target, reserve and routes

| ID | Missing test | Code location | Layer |
|---|---|---|---|
| M19 | Target service rejects invalid target input (`DOE_TARGET_INVALID`) and an unknown Faculty member (`FACULTY_NOT_FOUND`); repository reports `DOE_TARGET_AMBIGUOUS` for conflicting canonical targets | `target-service.js`; `firestore-repository.js` | server unit |
| M20 | Reserve service rejects invalid inputs (`RESERVE_INPUT_INVALID`) and an invalid supervision count (`SUPERVISION_COUNT_INVALID`) | `reserve-service.js` | server unit |
| M21 | Each DOE route returns its 503 code when its backing service is absent (`CALCULATION_SERVICE_UNAVAILABLE`, `POLICY_ADMIN_UNAVAILABLE`, `RULEBOOK_SERVICE_UNAVAILABLE`, `TARGET_SERVICE_UNAVAILABLE`, `WORKFLOW_PREVIEW_UNAVAILABLE`, `WORKFLOW_WRITE_UNAVAILABLE`, `WORKSHEET_SERVICE_UNAVAILABLE`) | `routes/doe-routes.js` | server unit |

### Reconciliation

| ID | Missing test | Code location | Layer |
|---|---|---|---|
| M22 | Difference equal to the **existing** tolerance stays `matched`; a difference just beyond it becomes `different_doe`; a negative difference behaves symmetrically | `doe-worksheet-view.js` `reconcileFaculty` | unit |
| M23 | No server row and no legacy evidence → `needs_review` with `no_evidence`; legacy managed-role count ≠ server role count → `role_count_mismatch` | same | unit |
| M24 | Server `status` `error`/`unavailable`, `unratedLineCount>0`, or `issueCount>0` → `needs_review`, with auto codes `DOE_CALCULATION_ERROR`/`DOE_NEEDS_REVIEW`; `COURSE_/SUBJECT_MAPPING_AMBIGUOUS` → `missing_mapping`; `summarizeReconciliation` counts; full `workQueue` order across all six statuses | `doe-worksheet-view.js` | unit |

### P3 branch (`6ce74ef`) only

| ID | Missing test | Code location | Layer |
|---|---|---|---|
| M25 | Annual role copy refuses a non-consecutive target year (`ROLE_COPY_YEAR_INVALID`); role save rejects an invalid override (`ROLE_DOE_OVERRIDE_INVALID`) | P3 `server/src/doe/calculation-service.js` | server unit |
| M26 | Worksheet output for role records whose date window is expired or not yet active: what `roleAssignmentRecords` and the totals contain, pinned as they are today | P3 `server/src/doe/worksheet-service.js` | server unit |
| M27 | Plan T11 guards (also listed in `test-coverage-inventory.md`): two HICC assignments for the same Faculty on different courses/years are calculated independently and never copied; VISC role DOE uses the role/course/subject/year mapping regardless of group leadership; no DOE request from HICC Submit, VISC Approve/Push Back, HICC Final Submit, contribution saves, or (when T9 lands) release build/validate/seal/activate/republish; no hard-coded HICC/VISC values in source | P3 calculation service, review module, future publication module | server unit + static |

### Not missing, but unverified

The **12 DOE emulator checks** in `doe-policy-security-emulator.test.js` exist. They cover config/mapping/evidence/assignment write denial and recalculation-request pairing, but they couldn't be executed here. Run `npm run test:emulator` before relying on them.

---

## 5. Test execution (scratch copies, read-only)

| Suite | Branch | Result |
|---|---|---|
| 27 client DOE test files (`tests/doe-*.test.js` plus `firebase-doe-admin`, `policy`, `seed-doe-policy`, `sessional-tab`, `production-doe-api-gate`) | `main` @ `7eb209f` | 224 tests: **212 pass, 0 fail, 12 skipped** (emulator) |
| `npm --prefix server test` | `main` @ `7eb209f` | **136 / 136 pass** |
| `npm --prefix server test` | P3 @ `6ce74ef` | **124 / 124 pass** (the branch predates main's Azure SQL server tests) |
| Firestore emulator suite | — | **Not run**: emulator download blocked (403 from `storage.googleapis.com`) |

---

## 6. Method

1. Fetched `origin` (read only) and created detached scratch worktrees for `main` @ `7eb209f` and P3 @ `6ce74ef`.
2. Listed DOE source modules (11 client, 9 server DOE services plus routes, 3 tools) and every test file touching them. I mapped each test file to its module(s) via `require`/`readFileSync` and extracted every test title (355 lines).
3. Function-level check: listed each DOE module's exports and searched all tests for references. Error-contract check: extracted every DOE error code thrown (`ApiError`, `DoeServiceError`, `DoePolicyError`, `RepositoryError`, …) and searched tests for each. Each candidate gap was then confirmed by reading the relevant test bodies, because some tests assert by message regex rather than by code.
4. Read `workflow-preview-service.js`, the reconciliation functions in `doe-worksheet-view.js`, the mapping lookups in `calculation-service.js`, and the archive/create paths in `doe-policy-service.js` to describe the existing behaviour each missing test would pin.
5. Compared P3-branch DOE server changes (temporal role windows, overrides, annual role copy, worksheet role records) with their new tests.
6. Ran the non-emulator DOE suites. Nothing in the repository was modified, and no DOE formula, rate, mapping, threshold or tolerance was proposed or changed.
