# Task01 acceptance evidence audit

Independent read-only audit /root/audit_task01_acceptance at fcb2bda: full Task01 remains partial. Existing released SWAP foundation and accepted PR99 ADFA enhancement do not establish the whole faculty/multi-office workflow. No code, SQL or live state was changed by the audit.

## Established evidence

Existing form/session routing, current assignments, active opaque candidates, scoped queues, persisted requests/revisions/decisions/notifications and final snapshot/availability checks exist in the SQL030/039 implementation. ADFA search/current/projected DOE is separately accepted in PR99. Prior SQL039/042 acceptance proves activity/AFC/timetable availability, unknown timing, adjacency, changed snapshots, untouched co-instructors and direct ADFA apply. It does not prove the complete multi-office transition matrix.

Focused adfa-swap-preview/calendar-activity-swap tests11/11 passed during the audit on Node24.19.0; these are synthetic API/DTO/runtime-wiring tests, not execution of the SQL transition matrix. Canonical CI remains Node22. Historical recorded CI/races were source-evidence reviewed rather than freshly rerun. Thirteen Calendar races are not thirteen duplicate-approval tests.

## Outstanding acceptance

1. Ordinary faculty candidate search is a native select; explicit search/filter exists in the ADFA panel. Verify intended faculty search usability before marking covered.
2. Ordinary faculty notified/unnotified creation, linked-target consent, scoped VISC, ADC/LAB own-field editing, final ADFA and wrong-role/out-of-scope SQL/API denials need a complete synthetic acceptance matrix.
3. Reviewer inbox/queue visibility across transitions needs actual SQL assertions, not stubbed queue calls.
4. Duplicate/concurrent decisions, competing requests, stale revisions/canonical session changes, reject/pushback/revise/reset/withdraw, gates, transaction rollback and audit completeness need dedicated coverage.
5. Source persists revisions/audits, but detail UI shows decisions without complete revision diffs/actor/time. Do not claim complete user-visible history without resolving the requirement.
6. Exercise actual faculty submission through reviewer progression against authorized synthetic fixtures. Original release explicitly did not submit/approve a real request; live end-to-end acceptance remains separate.

Read-only source findings are not a passed RBAC matrix. Retired Firestore tests cannot establish active SQL SWAP acceptance. Task01 S01 is marked not passed for the full requested scope; existing narrow ADFA candidate acceptance is preserved.

## Declined to judge

Current live schema/data/gates/reviewer accounts; remote PR/CI freshness; production permissions/least-privilege effectiveness; source-data correctness; full root/build/browser regression; live SQL transaction behavior; whether native typeahead alone satisfies search; whether persisted audits alone satisfy complete history. These remain explicit and are not silently accepted.
