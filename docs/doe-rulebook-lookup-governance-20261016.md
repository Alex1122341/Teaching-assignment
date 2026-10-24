# DOE Rule Book / Faculty Lookup freeze promotion

Accepted product candidate: `6b1d2fe200b756f08049ae6cb30d1ba0194a18d5`, merging the reviewed product fixes `85d0cb9202e34724882c02ece01f33c5910fe91d` with Beta main `d8b2109dbf07f2b2500bb1be79ad06572683af66`. Previous immutable static/API anchor: Selected Schedule Export product `bb6b86611a1c9eba2479f158ba864d63626b0b4d`.

The independent product standards and specification reviews returned no remaining findings after the editor-input and supervision-classification fixes. Both reviewers also checked the final merge resolution: Faculty Working Activities remains present, and the DOE Worksheet and its grouped teaching breakdown are at the bottom of Faculty Lookup. The two focused DOE test files passed 20/20 after integration. Actual Chrome acceptance loaded an authorized Faculty Lookup through the University API, rendered 31 breakdown rows, and verified placement and teaching classification. Its 20 API reads returned 200, with no JavaScript errors or business writes. These observations prove the read-only UI integration; they do not authorize policy publication or recalculate DOE.

This separate governance change pins immutable Git blobs at the accepted product candidate. Static coverage remains exactly 75 paths; the complete protected frontend delta is:

- `faculty-admin-doe-rulebook.css`
- `faculty-admin-doe-rulebook.js`
- `faculty-admin-doe-worksheet.js`
- `faculty-admin.js`

All 76 API runtime files, its Docker build definition, and both server package graph inputs remain byte-identical: 79 protected API paths, with no additions or removals. The static manifest, protected-path discovery, canonical byte comparison, repository/artifact checks, and attack regressions remain unchanged. Reporting JSON retains all 75 existing paths and derives their hashes from the product commit; only its source commit and the four changed frontend hashes move. The Selected Schedule Export governance remains independently pinned at `e76878cbcfe470eb8d3f3c8b560da4114f9f16e6`, preserving its exact historical delta and all earlier anchors.

The new exact-delta assertion was run before promotion and failed on the expected old/new anchor mismatch; after promotion its focused run passed 1/1 with zero skips. Separate independent Standards and Spec governance reviews returned no findings. The Standards reviewer independently checked the four changed hashes against the product Git blobs and confirmed the protection and history invariants.

`npm test` passed 850/898, with 48 explicit environment/browser skips and zero failures (390.0 seconds). `npm test --prefix server` passed 610/613, with three explicit disposable-SQL-environment skips and zero failures. `node tools/build-beta-release.js` generated the canonical combined package; `node tools/verify-beta-candidate.js`, the generated static artifact freeze, and repository/generated API freezes all passed against the new anchor with zero drift. Exact-candidate CI (including emulator/container) and downloaded CI-artifact verification remain pending at this checkpoint. This proposal does not itself establish merge, deployment, or live acceptance.

The owner has authorized acceptance, merge, and Beta publication using the existing environment. The release scope is the accepted static UI after green candidate and exact-main checks. No SQL operation, API deployment, DOE policy publication, recalculation, or source import is included.
