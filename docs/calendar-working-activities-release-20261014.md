# Calendar working activities — candidate acceptance and release manifest

Status: product review and separate candidate-governance review accepted; final acceptance and release preparation in progress. Draft PR [98](https://github.com/Alex1122341/Teaching-assignment-azure/pull/98). The owner confirmed the dedicated service account is not prepared and requested preparation only. No merge, live migration, permission activation or publication has occurred for this module.

## Accepted scope

Actual work becomes a SQL Calendar date range with its original inclusive dates. No course, academic year, clock, weekday cadence, room or group is inferred. University travel, vacation, RSL, leave and OPA stay AFC. Duplicate, unresolved or invalid source rows stay quarantined. The approved departed-person exclusions remain bound to the exact workbook hash and source row. Course Calendar replacement is outside this operation.

The import stages server-parsed source rows, previews exact active imported AFC matches, and binds source hash, manifest, identity resolution and row versions. Commit rechecks those facts inside one transaction, writes receipt and complete recovery before-images, inserts activities and deletes only the exact counterparts. Retried identical requests return their receipt; changed or recovered outcomes fail closed.

Missing work timing produces Needs Review and blocks SWAP application even with an Owner override. Verified timing belongs only to its actual date. Shared faculty locks, final business locks and all-resulting-instructor activity snapshots preserve existing consent, stale-request and DOE boundaries.

## SQL manifest and boundary

| File | Action | Rollback |
|---|---|---|
| 038_calendar_activity_foundation.sql | Tables, lineage functions, stage/preview/read procedures | rollback_038_calendar_activity_foundation.sql |
| 039_calendar_activity_swap.sql | Availability/digest/snapshot and three existing SWAP procedure definitions | rollback_039_calendar_activity_swap.sql |
| 040_calendar_activity_commands.sql | Atomic commit, date evidence and trusted recovery procedures | rollback_040_calendar_activity_commands.sql |
| 041_calendar_activity_permissions.sql | Five narrowly scoped execute-only roles and private-table read denials | rollback_041_calendar_activity_permissions.sql |

Role memberships are never applied by those migrations. Browser runtime must not receive `paws_calendar_recovery_admin`, direct DML or helper EXECUTE. Stage, commit and time are independently disabled unless their exact environment value is `true`. The opt-in canonical faculty/public-key mapping is restricted to administrators; faculty reads are server scoped.

Existing support delegation denies these operations because its current Undo model does not capture Calendar receipts and recovery tables. Use the authorized account directly. Existing timetable CSV/ICS/Outlook exports remain teaching-session exports; working ranges stay in the separate Calendar section.

## Evidence collected

- Accepted product7526e86f295de062c228fb1ddee2f007706285c2. Independent product review and separate candidate-governance review are recorded in [review record](calendar-activity-review-20261014.md), including important fixes, deferred minors and exhaustive ledger rulings. No runtime changes follow that accepted product.
- Candidate9202ad0736543205f6717860363614cbfd2adcef: [Beta Build38671919004](https://github.com/Alex1122341/Teaching-assignment-azure/actions/runs/38671919004) passed. GitHub tested PR merge53019d8fb5cec31ece484d0e723a6ce0df1b2274 (candidate9202ad0 into main0d4b4d9). Ordinary root831 total/799 pass/32 emulator skips/0 fail; Linux server590 total/588 pass/2 skips/0 fail (SQL environment and Windows ACL); full Auth/Firestore emulator831/831 pass, zero skips. Final historical-baseline/deployment checks56/56. Container build and all four repository/artifact freeze checks passed. These are PR integration checks; exact-main CI is still mandatory after a future authorized merge.
- [SQL acceptance38671919009](https://github.com/Alex1122341/Teaching-assignment-azure/actions/runs/38671919009) and [migration tests38671918997](https://github.com/Alex1122341/Teaching-assignment-azure/actions/runs/38671918997) passed. Foundation, atomic commands, recovery, SWAP semantics, least-privilege metadata/cascade boundary, thirteen actual two-connection proofs and fresh synthetic guarded rollback passed. Populated state and bound roles refused rollback; empty state restored original030 definitions and SET metadata.
- SQL fixtures compare unchanged teaching Sessions/Assignments, DOE and Published data around import/recovery. Recovery preserves original AFC IDs with fresh generated versions and refuses modified activities or references.
- Windows full server run590 total/589 passed/1 SQL-environment skip/0 fail. Local root9f4290d run831 total/798 pass/32 skips/1 fail was the observed stale deployment-anchor assertion;9202ad0 fixes it, deployment14/14 and complete CI root/emulator runs above passed. No false local all-green claim. Local Java is unavailable; CI provisions Temurin21 and covers all32 rule/emulator tests.
- Chrome1440x1000 and390x844 used actual demo Firebase Authentication and actual activity API/router with synthetic in-memory repository/parser and explicit synthetic-upload hash stub. Category/date views, administrator and self profile scope, quarantine/exclusion/accepted totals, confirmation, stale409 refresh, lost503 same-key retry and Needs Review rejection passed. Three console HTTP failures were deliberately injected503/409/503; no unexplained JavaScript error. Screenshots remain outside Git in the local temporary paws-calendar-qa-20261014 directory. This is not a live Beta test. The owned demo Auth emulator was stopped afterward.

## Prepared artifacts

All six prescribed build/verification commands were run on the candidate: build-static, build-beta-release, verify-beta-candidate, beta-api-freeze and both app/API artifact freezes. Windows raw-byte inventory below is separate from the Linux CI upload digest; canonical immutable freeze checks protect both.

| Generated directory | Files | Bytes | SHA-256 of sorted JSON inventory (path, bytes, SHA-256) |
|---|---:|---:|---|
| .deploy-static |74|2074197|b5f7eeddaf7e0f6ed77bf003a908df9255a13797f058754c9b2ecddf2f0352c8|
| .azure-production/app |75|2074339|2f0bac731a8747d0c32507b04dd91bb11d44c858065dcbb995e7032d98b635f7|
| .azure-production/api |74|1868344|35864dd8c20defb35a2c11aeb4e793058d25efc3a8462fb087920031a5f6500b|

The74 Hosting assets are byte-identical between the two generated outputs. App adds only staticwebapp.config.json; API contains73 runtime files plus inventory. Worker/router are present; dependencies lock exceljs4.4.0, unzipper0.10.14 and jszip3.10.2. No workbook, private source/staging/recovery data, credentials, installed node_modules, logs or unrelated SQL fixture are in the inspected inventories. Final manifest metadata remains in the ignored plan workspace.

CI upload [artifact11943529836](https://github.com/Alex1122341/Teaching-assignment-azure/actions/runs/38671919004/artifacts/11943529836), name azure-beta-53019d8fb5cec31ece484d0e723a6ce0df1b2274, size2495682 bytes; uploaded ZIP SHA-256 e90cf030116e7387806c74c83af149d1ec49f37f766146ef4ef07476603e2465. Retention is7 days. This PR artifact is prepared evidence, not authorization to release it. A later release must use its accepted exact-main artifact and revalidate dependency installation, principal, configuration and gates.

## Read-only University module preflight

At the preflight checkpoint all three procedure bodies matched repository030 after LF/outer-edge normalization and had ANSI_NULLS=1, QUOTED_IDENTIFIER=1. Raw UTF-16LE hashes were captured below. Repeat and preserve definitions immediately before a future migration; any unexpected change blocks application.

| Procedure | Raw SHA-256 | LF/outer-edge normalized SHA-256 |
|---|---|---|
| GetSessionSwapContext |E7E0F3621359AF411B2C6568551E6F23A75FA26848D875957278331559FE95C9|49D241EA1ABAB896D771B8741E8E42D7353F6E7D6058D26710E9E0BD8266E580|
| SaveSessionSwap |42E88747F5B9DBB3F8A22BC25FEDDE4366997DA498D0E8F193D83FA5CEE70EE8|7CCD75DAFA4FA04EBE9B1C166220222D2C88D37ABA8C40A4E64FEBE16938B6D7|
| DecideSessionSwap |A3D5AD1E9F78B57C701684E0368DBD9ABD053B1F4217870756FE0F94984F370F|3307351036DEEA24AE1796884A7CF71A037C03A9FB4CC5306DFAC170D0111889|

The observed University principal remains db_owner; no dedicated account exists yet. No Calendar objects were live. Aggregate checkpoint:1937 Sessions,4970 assignments,119 active/2 inactive faculty,803 active imported AFC,1 active manual AFC,0 SWAP requests. These are time-bound reads, not a final source manifest.

## Release prerequisites and separate authorizations

1. Completed: independent product review and one fix pass; accepted product7526e86f295de062c228fb1ddee2f007706285c2; separate governance9f4290d reviewed with deployment-assertion correction9202ad0. Static/API protection remains the union of immutable baseline and current manifests. Deferred minors are disclosed in calendar-activity-review-20261014.md.
2. Build and attest matching API/Hosting artifacts, containing the new worker/dependencies but no workbook, staging data, recovery artifacts or secrets.
3. Read-only live preflight obtained: all three SWAP bodies match repository030 after line endings/outer-edge normalization, with ANSI_NULLS and QUOTED_IDENTIFIER enabled. Repeat immediately before migration; unexpected drift blocks application. Preserve the actual previous definitions for rollback.
4. Prove a dedicated least-privilege runtime identity and exact role memberships. Existing temporary db_owner is unresolved release debt; synthetic role acceptance is not evidence of live principal configuration.
5. Confirm private University recovery storage, Windows integrated connection, restrictive ACL and exact UTF-16LE receipt-bound export hash. The export must occur immediately after commit, because its receipt exists only after commit.
6. Present a concrete merge/SQL/API/Hosting release request with new write gates initially false. Previous PR94 release approval does not authorize this module.
7. After read/schedule/SWAP integration acceptance, regenerate the approved source preview against current live AFC/Faculty records. Counts are not assumed to be 541. Review new manual rows, retained row812 and inactive identities; obtain a separate exact source-migration confirmation.
8. Commit once through the authenticated API, export and verify recovery, then verify matched insert/delete counts, preserved retained/manual/unclassified records and unchanged teaching/DOE/Published data. Any later recovery requires its own authorization.

The module is not complete until its separately authorized release and source operation are accepted. Other tasks in the full PAWS directive remain outstanding.
