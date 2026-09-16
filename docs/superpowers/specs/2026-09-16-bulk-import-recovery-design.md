# Safe Bulk Import Recovery Design

Date: 2026-09-16
Repository: `Alex1122341/Teaching-assignment`
Workstream: 3 - Safe bulk import
Status: Design approved in chat; written spec pending final user review

## 1. Purpose

The current `importSummaryJson()` flow performs a sequence of independent Firestore batch writes: faculty summaries are updated, incoming sessions are written, stale sessions are deleted, metadata and audit logs are written, and the admin dataset / derived indexes are refreshed. Each batch is individually atomic, but the overall import is not. A browser close, network interruption, permission failure, or write failure can therefore leave the database in a mixed partial state.

This design makes the import resumable, recoverable, auditable, and safe for the existing client-only Firebase Spark architecture. It does not pretend that a multi-thousand-write browser import can become one Firestore transaction.

The selected recovery model is:

**Resume by default + manual recovery backup restore when needed.**

A normal interruption should resume from a safe checkpoint. A backup restore is reserved for an incorrect source file, unrecoverable verification failure, abandoned import, or management decision to revert.

## 2. Scope

Workstream 3 is responsible for:

- import preflight validation;
- source-file fingerprinting;
- mandatory pre-import recovery backup generation;
- import job creation and persisted checkpoints;
- maintenance/write lock state;
- resumable faculty and session batch writes;
- source-data verification before stale deletion;
- resumable stale-session deletion;
- final session ID-set verification;
- resumable recovery restore;
- import-level audit events;
- an integration hook for derived-index rebuild/verification;
- emulator-based failure injection tests.

Workstream 3 does not implement the full derived-index verifier. Workstream 4 remains responsible for canonical build/diff/verify/rebuild support for `faculty_index`, `schedule_stats`, `faculty_swap_index`, and `faculty_swap_map`.

## 3. Existing Constraints

- `main` is production source of truth. Feature work must use a branch / PR.
- Frontend is vanilla HTML/CSS/JavaScript.
- Firebase Authentication and Cloud Firestore remain the backend.
- The production architecture must remain Spark-compatible and cannot depend on Cloud Functions.
- Firestore rules remain the security boundary; rules must not be weakened for convenience.
- Only Owner / ADFA General may start, resume, restore, or take over a bulk teaching-data import.
- GitHub Pages uses the shared live Firebase backend, so destructive failure testing must use the Firebase Emulator, not Pages.
- Recovery backups contain operational teaching data and must be treated as confidential administrative files. They must never be committed to the repository or included in test fixtures containing real data.

## 4. High-Level Import Flow

The normal flow is:

```text
SELECT FILE
    -> PREFLIGHT
    -> BACKUP REQUIRED
    -> BACKUP_READY
    -> APPLYING_FACULTY
    -> APPLYING_SESSIONS
    -> VERIFYING_SOURCE
    -> DELETING_STALE
    -> REBUILDING_INDEXES
    -> VERIFYING_FINAL
    -> COMPLETED
```

Any mutating phase may transition to `FAILED`.

From `FAILED`, management can either:

```text
FAILED -> RESUME SAME IMPORT
FAILED -> RESTORE RECOVERY BACKUP
```

Only `COMPLETED` or `RESTORED` may release the teaching-data maintenance lock.

## 5. Preflight Validation

Preflight performs zero Firestore writes to teaching data.

The UI should show:

- source workbook name;
- schema version;
- source faculty count;
- source session count;
- current Firestore faculty/session counts;
- estimated faculty summary updates;
- faculty records without source summaries;
- sessions to create/update;
- sessions that would become stale and be removed;
- warnings and blocking errors.

### 5.1 Hard failures

The import is blocked before any mutation if any of the following applies:

- invalid JSON;
- unsupported schema/version;
- `faculty` or `sessions` is missing or not an array;
- duplicate faculty IDs;
- duplicate session IDs;
- missing/blank stable session ID;
- repeated UCID in the source faculty summary set;
- structurally incomplete source data;
- another import or restore is already active/incomplete;
- a completed import with the same fingerprint is being started again as a new job.

### 5.2 Warnings

Warnings do not automatically block the import. Examples:

- current faculty with no source summary;
- source session count materially lower than the current database;
- a significant number of stale sessions will be deleted;
- source workbook name changed;
- assignment contains an instructor name but no resolvable faculty ID.

For large changes, the UI requires stronger confirmation. Initial conservative thresholds may be fixed in code, for example:

- more than 10% of sessions would be deleted; or
- total session count would change by more than 20%.

When triggered, the user must type `IMPORT` before continuing.

## 6. Source Fingerprint

Each selected import file receives a deterministic SHA-256 fingerprint over the **raw uploaded file bytes** before JSON parsing or reserialization.

This avoids differences caused by object-key ordering or formatting and guarantees that Resume requires the same source bytes, not merely a semantically similar JSON object or matching filename.

The fingerprint is used to:

- distinguish a resumed import from a different file with the same filename;
- reject a different source file during resume;
- associate the recovery backup with the exact interrupted import;
- identify a source that has already been successfully imported.

Filename alone is never used as import identity.

## 7. Recovery Backup Gate

A recovery backup must be generated before the first teaching-data mutation.

The backup is downloaded to the administrator's browser rather than copied into Firestore. This keeps the design Spark-compatible and avoids duplicating the full teaching dataset inside the production database.

The backup contains at least:

### Metadata

- backup schema version;
- backup ID;
- created timestamp;
- created by UID/name;
- Firebase project identifier;
- intended import ID;
- intended import source fingerprint;
- overall backup fingerprint/hash;
- expected faculty/session counts.

### Faculty teaching fields

For every affected faculty document, preserve only fields the import may modify, including:

- `facultySummary2026_27`;
- `facultySummaryStatus2026_27`;
- `facultySummarySource2026_27`;
- `facultySummaryImportedAt`;
- `facultySummaryImportedBy`;
- legacy teaching-summary compatibility fields that the import deletes or replaces.

The backup does not restore unrelated HR/profile/contact fields.

### Sessions

All current `sessions` documents are included in full, including document IDs.

### Settings

Include the current `settings/faculty_summary_2026_27` document and enough import/source metadata to restore the pre-import teaching-data state.

Derived index documents may be included for diagnosis, but restore correctness is based on canonical source collections followed by index rebuild/verification, not on trusting stale index backups.

### 7.1 Firestore value serialization

The recovery file must preserve Firestore value types needed for a lossless restore. Timestamp values must not silently become ordinary strings.

The backup serializer recursively supports the value types actually present in the backed-up documents, including primitives, arrays, maps, and Firestore Timestamps. Timestamps should use an explicit typed representation containing seconds/nanoseconds (or an equivalent lossless tagged representation).

If an unsupported Firestore value type is encountered, backup generation fails before the maintenance lock is acquired. The implementation must not silently stringify or discard an unsupported value.

The restore decoder reverses the tagged representation before writing Firestore documents.

### 7.2 Backup fingerprint

The backup fingerprint is SHA-256 over a deterministic serialization of the backup payload **excluding the fingerprint field itself**. The serializer must use stable key ordering so validation does not depend on runtime object insertion order.

### Backup confirmation

The system can verify that it generated the JSON, computed the fingerprint, and triggered a browser download. It cannot prove where the user saved the file.

The user must explicitly confirm:

`I have saved the recovery backup.`

Only then may `Start Import` become available.

## 8. Persistent State Model

Use two levels of state.

### 8.1 `settings/system_state`

This lightweight document exposes current maintenance state to the application and Firestore rules.

Representative fields:

```text
teachingDataWriteLocked
maintenanceMode        // none | bulk_import | restore
activeImportId
maintenanceOwnerUid
maintenanceOwnerName
maintenanceStartedAt
lastCompletedImportId
lastCompletedImportAt
```

For backwards-safe rollout, if `settings/system_state` does not yet exist, normal teaching writes are treated as open. Once created, its explicit lock state applies.

### 8.2 `bulk_import_jobs/{importId}`

The import job stores detailed lifecycle and checkpoint state.

`importId` should be a cryptographically strong client-generated identifier, such as `crypto.randomUUID()` where available.

Representative fields:

```text
importId
status
phase
sourceFingerprint
sourceWorkbook
schemaVersion

facultyExpected
sessionExpected
facultyBatchTotal
facultyBatchCompleted
sessionBatchTotal
sessionBatchCompleted
staleExpected
staleBatchTotal
staleBatchCompleted

backupFingerprint
backupCreatedAt

startedBy
startedByName
startedAt
lastUpdatedAt

failedPhase
lastError
failedAt

resumedBy
resumedAt
completedAt
restoredAt
previousCompletedImportId
```

If the stale-session ID list is too large for a safe single document, persist it as chunked documents under:

`bulk_import_jobs/{importId}/stale_batches/{batchId}`.

## 9. Atomic Lock Acquisition

Two administrators must not be able to start separate imports at the same time.

Acquiring maintenance ownership and creating the initial job must therefore be transactionally guarded:

1. Read `settings/system_state`.
2. Confirm there is no active/incomplete maintenance operation.
3. Create/initialize `bulk_import_jobs/{importId}`.
4. Set `teachingDataWriteLocked = true`, `maintenanceMode = bulk_import`, `activeImportId = importId`, and maintenance owner fields.
5. Commit these state changes atomically before the first faculty/session data write.

If the transaction detects an active job, the second start attempt fails cleanly.

## 10. Maintenance Lock

The maintenance lock is acquired before the first faculty/session write.

During maintenance, reads remain available. Teaching-data writes are temporarily restricted.

### Reads that remain available

- sign-in;
- timetable viewing;
- faculty dashboard viewing;
- history/audit viewing;
- AFC viewing/workflows that do not mutate teaching sessions;
- user management;
- read-only change-request access.

### Writes that are blocked during maintenance

- add/edit/delete session;
- apply approved faculty swap;
- apply approved time/session change;
- start another bulk teaching-data import;
- conflicting faculty teaching-data mutations;
- manual derived-index rebuild from normal UI paths.

Creating or rejecting a change request may remain available if it does not mutate the protected teaching dataset; applying an approved request that changes a session is blocked until maintenance ends. Existing stale-request protection remains in force afterward.

The UI displays a common message such as:

> Teaching Data Maintenance in Progress. Teaching and faculty-data editing is temporarily unavailable. Viewing remains available.

### Firestore rule enforcement

The lock must not be UI-only. Firestore rules should check `settings/system_state` before permitting normal writes to protected teaching-data paths.

A rule helper such as `teachingWritesOpen()` may be introduced.

Because the import itself runs in an authenticated browser client, rules cannot cryptographically distinguish the intended import controller from arbitrary code executed by the same Owner / ADFA General identity. The design therefore provides:

- Firestore enforcement against other roles/users;
- UI enforcement against normal edit functions during maintenance;
- the import controller as the intended maintenance-owner write path.

The design must not claim server-trusted import identity where none exists.

## 11. Batch Checkpoints and Idempotency

Each mutating stage is designed to be safely repeatable.

### Faculty phase

- Continue using bounded Firestore batches (existing scale is approximately 350 faculty writes per batch).
- Include the corresponding job checkpoint update in the **same Firestore batch commit** as the data writes.
- This keeps `facultyBatchCompleted` atomic with that batch's mutations.
- Re-running an incomplete batch must produce the same target state and no duplicate records.

### Session phase

- Continue using bounded Firestore batches (existing scale is approximately 300 session writes per batch).
- Sessions use stable document IDs.
- Include `sessionBatchCompleted` in the same Firestore batch commit as the session writes.
- Re-running an incomplete batch is safe because stable document IDs prevent duplicates.

### Stale deletion phase

- Include `staleBatchCompleted` in the same batch as each group of deletions.
- Deleting a document that is already absent is treated as already complete.

Keeping data mutation and checkpoint in one batch avoids ambiguous states where data committed but the checkpoint did not, or vice versa.

Progress must never exist only in JavaScript memory.

## 12. Resume Behavior

When the dashboard sees a non-terminal import state, it must show an incomplete-import recovery panel rather than allowing a new import.

The panel should include:

- import ID;
- source workbook;
- source fingerprint summary;
- started by/at;
- current/failed phase;
- completed batch counters;
- last error;
- Resume and Restore actions for authorized roles.

To resume, the administrator selects the original source JSON again. The new file's SHA-256 must exactly equal the stored `sourceFingerprint`.

If it differs, resume is blocked.

The controller resumes from the first incomplete safe checkpoint. Because checkpoints are committed atomically with their data batches, a batch recorded as complete does not need to be guessed or inferred from browser memory.

## 13. Verification Before Stale Deletion

Stale deletion is forbidden until all incoming faculty/session writes have completed and source verification passes.

At minimum, verify:

- all expected incoming session IDs exist;
- no source session ID is missing;
- expected faculty summaries are present/matched;
- preflight assumptions still hold sufficiently to continue.

Only after this verification passes may the stale-session set be finalized.

## 14. Stale Session Deletion

The stale set is computed once for the job and persisted/frozen before deletion begins.

Deletion is batched and checkpointed with `staleBatchCompleted` in the same batch as the corresponding deletes.

An interruption during deletion remains resumable.

## 15. Final Source Verification

After stale deletion, compare the final Firestore session ID set against the incoming source session ID set.

Count equality alone is not sufficient.

Completion requires:

```text
missingIncomingIds = 0
unexpectedOldIds = 0
```

Additional field-level verification may be added for critical session import metadata.

## 16. Derived Index Completion Gate

After canonical source data verifies:

```text
REBUILDING_INDEXES
    -> VERIFYING_FINAL
```

Workstream 3 establishes the lifecycle hook. Workstream 4 provides the full canonical derived-index verification implementation.

The Workstream 3 implementation must still provide a minimal reliable completion check around the existing index rebuild path (for example, successful rebuild plus basic expected document existence/count/source assertions). It must not mark an import `COMPLETED` merely because a rebuild function was invoked.

Workstream 4 will replace/strengthen that provisional check with canonical build/diff verification without changing the import lifecycle interface.

If a reliable provisional check cannot be implemented without duplicating Workstream 4, the new bulk-import execution path must remain disabled in production until Workstream 4 is connected; the system must not silently weaken the completion gate.

## 17. Recovery Takeover

An incomplete job must not permanently depend on the administrator who originally started it.

Another Owner / ADFA General may use `Take Over Recovery`.

Takeover is transactionally guarded and records:

- previous maintenance owner;
- new maintenance owner;
- takeover timestamp;
- actor;
- required reason/note.

It emits an import-level audit event such as `BULK_IMPORT_RECOVERY_TAKEN_OVER`.

Other roles may see maintenance status but cannot take over, resume, or restore.

## 18. Restore Flow

A restore file is validated before any mutation.

Required checks include:

- supported backup schema;
- expected Firebase project;
- backup ID;
- recomputed backup fingerprint matches the embedded fingerprint;
- backup counts;
- `backupFingerprint` matches the interrupted job;
- intended import fingerprint matches the job being restored.

A restore preview must show the expected effect before confirmation.

The user must type `RESTORE` before the restore begins.

### Restore lifecycle

```text
RESTORING_FACULTY
    -> RESTORING_SESSIONS
    -> REMOVING_POST_BACKUP_SESSIONS
    -> RESTORE_VERIFYING
    -> REBUILDING_INDEXES
    -> RESTORE_FINAL_VERIFY
    -> RESTORED
```

Restore is itself resumable and checkpointed. Restore data batches use the same atomic data+checkpoint pattern as import batches.

An interrupted restore is detected on the next dashboard load and resumed; it is not restarted as an unrelated operation.

### Faculty restore semantics

Restore only the teaching-summary fields captured by the backup. It must not overwrite unrelated profile/HR/contact changes made after the backup.

### Session restore semantics

Decode typed Firestore values and restore complete session documents using their original IDs.

Sessions created by the interrupted import but absent from the backup are removed.

Restore verification requires the final Firestore session ID set to exactly equal the backup session ID set.

## 19. Lock Release Rules

The teaching-data maintenance lock may be released only when the job reaches:

- `COMPLETED`, or
- `RESTORED`.

The following states keep the lock active:

- `FAILED`;
- any applying/verifying/deleting phase;
- any restoring phase.

No `finally { unlock }` behavior is permitted.

The first implementation should not provide a casual `Force Unlock` button. Recovery should proceed through Resume or Restore. Any future administrative recovery unlock must perform explicit consistency checks before releasing the lock.

Lock release should be transactionally coupled to the terminal job-state update so `system_state` and the active job cannot disagree about whether maintenance is complete.

## 20. Audit Model

Do not generate thousands of ordinary per-session history records solely because a bulk import touched thousands of documents.

Store import lifecycle events as immutable child records under:

`bulk_import_jobs/{importId}/events/{eventId}`

Representative event types:

- `BULK_IMPORT_STARTED`;
- `BULK_IMPORT_FAILED`;
- `BULK_IMPORT_RESUMED`;
- `BULK_IMPORT_RECOVERY_TAKEN_OVER`;
- `BULK_IMPORT_COMPLETED`;
- `BULK_IMPORT_RESTORE_STARTED`;
- `BULK_IMPORT_RESTORE_FAILED`;
- `BULK_IMPORT_RESTORED`.

Audit payloads should include the import ID, source name, source fingerprint, relevant counts, actor, timestamps, and failure details when applicable.

Event documents are append-only: authorized users may create them, but updates and deletes are denied.

Imported session documents continue to carry source/import metadata such as `sourceWorkbook`, `sourceSchema`, `bulkImportedAt`, and `bulkImportedBy`.

## 21. UI Behavior

### Healthy state

Show a teaching-data synchronization card with:

- current dataset healthy;
- last completed import date/source;
- action to select a new import file.

### Incomplete state

Show a prominent recovery card with:

- incomplete import warning;
- source;
- phase;
- progress counters;
- last error;
- Resume Import;
- Restore Recovery Backup;
- Take Over Recovery when applicable.

Do not allow `Start New Import` while an incomplete import/restore exists.

## 22. Acceptance Test Matrix

At minimum, automated tests must cover:

| Scenario | Expected result |
|---|---|
| Invalid JSON | Blocked; zero teaching-data writes |
| Wrong schema | Blocked; zero teaching-data writes |
| Duplicate faculty/session IDs | Blocked |
| Unsupported backup value type | Backup blocked; zero teaching-data writes |
| Backup not confirmed | Start Import unavailable |
| Concurrent start attempts | Only one lock/job acquisition succeeds |
| Start import | Lock acquired before first data write |
| Faculty batch failure | Job `FAILED`; lock remains |
| Resume same file | Continues successfully |
| Resume different file | Blocked by raw-file fingerprint |
| Session batch failure | No stale deletion |
| Source verification failure | No stale deletion |
| Stale deletion interruption | Resume continues safely |
| Browser closes/reopens | Incomplete job detected |
| ADFA Regular attempts recovery | Denied |
| Second import attempted | Denied |
| Session edit during maintenance | Denied |
| Swap/session approval mutation during maintenance | Denied/deferred |
| Valid recovery backup | Restore allowed after preview/confirmation |
| Tampered recovery backup | Blocked by recomputed fingerprint |
| Wrong recovery backup | Blocked |
| Restore faculty/session batch failure | Restore remains resumable |
| Restore completes | Session ID set exactly equals backup |
| Import completes | Terminal job + lock release remain consistent |
| Restore completes | Terminal job + lock release remain consistent |

## 23. Failure Injection

Firebase Emulator tests should deliberately fail at representative checkpoints:

- faculty batch 2;
- session batch 3;
- source verification;
- stale deletion;
- provisional derived-index completion check;
- restore faculty phase;
- restore session phase;
- restore deletion phase.

For each failure, verify:

- persisted job phase/status;
- lock remains active;
- completed checkpoint counters are correct;
- resume starts from a safe point;
- stale deletion never starts prematurely;
- no accidental unlock occurs.

These tests must not run destructively against the GitHub Pages live Firebase project.

## 24. Security Rule Requirements

`firestore.rules` must be updated and covered by emulator tests so that:

- only Owner / ADFA General can create/control bulk import jobs and maintenance state;
- normal protected teaching-data writes are rejected during maintenance;
- maintenance state cannot be cleared by unauthorized users;
- import job lifecycle/event records cannot be mutated by unauthorized users;
- lifecycle event records are append-only;
- other normal application reads continue according to existing permissions;
- the existing role vocabulary and legacy aliases remain unchanged;
- rule changes do not broaden ordinary faculty access to confidential faculty data.

Because the rules will depend on the new maintenance documents, rollout must be backwards safe. The missing-`system_state` case remains unlocked, allowing Firestore rules to be deployed before the new UI/controller. Production UI that relies on maintenance enforcement must not be released before the corresponding rules have been deployed and emulator-verified.

## 25. Implementation Boundaries

Likely files/modules to be touched or introduced during implementation include:

- `faculty-admin.js` - UI integration only, not the full import state machine;
- a dedicated bulk-import controller/module for preflight, lifecycle, checkpoints, resume and restore;
- a small deterministic serialization/fingerprint helper if separation improves testability;
- `faculty-admin.html` - synchronization/recovery UI;
- `firestore.rules` - maintenance and job permissions;
- `data-index.js` / index maintenance integration hook as needed;
- new unit/behavior tests;
- `tests/security-emulator.test.js` or dedicated emulator tests for maintenance-rule behavior;
- `SETUP.md` for operator recovery instructions.

Exact file decomposition and function signatures will be fixed in the implementation plan after this written design is approved.

## 26. Success Criteria

Workstream 3 is complete when:

1. An import cannot mutate teaching data before preflight and backup confirmation.
2. Raw source bytes are fingerprinted and Resume requires the exact same source fingerprint.
3. A lossless typed recovery backup is generated before maintenance begins, and unsupported backup values fail safely.
4. Maintenance lock/job acquisition is transactionally guarded against concurrent starts.
5. Import progress survives browser closure and is visible on reopen.
6. Data batches and their checkpoints are committed atomically.
7. A failed import never silently presents itself as complete.
8. Stale sessions cannot be deleted before all incoming sessions are written and verified.
9. An interrupted stale deletion is resumable.
10. A validated, untampered recovery backup can restore pre-import session state and faculty teaching-summary fields.
11. Restore itself is resumable and uses atomic data+checkpoint batches.
12. Normal teaching-data writes are blocked during maintenance by both UI behavior and Firestore rules where enforceable.
13. Only Owner / ADFA General can start, resume, take over, or restore.
14. The maintenance lock is released only after `COMPLETED` or `RESTORED`, transactionally consistent with the job state.
15. Import lifecycle events are append-only and auditable.
16. Failure injection and security emulator tests pass.
17. `npm test` and `npm run test:emulator` pass before the implementation PR is presented for browser review.
18. Workstream 4 can replace the provisional derived-index completion check with canonical verification without redesigning the import lifecycle.
