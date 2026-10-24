# Source role DOE recovery — 2026-10-08

Owner directly requested that every legitimate role have its source DOE, including explicit zero, and authorized publication. This narrow change excludes PR 73's AFC and worksheet changes.

## Accepted product and separately reviewed governance

Product commit: `6b859ca63810dac7a34f31053cd651e735dbd653`.
Previous anchor: `d62f5406ce1f89813bf928611e551e864ae165fc`.
The protected runtime delta is exactly `server/src/data/sql-dashboard-repository.js`: add exact `HICC` to the existing closed HICC role list, preserving legacy compatibility. No static bytes or protected paths change. The governance commit explicitly promotes both runtime freezes to this product, updates current anchor assertions and reporting, and retains historical Git objects. Independent product and governance review are recorded before release.

## Data boundary

Source: Teaching Assignments 2026 27 MASTER (8).xlsx, SHA256 `a834d571a25942a1242c9ae3d4f56f975525dfa48658c76883a92dac6bb1d1b4`.
Use cached numeric percentage-point values in Course Coordinator, HICCs and CCC. Preserve proration and CCC half-day deductions. Blank cells do not become zero. Exact faculty aliases and existing source bindings resolve identities; no fuzzy match.

112 numeric source lines: 78 updates, 26 separate HICC inserts and 8 explicit-zero CCC inserts; 22 explicit-zero source lines total. Expected 162→196 role rows, 78→0 missing role DOE, aggregate role DOE 493.50→1110.42 percentage points. Final known types: 55 Course Coordinator, 35 HICC, 22 CCC; other 84 rows unchanged.

## Execution and recovery

Private source/snapshots/plan remain outside Git. `prepare-role-doe-repair.py` makes the source plan from workbook and SQL snapshot. `apply-role-doe-repair.ps1` defaults to rollback preview; `-Apply` commits only after identity, snapshot, existing-value, duplicate, date, count and aggregate guards. Trusted FQDN SQL TLS and Windows Integrated authentication are required.

Batch `A834D571-A259-42A1-242C-9AE3D4F56F97` records importer, digest, actor and summary. Keep before and immediate after snapshots on the server and in private evidence. Replays stop. Recovery uses `rollback-role-doe-repair.ps1 -PlanPath ... -PostSnapshotPath ...` (preview), then `-Apply` only when rollback is directed. The complete current postimage must equal the after snapshot before restoration/deletion; changed rows stop for review.

No target DOE, teaching session, authorization policy, write gate, credential or Firestore business-data changes. No manual test suites were run during this task; repository CI executes its existing release workflow.
