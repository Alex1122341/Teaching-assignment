# PAWS Dashboard History: operation-level grouping and freeze promotion (2026-10-20)

Accepted product candidate: `fe1fa7002ef956f02e767053fbe2f6fea8daf748`. Prior immutable baseline: `846858a242cf2a96b0257822ac22d8ab6a770c94`.

## Scope and rationale

The ADFAD Dashboard History previously displayed one line per projected field and one audit event per batch-created AFC record. This update changes only the Dashboard read projection, UI, pagination and export to present **one user operation per History entry** and expandable, authorized field-level details. My Change History and Calendar Changes retain their existing row layout and exports.

The existing `paws_api.CreateAfcManualBatch` procedure already writes a stable `batchRequestId` and item positions in each row's immutable AuditEvent metadata. Grouping occurs only when the event is a server-origin `afc_record_created` event with matching well-formed batch metadata. Independent user actions are never grouped by timestamp, faculty, or event type. The existing calendar import receipt projection has a stable parent audit ID and is grouped by that identifier. Other audit events are grouped only at the single-event level, so multiple fields in one Save become one entry.

**No SQL writes, audit deletion, permissions, migrations, or Production configuration changes are included.** Durable source AuditEvent/DOE audits remain unchanged.

## Security and correctness

Event projection, role authorization, faculty visibility and all history filters run **before** operations are grouped. Matching one field retains the full *authorized event* detail, but cannot reintroduce any event excluded by faculty permissions. An operation is paginated as a whole; snapshots and 6 MB limits remain enforced. CSV exports contain one row per operation with authorized details; Excel exports provide `Operations` and `Change Details` sheets. Both preserve formula-neutralization and escape user-supplied values.

## Reviewed protected product changes

- Static assets: `change-history.js`, `change-history.css` (2 modified paths, manifest remains 81 files).
- API runtime: `server/src/history/change-history-api.js`, `server/src/history/change-history-export.js` and new `server/src/history/change-history-operations.js` (3 changed paths; runtime path count grows 103 to 104).
- Independent tests: frontend, grouped operations, API scopes, pagination, and CSV/Excel exports.
- No API routes, feature gates, SQL roles, stored procedures, or data policies are widened.

## Freeze governance

This governance-only commit promotes the **Git-object baseline** to the exact reviewed product candidate above, with SHA-256 canonical static hashes updated for the two modified assets. It preserves all historical trust anchors, protected path inventory, CI freeze checks, and fail-closed behavior. No exceptions or baseline-validation bypasses are added.

## Outstanding acceptance gates

Verify the full Node 22 web/server test suites, exact-artifact static/API freeze, PR CI and isolated UI acceptance. Deployment to the real Beta remains separately authorized and is **not** performed by this PR. The new behavior is a read-only History projection, not a change to AFC submission transactions.
