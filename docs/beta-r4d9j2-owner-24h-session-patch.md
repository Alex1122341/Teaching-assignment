# BETA-R4D-9J2 — owner-provided 24-hour session-time patch

**Date:** 2026-09-27
**Repository:** `Alex1122341/Teaching-assignment-azure`
**Base:** `main` @ `aa49a56db9f6cc75a3b3e7a368f4c056e3a28172`
**Branch:** `feature/beta-r4d9j2-owner-24h-session-patch`
**Supersedes:** BETA-R4D-9J (PR #20, already merged)

## Why this task exists

BETA-R4D-9J reconciled session times from *derived* evidence (an outside-Git
timetable workbook matched on date + course + type + topic) and produced a
**423-entry inferred correction manifest**. That manifest was applied to live
SQL and PR #20 was merged.

The owner then supplied a strictly better artifact:

> `PAWS_Faculty_Summaries_SQL_24h.csv`
> SHA-256 `de62f81cfed0bcd3a79f70a34bc6a6c352a2b68770fafa52c0516ce614ad4cde`
> 35,745 bytes, 224 rows, explicit 24-hour SQL-compatible times.

This file is **authoritative and explicit** — it does not require inference.
R4D-9J2 replaces the inferred correction set with this source for the SessionIds
it covers.

## Authoritative precedence

For the 224 exact SessionIds in the CSV, the CSV wins over any prior inferred or
derived value. Sources are never combined or averaged.

## Matching rule

Exact `SessionId` only, compared as case-insensitive UUID text.
No fuzzy matching. No SessionId regeneration.

> **Format trap:** the CSV emits **UPPERCASE** UUIDs while the prior manifest used
> **lowercase**. Comparison must normalise case or the match count is zero.

## Reconciliation result (read-only, pre-apply)

| Metric | Value |
|---|---:|
| CSV rows | 224 |
| CSV unique SessionIds | 224 |
| Live SQL matched SessionIds | **224** |
| Missing SessionIds | **0** |
| Material identity mismatches | **0** |
| Current SQL already equal to CSV | **179** |
| Current SQL differing from CSV | **45** |
| Prior 423-manifest overlap | 96 |
| Overlap where prior == CSV | **96** |
| Overlap where prior != CSV | **0** |
| CSV SessionIds absent from prior manifest | 128 |
| Prior manifest entries deferred (not in CSV) | 327 |

Two gate conditions were required to proceed and both passed:
`matched == 224` and `material identity mismatches == 0`.

### Material vs non-material identity

The five material identity fields —
`AcademicYear`, `CurriculumYear`, `CourseCode`, `SessionType`, `SessionDate` —
matched **224/224 exactly, with no normalisation**. `CourseName` also matched
224/224.

`Topic` differed on 35 rows, but every difference is a **non-material formatting
artifact**:
- **33** are whitespace-only. The CSV exporter dropped the space before an
  opening parenthesis: `"Sundre Orientation Camp (Full Day)"` vs
  `"Sundre Orientation Camp(Full Day)"`. Identical once all whitespace is removed.
- **2** are SQL storing the literal string `"0"` where the source Topic was
  genuinely blank (`15FF5C4B…`, `15ADFE68…`). A source-data placeholder.

Decision: `Topic` is compared after whitespace normalisation and the known
`"0"`-vs-blank placeholder is treated as equivalent. Documented rather than
silent, and justified because (a) no material identity field disagrees anywhere,
(b) `CourseName` matches exactly, (c) the upstream `canonical_session_key()`
already normalises topic similarly and the SessionIds were generated under that
contract, and (d) this task never modifies `Topic`.

## The 45 corrections

39 rows are the classic AM→PM shift (`+12h`); 6 rows repair a reversed interval
where the end time had wrapped past midnight (`08:30→04:30` → `08:30→16:30`).
All 45 become grid-positionable inside the 07:30–17:00 calendar window.

## Mutation boundary

The only statement the operator executes is:

```sql
UPDATE paws.Session
SET StartTime = @newStart,
    EndTime   = @newEnd
WHERE SessionId = @sessionId
  AND StartTime = @oldStart
  AND EndTime   = @oldEnd;
```

`UpdatedAtUtc` is **never** touched — the script contains no reference to
`UpdatedAtUtc`, `SYSUTCDATETIME` or `GETUTCDATE` at all, and a regression test
asserts this. The exact-old-interval guard also makes per-row affected count
`== 1` provable, which the script enforces.

## Retirement of the obsolete default

`tools/repair_paws_session_times.ps1` previously defaulted to the 423-entry
inferred manifest, which could have been re-applied by mistake. The default now
points at the CSV-backed patch. The old set is preserved under
`tools/azure_sql_migration/corrections_history/session_time_corrections_423_superseded.json`
as history only, and a test asserts it is not the default path.

> The previous 423 correction proposal was superseded before this live SQL apply
> by the owner-provided explicit 24-hour Faculty Summaries patch.

## Live apply

- Backup: `PAWS_BETA_R4D9J2_OPERATOR_BACKUP.csv`, SHA-256
  `03d8bb79ea64daa1a115727abcbe52e08bce39d74729e02927a1b137c746f040`
  (written by the operator; refuses to overwrite an existing path).
- A pre-apply independent backup was also taken at
  `PAWS_BETA_R4D9J2_24H_SQL_TIME_BACKUP.csv`, SHA-256
  `947265f97c506c1a8eca1d8e3d33394275dd4b6c7c1362f1bd1eded63a74138c`.
- Single transaction, `rowsUpdated = 45`, `rowsInserted = 0`, `rowsDeleted = 0`,
  `transaction = COMMITTED`.

Apply in **one transaction**. Any row whose affected count is not 1, or whose
total does not equal the preview diff count, must roll back.

## Rebuild / reproducibility

The CSV is the source of truth for the 45 changed rows. Future normalization and
import must not reintroduce the bad values; the manifest is generated directly
from `live pre-patch SQL + the owner CSV` and is keyed by existing SessionId, so
replay reproduces the same end state. The correction architecture remains:

```
original canonical source
  → canonical_session_key()
  → stable SessionId
  → exact SessionId correction
  → final StartTime / EndTime
```

`canonical_session_key()` is **unchanged**.

## Scope boundaries

- Only `paws.Session.StartTime` / `EndTime` change.
- No frontend file, no `timetable.js`, no R4D-9G behavior.
- No SWA deployment.
- `paws.Session` = 1937 and `paws.SessionAssignment` = 4970 before and after.
- SessionId set unchanged; no rows inserted or deleted.

## Rows NOT in the CSV

The 327 prior-manifest entries whose SessionIds are absent from the 224-row CSV
are **deferred, not applied**. This operation is an exact CSV patch, not a
re-apply of every earlier inferred reconciliation.

The CSV is a **partial** patch: it resolves the SessionIds it names. It does not
claim to resolve all remaining Check-needed sessions.
