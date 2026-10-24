# Scheduling Tasks release preparation

## Candidate and prerequisites

Product `a3dd9ca9e5324cc6889d09c7a0a1ad08993c8bca`; draft PR100 depends on Calendar PR98 and ADFA PR99. The candidate is not deployed. A dedicated least-privilege University Windows service identity is unavailable; the present db_owner identity is not an approved exception. Final whole-repository/emulator CI, reviewed freeze promotion and exact-head artifact verification must pass before candidate acceptance. Merge and live activation need their own authorization.

## Prepared activation sequence

1. Establish the dedicated runtime identity and verify existing baseline/read/domain roles without db_owner, direct business DML or unrestricted SQL. Preserve reviewed Calendar/ADFA prerequisites038–042 and database/schema ownership.
2. After explicit migration authorization and the institution's backup/change procedure, apply `database/azure-sql/043_scheduling_tasks.sql` once to VetMed-Ops. It refuses unexpected existing task objects or source rowversions. It adds Session/SessionAssignment SchedulingVersion, derived SchedulingAssignmentRevision metadata, one assignment-change trigger, the review table and three SQL interfaces. It creates no account membership and changes no business values. Take the existing initial migration/count verification evidence before proceeding.
3. Verify metadata trigger enabled, source rowversions, read procedure and function, and execute-only `paws_scheduling_task_review`. No direct metadata/review/business DML is granted. ListSchedulingTasks is granted only to the existing paws_runtime_read role; bind the new review role only to the approved API identity under separate authorization.
4. Coordinate the accepted University API and same-head static artifact. Keep `PAWS_SCHEDULING_TASK_REVIEW_ENABLED` unset/false until approved. Read capability works independently; only exact lowercase `true` enables the review route for verified ADFA/admin aliases. SQL repeats active-profile/role checks. Do not enable unrelated gates.
5. Merge the approved PR, require exact-main CI and inspect the generated artifact/digest. Publish only the authorized Hosting artifact through the existing static-only Firebase release process. No Firestore business fallback or rules deployment.
6. Perform authorized real-session smoke checks for scope/year, both courses, both navigation links, binary AFC availability, default-off review, and independent SWAP loading. Any mutation smoke test needs a specifically approved record; synthetic tests do not authorize live schedule/review changes.

## API contract

- GET `/api/v1/scheduling-tasks`: academicYear required; optional start/end are paired, start inclusive/end exclusive, at most550 days; undated include/only/exclude; facultyKey, courseCode, type, reviewStatus; limit1–100 (UI50); opaque snapshot-bound cursor. Response has authorized tasks, total, nextCursor, academicYears, faculty/course facets and canReview capability.
- POST `/api/v1/scheduling-tasks/{issueKey}/review`: academicYear, expectedEvidenceVersion, expectedReviewVersion, reviewStatus Reviewed/Unreviewed. Actor comes from verified authentication. Review persists status/audit only; active issues remain visible until corrected. Stale source/review/cursor returns409; invalid input400; denied role403; closed gate503. No browser DOE or AFC-purpose fields.
- Faculty/HICC/VISC see only findings on their own linked FacultyId. Existing authorized administrative read scope is preserved. Only accepted ADFA/admin aliases review; ADC/LAB are read-only. Course facets/matching include both sides of an authorized pair once.

## Source versions and recovery

Source/evidence tokens include Session and assignment rowversions, all assignment identities/versions including unresolved entries, retained assignment revision and relevant AFC/Calendar versions. The trigger advances only derived metadata, in the same transaction as assignment INSERT/UPDATE/DELETE; it covers normal replacement and support Undo. Removing the last assignment retains a changed version. A failed/rolled-back source transaction restores metadata too. No support-capture registry entry is added for this derived metadata, so Undo cannot restore obsolete tokens.

Review serializes source ranges and the review row, then re-derives the finding before status/audit persistence. Unsupported direct privileged repairs are outside the supported command contract and require separate evidence review. Synthetic acceptance demonstrates correctness and observed waits, not production performance.

`rollback_043_scheduling_tasks.sql` is prepared only for a complete, empty, unbound candidate. It refuses review rows, any SchedulingTaskReviewed audit history, role memberships or unexpected extra role permissions. It drops only043 interfaces/review/version metadata/trigger/source version columns/new role; it preserves business data and prior permissions. Never delete history or unbind a live account to force this rollback. Populated/bound deployments require reviewed forward repair. Retained assignment metadata alone is derived and can be removed by the guarded empty-review rollback.

For a runtime rollback, close the review gate first and restore the previous coordinated, accepted University API/static pair. Retain persisted review/audit records and source version metadata. Rehearse the explicit-column compatibility of that previous runtime before any authorized cutover; do not use schema rollback to erase a populated deployment.

## Candidate acceptance evidence

See `scheduling-task-acceptance-20261015.md` for exact test heads and remaining checks. No credentials, private workbooks, recovery files, test fixtures or real faculty evidence belong in either shipped artifact.
