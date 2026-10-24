# Faculty Lookup teaching-summary layout follow-up

PR103 merged as `bfe175b7117e213b2dc954797074aad90a4061ce` after independent product/governance review and candidate CI401. Exact-main CI402 / run38914861058 passed root850/898, server609/613, emulator882/898 and governance60/60, with zero failures and explicit48/4/16/0 skips. The downloaded main artifact12051797951 has ZIP SHA256 `ac09d333d3f743b8ed77ea0f1ddfc6879d2ad8e60fe1b4a6db0fd56513db8bb8`; all153raw files match the accepted candidate. Its static/API freezes passed, and Hosting-only release succeeded. All75protected public assets matched that artifact byte-for-byte on2026-10-16.

Actual authenticated Chrome showed the existing Active2026-27 rules read-only, preserved Faculty Working Activities, and rendered the source Worksheet plus31grouped teaching rows as the final profile section. The three intended headers and four totals are present, excluded non-teaching groups are absent, and the tab has no console errors. No Save Draft, Publish or Recalculate action was taken. However, visual inspection caught the new three-column table inheriting the old six-column table's1150px minimum width inside a793pxprofile. This displaced Calculated DOE beyond the visible profile and prevented final layout acceptance.

Product fix `3cd51cacbd7de32367c55bf203a47801d5763abf` changes only scoped `.doe-excel-summary-table` rules in `faculty-admin.css`: remove the inherited minimum width, use fixed46/30/24% column proportions, wrap narrow cells, and make body group/total headers static while preserving sticky column headers. Existing source tables retain their original styles. Both independent Standards and Spec reviewers returned no findings.

The local Chrome reproduction uses the actual Worksheet renderer, synthetic facts and the actual before/after stylesheet. Before: table1150px in both793px and340pxfixtures. After: table777.67px within778px available content, and324.67px within325pxcontent; all three columns fit and all body headings are static. The fixture is temporary and is not shipped. No implementation-mirroring CSS assertion was added; browser geometry directly checks the reported failure.

Separate governance pins this product's Git blobs. Coverage stays75static and76APIruntime/79protected inputs; the exact protected delta from prior DOE product6b1d2fe is only `faculty-admin.css`. API/build/package bytes are identical. Original PR103 governance remains pinned independently at7a90331, preserving its four-file historical delta; all earlier anchors and anti-bypass checks remain. The new single-file promotion test was observed RED before anchor promotion, then GREEN1/1 with zero skips. Separate Standards and Spec governance reviewers returned no findings. Canonical build, repository/static/API candidate verification and both generated-artifact freezes passed. Full exact-candidate/main CI and downloaded-artifact checks remain required before this follow-up is released.

The owner's existing acceptance→merge→publish authorization covers this bounded correction. No SQL/data migration, API deployment, DOE publication/recalculation or permission change is part of it. Final public/browser verification and the Excel progress update remain pending until the corrected artifact is live. Then assess PR73/55 as previously directed.

## Final correction release and acceptance

PR106 merged as `21c2db7bc962c773d4863c03fa7f49b4d15120da`. Candidate CI403
(run38917758038) and exact-main CI404 (run38918714220) both passed root851/899,
server609/613, emulator883/899 and governance61/61 with zero failures and
explicit48/4/16/0 skips. The main artifact12053332989 ZIP SHA256 is
`46e234748a39453fb3ed07f91f88e67155f2d21849d7c1b353a80acf3827be35`.
All153raw files match the reviewed candidate; both artifact freezes passed.
Hosting-only deployment completed using that downloaded app directory without
rebuilding it. All75protected public files matched the main artifact on October16.

Authenticated Chrome accepted the actual profile: Item/Quantity/Calculated DOE
fit the1227pxcontent width with no horizontal overflow, min-width0px,31grouped
rows, expected four totals, final Worksheet position and Working Activities
preserved. Active Lecture weight was disabled; captured error logs were empty.
The earlier793/340pxsynthetic renderer checks remain supporting narrow-layout
evidence. No policy publication, recalculation, API deployment or business-data
mutation was performed.

The existing local progress workbook was updated in place with artifact-tool.
D03 passed; Task22 remains partial and D01/D02 remain pending. Formula counts:
18acceptance entries,5passed,12open,1not-applicable. Saved XML independently
confirmed preserved other values/formulas/styles, row dimensions, tables,
relationship targets and manual fields. Changed regions were visually inspected.
The isolated read-only renderer produced valid PNGs but its native shutdown
returned0xC0000409; the separate author/export and saved-package verification
both exited0. This is an artifact-renderer cleanup limitation, not an Excel or
application-data failure.
