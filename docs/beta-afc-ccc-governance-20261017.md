# AFC originals and CCC replacement governance

Accepted product: `9eb2dafea78674013a6c7fd894cdb1b6f2342c3f`.
Prior immutable product: `331a636544e7232dbe98f67edbdf1cfbfa0e535d`.

This separate governance change promotes one Git trust anchor for both runtimes. Static protection grows from77 to79 by adding `faculty-admin-afc-forms.js` and `faculty-admin-ccc-replacement.js`. API runtime protection grows from81 to93; the Dockerfile and two locked package inputs remain protected,96 paths total. No protected path is removed. Verification reads immutable Git blobs, with no drift exceptions.

Exact static delta is six files: the two new controllers, Faculty Dashboard CSS/HTML/controller and shared data client. Exact API delta is seventeen files: twelve new PDF/CCC modules, extracted workbook utility import, gates, history projection and two runtime adapters. Tests pin both complete lists and compare every other protected byte. Package graphs, API origin, Firebase authority, existing role checks and completed540 migration remain unchanged.

## Product evidence

- Independent fixed review `3632b897..5ec9a995`: one Important, G-only source rows silently skipped. Regression failed before correction and parser suites33/33 passed afterward. Existing target Faculty labels showing GUID were graded Minor and deferred; IDs bind correctly.
- Earlier independent AFC review: escaped PDF names, embedded attachment references and unbounded external decoder allocations reproduced before correction. Six PDF tests pass; pdf-lib1.17.1 stays pinned. Worker-only guards enforce8MiB/stream and32MiB cumulative decoder allocations before allocation.
- Full server after final product:684pass/3environment skips/0fail of687.
- Root integration contract subset97/97; final focused API/UI/client/history44/44. Full root, emulator and final candidate build remain required.
- SQL CI39064333728 (`a008165`) succeeded: all existing SQL regressions plus CCC source/scope/role/expiry/atomic failure/recovery/protected hashes, six observed two-connection waits, populated rollback refusal and empty rollback.
- Actual Chrome synthetic controller/client/API/parser flow passed for both PDF upload/download and CCC workbook preview/confirmation. No school business records were created. Native file picker permission and actual mobile/user acceptance remain open.

## Release boundaries

Release SQL048/049 additively, verify protected business tables, then stage an attested matching University API and publish exact-main generated Firebase Hosting bytes. The original upload flag and CCC staging flag may be enabled after accepted release. CCC commit stays false until a fresh approved complete-year workbook and exact whole-set preview receive confirmation. No real CCC replacement or old migration replay is part of this release.

The school runtime account prerequisite is waived by the owner for this phase. Existing approved identity remains. Recovery scripts must be repinned to the accepted version/config after cutover; task installation and reboot remain human steps. A fixed hostname is still unavailable, so changed Quick Tunnel origins require a reviewed frontend release.
