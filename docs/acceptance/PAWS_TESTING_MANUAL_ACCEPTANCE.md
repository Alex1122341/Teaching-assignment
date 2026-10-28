# PAWS Testing — Manual Acceptance Checklist

All cases start **Not run**. This is an English execution checklist, not a claim that the site has passed. It covers the PAWS Beta feature baseline and the Testing-only harness. Use the filterable [Excel checklist](PAWS_TESTING_MANUAL_ACCEPTANCE.xlsx) for actual results, evidence, tester and date; [case catalog](manual-acceptance-cases.json) is the versioned source.

Maintain case definitions in the JSON catalog and keep Markdown/blank Excel IDs, steps and expectations aligned. Preserve completed operator copies, evidence and signatures when issuing a new blank checklist; never regenerate over an in-progress or signed run.

## Record the run

- Site URL: ____________________
- Mode / banner: ____________________
- PR and complete tested SHA: ____________________
- Academic year and synthetic dataset version: ____________________
- Tester / date / browser / viewport / zoom: ____________________
- Defect tracker / evidence folder: ____________________

Expected shared Testing URL: https://ucvm-teaching-assignment.github.io/Teaching-assignment/. Confirm the actual workflow deployment and banner first; a different PR can replace this shared site.

## Execution lanes and results

**D** = PAWS Frontend Demo: synthetic browser-local behavior. **L** = manually selected Firebase Lab with real synthetic Lab identities/data and rules. **B** = isolated trusted backend/integration required for the Beta contract. A multi-lane case can have a Demo observation but still require L/B for security, durability or concurrency signoff. Do not select Firebase Lab merely because a B case is blocked: Lab is not the University SQL backend.

Use **Not run, Pass, Fail, Blocked, N/A**. Record Actual Result, Evidence/defect, Tester and Test Date for every executed case. A missing feature, fixture, adapter, email system or trusted backend is **Blocked**, not Pass or automatically N/A. N/A needs an approved scope reason. A reproducible product mismatch is Fail. Never fill a human signature from an automated test result.

Use only synthetic accounts, faculty, PDFs, workbooks and recipient addresses. Never paste real credentials, production exports or staff documents into the Testing site. Reset data only in the known disposable environment and only through its reviewed controls. Simulated sign-in, ALL_WRITES demo gates and localStorage receipts are not real authorization or transaction proof.

Known differences and authority-specific expected behavior are in the [role matrix](../security/role-matrix.md) and [environment map](../architecture/testing-environments.md). In particular, current Testing lacks the PR148 dated effective-access subsystem, and legacy admin landing still differs from Calendar-home policy. Keep these cases visible and blocked/failed as appropriate; this documentation does not implement them.

## Required fixture roster

Prepare separate synthetic Developer, Owner, Administrator, Faculty, HICC, VISC, ADC, LAB and Other Office identities; disabled/unknown/missing-link cases; a correctly scoped multi-duty identity when supported; two academic years; in/out-of-scope courses/areas; boundary/unknown dates; clear/conflicting AFC and timetable; Locum/TBD/unassigned records; a legacy AFC without PDF and an original synthetic PDF; stale revisions and large/empty datasets. If a fixture is absent, record Blocked. Demo role switching tests rendering only; use separate real identities for L/B security acceptance.

## Feature inventory

- [Environment and isolation](#environment-and-isolation) — 5 cases
- [Authentication and session](#authentication-and-session) — 8 cases
- [Navigation and layout](#navigation-and-layout) — 4 cases
- [Names and display formats](#names-and-display-formats) — 4 cases
- [Calendar and filters](#calendar-and-filters) — 9 cases
- [Session administration](#session-administration) — 5 cases
- [Faculty Lookup and archive](#faculty-lookup-and-archive) — 5 cases
- [Availability](#availability) — 4 cases
- [Roles and appointments](#roles-and-appointments) — 5 cases
- [CCC schedule](#ccc-schedule) — 4 cases
- [Rotation and other work](#rotation-and-other-work) — 5 cases
- [Trainees](#trainees) — 3 cases
- [DOE summaries and worksheets](#doe-summaries-and-worksheets) — 6 cases
- [Annual DOE Rule Book](#annual-doe-rule-book) — 4 cases
- [AFC records and absence](#afc-records-and-absence) — 9 cases
- [SWAP selection and availability](#swap-selection-and-availability) — 4 cases
- [SWAP DOE preview](#swap-doe-preview) — 3 cases
- [Approval workflow](#approval-workflow) — 10 cases
- [Teaching assignment workflow](#teaching-assignment-workflow) — 5 cases
- [History and exports](#history-and-exports) — 5 cases
- [Custom reports](#custom-reports) — 5 cases
- [Accounts and effective access](#accounts-and-effective-access) — 6 cases
- [Collaboration and announcements](#collaboration-and-announcements) — 5 cases
- [Bulk imports and source replacement](#bulk-imports-and-source-replacement) — 3 cases
- [Privacy and failure boundaries](#privacy-and-failure-boundaries) — 5 cases
- [Release and handoff](#release-and-handoff) — 4 cases
- [Developer support sessions](#developer-support-sessions) — 6 cases

**Total: 141 cases across 27 feature groups.** Role-sensitive cases must be repeated for each relevant allowed and denied identity; the case count is not a count of completed runs.

## Environment and isolation

- [ ] **ENV-01 — All — Lane D/L**
  - Steps: Open the Testing site and record its banner, mode, PR and complete source SHA.
  - Expected: The run identifies this repository and the exact artifact; a changed shared-site SHA invalidates comparisons.
  - Coverage / prerequisite: Current Pages workflow publishes a shared URL.
- [ ] **ENV-02 — All — Lane D**
  - Steps: Open DevTools Network and navigate every top-level page in Frontend Demo.
  - Expected: API calls are intercepted locally; no University API, production database or real Firebase business request is sent.
  - Coverage / prerequisite: tools/pages-demo-api/browser.js
- [ ] **ENV-03 — All — Lane D**
  - Steps: Create a synthetic edit, reload, then use a second browser profile.
  - Expected: Demo persistence follows its documented local storage scope; it is not mistaken for a shared backend commit.
  - Coverage / prerequisite: Browser-local store; cross-user persistence requires backend.
- [ ] **ENV-04 — Operator — Lane L**
  - Steps: Inspect a manually selected Lab artifact and sign in with a synthetic Lab account.
  - Expected: Banner says Firebase Lab, project is vista-teaching-lab, real DOE API origin stays blank and DOE browser writer is off.
  - Coverage / prerequisite: Manual Firebase Lab workflow only.
- [ ] **ENV-05 — Operator — Lane B**
  - Steps: Attempt Testing reset/seed against a wrong project, database or production target in an isolated test.
  - Expected: The guard refuses before any mutation; never run this against real production.
  - Coverage / prerequisite: Requires disposable backend; Demo is insufficient.

## Authentication and session

- [ ] **AUTH-01 — All — Lane D/L**
  - Steps: Sign out, refresh and open Calendar and protected direct URLs.
  - Expected: Anonymous users see a sign-in gate; protected data is not rendered or retained.
  - Coverage / prerequisite: Use real Lab Auth for security evidence.
- [ ] **AUTH-02 — Each role — Lane D/L**
  - Steps: Complete normal sign-in from the entry page, refresh and sign in again.
  - Expected: Calendar is home, with no automatic Dashboard redirect; authorized deliberate direct navigation remains usable.
  - Coverage / prerequisite: Known legacy web administrator redirect may fail.
- [ ] **AUTH-03 — Faculty — Lane L**
  - Steps: Use an invalid password and then a valid synthetic account.
  - Expected: Error is clear; no private data is loaded after failure; valid real authentication succeeds only in Lab/backend.
  - Coverage / prerequisite: Demo passwords/sign-in are simulated.
- [ ] **AUTH-04 — Inactive / unknown — Lane D/L/B**
  - Steps: Use an inactive, unsupported-role, missing-profile and unlinked Faculty fixture separately.
  - Expected: Access fails closed with an actionable message; no fallback to Developer or another teacher.
  - Coverage / prerequisite: Distinct fixtures required; real authority in L/B.
- [ ] **AUTH-05 — New account — Lane L**
  - Steps: Use a must-change-password fixture and open a protected page before completion.
  - Expected: Mandatory change gate remains; successful change requires the proper identity and clears only allowed fields.
  - Coverage / prerequisite: Do not use real staff credentials or send reset mail from Demo.
- [ ] **AUTH-06 — Faculty — Lane D/L**
  - Steps: Exercise password-change validation, cancel and the authorized recovery entry.
  - Expected: Validation is correct, cancellation changes nothing, and real delivery/change is separately evidenced.
  - Coverage / prerequisite: Real email/credential change is Lab operator acceptance.
- [ ] **AUTH-07 — All — Lane D/L/B**
  - Steps: Sign out after opening Dashboard, SWAP and History, then use Back and a second account.
  - Expected: Prior private views clear; no previous user's payload or downloadable file is exposed.
  - Coverage / prerequisite: Inspect visible state and responses.
- [ ] **AUTH-08 — Administrator / Faculty — Lane B**
  - Steps: Change or expire an authorization fixture while another tab is open, then perform a protected action.
  - Expected: Current authority is rechecked and stale privileged views/actions fail closed.
  - Coverage / prerequisite: PR148 effective-access subsystem absent in current port.

## Navigation and layout

- [ ] **NAV-01 — Each role — Lane D/L**
  - Steps: Visit all visible navigation destinations and use Back, reload and authorized direct links.
  - Expected: Labels and active state are consistent, links resolve, and no inaccessible destination exposes data.
  - Coverage / prerequisite: PAWS and legacy page sets differ.
- [ ] **NAV-02 — All — Lane D/L**
  - Steps: Use keyboard-only navigation through menus, dialogs, filters and tables.
  - Expected: Focus is visible and logical; Escape/cancel and focus return work; no keyboard trap.
  - Coverage / prerequisite: Record browser and viewport.
- [ ] **NAV-03 — All — Lane D/L**
  - Steps: Compare desktop and narrow windows, dark mode and native browser zoom at 200%.
  - Expected: Controls remain readable and operable; key actions and selected filters are not clipped.
  - Coverage / prerequisite: Use native zoom, not CSS approximation.
- [ ] **NAV-04 — All — Lane D/L**
  - Steps: Load slow, empty, long-text, large-result and error fixtures.
  - Expected: Loading, counts, empty and retry states are truthful; stale data is not presented as current.
  - Coverage / prerequisite: Record missing fixture as Blocked.

## Names and display formats

- [ ] **NAME-01 — All — Lane D/L**
  - Steps: Inspect names in Calendar, Lookup, roles, pickers, account labels, approvals and History.
  - Expected: New display labels use Last name, First name through the shared formatter.
  - Coverage / prerequisite: Legacy raw-name gaps must be recorded.
- [ ] **NAME-02 — All — Lane D/L**
  - Steps: Use a compound surname, accents, apostrophe, initials and an already comma-formatted name.
  - Expected: Names remain intact after repeated formatting; one person's comma is not a list separator.
  - Coverage / prerequisite: Use synthetic names only.
- [ ] **NAME-03 — All — Lane D/L**
  - Steps: Inspect Locum, TBD, Unassigned, N/A, missing names and multiple-person labels.
  - Expected: Placeholders stay truthful; lists use semicolons/newlines; identities are not invented.
  - Coverage / prerequisite: Compare immutable IDs before/after.
- [ ] **NAME-04 — Administrator — Lane D/L/B**
  - Steps: Export CSV/Excel/ICS/PDF with formatted names and spreadsheet-like text.
  - Expected: Labels match the convention, escaping/formula-injection protections remain, and originals/raw audit values stay unchanged.
  - Coverage / prerequisite: Historical uploaded PDFs are not reformatted.

## Calendar and filters

- [ ] **CAL-01 — All authorized — Lane D**
  - Steps: Open Calendar with a fresh filter state and use Reset.
  - Expected: Teaching types are initially selected; work activities are excluded until explicitly selected.
  - Coverage / prerequisite: Beta baseline; record current port mismatch as Fail.
- [ ] **CAL-02 — All authorized — Lane D/L**
  - Steps: Switch Day, Week, Month and List; navigate previous/next and Today.
  - Expected: Dates, events and real ranges agree across views; no duplicate/lost event.
  - Coverage / prerequisite: Use an agreed synthetic timetable.
- [ ] **CAL-03 — All authorized — Lane D/L**
  - Steps: Combine year, semester, week, month, course, keyword and activity filters.
  - Expected: Results match all selected criteria; counts, active filters and clear/reset controls are accurate.
  - Coverage / prerequisite: Check empty and high-volume results.
- [ ] **CAL-04 — All authorized — Lane D**
  - Steps: Choose Rotation separately from Years 1-4, then combine and clear selections.
  - Expected: Rotation alone shows only Rotation; Years 1-4 remain distinct; reset restores the intended default.
  - Coverage / prerequisite: Rotation is a separate filter option.
- [ ] **CAL-05 — All authorized — Lane D**
  - Steps: Select teaching and all supported work categories using grouped multi-select and select/clear-all.
  - Expected: Every supported category is available; selections are explicit and counts stay correct.
  - Coverage / prerequisite: Include clinical days and other rotations, not CCC alone.
- [ ] **CAL-06 — Faculty — Lane D/L**
  - Steps: Toggle My Teaching and switch academic year.
  - Expected: Only authorized personal sessions appear; prior-year or another user's selection/data does not leak.
  - Coverage / prerequisite: Self identity must be linked.
- [ ] **CAL-07 — All authorized — Lane D**
  - Steps: Inspect overlapping, multi-day, long-topic and missing-time activities.
  - Expected: Layout is legible; date ranges preserved; approved08:30-16:30 work default is distinguishable from source time.
  - Coverage / prerequisite: Unknown/conflict status must remain truthful.
- [ ] **CAL-08 — All authorized — Lane D**
  - Steps: Open a LAB for a course/day containing several activities.
  - Expected: Grouped station/instructor/room/time table uses real data; missing rotation/group data says Not provided.
  - Coverage / prerequisite: Retain correct per-session actions and permissions.
- [ ] **CAL-09 — All authorized — Lane D/L**
  - Steps: Export the filtered Calendar as CSV and ICS; compare a selected multi-course/session export preview.
  - Expected: Only selected authorized records are exported, sorted by date/time, with expected fields and safe escaping.
  - Coverage / prerequisite: Missing VISC/source values stay Not provided.

## Session administration

- [ ] **SES-01 — Administrator — Lane D/B**
  - Steps: Create one synthetic teaching session and a valid batch.
  - Expected: Required fields validate; new sessions appear once with the correct year, course, times and audit actor.
  - Coverage / prerequisite: Durable audit/atomic batch needs backend.
- [ ] **SES-02 — Administrator — Lane D/B**
  - Steps: Edit topic, date, time, room, type and instructors separately, then cancel an edit.
  - Expected: Only intended fields change; cancellation changes nothing; DOE follows actual approved policy.
  - Coverage / prerequisite: Feature gate and version checked separately in B.
- [ ] **SES-03 — Administrator — Lane D/B**
  - Steps: Submit an invalid range, missing fields, duplicate batch and stale version.
  - Expected: Validation is clear and no partial/unintended change occurs.
  - Coverage / prerequisite: SQL race/rollback proof cannot be Demo-only.
- [ ] **SES-04 — Faculty / ADC / LAB — Lane L/B**
  - Steps: Open an admin edit URL/action directly and inspect the request response.
  - Expected: Unscoped direct administration is denied by the authority, not merely hidden in navigation.
  - Coverage / prerequisite: UI simulation alone is not a security pass.
- [ ] **SES-05 — Administrator — Lane D/B**
  - Steps: Use a removal/cancellation action where offered and verify confirmation/recovery/history.
  - Expected: Only the approved record is affected; unsupported permanent deletion stays unavailable.
  - Coverage / prerequisite: Do not enable disabled production operations to test them.

## Faculty Lookup and archive

- [ ] **LKP-01 — Administrator — Lane D/L**
  - Steps: Search names, surname fragments, specialty, teaching area and identifiers using synthetic records.
  - Expected: Keyword search returns accurate results and counts; clearing restores the set.
  - Coverage / prerequisite: Confidential identifier search is admin-only.
- [ ] **LKP-02 — Administrator — Lane D/B**
  - Steps: Inspect/edit allowed professional fields, rank, stream, FTE and reports-to on a versioned fixture.
  - Expected: Only supported fields save, unknown values stay unknown, and audit/history captures the change.
  - Coverage / prerequisite: No made-up source DOE or HR values.
- [ ] **LKP-03 — Administrator — Lane D/B**
  - Steps: Archive a departed synthetic person and inspect active versus archived views.
  - Expected: Person leaves active candidate lists; history and original records remain retrievable by authorized users.
  - Coverage / prerequisite: Use no real departed person's account.
- [ ] **LKP-04 — Faculty — Lane L/B**
  - Steps: Inspect own record and attempt another faculty detail route/export.
  - Expected: Own scope works; other UCID/email/DOE/HR/AFC details are absent from delivered payloads.
  - Coverage / prerequisite: Inspect responses, not only rendered columns.
- [ ] **LKP-05 — Demo administrator — Lane D**
  - Steps: Use Testing-only Add Faculty with valid and invalid synthetic UCID/name input.
  - Expected: Validation and duplicate checks work; changes stay browser-local and the action is clearly Testing-only.
  - Coverage / prerequisite: No production create-Faculty API is implied.

## Availability

- [ ] **AVL-01 — Administrator / Faculty — Lane D/L/B**
  - Steps: Search availability for a real synthetic date/time with clear AFC and timetable.
  - Expected: Available/Unavailable/Check needed matches the combined sources.
  - Coverage / prerequisite: Authority-specific privacy applies.
- [ ] **AVL-02 — Faculty — Lane D/L/B**
  - Steps: Check another person's AFC conflict and a separate timetable conflict.
  - Expected: AFC is binary with no reason; timetable conflict may show authorized course/time only.
  - Coverage / prerequisite: No AFC purpose, notes, PDF or contact leakage.
- [ ] **AVL-03 — Administrator — Lane D/B**
  - Steps: Test touching intervals, partial overlaps, midnight, inclusive date ranges and an unknown time.
  - Expected: Boundary behavior matches policy; unknown/inverted/missing data never becomes falsely Available.
  - Coverage / prerequisite: Real data/query parity needs backend.
- [ ] **AVL-04 — Administrator / Faculty — Lane B**
  - Steps: Change a source conflict after candidate selection and before final action.
  - Expected: The final authority rechecks live data and blocks a stale availability decision.
  - Coverage / prerequisite: Requires concurrency fixture; Demo may only simulate.

## Roles and appointments

- [ ] **ROLE-01 — Administrator — Lane D/L**
  - Steps: Search/filter HICC, Course Coordinator and VISC by course/area, year and as-of date.
  - Expected: Correct source assignment/course/area and active/inactive/dates-needed status appear.
  - Coverage / prerequisite: Dates do not independently change DOE policy.
- [ ] **ROLE-02 — Administrator — Lane D/B**
  - Steps: Inspect start/end boundaries, multiple periods and missing source validity.
  - Expected: Inclusive display and underlying boundary semantics agree; missing dates/default provenance are explicit.
  - Coverage / prerequisite: Approved default window2026-05-01 to2027-04-30 only where applicable.
- [ ] **ROLE-03 — Administrator — Lane D/B**
  - Steps: Edit a period with a current version, then retry using an old version.
  - Expected: First edit saves once; stale edit is refused; source role/DOE identities remain unchanged.
  - Coverage / prerequisite: Actual version/audit proof requires backend.
- [ ] **ROLE-04 — HICC / VISC — Lane L/B**
  - Steps: Use an in-scope, out-of-scope, expired and different-year appointment fixture.
  - Expected: Only the explicit current course/area/date scope grants the operation.
  - Coverage / prerequisite: PR148 dated multi-role administration is a current port gap.
- [ ] **ROLE-05 — Administrator — Lane D/B**
  - Steps: Compare role DOE, mapped/override/calculated/effective columns against the approved source.
  - Expected: Values and units agree; unexplained differences are reported, not silently overwritten.
  - Coverage / prerequisite: Human source reconciliation required.

## CCC schedule

- [ ] **CCC-01 — Administrator / Faculty — Lane D/L**
  - Steps: Open CCC, search/filter year and instructor, and compare date/slot/topic/location.
  - Expected: All slots are represented correctly; Locum/unassigned positions remain visible and truthful.
  - Coverage / prerequisite: Do not guess a missing instructor.
- [ ] **CCC-02 — Administrator — Lane D**
  - Steps: Download the bulk template and inspect headings, required fields and sample date/time formats.
  - Expected: Template is usable without guessing; CSV/Excel formats and validation instructions are explicit.
  - Coverage / prerequisite: Current adapter completeness must be verified.
- [ ] **CCC-03 — Administrator — Lane D/B**
  - Steps: Upload a complete synthetic academic-year replacement and inspect preview/counts/hash/issues.
  - Expected: Preview covers the exact year and full slot set, with duplicates, identities and missing fields exposed.
  - Coverage / prerequisite: Real full replacement requires approved exact preview.
- [ ] **CCC-04 — Administrator — Lane B**
  - Steps: Confirm the exact preview, compare Calendar/CCC/DOE and inspect a retry/recovery fixture.
  - Expected: Replacement is atomic, idempotent and scoped; recovery restores the intended set without unrelated changes.
  - Coverage / prerequisite: Demo UI cannot certify SQL transaction/recovery.

## Rotation and other work

- [ ] **ROT-01 — All authorized — Lane D**
  - Steps: Open Rotation in Calendar and compare participant, supervisor, dates, course and area.
  - Expected: Rotation data and ranges match the approved source; TBD remains TBD.
  - Coverage / prerequisite: Do not collapse all rotation categories into CCC.
- [ ] **ROT-02 — Administrator / Faculty — Lane D**
  - Steps: Open Other working activities in Dashboard and compare Calendar categories.
  - Expected: CCC, Rotation and formal teaching are excluded; only work not assigned to those established categories appears.
  - Coverage / prerequisite: Grouping is by activity ownership, not missing instructor.
- [ ] **ROT-03 — Administrator — Lane D/B**
  - Steps: Inspect clinical day/PPVM, rounds, presentations, pharmacology and teaching-excellence examples.
  - Expected: Each appears in the correct work category/filter, with meaningful dates and missing-time provenance.
  - Coverage / prerequisite: Source migration parity requires backend.
- [ ] **ROT-04 — Administrator — Lane B**
  - Steps: Preview a synthetic AFC-to-Calendar classification migration.
  - Expected: Work leaves AFC only for exact approved matches; Remote work, OPA, travel, vacation, RSL and leave remain AFC/away as approved.
  - Coverage / prerequisite: No production migration during manual Testing.
- [ ] **ROT-05 — Administrator — Lane B**
  - Steps: Inspect duplicate, inverted-date, missing-teacher and missing-reason source fixtures.
  - Expected: Away/review-needed classification retains the raw issue; no duplicate insert, invented identity/date or fuzzy delete.
  - Coverage / prerequisite: Requires safe isolated import fixtures.

## Trainees

- [ ] **TRN-01 — Administrator / Faculty — Lane D**
  - Steps: Open the separate Trainees tab, choose year and search names/category/supervisor.
  - Expected: The proper source cohort appears with scoped records and accurate counts.
  - Coverage / prerequisite: Do not infer private contact access.
- [ ] **TRN-02 — Administrator — Lane D/B**
  - Steps: Compare all seven source category statistics, including zero/missing and duplicate fixtures.
  - Expected: Definitions match the source, totals do not double count, and missing values are not fabricated.
  - Coverage / prerequisite: Use approved synthetic source control totals.
- [ ] **TRN-03 — Administrator — Lane B**
  - Steps: Refresh a changed synthetic trainee source and inspect year boundaries and supervision DOE.
  - Expected: Only approved cohort/year changes apply; source/DOE discrepancies stay visible.
  - Coverage / prerequisite: Durable import and reconciliation need backend.

## DOE summaries and worksheets

- [ ] **DOE-01 — Administrator / Faculty — Lane D/B**
  - Steps: Open Teaching Summary, DOE Overview/List and an authorized worksheet for the same year.
  - Expected: Assigned, role, supervision, target and remaining/overage totals reconcile or show a specific unresolved reason.
  - Coverage / prerequisite: Demo values are illustrative, not authoritative policy.
- [ ] **DOE-02 — Administrator — Lane D/B**
  - Steps: Compare formula inputs, units, rounding, policy version and detailed course contributions.
  - Expected: Approved source/formula is used; unknown contract DOE/FTE/rank are not guessed.
  - Coverage / prerequisite: Record both expected source and observed values.
- [ ] **DOE-03 — Faculty — Lane L/B**
  - Steps: Open own DOE and try another person's worksheet/direct API/export.
  - Expected: Own authorized values appear; colleagues' private DOE is denied/absent.
  - Coverage / prerequisite: Inspect delivery boundary.
- [ ] **DOE-04 — Administrator — Lane D/B**
  - Steps: Add/update an allowed manual assignment or target override with a reason; cancel another edit.
  - Expected: Preview/save/history agree; cancellation is inert; stale versions do not overwrite newer data.
  - Coverage / prerequisite: Backend gates and durable audit require B.
- [ ] **DOE-05 — Administrator — Lane D/B**
  - Steps: Run DOE Checking/Reconciliation against an approved synthetic source, including known differences.
  - Expected: Differences are itemized by source and year; inconsistent figures are not silently rewritten.
  - Coverage / prerequisite: Beta PR101/102 and later approved rules are reference contracts.
- [ ] **DOE-06 — Faculty / Office — Lane L/B**
  - Steps: Try an admin DOE control and direct request outside scope.
  - Expected: Authority denies the operation; no hidden-data prefetch or browser fallback grants it.
  - Coverage / prerequisite: Role selector is not real security evidence.

## Annual DOE Rule Book

- [ ] **RULE-01 — Owner / Administrator — Lane D/L**
  - Steps: Open the annual rule book, search/filter, inspect tables, effective year and version.
  - Expected: The correct year's version and rule parameters are clear; prior policy remains distinguishable.
  - Coverage / prerequisite: Current Lab writer is off.
- [ ] **RULE-02 — Authorized admin — Lane B**
  - Steps: Create/copy/edit a draft in an isolated supported backend and preview the impact.
  - Expected: Draft is separate; affected faculty/inputs/calculations and source version are explicit.
  - Coverage / prerequisite: Demo may simulate UI only; trusted admin path required.
- [ ] **RULE-03 — Owner — Lane B**
  - Steps: Publish/recalculate/archive using the reviewed trusted admin path, then verify retries and history.
  - Expected: Only authorized current preview applies once; policy/calculation version and audit remain consistent.
  - Coverage / prerequisite: Missing job/adapter is Blocked; never enable Lab browser DOE writes.
- [ ] **RULE-04 — Administrator / Faculty — Lane L/B**
  - Steps: Attempt Owner-only publication and browser Firestore DOE mutations.
  - Expected: Disallowed publication/direct browser writes fail at the authority.
  - Coverage / prerequisite: Rules/emulator and real backend evidence required.

## AFC records and absence

- [ ] **AFC-01 — Administrator — Lane D/B**
  - Steps: Create one synthetic AFC record; inspect faculty label, range, reason, required notes and audit.
  - Expected: Valid permitted absence saves once; UID is not displayed as the faculty label.
  - Coverage / prerequisite: Special/Other notes required; use current supported reason list.
- [ ] **AFC-02 — Administrator — Lane D/B**
  - Steps: Use Multi Input/paste with valid rows, bad identities, duplicate rows and invalid ranges.
  - Expected: Preview reports issues; confirmed valid batch has no unintended partial write.
  - Coverage / prerequisite: Actual atomicity needs backend.
- [ ] **AFC-03 — Administrator — Lane D/B**
  - Steps: Cancel/remove a future travel record and reload availability/history.
  - Expected: Only the intended row is cancelled/removed through the supported recoverable action; history remains.
  - Coverage / prerequisite: Permanent deletion is not assumed.
- [ ] **AFC-04 — Administrator — Lane D/B**
  - Steps: Create manual AFC with an original synthetic PDF under Create AFC Records.
  - Expected: Manual fields and PDF archive association are clear and validated; no automatic fake PDF is claimed.
  - Coverage / prerequisite: Current adapter storage behavior must be verified.
- [ ] **AFC-05 — Administrator — Lane D/B**
  - Steps: Download each record's original PDF, including a legacy record without an original.
  - Expected: Original bytes/association are correct; legacy PDF column shows N/A, not a broken download.
  - Coverage / prerequisite: Durable protected storage requires B.
- [ ] **AFC-06 — Faculty — Lane L/B**
  - Steps: Open own AFC/PDF page and attempt another faculty member's original/direct download.
  - Expected: Own authorized original is downloadable; cross-faculty artifact is denied without leaking reason/data.
  - Coverage / prerequisite: Synthetic confidential documents only.
- [ ] **AFC-07 — Faculty — Lane D/B**
  - Steps: Generate/submit an AFC request, save draft if supported, cancel before submit and view status.
  - Expected: Valid request enters the correct review flow; cancellation is inert; repeated submit is not duplicated.
  - Coverage / prerequisite: Delivery/SQL persistence require backend.
- [ ] **AFC-08 — Authorized reviewer — Lane D/B**
  - Steps: Approve/reject/return a synthetic AFC request; request approved artifact where enabled.
  - Expected: State, signer/actor, reason and PDF agree; unauthorized/stale actions fail; disabled artifact gates stay disabled.
  - Coverage / prerequisite: Do not bypass current gates for a pass.
- [ ] **AFC-09 — Administrator — Lane D/B**
  - Steps: Upload an oversized, corrupt, wrong-type or malformed PDF fixture.
  - Expected: Upload rejects clearly and safely; no secret/source text is exposed and no partial archive remains.
  - Coverage / prerequisite: Demo parser/storage shims are not full backend security.

## SWAP selection and availability

- [ ] **SWAP-01 — Faculty / HICC — Lane D/L/B**
  - Steps: Initiate replacement from an authorized session and search active faculty by name/area.
  - Expected: Sanitized candidates include active people without requiring login accounts; immutable candidate keys remain correct.
  - Coverage / prerequisite: Do not expose other UCIDs/email/HR.
- [ ] **SWAP-02 — Faculty — Lane D/L/B**
  - Steps: Compare available, AFC-unavailable, timetable-conflict and unknown-time candidates.
  - Expected: Binary AFC privacy is preserved; allowed timetable reason is clear; uncertain candidate says Check needed.
  - Coverage / prerequisite: Confirm exact target date/time.
- [ ] **SWAP-03 — Faculty / Administrator — Lane D/L**
  - Steps: Choose Sessional and Other with and without a note.
  - Expected: Both categories are valid; blank reason blocks submission; the correct source credit is preserved.
  - Coverage / prerequisite: No made-up Faculty record for a placeholder.
- [ ] **SWAP-07 — Requester — Lane D/B**
  - Steps: Submit, cancel and retry one synthetic replacement intent.
  - Expected: Status and history are correct; retry confirms the same intent rather than duplicating a request/apply.
  - Coverage / prerequisite: Backend idempotency acceptance required.

## SWAP DOE preview

- [ ] **SWAP-04 — Administrator — Lane D/B**
  - Steps: Inspect the instructor being removed before and after a proposed SWAP.
  - Expected: Current DOE, course/session DOE credit and projected DOE after SWAP are shown with clear units/status.
  - Coverage / prerequisite: Current port accuracy must be checked against Beta contract.
- [ ] **SWAP-05 — Administrator — Lane D/B**
  - Steps: Compare replacement candidates and preview the selected one.
  - Expected: Availability/reason, contract, current, remaining and projected DOE use authoritative consistent inputs.
  - Coverage / prerequisite: Only backend can certify authoritative calculation.
- [ ] **SWAP-06 — Faculty / HICC / VISC — Lane L/B**
  - Steps: Inspect candidate payloads and try the privileged DOE preview directly.
  - Expected: No private candidate DOE/contract/HR is delivered to unauthorized users.
  - Coverage / prerequisite: UI hiding alone is insufficient.

## Approval workflow

- [ ] **APR-01 — Course Coordinator / Instructor — Lane D/L**
  - Steps: Open instructions and choose Topic Change, SWAP or Session Type Change.
  - Expected: Correct entry choices and guidance appear for the role; unsupported stages are explicit gaps.
  - Coverage / prerequisite: Legacy and ported workflow variants differ.
- [ ] **APR-02 — Authorized requester — Lane D/L/B**
  - Steps: Submit a topic change, a replacement and a session-type change separately.
  - Expected: Only changed fields determine required approvals; live timetable remains unchanged while pending.
  - Coverage / prerequisite: Record actual office sequence, not renamed labels.
- [ ] **APR-03 — Authorized requester — Lane D/B**
  - Steps: Include multiple sessions and a comment in one request where supported.
  - Expected: All intended sessions are visible and scoped; unsupported multi-session flow is Blocked, not silently split.
  - Coverage / prerequisite: Beta parity requirement; inspect current adapter.
- [ ] **APR-04 — ADFA / DVM / ADC / LAB — Lane L/B**
  - Steps: Execute the required staged approvals with separate office fixtures.
  - Expected: Each office sees/edits only its scope; required ADFA-to-DVM sequence is honored where specified; no self-approval bypass.
  - Coverage / prerequisite: DVM stage must exist; legacy ADC/LAB routing is not a substitute.
- [ ] **APR-05 — Reviewer / requester — Lane D/L/B**
  - Steps: Push back with reason, resubmit only returned fields, reject and cancel separate requests.
  - Expected: State and editable fields follow the reviewed revision model; prior decisions invalidate when required.
  - Coverage / prerequisite: Check old-revision controls and actor history.
- [ ] **APR-06 — Reviewer — Lane B**
  - Steps: Open a request in two tabs; decide twice and change the session before final approval.
  - Expected: Only one valid decision/apply occurs; stale versions or changed availability stop the apply.
  - Coverage / prerequisite: Real concurrency/atomicity cannot be certified by Demo.
- [ ] **APR-07 — Final approver — Lane D/L/B**
  - Steps: Complete the final required approval and inspect Calendar, DOE and history.
  - Expected: Exactly the approved changes become live once; actor, before/after and calculation effects agree.
  - Coverage / prerequisite: Use disposable backend for authoritative evidence.
- [ ] **APR-08 — Program Office / Administrator — Lane D/B**
  - Steps: Complete and reopen the administrative checklist for invite, DVM hub and D2L updates.
  - Expected: Checklist is persistent, auditable and revisitable without falsely asserting external systems updated.
  - Coverage / prerequisite: External integration needs separate evidence.
- [ ] **APR-09 — Requester / office — Lane B**
  - Steps: Trigger each configured submission/decision notification and inspect recipients/links.
  - Expected: Correct CC/department/office audience receives the notice once; private request fields stay scoped.
  - Coverage / prerequisite: Real email/delivery/retry is an integration gate.
- [ ] **APR-10 — Unauthorized role — Lane L/B**
  - Steps: Open private request details, another office's decision and direct final-apply endpoints.
  - Expected: Authority refuses; sanitized public state does not expose private candidates or decision fields.
  - Coverage / prerequisite: Real role identities required.

## Teaching assignment workflow

- [ ] **TA-01 — HICC / coordinator — Lane D/B**
  - Steps: Open the work queue with owned, unowned, empty and mixed-scope packages.
  - Expected: Only authorized packages/actions appear; zero packages is truthful, not filled with invented ownership.
  - Coverage / prerequisite: Dated multi-role authority is a PR148 gap.
- [ ] **TA-02 — HICC / coordinator — Lane D/B**
  - Steps: Create/edit a draft, search faculty, select teaching roles and inspect completeness warnings.
  - Expected: Stable person IDs and valid role choices are retained; missing/ambiguous assignments are explicit.
  - Coverage / prerequisite: Preserve DOE policy inputs.
- [ ] **TA-03 — VISC / office reviewer — Lane D/B**
  - Steps: Review, return, finalize and publish using the designated separate package roles.
  - Expected: Stage and ownership checks hold; no self-review or cross-scope shortcut; only final approved revision publishes.
  - Coverage / prerequisite: Backend stage/transaction proof required.
- [ ] **TA-04 — Reviewer — Lane B**
  - Steps: Review an empty assignment, add a teacher, remove the teacher and attempt to reuse the old review.
  - Expected: Old review becomes invalid even when values return to empty; Undo also invalidates it.
  - Coverage / prerequisite: Requires assignment-version/ABA backend evidence.
- [ ] **TA-05 — Coordinator / reviewer — Lane D/B**
  - Steps: Change academic year/scope during loading and open stale approval controls.
  - Expected: Prior scope data clears, late responses are ignored and unauthorized actions remain unavailable.
  - Coverage / prerequisite: Real authority invalidation requires backend.

## History and exports

- [ ] **HIS-01 — Administrator / Faculty — Lane D/L**
  - Steps: Open My Change History, visible timetable Changes and Dashboard History.
  - Expected: Correct entry points exist; role, subject and selected academic year scope each result.
  - Coverage / prerequisite: Faculty self-history differs from all-user admin history.
- [ ] **HIS-02 — Administrator — Lane D/B**
  - Steps: Create lookup, appointment, AFC, DOE-rule, session and assignment fixture changes.
  - Expected: History covers all domains with time, type/domain, subject/session, before start/end, after value and actor; missing values show N/A.
  - Coverage / prerequisite: Durable complete audit requires backend.
- [ ] **HIS-03 — All authorized — Lane D/L**
  - Steps: Search arbitrary keywords across loaded history, filter domain/type/year, then load older matches.
  - Expected: Compact rows support scanning many records; counts and search scope are clear and older matches can be reached.
  - Coverage / prerequisite: Do not claim an unloaded page has been searched.
- [ ] **HIS-04 — All authorized — Lane D/L/B**
  - Steps: Export the filtered history, including long names and spreadsheet-like text.
  - Expected: Only authorized selected-year rows are downloaded with stable headers, ordering and safe escaping.
  - Coverage / prerequisite: Compare exported rows with preview/counts.
- [ ] **HIS-05 — Faculty / office — Lane L/B**
  - Steps: Query another faculty identity/year/source directly and inspect response fields.
  - Expected: Unauthorized history and confidential before/after values are denied or appropriately sanitized.
  - Coverage / prerequisite: Not just a hidden tab.

## Custom reports

- [ ] **RPT-01 — Owner / Administrator — Lane D**
  - Steps: Open Reports and select available data sources and columns using filters.
  - Expected: Each chosen source/field is visible and clearly labeled; unselected fields do not appear.
  - Coverage / prerequisite: Reports are admin-only in ported API.
- [ ] **RPT-02 — Owner / Administrator — Lane D/B**
  - Steps: Combine faculty, sessions, roles, AFC, trainees, DOE and other-work sources where offered.
  - Expected: Preview joins/grain avoid duplication; missing values, counts and selected academic year remain clear.
  - Coverage / prerequisite: Use independent expected fixture totals.
- [ ] **RPT-03 — Owner / Administrator — Lane D/B**
  - Steps: Select history as an independent report source, then filter current-record sources.
  - Expected: History remains separate from current state; time/year semantics are not mixed silently.
  - Coverage / prerequisite: Selected-year current records are the default contract.
- [ ] **RPT-04 — Owner / Administrator — Lane D/B**
  - Steps: Change filters/columns, preview and export; include formula-like text and a large result.
  - Expected: Export matches the authorized preview, protects spreadsheet text and handles limits/errors clearly.
  - Coverage / prerequisite: Backend authorization and source completeness required.
- [ ] **RPT-05 — Faculty / HICC / VISC / office — Lane L/B**
  - Steps: Open Reports directly and attempt download requests.
  - Expected: Non-admin report endpoints deny access; no private source data is prefetched.
  - Coverage / prerequisite: Separate role and record scope checks.

## Accounts and effective access

- [ ] **ACC-01 — Owner — Lane B**
  - Steps: Search accounts, inspect role/status/faculty association and use preview before a scoped change.
  - Expected: Versioned preview shows exact before/after/impact; commit returns an auditable confirmed result.
  - Coverage / prerequisite: PR148 Owner preview/commit is absent in current Testing port.
- [ ] **ACC-02 — Owner — Lane B**
  - Steps: Retry the same operation after a lost response using mixed-case UUID representations.
  - Expected: Same persisted result is confirmed without duplicate grant/audit; malformed typed IDs reject safely.
  - Coverage / prerequisite: No new intent to resolve ambiguity.
- [ ] **ACC-03 — Owner — Lane B**
  - Steps: Attempt protected Developer changes, self-demotion and removal of the last Owner.
  - Expected: Protected targets and unsafe owner changes are refused by the authority before mutation.
  - Coverage / prerequisite: Older browser form is not proof of PR148 protection.
- [ ] **ACC-04 — Administrator / Faculty — Lane B**
  - Steps: Try Owner account catalog/preview/commit/history directly.
  - Expected: Every unauthorized management operation is denied, including stale cached permissions.
  - Coverage / prerequisite: Requires current effective-access subsystem.
- [ ] **ACC-05 — Faculty with HICC + VISC — Lane B**
  - Steps: Inspect My access for Faculty plus a dated course duty and a separate area duty.
  - Expected: Faculty remains; each duty lists its exact course/area/year/inclusive dates; outside scopes stay denied.
  - Coverage / prerequisite: Use synthetic equivalent of505 HICC/CC+Bovine VISC; PR148 gap.
- [ ] **ACC-06 — Owner — Lane B**
  - Steps: Confirm two scoped duties through one approved intent, then revoke one and retry stale work.
  - Expected: Exact grants/audit count, provenance, effective windows and authority epoch are correct; unrelated identity/DOE remains unchanged.
  - Coverage / prerequisite: Real backend and recovery receipt required.

## Collaboration and announcements

- [ ] **GRP-01 — Owner / HICC — Lane D/L/B**
  - Steps: Open owned and unowned groups and inspect owner/membership choices.
  - Expected: Only permitted groups/actions appear; candidates are sanitized and collaboration does not grant course/DOE rights.
  - Coverage / prerequisite: Current port uses older group flow; Beta PR148 is target.
- [ ] **GRP-02 — Owner — Lane B**
  - Steps: Edit membership while retaining a current owner whose base role is Faculty; include an unresolved historical member.
  - Expected: Actual current owner remains selected; no accidental default transfer; unresolved member is retained for review.
  - Coverage / prerequisite: PR148 owner-retention correction is a current port gap.
- [ ] **GRP-03 — HICC — Lane L/B**
  - Steps: Change permitted membership only, then try owner/name/course changes and another group's write.
  - Expected: Only authorized membership change is accepted with audit/CAS; forbidden edits and stale versions reject.
  - Coverage / prerequisite: Demo role switching is not security signoff.
- [ ] **GRP-04 — Owner / administrator / Faculty — Lane L/B**
  - Steps: Publish/read an allowed announcement and test unauthorized publication and stale edits.
  - Expected: Correct audiences/actors and versioning hold; Faculty cannot publish administrative content.
  - Coverage / prerequisite: Current source contract must be checked per mode.
- [ ] **GRP-05 — Faculty — Lane B**
  - Steps: Compare API group/announcement reads with direct Firestore business access after a SQL-authorized migration.
  - Expected: Trusted replacement works while direct client business paths deny; own password-profile exception stays narrow.
  - Coverage / prerequisite: Beta PR148 migration contract is not present in this Lab port.

## Bulk imports and source replacement

- [ ] **IMP-01 — Administrator — Lane D/L/B**
  - Steps: Download templates, preview synthetic course-calendar, faculty/AFC and supported source files.
  - Expected: Headers/formats, counts, unknown identities, invalid ranges and duplicate issues are clear before confirmation.
  - Coverage / prerequisite: Only supported source domains are runnable.
- [ ] **IMP-02 — Administrator — Lane B**
  - Steps: Approve a full-year synthetic replacement, simulate interruption and inspect exact recovery.
  - Expected: Atomic scope/hash/version checks prevent partial or cross-year replacement; recovery evidence is private and verifiable.
  - Coverage / prerequisite: No production SQL/import/reset in this Testing run.
- [ ] **IMP-03 — Administrator — Lane B**
  - Steps: Compare CCC/HICC/VISC/Rotation/Trainee imports and DOE reconciliation against source controls.
  - Expected: Approved periods/defaults and Locum/TBD are retained; significant DOE differences are reported before change.
  - Coverage / prerequisite: Use saved approved synthetic sources.

## Privacy and failure boundaries

- [ ] **SEC-01 — Each role — Lane L/B**
  - Steps: Inspect network payloads, downloads, errors and browser storage for unauthorized private fields.
  - Expected: No cross-faculty UCID/email/HR/DOE/AFC reason/PDF leakage, even if UI columns are hidden.
  - Coverage / prerequisite: Use independent normal identities.
- [ ] **SEC-02 — Each role — Lane L/B**
  - Steps: Attempt direct writes/queries outside role, office, faculty, course, academic year and effective dates.
  - Expected: Trusted authority consistently denies; no client-side fallback or broadened rule rescues the request.
  - Coverage / prerequisite: Real Lab rules and backend have distinct matrices.
- [ ] **SEC-03 — All — Lane D/L/B**
  - Steps: Exercise forbidden, missing, stale, expired, offline and retry responses in each affected screen.
  - Expected: UI gives an actionable state, clears unsafe stale data and never reports a failed/ambiguous save as success.
  - Coverage / prerequisite: Keep original operation identity on uncertain writes.
- [ ] **SEC-04 — Operator — Lane D/L**
  - Steps: Inspect generated artifact and graph inputs for secrets, staff originals, exports and unexpected runtime files.
  - Expected: Only allowed public assets ship; Graphify/documents and private data stay outside the web artifact.
  - Coverage / prerequisite: Build manifests, not raw repository publishing.
- [ ] **SEC-05 — Operator — Lane B**
  - Steps: Review service credentials, CORS, TLS, database identity, gates and real delivery configuration in an isolated backend.
  - Expected: Exact approved target/identity/gates verified; no production credentials are stored in Git/browser artifacts.
  - Coverage / prerequisite: Not a request to configure production or expose secrets.

## Release and handoff

- [ ] **REL-01 — Operator — Lane D/L/B**
  - Steps: Run required repository tests/build and inspect exact-head workflow/artifact evidence.
  - Expected: Passes, failures/skips and environment blockers are recorded separately; artifact matches tested SHA/mode.
  - Coverage / prerequisite: No test result or role simulation is a release by itself.
- [ ] **REL-02 — Operator — Lane D/L**
  - Steps: Merge an approved change, rebuild Graphify from exact merged main and open both views.
  - Expected: Raw index/hash/counts/warnings and a source-confirmed edge are recorded; a pre-merge graph is not reused as new evidence.
  - Coverage / prerequisite: See script-dependency-graph.md.
- [ ] **REL-03 — Operator / business tester — Lane D/L/B**
  - Steps: Compare deployed banner/SHA/mode and execute the affected acceptance cases; record signoff and recovery evidence.
  - Expected: No false pass for pending adapters, mock persistence or missing integration; actual tester, date, defects and residual risks remain explicit.
  - Coverage / prerequisite: No prefilled human signature.
- [ ] **REL-04 — Operator — Lane B**
  - Steps: Perform a separately authorized restart/recovery drill only in a disposable backend.
  - Expected: Approved API/source/gates/ingress restore without data loss; a changed Quick Tunnel domain is detected, not silently declared healthy.
  - Coverage / prerequisite: Not executable on the cloud-free Pages frontend.

## Developer support sessions

- [ ] **SUP-01 — Developer — Lane B**
  - Steps: Choose an active synthetic target account, submit a blank/oversized reason, then start with a valid reason.
  - Expected: Reason is required and bounded; only an active supported target starts a30-minute context with the real Developer actor retained.
  - Coverage / prerequisite: Developer support adapter/backend required; Demo role switching is not equivalent.
- [ ] **SUP-02 — Developer — Lane B**
  - Steps: Inspect the support banner and perform an allowed synthetic edit, then inspect recent operations and audit.
  - Expected: Target context is clear, actions are real in that environment, and actor/target/reason/change capture are attributable without identity transfer.
  - Coverage / prerequisite: Use disposable backend records only; never real staff data.
- [ ] **SUP-03 — Developer — Lane B**
  - Steps: Select Return to myself, reload and inspect subsequent requests and private views.
  - Expected: Context ends and support headers/cached target data clear; subsequent actions use the Developer's own identity.
  - Coverage / prerequisite: Ending an already ended context must not reopen it.
- [ ] **SUP-04 — Developer — Lane B**
  - Steps: Expire the context at30minutes, disable the target or require its password change, then retry a supported action.
  - Expected: Expired/ended/unavailable targets fail closed; stale tabs cannot keep acting as the target.
  - Coverage / prerequisite: Use controlled expiry and target fixtures, not production account edits.
- [ ] **SUP-05 — Developer — Lane B**
  - Steps: Undo a captured own operation without a later change; repeat Undo and try another with a conflicting later edit.
  - Expected: Valid Undo restores only captured data once; conflict/foreign operation is refused and later edits/audit history remain.
  - Coverage / prerequisite: Actual version/transaction/recovery evidence required.
- [ ] **SUP-06 — Faculty / Administrator / Developer — Lane B**
  - Steps: Try non-Developer start/list/end/Undo, a foreign context ID and unsupported support routes such as protected artifacts.
  - Expected: Authority denies non-Developer/foreign-context or restricted-route access; support is not a blanket data/download bypass.
  - Coverage / prerequisite: server/src/support/support-service.js is the ported contract.

## Release decision

- [ ] Exact artifact, mode, SHA and dataset recorded.
- [ ] Required positive and negative role/scope cases executed in the correct lane.
- [ ] No unresolved critical privacy, authorization, wrong-year, duplicate-apply or data-loss issue.
- [ ] Blocked integrations and known gaps have an explicit owner and disposition; no simulated security pass.
- [ ] Affected exports/PDFs match preview and authorized scope.
- [ ] Post-merge Graphify regenerated and both views/source edge verified.
- [ ] Recovery evidence and limitations recorded for the actual deployed environment.
- [ ] Business tester and release approver sign independently; automated evidence is attached separately.

Business tester / date: ____________________

Release approver / decision / date: ____________________
