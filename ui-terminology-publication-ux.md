# UI Terminology / Publication UX Audit

**PAWS support task 8**, a read-only research deliverable.

| | |
|---|---|
| Repository | `Alex1122341/Teaching-assignment` |
| Scanned | User-facing text (button labels, headings, toasts, confirms, status lines, modal copy) in the front-end `*.html`/`*.js` files of `origin/feature/scoped-parallel-assignment-workflow` @ `6ce74ef` (P3). Compared with `origin/main` @ `7eb209f`, which has the same strings except the office labels (`ADC`/`ADFA` on `main`, `ADC/DVM`/`ADFAD` on P3). |
| Target reference | P3 spec §3.1–§3.3, §4.5, §11.1–§11.11, §14, §15 invariant 40 |
| Scope rule | **No redesign.** This document lists confusing terms and the simple states the spec implies. It doesn't propose layouts, components, colours or new wording; where wording needs a decision, it is listed as a question. |
| Changes made | None |

---

## 1. Summary

In brief:

- **Six everyday words carry more than one meaning in the current UI**, and P3 adds another meaning to most of them:

  | Word | Meanings |
  |---|---|
  | **Publish** | 4 |
  | **Submit** | 3 today, 5 after P3 |
  | **Ready / READY** | 4 today, 5 after P3 |
  | **Sync** | 3 |
  | **Live** | used everywhere to mean "the shared timetable" |
  | **Approved** | 3 |

- **"Live" is the most important problem for P3.** Today "live timetable" means the Firestore `sessions` data that everyone sees. Under P3 that data becomes the **Working** layer, which Faculty *don't* see until an explicit **Publish Timetable**. Several current messages will then be inaccurate (§4), for example "Approved and applied to the live timetable" and "Requests do not change the live timetable until ADFAD approves them".
- **"Publish" already means something else.** The only *Publish* button in the app today (`faculty-admin.html:73`) publishes a **DOE Rule Book version**. Information Center has "Publish an update" (announcements). P3's **Publish Timetable** would be a third, unrelated Publish.
- **"Working" and "Published" don't exist as UI states yet.** "Working" appears only as a busy label ("Working…" in bulk import), and "Published" appears only in a DOE reference-URL placeholder. There is no release, no "No Release" message, and no failed-publish state anywhere in the front end.
- **The office names are still mixed on the P3 branch.** About 20 visible strings still say "ADFA" or "ADC", while the labels already updated say "ADFAD" and "ADC/DVM". Spec invariant 40 requires the new names in user-facing text.

---

## 2. Confusing terms

Occurrences are P3-branch `file:line` with the exact visible text. Main has the same text unless noted.

### 2.1 Publish / Published

| Where | Visible text | What it actually does |
|---|---|---|
| `faculty-admin.html:73` (DOE Rules tab) | **Publish** (primary button, next to Clone as Draft / Validate / Impact Preview / Archive / Recalculate) | Activates a **DOE Rule Book policy version** |
| `doe-policy-admin.js:367, :657` | "Validation is current. Run Impact Preview before Publish." | DOE policy gate |
| `information-center.js:6` | "Publish an update" / **Publish** | Posts an Information Center announcement |
| `timetable.js:1850` | "Firestore denied access to users/{uid}. Publish the V7 Firestore Rules from README_FIRST.txt." | Developer instruction to deploy security rules |
| `faculty-admin.html:216` | "Approved internal/published reference URL" (placeholder) | A DOE Rule Book reference link |
| P3 spec §11.6–§11.9 | **Publish Timetable** (no UI yet) | Builds, seals and activates a Faculty-facing timetable release |

**Why it's confusing:**
- A DOE administrator will see two different primary "Publish" actions on related admin screens: the DOE Rule Book and the timetable.
- Neither one triggers the other. The spec says Publish never triggers DOE (invariant 34), and DOE publication doesn't publish the timetable.

### 2.2 Submit

| Where | Visible text | What it does |
|---|---|---|
| `approval-workflow.js:338, :346, :356, :360`; `faculty-swap-safe.js:64` | **Submit for approval** | Faculty/HICC create an explicit **Change Request** (serial ADC/DVM → LAB → ADFAD) |
| `afc-workflow.js:14, :33` | **Submit AFC request** / "Submitting…" | Absence-from-Campus request |
| P3 spec §11.1 (no UI yet) | **Submit for VISC Review** | HICC sends its package to VISC |
| P3 spec §11.3 (no UI yet) | **Final Submit** | HICC sends a VISC-approved package to ADFAD |
| P3 spec §3.3, §11.5 (no UI yet) | **ADFAD Approve & Submit** | ADFAD final Faculty assignment to **Working**. The spec stresses that it **does not publish**. |

**Why it's confusing:**
- After P3, a HICC will see "Submit for approval" (Change Request), "Submit for VISC Review" and "Final Submit" for two separate lifecycles. The spec requires that they never mix (invariant 13).
- "Approve & Submit" reads like the last step before Faculty see the change, but Faculty still see nothing until Publish Timetable.

### 2.3 Approve / Approved / Apply

| Where | Visible text | Meaning |
|---|---|---|
| `approval-workflow.js:371` | Status **Approved** | A Change Request that has been **applied** to sessions (status `approved` = applied) |
| `approval-workflow.js:406` | **Approve & apply** | Last office approves and applies in one step |
| `approval-workflow.js:622`; `faculty-swap-safe.js:134` | "Approved and applied to the live timetable." | Same |
| `approval-workflow.js:511–512` | "All required offices approved. Apply this request to the live timetable?" | Same |
| `afc-workflow.js:15` | **Approved** | AFC request approved |
| `user-management.html:8` | **Apply reviewed changes** | Saves account changes |
| `bulk-import-controller.js:61–62` | "Applying faculty teaching summaries" / "Applying timetable sessions" | Bulk import write step |
| P3 spec §4.5 (no UI yet) | **VISC Approve** → package `visc_approved` | Reviewed but **not** yet submitted to ADFAD, and nothing applied |

**Why it's confusing:** "Approved" means *applied to sessions* for a Change Request, but *reviewed, still waiting for HICC Final Submit* for a VISC-approved package. Neither means visible to Faculty.

### 2.4 Sync / Synchronized

| Where | Visible text | What it does |
|---|---|---|
| `faculty-admin.html:48`; `faculty-admin.js:316` | **Replace & Sync All Faculty Summaries** / "Synchronizing…" / "Synchronization failed: …" | Bulk import that **replaces** Working sessions and faculty data from a workbook |
| `bulk-import-ui.js:34, :49` | "Teaching Data Synchronization" | Same flow |
| `timetable.js:485` | **Sync from Faculty Dashboard** / **Synced Schedule Ready** (admin button, id `publish-firestore-schedule`) | Only **navigates** to the Faculty Dashboard (`initializeLiveSchedule`, `timetable.js:746`) |
| `timetable.js:730, :1686` | "Synchronized live timetable" | Label for the Firestore-backed data source |
| `timetable.js:1598` | "The live Firestore timetable is unavailable. Sync it from Faculty Dashboard first." | Error when no sessions are loaded |
| `faculty-admin.js:228` | "Synchronized teaching activities" | Dashboard heading |

**Why it's confusing:**
- "Sync" sounds like a safe refresh, but the main Sync action **replaces** data.
- The timetable button's element id is `publish-firestore-schedule`, its HTML label is **Initialize Live Schedule** (`index.html:176`), and at runtime it shows "Sync from Faculty Dashboard" / "Synced Schedule Ready". That's three names for one control, and none matches what it does (navigate).
- After P3, Sync writes **Working** data. A user could reasonably assume "Synced Schedule Ready" means Faculty can see it.

### 2.5 Ready / READY

| Where | Visible text | Meaning |
|---|---|---|
| `work-queue.js:85, :99` | **READY — n** / **READY** | An office's *serial Change-Request/operational stage* can act now |
| `timetable.js:1359` | "This work item is no longer READY. Reopen it from Work Queue." | Same |
| `timetable.js:485` | **Synced Schedule Ready** | Firestore sessions are loaded |
| `timetable.js:1762, :1767, :1860` | "Firebase Auth + Roles Ready" | Sign-in/role check finished |
| `bulk-import-ui.js:36` | "Recovery Backup Ready" | Import backup can be downloaded |
| P3 spec §4.4–§4.5 (no UI yet) | **content-ready** | HICC package has the required fields. The spec says this **must not** create an ADFAD item. |

**Why it's confusing:** in P3, "ready" for a HICC package (content-ready) explicitly doesn't mean ready for ADFAD, while Work Queue's READY does mean "you can act now". The same word ends up meaning both "act now" and "not yet".

### 2.6 Working

| Where | Visible text | Meaning |
|---|---|---|
| `bulk-import-ui.js:37` | "Working…" | Busy/progress label |
| P3 spec §3.3, §11.6 (no UI yet) | **Working** layer / Working timetable | Internal, unpublished data (`sessions` + `calendar_sessions`) |

**Why it's confusing:** the only current UI use of "Working" is a spinner label, which will collide with "Working timetable" as a data state.

### 2.7 Live / Initialize

| Where | Visible text |
|---|---|
| `index.html:176` | **Initialize Live Schedule** |
| `faculty-admin.html:34` | "Live Timetable Sessions" |
| `timetable.js:477–478` | "Authorized: {role} · Live Firestore schedule" / "… · No sessions in this view" |
| `timetable.js:2055` | "Live Firestore schedule — shared across authorized users." |
| `timetable.js:1582, :1633, :1647` | "Add Multiple Live Sessions" / "… Live Session" / "Save Live Session" |
| `timetable.js:1722, :1747` | "Live session added." / "updated." / "deleted." |
| `timetable.js:1739` | "Live Schedule is not initialized." |
| `approval-workflow.js:321` | "Requests do not change the live timetable until ADFA approves them." |
| `approval-workflow.js:511–512, :622`; `faculty-swap-safe.js:121, :134` | "…apply … to the live timetable" / "Approved and applied to the live timetable." |

**Why it's confusing:** under P3, everything currently called "live" is **Working** data. The word "live" suggests that Faculty see it now, which stops being true once publication exists. "Initialize" also suggests a one-time setup step, but the control only opens the Dashboard.

### 2.8 Draft / Active / Archive (DOE Rule Book vs timetable releases)

| Where | Visible text | Meaning |
|---|---|---|
| `faculty-admin.html:70–74`; DOE Rules tab generally | **Clone as Draft**, **Validate**, **Impact Preview**, **Publish**, **Archive**; version states Draft / Active / Archived | DOE policy version lifecycle |
| P3 spec §11.7 (no UI yet) | Release states **building → validated → sealed**, then **active** via `activeReleaseId` | Timetable release lifecycle |

**Why it's confusing:**
- Both lifecycles have "validate", "publish/activate" and "active", but their rules and owners differ. DOE publish needs an Impact Preview; timetable publish needs a sealed release.
- "Archive" exists for DOE, but P3 says releases aren't rolled back; instead, "restore = new forward release" (§11.8).

### 2.9 Pending / Update required / Push Back / Returned

| Where | Visible text |
|---|---|
| `approval-workflow.js:371` | "Pending - Update required" (status label) |
| `approval-workflow.js:395, :431` | **Push Back** / "Push Back requires a message." |
| `approval-workflow.js:450` | "Request returned for update." |
| `approval-workflow.js:474` | "Only fields returned for update can be changed." |
| P3 spec §4.5 (no UI yet) | VISC **Push Back** → package `changes_requested` |

**Why it's confusing:** one state has three names in the Change Request flow ("Update required", "Push Back", "returned for update"). P3 reuses "Push Back" for a different record type (the package review) with a different internal state name.

### 2.10 Office names (spec invariant 40)

On the P3 branch, the updated labels say **ADFAD** and **ADC/DVM** (`work-queue.js:21`, `session-workflow.js:24`, `approval-lifecycle.js` stage labels). These visible strings still say the old names:

- **"ADFA"**:
  - `approval-workflow.js:321, :338, :346, :356, :383, :509, :511, :514, :532, :552, :588`
  - `faculty-swap-safe.js:66, :124`
  - `faculty-admin.html:24`
  - `faculty-admin.js:89, :111`
  - `bulk-import-ui.js:53`
  - `faculty-suggestions.js:131`
- **"ADC"** without "/DVM":
  - `approval-office-view.js:10` ("ADC Approvals (n)")
  - `approval-workflow.js:552`
  - `faculty-suggestions.js:73, :89, :99, :109`

On `main`, all office labels are still `ADC`/`ADFA`, which is consistent there.

---

## 3. Expected UI states (simple, from the P3 spec)

These are the minimum things each state needs to communicate, taken from the spec. They are not designs. The "current repo" column records what exists today.

| State | Who sees it | What the state must communicate (spec) | Spec source | Current repo |
|---|---|---|---|---|
| **Working** | Internal roles only: Developer, Owner/ADFAD, ADC/DVM, LAB, and HICC/VISC in their Teaching Assignment tool | This is internal, unpublished data; edits here **don't** change what Faculty see until the next Publish Timetable | §3.3 ("Working edits after a release is active do not change what Faculty see until a later explicit Publish"); §11.10 | Not labelled. The same data is called "Live Firestore schedule" (`timetable.js:477, :2055`). |
| **Published** | Ordinary Faculty, and HICC/VISC in their normal calendar view | Faculty are seeing the **active sealed release** for the Academic Year; there's no inactive-release history in v1 | §11.6, §11.10 | Doesn't exist; Faculty read Working data (see `faculty-data-path-audit.md`) |
| **No Release** | Ordinary Faculty when no release exists for the year | "Timetable has not yet been published." No fallback to Working data. | §11.7 (exact wording), §11.11 ("never falls back to Working data") | Doesn't exist. The nearest message is "No synchronized source loaded — import from Faculty Dashboard." (`timetable.js:2055`), which is admin-oriented. |
| **Failed Publish** | The publisher (Developer, Owner/ADFAD General) | The publish didn't complete; **the previously active release is still what Faculty see**. A concurrent-publish loser must rebuild, not retry blindly. | §11.7 ("Failure leaves the prior active release unchanged"); §11.8 (concurrent publishers) | Doesn't exist |
| **Republish** | The publisher | Publishing again creates a **new** release; sealed releases never change; "restore" also creates a new forward release copied from an older one | §11.8 | Doesn't exist |

Related states the spec implies, for completeness:
- **Working differs from Published**, i.e. there are Working changes not yet published (§3.3, T12 smoke step 14).
- **Corrupt or missing pointer** → fail closed, like No Release (§11.11; T12 Step 5).
- **Release lifecycle steps:** building / validated / sealed (§11.7).
- **Publish not permitted** for ADFAD Regular, ADC/DVM, LAB, HICC, VISC and Faculty (§11.9).

---

## 4. Messages that become inaccurate once P3 publication exists

These strings are accurate today but would mislead after P3, because the data they describe becomes Working rather than Faculty-visible.

| Location | Current text | Why it becomes inaccurate |
|---|---|---|
| `approval-workflow.js:321` | "Requests do not change the live timetable until ADFA approves them." | After approval, changes reach **Working**; Faculty see them only after Publish Timetable |
| `approval-workflow.js:622`; `faculty-swap-safe.js:134` | "Approved and applied to the live timetable." | Same |
| `approval-workflow.js:511–512`; `faculty-swap-safe.js:121` | "Apply … to the live timetable?" | Same |
| `timetable.js:2055` | "Live Firestore schedule — shared across authorized users." | Ordinary Faculty will no longer read this data (§11.10) |
| `timetable.js:477–478` | "Authorized: {role} · Live Firestore schedule" | For Faculty this should describe the Published source; for internal users, Working |
| `timetable.js:485`; `index.html:176` | "Synced Schedule Ready" / "Initialize Live Schedule" | Suggests the schedule is live for everyone |
| `faculty-admin.html:48` | "Replace & Sync All Faculty Summaries" | Replaces **Working** data; says nothing about publication |

---

## 5. Questions for the product owner (wording decisions, not designs)

1. Should "live" be retired in internal screens once P3 lands, given it will mean Working data?
2. Should the DOE Rule Book **Publish** and the timetable **Publish Timetable** use visibly different names, given both appear in admin tools?
3. Should "Submit" be reserved for one lifecycle, given Change Request, AFC, HICC → VISC, HICC → ADFAD and ADFAD "Approve & Submit" all use it?
4. Should the Change Request status "Approved" (which means *applied*) and the VISC "Approve" (which means *reviewed, not submitted*) be distinguished?
5. Should the Change Request state have one consistent name instead of "Update required" / "Push Back" / "returned for update"?
6. Should the timetable control `publish-firestore-schedule` keep three different names ("Initialize Live Schedule", "Sync from Faculty Dashboard", "Synced Schedule Ready") for an action that only opens the Dashboard?

---

## 6. Method

1. Created read-only worktrees for the P3 branch (`6ce74ef`) and `main` (`7eb209f`).
2. Took all front-end `*.html`/`*.js` files, excluding `tests/`, `server/`, `tools/`, `docs/` and `test-support/`, and extracted quoted or element text containing Publish/Published, Submit, Approve/Apply, Sync, Ready/READY, Working, Live, Initialize, Draft/Active/Archive, Push Back/returned, and the office names.
3. Read the surrounding code for each occurrence to record what the control or message actually does, for example that `publish-firestore-schedule` only navigates (`timetable.js:746`).
4. Took P3 target terms and states from the spec sections listed in the header. No UI file was changed, and no design was proposed.
