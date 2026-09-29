# Change Request Regression Matrix

**PAWS support task 5**, a read-only research deliverable.

| | |
|---|---|
| Repository | `Alex1122341/Teaching-assignment` |
| Code documented | `origin/feature/scoped-parallel-assignment-workflow` @ `6ce74ef` (P3 branch) and `origin/main` @ `5ecbb39`. The approval logic is the same on both: the P3 branch changes only office display labels (`ADC/DVM`, `ADFAD`) and how ADC/LAB subscribe to their approval records (by granted `officeAccess` instead of primary role). |
| P3 target reference | Spec §3.2 ("Explicit Change Request approval"), §15 invariants 13, 14 and 36; Plan T9 Step 7 and T12 Step 4 |
| Changes made | None. No approval logic, rules, tests or data were changed. Existing tests were run read-only in a scratch copy (§6). |

---

## 1. Summary

In brief:

- **Approve, reject, push back, resubmit and revision are well covered** by pure-module unit tests (`approval-lifecycle`, `approval`, `approval-request`) and by Firestore-rules emulator tests (`approval-lifecycle-security-emulator`, `approval-order-security-emulator`, `approval-security-emulator`, `ws5b-security-matrix-emulator`).
- **The stale-session check exists but only on the client.** `approval-finalizer.js` `assertPublicBase()` blocks apply when a *changed* field no longer matches `basePublic`, and it is unit-tested. `firestore.rules` does **not** compare the current session with `basePublic`, so the protection depends on the client code running.
- **Double apply is guarded but untested.**
  - The finalize transaction refuses `appliedRevision === revision` or `appliedAt`.
  - The rules require `pending → approved` in the same write as the session change.

  Neither is directly exercised by a test that tries to apply twice.
- **Deleted session is handled but untested.** Finalize throws "…session no longer exists" and the request stays `pending` until an office rejects it. No test covers this.
- **Published v1 → changed Working and `baseReleaseId` mismatch are unimplemented.** There is no release model, no `baseReleaseId` field (it isn't even in the `publicRequestKeysValid` allowlist), and no tests (Plan T9 Step 7).
- **New risks found** (§5):
  - Faculty-change apply saves the session *before* the final transaction, so it isn't atomic.
  - On the P3 branch, a `session_edit` request against a **Teaching-Assignment-owned** session likely can't be applied, because the owned-session update rule has no branch for routed apply.

| Scenario | Implemented today | Test coverage |
|---|---|---|
| S1 Approve | Yes | Covered (unit + emulator) |
| S2 Reject | Yes | Covered (unit + emulator) |
| S3 Push back | Yes | Covered (unit + emulator) |
| S4 Resubmit | Yes | Covered (unit + emulator) |
| S5 Revision (approval carry-over/reset) | Yes | Covered (unit); Partial (emulator) |
| S6 Stale session | Yes (client-side only) | Partial: unit only; no rule enforcement |
| S7 Published v1 → changed Working | **No** | Missing (P3 T9) |
| S8 `baseReleaseId` mismatch | **No** | Missing (P3 T9) |
| S9 Deleted session | Yes (fails, stays pending) | **Missing** |
| S10 Double apply | Yes (transaction + rules) | **Missing** (no explicit second-apply test) |

---

## 2. The existing Change Request path

### 2.1 Records (routed schema `office-routing-v1`)

| Collection | Doc id | Written at | Content |
|---|---|---|---|
| `change_requests` | auto | submit, then updated by decisions/resubmit/withdraw/apply | Public, allowlisted (`publicRequestKeysValid`, `firestore.rules:33`): requester, `sessionId`, `requestType` (`session_edit` \| `faculty_swap`), `status`, `revision`, **`basePublic`** (snapshot of the session's public fields), `patchPublic`, display-only Faculty names, `editableFields`, `requesterMessage`, `appliedRevision`, `appliedAt` |
| `change_request_workflow` | same id | submit/resubmit | `requiredOffices`, `scopes` (fields per office), `scopeSignatures`, `hasFacultyChange`, `revision` |
| `change_request_approvals` | `{id}_{office}` | submit; office decision; resubmit | Per-office `status` (`pending`/`approved`/`push_back`/`rejected`/`cancelled`), `fields`, `scopeSignature`, decider, `pushBackReason` |
| `change_request_private` | same id | submit (swap only); resubmit | ADFA-only `assignmentChange` (`assignmentIndex`, `from`, `to` opaque refs) |
| `change_request_audit` | auto | every transition | Event log (`request_submitted`, `office_approve`/`_reject`/`_push_back`, `request_resubmitted`, `request_withdrawn`, `request_applied`) |
| `sessions` + `calendar_sessions` + `session_change_log` | session id / auto | final apply only | Source patch with the `approvalRequestId`/`approvalRevision` marker, sanitized projection, change log |

A legacy (non-routed) request path still exists (`approval-workflow.js` `approveRequest()` ~l.590 / `rejectRequest()` ~l.625, with rules `legacyRequestRead`/`validRequestDecision`). It has its own stale check (`validateBase`) and is covered by `legacy-approval-companion-emulator` and `ws5a-approval-actions`.

### 2.2 Lifecycle

```text
Faculty / HICC / VISC (facultyMember) — from the Working session
   └─ submit()                                   approval-request.js buildRecords()/submit()
        basePublic = publicSession(Working session)   ← base is WORKING data today
        routing.build(base, patch) → requiredOffices ∈ {adc, lab, adfa}, per-office scopes + signatures
        one batch: request + workflow + approvals + (private) + audit + notifications
        status = pending, revision = 1
             │
             ▼   strictly serial approval: ADC/DVM → LAB → ADFAD (only offices that are required)
   office decision (transaction)                 approval-workflow.js decideRoutedRequest()
        approve   → approval.status = approved   (blocked while an earlier office is not approved:
                                                  approval-lifecycle.js assertDecisionOrder())
        push_back → request.status = update_required, editableFields ∪= office scope, message required
        reject    → request.status = rejected (terminal); other unfinished approvals → cancelled
             │
             ├── update_required ──► requester resubmit (transaction)  planRequesterResubmission()
             │        only editableFields may change; revision+1; returned/new offices reset to pending;
             │        untouched approved scopes stay approved; date/start/end change + Faculty change → ADFA reset
             │
             ├── requester withdraw (pending|update_required) → withdrawn; unfinished approvals cancelled
             │
             ▼   when the last required office approves (requiredApproved(): status + fields + scopeSignature match)
   finalizeRoutedRequest()                       approval-workflow.js ~l.505
        session_edit  : transaction → re-read request/workflow/approvals/calendar
                        → status must be pending, not already applied
                        → finalizer.planPublicApply(): stale check on changed fields, timing validation
                        → write sessions (+approvalRequestId/Revision), calendar_sessions, change log, audit,
                          request {status: approved, appliedRevision, appliedAt}
        faculty_swap  : ADFA only → resolve replacement (swap map / faculty doc) → preflight planFacultySwap()
                        (stale check on ALL basePublic fields + outgoing instructor still assigned)
                        → conflict/AFC warnings, override confirm
                        → doeApi.saveSessionChange()  ← session written HERE, before the transaction
                        → transaction: status pending, not already applied, approvals complete
                          → change log, audit, request approved/applied
```

### 2.3 Where each guard is enforced

| Guard | Pure module (unit-testable) | Client transaction | Firestore rules |
|---|---|---|---|
| Serial office order | `approval-lifecycle.js` `assertDecisionOrder` | via `planDecision` | yes (`approval-order-security-emulator`) |
| Push Back needs a message | `planDecision` | — | — |
| Reject is terminal | `approval-state.js` `decide` | — | terminal requests can't reactivate (`approval-lifecycle-security-emulator:42`) |
| Only returned fields editable on resubmit | `planRequesterResubmission` | — | `validRoutedRequesterResubmit` (`…-emulator:50`) |
| All required approvals current | `requiredApproved` (status + fields + scopeSignature) | re-checked in transaction | `allRequiredApproved` (status only; comment at `firestore.rules:160–162` explains why) |
| Stale base (changed fields) | `approval-finalizer.js` `assertPublicBase` | inside the apply transaction | **not enforced** |
| Not already applied | — | `appliedRevision===revision \|\| appliedAt` → throw | `before.status=='pending' && after.status=='approved' && appliedRevision==revision` (`routedApplyContextValid`, `firestore.rules:166`) |
| Session write bound to the approved request | — | marker `approvalRequestId`/`approvalRevision` | `routedSessionApply` + `sourceMatchesPublicPatch` (`firestore.rules:176–185`) |
| Faculty change finalized only by ADFA | `approval-state.js` `canFinalize` | `currentOffice!=='adfa'` → throw | `!workflow.hasFacultyChange \|\| hasOfficeAccess('adfa')` |
| Session/calendar still exists | — | `readRoutedBundleTx` throws | implicit (updating a missing doc fails) |

---

## 3. Regression matrix

"Current expected" is what the code does today. "P3 delta" is what must change or stay fixed under P3 (spec §3.2, invariant 36; Plan T9 Step 7, T12 Step 4). Test references are P3-branch `tests/…:line`.

### S1: Approve

| ID | Scenario | Current expected result | Enforced by | Existing tests | Status |
|---|---|---|---|---|---|
| S1.1 | ADC approves its own scope; request stays pending until final apply | ADC approval → `approved`; request `pending` | `planDecision`; rules | `approval-lifecycle:17`; `approval-lifecycle-security-emulator:32` | Covered |
| S1.2 | Serial order ADC → LAB → ADFA | LAB/ADFA approve blocked while an earlier office is pending | `assertDecisionOrder`; rules | `approval-lifecycle:135, :140, :147, :181`; `approval-order-security-emulator:37–67` | Covered |
| S1.3 | No LAB stage (non-LAB type) | ADFA unlocked after ADC | same | `approval-lifecycle:162` | Covered |
| S1.4 | Office not required tries to act | Denied | same | `approval-lifecycle:188`; `approval-security-emulator:34` | Covered |
| S1.5 | Developer approves multiple scopes | Allowed but still serial | same | `approval-order-security-emulator:89`; `approval-security-emulator:47` | Covered |
| S1.6 | Last office approves a non-Faculty request → apply | Source + calendar + log + audit + request `approved/appliedRevision/appliedAt` in one write | `finalizeRoutedRequest`; `validRoutedApply`/`routedSessionApply` | `approval-lifecycle-security-emulator:59`; `approval:391, :424, :219` | Covered |
| S1.7 | Faculty-changing request finalized by a non-ADFA office | Refused | client + rules | `approval:324, :384` (source); `ws5b-security-matrix-emulator:46` | Covered |
| S1.8 | Approval scope signature changed after approval | Finalization refused | `requiredApproved` | `approval-lifecycle:120` | Covered |

P3 delta: none. Order and approver semantics must stay unchanged (invariant 14).

### S2: Reject

| ID | Scenario | Current expected result | Enforced by | Existing tests | Status |
|---|---|---|---|---|---|
| S2.1 | Any required office rejects | Request `rejected` (terminal); other pending/push-back approvals `cancelled` | `approval-state.decide` | `approval-lifecycle:35`; `approval:271` | Covered |
| S2.2 | Reject isn't blocked by stage order | Later office may reject while an earlier one is pending | `planDecision` (only `approve` checks order) | `approval-lifecycle:194`; `approval-order-security-emulator:73` | Covered |
| S2.3 | Rejected request can't be reactivated or withdrawn | Denied | `withdraw` state check; rules | `approval-lifecycle-security-emulator:42`; `approval:315` | Covered |

P3 delta: none.

### S3: Push back

| ID | Scenario | Current expected result | Enforced by | Existing tests | Status |
|---|---|---|---|---|---|
| S3.1 | Office pushes back with a message | Request `update_required`; `editableFields` = that office's scope; message shown without office identity | `planDecision` | `approval-lifecycle:26`; `approval:280` | Covered |
| S3.2 | Push Back without a message | Refused | `planDecision` | (implicit in `approval-lifecycle:26`) | Partial: no explicit empty-message assertion found |
| S3.3 | Second office pushes back | Editable fields are the union; earlier returned fields kept | `decide` | `approval-lifecycle:61`; `approval:342` | Covered |
| S3.4 | Other offices keep deciding while `update_required` | Allowed | `decide` accepts `update_required` | `approval:333` | Covered |
| S3.5 | Push Back not blocked by stage order | Allowed | `planDecision` | `approval-order-security-emulator:73` | Covered |

P3 delta: none. The HICC/VISC package Push Back is a separate record and must not touch `change_request*` (invariant 13).

### S4: Resubmit

| ID | Scenario | Current expected result | Enforced by | Existing tests | Status |
|---|---|---|---|---|---|
| S4.1 | Requester edits only returned fields | Allowed; other fields refused ("Field X is not editable in this revision") | `planRequesterResubmission` | `approval-lifecycle:78`; `approval-lifecycle-security-emulator:50` | Covered |
| S4.2 | Resubmit without any change | Refused ("Enter at least one returned-field change") | same | not asserted explicitly | Partial |
| S4.3 | Resubmit when not `update_required` | Refused | same | `approval-lifecycle` (state check via `planRevision`) | Covered |
| S4.4 | Requester resubmits without reading internal workflow/approvals/private docs | Planned from the public request only | same | `approval-lifecycle:78, :92, :105`; `approval:413` | Covered |
| S4.5 | Faculty replacement resubmission (candidate / Sessional / Other + reason) | Display name public; opaque private target; reason required for special targets | `facultyEditFromChoice`; private write | `approval-lifecycle:67, :113`; `approval-request:88, :98`; `approval:405, :430`; `faculty-swap-security-emulator:69` | Covered |
| S4.6 | Only the requester can resubmit or withdraw | Others denied | transaction check; rules | `ws5b-security-matrix-emulator:53`; `approval-lifecycle-security-emulator:42` | Covered |

P3 delta: none to semantics. When requests start from the Published view, resubmission must **keep** the original `baseReleaseId` (immutable provenance, Plan T9 Step 7).

### S5: Revision (approval carry-over and reset)

| ID | Scenario | Current expected result | Enforced by | Existing tests | Status |
|---|---|---|---|---|---|
| S5.1 | Unchanged approved scopes stay approved after resubmit | Carried over; returned/new offices reset to `pending`; `revision+1` | `planRevision` / `planRequesterResubmission` | `approval:289`; `approval-lifecycle:78` | Covered |
| S5.2 | Date/time change with assigned Faculty reopens ADFA | ADFA reset to `pending` | `planRevision` (`forceAdfa`) | `approval-lifecycle:49`; `approval:304` | Covered |
| S5.3 | Type change moves Topic ownership (LAB ↔ ADC) | Routing recomputed from final type | `routing.build` | `approval:142, :154` | Covered |
| S5.4 | Deterministic scope signatures | Same signature regardless of key order | `scopeSignature` | `approval:166`; `approval-request:108` | Covered |
| S5.5 | An office dropped from routing on revision | Its approval is `cancelled` | `cancelOffices` | no direct test | Partial |
| S5.6 | Apply uses the **current** revision only | `approvalRevision == revision` bound in rules | `routedSessionApplyFor` | `approval-lifecycle-security-emulator:59` (happy path only) | Partial: no test that an old-revision marker is denied |

P3 delta: none.

### S6: Stale session (Working changed after the request was created)

| ID | Scenario | Current expected result | Enforced by | Existing tests | Status |
|---|---|---|---|---|---|
| S6.1 | `session_edit`: a **requested** field changed in Working after submit | Apply throws "The session changed after the request was submitted (field)"; nothing written | `finalizer.assertPublicBase` inside the apply transaction | `approval:30` | Covered (unit) |
| S6.2 | `session_edit`: an **unrelated** field changed | Apply proceeds; only requested fields are compared (by design) | `changedFields()` scope | not asserted | Partial: behaviour undocumented in tests |
| S6.3 | `faculty_swap`: any `basePublic` field changed, or outgoing instructor no longer assigned | Blocked before the DOE save | `planFacultySwap` | `approval:55` | Covered (unit) |
| S6.4 | Legacy request stale | Blocked before prompting or writing | `validateBase` | `ws5a-approval-actions:34` | Covered |
| S6.5 | A client skips the stale check and writes the approved patch over newer data | **Allowed by rules**: `sourceMatchesPublicPatch` checks only that the new value equals `patchPublic`, not that the old value equalled `basePublic` | not enforced | none | **Missing (rules gap)** |

P3 delta: Plan T9 Step 7 says "final apply re-resolves Working state and fails closed when stale". The client check does that today. Whether the rules should also enforce it is an open question (§5 R3).

### S7: Published v1 → changed Working data

| ID | Scenario | P3 target | Current state | Status |
|---|---|---|---|---|
| S7.1 | Faculty creates a request from Published release v1; ADFA later edits Working; request applied | Request carries `baseReleaseId=v1` plus base-session evidence; final apply compares the reviewed base with **current Working**, fails closed if they differ, and never silently overwrites newer Working data | No release exists. `basePublic` is taken from **Working** (`approval-workflow.js` `baseSnapshot()` → `publicSession(Working session)`). The Working-vs-base comparison already happens for requested fields (S6.1), but there is no Published provenance. | **Unimplemented / Missing** |
| S7.2 | Working changed only in fields the request doesn't touch | Needs a decision: fail closed (strict release base) or allow (field-scoped, as today)? | Allowed (S6.2) | **Unclear**: spec says "fails closed when the reviewed base is stale" but doesn't define field scope |
| S7.3 | Published v1 differs from Working *at request time* (Working already moved on before the Faculty member saw v1) | Request base = Published v1, which differs from Working at creation, so apply must fail closed or require re-basing | Not possible today (base is Working) | **Unimplemented** |
| S7.4 | Publish v2 while a v1-based request is pending | Request keeps `baseReleaseId=v1`; publication doesn't mutate or apply requests (invariants 33–34) | N/A | **Unimplemented** |

### S8: `baseReleaseId` mismatch

| ID | Scenario | P3 target | Current state | Status |
|---|---|---|---|---|
| S8.1 | Request `baseReleaseId` ≠ release the base evidence came from (forged/mismatched) | Create denied | `baseReleaseId` is **not** in `publicRequestKeysValid`, so a request containing it would be *rejected* today | **Unimplemented** |
| S8.2 | `baseReleaseId` changed on resubmit | Denied (immutable provenance) | N/A | **Unimplemented** |
| S8.3 | `baseReleaseId` refers to an inactive/unsealed/missing release | Create denied / fail closed | N/A | **Unimplemented** |
| S8.4 | Active release advanced since the request (v1 → v2) | Not a mismatch by itself; stale-base check against Working decides (S7) | N/A | **Unimplemented**, needs a spec decision on whether to block or only warn |

### S9: Deleted session

| ID | Scenario | Current expected result | Enforced by | Existing tests | Status |
|---|---|---|---|---|---|
| S9.1 | Session (and calendar) deleted while a routed `session_edit` is pending; last office approves | Decision saved, then apply throws "The sanitized calendar session no longer exists." Request stays **`pending`** with all approvals `approved`; nothing is written to sessions | `readRoutedBundleTx` (`includeCalendar`) | none | **Missing** |
| S9.2 | Same for `faculty_swap` | Throws "Required private Faculty/session data is missing." before the DOE save | `finalizeRoutedRequest` pre-read | none | **Missing** |
| S9.3 | Legacy request on a deleted session | Toast "The session no longer exists. Reject or review this request manually."; no write | `approveRequest` | none | **Missing** |
| S9.4 | Recovery path | An office must **Reject**; there is no automatic cancel on session delete | — | none | **Missing**; also a product decision (should delete cancel open requests?) |
| S9.5 | Delete allowed while requests are pending? | Yes: `sessions` delete rule doesn't check open requests | rules | none | Observation |

### S10: Double apply

| ID | Scenario | Current expected result | Enforced by | Existing tests | Status |
|---|---|---|---|---|---|
| S10.1 | Same office clicks apply twice, or two approvers race on a `session_edit` | Second transaction throws "This request is no longer pending" / "…revision was already applied"; the rules also deny a second `pending → approved` | transaction + `routedApplyContextValid` (`before.status=='pending'`) | `approval:391` checks only that the source mentions `appliedRevision` | **Missing**: no unit/emulator test that performs a second apply |
| S10.2 | Replay the session write with an old `approvalRequestId`/`approvalRevision` after apply | Denied: `routedSessionApplyFor` requires the parent to go `pending → approved` in the same write | rules | none | **Missing** |
| S10.3 | Two ADFA users finalize the same `faculty_swap` concurrently | Each runs preflight, then `doeApi.saveSessionChange()` **outside** the transaction; only one final transaction succeeds. The second save may already have written the session (see R1). | partly | none | **Missing** + risk |
| S10.4 | Apply after withdraw/reject | Refused (`status!=='pending'`) | transaction + rules | `approval-lifecycle-security-emulator:42` (reactivation denied) | Partial |

---

## 4. Additional scenarios worth pinning

| ID | Scenario | Current behaviour | Tests | Status |
|---|---|---|---|---|
| X1 | Withdraw by requester | `withdrawn`; unfinished approvals `cancelled`; approved history preserved | `approval-lifecycle:42, :105`; `approval-lifecycle-security-emulator:42` | Covered |
| X2 | Privacy: ADC/LAB never read private assignment data | Enforced | `approval-security-emulator:34`; `approval:436, :469, :495` | Covered |
| X3 | TA package review creates no `change_request*` docs | Source-text regex only | `teaching-assignment-review:229` | Partial |
| X4 | **Change Request on a TA-owned Working session** (P3 branch) | Likely **cannot be applied** (R2) | none | **Missing** |
| X5 | Invalid proposed timing | Refused at submit and at resubmit | `ws5a-approval-actions:37`; `approval-request` | Covered |
| X6 | Conflict override on Faculty change | Deliberate confirm plus audited override payload | `approval:240, :247`; `ws5a-approval-actions:31–35` | Covered |

---

## 5. Risks found (reported, not fixed)

**R1. Faculty-change apply isn't atomic.** For `faculty_swap` requests, `finalizeRoutedRequest()` calls `doeApi.saveSessionChange()` (server) or the queued client batch, which writes `sessions`/`calendar_sessions` **before** the Firestore transaction that re-checks `pending` / not-applied and marks the request `approved`. If that transaction then fails (a concurrent finalize, a withdraw in between, a missing approval), the session has already been changed while the request remains `pending`. The code acknowledges this architecture (`UCVM_DB_MIGRATION_REVISIT: spark-client-finalizer`, ~l.502). There is no test for the failure ordering.

**R2. Routed apply is probably blocked on TA-owned sessions (P3 branch, emulator confirmation needed).** The P3 `sessions` update rule routes every owned session to `taSessionUpdate()`/`taAttachUpdate()` *before* the `sessionApprovalMarkerChanged() ? routedSessionApply()` branch (`firestore.rules:767`). `taContentActor()` allows only fixed field lists without `approvalRequestId`/`approvalRevision`, so the `session_edit` apply write (which adds those markers) would be denied for TA-owned sessions. `faculty_swap` still works through the DOE path (`doeRecalculationSessionWrite`). Once sessions become TA-owned, approved Faculty edit requests on them may be impossible to apply. There is no test (X4). T9 should decide how routed Change Requests and TA ownership interact.

**R3. The stale check lives only in the client.** The rules bind the session write to the approved `patchPublic` but never compare the *prior* value with `basePublic` (S6.5). A modified or buggy client could apply an approved request over newer Working data. P3 invariant 36 ("fail closed on stale Working state") will need either a rules check (a `resource.data` vs `basePublic` comparison on changed fields, within the rules budget) or a trusted server finalizer.

**R4. Deleted sessions leave requests stuck.** Deleting a session doesn't cancel its open requests, and a fully-approved request whose session was deleted stays `pending` indefinitely until someone rejects it (S9). This should be a product decision plus a test.

**R5. `baseReleaseId` is blocked by the allowlist.** `publicRequestKeysValid` (`firestore.rules:33`) must be extended in T9, together with create/resubmit immutability rules. It's also worth recording that adding it changes a rules-budget-sensitive function.

---

## 6. Test execution (scratch copy of the P3 branch, read-only)

| Command | Result |
|---|---|
| `node --test` on the 12 Change Request test files (`approval-lifecycle`, `approval-request`, `approval`, `ws5a-approval-actions`, `ws5a-behavior`, `faculty-swap`, plus the 6 emulator files) | 139 tests: **109 pass, 0 fail, 30 skipped** |
| Skipped | All 30 emulator checks (`approval-lifecycle-security-emulator`, `approval-order-security-emulator`, `approval-security-emulator`, `ws5b-security-matrix-emulator`, `legacy-approval-companion-emulator`, `faculty-swap-security-emulator`) skip without `FIRESTORE_EMULATOR_HOST`. The emulator download is blocked in this environment, so these rules tests were **not executed**. |

---

## 7. Suggested new tests (for the implementation owner; not written)

These only add coverage and leave approval logic unchanged:

1. **S9.1/S9.2 (unit):** a `readRoutedBundleTx`-equivalent fake where the calendar/source doc is missing, which should throw without writes; for swaps, no `saveSessionChange` call.
2. **S10.1 (emulator):** apply `r1` successfully, then attempt the same batch again, which should be denied (`before.status` is no longer `pending`).
3. **S10.2 (emulator):** a session update carrying an already-applied `approvalRequestId`/`approvalRevision`, which should be denied.
4. **S5.6 (emulator):** apply with `approvalRevision` = old revision after a resubmit, which should be denied.
5. **S6.2 (unit):** pin the field-scoped stale behaviour explicitly, so a P3 change to it is deliberate.
6. **X4 (emulator, P3 branch):** routed `session_edit` apply on a TA-owned session, to record the current result (see R2) before T9.
7. **S7/S8 (T9):** `baseReleaseId` create, immutability on resubmit, stale Working vs Published-base apply, and release advance while pending.

---

## 8. Method

1. Read the Change Request modules on the P3 branch (`approval-request.js`, `approval-routing.js`, `approval-state.js`, `approval-lifecycle.js`, `approval-finalizer.js`, `approval-workflow.js`) and diffed them against `main` (label and subscription changes only).
2. Read the routed-request rules in `firestore.rules` (`validRoutedRequestCreate`, `validRoutedRequestUpdate`, `validRoutedApply`, `routedApplyContextValid`, `routedSessionApplyFor`, `sourceMatchesPublicPatch`, and the P3 `sessions` update branch).
3. Listed every test in the 12 Change Request test files and matched each scenario to the tests that assert it, reading test bodies where titles were ambiguous (for example, confirming no second-apply or deleted-session test exists).
4. Took P3 target behaviour from spec §3.2 and §15 (invariants 13, 14, 36) and Plan T9 Step 7 / T12 Step 4.
5. Ran the existing non-emulator tests in a scratch worktree; nothing was modified.
