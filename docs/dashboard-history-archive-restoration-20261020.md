# PAWS Dashboard History archive restoration — 2026-10-20

## Owner's replacement decision
Supersedes the 2026-10-20 reset *display rule only*. The owner explicitly requested reintegrating the archived old History and replacing the blank/reset Dashboard display with a usable consolidated record, without losing underlying audit provenance.

## Verified real-data evidence
- Private, verified University archive `PAWS_History_and_VetMedOps_Schema_20261020_Final.zip` at `P:\PAWS\Runtime\Acceptance\HistoryGrouping-20261020\Private\HistoryReset-1b4c3fb`.
- Verified source events at capture: 1,755 AuditEvent + 37 DoeAuditEvent = **1,792** immutable independent events; 1,030 ChangeHistoryContext records.
- The archive's **9,175** field changes are derived comparisons of BeforeJson/AfterJson, not 9,175 new SQL audit events, and should **never** be inserted into `paws.AuditEvent`.
- Earliest source audit: `2026-10-05T15:03:16.3073509` UTC. Dashboard SQL read floor is `2026-10-05T00:00:00.000Z`, an inclusive calendar-day lower bound.
- DOE Audit starts October 7, 2026. All data remains in the existing live SQL source.
- Earlier display reset boundary `2026-10-20T21:13:42.660Z` is no longer used for Dashboard filtering.

## Architecture and risk controls
1. Continue using `paws_api.ListChangeHistoryEvents` for server-verified identity, faculty scope, source evidence and existing SQL privileges. No offline JSONL is served or imported to production.
2. Default Dashboard History academicYear to `all`, showing all authorized archive periods. Academic-year selectors still narrow; My History and Calendar Changes reject `all` and keep the original strict individual academic-year contracts.
3. Bound the Dashboard SQL read window to the verified inclusive archive day or later date filter, and no later than the next UTC calendar day. Requests wholly before archive return empty without SQL. The Node read path independently excludes out-of-window rows before grouping or export.
4. Continue server-side `projectHistoryEvent` field allowlists, Admin/Faculty authorization and `groupDashboardHistory` operation grouping. Only recorded batch metadata / import receipt IDs permit cross-event grouping; timestamp proximity alone cannot combine unrelated user submissions.
5. UI labels the restored period and allows users to choose a specific academic year; completed snapshot pages, CSV and XLSX all use exactly the same authorized, grouped records.
6. Retain all `AuditEvent`, `DoeAuditEvent`, `ChangeHistoryContext`, receipt rows, business tables, existing SQL procedures, 27 write gates and DOE settings unchanged. No DELETE/TRUNCATE, synthetic production writes, source replays, identity bypass or migration.
7. The web History is intentionally an allowlisted *operational read projection*, not a public rendering of all raw JSONL evidence. Unsupported/private audit fields remain restricted; raw comprehensive evidence stays in the protected archive. Do not equate exported raw field differences with online operations.

## Acceptance and rollback
- Ensure restored pre-reset records, Oct 5 inclusive boundary, correct ordering, archive-end filters, all-years default, explicit-year narrowing and old-source provenance; prove no duplicate events from importing archive (no import occurs).
- Verify faculty cannot read others' records and My/Calendar behavior unchanged. Verify grouping, 100-operation pagination, CSV/XLSX and snapshot authorization.
- Promote separately reviewed exact product SHA `a3317b1d30b1caa66c81ee5f4be2932f941b565b` with a protected static/API file-diff assertion, full root/server/emulator CI and SQL acceptance.
- Controlled real-data release: stage isolated port, compare **27 exact** write gates, SQL and anonymous 401; retain exact old runtime and recovery config; cut over University API before Firebase Hosting. Verify released SHA and matching public 81/81 static files, then use existing recovery CheckOnly. Roll back if any gate fails.
- Operational caveat: the historic `PAWSApi-Temporary-SA` login task still points at `C:\PAWS\Runtime`, so post-reboot autostart remains a separately tracked issue. No change in this feature.
