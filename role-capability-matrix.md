# Role / Capability Matrix: Current Repository vs P3 Target

**PAWS support task 4**, a read-only research deliverable.

| | |
|---|---|
| Repository | `Alex1122341/Teaching-assignment` |
| "Current" means | `origin/feature/scoped-parallel-assignment-workflow` @ `6ce74ef`: the branch where P3 is being implemented (T1–T7 largely done). Differences on `origin/main` @ `5ecbb39` are noted per row. |
| P3 target | Spec `docs/superpowers/specs/2026-09-22-scoped-parallel-teaching-assignment-workflow-design.md` (§3–§15, incl. the 40 security invariants in §15) and Plan T1–T12 |
| Evidence | `office-capabilities.js` (dumped with `forRole()` for every role on both branches), `firestore.rules`, `timetable.js`, `work-queue.js`, `session-workflow.js`, plus the tests cited in `test-coverage-inventory.md` |
| Changes made | None. Nothing was modified, committed or pushed. |

## Role mapping

| Matrix column | Technical role(s) | Default office access | Notes |
|---|---|---|---|
| **Developer** | `developer` | adc, lab, adfa | `forProfile()` sets **every** capability true (`office-capabilities.js:76`) |
| **Owner** | `owner` | adfa | Treated as "Owner / ADFAD General-equivalent" high trust (spec §11.9) |
| **ADFA General** | `adfa_general` | adfa | Rules `general()` = developer, owner, adfa_general |
| **ADFA Regular** | `adfa_regular` (legacy `administrator`/`admin` normalize here) | adfa | In `admin()`, **not** in `general()` |
| **ADC** | `adc` (user-facing "ADC/DVM") | adc | May be granted `lab` too |
| **LAB** | `lab` | lab | May be granted `adc` too |
| **HICC** | `hicc` base role **plus** a current `teaching_responsibilities/{id}/years/{y}/assignees/{uid}` window | none | Per spec §6.1/§6.6, the role name alone grants nothing |
| **VISC** | `visc` base role **plus** a current leader-responsibility window | none | Same |
| **Faculty** | `faculty` | none | Ordinary Faculty |

Statuses assume **default office access**. Admin roles can be delegated `adc`/`lab` offices (`allowedOfficesForRole`), which would add those offices' capabilities.

## Status legend

| Status | Meaning |
|---|---|
| **Match** (✅) | Current behaviour (capability flag **and** Firestore rule where one applies) equals the P3 target, whether that target is "allowed" or "denied". |
| **Mismatch** (❌) | Current behaviour contradicts the target. |
| **Unimplemented** (⏳) | The target needs something that doesn't exist yet, such as the release model, HICC/VISC queues or the ADFAD package gate. |
| **Unclear** (❓) | The spec is silent or ambiguous, or the capability flag and rules disagree, so the right answer needs a decision. |

---

## 1. Summary

| Role | ✅ Match | ❌ Mismatch | ⏳ Unimplemented | ❓ Unclear |
|---|---:|---:|---:|---:|
| Developer | 19 | 1 | 3 | 3 |
| Owner | 20 | 1 | 3 | 2 |
| ADFA General | 20 | 1 | 3 | 2 |
| ADFA Regular | 17 | 2 | 2 | 5 |
| ADC | 21 | 1 | 1 | 3 |
| LAB | 23 | 0 | 1 | 2 |
| HICC | 18 | 5 | 3 | 0 |
| VISC | 18 | 5 | 3 | 0 |
| Faculty | 19 | 5 | 2 | 0 |
| **Total (26 capabilities × 9 roles = 234 cells)** | **175** | **21** | **21** | **17** |

Key findings:

1. **The Teaching Assignment core matches the spec at the rules layer (T6/T7).** That covers HICC exact-scope Topic editing, suggestions, Submit and Final Submit; VISC led-group review, Approve and Push Back; high-trust group/responsibility management; and the Subject catalog. All of these are enforced by `firestore.rules` through a *current-duty* assignee window rather than the role name. On `main`, all of this is unimplemented.
2. **Faculty-facing data is the biggest mismatch area.** Faculty, HICC and VISC still read Working `sessions`/`calendar_sessions` for their normal calendar and Dashboard self-mode (rows C1–C3, C26). No Published release exists for anyone (C4). See `faculty-data-path-audit.md`.
3. **LAB roster reads contradict the spec** (C23). Spec §10.1 and invariant 19 say every active, password-complete user may read rosters; `rosterReader()` allows only Developer, Owner, ADFA General and LAB. ADFA Regular, ADC, HICC, VISC and Faculty are denied, and a test pins that.
4. **The ADFA Work Queue still follows the old serial gate** (C19). `work-queue.js` still shows ADFAD "READY / WAITING FOR LAB / WAITING FOR ADC" items; spec §14 says the normal TA queue follows responsibility and ADFAD receives only HICC-Final-Submitted packages. The pure gate `session-workflow.canEnterAdfadQueue()` exists, but the queue doesn't use it.
5. **Developer's capability flags disagree with the rules** (C15–C17). `forProfile('developer')` returns true for HICC Submit/Final Submit and VISC Approve/Push Back, but the rules require a real assignee window (`taHicc`/`taVisc`), so Developer is denied in practice. The spec never says whether Developer may act as HICC/VISC.
6. **ADFA Regular sits on several ambiguous lines** (C6, C7, C10, C11, C24). The spec says "trusted admin", "high-trust admin" or "approved administrative" without saying whether ADFA Regular counts. The code sometimes includes it (`admin()`, `taAdmin()`) and sometimes not (`general()`, `taManager()`).

---

## 2. Matrix

Dev = Developer, Own = Owner, AG = ADFA General, AR = ADFA Regular.

| # | Capability | Dev | Own | AG | AR | ADC | LAB | HICC | VISC | Faculty |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Normal timetable view uses the correct source | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| C2 | Direct read of Working `sessions` | ✅ | ✅ | ✅ | ✅ | ❓ | ❓ | ❌ | ❌ | ❌ |
| C3 | Direct read of Working `calendar_sessions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| C4 | Read the active sealed Published release | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| C5 | Publish Timetable (build → validate → seal → activate) | ⏳ | ⏳ | ⏳ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C6 | Create session skeleton (course/date/time/type) | ✅ | ❓ | ❓ | ❓ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C7 | Classify a session with `subjectKey` | ✅ | ✅ | ✅ | ❓ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C8 | Manage the Subject catalog (`teaching_subjects`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C9 | Manage TA groups, responsibilities and assignee windows | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C10 | Attach/rehome trusted session ownership | ✅ | ✅ | ✅ | ❓ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C11 | Edit Topic on TA-owned sessions | ✅ | ❓ | ❓ | ❓ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C12 | Change trusted ownership/package-locator fields as a scoped actor | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C13 | Create Faculty suggestions (actor contribution) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C14 | Read contributor notes/suggestions | ✅ | ✅ | ✅ | ✅ | ❓ | ❓ | ✅ | ✅ | ✅ |
| C15 | HICC Submit / Resubmit for VISC review | ❓ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C16 | VISC Approve / Push Back | ❓ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C17 | HICC Final Submit to ADFAD | ❓ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C18 | Read HICC packages (`teaching_assignment_submissions`) | ✅ | ✅ | ✅ | ✅ | ❓ | ✅ | ✅ | ✅ | ✅ |
| C19 | Work Queue shows the P3 items for this role | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ⏳ | ⏳ | ✅ |
| C20 | ADFAD final Faculty assignment, gated on `submitted_to_adfad` | ⏳ | ⏳ | ⏳ | ⏳ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C21 | Create a Change Request from the Published base (`baseReleaseId`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏳ | ⏳ | ⏳ |
| C22 | Explicit Change Request serial approval (ADC/DVM → LAB → ADFAD) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C23 | Read LAB rosters (temporary policy) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| C24 | Write LAB groups/rosters | ✅ | ✅ | ✅ | ❓ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C25 | Account User Management | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| C26 | Faculty Dashboard access and data source | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## 3. Row details

Each row gives the target (with its spec reference), the current state on the P3 branch, and how `main` differs.

**C1: Normal timetable view source.**
- Target: Faculty, and HICC/VISC in their normal view, read the active Published release only (§11.10); internal roles use Working data (§3.3).
- Current: every role reads `sessions` (`timetable.js` `sessionCollection()` returns `sessions` except for undelegated ADC/LAB, who get `calendar_sessions`). Internal roles therefore match; Faculty, HICC and VISC mismatch.
- `main`: same.

**C2: Direct `sessions` read.**
- Target: denied to ordinary Faculty and to HICC/VISC outside their TA tool (§11.10, invariant 25); allowed for internal roles.
- Current: `allow read: if taOwned ? (taAdmin() && taSessionRead()) : privateReader()` (`firestore.rules:767`). Faculty, HICC and VISC can therefore read every **non-owned** Working session.
- ADC/LAB are ❓: they are denied **owned** `sessions` docs and work from the sanitized calendar (`timetable-ownership-save.test.js` "ADC attachment reads sanitized calendar and never private sessions"). The spec doesn't say whether ADC/LAB need the private source.
- `main`: `privateReader()` for all docs.

**C3: Direct `calendar_sessions` read.**
- Target: denied to ordinary Faculty (§11.10).
- Current: `taCalendarRead(id)` allows any ready user for non-owned docs, and ADC/LAB/TA readers for owned docs (`firestore.rules:576, :756`). Faculty, HICC and VISC mismatch.
- `main`: `ready()` for all.

**C4: Read the active Published release.**
- Target: everyone can read the active sealed release (§11.6–§11.10).
- Current: no `timetable_publications` rule or reader exists.
- `main`: same.

**C5: Publish Timetable.**
- Target: Developer, Owner and ADFAD General only (§11.9).
- Current: the `canPublishTimetable` flag is correct (true for developer/owner/adfa_general, false for the rest; `office-capabilities.js:96`), but no Publish action exists. Allowed roles are therefore ⏳; denied roles match.
- `main`: the flag doesn't exist. The "Initialize Live Schedule" button (`timetable.js:746`) only navigates to the Dashboard; it isn't a Publish.

**C6: Create session skeleton.**
- Target: ADC/DVM owns the skeleton (§4.1); the spec says nothing about Owner or ADFA.
- Current: `canAddSessions` is true only for Developer and ADC, but the `sessions` create rule also allows `admin()` (all ADFA roles and Owner). The UI flag and the rule disagree for Owner, ADFA General and ADFA Regular. LAB, HICC, VISC and Faculty are denied.
- `main`: same.

**C7: `subjectKey` classification.**
- Target: ADC/DVM, plus "high-trust admin repair paths" (Plan T3 Step 7); HICC/VISC may not change it.
- Current: ADC via `adcSessionUpdate`; `taAdmin()` content edits include `subjectKey` (`firestore.rules:592–597`). `taAdmin()` includes ADFA Regular, which isn't obviously "high-trust", hence ❓.
- `main`: no `subjectKey`.

**C8: Subject catalog management.**
- Target: "existing administrator authority" (Plan T3 Step 5).
- Current: `admin()` (`firestore.rules:752`), so Developer, Owner and ADFA General/Regular may write; the others read only.
- `main`: absent.

**C9: Manage groups, responsibilities and assignee windows.**
- Target: high-trust management only; HICC/VISC cannot change them (§6.5, §6.6).
- Current: writes are `general()` only (`firestore.rules:710–720`). ADC may *read* groups and responsibilities (for ownership attach), which the spec doesn't mention; this doesn't change the write result.
- `main`: absent.

**C10: Attach/rehome trusted ownership.**
- Target: "trusted administration/group configuration" and "trusted admin/ADC/DVM configuration paths" (§4.2; Plan T6 Step 5).
- Current: `taManager()` = `general() || adc()` (`firestore.rules:541`). ADFA Regular ("ordinary Administrator") is excluded and a test pins that (`teaching-assignment-submission-security-emulator:158`). Whether ADFA Regular counts as "trusted admin" is ❓.
- `main`: absent.

**C11: Topic on TA-owned sessions.**
- Target: responsible HICC edits LEC/SRL Topic in scope; ADC/DVM supports where existing policy permits; LAB edits LAB Topic; VISC may not edit (§4.3).
- Current (`taContentActor`, `firestore.rules:592–597`): HICC has LEC/SRL Topic only, with current duty and exact scope; ADC has scheduling fields plus Topic (LAB Topic only to `TBD`); LAB has LAB Topic and groups; VISC and Faculty are denied. **`taAdmin()` (Owner, ADFA General, ADFA Regular) may edit all content fields including Topic.** §4.3 doesn't list ADFAD as a Topic editor, hence ❓.
- `main`: no ownership model.

**C12: Scoped actors cannot change ownership fields.**
- Target: HICC/VISC cannot change `teachingAssignmentGroupId`, `responsibleHiccResponsibilityId` or `teachingAssignmentSubmissionId` (§4.2, invariant 4).
- Current: `taOwnershipSame()` is required on every content update, and ownership changes go only through `taTrustedAttach`/rehome (`firestore.rules:593, :606`). Tests: `timetable-selection` "HICC VISC and ordinary Faculty cannot self-reassign trusted ownership".
- `main`: absent.

**C13: Faculty suggestions.**
- Target: ADC/DVM, LAB and the responsible HICC suggest; VISC is not a contributor; ADFAD reviews and selects (§5, §7).
- Current: `taContributionActor` allows only an `adc`/`lab` office holder or a current-duty HICC, and `sourceRole in ['adc','lab','hicc']` (`firestore.rules:670`). Owner/ADFA (default office `adfa` only) and Faculty cannot contribute.
- `main`: the older `canSuggestFaculty` flag (ADC, LAB, Developer).

**C14: Read contributor notes.**
- Target: ADFAD, "ADC/DVM and LAB **where needed**", responsible HICC, leading VISC and high-trust admin; never ordinary Faculty (§9).
- Current: `taContributionRead` allows `taAdmin() || taHicc || taVisc || own contribution` (`firestore.rules:676`). ADC and LAB can read only their **own** notes. Whether "where needed" means other contributors' notes is ❓.
- `main`: absent.

**C15: HICC Submit.**
- Target: responsible HICC only (§11.1).
- Current: `taSubmit` requires `taHicc(before)` (`firestore.rules:640`); the capability needs a `teachingAssignment` context with a current assignment (`office-capabilities.js:81–85`). **Developer** is ❓: its capability is true (all flags), but the rules deny it without a duty window, and the spec doesn't say whether Developer may act as HICC.
- `main`: absent.

**C16: VISC Approve / Push Back.**
- Target: current leading VISC only (§11.2).
- Current: `taReviewDecision` requires `taVisc(before)`, `visc_review` status and revision equality (`firestore.rules:644`). Developer is ❓, as in C15.
- `main`: absent.

**C17: HICC Final Submit.**
- Target: HICC only, after a current VISC approval with exact revision/fingerprint equality (§11.3, invariant 10).
- Current: `taFinalSubmit` (`firestore.rules:649`). Developer is ❓, as in C15.
- `main`: absent.

**C18: Read packages.**
- Target: HICC (own), VISC (led groups), ADFAD/high trust (§11, §9); the spec doesn't give ADC/DVM a package-review role.
- Current: `get: taManager() || taPackageRead()` and `list: taPackageRead()` (`firestore.rules:731–733`). ADC can therefore **get** any package document (as `taManager`, for ownership attach), which the spec doesn't mention (❓). LAB and Faculty are denied.
- `main`: absent.

**C19: Work Queue items.**
- Target (§14): ADC/DVM has the incomplete skeleton; LAB has LAB operational work; HICC has draft/pushed-back/approved-awaiting-Final-Submit packages; VISC has `visc_review` packages in led groups; **ADFAD has only HICC-Final-Submitted packages**; Faculty has no TA queue.
- Current: `work-queue.js` still renders the old serial office stages (`ADFAD: READY / WAITING FOR LAB / WAITING FOR ADC`, `work-queue.js:21, :68`), so the ADFA-office roles (Developer, Owner, ADFA General, ADFA Regular) are ❌. HICC/VISC get no items (`work-queue.test.js:71`), so they are ⏳. The pure gate `canEnterAdfadQueue()` exists (`workflow-functional-completion.test.js:11`) but isn't wired in.
- `main`: same serial queue.

**C20: ADFAD final assignment gate.**
- Target: final Faculty assignment only for a current `submitted_to_adfad` package; success → `adfad_finalized` (§11.4–§11.5, Plan T9).
- Current: ADFA roles assign Faculty (`canEditInstructor`) with no package gate, and no rule references `adfad_finalized`. Roles that must not assign are correctly denied.
- `main`: same, without packages.

**C21: Published-base Change Requests.**
- Target: a request from the Published view carries `baseReleaseId` plus base evidence and fails closed when stale (§3.2, invariant 36).
- Current: creation is limited to `facultyMember()` (HICC, VISC, Faculty; `firestore.rules:49`), and `basePublic` is taken from **Working** data. `baseReleaseId` doesn't exist, so Faculty-side roles are ⏳. Other roles correctly cannot create.
- `main`: same.

**C22: Serial Change Request approval.**
- Target: existing ADC/DVM → LAB → ADFAD order is preserved (§3.2, invariant 14).
- Current: unchanged `approval-order-security-emulator` rules; approvers are office holders; Developer cross-office still respects order.
- `main`: same.

**C23: LAB roster read.**
- Target: **every** active, password-complete user may read (temporary; §10.1, invariant 19).
- Current: `rosterReader()` = `developer() || general() || lab()` (`firestore.rules:351`); `lab-group-security-emulator:80, :86` pin ADC, Faculty and Administrator as denied. ADFA Regular, ADC, HICC, VISC and Faculty therefore mismatch.
- `main`: same rule.

**C24: LAB group/roster write.**
- Target: "LAB and existing approved administrative/high-trust roles" (§10.1).
- Current: `labGroupWrite`/`rosterReader` = Developer, `general()`, LAB. ADFA Regular is excluded; whether it is an "approved administrative" role is ❓.
- `main`: same.

**C25: Account User Management.**
- Target: unchanged by P3, except removing `other_office` and adding TA responsibility management (C9).
- Current: `users` create/update is `general()`, with Developer accounts editable only by Developer (`firestore.rules:313–314`). HICC's legacy `faculty_groups` member editing is separate and kept (§6.5).
- `main`: same.

**C26: Faculty Dashboard.**
- Target: administrators see the full Working dataset; Faculty self-mode uses Published data only (§11.10).
- Current: self-mode (`faculty`, `hicc`, `visc`) listens to Working `sessions` (`faculty-admin.js` `listenFacultySessions`); ADC and LAB have no Dashboard access (unchanged, not addressed by P3).
- `main`: same.

---

## 4. Spec items that need a decision (❓ sources)

**Q1. Is ADFA Regular high-trust?**
- The wording varies: "high-trust admin repair" (T3), "trusted admin" (T6), "approved administrative/high-trust" (§10.1).
- The code is inconsistent: `admin()`/`taAdmin()` include ADFA Regular, while `general()`/`taManager()` exclude it.
- It affects C7, C10, C11 and C24.

**Q2. May Developer act as HICC or VISC?** The capability module grants Developer every flag, but the rules require a duty window. Either the flags should be narrowed or the spec should say Developer acts only through an assigned responsibility. It affects C15–C17.

**Q3. May Owner or ADFAD edit Topic, and create sessions directly?**
- §4.3 names only HICC, ADC/DVM and LAB as Topic editors, yet `taContentActor` allows `taAdmin()`.
- §4.1 names ADC/DVM for skeletons, yet `admin()` may create sessions while the UI flag says no.
- It affects C6 and C11.

**Q4. ADC/LAB Working access.** Should ADC/DVM and LAB read private Working `sessions` for TA-owned rows, other contributors' notes, or package documents? The current behaviour is "no, no, and ADC may get packages". It affects C2, C14 and C18.

**Q5. Roster read policy.** The spec says all ready users; the code says Developer, Owner, ADFA General and LAB only. This is the same issue as C1 in `test-coverage-inventory.md`, and it affects C23.

**Q6. Internal spec inconsistency.** Invariant 3 (§15) says "HICC can act only on sessions/packages where `responsibleHiccResponsibilityId == request.auth.uid`". But §6.6 defines `responsibleHiccResponsibilityId` as a *stable responsibility ID* (e.g. `hicc-vtmd204`), not a UID, and authorizes through the assignee window. The implementation follows §6.6. Invariant 3 should probably read "…where the actor holds a current assignee window for `responsibleHiccResponsibilityId`".

---

## 5. Method

1. Took each role's target capabilities from the P3 spec (§3–§15 including the 40 security invariants) and the Plan (T3, T6, T7, T8, T9 capability steps).
2. Ran `office-capabilities.js` `forRole()` in Node for all ten technical roles on **both** `main` and the P3 branch, and read the `teachingAssignment` context path (`forProfile`, lines 72–98) to see how HICC/VISC capabilities are granted.
3. Read the P3-branch `firestore.rules` role helpers (`admin`, `general`, `taAdmin`, `taManager`, `taHicc`, `taVisc`, `taOffice`, `rosterReader`, `defaultOfficeAccess`) and the per-collection rules for `sessions`, `calendar_sessions`, `teaching_*`, `session_assignment_contributions`, `lab_group*`, `change_requests` and `users`.
4. Checked the UI and queue wiring (`timetable.js`, `faculty-admin.js`, `work-queue.js`, `session-workflow.js`) for rows where the rules alone don't decide.
5. Marked a cell Match only when the capability flag and the rule agree with the target. Where they disagree with each other, or the spec is ambiguous, I marked it Unclear.

No emulator was run (it is blocked in this environment), so rules behaviour is from reading the rules and the existing emulator tests, not from executing them.
