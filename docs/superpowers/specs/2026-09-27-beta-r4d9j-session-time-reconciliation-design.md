# BETA-R4D-9J Authoritative Session-Time Reconciliation Design

## Scope

Repair only `paws.Session.StartTime` and `paws.Session.EndTime` when the 2026-09-27 UCVM timetable deterministically identifies the existing PAWS session. Preserve all 1,937 session identities and assignment relationships. The existing R4D-9G calendar disposition behavior remains unchanged.

## Source precedence and provenance

1. `ucvm_timetable_master_2026-09-27.xlsx` supplies authoritative timetable intervals.
2. `ucvm-filtered-timetable.csv` supplies the 1,937 current PAWS session identities and values.
3. `PAWS_session_audit_FINAL_2026-09-27.xlsx` supplies supporting comparison evidence.
4. `PAWS_Faculty_Workload_Normalized.xlsx` may be used only as lower-priority context and must never independently turn an AM-looking value into PM.

Every generated result records source filenames and SHA-256 hashes. Source workbooks, reconciliation exports, and SQL backup files remain outside Git.

## Deterministic reconciliation

Normalize match fields without changing source values:

- dates to `YYYY-MM-DD`;
- course codes to trimmed text;
- session-type aliases to the controlled PAWS vocabulary;
- topics by Unicode normalization, case folding, whitespace collapse, quote/dash normalization, and a small reviewed alias table.

Match on date, course, session type, and normalized topic. An optional exact instructor/context discriminator may resolve a remaining collision. No edit-distance or probabilistic fuzzy match is allowed.

Classify every current session as one of:

- `MATCH_ALREADY_CORRECT`
- `DETERMINISTIC_TIME_CORRECTION`
- `UNKNOWN_TIME_CONFIRMED_BY_TIMETABLE`
- `SOURCE_AMBIGUOUS`
- `NO_TIMETABLE_MATCH`
- `MULTIPLE_TIMETABLE_MATCHES`
- `LEGITIMATE_OUT_OF_WINDOW`
- `OTHER_DATA_DEFECT`

A correction is emitted only for a unique source match with an exact authoritative start and end. `00:00` remains unchanged unless that same rule is satisfied. Multiple candidates fail closed.

## Stable identity and correction contract

`canonical_session_key()` is unchanged. Normalization continues to derive `SessionId` from the original source row, including its original time. Only after `SessionId` is resolved does the correction layer replace the normalized payload's `start` and `end` values.

The version-controlled `session_time_corrections.json` is keyed by existing `SessionId`. Each entry contains old and new times plus non-PII evidence fields. Loading validates:

- schema/version;
- unique IDs;
- canonical time format and a forward interval;
- old and new intervals differ;
- every correction is consumed exactly once by the normalized session set.

Unknown, duplicate, malformed, stale, or unused entries fail closed.

## Operator repair

The repair command defaults to preview. `--apply` is required to mutate Azure SQL. It:

1. connects through the existing approved Entra device-code path;
2. validates the target database;
3. reads all affected rows and compares exact old times;
4. exports the pre-update rows to `PAWS_BETA_R4D9J_SQL_TIME_BACKUP.csv` and records SHA-256;
5. opens one transaction;
6. updates only `StartTime` and `EndTime`, keyed by exact `SessionId`;
7. requires updated-row count to equal manifest count and rechecks session/assignment/identity invariants;
8. commits only when every check passes, otherwise rolls back.

The backup is sufficient to generate an exact rollback keyed by `SessionId`.

## Reconciliation workbook

The outside-Git workbook contains one row for each of the 1,937 sessions and a summary sheet with source hashes, quality counts, and a classification legend. It contains no account data or unnecessary faculty PII. The workbook is recalculated, formula-scanned, rendered, and visually inspected before use.

## Acceptance

- 1,937 sessions before and after.
- Identical `SessionId` set.
- 4,974 assignment relationships before and after, subject to live verification.
- Zero session inserts/deletes.
- Only approved time pairs differ in a temporary rebuild.
- SQL/API returns corrected values directly; no frontend, Firestore, auth, networking, DOE, AFC, role, or user-profile change.

