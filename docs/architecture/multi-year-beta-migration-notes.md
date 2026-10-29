# Multi-Year PAWS — Deferred Beta SQL Migration Handoff

**Status:** Deferred by Owner instruction, 2026-10-29. **Do not implement until Testing Demo manual acceptance and a separate Beta authorization.**

The Testing site uses synthetic, browser-local data only. No SQL/Firestore schema, database connector, migrations, real staff records, backend permissions or Beta deployment are in scope for the Demo.

## Carry forward after Demo acceptance

1. Audit actual Beta database \`VetMed-Ops\` on University server, including \`paws.Course\`, \`paws.Session\`, \`paws.SessionAssignment\`, existing \`paws.TeachingAssignmentPublicationRelease\` / \`paws.TeachingAssignmentPublicationState\` and DOE policy/override structures. Existing publication is year-wide; design requires course-scoped releases. Treat old data as immutable history.
2. Introduce additive \`AcademicYear\`, annual Course snapshots and year-aware foreign key/integrity checks; preserve globally shared Faculty, Course Catalog and AFC. Never silently reassign records across years.
3. Create immutable publication and archival records with year+Course scope, active release pointers, stale-revision/idempotency checks, and authorized immutable conflict snapshots.
4. Preserve the current 2026-27 Faculty-visible published teaching and DOE, including manual overrides; record before/after reconciliation, hashes, privacy and revert evidence. The Demo's synthetic identities must never be copied into University SQL.
5. Resolve formal authenticated Owner-only Retire/Restore and exact Course publisher grants against actual SQL roles and effective appointments. Faculty can read only their historical Published Teaching/DOE; archived Calendar must be denied at API/export layers, not merely hidden in HTML.
6. Approved annual DOE rules are required for initial publication. Subsequent approved course release changes recalculate Published DOE without deleting overrides. Preserve detailed provenance, audit and atomic publication behavior.
7. Run migrations only after a signed-off backup/restore plan and isolated SQL Stage acceptance. Review existing write gates, private AFC source, API origin, University security/privacy and cutover/rollback procedures.
8. Compare the accepted Demo behavior/case catalog with Beta separately; Demo role switching or localStorage cannot verify real SQL authentication, transactions, concurrency or privacy.

## Never do during Testing-only implementation
- Modify Beta repository or University SQL.
- Run SQL DDL, backfill, seed, reset, import, schema migration or live credentials.
- Change Firebase Lab rules, cloud database or Beta authentication.
- Present browser-local demo outcomes as database or security signoff.

## Intended Beta implementation reference
See \`docs/superpowers/specs/2026-10-29-multi-academic-year-management-design.md\` sections 3–15 for conceptual entities, invariants and later integration risks. Treat them as **deferred**.
