# Owner-authorized local acceptance and release — 2026-10-21

The Owner expressly instructed: use local acceptance because GitHub CI has reached its usage limit; after acceptance, merge and publish. This supersedes this task's mandatory GitHub Actions/exact-main CI artifact requirement. It does not change application authorization, immutable runtime protection, source review or safe deployment boundaries.

## Accepted release evidence

- Reviewed product370c30a21d99ae7227f97f1e0cb781864c674768 and governancead2493629420fe66e107f95a75c222e3457f60f4, both READY. Runtime and tests at checked candidate32f3dd0fc06ba07aaa875f2e65838d7cf14b1931 are unchanged from reviewed/tested source; intervening changes are documentation only.
- Local Node22 complete-history suites: root1016/964pass/52skip; server802/798pass/4skip; emulator1016/997pass/19skip; all0fail. Both repository and artifact freezes passed;193 protected paths and191-file artifact verified.
- University staged candidate32f3dd0 on loopback18794:105 server source files equal immutable Git blobs, SQL health healthy, all27 gates match live33c4e9f/a3317b1. No production cutover yet.
- Real normal Firebase password authentication with existing authorized Admin and Faculty accounts: Admin200, Faculty own200, cross-Faculty403; anonymous/invalid401, invalid dates/malformed ID400, nonexistent404. Complete155-record range,116upcoming, identical Admin/own scope, private-field allowlist, CORS204, existing Timetable/Dashboard/roles/AFC/DOE/Tasks GET regressions all pass. Only aggregate proof is retained in public documentation; passwords/tokens are not stored.
- The first private acceptance runner's Tasks smoke request omitted mandatory academicYear and received400; corrected runner used the existing API contract and passed. No application change.
- SQL056 is already applied once with106 protected tables and existing permissions/memberships/gates unchanged except intended new read-role EXECUTE. Do not replay it. Previous actual isolated SQL acceptance remains linked to unchanged SQL bytes.

## Remaining execution

Merge existing PR124 using a merge commit and expected-head binding after final source/ref checks. Fetch the exact resulting main, verify all protected/test inputs against accepted candidate, and produce an exact-main local release artifact with its own hash/inventory. Label its provenance as owner-authorized local acceptance; never invent GitHub run IDs or artifact IDs.

Stage and attest exact-main University API, capture fresh protected business fingerprints and current accepted rollback launcher, preserve27 gates, validate health/auth/CORS and source parity. Cut over API before publishing the same generated static artifact using existing Firebase CLI authentication with Hosting only, project tester-teaching. No Firestore rules/indexes/Functions deployment, no new credential/role permission and no static-only compatibility mode.

Complete actual Admin/Faculty Availability browser acceptance after coordinated publication, including own-only scope and readable narrow layout. Verify all public artifact bytes and unchanged health/gates/business fingerprints. Retain old accepted API/static pair and guarded SQL definition for recovery; never restore business rows to hide a runtime issue.

No workflow or freeze bypass code is introduced. GitHub CI status remains unverified/unavailable; the Owner-approved local route is the explicit release authority for this task.

