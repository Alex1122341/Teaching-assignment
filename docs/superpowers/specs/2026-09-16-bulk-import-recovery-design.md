# Safe Bulk Import Recovery Design

Date: 2026-09-16
Repository: `Alex1122341/Teaching-assignment`
Workstream: 3 - Safe bulk import
Status: Approved design; implementation plan approved for execution handoff

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

Each import file receives a deterministic SHA-256 fingerprint derived from the raw uploaded file bytes.

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

### Backup type preservation

Backup serialization must preserve the Firestore value types actually present in the captured teaching data. At minimum, Firestore `Timestamp` values must round-trip without becoming strings. If the serializer encounters an unsupported non-plain Firestore/object value, backup generation must stop before the import instead of silently producing a lossy file.

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

### 8.2 `bulk_import_jobs/{importId}`

The import job stores detailed lifecycle and checkpoint state.

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

Persist stale-session IDs as chunked documents under:

`bulk_import_jobs/{importId}/stale_batches/{batchId}`.

This avoids relying on a potentially large array inside the job document and freezes the exact deletion set used by Resume.

## 9. Maintenance Lock

The maintenance lock is acquired before the first faculty/session write.

Lock acquisition must use a Firestore transaction so two administrators cannot both observe an unlocked system and start competing imports.

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

## 10. Batch Checkpoints and Idempotency

Each mutating stage is designed to be safely repeatable.

### Atomic checkpoint rule

For every faculty/session/stale-delete/restore batch, the data writes and the corresponding completed-batch checkpoint must be written in the same Firestore batch commit. The system must not first commit data and then separately increment the checkpoint, because that creates an ambiguous recovery boundary.

### Faculty phase

- Continue using bounded Firestore batches (existing scale is approximately 350 records per batch).
- After each successful batch, persist `facultyBatchCompleted` in that same commit.
- Re-running the same batch must produce the same target state and no duplicate records.

### Session phase

- Continue using bounded Firestore batches (existing scale is approximately 300 records per batch).
- Sessions use stable document IDs.
- After each successful batch, persist `sessionBatchCompleted` in that same commit.
- Re-running a completed batch is harmless because the same document ID is overwritten with the same intended content.

Progress must never exist only in JavaScript memory.

## 11. Resume Behavior

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

To resume, the administrator selects the original source JSON again. The new file's raw-byte SHA-256 must exactly equal the stored `sourceFingerprint`.

If it differs, resume is blocked.

The controller resumes from the first incomplete safe checkpoint. Re-running an already completed idempotent batch is acceptable when that simplifies correctness.

## 12. Verification Before Stale Deletion

Stale deletion is forbidden until all incoming faculty/session writes have completed and source verification passes.

At minimum, verify:

- all expected incoming session IDs exist;
- no source session ID is missing;
- expected faculty summaries are present/matched;
- preflight assumptions still hold sufficiently to continue.

Only after this verification passes may the stale-session set be finalized.

## 13. Stale Session Deletion

The stale set is computed once for the job, chunked, and persisted/frozen before deletion begins.

Deletion is batched and checkpointed with `staleBatchCompleted`; the delete writes and checkpoint update share the same Firestore batch.

Deleting a document that is already absent is treated as already complete rather than a fatal condition.

An interruption during deletion remains resumable.

## 14. Final Source Verification

After stale deletion, compare the final Firestore session ID set against the incoming source session ID set.

Count equality alone is not sufficient.

Completion requires:

```text
missingIncomingIds = 0
unexpectedOldIds = 0
```

Additional field-level verification may be added for critical session import metadata.

## 15. Derived Index Completion Gate

After canonical source data verifies:

```text
REBUILDING_INDEXES
    -> VERIFYING_FINAL
```

Workstream 3 establishes the lifecycle hook and must perform a real provisional verification before declaring the import complete. The provisional verifier should at least rebuild/read back the four current derived documents and validate canonical `faculty_index`/`schedule_stats` content plus the presence/basic structural consistency of `faculty_swap_index` and `faculty_swap_map`.

Workstream 4 provides the full canonical derived-index build/diff/verify/repair implementation and replaces the provisional verifier through the same interface.

An import may reach `COMPLETED` only after source data verifies and the currently available derived-index verifier passes.

## 16. Recovery Takeover

An incomplete job must not permanently depend on the administrator who originally started it.

Another Owner / ADFA General may use `Take Over Recovery`.

Takeover records:

- previous maintenance owner;
- new maintenance owner;
- takeover timestamp;
- actor;
- required reason/note.

It emits an import-level audit event such as `BULK_IMPORT_RECOVERY_TAKEN_OVER`.

Other roles may see maintenance status but cannot take over, resume, or restore.

## 17. Restore Flow

A restore file is validated before any mutation.

Required checks include:

- supported backup schema;
- expected Firebase project;
- backup ID;
- backup fingerprint validity;
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

Restore is itself resumable and checkpointed. An interrupted restore is detected on the next dashboard load and resumed; it is not restarted as an unrelated operation.

Restore batches follow the same atomic data+checkpoint rule as import batches.

### Faculty restore semantics

Restore only the teaching-summary fields captured by the backup. It must not overwrite unrelated profile/HR/contact changes made after the backup.

### Session restore semantics

Restore complete session documents using their original IDs.

Sessions created by the interrupted import but absent from the backup are removed.

Restore verification requires the final Firestore session ID set to exactly equal the backup session ID set.

## 18. Lock Release Rules

The teaching-data maintenance lock may be released only when the job reaches:

- `COMPLETED`, or
- `RESTORED`.

The terminal job-state update and system-state unlock must be committed atomically so the system cannot advertise an unlocked state while the job still appears non-terminal, or vice versa.

The following states keep the lock active:

- `FAILED`;
- any applying/verifying/deleting phase;
- any restoring phase.

No `finally { unlock }` behavior is permitted.

The first implementation should not provide a casual `Force Unlock` button. Recovery should proceed through Resume or Restore. Any future administrative recovery unlock must perform explicit consistency checks before releasing the lock.

## 19. Audit Model

Do not generate thousands of ordinary per-session history records solely because a bulk import touched thousands of documents.

Create import-level events such as:

- `BULK_IMPORT_STARTED`;
- `BULK_IMPORT_FAILED`;
- `BULK_IMPORT_RESUMED`;
- `BULK_IMPORT_RECOVERY_TAKEN_OVER`;
- `BULK_IMPORT_COMPLETED`;
- `BULK_IMPORT_RESTORE_STARTED`;
- `BULK_IMPORT_RESTORE_FAILED`;
- `BULK_IMPORT_RESTORED`.

Store these as append-only job lifecycle events (for example under `bulk_import_jobs/{importId}/events/{eventId}`) so an event cannot be silently rewritten after the fact.

Audit payloads should include the import ID, source name, source fingerprint, relevant counts, actor, timestamps, and failure details when applicable.

Imported session documents continue to carry source/import metadata such as `sourceWorkbook`, `sourceSchema`, `bulkImportedAt`, and `bulkImportedBy`.

## 20. UI Behavior

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

## 21. Acceptance Test Matrix

At minimum, automated tests must cover:

| Scenario | Expected result |
|---|---|
| Invalid JSON | Blocked; zero teaching-data writes |
| Wrong schema | Blocked; zero teaching-data writes |
| Duplicate faculty/session IDs | Blocked |
| Backup not confirmed | Start Import unavailable |
| Start import | Lock acquired before first data write |
| Two General admins start concurrently | Only one transaction acquires the active lock |
| Faculty batch failure | Job `FAILED`; lock remains; committed batches have matching checkpoints |
| Resume same file | Continues successfully |
| Resume different raw file | Blocked by fingerprint |
| Session batch failure | No stale deletion |
| Source verification failure | No stale deletion |
| Stale deletion interruption | Resume continues safely |
| Browser closes/reopens | Incomplete job detected |
| ADFA Regular attempts recovery | Denied |
| Second import attempted | Denied |
| Session edit during maintenance | Denied |
| Swap/session approval mutation during maintenance | Denied/deferred |
| Valid recovery backup | Restore allowed after preview/confirmation |
| Wrong recovery backup | Blocked |
| Unsupported value in backup dataset | Backup/import blocked before first data mutation |
| Restore faculty/session batch failure | Restore remains resumable with atomic checkpoint |
| Restore completes | Session ID set exactly matches backup |
| Completed import | Job terminal state + lock release are atomic |
| Completed restore | Job terminal state + lock release are atomic |
| Import lifecycle event written | Event cannot be updated/deleted |

## 22. Failure Injection

Failure-injection tests run against a deterministic test harness and the Firebase Emulator, never the shared live Pages Firebase project.

Inject failures at least at:

- faculty batch after one earlier batch commits;
- session batch after one earlier batch commits;
- source verification;
- stale deletion after one earlier delete batch commits;
- derived-index rebuild/verification;
- restore faculty batch;
- restore session batch;
- restore post-backup deletion;
- restore verification.

After each injected failure verify:

- job phase/status are correct;
- lock remains active;
- last committed data batch has its matching checkpoint;
- Resume starts from a safe point;
- no stale deletion starts before source verification;
- no failed/partial job accidentally releases the lock.

## 23. Rules / UI Rollout Ordering

`firestore.rules` is deployed separately from the static site.

Rules should treat a missing `settings/system_state` document as the normal unlocked legacy state so the rules can be deployed safely before the new UI/controller is published.

The static implementation that relies on the maintenance lock must not be considered production-ready until the matching reviewed rules have been deployed and verified.

## 24. Completion Criteria

Workstream 3 is complete when all of the following are true:

1. Preflight blocks malformed/unsafe sources before mutation.
2. Backup download/confirmation is mandatory before lock acquisition and first teaching-data write.
3. Raw source fingerprint controls resume identity.
4. Maintenance lock acquisition is transactional.
5. Faculty/session/stale-delete data writes share an atomic commit with their checkpoints.
6. Stale deletion cannot begin before incoming data verification.
7. Browser interruption leaves a recoverable job and active lock.
8. Resume with the original source completes correctly.
9. Restore with the matching backup is resumable and restores the exact pre-import session ID set plus captured faculty teaching fields/settings.
10. Other teaching-data mutations are blocked during maintenance by both UI and Firestore rules.
11. Terminal status and lock release are atomic.
12. Import lifecycle events are append-only and auditable.
13. Failure injection and security emulator tests pass.
14. `npm test` and `npm run test:emulator` pass before the implementation PR is presented for browser review.
15. Workstream 4 can plug its canonical derived-index verifier into the prepared completion gate without redesigning the import lifecycle.

## 25. Implementation Plan

The approved implementation plan is stored at:

`docs/superpowers/plans/2026-09-16-safe-bulk-import-recovery.md`
