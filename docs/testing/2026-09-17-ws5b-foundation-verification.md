# WS5B foundation verification and next-stage capacity review

## Verified implementation

- Branch: `feature/workstream-5b-approval-routing`
- Application commit: `e10d9f38a9aaa6000473a42ae972a9b9a85464bc`
- Verified source tree: `97fd56f5873bba4b6fca34af2215c89ed143269a`
- GitHub verification run: https://github.com/Alex1122341/Teaching-assignment/actions/runs/35277130973
- `npm test`: 332 total, 297 passed, 0 failed, 35 emulator-only skipped.
- `npm run test:emulator`: 332 passed, 0 failed, 0 skipped.
- Static build: 47 allowlisted runtime files.
- New calendar permission tests fail against baseline rules and pass against candidate rules.
- The remote tree was checked against the local verified tree; they are identical.

The application checkpoint implements role capabilities, office-profile/UID setup, a calendar allowlist converter, and rules-level private-data read denial. It does not yet implement the complete office timetable editor or multi-office approval workflow.

No live rules deployment, account activation, database backfill, main merge, or Pages/Azure publication was performed for this checkpoint.

## Capacity review before the paired-write integration

The approved plan accounts for doubling source/calendar import writes, but the interactive Add Sessions and Select Sessions paths also write an audit record for every row. At the existing 200-row maximum, source + calendar + per-row audit totals 600 write operations before notifications. This is above the Web SDK documented 500-write batch maximum.

Sources checked on 2026-09-17:
- https://firebase.google.com/docs/reference/js/firestore#writebatch
- https://firebase.google.com/docs/firestore/security/rules-conditions#access_call_limits
- https://firebase.google.com/docs/firestore/manage-data/transactions#security_rules_limits

Security-rule access calls are a separate capacity budget: 20 per atomic batch/transaction and 10 per operation, with cached calls excluded. Do not infer a production-safe row count from the write count alone.

An isolated emulator-only probe was run:
https://github.com/Alex1122341/Teaching-assignment/actions/runs/35277396733

Observed results with deliberately minimal rules:
- One paired source/calendar write succeeded.
- A missing calendar companion was denied.
- Eight paired records succeeded.
- Two hundred paired records also succeeded, so the test expecting a quota rejection failed (3 passed / 1 failed). This falsifies that particular emulator expectation; it is NOT evidence that production will reject or accept the full application operation. The probe is outside the application suite and has no live data access.

Do not weaken pairing/privacy rules, omit per-row audit, silently split an operation described as all-or-nothing, or use the shared live backend to test these limits.

## Proposed product decision (not implemented)

Retain the 200-row preparation/review interface but save in smaller, capacity-budgeted batches with explicit progress and recoverable checkpoints. Every session's source record, sanitized calendar record, and audit must commit together. A multi-batch job may have already committed earlier batches when a later batch fails; the UI must show that honestly and must not claim a full rollback.

The alternative is to preserve all-or-nothing interactive saves and reduce the maximum rows per save to a conservative, verified capacity. Import/restore already uses a resumable multi-batch model and should retain it with a revised budget.

User confirmation is needed before changing the approved interactive save semantics. The multi-office approval of a single request remains atomic and is not being changed by this proposal.
