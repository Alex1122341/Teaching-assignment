# Runtime Read and Code Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every current workflow while replacing routine full-collection reads and post-save audit scans with scoped queries and direct, incremental writes.

**Architecture:** Pure helpers in `audit-details.js` and `index-maintenance.js` calculate audit and derived-index changes. Timetable and Faculty Dashboard call explicit faculty/session loaders, while approval and export flows request data only when the user opens the relevant feature.

**Tech Stack:** Static HTML/CSS/JavaScript, Firebase 9 compat SDK, Cloud Firestore, Node built-in test runner, Firebase Auth/Firestore emulators, Firebase Hosting.

**Spec:** `docs/superpowers/specs/2026-09-15-runtime-read-and-code-simplification-design.md`

## Global Constraints

- Preserve all current UI, role checks, AFC, approval, signature, timetable, export, and account behavior.
- Do not expose Faculty HR fields or AFC reasons through a broadly readable index.
- Keep complete exports and full source synchronization complete.
- Treat physical line count as secondary to runtime bytes, explicit data flow, and database reads.
- Every Firestore mutation retains an audit entry with the current actor and concrete before/after values.

---

### Task 1: Direct audit details

**Files:**
- Modify: `audit-details.js`
- Modify: `timetable.js`
- Modify: `faculty-admin.js`
- Modify: `faculty-access.js`
- Test: `tests/audit-details.test.js`
- Test: `tests/read-efficiency.test.js`

**Interfaces:**
- Produces: `UCVM_AUDIT_DETAILS.diff(before, after, kind)` returning `{field,label,before,after}[]`.
- Consumes: existing session and faculty records plus the original save/delete batches.

- [ ] **Step 1: Write failing audit and read-boundary tests**

```js
assert.deepEqual(audit.diff(before, after, 'session'), [
  {field:'topic', label:'Topic', before:'Old', after:'New'}
]);
assert.doesNotMatch(read('faculty-access.js'), /patchRecent|MutationObserver|limit\(20\)/);
assert.match(read('timetable.js'), /changes:UCVM_AUDIT_DETAILS\.diff/);
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `node --test tests/audit-details.test.js tests/read-efficiency.test.js`

- [ ] **Step 3: Implement direct audit calculation**

Add a pure record comparator to `audit-details.js`. Include its output in the original session and faculty audit batch. Delete the form observer, delayed polling, actor profile re-read, recent-log query, and follow-up update from `faculty-access.js`.

- [ ] **Step 4: Run focused tests and confirm they pass**

Run: `node --test tests/audit-details.test.js tests/read-efficiency.test.js`

- [ ] **Step 5: Commit**

```bash
git add audit-details.js timetable.js faculty-admin.js faculty-access.js tests/audit-details.test.js tests/read-efficiency.test.js
git commit -m "Write audit details in original mutations"
```

### Task 2: Incremental derived indexes

**Files:**
- Modify: `index-maintenance.js`
- Modify: `timetable.js`
- Modify: `timetable-selection.js`
- Test: `tests/index-maintenance.test.js`
- Test: `tests/timetable-selection.test.js`

**Interfaces:**
- Produces: `applySessionChanges(facultyIndex, scheduleStats, changes)` and `updateDerivedIndexes(db, changes, actor)`.
- Consumes: changes shaped as `{before: Session|null, after: Session|null}`.

- [ ] **Step 1: Write failing delta tests**

```js
const updated=index.applySessionChanges(facultyIndex,stats,[{before:null,after:session}]);
assert.equal(updated.scheduleStats.sessionCount,stats.sessionCount+1);
assert.equal(updated.facultyIndex.entries[0].sessionCount,1);
assert.equal(updated.facultyIndex.entries[0].assignedTeachingDOE,12.5);
```

Cover create, edit, delete, course change, faculty replacement, multiple assignments, idempotent empty change, and assigned-faculty count.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test tests/index-maintenance.test.js`

- [ ] **Step 3: Implement conflict-safe incremental updates**

Use a Firestore transaction to read `settings/faculty_index` and `settings/schedule_stats`, apply exact session deltas, and write updated documents with actor metadata. Replace post-save calls that rebuild from complete collections. Pass the committed plan's before/after values from single, batch, swap, create, and delete paths.

- [ ] **Step 4: Run focused index and selection tests**

Run: `node --test tests/index-maintenance.test.js tests/timetable-selection.test.js tests/timetable-bulk-outlook.test.js`

- [ ] **Step 5: Commit**

```bash
git add index-maintenance.js timetable.js timetable-selection.js tests/index-maintenance.test.js tests/timetable-selection.test.js
git commit -m "Maintain timetable indexes incrementally"
```

### Task 3: Scoped timetable and export queries

**Files:**
- Modify: `timetable.js`
- Test: `tests/targeted-reads.test.js`
- Test: `tests/timetable-features.test.js`
- Test: `tests/timetable-bulk-outlook.test.js`

**Interfaces:**
- Produces: `ensureSessionsForDates(dates)` and range-aware export loading.
- Consumes: current visible-range cache and Firestore `date in [...]` queries in chunks of at most 30.

- [ ] **Step 1: Write failing source-boundary tests**

```js
assert.match(source, /where\('date','in',dateChunk\)/);
assert.doesNotMatch(selectionBody, /ensureAllSessions\(\)/);
assert.match(exportBody, /scope==='all'.*ensureAllSessions/);
assert.match(exportBody, /ensureSessionsForRange/);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/targeted-reads.test.js tests/timetable-features.test.js tests/timetable-bulk-outlook.test.js`

- [ ] **Step 3: Implement exact-date cache loading**

Track covered exact dates separately from covered continuous ranges. Query uncached dates in groups of 30, merge results into `sessionCache`, and block save validation on query failure. Remove complete-session reads from selection, swap, ordinary edit, and bulk-create setup. Load edited/bulk dates immediately before availability validation.

- [ ] **Step 4: Make export scope choose its loader**

Date and academic selections call `ensureSessionsForRange`; only `all` calls `ensureAllSessions`. Keep complete Outlook package behavior and CCC filtering.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/targeted-reads.test.js tests/timetable-features.test.js tests/timetable-bulk-outlook.test.js`

```bash
git add timetable.js tests/targeted-reads.test.js tests/timetable-features.test.js tests/timetable-bulk-outlook.test.js
git commit -m "Scope timetable reads to requested dates"
```

### Task 4: Split Faculty Dashboard datasets

**Files:**
- Modify: `faculty-admin.js`
- Modify: `faculty-admin-enhancements.js`
- Test: `tests/targeted-reads.test.js`
- Test: `tests/page-modules.test.js`

**Interfaces:**
- Produces: `ensureFullFaculty()` and `ensureFullSessions()` with independent caches.
- Consumes: tab requirements and explicit import/export requirements.

- [ ] **Step 1: Write a failing loader-boundary test**

```js
assert.match(source, /function ensureFullFaculty/);
assert.match(source, /function ensureFullSessions/);
assert.doesNotMatch(rolesTabBody, /ensureFullSessions/);
assert.doesNotMatch(databaseTabBody, /ensureFullSessions/);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/targeted-reads.test.js tests/page-modules.test.js`

- [ ] **Step 3: Split the loaders and route each tab/action**

Roles and Faculty Database load faculty only. Teaching Summary and operations that calculate across sessions request sessions explicitly. Full imports and complete exports request both. Keep lookup on the existing index/detail/session-per-faculty path.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test tests/targeted-reads.test.js tests/page-modules.test.js`

```bash
git add faculty-admin.js faculty-admin-enhancements.js tests/targeted-reads.test.js tests/page-modules.test.js
git commit -m "Split faculty and session admin loaders"
```

### Task 5: Lazy replacement directory and history pagination

**Files:**
- Modify: `approval-workflow.js`
- Modify: `faculty-access.js`
- Test: `tests/targeted-reads.test.js`
- Test: `tests/history-visibility.test.js`
- Test: `tests/approval-workflow.test.js`

**Interfaces:**
- Produces: cached `ensureReplacementPeople()` and 20-record history pages.
- Consumes: the shared timetable page cache and group/member IDs.

- [ ] **Step 1: Write failing lazy-load tests**

```js
assert.doesNotMatch(source, /collection\(SESSIONS\)\.onSnapshot/);
assert.doesNotMatch(initBody, /listenPeople\(\)/);
assert.match(source, /async function ensureReplacementPeople/);
assert.match(history, /limit\(20\)/);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/targeted-reads.test.js tests/history-visibility.test.js tests/approval-workflow.test.js`

- [ ] **Step 3: Implement lazy directory loading and remove the fallback**

Require `UCVM_PAGE_DATA` for production session synchronization. Load candidate profiles only when opening self/HICC replacement tools, cache them, and preserve request highlighting before the directory is loaded.

- [ ] **Step 4: Reduce history pages and preserve pagination**

Change each initial/subsequent collection request from 50 to 20 and keep independent cursors and exhaustion handling.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/targeted-reads.test.js tests/history-visibility.test.js tests/approval-workflow.test.js`

```bash
git add approval-workflow.js faculty-access.js tests/targeted-reads.test.js tests/history-visibility.test.js tests/approval-workflow.test.js
git commit -m "Load approval and history data on demand"
```

### Task 6: Shared helpers, full verification, and measured report

**Files:**
- Modify: `faculty-access.js`
- Modify: `timetable.js`
- Modify: `approval-workflow.js`
- Modify: `faculty-admin-enhancements.js`
- Modify: `PERFORMANCE_REPORT.md`
- Modify: tests as required by verified dependency changes

**Interfaces:**
- Consumes: `UCVM.esc`, `UCVM.number`, and existing normalization helpers where semantics match.
- Produces: updated measured baseline and no new runtime dependency.

- [ ] **Step 1: Replace only behavior-identical local helpers**

Alias existing shared helpers and remove duplicates. Keep business-specific name matching and date parsing local when their rules differ.

- [ ] **Step 2: Run static and emulator suites**

Run: `node --test tests/*.test.js`

Run: `node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only firestore,auth --project demo-ucvm-access "node --test tests/*.test.js"`

- [ ] **Step 3: Build and measure deployment assets**

Run: `node tools/build-static.js`

Record runtime file count, bytes, physical lines, full-collection call sites, and estimated reads for each scenario in `PERFORMANCE_REPORT.md`.

- [ ] **Step 4: Browser regression check**

Verify desktop and narrow layouts, Day/Week/Month/List switching, selection cancel/restore, single and batch editing, Change History pagination, Faculty Dashboard tabs, AFC queue, and date/all exports without console errors.

- [ ] **Step 5: Run final verification and commit**

```bash
git add PERFORMANCE_REPORT.md faculty-access.js timetable.js approval-workflow.js faculty-admin-enhancements.js tests
git commit -m "Finalize runtime read simplification"
```

- [ ] **Step 6: Push and deploy**

Push `performance-cleanup` to update PR #15, then deploy Firestore rules/indexes and the allowlisted Firebase Hosting build only after all checks pass.
