# Integrated Availability freeze promotion

## Accepted integration

- Current reconciled main: `15dd7390d613bd3bd2163f411b81bc4ffdf22fd1` (PR126 History and PR127 Hosting guard preserved).
- Integrated product: `7fb4229fb718173f0d3cd6b8102451ddbfba0e48`.
- Previous main anchor: `fe1fa7002ef956f02e767053fbe2f6fea8daf748`.
- Independently accepted Availability source: `23e35c8bd0d107a22fcea6f00c88e9f221f0fa53`; original separately reviewed promotion: `1ad80d9f718883bb90d6e06f63d73f71d9895780`.
- Independent integrated-product verdict: READY.69 focused Availability, History, permission and Hosting tests passed. All5 Availability static,5 API and2 SQL paths remain byte-identical to23e35c8; main's History and Hosting guard are unchanged.
- Actual integrated SQL acceptance:39501222000/job118898912156, success at7fb4229. The source/adapter are identical to the earlier68-record, historical/source-parity, privacy/scope/DST and guarded rollback acceptance.

## This governance change

Promote the common static/API Git-blob anchor to exact integrated product7fb4229. Protect83 static assets and107 API runtime files, plus Dockerfile and both server package inputs:110 API protected paths. Relative to latest main, additions remain only2 static Availability assets and3 Availability API modules. Relative to the earlier Availability product, the additional runtime module is main's already accepted History operation projection.

The five Availability static and five API modifications are those listed in the original Availability governance record. The historical History anchor fe1fa700 is verified through immutable main15dd739, its original2 static/3 API changes and all original hashes. The historical Availability anchor23e35c8 is verified through immutable1ad80d9; its exact earlier coverage and hashes remain checked. Historical Lookup and all prior freeze proofs remain unchanged. No protected paths, mutation defenses, CI/build/artifact checks, SQL grants or runtime gates are removed or weakened.

Tests pin both source ancestries, all accepted Availability bytes, latest main History/Hosting bytes, the exact protected delta, source-only SQL056 and rollback, complete manifests and immutable reporting hashes. A pre-promotion test fails against the old main anchor. This governance-only commit changes no protected product bytes.

## Release boundary

Require separate independent integrated-governance READY and full root/server/emulator/build CI after this promotion. No old interrupted or conflicted build is acceptance. Then reviewed liveSQL056 application and actual authenticated Admin/Faculty API acceptance must complete before merge; exact-main push CI/artifact and coordinated API/Hosting-only release follow. Do not use a static-only compatibility mode for this feature. Preserve all27 existing gate values and the previous accepted API/static pair.

No liveSQL application, business write, policy publication, recalculation, permission escalation, merge or deployment is represented by this document.
