# BETA-R4D-9J Implementation Plan

1. Add failing unit tests for the correction-manifest loader and post-identity application path, including unchanged, corrected, stale, duplicate, malformed, sentinel, immutable-field, full-consumption, and stable-ID cases.
2. Implement a narrow `session_time_corrections` module and integrate it in `normalize.py` only after `stable_id("session", canonical_session_key(...))`.
3. Add deterministic source reconciliation tooling that emits a complete machine-readable table and a reviewed correction manifest; test exact/ambiguous/unmatched and time-quality classifications with hand-derived fixtures.
4. Generate the 1,937-row reconciliation data from the three available 2026-09-27 sources, review ambiguous/corrected rows, and create the version-controlled manifest.
5. Add a safe PowerShell operator repair command with preview default, explicit apply, exact old-time checks, outside-Git backup and hash, transaction, invariant gates, and rollback output; exercise its contract without a live write.
6. Rebuild normalization in a temporary workspace and prove session IDs and assignment links/counts are unchanged and only approved time fields differ.
7. Create and verify the outside-Git reconciliation workbook using `@oai/artifact-tool`.
8. Query live Azure SQL read-only for pre-repair counts and data; compare against the manifest and workbook.
9. Run the approved transactional SQL repair, then verify live SQL, API, and representative calendar periods without a frontend deployment.
10. Run the full relevant test suite, update `agent.Ai`, commit, push, create the requested PR, monitor CI, and merge only if the task's acceptance gates remain satisfied. Do not promote the frozen frontend runtime baseline.

