# Availability release governance after PR128

Latest accepted main is `1b4c3fb3be383119039ee170660c395d8e556847`. Independently accepted integrated Availability product is `a0c0e6829f313f13486265a0bb60dd8bd641b27e` (READY,84 affected product tests passed). All12 Availability static/API/SQL files match original accepted23e35c8 exactly. All other protected runtime and the Hosting guard match latest main. No implementation was changed during this reconciliation.

This separate governance commit anchors static and API freeze to exacta0c0e68. Protection remains83 static assets,107 API runtime files, Dockerfile and2 package inputs (110 API protected paths). Relative to latest main the change remains5 static/5 API paths,2 new static assets,3 new API modules and only SQL056 plus its rollback. No protected path is removed, and no protected runtime byte is changed by governance.

Historical evidence stays immutable:

- Lookup846858 through main6addfb9.
- Original Availability23e35c8 through governance1ad80d9.
- History operation groupingfe1fa700 through main15dd739.
- First integrated Availability7fb4229 through governance93993f5.
- Latest History presentation reset573dbe4 through main1b4c3fb.

The existing PR128 reset-governance test previously used the current baseline as its historical accepted product. It now pins the original573dbe4 product explicitly, proves the original freeze/report in immutable1b4c3fb and checks ancestry into the current anchor. Its exact2 static/2 API delta,81/104 historical counts and no-SQL-migration proof remain unchanged. Current-root counts are updated separately to83/107/110. Original reports are never rewritten to imply Availability was part of an older release.

The new release-governance test checks both accepted ancestries, exact original Availability blobs, latest main History/Hosting blobs, complete additive manifests, immutable reporting hashes and current zero drift. Before promotion it failed against the old573dbe4 anchor. All Git-object authority, manifest unions, attack tests, CI/workflow/build/artifact checks remain mandatory.

This is not a release receipt. Require independent final governance READY, fresh exact-head root/server/emulator/build CI and artifact; reviewed live056 preflight/application and actual authenticated Admin/Faculty API acceptance before merge; then exact-main CI/artifact and coordinated University API/Hosting-only release. SQL/business rows, accounts,27 gates, DOE publication and recalculation have not been changed by this acceptance work. A real Faculty sign-in is an outstanding human dependency, not a passing test.
