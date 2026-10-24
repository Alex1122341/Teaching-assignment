# Calendar commit identity preflight correction

Continue the approved work-activity migration inline. Ruling: this is a bounded performance correction to the existing atomic command, with no change to the approved source, targets, authority or transaction contract. Existing release authorization applies after acceptance. No new subsystem or design decision needs confirmation.

## Evidence

PR110 is live as9287d91/anchor3d983cf. The fresh v2 preview proves exactly540 targets equal prior541 minus Remote Work, plus256 retained/4 excluded/12 Away needing review. Its authenticated commit hit the private90s SQL budget; durable checks showed staged/Calendar0/receipts0/all540AFC intact. Private commit port and token were cleaned. The persisted idempotency key must be preserved.

Read-only serializable phase probes on the actual staged source: existing identity IF EXISTS timed out at60118ms; materializing results for47 distinct raw source names completed15717ms with unchangedEvidence0; exact AFC predicate check139ms with unchangedEvidence0. No business writes occurred. Server performance DMV permission was denied; no grant requested or changed.

## Implementation and tests

1. Add046 acceptance before implementation: assert explicit unique-name materialization, then synthetic540-record/47-name command, inactive identity rejection before any write, exact540 receipt/recovery/idempotent replay. Preserve unrelated Session/DOE/Published and retained/manual AFC fingerprints. Watch disposable CI fail against045.
2. Generate additive046 migration and rollback, exact old/new Commit definition hashes plus unchanged identity-function hash. Only replace identity recheck with two table variables: BIN2 raw names, then complete resolution evidence. Join all accepted rows against that evidence under the same serializable transaction. All faculty application locks, every-tier resolution function, manifest/source/version checks, exact AFC predicates, canonical work classifier, receipt/recovery and DML remain byte-identical.
3. Guarded runner applies046, rehearses rollback/reapply, runs unchanged040 atomic/adversarial acceptance against046, new scale acceptance, and existing two-connection races against046. Do not modify historical SQL sources or loosen timeouts/locks/authorization.
4. Independent branch review, npm test and server tests, candidate CI/package freeze attestation, authorized PR merge, exact-main CI. Runtime files and freeze anchor remain unchanged; no redundant Hosting/API code release if exact artifacts match9287. Apply only the accepted SQL046 revision with a guarded rollback.
5. Renew the same batch preview after expiry; compare exact IDs, dates and versions to the saved original541-minusRemote1 baseline. If no receipt exists, preserve the original idempotency key while explicitly rebinding its expected preview version, with the first-attempt body retained privately. Never create a second key after an uncertain response. Submit through normal authenticated API, immediately export/verify private recovery, then full retained/source/DOE/Published/Calendar/individual/SWAP acceptance and update the original Excel.

## Review focus

Check raw-name collation/trailing-space equivalence, complete evidence and missing-name rejection, serializable missing/alias predicate locks retained until commit, no function bypass or relaxed identity checks, exact one-module diff and rollback hashes, true540-row execution, old atomic adversarial cases and concurrency. Any changed target or source requires stopping rather than guessing.
