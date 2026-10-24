# Calendar Working Activities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move validated, exactly matched working activities into SQL Calendar ranges and permanently remove their AFC counterparts atomically, with truthful schedule display and protected SWAP availability.

**Architecture:** Keep timed teaching in existing Session/SessionAssignment. Add one SQL range-activity domain, reuse staging.ImportBatch/Workbook/Sheet/Row and AuditEvent, and extend the existing University API, Calendar and Faculty Dashboard. New writes remain closed until reviewed release and a fresh source-bound commit preview.

**Tech Stack:** Vanilla JavaScript, Node22/CommonJS, Firebase Auth identity, existing mssql/msnodesqlv8 SQL abstraction, SQL Server; reuse installed exceljs4.4.0, unzipper0.10.14 and JSZip3.10.2 for bounded server parsing and CRC verification.

**Spec:** [Approved design](../specs/2026-10-14-calendar-working-activities-design.md), approved by owner2026-10-14; documentation PR97. Existing main base0d4b4d9; plan begins on the isolated Beta worktree, not the unrelated Teaching-assignment-main directory.

## Global Constraints

- “Keep Firebase identity → University API → SQL authority.”
- “No Session create/delete, DOE recalculation, policy/published update or ordinary AFC cancellation is part of this transaction.”
- “Do not create missing course/year/room/group/DOE values.”
- “Each imported activity belongs to one source row/lineage, enforced by unique keys.”
- “New writes remain closed behind independent gates until accepted release.”
- Owner source hash:4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF; sheet AFC records, columnsA–D only; excluded departed rows267,297,563,773. Quarantine256/525/307/487 and all members of duplicate source pairs. OPA stays AFC.
- Date ranges are inclusive DATEs. Query ranges use existing normalizedRange half-open [start,end), maximum550days. Activity overlap is StartDate<query.end AND EndDate>=query.start. All original ranges remain stored; academic-year filtering intersects rather than rewrites them.
- 541 is the most recent preview count, not a hardcoded commit/test expectation. Row812 already exists. No retained AFC insertion belongs to this first operation.
- Reuse the existing isolated worktree; after plan approval create feature branch feat/calendar-working-activities-20261014 from the committed plan head. No main commits, unreviewed freeze changes, release, permission membership or live permanent deletion.
- Generic Faculty archive metadata correction and later CCC/rotation full replacement, Course Calendar capability and remaining25-task modules are separate changes. Do not repeat the completed Canton archive.

## Review Focus

- Concurrent AFC cancellation or alias/Faculty deactivation after preview must reject the entire import; Task3 tests target version and identity snapshot drift.
- A work activity appearing after candidate selection must prevent SWAP apply even for an existing owner override; Task4 tests both concurrency orderings.
- Multi-day ranges, weekends, midnight dates and May1 boundaries must retain source dates without invented clocks/cadence; Tasks1/6 tests cover each.
- Truncated ZIP, forged decompressed sizes and formulas in approved cells must fail before staging; Task1 tests actual streamed limits and cached-formula rejection.
- Retrying after a lost commit response or attempting recovery after an activity edit must not duplicate/purge newer data; Task3 tests receipt replay and recovery conflict.

## File responsibilities and shared contracts

New server files: calendar/activity-import-policy.js (approved source/category/exclusions), activity-workbook.js + activity-workbook-worker.js (bounded XLSX parsing), calendar-activity-api.js (auth/validation), data/sql-calendar-activity-repository.js (parameterized procedures), runtime/swa-calendar-activity-functions.js (routes).
New frontend: calendar-activities.js (range view/controller), calendar-activities.css, faculty-admin-activity-import.js (admin upload/preview/commit). Extend paws-data-client.js, timetable.js/index.html and faculty-admin.js/faculty-admin.html; preserve existing deferred modules.
SQL038 foundation;039 SWAP integration;040 commit/timing/recovery procedures;041 scoped execute roles. Corresponding rollback/acceptance files are named in tasks. Keep historic001–037 unchanged.
Extend runtime/swa-sql-runtime.js, runtime/university-http-server.js, data/write-gates.js, swa-api/index.js and dependency lockfiles; add shipped assets through tools/static-assets.json. This Beta repository has no tools/runtime-bundles.json: do not import the other repository's bundling contract.

**Internal DTOs** (never accept actor or canonical target IDs from upload clients):
- ParsedImport={sourceSha256,sheetName,rows:[{sourceRow,facultySourceName,startDate,endDate,originalLabel,category|null,treatment,issues:[]}]}.
- treatment is retain_afc|working_candidate|excluded|quarantined; categories ccc|rotation_participant|clinical_day|vetm581_rounds|vetm571_clinical_pharmacology|vetm591_presentations|teaching_excellence|remote_work.
- Preview={batchId,sourceSha256,dataset,startDate,endDate,previewVersion,manifestSha256,expiresAtUtc,counts,items:[{sourceRow,status,issues,displayName,startDate,endDate,category,targetCount}]}.
- Public Activity={activityId,facultyKey,facultyDisplayName,category,label,startDate,endDate,courseCode|null,timeEvidence:[{date,startTime,endTime}],timeStatus:'not_provided'|'partial'|'verified',version}; no canonical FacultyId, email, UCID, private evidence notes, AFC IDs or original source-row maps.
- Receipt={receiptId,batchId,sourceSha256,manifestSha256,insertedCount,deletedAfcCount,committedAtUtc,idempotentReplay}.
- Availability={status:'Available'|'Unavailable'|'Needs Review',available:boolean}; available is true only for Available. Reasons shown to faculty remain generic except already authorized timetable course/time conflicts.
- All versions are exact16-hex rowversion strings via CONVERT(binary(8),RowVersion) before text; never recover an old rowversion by inserting it.
- Calendar SQL errors53801→403 ROLE_DENIED,53802→400 INVALID_SOURCE,53803→404 NOT_FOUND,53804→409 REVISION_CONFLICT,53805→409 PREVIEW_EXPIRED,53806→409 MANIFEST_CONFLICT,53807→409 IDEMPOTENCY_CONFLICT,53808→409 PROTECTED_REFERENCE,53809→409 AVAILABILITY_BUSY; response messages are fixed public-safe strings, not SQL exception text. Limit errors are413, malformed workbook400, unapproved hash409 APPROVED_SOURCE_REQUIRED.

## Task 1 — Bounded source parser and approved classification

**Files:** Create server/src/calendar/activity-import-policy.js, activity-workbook.js, activity-workbook-worker.js; server/test/calendar-activity-workbook.test.js and fixtures/calendar-activity-workbook.js. Modify server/package.json + package-lock.json and swa-api/package.json + package-lock.json for exact runtime exceljs4.4.0/unzipper0.10.14/jszip3.10.2. Root's existing dev dependencies are not a deployed server dependency.

**Interfaces:** parseActivityWorkbook(buffer,policy)->Promise<ParsedImport>; approvedActivityImportPolicy(sourceSha256)->policy or APPROVED_SOURCE_REQUIRED. Policy closes categories by exact normalized Purpose label from the approved source; no substring teaching/leave inference. normalizeActivityNameKey(text) only trims/collapses space/tab/CR/LF/NBSP, normalizes comma spacing and uppercase; preserve punctuation and accents. Do not reuse the old AFC import's broader punctuation-stripping name resolver.

- [ ] Write tests using synthetic workbook buffers: OPA→retain_afc; CCC Day→ccc/working_candidate; excluded rows bound to the exact policy hash; nonmatching hash→APPROVED_SOURCE_REQUIRED; blank/unknown purpose, invalid/reversed/missing fields and every duplicate group member→quarantined. Assert dates2026-01-11→2027-08-31 stay unchanged and literal time hints leave time fields absent.

  Fixture exports makeWorkbook(rows,{date1904=false}={}) and syntheticPolicyFor(buffer) produce test-only workbook/policy inputs; the production API only obtains its hardcoded approved policy.
  ```js
  test('OPA remains AFC', async () => {
    const bytes = await makeWorkbook([{facultySourceName:'Synthetic Faculty',startDate:'2026-11-05',endDate:'2026-11-06',purpose:'OPA'}]);
    assert.equal((await parseActivityWorkbook(bytes,syntheticPolicyFor(bytes))).rows[0].treatment,'retain_afc');
  });
  ```
- [ ] Run `node --test server/test/calendar-activity-workbook.test.js`; expect missing-module/export failure before implementation.
- [ ] Implement the interfaces. Headers trim to Faculty Member/Start/End/Purpose; keep actual source row numbers, skip only fully blankA–D rows, ignore auxiliary sheets/columns. Accept ISO dates and XLSX date cells (1900/1904 date-system handling); reject serial60, nonmidnight cells and formulas/cached results inA–D. Never evaluate external links/formulas in ignored sheets.
- [ ] Bound compressed file512KiB, actual streamed expanded bytes16MiB, entries1024 and selected populated rows5000; reject encrypted/macro/traversal/duplicate-entry archives and malformed CRCs. Enumerate unzipper.Open.buffer entries and stream each with actual byte counters without filesystem extraction; after those limits pass, JSZip.loadAsync(buffer,{checkCRC32:true}) verifies CRC before ExcelJS load. Worker128MiB old generation,10s deadline; at most2 parsing workers, excess→503 IMPORT_BUSY; terminate on every error/deadline.
- [ ] Add ZIP tests for forged metadata/CRC/truncation/expansion, worker timeout/cleanup, header trailing spaces, timezone/1904 dates, synthetic ignored-sheet external formulas and A–D cached-formula denial. Rerun the test file; expect all pass. Read the original approved workbook only for an optional private golden check; never commit it or overwrite it.
- [ ] Commit parser, tests and both runtime lockfiles: `feat: validate approved activity workbooks`.

## Task 2 — SQL range domain, staged preview and sanitized reads

**Files:** Create database/azure-sql/038_calendar_activity_foundation.sql, rollback_038_calendar_activity_foundation.sql, 038_calendar_activity_acceptance.sql; server/src/data/sql-calendar-activity-repository.js; server/test/calendar-activity-schema.test.js and calendar-activity-repository.test.js; tools/test-calendar-activity-sql.ps1 + calendar-activity-sql-test-manifest.json.

**Interfaces:** createSqlCalendarActivityRepository(db) exposes stage({actorFirebaseUid,parsed,requestId}), preview({actorFirebaseUid,batchId,expectedVersion}), getImport({actorFirebaseUid,batchId}), list({actorFirebaseUid,start,end,facultyKey?,category?,cursor?,limit:100}).
SQL procedures StageCalendarActivityImport(@ActorFirebaseUid,@RequestId,@SourceSha256,@RowsJson), PreviewCalendarActivityImport(@ActorFirebaseUid,@ImportBatchId,@ExpectedVersion), GetCalendarActivityImport(@ActorFirebaseUid,@ImportBatchId), ListCalendarActivities(@ActorFirebaseUid,@StartDate,@EndExclusive,@FacultyKey=NULL,@Category=NULL,@Cursor=NULL,@Limit=100). Return JSON DTOs defined above; use typed parameters.

- [ ] Write failing schema/repository tests: no second Faculty/Session catalog, one row per source hash/sheet/row, OPA not mapped, ambiguous canonical/alias/accepted-lineage keys quarantined, inactive Faculty rejected, staged data invisible to list, no private fields in list. Run `node --test server/test/calendar-activity-schema.test.js server/test/calendar-activity-repository.test.js`; expect failure.

  Pin SQL acceptance assertions using a staged synthetic batch (no commit):
  ```sql
  IF EXISTS(SELECT 1 FROM paws.CalendarActivity WHERE ImportBatchId=@SyntheticBatch)
    THROW 53890,'Staged rows became live before commit.',1;
  ```
- [ ] Create paws.CalendarActivity with FacultyId FK, category, original label, inclusive dates, optional verified CourseId, ImportBatchId/ImportRowId and source provenance, UpdatedAtUtc and ActivityVersion rowversion. Add (FacultyId,StartDate,EndDate) index and unique sourceHash/sheet/sourceRow. Add CalendarActivityDayTime(activityId,date,start,end,evidenceRef,evidenceNote,actor,version) for explicitly verified individual dates, never inferred weekday repetition.
- [ ] Extend existing staging lineage with staging.CalendarActivityImport (batchId FK, dataset/date scope, source hash, status, preview expiry/version/manifest), staging.CalendarActivityImportItem (ImportRowId FK, resolution basis/evidence, exact target AFC ID+version+content hash, row status), paws.CalendarActivityImportReceipt and restricted paws.CalendarActivityRecoveryRow. Historical target AFC IDs in staging/recovery are immutable values without FK to the deletable AFC row. Receipt idempotency key and (dataset,sourceHash,manifestHash) are unique. No public SELECT grants on staging/recovery. SQL module creation sets ANSI_NULLS/QUOTED_IDENTIFIER ON before each CREATE/ALTER batch and required indexed-write options inside procedures.
- [ ] Implement SQL paws_api.CalendarActivityNameKey(@Value nvarchar(256))->nvarchar(256) mirroring Task1's exact closed whitespace/comma/case normalization; pin identical JS/SQL inputs with accented, punctuated and NBSP names. Resolve canonical-name→registered-alias→accepted staging.AfcRecordRaw/activeAfc lineage, rejecting multiple IDs at each selected tier. Each committed working row requires one exact active imported AFC match by resolved FacultyId/date/normalized original purpose; zero/multiple targets stay quarantined. Retained/excluded/quarantined input never becomes an insert/delete target. Capture every identity evidence row/value/version needed for commit recheck. Preview expiry15minutes; manifest hashes ordered bindings, policy version, exclusions, dataset/date extent and all target versions.
- [ ] Implement list using existing validateAuthorizedProfile and SQL equivalents: faculty/hicc/visc self-scoped, administrators/offices retain existing timetable scope; no broader faculty read. Filter start/end is required, paged by (StartDate,ActivityId), and normalizedRange's550-day cap. Public projection resolves existing sanitized SwapCandidate key/name only. Private timing evidence remains server/admin-only.
- [ ] Implement disposable SQL runner: only a local Docker container bearing label paws.calendar-test=1; refuse arbitrary Server/live University addresses. Explicit manifest applies repository foundation scripts001–037 in reviewed dependency order, excluding rollbacks/proofs and source-data loaders; seed synthetic users/catalog/lineage only. Mutually exclusive -Through or -FeatureMigrations parameters select the new module files. Run `pwsh tools/test-calendar-activity-sql.ps1 -ContainerName paws-calendar-sql-test -Through 038`; expect CALENDAR_ACTIVITY_FOUNDATION_ACCEPTANCE_OK and no active activity before commit. Run both node files; commit `feat: stage SQL calendar activities with scoped reads`.

## Task 3 — Atomic migration, timing resolution and narrow recovery

**Files:** Create database/azure-sql/040_calendar_activity_commands.sql, rollback_040_calendar_activity_commands.sql, 040_calendar_activity_acceptance.sql; tools/export_calendar_activity_recovery.ps1 and recover_calendar_activity_import.ps1; server/test/calendar-activity-commands.test.js. Extend SQL repository fromTask2.
**Interfaces:** repository.commit({actorFirebaseUid,batchId,expectedVersion,manifestSha256,sourceSha256,idempotencyKey,confirm:true})->Receipt; resolveTime({actorFirebaseUid,activityId,expectedVersion,date,startTime,endTime,evidenceRef,evidenceNote})->Activity.
SQL CommitCalendarActivityImport(same typed scalar parameters), ResolveCalendarActivityDayTime(same parameters), ExportCalendarActivityRecovery(@ActorFirebaseUid,@ReceiptId), RecoverCalendarActivityImport(@ActorFirebaseUid,@ReceiptId,@ExpectedRecoverySha256,@Confirm). Recovery is trusted admin tooling only, not a browser route.

- [ ] Write failing tests/SQL fixtures for late cancellation, changed purpose/version, new/deactivated/ambiguous identity evidence, expired/stale manifest, missing linked source, retained/manual/unclassified preservation, duplicate commit, lost-response same-key replay and changed-key hash denial. Run `node --test server/test/calendar-activity-commands.test.js`; expect failure.

  Repository fixture returns a committed receipt twice; assert output replay semantics, while SQL fixtures independently prove durable cardinality:
  ```sql
  IF (SELECT COUNT(*) FROM paws.CalendarActivityImportReceipt WHERE IdempotencyKey=@SyntheticKey)<>1
    THROW 53891,'Retry created duplicate receipts.',1;
  ```
- [ ] Define paws_api.AcquireCalendarActivityFacultyLocks(@FacultyIdsJson) with sorted unique canonical IDs, transaction-owned Exclusive sp_getapplock resource paws:calendar-availability:<FacultyId>, database-principal dbo, timeout5000ms; negative return aborts transaction. Every activity commit/resolve/recovery and final SWAP apply inTask4 uses it. Acquire import/receipt then sorted faculty locks before locking activity/AFC rows; SWAP retains its request/session locking and takes faculty locks before availability reads. Import/resolve/recovery must not acquire Session/SwapRequest locks afterward, avoiding a reverse dependency.
- [ ] Commit runs one XACT_ABORT transaction: auth/receipt replay first (same hash/key returns receipt after authorization, even if old preview expired); otherwise recheck expiry/policy/hash/manifest; lock batch/targets with UPDLOCK,HOLDLOCK; rerun the complete exact identity resolution against current canonical/alias/lineage candidate sets with serializable range reads, rejecting newly introduced ambiguities as well as changed evidence/Faculty.Active; use exact AFC ID/rowversion+Faculty/date/purpose binding. Check FK dependencies on target AFC rows; reject protected references. Insert all valid activities, copy complete recovery before-images, then delete exactly those active imported AFC rows; row counts must equal the regenerated accepted manifest. Audit and receipt commit together. No client-controlled target list, loops over existing Session APIs or DOE calls.
- [ ] Recovery rows contain old AFC ID/source lineage/content and each created activity's postcommit version. Export only the exact receipt through separately scoped trusted tooling, SHA256 the artifact, never Hosting. Recovery rechecks no newer activity/timing changes or new references, expected recovery hash and absent original AFC IDs, takes the same locks, inserts original AFC columns except generated rowversion, removes only unchanged created activities and audits atomically. Fail rather than overwrite newer state. Schema rollback must refuse populated tables/receipts; migration recovery is distinct from schema rollback.
- [ ] Timing resolution requires an active administrator, current activity version, exact date inside its range, 00:00≤start<end≤23:59, nonblank evidence reference/note, and the shared faculty lock. Upsert only that date; bump parent version and audit. A range without verified timing for the target day remains Needs Review. No free-form override can turn unknown timing into availability.
- [ ] In disposable SQL inject insert/delete/audit failures via test-only rollback fixtures, not production failure flags; assert full rollback and unrelated Session/AFC/manual/DOE/Published hashes unchanged. Assert same-key retry emits one receipt/audit, recovery conflict aborts, recovery success restores original IDs with new version tokens. Run runner `-FeatureMigrations 038,040` to test commands independently before Task4 exists; expect CALENDAR_ACTIVITY_ATOMIC_ACCEPTANCE_OK and CALENDAR_ACTIVITY_RECOVERY_ACCEPTANCE_OK. Run node tests and commit `feat: migrate matched work activities atomically`.

## Task 4 — Candidate and final SWAP availability, including concurrency

**Files:** Create database/azure-sql/039_calendar_activity_swap.sql, rollback_039_calendar_activity_swap.sql, 039_calendar_activity_swap_acceptance.sql; server/test/calendar-activity-swap.test.js and tests/calendar-activity-swap-ui.test.js. Modify swap-workflow-sql.js and server/src/data/sql-swap-repository.js only where DTO handling requires it. Extend disposable runner concurrency fixtures.
**Interfaces:** paws_api.CalendarActivityAvailability(@FacultyId,@Date,@StartTime,@EndTime,@ExcludeSessionId=NULL) returns status, excluding the session being revised. Existing GetSessionSwapContext candidate adds availabilityStatus and preserves available=false for Needs Review; repository.context API signature stays unchanged. Existing DecideSessionSwap parameters/consent/state machine remain unchanged.

- [ ] Write failing tests: retained AFC→Unavailable without reason disclosure; date-only activity→Needs Review/availablefalse; verified adjacent timing→Available, overlap→Unavailable; no resolved timing for a particular date→Needs Review; malformed session timing/identity stays blocked. UI choice shows Needs Review and cannot select it. Run both node files; expect failures.

  Synthetic context obtained from the actual SQL candidate procedure must satisfy:
  ```js
  assert.equal(context.candidates[0].availabilityStatus,'Needs Review');
  assert.equal(context.candidates[0].available,false);
  assert.equal(JSON.stringify(context).includes('private evidence note'),false);
  ```
- [ ] Define one SQL availability projection over retained AFC, live Session conflicts and Activity/DayTime. Preserve existing missing-session/time conservative handling. GetSessionSwapContext uses this projection for candidate listing, without AFC purpose or evidence notes. SaveSessionSwap must reject a newly chosen Needs Review candidate rather than trusting a stale browser option. Add paws.SwapCalendarActivitySnapshot with (RequestId,Revision,FacultyId) primary key, FK to existing SwapRevision, proposed date/start/end and SHA256 of sorted relevant activity/day versions (including an explicit empty state); Save/revise captures every resulting co-instructor under the shared lock.
- [ ] Recreate only GetSessionSwapContext/SaveSessionSwap/DecideSessionSwap in039 with existing reviewed030 logic plus necessary activity checks; leave historical030 unchanged. Final apply resolves all resulting co-instructors, acquiresTask3's sorted faculty locks, reads CalendarActivity/DayTime and Faculty with UPDLOCK,HOLDLOCK, and compares the captured activity-version digest inside the existing transaction. Missing/different snapshots require a fresh revision (53010 STALE_SESSION), including legacy requests; they remain readable/reviewable. Apply the activity check before existing override handling. Existing AFC/Session serializable checks and DOE, reviewer, consent, audit and stale session snapshot logic remain intact.
- [ ] Needs Review is an unconditional final-apply rejection, including an owner/developer OverrideReason. An administrator must first record verified per-day evidence throughTask3, then reload/revalidate the request. Preserve existing legitimate override semantics for other explicitly reviewed conflicts.
- [ ] Add two-session SQL race fixtures: activity writer obtains lock first and SWAP rejects after waiting; SWAP obtains lock first and activity writer waits until final apply ends. Test concurrent timing resolution/recovery too; verify committed availability is never based on a half-migrated AFC/activity state. Existing AFC creation/cancellation and Session writers remain protected by final apply's existing serializable range reads; prove races against each rather than assuming it. A failed SQL assertion blocks release.
- [ ] Run `node --test server/test/calendar-activity-swap.test.js tests/calendar-activity-swap-ui.test.js` and disposable runner `-Through 040`; expect CALENDAR_ACTIVITY_SWAP_SERIALIZED_OK plusTask3 markers. Commit `feat: protect SWAP with calendar activity availability`.

## Task 5 — Authenticated API, independent gates and least privilege

**Files:** Create server/src/calendar/calendar-activity-api.js, server/src/runtime/swa-calendar-activity-functions.js; database/azure-sql/041_calendar_activity_permissions.sql, rollback_041_calendar_activity_permissions.sql, 041_calendar_activity_permissions_acceptance.sql; server/test/calendar-activity-api.test.js, calendar-activity-runtime.test.js, calendar-activity-permissions.test.js. Modify data/write-gates.js, runtime/swa-sql-runtime.js, runtime/university-http-server.js, swa-api/index.js and existing write-gates/runtime/http tests.

**Interfaces:** createCalendarActivityApi({verifyToken,findUser,repository,parseWorkbook,writeGates}) returns capabilities(token), list(token,query), stage(token,payload), getImport(token,batchId), preview(token,batchId,payload), commit(token,batchId,payload), resolveTime(token,activityId,payload). createCalendarActivityFunctions({api})(Request)->runtime response. Existing validateAuthorizedProfile/isAdministratorRole/normalizedRange are reused.

- [ ] Write failing RBAC tests:401 missing token;403 inactive/password-change/unlinked/unknown role; faculty cannot stage/preview/commit/resolve or fetch any import; spoofed actor/target fields denied; scope/column parity for list; gates require exacttrue; expired/conflicting manifest→409; private SQL errors/notes never echoed. Run `node --test server/test/calendar-activity-api.test.js server/test/calendar-activity-runtime.test.js server/test/calendar-activity-permissions.test.js`.

  An API harness using verifyToken→synthetic faculty profile and a call-counting repository must pin:
  ```js
  assert.equal((await api.commit('faculty-token',batchId,commitPayload)).status,403);
  assert.equal(repositoryCalls.length,0);
  ```
- [ ] Routes: GET /api/v1/calendar-activities and /api/v1/calendar-activities/capabilities; POST /api/v1/calendar-activity-imports with {requestId,sourceSha256,fileName,fileBase64}; GET /api/v1/calendar-activity-imports/:batchId; POST /api/v1/calendar-activity-imports/:batchId/preview with {expectedVersion}; POST /api/v1/calendar-activity-imports/:batchId/commit with {expectedVersion,manifestSha256,sourceSha256,idempotencyKey,confirm}; POST /api/v1/calendar-activities/:activityId/time-evidence with {expectedVersion,date,startTime,endTime,evidenceRef,evidenceNote}. GET is read-only. Reject extra keys/methods;405 includes Allow. Preview refresh writes only staging and requires stage gate.
- [ ] Gates: calendarActivityStage=PAWS_CALENDAR_ACTIVITY_STAGE_ENABLED==='true', calendarActivityCommit=PAWS_CALENDAR_ACTIVITY_COMMIT_ENABLED==='true', calendarActivityTime=PAWS_CALENDAR_ACTIVITY_TIME_ENABLED==='true'; defaultsfalse. Auth/role checks precede workbook parsing. Commit source hash is rechecked against approved policy, not trusted from browser.
- [ ] Exact uploadPOST uses existing absolute1MiB HTTP cap (default other requests remains64KiB); parser decoded512KiB cap and strict canonical base64. No global upload-limit expansion, arbitrary binary-response route or Firestore fallback. Route through existing support.handle wrapper with normal audit visibility. Bind the same paths in swa-api/index.js; dependency graph/build stays coherent.
- [ ] Create dbo-owned roles paws_runtime_calendar_read (execute List only), paws_runtime_calendar_stage (stage/preview/getImport), paws_runtime_calendar_commit (commit), paws_runtime_calendar_time (resolve), paws_calendar_recovery_admin (trusted export/recover only). SQL procedures recheck actor role; no direct INSERT/UPDATE/DELETE grants, no browser recovery role. Prove staging/recovery reads denied under existing broad read memberships. Do not bind live memberships or retain db_owner silently: dedicated least-privilege runtime is a release prerequisite unless the owner approves a narrowly documented exception.
- [ ] Run all three node files plus `node --test server/test/write-gates.test.js server/test/university-http-server.test.js server/test/runtime.test.js`; run disposable SQL through041 and expect CALENDAR_ACTIVITY_PERMISSION_BOUNDARY_OK. Commit `feat: expose gated calendar activity workflows`.

## Task 6 — Calendar ranges, faculty schedule and administrator preview

**Files:** Create calendar-activities.js, calendar-activities.css, faculty-admin-activity-import.js; tests/calendar-activities.test.js, calendar-activity-import-ui.test.js and calendar-activity-client.test.js. Modify paws-data-client.js, timetable.js, index.html, timetable.css, faculty-admin.js, faculty-admin.html, tools/static-assets.json and necessary existing asset/client tests.

**Interfaces:** UCVM_PAWS_DATA.listCalendarActivities({start,end,facultyKey?,category?,cursor?})->pagedActivity; stageCalendarActivityImport(payload)->Preview; getCalendarActivityImport(batchId)->Preview; previewCalendarActivityImport(batchId,{expectedVersion})->Preview; commitCalendarActivityImport(batchId,payload)->Receipt; resolveCalendarActivityTime(activityId,payload)->Activity; calendarActivityCapabilities()->gates.
window.PAWS_CALENDAR_ACTIVITIES exposes loadRange(range)->Promise<Activity[]>, renderRangeLane(activities,{start,end,filters})->escapedHTML, renderFacultyActivities(activities)->escapedHTML, clear(); window.PAWS_ACTIVITY_IMPORT.createController({api,host,notify,onCommitted}) owns upload/preview/commit state. Public timeStatus is verified only when each date in the original inclusive range has evidence; otherwise partial/not_provided.

- [ ] Write failing UI/client tests: missing times/rooms/groups show Not provided; range crossing May1 retains original dates; weekends show the range without assumed working cadence; filter intersection/category/self-scope works; stale response after logout/range change discarded; SQL read failure shows explicit activity error while Session view remains usable. Day evidence shows only its verified date/time. No per-activity Edit Session/Manage/SWAP handlers.

  For one synthetic date-only range, assert the lane never invents the legacy CCC clock:
  ```js
  const html=PAWS_CALENDAR_ACTIVITIES.renderRangeLane([activity],{start:'2026-11-01',end:'2026-11-08',filters:{}});
  assert.match(html,/Not provided/);
  assert.doesNotMatch(html,/07:30|17:00|data-session-id=/);
  ```
- [ ] Add read-only range lane beneath existing day/week/month grids and range rows in list view; do not expand into synthetic07:30–17:00 Sessions. Replace Beta's show-ccc Firestore loader with categoryccc activity reads, retain its toggle meaning, add Working activities/category filter without treating CCC as a real course. Source course missing is Not provided. Keep date-only items out of timed-grid layout and existing session selection/DOE calculations.
- [ ] Load the identical authorized activity projection for the selected Faculty Dashboard schedule, requesting self-scoped data for faculty and mapped key for administrators. Never add public directory reads or show private AFC/source/evidence fields. Use shared faculty-name/escape helpers and preserve current deferred AFC PDF/SWAP/DOE boundaries.
- [ ] Add administrator-only import entry: file/hash validation, stage summary, per-row quarantine/exclusion and exact target counts, original date extent, cross-year count, expiry/version, refresh-preview action and explicit confirmation. Double-click disabled; lost response retries the same key; stale409 forces refresh. Show retained rows as preserved and departed exclusions clearly. Only committed receipt triggers activity/AFC refresh; actual permanent-delete commit is not exercised against live data during UI testing.
- [ ] Render safely without innerHTML of raw labels/names; escaping tests include HTML and spreadsheet payloads. Complete keyboard/disabled/loading/error states and private-ID-free visible labels. Add only exact new assets to static allowlist; never ship workbook/staging/recovery data.
- [ ] Run `node --test tests/calendar-activities.test.js tests/calendar-activity-import-ui.test.js tests/calendar-activity-client.test.js tests/paws-data-client.test.js tests/timetable-azure-sql-read.test.js`; expect all pass. Commit `feat: display work ranges and reviewed migration previews`.

## Task 7 — Whole-module validation, reviewed freeze and separate release operation

**Files:** Add docs/calendar-working-activities-release-20261014.md; extend tests/beta-runtime-artifact.test.js and relevant workflow test invocation for disposable SQL runner where supported; update agent.Ai continuity. Governance changes only after reviewed product commit: tools/beta-freeze.js, tools/beta-baseline.json and manifest-derived reporting governed by current freeze workflow. Do not add drift allowances or modify protected-file union logic.

- [ ] Self-review every spec section againstTasks1–6 and run root `npm test`, `npm test --prefix server`, existing emulators and disposable SQL through041. Record exact head/counts/skips. Record unchanged synthetic Session/Assignment/DOE/Published snapshots around import/recovery. No mocked test can substitute for SQL transaction/race evidence.
- [ ] Review whole product branch independently for privacy, authorization, source binding, recovered-row versions, race ordering and unchanged SWAP/DOE. Fix findings and commit. Product changes are expected to fail the old freeze until a separately reviewed governance commit anchored to the exact accepted product SHA; never skip enforcement.
- [ ] After reviewed freeze promotion run `node tools/build-static.js`, `node tools/build-beta-release.js`, `node tools/verify-beta-candidate.js`, `node tools/beta-api-freeze.js`, static/API artifact freezes. Inspect artifact inventory for new source/dependencies and absence of private imports/recovery. Use one coherent product/governance PR; attach it to this chat.
- [ ] Chrome synthetic acceptance in a disposable authenticated environment: category toggles, date-range/profile rows, truthful time, admin upload/quarantine/stale/retry receipt, Needs Review candidate rejection and verified-day boundaries. Save screenshots with surrounding UI; no live-source business writes. Record runtime/backend environment so test results cannot be mistaken for live Beta.
- [ ] Prepare concrete owner release request containing PR/head, SQL/role manifest, expected pre-migration module-definition hashes and reviewed rollback definitions, dedicated runtime principal proof, recovery storage location/format plus tested synthetic artifact hash, API/Hosting artifact attestation and fresh exact source preview. Unexpected live module drift blocks application pending review. Merge/release and permanent source migration are separate named actions. Wait for explicit authorization; then exact-main CI and coordinated SQL/API/Hosting release with all new write gates initiallyfalse. Enable only specifically authorized stage/time/commit operations; read/schedule/SWAP integration must be accepted before cleanup.
- [ ] Freshly stage the approved file and compare regenerated manifest to current live rows, including new manual AFC/row812 and inactive identities; do not assert541 by fiat. Obtain exact operation confirmation. Verify restricted SQL recovery storage/permissions and the tested transaction writes before-images before deleting targets. Commit once through normal authenticated API; immediately export/check the resulting receipt-bound recovery artifact (its receipt exists only after commit). Verify matched insert/delete counts, zero remaining matched working AFC, preserved absence/OPA/unclassified/manual records, unchanged teaching/DOE/Published data and one receipt/audit. A later recovery requires its own authorization.
- [ ] Update PROJECT_STATE/TASK_CHAIN/DECISIONS plus a new chronological update with actual outcomes/limits. Archive completion and prior PR94/95 release are not repeated. Mark this module complete only when its authorized release and source operation are accepted; keep unrelated full-directive tasks explicitly outstanding.

## Execution handoff

Self-review completed2026-10-14: all approved spec sections map to Tasks1–7 and all five Review Focus cases have named tests. Corrected independent SQL command testing order, bound complete identity re-resolution, added saved SWAP activity snapshots, explicit CRC verification and truthful recovery export timing. No implementation/tests/live operations were performed while writing this plan.

Owner has approved the design, not yet this implementation plan. Plan review and execution-method selection are the remaining writing-plans skill prerequisite.
Recommended: **Native execution** forTasks1–7 with one independent whole-branch reviewer, because parser→manifest→transaction→availability→UI share strict interfaces and sequential dependencies. Synthetic SQL privacy/rollback/concurrency acceptance remains mandatory in either method.
Alternative: **Subagent-driven**, with fresh implementer/reviewer per task and a whole-branch review; more independent gates and greater context overhead.
