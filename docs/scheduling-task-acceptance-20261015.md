# Scheduling Tasks acceptance — 2026-10-15

Status: **candidate acceptance complete** at governance commit `a356df195c10f0b5464dfaceed2125985f40b8a1`, protecting product `a3dd9ca9e5324cc6889d09c7a0a1ad08993c8bca`. No merge, live SQL/data change, role/gate change or deployment has occurred. This document records the tested candidate; subsequent documentation-only checkpoints do not change its runtime/artifact identity.

An initial independent-governance attempt stopped with a workspace-credit error. One retry succeeded and returned Ready with no findings; no billing/model/auth changes were needed. The separately reviewed governance promotion is committed and pushed. Preliminary progress was never used as approval.

## Independent review and correction

Fresh reviewer reviewed b53c23e1621c6a98c2d9b4c62198fdefdebeaf0f..277a51c05cd4674cc9e1e6c5ecb9264926ce549e. It found four Important issues, no Critical/Minor. Native single fix pass accepted at a3dd9ca9e5324cc6889d09c7a0a1ad08993c8bca:

| Finding | Reproduced failure | Correction / evidence |
|---|---|---|
| Empty or unresolved assignment recreation reused review | Actual SQL38771404030/job116547858078 atbc430dd: empty assignment recreation failed54390 | Owner approved trigger plan adjustment. Derived retained version plus all assignment versions; real normal replacement, supported Undo, unresolved changes and rollback pass in38771955259 |
| Related course missing from filters/facets | Same actual SQL run failed related-course assertion54390 | Include either authorized course; one issue/count per pair; regression passes |
| Refresh/open reused permanent session cache; new server year ignored | Shipped adapter/cache test returned1 stale row instead of2; browser had0 options for returned new year | Fresh authorized scope, fresh target fetch, explicit current detail object, missing/failure message, account guard and no subscriber recursion; tests pass |
| Facet selection became invisible | Browser course selector returned empty while active request retained206 | Preserve selected option and its safe label with “not in current issues”; year/source-change regression passes |

## Verified product evidence

- Full SQL workflow38771955259/job116549777131 SUCCESS at a3dd9ca. Detection, eight issue kinds, strict interval boundaries, scoped facets/filter/paging, duplicate suppression, privacy, missing/unassigned/unresolved/undated-only-year records, durable review/roles/audit, supported recreation/Undo, source rollback and narrow runtime permissions pass.
- Seven actual observed connection lock waits: Session writer first; assignment INSERT/DELETE first; AFC writer first; Calendar time writer first; reviewer before Session writer; competing reviewers. Stale writes fail; exact audit count checked.
- Guarded migration rollback: audit/populated/bound refusals and actual SCHEDULING_TASK_ROLLBACK_OK. Existing Calendar atomic/race/rollback and ADFA preview/rollback lanes remain present and pass.
- Windows server full suite via Node22/npm10:613 total,610pass,3 explicit SQL-environment skips,0fail. Prior API+transport regression46/46; client export-inventory regression27/27.
- Actual installed headless Chrome via existing bundled Playwright:7 browser workflows plus2 tests executing shipped timetable adapter/cache,9/9,0skips. Browser plugin unavailable; no application dependency added. Covers paging/review/reopen/stale/error/identity, both links and metadata, mobile390px/focus/no overflow, absent facets and server years. Separate client/timetable suite102 total,95pass,7 browser-lane skips,0fail.
- Root diagnostic before promotion:855 total,812pass,6fail,37skips. Five were pending immutable-freeze governance; sixth was old closed client export inventory, corrected and focused27/27. This diagnostic is not a green full-suite claim. Final full root/emulator evidence must replace the pending status below.
- Final sequential local `npm test` with the proposed uncommitted governance draft:860 total,821pass,39 explicit emulator/browser-lane skips,0fail (225.5s). A prior overlapping manual build caused ENOTEMPTY in the existing shared artifact test; sequential execution passes without source changes. This local result is not exact-head remote/emulator CI.
- After all tests finished, `node tools/build-static.js` and `node tools/build-beta-release.js` succeeded. Static repository/artifact freezes75/75; API repository/artifact freezes76 runtime/79 protected paths; zero drift against product a3dd9ca. Canonical local inventory153 files:76 app (75 manifest+host config),77 API (76 runtime+inventory). No private/workbook/test/recovery paths. Combined local normalized-path content SHA256 `71d64b84d8a0a9a7294a1b9c01b0601c071bb9f2b638d3fd5782916f8cb8cde6`; this is not a downloaded CI archive digest.

## Exact-candidate CI and downloaded artifact

- Separate independent governance review Ready: all75 reporting hashes including binary PDF bytes, exact product anchor/deltas,75 static/79 API protected paths, immutable ADFA/Calendar history and unchanged safeguards checked; four targeted assertions pass.
- [Beta Build38806801078](https://github.com/Alex1122341/Teaching-assignment-azure/actions/runs/38806801078), job116669635199, at exact candidate a356df1: SUCCESS. Root860/821pass/39 explicit emulator/browser skips; Linux server613/609pass/4 explicit platform/SQL-lane skips; Auth/Firestore emulator860/853pass/7 browser-lane skips; governance58/58; zero failures. Seven actual Chrome workflows separately passed, along with two shipped-adapter tests. Windows-only protected-export ACL test passes in the local Windows server suite; Linux deliberately skips it. Container build (no push), canonical artifact build and all repository/artifact freezes pass.
- [SQL38806807330](https://github.com/Alex1122341/Teaching-assignment-azure/actions/runs/38806807330), job116669655948, at the same a356df1: SUCCESS, including all detection/review/recreation/Undo/privacy tests, seven observed lock waits, guarded rollback and prior Calendar/ADFA acceptance. Earlier migration-only tests38771955173 at the identical product SQL passed;043 was unchanged by governance.
- Downloaded artifact12006518723, name azure-beta-a356df195c10f0b5464dfaceed2125985f40b8a1, expires2026-10-22T21:06:12Z. Actual ZIP SHA256 matches GitHub metadata: `2a02c0989b1954750ac428843496b1ecb19c4d0671468660c3cf5275bfbf703d`. Extracted static and API freezes pass against accepted Git blobs. Exact153-file inventory (app76/API77), source allowlist and secret/private/test/recovery/workbook exclusion checks pass. This archive digest is distinct from the local combined-content digest above.

## Live-release prerequisites

Dedicated least-privilege University identity and explicit merge/migration/activation/deployment authorization remain outstanding. Production-scale performance is unmeasured. Candidate acceptance does not authorize any of these actions. Keep draft PR100 stacked on99/98; the next development task may proceed independently.

## Implementation decisions and limits

1. Local Docker was absent, so actual SQL acceptance ran in the existing labeled CI container and its workflow step was introduced early. Cost: CI latency; no school database was substituted.
2. The earlier Calendar workspace's installed Node22 was reused read-only. Cost: retain that tooling path; its plan artifacts remain unchanged.
3. Guarded043 rollback acceptance moved into the durable-review slice because that store is what it protects. Cost: the first SQL slice alone was not complete rollback acceptance.
4. API implementation began after real SQL contract acceptance while remote race/rollback verification continued. Cost: subsequent SQL contract findings could require API changes; one native implementer and full integration gates remained.
5. Unreliable test context_info signaling was replaced by the existing application-lock readiness plus labeled-connection/DMV wait pattern. Cost: synthetic harness depends on those test-only facilities; no product timing shortcut.
6. The existing timetable adapter gained an internal identity callback. Cost: caller must provide current identity to discard old-account filters/results; UID is not rendered or included in task DTOs.
7. Service identity, live migration/release and gate/permission activation remain separate prerequisites. Cost: accepted code waits for the dedicated identity and directed release; no db_owner exception.
8. Synthetic correctness/lock waits do not prove production-scale performance. Cost: production contention and latency remain unmeasured.
9. Arbitrary privileged deletion/reinsertion of Calendar timing rows is outside supported commands; supported resolution advances ActivityVersion. Cost: direct repair needs separate evidence-reset review.
10. Independent governance review covers the anchor/protection delta; full product behavior, suites, remote artifacts and release readiness have separate evidence. Cost: a Ready governance report alone cannot establish feature or deployment acceptance.

No deferred Minor findings were reported. Four Important product findings were reproduced and fixed; both independent reviews and the author's final verification evidence are recorded above.
