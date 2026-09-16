# Safe Bulk Import Recovery Design

Date: 2026-09-16
Repository: `Alex1122341/Teaching-assignment`
Workstream: 3 - Safe bulk import
Status: Approved design; implementation plan ready

## 1. Purpose

The current `importSummaryJson()` flow performs a sequence of independent Firestore batch writes: faculty summaries are updated, incoming sessions are written, stale sessions are deleted, metadata and audit logs are written, and the admin dataset / derived indexes are refreshed. Each batch is individually atomic, but the overall import is not. A browser close, network interruption, permission failure, or write failure can therefore leave the database in a mixed partial state.

This design makes the import resumable, recoverable, auditable, and safe for the existing client-only Firebase Spark architecture. It does not pretend that a multi-thousand-write browser import can become one Firestore transaction.

The selected recovery model is:

**Resume by default + manual recovery backup restore when needed.**

A normal interruption should resume from a safe checkpoint. A backup restore is reserved for an incorrect source file, unrecoverable verification failure, abandoned import, or management decision to revert.

## 2. Scope

Workstream 3 is responsible for preflight validation, raw-file fingerprinting, mandatory recovery backup generation, persisted import jobs/checkpoints, maintenance locking, resumable faculty/session/stale-delete phases, source verification, resumable restore, takeover, audit events, emulator failure injection, and the integration boundary for derived-index verification.

Workstream 4 remains responsible for the full canonical build/diff/verify/rebuild implementation for `faculty_index`, `schedule_stats`, `faculty_swap_index`, and `faculty_swap_map`.

## 3. Constraints

- `main` remains the production source of truth; feature work uses branch/PR flow.
- Frontend remains vanilla HTML/CSS/JavaScript.
- Firebase Authentication + Cloud Firestore remain the backend.
- Production stays Spark-compatible; no Cloud Functions are introduced.
- Firestore rules remain the security boundary.
- Only Owner / ADFA General may start, resume, restore, or take over an import.
- Destructive/failure-injection testing uses Firebase Emulator only because Pages shares live Firebase.

## 4. Import Lifecycle

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

```text
FAILED -> RESUME SAME IMPORT
FAILED -> RESTORE RECOVERY BACKUP
```

Only `COMPLETED` or `RESTORED` may release the teaching-data maintenance lock.

## 5. Preflight

Preflight performs zero teaching-data writes and shows source workbook/schema, source/current faculty/session counts, estimated updates, no-source faculty, creates/updates, stale deletes, warnings, and blocking errors.

Hard failures include invalid JSON, unsupported schema, missing arrays, duplicate faculty/session IDs, missing session IDs, repeated UCIDs, structurally incomplete source data, another active/incomplete import, or attempting to start an already-completed identical source as a new job.

Warnings include no-source faculty, meaningful session-count decreases, many stale sessions, source workbook change, or assignment names lacking a resolvable faculty ID.

When more than 10% of current sessions would be deleted or total session count changes by more than 20%, the user must type `IMPORT` before continuing.

## 6. Source Identity

The source fingerprint is SHA-256 over the raw uploaded file bytes. Filename is not identity. Resume is allowed only when the reselected source file produces the exact stored fingerprint.

## 7. Recovery Backup

Before the first teaching-data mutation, the browser must generate and download a recovery JSON containing:

- backup schema/ID;
- creator/timestamp/project/import identity;
- intended source fingerprint;
- backup fingerprint;
- affected faculty teaching-summary fields;
- complete current session documents including IDs;
- current `settings/faculty_summary_2026_27`;
- expected counts.

The serializer must preserve supported Firestore types present in the captured data, at minimum `Timestamp`. Unsupported non-plain values block backup/import rather than being silently stringified.

The user must explicitly confirm `I have saved the recovery backup.` before Start Import becomes available.

## 8. Persistent State

`settings/system_state` stores lightweight global maintenance state:

```text
teachingDataWriteLocked
maintenanceMode
activeImportId
maintenanceOwnerUid
maintenanceOwnerName
maintenanceStartedAt
lastCompletedImportId
lastCompletedImportAt
```

`bulk_import_jobs/{importId}` stores detailed job phase/status, source fingerprint/workbook/schema, expected counts, batch totals/completed counters, backup fingerprint, actor/timestamps, failure details, resume details, and terminal timestamps.

Stale session IDs are frozen as chunk documents under `bulk_import_jobs/{importId}/stale_batches/{batchId}` rather than an unbounded array on the job document.

## 9. Maintenance Lock

Lock acquisition occurs before the first faculty/session write and must use a Firestore transaction so two General administrators cannot start competing imports.

Reads remain available. Normal timetable/session/faculty teaching-data mutations, change-request application, another teaching-data import, and normal derived-index rebuild actions are blocked while locked.

The UI displays:

> Teaching Data Maintenance in Progress. Teaching and faculty-data editing is temporarily unavailable. Viewing remains available.

Rules also enforce the lock. Because the import executes in an authenticated browser, rules cannot cryptographically distinguish the intended controller from arbitrary code running under the same maintenance-owner identity; the design explicitly does not claim server-trusted import identity.

## 10. Atomic Checkpoints and Idempotency

For every faculty/session/stale-delete/restore batch, the data changes and matching completed-batch checkpoint commit in the same Firestore batch.

Current batch scales remain approximately 350 faculty, 300 incoming sessions, and 350 stale deletes.

Stable session IDs make repeated writes idempotent. Progress never exists only in JavaScript memory.

## 11. Resume

An incomplete job shows a recovery panel instead of allowing a new import. Resume requires the original source JSON and exact raw-byte fingerprint match. The controller continues from persisted completed-batch counters; re-running a known-idempotent completed batch is allowed only when correctness is preserved.

## 12. Verification Before Deletion

Stale deletion is forbidden until all incoming faculty/session writes have completed and source verification succeeds.

Verification confirms all expected incoming session IDs exist and expected faculty summary state matches the source. Only then is the stale set frozen and deletion allowed.

## 13. Stale Deletion

The stale set is computed once, chunked, persisted, and then deleted in checkpointed batches. Deleting an already-absent document is treated as already complete rather than fatal.

## 14. Final Source Verification

After stale deletion, final Firestore session IDs must exactly match incoming source session IDs:

```text
missingIncomingIds = 0
unexpectedOldIds = 0
```

Count equality alone is insufficient.

## 15. Derived Index Gate

After source data verifies, Workstream 3 performs a real provisional derived-index verification before completion. It rebuilds/reads back the four current derived docs and verifies canonical `faculty_index`/`schedule_stats` plus basic structural consistency of the swap index/map. Workstream 4 replaces this verifier through the same interface with the full canonical implementation.

## 16. Recovery Takeover

Another Owner / ADFA General can take over an incomplete recovery with a required reason. The system records previous/new owner, actor, timestamp, and `BULK_IMPORT_RECOVERY_TAKEN_OVER` event without changing the active import or phase.

## 17. Restore

Restore validates backup schema/project/ID/fingerprint/counts and verifies that both the backup fingerprint and intended source fingerprint belong to the interrupted job. The user previews the effect and must type `RESTORE` before writes begin.

Restore lifecycle:

```text
RESTORING_FACULTY
  -> RESTORING_SESSIONS
  -> REMOVING_POST_BACKUP_SESSIONS
  -> RESTORE_VERIFYING
  -> REBUILDING_INDEXES
  -> RESTORE_FINAL_VERIFY
  -> RESTORED
```

Restore is resumable and follows the same atomic data+checkpoint rule.

Faculty restore touches only captured teaching-summary fields. Session restore writes full backed-up documents by original ID, then removes sessions absent from the backup. Final session IDs must exactly equal the backup set.

## 18. Lock Release

The lock is released only for `COMPLETED` or `RESTORED`. Terminal job update and system-state unlock commit atomically. `FAILED` and all applying/verifying/deleting/restoring phases keep the lock active. No casual Force Unlock is included.

## 19. Audit

Import lifecycle audit is append-only under `bulk_import_jobs/{importId}/events/{eventId}` with events including STARTED, FAILED, RESUMED, RECOVERY_TAKEN_OVER, COMPLETED, RESTORE_STARTED, RESTORE_FAILED, and RESTORED.

Bulk import does not generate thousands of normal per-session history rows solely because the import touched those sessions. Imported sessions retain source/import metadata.

## 20. UI States

Healthy state shows current dataset health, last completed import date/source, and Select New Import File.

Incomplete state shows import/source/phase/progress/error plus Resume, Restore, and Take Over Recovery where authorized. A new import cannot start while an incomplete job exists.

## 21. Required Acceptance Coverage

Automated tests cover invalid JSON/schema/duplicates, mandatory backup confirmation, transactional lock, concurrent-start rejection, failure after earlier faculty/session/stale batches, same/different source resume, source verification gate, browser reopen recovery, role restrictions, normal edit blocking, correct/wrong backup restore, unsupported backup values, resumable restore, exact restored ID set, atomic terminal unlock, and append-only lifecycle events.

Failure injection includes faculty/session/stale-delete/index/restore stages and verifies lock persistence, correct phase/status, atomic checkpoints, safe resume, and no premature deletion/unlock.

## 22. Rollout Ordering

Rules treat missing `settings/system_state` as unlocked so reviewed rules can be deployed before the new static UI/controller. The production UI must not be considered protected by maintenance enforcement until the matching reviewed rules are deployed and verified.

## 23. Completion Criteria

Workstream 3 is complete only when preflight, mandatory recovery backup, raw fingerprint resume, transactional lock, atomic checkpoints, pre-delete verification, resumable import/restore, exact final ID verification, UI+rules write blocking, atomic terminal unlock, append-only audit, failure injection, and full unit/emulator verification all pass.

The implementation plan is stored at:

`docs/superpowers/plans/2026-09-16-safe-bulk-import-recovery.md`
