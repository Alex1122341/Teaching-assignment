# Calendar work and Away revision

Accepted product: `3d983cf317147a20415e8e5cfd0d3f17532af27f`.
Previous anchor: `0be7e75c483b497cc566c24a3d9366ad32827f8c`.

Owner approved Remote Work remaining in AFC/Away and all twelve abnormal source rows displaying Away / Needs Review with original issues. No missing identities, inverted dates or duplicate records are repaired or inserted. The seven work categories and six teaching categories remain selectable; no year or rotation subtype is inferred.

Product review found no actionable issues. Parser/UI focused verification passed 41/41. SQL test-first CI failed explicitly with REMOTE_WORK_MUST_REMAIN_AFC_AWAY against preserved v1; SQL045 implementation acceptance is pending. It must prove old manifest rejection, canonical work-only commit, retained AFC versions, recovery and guarded rollback before release.

This separate freeze promotion changes exactly two static assets (calendar-activities.js and faculty-admin-activity-import.js) and two API files (activity-import-policy.js and activity-workbook-worker.js). Static paths remain 75, API runtime 76, protected API paths 79. All manifests, build definitions, blob comparison and baseline/current manifest union enforcement remain unchanged. The prior timeout promotion and all older historical assertions remain pinned. Reporting changes only its source reference and the two changed static hashes.

SQL045 is an additive, five-module definition revision with exact canonical definition hash preconditions and a guarded rollback. It changes no business records, memberships, grants or runtime gates. Source/preview/version and canonical purpose checks remain server authoritative. Public write gates remain closed during preparation. Candidate CI, exact-main CI, artifact attestation and coordinated University API/Firebase Hosting-only release are still required.

The prior 541-target v1 manifest is superseded. After release, refresh the existing approved source batch and verify that v2 contains exactly the old accepted set minus the single Remote Work row (expected 540). Owner already approved this precise subset. No additional targets are authorized. Only then perform the receipt-bound atomic migration, immediately export and verify private recovery, verify protected AFC/teaching/DOE/published state, and update the original progress workbook. No business migration has occurred at this checkpoint.

Separate governance review is Ready with no findings. Local full tests: root 876/927 passed, 51 explicit skips; server 616/619 passed, 3 environment SQL skips; governance/deployment 65/65 passed. All zero failures. SQL045 compiled and the five-module rollback/reapply proof passed in disposable CI; its new synthetic manual-AFC fixture was corrected to use the actual AfcManualRecord schema. Complete SQL acceptance remains required before release.
