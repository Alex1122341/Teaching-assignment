# Timetable, Faculty Dashboard, and AFC Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move faculty self-service and AFC requests into the timetable, rename the administrative directory, complete exact AFC PDF field mapping, and provide responsive, audited multi-session editing.

**Architecture:** `index.html` owns the faculty-facing shell and exposes one `UCVM_PAGE_DATA` interface to `afc-workflow.js`, so AFC reuses the timetable's identity and session scope. Pure AFC option mapping lives in `afc-form-values.js`; panel mounting lives in `afc-timetable-panel.js`; selection, validation, and atomic update planning live in `timetable-selection.js`, keeping the existing timetable renderer and Firestore maintenance layer focused.

**Tech Stack:** Static HTML/CSS/JavaScript, Firebase Authentication, Cloud Firestore compat SDK, Firestore Security Rules, pdf-lib loaded through `asset-loader.js`, Node.js built-in test runner, Firebase Emulator Suite, Firebase Hosting, Azure Static Web Apps.

**Spec:** `docs/superpowers/specs/2026-09-14-timetable-faculty-afc-consolidation-design.md`

## Global Constraints

- Keep Firebase Authentication and Firestore as the browser data layer on both hosting platforms.
- Keep existing role boundaries: faculty, HICC, and VISC receive self-service data; ADFA and administrative roles retain management and approval access.
- Every changed timetable session must have actor identity and exactly one corresponding `session_change_log` entry.
- AFC approval must continue producing one immutable PDF stored in `pdf_chunks`; do not introduce Firebase Storage or a server API.
- Existing AFC requests without contact fields must remain readable and approvable.
- New AFC requests require `contactAddress` (1-500 characters) and `contactPhone` (1-50 characters).
- Primary Department must be `30060 - Faculty of Veterinary Medicine` in every generated AFC PDF.
- Multi-session editing is admin-only, is capped at 200 sessions, and uses at most 400 writes in one Firestore batch.
- New visible labels are `Faculty Dashboard`, `Timetable`, `AFC Request`, and `ADFA approval queue`.
- Do not submit an AFC request or modify live timetable sessions during production QA.

---

### Task 1: Canonical AFC form values

**Files:**
- Create: `afc-form-values.js`
- Modify: `afc-pdf-browser.js`
- Test: `tests/afc-form-values.test.js`

**Interfaces:**
- Consumes: raw `rank`, `appointmentType`, `contactAddress`, and `contactPhone` values from an AFC request.
- Produces: `window.UCVM_AFC_FORM_VALUES` with `PRIMARY_DEPARTMENT`, `rank(value): string`, `appointment(value): string`, and `contact(request): {address:string, phone:string}`.

- [ ] **Step 1: Write failing mapping tests**

Create a VM-based browser-global test which loads `afc-form-values.js` and asserts the complete mapping tables:

```js
assert.equal(api.PRIMARY_DEPARTMENT, '30060 - Faculty of Veterinary Medicine');
assert.equal(api.rank(' Assistant Professor '), 'Assistant Professor - AC0003');
assert.equal(api.rank('Associate Professor (Teaching)'), 'Associate Professor (Teaching) - AC0007');
assert.equal(api.rank('Unknown'), '');
assert.equal(api.appointment('Tenure'), 'With Tenure');
assert.equal(api.appointment('tenure-track'), 'Tenure-track');
assert.equal(api.appointment('unrecognized'), '');
assert.deepEqual(api.contact({contactAddress:' 2500 University Dr ', contactPhone:' 403-555-1212 '}), {
  address:'2500 University Dr', phone:'403-555-1212'
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test tests/afc-form-values.test.js`

Expected: FAIL because `afc-form-values.js` does not exist.

- [ ] **Step 3: Implement allowlisted normalization and update the PDF renderer**

Implement exact dropdown-safe mappings:

```js
window.UCVM_AFC_FORM_VALUES = (() => {
  const clean = value => String(value || '').trim().replace(/[‐‑‒–—]/g, '-');
  const key = value => clean(value).toLowerCase();
  const ranks = new Map([
    ['assistant professor', 'Assistant Professor - AC0003'],
    ['assistant professor (teaching)', 'Assistant Professor (Teaching) - AC0004'],
    ['associate professor', 'Associate Professor - AC0002'],
    ['associate professor (teaching)', 'Associate Professor (Teaching) - AC0007'],
    ['professor', 'Professor - AC0001'],
    ['professor (teaching)', 'Professor (Teaching) - AC0008']
  ]);
  const appointments = new Map([
    ['tenure', 'With Tenure'], ['with tenure', 'With Tenure'],
    ['tenure track', 'Tenure-track'], ['tenure-track', 'Tenure-track'],
    ['limited term', 'Limited Term'], ['contingent term', 'Contingent Term']
  ]);
  return {
    PRIMARY_DEPARTMENT: '30060 - Faculty of Veterinary Medicine',
    rank: value => ranks.get(key(value)) || '',
    appointment: value => appointments.get(key(value)) || '',
    contact: request => ({address:clean(request?.contactAddress), phone:clean(request?.contactPhone)})
  };
})();
```

In `afc-pdf-browser.js`, select mapped rank and appointment values, always select `PRIMARY_DEPARTMENT`, and write `AddressRow1` and `PhoneRow1`. Missing legacy contact fields must write blank strings.

- [ ] **Step 4: Run the focused and existing AFC tests**

Run: `node --test tests/afc-form-values.test.js tests/afc-ui.test.js tests/afc-policy.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit canonical PDF mapping**

```powershell
git add afc-form-values.js afc-pdf-browser.js tests/afc-form-values.test.js
git commit -m "Complete AFC PDF field mapping"
```

### Task 2: AFC contact data and Firestore compatibility

**Files:**
- Modify: `afc-workflow.js`
- Modify: `firestore.rules`
- Modify: `test-support/afc-policy.js`
- Modify: `tests/afc-policy.test.js`
- Modify: `tests/security-emulator.test.js`
- Modify: `tests/afc-ui.test.js`

**Interfaces:**
- Consumes: timetable page data and existing `afc_requests` documents.
- Produces: new requests with trimmed `contactAddress` and `contactPhone`; legacy documents remain valid for reads and approvals.

- [ ] **Step 1: Add failing UI, policy, and emulator tests**

Assert the form exposes both required fields and submission persists trimmed values. Add rule tests that accept valid strings, reject blank/address-over-500/phone-over-50 values, and approve a seeded legacy request without either field:

```js
assert.match(source, /name="contactAddress"[^>]*required[^>]*maxlength="500"/);
assert.match(source, /name="contactPhone"[^>]*required[^>]*maxlength="50"/);
await assertSucceeds(applicantDb.doc('afc_requests/new').set(validRequest));
await assertFails(applicantDb.doc('afc_requests/blank').set({...validRequest, contactPhone:' '}));
await assertSucceeds(adminDb.doc('afc_requests/legacy').update(approvalPatch));
```

- [ ] **Step 2: Confirm the tests fail for absent contact validation**

Run: `node --test tests/afc-ui.test.js tests/afc-policy.test.js`

Run: `npm run test:emulator -- --test-name-pattern="AFC contact|legacy AFC"`

Expected: focused tests FAIL on missing fields/rule predicates.

- [ ] **Step 3: Add form fields, submission checks, and create-only rule predicates**

Add address and phone controls to `formHtml()`. In `submit(form)`, trim them, throw readable errors for missing or oversized values, and add them to the request document. Update `afcCreate()` and its mirror in `test-support/afc-policy.js` with:

```rules
request.resource.data.contactAddress is string &&
request.resource.data.contactAddress.size() > 0 &&
request.resource.data.contactAddress.size() <= 500 &&
request.resource.data.contactPhone is string &&
request.resource.data.contactPhone.size() > 0 &&
request.resource.data.contactPhone.size() <= 50
```

Do not add those checks to `afcRecommend()`, `afcReject()`, or `afcApprove()`.

- [ ] **Step 4: Run AFC tests and the full emulator suite**

Run: `node --test tests/afc-ui.test.js tests/afc-policy.test.js`

Run: `npm run test:emulator`

Expected: all tests PASS.

- [ ] **Step 5: Commit contact collection and rules**

```powershell
git add afc-workflow.js firestore.rules test-support/afc-policy.js tests/afc-policy.test.js tests/security-emulator.test.js tests/afc-ui.test.js
git commit -m "Require AFC contact details"
```

### Task 3: Timetable AFC panel and vertical teaching list

**Files:**
- Create: `afc-timetable-panel.js`
- Modify: `index.html`
- Modify: `timetable.js`
- Modify: `afc-workflow.js`
- Modify: `timetable.css`
- Test: `tests/afc-timetable-integration.test.js`
- Modify: `tests/afc-ui.test.js`

**Interfaces:**
- Consumes: `window.UCVM_PAGE_DATA` methods `profile()`, `faculty()`, `sessions()`, `ensureSessionsForRange(start,end)`, and `subscribe(callback)`.
- Produces: `window.UCVM_AFC_TIMETABLE_PANEL` with `open()`, `close()`, and `isOpen()`; `window.UCVM_AFC.mount({panelId, mode})` mounts without adding a duplicate session listener.

- [ ] **Step 1: Add failing integration tests**

Assert timetable markup has `my-teaching-btn`, `afc-request-btn`, `my-change-history-btn`, and `afc-panel`, loads the three AFC scripts in dependency order, and exposes a single page-data subscription. Assert assignment HTML is a list rather than one joined sentence:

```js
assert.match(html, /id="afc-request-btn"/);
assert.match(html, /id="afc-panel"/);
assert.ok(html.indexOf('afc-form-values.js') < html.indexOf('afc-pdf-browser.js'));
assert.match(source, /class="afc-teaching-list"/);
assert.doesNotMatch(source, /teaching assignment\(s\) found:.*join/);
```

- [ ] **Step 2: Run the integration tests and confirm failure**

Run: `node --test tests/afc-timetable-integration.test.js tests/afc-ui.test.js`

Expected: FAIL because timetable AFC controls and adapter are absent.

- [ ] **Step 3: Implement the page-data adapter and panel shell**

Extend `UCVM_PAGE_DATA` so AFC requests a date range through the timetable's existing session subscription/cache. Mount an accessible dialog-style panel from `afc-timetable-panel.js`; wire My Teaching to restore the current faculty Day/List scope and wire My Change History to the existing self-filtered history view. Refactor AFC initialization to accept its mount target and render teaching rows as:

```html
<ul class="afc-teaching-list">
  <li><time>2026-10-07</time><span>08:30-09:30</span><strong>VETM 204</strong><span>Passports 1</span></li>
</ul>
```

Use one row per matched session, sorted by date, start time, course, and topic. Keep coverage required when the list is non-empty.

- [ ] **Step 4: Run integration and runtime asset tests**

Run: `node --test tests/afc-timetable-integration.test.js tests/afc-ui.test.js tests/runtime-assets.test.js tests/targeted-reads.test.js`

Expected: all tests PASS and the listener-count fixture reports no second session subscription.

- [ ] **Step 5: Commit timetable AFC integration**

```powershell
git add afc-timetable-panel.js index.html timetable.js afc-workflow.js timetable.css tests/afc-timetable-integration.test.js tests/afc-ui.test.js
git commit -m "Integrate AFC requests into timetable"
```

### Task 4: Rename the administrative directory and remove the legacy page

**Files:**
- Modify: `faculty-admin.html`
- Modify: `faculty-admin.js`
- Modify: `index.html`
- Modify: `timetable.js`
- Delete: `faculty-dashboard.html`
- Delete: `faculty-dashboard.js`
- Modify: `firebase.json`
- Modify: `tools/deploy_azure_static_web.ps1`
- Modify: `tools/static-assets.json`
- Modify: `tests/hosting-boundary.test.js`
- Modify: `tests/page-modules.test.js`
- Modify: `tests/runtime-assets.test.js`
- Modify: `tests/afc-ui.test.js`

**Interfaces:**
- Consumes: existing administrative tabs and role guards from `faculty-admin.html/js`.
- Produces: one visible `Faculty Dashboard` name and legacy `/faculty-dashboard.html` redirects to `/index.html` on Firebase and Azure.

- [ ] **Step 1: Replace old page-presence tests with failing removal and redirect tests**

Assert both old files are absent from disk and manifest, all runtime references are gone, administrative tabs remain, and configuration contains exact redirects:

```js
assert.equal(fs.existsSync(path.join(root, 'faculty-dashboard.html')), false);
assert.equal(fs.existsSync(path.join(root, 'faculty-dashboard.js')), false);
assert.doesNotMatch(allRuntimeText, /href=["']faculty-dashboard\.html/);
assert.match(firebaseJson, /"source"\s*:\s*"\/faculty-dashboard\.html"/);
assert.match(firebaseJson, /"destination"\s*:\s*"\/index\.html"/);
```

- [ ] **Step 2: Run hosting and page tests and confirm failure**

Run: `node --test tests/hosting-boundary.test.js tests/page-modules.test.js tests/runtime-assets.test.js tests/afc-ui.test.js`

Expected: FAIL while the legacy files and labels still exist.

- [ ] **Step 3: Move remaining self-service entry points and delete legacy assets**

Change the admin page title, gate title, brand title, and H1 to `Faculty Dashboard`; retain Lookup, Teaching Summary, Roles & Appointments, Sessional / Other, Faculty Database, Change History, AFC Requests, User Management, and Change password according to current role checks. Route the timetable dashboard button only to `faculty-admin.html` for authorized administrators. Delete the two legacy files and remove them from `tools/static-assets.json`.

Add Firebase Hosting redirect configuration and generate Azure `staticwebapp.config.json` with:

```json
{"route":"/faculty-dashboard.html","redirect":"/index.html","statusCode":301}
```

- [ ] **Step 4: Run page, boundary, and static build tests**

Run: `node --test tests/hosting-boundary.test.js tests/page-modules.test.js tests/runtime-assets.test.js tests/afc-ui.test.js`

Run: `node tools/build-static.js`

Expected: tests PASS; build reports exactly 28 allowlisted files and contains no legacy page source.

- [ ] **Step 5: Commit page consolidation**

```powershell
git add -A faculty-admin.html faculty-admin.js index.html timetable.js faculty-dashboard.html faculty-dashboard.js firebase.json tools/deploy_azure_static_web.ps1 tools/static-assets.json tests
git commit -m "Consolidate faculty pages"
```

### Task 5: Remove the timetable UI editor

**Files:**
- Modify: `index.html`
- Modify: `timetable.js`
- Modify: `timetable.css`
- Test: `tests/timetable-ui-editor-removal.test.js`

**Interfaces:**
- Consumes: fixed CSS layout defaults already present in `timetable.css`.
- Produces: timetable runtime with no UI editor controls, handlers, style rules, or persisted `ucvm-ui-*` keys.

- [ ] **Step 1: Write a failing absence test**

Scan the three runtime files and assert absence of `ui-edit-mode-btn`, `ui-editor-panel`, `bindUIEditorControls`, `data-ui-editable`, editor CSS selectors, and UI-layout storage keys while retaining session edit functions:

```js
for (const token of ['ui-editor-panel','ui-edit-mode-btn','bindUIEditorControls','data-ui-editable']) {
  assert.doesNotMatch(runtime, new RegExp(token));
}
assert.match(js, /openSessionForm/);
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --test tests/timetable-ui-editor-removal.test.js`

Expected: FAIL on existing editor markup and functions.

- [ ] **Step 3: Remove the complete editor feature**

Remove the Edit UI button, `<aside id="ui-editor-panel">`, editable data attributes, editor state/constants/functions/bindings, editor-only CSS, and its local-storage reads/writes. Preserve the static labels and current timetable session editor.

- [ ] **Step 4: Run editor, timetable, and asset tests**

Run: `node --test tests/timetable-ui-editor-removal.test.js tests/timetable-views-export.test.js tests/page-modules.test.js tests/runtime-assets.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit UI editor removal**

```powershell
git add index.html timetable.js timetable.css tests/timetable-ui-editor-removal.test.js
git commit -m "Remove timetable UI editor"
```

### Task 6: Responsive Schedule filters

**Files:**
- Modify: `index.html`
- Modify: `timetable.js`
- Modify: `timetable.css`
- Test: `tests/timetable-responsive-filters.test.js`

**Interfaces:**
- Consumes: existing Year, Semester, Week controls and `sessionStorage`.
- Produces: `setScheduleFiltersExpanded(expanded, persist)` and `initializeScheduleFilters(matchMedia)` with accurate `aria-expanded` and one tab-scoped preference key `ucvm-schedule-filters-expanded`.

- [ ] **Step 1: Add failing state and markup tests**

Assert the toggle is always available, controls one `schedule-filter-panel`, has `aria-controls` and `aria-expanded`, and the media breakpoint is exactly 900px. Exercise pure state with a mocked session store:

```js
assert.match(html, /id="schedule-filter-toggle"[^>]*aria-controls="schedule-filter-panel"/);
assert.match(css, /@media\s*\(max-width:\s*900px\)/);
assert.equal(state.initialExpanded({matches:true}, null), false);
assert.equal(state.initialExpanded({matches:false}, null), true);
assert.equal(state.initialExpanded({matches:true}, 'true'), true);
```

- [ ] **Step 2: Run the responsive filter test and confirm failure**

Run: `node --test tests/timetable-responsive-filters.test.js`

Expected: FAIL because the unified schedule filter state does not exist.

- [ ] **Step 3: Implement one collapsible control**

Wrap only Year/Semester/Week in `#schedule-filter-panel`; leave search/month/course/type/CCC/reset visible. Replace `filter-toggle-btn` competing behavior with `#schedule-filter-toggle`, update the chevron and hidden state together, persist explicit user changes in session storage, and use `window.matchMedia('(max-width: 900px)')` only for the initial default.

- [ ] **Step 4: Run responsive and view tests**

Run: `node --test tests/timetable-responsive-filters.test.js tests/timetable-views-export.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit responsive filters**

```powershell
git add index.html timetable.js timetable.css tests/timetable-responsive-filters.test.js
git commit -m "Make schedule filters responsive"
```

### Task 7: Pure multi-session selection and change planning

**Files:**
- Create: `timetable-selection.js`
- Test: `tests/timetable-selection.test.js`

**Interfaces:**
- Consumes: session records, editable row values, faculty lookup, actor profile, and `firebase.firestore.FieldValue.serverTimestamp()` supplied by the caller.
- Produces: `window.UCVM_TIMETABLE_SELECTION` with `create(max=200)`, `validateRow(row, rowNumber, facultyById)`, and `planChanges(originals, rows, actor, timestamp): {updates, logs, errors}`.

- [ ] **Step 1: Write failing pure behavior tests**

Cover add/toggle/clear/persistence by ID, the 200-selection limit, row-specific validation, unchanged-row suppression, assignment/faculty ID derivation, and paired update/log output:

```js
const selection = api.create(200);
for (let i=1;i<=200;i++) assert.equal(selection.toggle(`s${i}`), true);
assert.throws(() => selection.toggle('s201'), /200/);
const plan = api.planChanges([original], [edited], actor, timestamp);
assert.equal(plan.errors.length, 0);
assert.equal(plan.updates.length, 1);
assert.equal(plan.logs.length, 1);
assert.equal(plan.logs[0].sessionId, original.id);
assert.equal(api.planChanges([original], [original], actor, timestamp).updates.length, 0);
```

- [ ] **Step 2: Run the pure test and confirm failure**

Run: `node --test tests/timetable-selection.test.js`

Expected: FAIL because `timetable-selection.js` does not exist.

- [ ] **Step 3: Implement selection and deterministic change planning**

Implement validation for ISO date, academic year 1-4, non-empty course/type, valid `HH:MM` start/end with end after start, optional topic/room, and at least one resolvable faculty assignment. Deep-compare only editable fields and return no update/log for unchanged rows. Build log documents with `sessionId`, `action:'batch_update'`, `changedBy`, `changedByEmail`, `changedByName`, `changedAt`, and before/after field values.

- [ ] **Step 4: Run pure selection tests**

Run: `node --test tests/timetable-selection.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit the selection domain module**

```powershell
git add timetable-selection.js tests/timetable-selection.test.js
git commit -m "Add multi-session change planner"
```

### Task 8: Multi-session selection UI and atomic save

**Files:**
- Modify: `index.html`
- Modify: `timetable.js`
- Modify: `timetable.css`
- Modify: `index-maintenance.js`
- Modify: `firestore.rules`
- Modify: `tests/timetable-selection.test.js`
- Modify: `tests/security-emulator.test.js`
- Test: `tests/timetable-multi-edit-ui.test.js`

**Interfaces:**
- Consumes: `UCVM_TIMETABLE_SELECTION`, `firestoreSafeSession()`, `refreshDerivedIndexes()`, and the current admin role predicate.
- Produces: Select Sessions / Cancel / Review selected / Save selected changes workflow and one atomic batch of `2 * changedSessionCount` writes.

- [ ] **Step 1: Add failing markup, behavior, batch-shape, and rule tests**

Assert non-editors cannot see selection controls, selected IDs survive Day/Week/Month/List render changes, Review selected is disabled at zero, selected-only List contains every selected ID even outside normal filters, a validation error performs zero batch writes, 200 changed rows produce exactly 400 operations, and each update has a paired log. Emulator tests must reject session changes without the actor marker or allowed admin role.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test tests/timetable-selection.test.js tests/timetable-multi-edit-ui.test.js`

Run: `npm run test:emulator -- --test-name-pattern="multi-session"`

Expected: FAIL because selection UI and atomic save are absent.

- [ ] **Step 3: Render selection controls in every view**

Show `Select Sessions` only when `canEdit()` is true. In selection mode, make calendar blocks and List rows toggle IDs, show the count, preserve IDs across rerenders, let Cancel clear them, and make Review selected switch to List with a selected-only data source. Prevent CCC pseudo-sessions from selection because they have no writable Firestore document.

- [ ] **Step 4: Build spreadsheet-style rows and atomic persistence**

Render inputs for date, year, course, type, start, end, topic, room, and assigned faculty. Call `planChanges`; display every `Row N: message` error before creating a batch. For valid changes:

```js
const batch = db.batch();
for (const update of plan.updates) batch.update(db.doc(`sessions/${update.id}`), update.data);
for (const log of plan.logs) batch.set(db.collection('session_change_log').doc(), log);
await batch.commit();
invalidateAllSessions();
await refreshDerivedIndexes();
```

Keep selection and edited values on failure; clear them only after the commit and derived-index refresh succeed. Update rules only as needed to preserve the existing actor/audit marker contract.

- [ ] **Step 5: Run selection, timetable, maintenance, and emulator tests**

Run: `node --test tests/timetable-selection.test.js tests/timetable-multi-edit-ui.test.js tests/index-maintenance.test.js tests/timetable-views-export.test.js tests/swap-calendar-highlight.test.js`

Run: `npm run test:emulator`

Expected: all tests PASS.

- [ ] **Step 6: Commit audited multi-session editing**

```powershell
git add index.html timetable.js timetable.css index-maintenance.js firestore.rules timetable-selection.js tests
git commit -m "Add audited multi-session editing"
```

### Task 9: Copy, assets, and complete regression verification

**Files:**
- Modify: `SETUP.md`
- Modify: `PERFORMANCE_REPORT.md`
- Modify: `tools/static-assets.json`
- Modify: `tests/runtime-assets.test.js`
- Modify: `tests/page-modules.test.js`

**Interfaces:**
- Consumes: the completed page/module graph.
- Produces: a 28-file allowlist, accurate navigation/help copy, and a clean static build.

- [ ] **Step 1: Add failing final asset/copy assertions**

Assert the manifest length is 28; it includes `afc-form-values.js`, `afc-timetable-panel.js`, and `timetable-selection.js`; it excludes both deleted legacy files; all referenced local scripts/styles/assets are allowlisted; and old phrases such as `Faculty Directory`, `Faculty Admin Dashboard`, and `Open Faculty Dashboard` are absent from visible runtime copy.

- [ ] **Step 2: Run the asset tests and confirm remaining failures**

Run: `node --test tests/runtime-assets.test.js tests/page-modules.test.js tests/hosting-boundary.test.js`

Expected: FAIL only on any stale manifest or copy references found by the scan.

- [ ] **Step 3: Reconcile documentation, runtime copy, and manifest**

Update synchronization guidance to `Faculty Dashboard > Teaching Summary`, document AFC contact fields and the 200-session batch boundary, and make the manifest exactly match the production dependency graph.

- [ ] **Step 4: Run the full local and emulator verification**

Run: `npm test`

Run: `npm run test:emulator`

Run: `node tools/build-static.js`

Run: `git diff --check`

Expected: all local and emulator tests PASS, static build reports 28 files, and `git diff --check` prints no errors.

- [ ] **Step 5: Commit final asset and documentation reconciliation**

```powershell
git add SETUP.md PERFORMANCE_REPORT.md tools/static-assets.json tests
git commit -m "Finalize consolidated timetable assets"
```

### Task 10: Deploy and perform non-mutating production QA

**Files:**
- Verify: `.deploy-static/*`
- Verify: Firebase Hosting `https://tester-teaching.web.app`
- Verify: Azure Static Web Apps `https://red-cliff-04871ca0f.5.azurestaticapps.net`

**Interfaces:**
- Consumes: the verified 28-file `.deploy-static` output and authenticated Chrome sessions.
- Produces: matching Firebase/Azure production assets and QA evidence without AFC submission or timetable mutation.

- [ ] **Step 1: Record local deployment hashes**

Run:

```powershell
Get-ChildItem .deploy-static -File -Recurse | Sort-Object FullName | ForEach-Object {
  [PSCustomObject]@{Path=$_.FullName.Substring((Resolve-Path .deploy-static).Path.Length + 1); SHA256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash}
} | ConvertTo-Json | Set-Content .deploy-static-hashes.json
```

Expected: 28 application files plus generated Azure routing configuration when it is emitted outside the allowlist count.

- [ ] **Step 2: Deploy the tested build to Firebase and Azure**

Run: `firebase deploy --only hosting,firestore:rules,firestore:indexes --project tester-teaching`

Run: `powershell -ExecutionPolicy Bypass -File tools/deploy_azure_static_web.ps1`

Expected: both commands return successful deployment URLs.

- [ ] **Step 3: Compare production asset bodies with local hashes**

Download each public allowlisted asset from both hosts with cache-busting query strings, hash the raw bytes, and compare them to `.deploy-static-hashes.json`. Verify `/faculty-dashboard.html` returns a redirect/final navigation to `/index.html`, and development paths such as `/tests/`, `/tools/`, `/.git/`, and `/firestore.rules` remain unavailable.

- [ ] **Step 4: Perform authenticated Chrome QA without writes**

On both hosts verify: faculty lands on own Day view; AFC Request opens and lists assignments vertically; address/phone controls are present; Faculty Dashboard uses the new name and retains authorized tabs; Schedule filters expand/collapse and remain usable at a width below 900px; Select Sessions can enter, select, review, and cancel without saving; ADFA approval queue still loads. Do not submit the form and do not click Save selected changes.

- [ ] **Step 5: Remove transient hash evidence and commit any verification-only correction**

Run: `Remove-Item -LiteralPath .deploy-static-hashes.json -ErrorAction SilentlyContinue`

If QA required a code correction, repeat Tasks 9 Step 4 and 10 Steps 1-4 before committing the exact corrected files. If no correction was required, leave the working tree clean.

