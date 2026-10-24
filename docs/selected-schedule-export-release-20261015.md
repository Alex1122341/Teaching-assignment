# Task03 selected export — release preparation

## Candidate and stack

Draft PR104:https://github.com/Alex1122341/Teaching-assignment-azure/pull/104 . Base is feat/scheduling-conflict-tasks-20261015 (PR100) to isolate this slice; upstream dependencies99/98 remain separate. Product bb6b86611a1c9eba2479f158ba864d63626b0b4d; independently reviewed governance e76878cbcfe470eb8d3f3c8b560da4114f9f16e6. Main a367a96 contains merged docs-only101/102; no103 DOE UI code is included. The stacked PR must be reconciled/retargeted to main only after proper upstream integration, then exact-main acceptance is required for publication.

## Local evidence

- Node22 root877total/829pass/48explicit environment-browser skips/0fail (298.7seconds), server613total/610pass/3environment skips/0fail.
- Combined targeted acceptance29/29 including nine actual Chrome flows and real authenticated-client/API/repository-query/actual-loader integration with synthetic Auth/profile/DB boundaries. Additional scope/P1/runtime regressions25/25.
- Independent whole-product fix-pass Ready; independent separate-governance Ready with3/3delta/history/hash and7/7attack/anchor checks.
- Canonical tools/build-beta-release.js passed. Repository static/API freeze and generated app/API freeze passed.75static,76APIruntime/79protected. Inventory153files:app76,API77; no test/agent.Ai/node_modules/private workbook/recovery paths in inspected output. No new SQL migration, API runtime dependency or write activation is introduced by Task03.
- Exact-candidate Azure Beta Build38838908757/job116774204938 at e76878c SUCCESS:root829/877,server609/613,emulator861/877 with explicit48/4/16skips respectively; governance59/59, all0fail. Container(no push), canonical build and all repository/artifact freezes passed. Artifact12020660903 downloaded; ZIP SHA2560383861eb4d766b56811afbf9b7861d6d7a12b5d0691b2093ec661056b3fe8b9 matched. Exact153-file package and accepted bytes reverified; expiry2026-10-23T02:12:24Z. Existing actual SQL acceptance for unchanged API is preserved from accepted Task02, not falsely relabeled as a fresh Task03 SQL run.

## Observed live read

GET https://radar-languages-shopper-corporate.trycloudflare.com/api/health/sql returned status ok,service paws-beta-sql-runtime at this2026-10-15checkpoint. This read proves connectivity for that request, not every business operation or dataset. No database mutation occurred. Do not confuse failed local freeze checks or a subagent credit-error turn with a database outage.

## Publication prerequisites and order

1. Finish exact candidate CI/container/emulator/artifact checks and record hashes; do not deploy a local scratch package.
2. Owner subsequently removed the new dedicated-account prerequisite for this controlled Beta milestone and directed publication once acceptance passes. Use the existing authorized runtime identity without claiming least privilege was verified. Confirm private recovery readiness and source-bound acceptance separately before Calendar data migration.
3. Fresh metadata reports PR98/99/100 Draft/unmerged and mergeable=false against latest main. Reconcile stack integration and documentation conflicts without dropping approved product/historical/continuity evidence; rerun exact-main CI on the actual accepted integrated runtime.
4. Publish only the approved coordinated University API/static pair through existing Firebase Hosting, preserving per-domain gates and rollback launcher. Frontend server migration is explicitly deferred, so no new frontend server or host is provisioned.
5. Validate actual authenticated read-only UI and download under authorized roles, no real teaching edits or synthetic live records. Existing local synthetic screenshots do not count as live acceptance.
6. Current AFC working-activity source import/delete remains its own exact fresh-preview confirmation, receipt/recovery/export and post-operation acceptance. Nothing in selected CSV authorizes that data operation.

Read-only Task03 itself has no schema rollback. If its UI needs rollback, restore the prior coherent accepted API/static pair; preserve unrelated business data and upstream audit/source-version metadata. Do not apply empty-state schema rollback to populated/bound dependencies.

## Current boundary

No merge, live SQL migration/write, role binding, gate change, API cutover or Hosting publication. Latest owner instruction authorizes merge/publication of accepted scope using the current Beta environment. The dedicated account is no longer a blocker; exact integrated-main checks and actual deployment acceptance remain outstanding. Keep this candidate separate from the full Task01 gaps and from the DOE handoff's separate PR103 candidate. No Task04 implementation is included.
