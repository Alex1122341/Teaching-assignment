# MASTER Assignment Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the approved 2026-27 MASTER source across appointments, rotation evidence, complete CCC scheduling and an authorized Trainees Dashboard tab, while preserving unapproved DOE differences.

**Architecture:** One trusted source adapter supplies separate appointment/engine, CCC and trainee operations. Existing SQL annual policies, role schedules, CalendarActivity, authorization and audit remain authoritative; each operation has its own preview, receipt and guarded recovery. These are coordinated source updates with shared identity and DOE safeguards, rather than a wholesale replacement of every table.

**Tech Stack:** Node.js 22, existing ExcelJS 4.4, vanilla JavaScript/HTML/CSS, Firebase Auth, University Node API, Azure SQL; node:test and existing SQL acceptance runners.

**Spec:** `docs/superpowers/specs/2026-10-18-master-assignment-refresh-design.md` — owner approved both design and this concrete plan on 2026-10-18, with native sequential implementation and final independent review.

## Global Constraints

- Source SHA256: `cb85141c7c80015332ebd908ddd6253f577fc39e658efa35b5422a8f8f1c0380`; academic year `2026-27`.
- Default appointment period is inclusive May 1 2026 through April 30 2027. An explicit day is preserved; a month-only start uses its first day and month-only end its last day.
- No browser arithmetic, automatic proration, automatic policy publication or broad recalculation.
- Mismatching values and missing source allocations are excluded from any credit write. A role removal that would change DOE is held as an explicit discrepancy.
- No real source workbook, private row evidence, student notes, faculty identifiers or recovery payload enters Git or the synthetic Pages/Firestore lab.
- The complete CCC source includes all 413 slots: 402 resolved faculty slots and 11 literal Locum placeholders. Never substitute the 402-row subset for complete replacement.
- Do not replay the completed 540-record AFC migration, change non-CCC activities or Course Calendar, or modify DOE as a side effect.
- Preserve existing role helpers, stale/version/expiry checks, zero versus null, scoped policy exceptions, audit/history, lazy/deferred boundaries and all existing gate values unless a separately reviewed release explicitly changes the relevant gate.
- Continue branch `feat/master-assignment-refresh-20261018` in the existing isolated Beta worktree, from main `d9a200a`; never commit feature work to main. Existing authorized University Windows identity is allowed; a new service account is not a prerequisite.

## Review Focus

1. Multiple C/D/E staffing cells on the same physical source row must survive normalization and retries as distinct slots — Tasks 1/5.
2. Month-only, split/restart and conflicting structured/narrative dates must retain gaps; appointment validity must not become an availability block — Tasks 1/2.
3. A source that changes during review, a phantom CCC insertion, or a later manual update must invalidate the approved preview/recovery — Tasks 2/5/6.
4. Exact repository GUID casing and existing source-specific exceptions must survive engine comparison; preserving a visible value alone must not hide a changed rule/override — Task 3.
5. Pagination, export, back navigation and sign-out must not expose another faculty's counts, DOE or notes, or lose a selected academic year — Tasks 6/7.

## Execution structure and shared contracts

Implement Tasks 1–3 (source/appointments/engine), 4–5 (CCC), 6–7 (Trainees), then 8 (integration/release). Recommended preserved method: native sequential implementation in this session, followed by a fresh independent whole-branch review. Use separate product commits and a later separate freeze-promotion commit. A task may be reviewed or rejected independently; do not enable a later live data operation because an earlier code task passed.

Shared types are documented by JSDoc in `server/src/master-refresh/master-source-domain.js`:

- `SourceRef = {sha256, sheet, row, column}`; `Period = {startDate, endDate}` using ISO dates.
- `MasterSource = {schemaVersion:1, academicYear, sourceSha256, appointments, roleDefinitions, rotations, cccSlots, cccAllocations, trainees, issues, manifestSha256}`.
- `AppointmentSource = {sourceRef, facultyId:null|string, sourceName, roleType, scope, sourceDoe:null|number, periods:Period[], periodBasis, facts, privateNotes}`. Canonical SQL IDs are kept unchanged; a separate normalized key may be used for matching only.
- `CccSlot = {slotKey, sourceRef, facultyId:null|string, staffingKind:'assigned'|'unassigned', staffingLabel:null|'Locum', startDate, endDate, blockLabel, privateNotes, closureText}`. `slotKey` binds sheet/physical-row/column. An assigned slot has a real active faculty ID; an unassigned slot has null faculty and literal Locum.
- `CccAllocation = {sourceRef,facultyId,sourceName,shifts,halfDays:null|number,halfDayDeduction,sourceDoe:null|number,periods:Period[]}` comes from CCC columns N/Q/S/T/U. These 22 annual role allocations are distinct from the 413 dated staffing slots; their validity receives the same default/explicit-date rules as HICC/VISC, without creating year-long Calendar conflicts.
- `TraineeSource = {sourceRef, facultyId:null|string, sourceName, rawCounts:(null|number)[7], categoryDoe:(null|number)[7], sourceDoe:null|number, sourceTotal:null|number, privateNotes, identityStatus}`. Category order: Undergrad, VETM 506, fourth-year preceptor, IM, graduate primary, graduate co-supervisor, postdoc.
- `RefreshPreview = {batchId, domain, academicYear, sourceSha256, manifestSha256, expectedVersion, expiresAtUtc, beforeHash, operations, heldIssues, doeGuardHash}`. `domain` is exactly `appointments` or `trainees`; CCC uses its existing separately gated replacement workflow.

New SQL migration numbers below reserve 052–054. If main gains another migration before implementation, renumber new files and every runner/reference together; never reuse an occupied migration number. Do not edit or rerun historical migration files as the upgrade mechanism.

### Task 1: Trusted MASTER parser and deterministic reconciliation

**Files:** Create `server/src/master-refresh/master-source-domain.js`, `tools/master-refresh/source-workbook.cjs`, `tools/master-refresh/prepare-master-refresh.cjs`; tests `server/test/master-source-domain.test.js`, `tests/master-source-workbook.test.js`, synthetic fixture `server/test/fixtures/master-refresh-workbook.cjs`.

**Interfaces:** `readMasterSource(bytes:Buffer, {academicYear, expectedSourceSha256, faculty, roles, aliases}): Promise<MasterSource>`; pure `normalizeAppointmentPeriods({startCell,endCell,roleDateNotes,academicYear}): {periods,issues}` and `reconcileMasterSource(source, snapshot): {operations,heldIssues}`. CLI `prepare-master-refresh.cjs --source <private.xlsx> --snapshot <private.json> --year 2026-27 --expected-sha256 <hash> --output <private-directory>` writes private local evidence only.

- [ ] Write failing tests: preserve three distinct source slots from C/D/E on one row; reject wrong source hash, duplicate aliases and missing required sheet/header; recognize 34-sheet workbook without using summary sheets as extra feeds. Exclude header/guide/footer rows and trailing formatted rows.
- [ ] Add date assertions: `May 2026 → 2026-05-01`; `Ends Feb 2027 → 2027-02-28`; `Ends Aug 2026; Restarts Mar 2027 → [2026-05-01..2026-08-31, 2027-03-01..2027-04-30]`; explicit structured dates win unless contradictory, which yields a held issue. Generic leave notes do not alter role validity. TBD/roughly/proposed/canceled rotation dates remain unconfirmed, not executable Calendar dates.

```js
test('separate source staffing cells and exclude the guide row', async () => {
  const source = await readMasterSource(syntheticMaster, fixtureContext);
  assert.equal(new Set(source.cccSlots.map(r => r.slotKey)).size, 3);
  assert.equal(source.trainees[0].rawCounts[2], 53);
});
```
- [ ] Run `node --test server/test/master-source-domain.test.js tests/master-source-workbook.test.js`; verify meaningful RED for absent functions/behavior.
- [ ] Implement using the existing pinned ExcelJS reader and pure domain functions. Preserve formula text and cached values separately; never execute workbook formulas/macros/external links. Validate finite nonnegative quantities; retain missing versus zero. Extract CCC allocation totals and half-day deductions separately from dated slots. Exact matching uses approved current names/aliases and activity status, never fuzzy names or line-number guesses. Archive exclusions stay excluded. Original source is never saved by the parser.
- [ ] Run the same tests to GREEN and execute the prepare CLI read-only against the private source. Reconcile source findings: 70 named HICC/VISC assignments, 38 participants, 12 coordinators, 413 CCC slots, 113 trainee source rows; quantities 72/7/53/27/116/17/41 and total333. Treat changed findings as a source-review issue, not an instruction to hard-code these totals for all future files.
- [ ] Commit source/parser/tests only: `feat: prepare source-bound MASTER refresh previews`.

### Task 2: Appointment metadata, definitions and effective periods with guarded recovery

**Files:** Create `database/azure-sql/052_master_source_refresh.sql`, matching `052_master_source_refresh_acceptance.sql`, `rollback_052_master_source_refresh.sql`, `server/src/data/sql-master-refresh-repository.js`, `server/src/master-refresh/master-refresh-service.js`, `tools/master-refresh/run-master-refresh.cjs`, `tools/test-master-refresh-sql.ps1`; tests `server/test/master-refresh-service.test.js`, `server/test/master-refresh-repository.test.js`, `server/test/master-refresh-schema.test.js`. Modify `server/src/data/sql-dashboard-repository.js`, `server/src/data/sql-doe-worksheet-repository.js` for explicit source allocation status.

**Interfaces:** repository `preview({domain,academicYear,source,actorFirebaseUid}) → RefreshPreview`; `apply({batchId,domain,expectedVersion,manifestSha256,sourceSha256,idempotencyKey,actorFirebaseUid,confirm}) → {receiptId,appliedCount,heldCount,idempotentReplay}`; trusted service same signatures plus injected repository/engine. `recover({receiptId,actorFirebaseUid,confirm})` is operator-only with exact after-state matching, never an HTTP route. CLI modes `Plan` (read-only), `Stage` (staging only), `Apply`, `Recover`; Apply requires explicit domain/version/hash/key/confirmation flags.

- [ ] Write RED service/schema tests: two-period appointment preserved, repeated source scope retains existing role ID, new source-missing DOE is null/Needs review, no broad delete of absent roles, unassigned definitions get no faculty credit, metadata update cannot change existing mapped/override DOE. An appointment annual range produces no CalendarActivity or AFC records.

```js
test('metadata refresh preserves allocation and unrelated entities', async () => {
  const receipt = await service.apply(metadataOnlyFixture);
  assert.equal(receipt.appliedCount, 1);
  assert.deepEqual(fakeDb.existingDoeValues(), beforeDoeValues);
  assert.equal(fakeDb.calendarWrites + fakeDb.afcWrites, 0);
});
```
- [ ] Run `node --test server/test/master-refresh-service.test.js server/test/master-refresh-repository.test.js server/test/master-refresh-schema.test.js` to meaningful RED.
- [ ] Implement `staging.MasterRefresh`, `paws.MasterRefreshReceipt`, `paws.MasterRoleSourceEvidence`, `paws.MasterRoleDefinition`. Bind source JSON/hash and old entity/schedule versions into preview; use stable role IDs, source-backed facts and existing RoleAppointmentSchedule semantics for HICC/VISC, the 22 annual CCC roles and annual rotation appointments. Store missing/held allocation status so dashboard and worksheet do not fill it with a generic calculated credit. Stage definitions for empty HICC/VISC positions rather than guessed appointments.
- [ ] Implement SQL procedures `PreviewMasterRefresh`, `CommitMasterRefresh`, `RecoverMasterRefresh` with an explicit domain allowlist, parameterized input, current administrator recheck, actor plus ORIGINAL_LOGIN audit, serializable transaction, version recheck, before/after receipt and idempotent identical retries. Dedicated execute-only operator role starts empty; do not broaden browser runtime write rights. At this task, only existing-allocation-preserving metadata and explicitly null-source new roles are executable; all new credit writes are denied. Task3 adds the engine guard before any matching new allocation can proceed. Missing/mismatching existing or removed-role allocations are held. Preserve unrelated years, RoleAssignment overrides and existing manual allocations.
- [ ] Run focused tests to GREEN, then `powershell -NoProfile -File tools/test-master-refresh-sql.ps1 -ContainerName paws-master-refresh-acceptance -Mode Appointments`. Synthetic SQL cases must prove stale identity/schedule edits, phantom matching rows, concurrent same-key requests, injected history failure rollback, guarded recovery refusal after later manual edits and unchanged existing DOE fingerprints. The runner must verify a disposable local Docker container/loopback endpoint and test marker before setup/reset, and reject the school host; checking database name alone is insufficient because existing synthetic tests also use the name VetMed-Ops.
- [ ] Commit: `feat: add guarded MASTER appointment refresh`.

### Task 3: Annual DOE engine candidate and no-unapproved-change guard

**Files:** Create `server/src/master-refresh/master-doe-reconciliation.js`; modify `master-refresh-service.js`, `run-master-refresh.cjs`, `server/src/doe/doe-recorded-source-impact.js`, `server/src/data/sql-doe-worksheet-repository.js`; tests `server/test/master-doe-reconciliation.test.js`, existing `server/test/doe-policy-engine-parity.test.js`, `server/test/doe-policy-service.test.js`.

**Interfaces:** `compareMasterDoe({source,currentRoles,supervision,activeBundle,candidateBundle,calculate}): Promise<{rows,matching,held,doeGuardHash}>`; each row has source reference, canonical identity, stored DOE, source DOE, active preview, candidate preview and `matched|held_mismatch|source_missing|held_removal|unresolved`. `prepareMasterPolicyCandidate({source,activeBundle,policyRepository,policyService,actorUid}): Promise<{policyVersionId,revision,validation,comparison}>` is an explicit trusted Draft operation, never called by Plan mode. Use the existing repository `clonePolicy({sourcePolicyVersionId,sourceAcademicYear,academicYear,actorUid,includeExceptions:true,reuseWorkingDraft:false})`, followed by service `saveDraft`/`validateDraft`. Do not use service `copyPreviousYear(mode:'clone')`, which excludes exceptions, or `mode:'working_draft'`, which may reuse a user's existing Draft.

- [ ] Write RED assertions: existing 2/source1 coordinator stays2 and is held; source-null/stored40 stays40; zero/negative override survives; canonical uppercase identity still matches existing scoped exceptions; literal VISC grouped area is not split; half-day CCC credit is shifts×0.5−deduction exactly once. New null-source allocation receives no generic rule credit. New candidate copies exceptions into fresh IDs and never edits/reuses an existing working Draft.

```js
test('source mismatch is held without a proposed credit overwrite', async () => {
  const result = await compareMasterDoe(coordinatorDifferenceFixture);
  assert.equal(result.held[0].status, 'held_mismatch');
  assert.equal(result.held[0].storedDoe, 2);
  assert.equal(result.held[0].sourceDoe, 1);
  assert.equal(result.matching.length, 0);
});
```
- [ ] Run `node --test server/test/master-doe-reconciliation.test.js server/test/doe-policy-engine-parity.test.js server/test/doe-policy-service.test.js` to meaningful RED.
- [ ] Implement the comparison using `createDoeCalculationService().previewWithPolicy({policyBundle,academicYear,facts})`, current exact repository IDs and current accepted exceptions. The new candidate changes source mappings/references/facts without silently replacing credit values; retained exceptions stay bound to the existing stable IDs. If only metadata changes, prove that explicitly rather than claiming a recalculation.
- [ ] Require the guard in appointment and trainee commit paths: compare exact stored values/overrides and projected applicable DOE before/after. Hold new source/engine mismatches and role removals, reject a changed guard snapshot at commit. Draft creation/save/validation is explicit and separately receipted; Active policy, existing Draft edits and calculation records remain unchanged. Publication/recalculation is outside this plan's automatic Apply.
- [ ] Run tests to GREEN; run the private source dry comparison. Expected baseline251 comparisons=243same+2numeric differences+6source-missing, plus separately reported new/unassigned/removal issues. Any new discrepancy blocks only that affected allocation; do not convert it into an exception to force agreement.
- [ ] Commit: `feat: reconcile MASTER evidence through annual DOE engine`.

### Task 4: Canonical Calendar support for unassigned CCC staffing

**Files:** Create `database/azure-sql/053_ccc_master_slots.sql`, `053_ccc_master_slots_acceptance.sql`, `rollback_053_ccc_master_slots.sql`; modify `server/src/data/sql-calendar-activity-repository.js`, `calendar-activities.js`, `server/src/data/sql-dashboard-repository.js`, relevant SQL list functions via the new migration; tests `server/test/ccc-master-slots.test.js`, `server/test/calendar-activity-repository.test.js`, `server/test/calendar-activity-swap.test.js`, `tests/calendar-activities.test.js`.

**Interfaces:** extend `publicActivity(row)` and activity DTO with `staffingKind:'assigned'|'unassigned'`, `staffingLabel:null|'Locum'`, `blockLabel:null|string`. Unassigned rows have null `facultyKey` and display Locum; raw faculty IDs, source availability reasons and private schedule notes remain excluded. Retain existing list pagination and cursor format.

- [ ] Write RED tests: null faculty accepted only for Category=ccc + unassigned + literal Locum; all other null-faculty categories rejected; assigned records require an active real faculty identity. Public calendar shows an authorized unassigned slot, personal faculty schedule excludes it, and SWAP availability never treats it as every faculty's conflict.

```js
test('unassigned CCC does not invent a faculty key', () => {
  const dto = publicActivity(unassignedLocumFixture);
  assert.equal(dto.staffingLabel, 'Locum');
  assert.equal(dto.facultyKey, null);
  assert.equal(Object.hasOwn(dto, 'facultyId'), false);
});
```
- [ ] Run `node --test server/test/ccc-master-slots.test.js server/test/calendar-activity-repository.test.js server/test/calendar-activity-swap.test.js tests/calendar-activities.test.js` to meaningful RED.
- [ ] Extend CalendarActivity narrowly: nullable FacultyId plus check constraints, staffing fields and source-column/block metadata. Audit every consumer with `rg -n 'CalendarActivity' database server/src`; update SQL joins that would drop null-faculty slots, faculty lock collection (exclude null), personal scope, history rendering, time-evidence commands and recovery. Existing assigned records backfill to assigned without business-data changes. Do not create a Locum Faculty/UserProfile/SwapCandidate.
- [ ] Extend DTO/rendering with escaped labels and existing category filters. Keep missing time as missing; no half-day slot timing inferred from annual totals. Unassigned history uses administrator calendar scope, with no invented affected faculty. No actor/raw private source evidence is added to public DTOs.
- [ ] Run focused GREEN tests and synthetic SQL acceptance through `powershell -NoProfile -File tools/test-master-refresh-sql.ps1 -ContainerName paws-master-refresh-acceptance -Mode CccSlots`; compare existing assigned rows and DOE before/after migration. Rollback refuses if unresolved CCC rows still exist, instead of deleting them or forcing FacultyId values.
- [ ] Commit: `feat: represent unassigned CCC staffing in Calendar`.

### Task 5: Complete trusted CCC import, atomic replacement and recovery

**Files:** modify `053_ccc_master_slots.sql`, its acceptance/recovery files, `server/src/data/sql-ccc-replacement-repository.js`, `tools/master-refresh/run-master-refresh.cjs`, `faculty-admin-ccc-replacement.js`, `server/src/calendar/ccc-replacement-api.js` (preview DTO only); create `tools/master-refresh/ccc-master-adapter.cjs`; tests `server/test/ccc-master-replacement.test.js`, existing `server/test/ccc-replacement-api.test.js`, `server/test/ccc-replacement-repository.test.js`, `tests/ccc-replacement-ui.test.js`; extend `tools/test-ccc-replacement-sql.ps1`, `tools/test-ccc-replacement-races.ps1`.

**Interfaces:** `toTrustedCccRows(source:MasterSource): {schemaVersion:2,academicYear,sourceSha256,rows,manifestSha256}`. Extend repository with `stageTrustedMaster({actorFirebaseUid,requestId,fileName,byteLength,parsed})`; SQL-only `StageMasterCccReplacement` validates schemaVersion2 and all normalized fields. Existing public six-column template/parser/stage remains v1 and size-bounded; no client-injected trusted JSON route. Existing `preview`, `commit`, receipt and recovery remain source/version/key bound for both formats.

- [ ] Write RED tests: three positions on one source row remain three records; normalization gives each staging row a unique ordinal while retaining original physical row/column and slotKey. Schema-v1 client requests cannot inject placeholder/actor fields or bypass file limits. Missing any of11 Locum slots fails complete-source validation.

```js
test('trusted adapter retains every slot from one physical row', () => {
  const result = toTrustedCccRows(threeColumnFixture);
  assert.equal(result.rows.length, 3);
  assert.equal(new Set(result.rows.map(r => r.sourceRow)).size, 3);
  assert.deepEqual(result.rows.map(r => r.sourceRef.column), ['C', 'D', 'E']);
});
```
- [ ] Run `node --test server/test/ccc-master-replacement.test.js server/test/ccc-replacement-api.test.js server/test/ccc-replacement-repository.test.js tests/ccc-replacement-ui.test.js` to meaningful RED.
- [ ] Extend snapshot/manifests to bind staffing fields, original source cells, full old rows and versions. Unassigned slots are validated separately from unresolved named faculty; a missing real name remains a blocker, not automatic Locum. Preserve private notes and closure text in protected source evidence; public preview only returns role-authorized fields. UI shows assigned/unassigned counts and all rows for a trusted staged batch.
- [ ] Extend full-year transaction, receipts, protected-reference detection and recovery for null faculty/source metadata. Faculty locks cover old and new non-null identities; year lock covers every slot. Recheck source hash, current identities, phantom insertions, full target set, expiry and gate. Snapshot old rows, delete exact CCC scope, insert complete new set and history atomically; no DOE/AFC/non-CCC/session writes. Ambiguous responses reuse the same idempotency key.
- [ ] Run focused GREEN tests and synthetic `powershell -NoProfile -File tools/test-ccc-replacement-sql.ps1 -ContainerName paws-master-refresh-acceptance` (which also invokes the CCC race runner) in isolated acceptance. Extend setup to apply053 before new fixtures while preserving original049 compatibility/rollback cases. Assert slot completeness, injected audit failure rollback, stale source/phantoms, same-key retry, preserved original migration receipt and safe full old-set recovery. On the real source, Plan must report413=402+11 and old161, not execute deletion.
- [ ] Commit: `feat: stage complete MASTER CCC replacements with recovery`.

### Task 6: Annual trainee evidence and scoped statistics API

**Files:** Create `database/azure-sql/054_trainee_source_evidence.sql`, `054_trainee_source_evidence_acceptance.sql`, `rollback_054_trainee_source_evidence.sql`, `server/src/trainees/trainee-service.js`, `server/src/trainees/trainee-api.js`, `server/src/data/sql-trainee-repository.js`, tests `server/test/trainee-service.test.js`, `server/test/trainee-api.test.js`, `server/test/trainee-repository.test.js`; extend Task2 refresh repository/procedures for the `trainees` domain and `server/src/runtime/swa-dashboard-functions.js`, `server/src/runtime/university-api.js` for routing/wiring.

**Interfaces:** `createTraineeApi({verifyToken,findUser,repository})` exposes `list(token,{academicYear,query,category,cursor,limit})` and `export(token,{academicYear,query,category})`. Repository `listTrainees({actorFirebaseUid,academicYear,query,category,cursor,limit}) → {rows,summary,nextCursor,coverage}`; summary uses exactly the filtered authorized full set, before pagination. `limit` defaults25, max100. Categories use the seven ordered codes `undergrad,vetm506,preceptor,im,grad_primary,grad_cosupervised,postdoc`.

- [ ] Write RED API tests: admin can query authorized faculty; faculty/HICC/VISC receive self only; cross-faculty identifiers/forged actor/year mismatch rejected; disabled/revoked users rejected at SQL read. Search/export cannot reveal other faculty's DOE or notes. Missing counts/source totals are distinguishable from explicit zero; guide/footer rows do not contribute.

```js
test('faculty search and export cannot widen self scope', async () => {
  const result = await api.list(selfToken, {academicYear:'2026-27', query:'other faculty'});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.rows, []);
  assert.equal(result.body.summary.supervisionAssignments, 0);
});
```
- [ ] Run `node --test server/test/trainee-service.test.js server/test/trainee-api.test.js server/test/trainee-repository.test.js` to meaningful RED.
- [ ] Add annual `paws.TraineeSourceEvidence`, unique faculty/year, with source hash/cells, raw count/credit/notes JSON, missing-source statuses and rowversion. Reuse existing authoritative DoeSupervisionSourceSnapshot/worksheet raw and applied DOE as separate fields. Do not rewrite RawDoe when source DOE differs or is absent. Hold unresolved/departed identities; preserve current-year snapshots absent from the new source as previous-source coverage, not silent zeros/deletions.
- [ ] Implement parameterized SQL scoping before filtering/aggregation/CSV generation; bound query length200 and use keyset pagination with filter/year/scope-bound cursors. Route `GET /api/v1/dashboard/trainees` and `/api/v1/dashboard/trainees/export`; use existing token/profile helpers and private,no-store responses. Export authorized full matching rows to CSV, escape spreadsheet formula prefixes and CSV quotes/newlines; no only-current-page export. Dataset/version-bound refresh commits and guarded recovery use Task2/3 contracts.
- [ ] Run focused GREEN tests and `powershell -NoProfile -File tools/test-master-refresh-sql.ps1 -ContainerName paws-master-refresh-acceptance -Mode Trainees`, including stale rows, update rollback, privacy/search/export, null-preserving counts, existing DOE fingerprints, year isolation and retained old-source rows. Verify synthetic header-guide8 + actual trainee-row preceptor53 gives53, never61; call the quantity supervision assignments, not unique headcount.
- [ ] Commit: `feat: serve annual trainee evidence with faculty scope`.

### Task 7: Lazy Trainees Dashboard tab

**Files:** Create `faculty-admin-trainees.js`, `faculty-admin-trainees.css`, `tests/faculty-admin-trainees.test.js`, `tests/trainee-client.test.js`; modify `faculty-admin.html`, `faculty-admin.js`, `asset-loader.js`, `paws-data-client.js`, `tools/static-assets.json`, `tools/build-swa-api.js` only if its existing source-copy rules require it. Existing controller must remain below60,000 LF bytes; do not move unrelated functionality.

**Interfaces:** client `dashboardTrainees({academicYear,query,category,cursor,limit})`, `exportDashboardTrainees({academicYear,query,category})`; `window.PAWS_TRAINEES.mount(host,{api,getAcademicYear,getUser}) → {refresh(),clear(),destroy()}`. New component owns its state, abort/stale-generation tokens, table/notes/export lifecycle. It is loaded on first Trainees tab selection, using existing asset loader; no initial eager fetch of all trainee evidence.

- [ ] Write RED user-flow tests: tab opening loads selected year, shows seven-category totals/issue status and25 rows; keyword/category filtering resets cursor; full-filtered export and expanded notes work; changing year/back/sign-out discards old responses, notes and generated download URLs. Faculty view omits all-faculty totals and sees only own server DTO.

```js
test('sign-out discards delayed trainee responses and private notes', async () => {
  const view = mountFixture({delayedResponse:true});
  view.clear();
  await fixtureResponse.resolve();
  assert.equal(host.textContent.includes('private trainee note'), false);
  assert.equal(host.querySelectorAll('tbody tr').length, 0);
});
```
- [ ] Run `node --test tests/faculty-admin-trainees.test.js tests/trainee-client.test.js tests/faculty-self-dashboard.test.js` to meaningful RED.
- [ ] Implement compact statistics above searchable table: supervision assignments, faculty with trainees (admin only), source/DOE issues, authorized raw/applied supervision DOE, seven category totals. Default rows25; Load more uses server cursor without duplicates. Expand notes on demand in each row. Blank source quantities show Not provided; explicit0 shows0; source DOE and current authoritative DOE are separate columns. Related581/591 work notes do not increment trainee counts.
- [ ] Wire self/admin entry points, selected academic year, authorization helpers, keyboard-accessible tab/table/detail controls and existing export/download patterns. Escape all source text. Add only the new assets to source allowlist; preserve lazy PDF/approval/SWAP/DOE modules. No policy publishing/recalculation buttons are added to this tab.
- [ ] Run focused GREEN tests; use the connected browser and a synthetic isolated fixture for25/26-row pagination, long names/notes, empty/missing data, narrow/wide viewports and keyboard navigation. Then authorized live read-only acceptance after release; record real scope/year without submitting fabricated data.
- [ ] Commit: `feat: add searchable annual Trainees Dashboard tab`.

### Task 8: Whole-branch acceptance, release and source data execution

**Files:** Add `docs/master-assignment-refresh-acceptance-20261018.md`, new chronological `agent.Ai/updates/` entries and refresh `PROJECT_STATE.md`/`TASK_CHAIN.md`; change immutable freeze baseline/manifests only in a separately reviewed promotion commit. Update existing local `PAWS任务进度.xlsx`, preserving manual reviewer/date/result entries and native features.

**Interfaces:** accepted package = exact merged-main generated static/API artifacts plus attested runtime source manifest; data application = explicit per-domain preview/version/receipt/recovery evidence, never a build artifact alone.

- [ ] Obtain a fresh independent whole-branch standards/spec/security review. Address each finding with a failing regression first. Review null-CCC consumers, source-to-slot correspondence, roles/dictionaries, DOE equality/exception protection, trainee privacy and old-source coverage, receipts/recovery and module sizes. Do not spawn implementation agents under the preserved native method; a final independent reviewer is required.
- [ ] Run `npm test`, `npm --prefix server test`, the three new SQL acceptance modes and existing CCC race/recovery suites; run the existing Auth/Firestore emulator workflow if rules change (rules weakening is excluded). Record exact counts/skips/SHA; required SQL/security cases must not be claimed passed from skipped environment tests.
- [ ] Promote all changed/new shipped static/API paths through existing immutable baseline workflow and separate review. Run `node tools/build-beta-release.js`, `node tools/beta-freeze.js --artifact .azure-production/app` and `node tools/beta-api-freeze.js`; open/update the feature PR and attach it to this chat, then require candidate CI and downloaded artifact checks. Merge only after acceptance, then require exact-main CI and raw candidate/main artifact equality before coordinated SQL052–054/API/Hosting rollout. Check the release script's current CLI contract before actual execution; no historical helper is blindly rerun.
- [ ] Before any real source apply, refresh source and live fingerprints. Save protected before-images privately. Apply only reviewed appointment/trainee operations passing DOE guards; use separate receipts so a held identity does not stop unrelated approved metadata. Draft source-policy changes require explicit trusted mode and validation; leave Active policy and recalculation unchanged. Verify exact held allocations stayed unchanged.
- [ ] Refresh complete CCC preview against all current targets, confirm all413=402+11, obtain the owner's approval of that exact manifest and then temporarily enable only CCC commit for the single approved operation. Reuse its idempotency key after any ambiguous response; inspect durable state before retry. Export receipt-bound private recovery evidence immediately, verify hash/ACL/counts, restore the prior gate value and recheck runtime/SQL health. If human exact-preview confirmation is unavailable, leave CCC pending and continue independent acceptance.
- [ ] Verify real calendar filters/Locum labels/personal schedules, role periods/rotation notes, self/admin Trainees/year/search/export and unchanged protected DOE/AFC/manual/session fingerprints. Update original ledger Tasks14/16/18/22 and applicable checks by actual completion, preserving Task13's completed540 migration and all existing unresolved signoffs. Distinguish code released, source data applied, DOE held and human acceptance pending; list each manual blocker without marking it passed.
- [ ] Commit documentation/ledger evidence references without private data. Final report links the original ledger and private discrepancy workbook, names held DOE differences and any unresolved human steps, and identifies the exact released SHA and applied receipt counts.

## Plan self-review and handoff

Spec coverage: source/default/split dates →1/2; scoped dictionaries and rotation details →2/3; DOE discrepancy preservation →3 and every commit; complete CCC/Locum/recovery →4/5; trainee data/privacy/statistics/tab/export →6/7; immutable release/exact source approval/original ledger →8. All five Review Focus items have explicit owning tests above. No runtime/source/SQL implementation has been performed while preparing this plan.

Next step after owner plan review: use `superpowers:executing-plans`, sequential native implementation with independent whole-branch review. Preserve any exact-manifest/live-operation confirmation boundary; design approval alone does not confirm a future deletion manifest.
