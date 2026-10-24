# AFC record management and LAB detail release

## Product scope

The Dashboard refreshes authenticated AFC creation/cancellation capabilities after sign-in. Faculty labels show names; internal keys remain in request values. Duplicate names use rank/stream for selection and ambiguous bulk names are rejected. The default AFC list contains active records, with archived records still accessible.

Delete cancels the exact manual/imported record by setting Active to false. It retains purpose, notes, dates and the row. Administrator authorization is checked by both API and SQL. A rowversion token rejects stale active records; cancellation and its before/after audit are atomic. An already cancelled retry creates no second audit. A separate exact-true gate defaults closed.

LAB detail groups already authorized LAB/SRL rows by course, date, year and academic year. Native tables show instructors, rooms and total source intervals. Group rotations are Not provided; no segmented times, groups or roster link are fabricated. Each row keeps its existing Edit Session, Manage Instructors and SWAP flow and pending status.

## Directed release prerequisites

1. Review the product and separate immutable static/API freeze promotion in this PR. Preserve both commits; the product anchor must remain reachable. Require exact merged-main CI before release.
2. Apply `database/azure-sql/036_afc_record_cancel.sql`, then `037_afc_version_encoding.sql`, with sqlcmd `-I -b` error stopping against the approved VetMed-Ops database. This creates the narrow cancellation role but grants no membership. Do not rerun source imports or earlier migrations.
3. Compile and exercise the procedure in the accepted SQL environment. Run `037_afc_version_encoding_acceptance.sql`, then `036_afc_record_cancel_acceptance.sql`, and require `AFC_CANCEL_ROLLBACK_ACCEPTANCE_OK`. It creates only a synthetic manual fixture inside a transaction and rolls back its records/audits. Also check imported cancellation, stale-version rejection, denied faculty access, and concurrent cancellation in staging before activation; local API tests do not prove live SQL acceptance.
4. Inspect the exact runtime identity and existing permissions. Bind only `paws_runtime_afc_cancel_write` to that identity after authorization, with no direct table DML or schema-wide execution. Confirm the existing read role can read VersionToken from the unified view. Do not use a broader principal to make acceptance pass.
5. Stage and verify the exact source-attested University API runtime. Keep cancellation disabled initially. Confirm authenticated `/api/v1/dashboard/afc-records/write-capabilities` and list reads. Enable `PAWS_AFC_CANCEL_WRITE_ENABLED=true` only after SQL acceptance and runtime role verification. Preserve other gate values.
6. Build the same generated static allowlist artifact and perform the directed Firebase Hosting-only release to tester-teaching. Do not release new static code alone against the old API: the new capability endpoint and VersionToken require the coordinated API/schema release. Do not deploy Firestore rules, indexes or Functions.
7. In Chrome confirm name-only labels, enabled creation when the server grants it, cancellation confirmation/history, stale refresh, grouped LAB rows, corresponding per-row actions and narrow-screen scrolling. Use approved synthetic data for mutation acceptance.

## Rollback

Disable the cancellation gate and remove only the new narrow role membership. Restore the previously verified API/static release if needed. Retain rowversion columns, cancelled history and audits; do not hard-delete business data or rewrite cancellation history. Keep the previous runtime and Hosting artifacts available until acceptance closes.

## Evidence boundary

Release completed2026-10-14. PR94 merged b9dc273 and SQL-only correction PR95 merged ca465bf1401b457ca3b74048cfaf170bedc7694a. SQL036/037, encoding/manual/imported/stale/denied/concurrent rollback acceptance and exact narrow runtime-role verification passed. University API and Hosting now serve ca465bf with product/trust anchor fb2c625745957fa7d9990033f15a7b1ef91974a5; afcCancel is enabled and existing gates retained. Exact-main Beta38453614170 and SQL38453614145 succeeded. All71 protected public static assets match the accepted CI artifact.

Connected Chrome confirmed the actual grouped course206 /2026-10-16 LAB/SRL table, its real source intervals/instructors and per-row controls, explicit missing rooms/groups, enabled AFC creation and name-only labels. All803 active AFC records expose Delete; the native confirmation was dismissed and a fresh read remained803. No live UI create/cancel was performed. Final evidence and deployment-workflow limitation are recorded in agent.Ai/updates/2026-10-14-afc-lab-release.md. Do not rerun this release procedure merely to resume.

## Live acceptance correction

A release rollback test found that SQL Server style2 conversion directly from timestamp returns8 raw bytes. Migration037 explicitly casts rowversion to binary(8) before hexadecimal text conversion for both sources. The applied036 migration is retained as history;037 is additive, changes only the view expressions, and retains its columns and read grants. Cancellation API/role/procedure and protected runtime files are unchanged. Acceptance reads the same VersionToken view as the Dashboard.
