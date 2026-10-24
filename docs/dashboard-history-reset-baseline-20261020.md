# Dashboard History one-time presentation baseline — 2026-10-20

## Owner-authorized requirement

Earlier Dashboard History records (6,000+ previously displayed) must not appear in the operational Dashboard. Fix the baseline to the University host's UTC **2026-10-20T21:13:42.660Z**. New operations occurring at or after that exact instant appear normally, grouped by the reviewed operation key. Existing SQL source audit evidence is not deleted, truncated, rewritten, imported or recreated.

This is a **presentation timestamp baseline** rather than a claim that the full current business state was snapshotted or that earlier field changes can be reconstructed. It preserves the existing current business state and establishes a new beginning for the Dashboard timeline.

## Implementation

- Scope is exactly `scope=dashboard`; `scope=mine` and `scope=timetable` continue to show their original authorized record histories.
- The immutable UTC instant is encoded in the protected API source and cannot be overridden by client fields, dates or calendar-year filters.
- The repository binds the trusted `@StartUtc` to the exact millisecond baseline (or later user date filter) and `@EndExclusiveUtc` no later than tomorrow UTC, avoiding the original SQL ten-year read cap for an open-ended Dashboard query. A filter ending before baseline returns an authorized empty snapshot.
- Server-side projection independently excludes pre-baseline or malformed-timestamp events before group, facet, pagination, CSV and Excel generation.
- Dashboard UI displays the fixed Calgary-local reset time and explains that older SQL audits remain preserved.
- Frontend filters may narrow post-baseline results but never widen them backwards.
- Runtime authorization, faculty privacy, snapshots, spreadsheet escaping, 27 write gates, all AFC/DOE/scheduling data and all SQL procedures remain unchanged.

## Rollback and integrity

No SQL DDL/DML is part of this change. Preserve all records in `paws.AuditEvent`, `paws.DoeAuditEvent`, `paws.ChangeHistoryContext` and work import receipts. Reverting to the previous immutable runtime restores the old Dashboard view without restoring any deleted source records because none were deleted.

Verify new baseline and grouped behavior in unit/API/SQL adapter and live authenticated Dashboard queries; verify live event counts/data fingerprints are unchanged. Do not create synthetic production writes to test the reset. Frozen product/Hosting/API artifact checks, correct frontend/API release ordering and tested rollback are required before declaring a real-data deployment complete.

## Acceptance contract

1. Dashboard only; immutable `2026-10-20T21:13:42.660Z` threshold, exact inclusive boundary, strict SQL timestamp read bound.
2. Previously recorded/malformed Dashboard event timestamps are excluded, with no source deletion.
3. Future/new records at/after threshold display; grouping, pages and CSV/XLSX use bounded authorized snapshots.
4. Before-baseline end filters return no rows and do not raise SQL range exceptions.
5. My Change History and Calendar Changes behavior remains unchanged.
6. No browser-supplied override, permission elevation, DOE publication, SQL migration or write-gate change.

## Separate immutable-freeze promotion

- Previous trust anchor: `fe1fa7002ef956f02e767053fbe2f6fea8daf748`.
- Reviewed product SHA: `573dbe468eb23b177d92317f9a6e3ec04d2c94ec` (distinct from the later docs and governance commits).
- Exactly two protected static changes: `change-history.js`, `change-history.css`; static manifest remains 81.
- Exactly two protected API changes: `server/src/history/change-history-api.js`, `server/src/data/sql-change-history-repository.js`; protected server runtime path count remains 104.
- All prior reviewed static/runtime Git-object source snapshots remain protected. The new SHA-256 manifest reporting entries for the two changed static files derive from the reviewed product blobs; no freeze exceptions, allowlists or bypasses.
- Governance tests pin the exact two-plus-two source path delta and verify every unchanged protected blob across old/new anchors.
