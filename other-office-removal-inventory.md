# `other_office` Removal Inventory (refreshed)

**PAWS support task 1**, a read-only research deliverable. **Version 2, refreshed 2026-09-29** against today's repository.

| | |
|---|---|
| Repository | `Alex1122341/Teaching-assignment` |
| Baseline scanned | `main` @ `5ecbb39` ("Handle portable CLI stderr during Azure bootstrap"), the latest on 2026-09-29 |
| P3 status check | `origin/feature/scoped-parallel-assignment-workflow` @ `6ce74ef`, the latest on 2026-09-29, read only via `git show`/`git grep`. Nothing was checked out on or committed to that branch. |
| Reference docs | P3 Design Spec §6.7 and §15 invariant 37; Implementation Plan Task 6 Steps 1 and 7, Task 7 Step 8, Task 12 Step 9 (feature branch only) |
| Working branch | `research/paws-support` (local, not pushed) |
| Changes made | None. Nothing was deleted, and no code, rules, seed, or live data was touched. |

### What changed since version 1 (scanned `main` @ `16ff0cd`, 2026-09-23)

1. **`main` gained two new occurrences** in the Azure SQL cutover (2026-09-24):
   - `server/src/data/sql-user-repository.js:69`
   - `tools/bootstrap_paws_azure_runtime.ps1:15`

   Every other occurrence on `main` is unchanged, with the same file and line numbers.
2. **The P3 branch has now done most of the T6/T7 retirement.** Version 1 said the branches were identical for these files; that is no longer true. §6 is new and shows, for every `main` occurrence, whether P3 removed, changed or kept it.
3. **The P3 branch is 5 commits behind `main`** and doesn't yet contain the two Azure occurrences. When `main` is merged in, they arrive without any retirement handling (§7, F1).

---

## 1. Summary

In brief:

- **On `main`: 65 real occurrences on 65 lines in 32 files** (+2 lines and +2 files since v1). `user-management.html` has two occurrences on one line. The count excludes 10 false-positive lines.
- **On the P3 branch, the retirement followed the safe order.** It removed the role from the admitting allowlists (`readySignedIn`/`explicitRole`), added a client-side `retiredRole` block, and only then removed the `restrictedOffice()` carve-out. That is the order version 1 recommended.
- **The P3 branch still has 9 runtime, UI and provisioning leftovers.** The plan's final check (T12 Step 9) says `other_office` may remain only in denial tests or history. The 4 `timetable.js` lines are unreachable but still pinned by tests. See §6 and §7.
- **There are new gaps.** The Azure SQL provisioning paths accept `other_office` as a bootstrap role, and no test or plan step covers them. `AGENTS.md` and `SCHEMA.md` still list it as a formal role on both branches.

| Classification (`main`) | Lines | Files |
|---|---:|---:|
| Runtime | 8 | 4 |
| Security Rule | 4 | 1 |
| UI | 3 (4 occurrences) | 3 |
| Provisioning | **7** (+2) | **5** (+2) |
| Seed | 1 | 1 |
| Test | 30 | 13 |
| Documentation | 4 | 4 |
| Historical Only | 8 | 3 |
| **Total real** | **65** | **32** (unique) |
| False positive (not the role) | 10 | 5 |

Search used (case-insensitive): `other_office | otherOffice | other-office | otheroffice | other office`, run over every tracked file.

---

## 2. Full inventory (`main` @ `5ecbb39`)

Line numbers match version 1 except for the two new rows, marked **NEW**.

### Runtime (8)

| File:Line | Code / context | Effect on `main` |
|---|---|---|
| `account-profile.js:10` | `rolesAllowed=[…,'other_office',…]` | Accepts `other_office` as a valid target role for account profiles. |
| `faculty-access.js:5` | `role()` normalizer map `other_office:'other_office'` | This is the central `UCVM.role()` normalizer. The map ends with `\|\|rawRole(r)`, so the string still passes through unchanged even after the map entry is removed. |
| `faculty-access.js:54` | `linkFacultyIdentity`: `if(admin(p)\|\|['adc','lab','other_office'].includes(…))return;` | Stops `other_office` accounts from auto-linking to a Faculty record. **This is a restriction.** |
| `office-capabilities.js:45` | `isOfficeAccount(): …\|\|roleOf(p)==='other_office'` | Treats the role as an office account. |
| `timetable.js:85` | `sessionCollection()` returns `CALENDAR_SESSION_COLLECTION` for `other_office` | Sends the role to the sanitized calendar. **This is a restriction.** |
| `timetable.js:131` | Profile role allowlist | Accepts the role at page load. |
| `timetable.js:132` | Error text listing `other_office` as a valid role | A user-visible message. |
| `timetable.js:1874` | `selfHistory=…\|\|accessRole==='other_office'` | Gives the role an own-history-only view. |

### Security Rule (4), `firestore.rules`

| Line | Function | Effect on `main` |
|---|---|---|
| `6` | `readySignedIn()` allowlist | Admits the role as an active user. **This is the primary grant.** |
| `14` | `explicitRole(r)` allowlist | Treats the role as valid in profile writes. |
| `19` | `restrictedOffice()` | **This is a restriction.** It makes `privateReader()` (l.293) and `afcRead()` (l.315) deny the role. |
| `294` | `validOfficeIdentity(d)` | **This is a restriction.** It blocks Faculty identity fields on `other_office` user docs. |

### UI (3 lines, 4 occurrences)

| File:Line | Context |
|---|---|
| `faculty-access.js:9` | Label map `other_office:'Other Office'` |
| `faculty-admin-enhancements.js:80` | Dashboard gate copy says "Developer, Owner, Administrator, or Other Office". This is already inaccurate: the role has no Dashboard access. |
| `user-management.html:8` (×2) | Info note "Other Office sees only its own Change History", plus the `<option value="other_office">` role picker |

### Provisioning (7)

| File:Line | Context |
|---|---|
| `faculty-account-planner.js:8` | `PRIVILEGED` set, so the bulk planner never overwrites or demotes these accounts. **This is a protection.** |
| `tools/bootstrap-lab-user.js:7` | Lab bootstrap CLI `ROLES` |
| `tools/bootstrap-lab-user.js:9` | `OFFICE_ROLES` (office name, no Faculty link) |
| `.github/workflows/firebase-lab-bootstrap.yml:24` | `workflow_dispatch` role choice |
| `.github/workflows/firebase-lab-bootstrap.yml:35` | Input description "…for Other Office, ADC or LAB" |
| **NEW** `server/src/data/sql-user-repository.js:69` | Azure SQL runtime `provision()`: `allowedRoles` includes `other_office`. A Firebase-authenticated user with a matching `PAWS_ACCOUNT_BOOTSTRAP_JSON` entry is inserted into `paws.UserProfile` as an **active** `other_office` profile (`Active=1`). The SQL session API (`server/src/routes/data-routes.js`) then treats it as a non-Faculty role and returns **all** sessions in the range from `paws.vCalendarSession`, a sanitized view with no DOE. |
| **NEW** `tools/bootstrap_paws_azure_runtime.ps1:15` | Azure runtime bootstrap `[ValidateSet(…,'other_office',…)]` for `-BootstrapRole` |

### Seed (1)

| File:Line | Context |
|---|---|
| `tools/seed/dataset.js:53` | Demo user `uid-otheroffice`, role `other_office` (active) |

### Test (30)

These are unchanged from version 1: `test-support/policy.js:2`; `tools/browser-smoke.js:529, 540–543`; `tests/account-profile.test.js:7`; `tests/doe-policy-admin.test.js:54`; `tests/doe-policy-security-emulator.test.js:26, 134`; `tests/history-visibility.test.js:15, 26`; `tests/lab-groups.test.js:136`; `tests/office-capabilities.test.js:54, 60, 77, 78, 81, 85`; `tests/page-modules.test.js:34, 39, 69, 83, 85, 87`; `tests/security-emulator.test.js:6, 14`; `tests/session-workflow.test.js:176`; `tests/timetable-multi-edit-ui.test.js:64`; `tests/work-queue.test.js:71`.

Version 1's split between "tests asserting support" (which must change) and "tests asserting denial" (which remain valid) still applies to `main`.

### Documentation (4)

`AGENTS.md:31` ("Formal roles"), `docs/database/SCHEMA.md:60` ("Explicit roles"), and two code comments: `firestore.rules:337` and `lab-groups.js:162`.

### Historical Only (8)

`docs/superpowers/plans/2026-09-14-faculty-account-role-cleanup.md:15`; `docs/superpowers/specs/2026-09-14-faculty-account-role-cleanup-design.md:19, 49`; `docs/superpowers/plans/2026-09-17-approval-routing-roles-privacy.md:179, 202, 211, 280, 305`. Per plan Task 6, these stay.

### False positives, excluded (10)

`work-queue.js:77, 85` (`'ANOTHER OFFICE'`); `tests/approval-lifecycle.test.js:61`; `tests/approval-lifecycle-security-emulator.test.js:32`; `docs/superpowers/plans/2026-09-17-approval-routing-roles-privacy.md:31`; `docs/superpowers/specs/2026-09-17-approval-routing-roles-privacy-design.md:291, 515, 517, 546, 713`.

---

## 3. Coupled clusters (must change together)

1. **Demo persona chain:** `tools/seed/dataset.js` → `tools/browser-smoke.js` → `tests/security-emulator.test.js` → `tests/doe-policy-security-emulator.test.js`.
2. **Source-regex pins:** `tests/page-modules.test.js:69, 85, 87` and `tests/timetable-multi-edit-ui.test.js:64` match `timetable.js` text exactly. **These pins are why the `timetable.js` leftovers still exist on the P3 branch** (§6).
3. **Lab bootstrap path:** `.github/workflows/firebase-lab-bootstrap.yml` ↔ `tools/bootstrap-lab-user.js`.
4. **NEW, Azure bootstrap path:** `tools/bootstrap_paws_azure_runtime.ps1` (`-BootstrapRole`) → `PAWS_ACCOUNT_BOOTSTRAP_JSON` → `server/src/data/sql-user-repository.js` `allowedRoles`. These should be retired together.
5. **Role allowlists that must agree:** `firestore.rules:6,14`, `timetable.js:131`, `account-profile.js:10`, `tools/bootstrap-lab-user.js:7`, `test-support/policy.js:2`, `user-management.html:8`, and now also `server/src/data/sql-user-repository.js:69`.

---

## 4. Removal-order hazards

Version 1 findings, still true on `main`: removing a restriction (`restrictedOffice()`, `validOfficeIdentity()`, the `faculty-access` link skip, the `sessionCollection()` branch, `PRIVILEGED`) while the role is still admitted would *widen* access. The safe order is:

1. dependency gate;
2. remove from the admitting allowlists;
3. prove unknown or retired roles fail closed;
4. only then remove the carve-outs.

The P3 branch did follow this order; see §6.

---

## 5. Plan coverage gaps

| File | In plan T6/T7 file lists? | Handled on P3 branch? |
|---|---|---|
| `office-capabilities.js`, `account-profile.js`, `user-management.html`, `firestore.rules` (allowlists) | Yes | Yes, removed |
| `timetable.js` | Yes | **No**: 4 lines remain (§6) |
| `faculty-access.js` | No | Yes: retired-role block added; label changed; link skip kept |
| `tools/bootstrap-lab-user.js`, `.github/workflows/firebase-lab-bootstrap.yml` | No (implied by "bootstrap supported role options") | Yes, removed |
| `faculty-account-planner.js` | No | Kept (protection; see §7 F4) |
| `faculty-admin-enhancements.js` | No | **No**: stale copy remains |
| `test-support/policy.js` | No | **No**: still in shared test roster |
| `AGENTS.md`, `docs/database/SCHEMA.md` | SCHEMA via T12 Step 1 only | **No** |
| **NEW** `server/src/data/sql-user-repository.js`, `tools/bootstrap_paws_azure_runtime.ps1` | **No**: added to `main` after the plan was written | **Not on branch** (branch is behind `main`) |

---

## 6. Status of each `main` occurrence on the P3 branch (`6ce74ef`)

Line numbers in brackets are P3-branch lines.

| `main` occurrence | P3 status | Detail |
|---|---|---|
| `account-profile.js:10` | ✅ Removed | `rolesAllowed` no longer lists it |
| `faculty-access.js:5` normalizer | 🔄 Replaced | New `retiredRole()` (`[5]`), and portal readiness throws "This account role has been retired…" (`[86]`). This is the explicit fail-closed rejection version 1 asked for. |
| `faculty-access.js:9` label | 🔄 Changed | Now `'Other Office (retired)'` (`[10]`) |
| `faculty-access.js:54` link skip | ⏸ Kept (`[55]`) | A harmless restriction, since retired accounts are blocked earlier |
| `office-capabilities.js:45` | ✅ Removed | `isOfficeAccount('other_office')` is now false; all capabilities false (`other-office-removal.test.js:36`) |
| `timetable.js:85, 131, 132, 1874` | ⚠️ **Kept** (`[97, 143, 144, 2069]`) | Unreachable in practice (`faculty-access` blocks the role before the timetable loads), but the allowlist and error text still *advertise* it as valid. They remain because `tests/page-modules.test.js:69, 85, 87` and `tests/timetable-multi-edit-ui.test.js` still pin them. |
| `firestore.rules:6` `readySignedIn` | ✅ Removed | — |
| `firestore.rules:14` `explicitRole` | ✅ Removed | — |
| `firestore.rules:19` `restrictedOffice` | ✅ Removed (the `other_office` clause) | Safe, because `readySignedIn` already rejects the role |
| `firestore.rules:294` `validOfficeIdentity` | ⏸ Kept (`[304]`) | A harmless restriction |
| `firestore.rules:337` comment | ⏸ Kept (`[350]`) | Comment only |
| `faculty-admin-enhancements.js:80` | ⚠️ **Kept** | The gate copy still invites "Other Office" accounts |
| `user-management.html:8` (×2) | ✅ Removed | `other-office-removal.test.js:43` |
| `faculty-account-planner.js:8` `PRIVILEGED` | ⏸ Kept | Still protects legacy accounts from bulk overwrite (§7 F4) |
| `tools/bootstrap-lab-user.js:7, 9` | ✅ Removed | Refuses deprecated roles (`other-office-removal.test.js:21`) |
| `.github/workflows/firebase-lab-bootstrap.yml:24, 35` | ✅ Removed | — |
| `tools/seed/dataset.js:53` | 🔄 Changed (`[54]`) | Kept as an **inactive** legacy fixture (`active:false`; `other-office-removal.test.js:11`) |
| `test-support/policy.js:2` | ⚠️ Kept | Still in the shared policy roster |
| `tools/browser-smoke.js:529–543` | 🔄 Changed (`[517–560]`) | Now `verifyRetiredOtherOffice()`: asserts fail-closed sign-out and no exposed controls |
| Tests asserting support (`account-profile:7`, `office-capabilities:60, 77–81`, `security-emulator:14`) | 🔄 Rewritten | Now assert retirement: `office-capabilities` "retired Other Office fails closed…", `security-emulator` "retired Other Office fails closed for all runtime data access", plus the new `tests/other-office-removal.test.js` (6 tests) |
| Tests still pinning support (`page-modules:69, 85, 87`, `timetable-multi-edit-ui`) | ⚠️ Kept | These keep the `timetable.js` leftovers alive |
| `AGENTS.md:31`, `docs/database/SCHEMA.md:60` | ⚠️ Kept | Still list `other_office` as a formal/explicit role |
| `lab-groups.js:162` comment | ⏸ Kept | Comment only |
| **NEW** Azure SQL occurrences (2) | ❌ Not present | Branch predates them; they will arrive with the next `main` merge |

Key: ✅ removed · 🔄 replaced/changed to retirement semantics · ⏸ kept, harmless or protective · ⚠️ kept, leftover the plan expects to go · ❌ not yet on branch.

**P3 branch totals** (same case-insensitive search, excluding `docs/`): 74 matching lines. Of these, 4 are "another office" false positives and 51 are in `tests/`, most of which now assert retirement (16 in the new `other-office-removal.test.js`). Non-test leftovers: `AGENTS.md`, `faculty-access.js` (3, intentional), `faculty-account-planner.js`, `faculty-admin-enhancements.js`, `firestore.rules` (2), `lab-groups.js`, `test-support/policy.js`, `timetable.js` (4), `tools/browser-smoke.js` (retirement check), and `tools/seed/dataset.js` (inactive fixture).

---

## 7. Findings (reported, not fixed)

**F1. The Azure SQL runtime still provisions `other_office` (new; affects `main`).** `sql-user-repository.js:69` accepts `other_office` and writes an *active* SQL profile, and `bootstrap_paws_azure_runtime.ps1:15` offers it as a bootstrap role. The Firestore path now rejects the role on the P3 branch, but the SQL path has no retirement check. An `other_office` SQL profile would get **every** session in a date range from the session API, because data-routes filters only `faculty`/`hicc`/`visc`. The data is the sanitized `vCalendarSession` view, so no DOE, but it is broader than the own-history-only access the role had on Firestore. This is outside plan T6/T7 because the Azure work postdates the plan. After the next `main` merge into the P3 branch, `tests/other-office-removal.test.js` won't catch it, since it checks only `bootstrap-lab-user.js`.

**F2. The `timetable.js` leftovers are held in place by tests** (P3 branch). The plan's final check (T12 Step 9: `git grep -n "other_office" -- ':!docs/**'`) expects only denial tests or history to remain. These four lines, and the tests that pin them (`page-modules.test.js:69, 85, 87`, `timetable-multi-edit-ui.test.js`), will fail that check. Removing them needs the tests rewritten in the same change (coupled cluster 2).

**F3. Stale guidance remains on both branches.** `AGENTS.md` still lists `other_office` under "Formal roles"; this file steers AI agents, so new work may reintroduce the role. `docs/database/SCHEMA.md:60` and the `faculty-admin-enhancements.js:80` gate copy also still advertise it.

**F4. The `PRIVILEGED` protection was kept, and that should be confirmed as intentional** (P3 branch). Keeping `other_office` in `faculty-account-planner.js` means an inactive legacy account can't be overwritten or demoted by bulk import, which is consistent with the 2026-09-14 "never overwrite or demote" rule. If the dependency gate confirmed there are no such accounts, it could go; if any exist, keeping it is the safer choice. This is a decision for the implementation owner.

**F5. There is no recorded evidence of the Task 6 Step 1 dependency gate.** The P3 branch keeps the seed fixture as inactive and blocks the role, but the repository has no gate output, and no dedicated read-only user-role inventory tool exists (version 1 §6). The evidence needed is still a per-environment count of `users/*` documents with `role == 'other_office'`, split by `active`, for Lab, Test and Production. **Azure SQL `paws.UserProfile` should now be added to that list** (F1).

---

## 8. Method

1. Fetched `origin` (read only) on 2026-09-29 and confirmed both branch heads (`main` `5ecbb39`, P3 `6ce74ef`) have no newer commits.
2. Re-ran the version 1 search on `main` @ `5ecbb39` and diffed the `file:line` list against `main` @ `16ff0cd`. The result was identical except for the two new Azure lines. I read both new contexts, the SQL auth provider and the data routes.
3. Ran the same search on the P3 branch, and for each `main` occurrence checked whether it was removed, changed or kept. I read the P3 `faculty-access.js` retirement path, the `firestore.rules` helpers, and `tests/other-office-removal.test.js`.
4. Nothing was executed against Firebase, Azure or the P3 branch; this refresh read files only.
