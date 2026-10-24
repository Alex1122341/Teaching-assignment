# PAWS P1 temporary Beta writes

**Scope:** P1 DOE + Faculty Dashboard product completion and controlled Beta write enablement. This is a temporary Beta exception, not production authorization.

## Runtime boundary

The P1 Beta runtime may continue under `UC\sa-xinyu.zhu1` as an explicitly recorded overprivileged temporary identity. Record the status as `TEMPORARY_BETA_OVERPRIVILEGED_RUNTIME`. Do not treat this as least-privilege acceptance. A dedicated runtime-identity and permission task remains mandatory before production release, a wider audience, broad write expansion, or removal of the Beta designation.

Every enabled write must continue through Firebase authentication, SQL `UserProfile` role authorization, strict route validation, a narrow reviewed stored procedure, transactional audit, and a deterministic API result. The browser must have no SQL connection or generic SQL endpoint. Do not restore Firestore timetable writes.

## Gate contract

All gates default to `false`; only exact lowercase `true` enables an individual gate. P1 may enable a gate only after that write domain has passed its API and public Beta acceptance checks and has durable audit evidence.

| Gate | P1 target after acceptance | Boundary |
| --- | --- | --- |
| `PAWS_SESSION_EDIT_WRITE_ENABLED` | `true` | Existing-session scalar edits through `paws_api.UpdateCalendarSession` |
| `PAWS_SESSION_CREATE_WRITE_ENABLED` | `true` if migration 019 is accepted | Admin create and bounded all-or-nothing batch through migration 019 procedures |
| `PAWS_AFC_SINGLE_WRITE_ENABLED` | `true` after verification | Admin manual entry through `paws_api.CreateAfcRecord` |
| `PAWS_AFC_BATCH_WRITE_ENABLED` | `true` after verification | Admin bounded batch through `paws_api.CreateAfcManualBatch` |
| `PAWS_AFC_REQUEST_WRITE_ENABLED` | `true` after submit/withdraw verification | Self-service Faculty/HICC/VISC actions; identity and routing are server-derived |
| `PAWS_AFC_DECISION_WRITE_ENABLED` | `false` | Approval decisions are outside initial P1 activation |
| `PAWS_AFC_ARTIFACT_WRITE_ENABLED` | `false` | Approved-artifact creation is outside initial P1 activation |

No DOE, Faculty master record, RoleAssignment, override, or destructive session-delete write gate is included in P1. Session creation and existing-session edit use separate gates. Runtime health must report the exact seven-domain state using no-store JSON.

## Acceptance and rollback evidence

For every live sentinel write, capture the canonical row before and after, the authenticated actor, request identity, API result, and corresponding audit evidence. Restore existing-session scalar sentinels through the same API and verify the original value. Keep test creation to the minimum needed and do not create disposable rows unless there is a safe audited removal path.

Migration 016 must match its guarded starting hash before execution and its expected resulting hash afterward. Migration 019 must be reviewed and executed only as the exact guarded SQL artifact. Its rollback refuses to remove its own objects after migration-created provenance or idempotency receipts exist; after the first accepted write, preserve data and use forward repair instead of dropping the receipt table.

Deploy Firebase Hosting with `--only hosting`. Do not deploy Firestore rules, indexes, or Functions for this task. If the University API changes, use its controlled rollout process and verify release identity, SQL health, CORS, authentication, role authorization, and the runtime gate report before public acceptance.
