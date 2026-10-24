# Special working activities in Calendar — design for owner review

Date: 2026-10-14. Repository: Alex1122341/Teaching-assignment-azure.
Base: 0d4b4d9ea2e658719e87f16ef5132b82544bc6c1.
Status: written design approved by owner2026-10-14; implementation plan awaiting review. Approval does not authorize a live migration or release.

## Outcome

Display actual working activities from the approved AFC tracker in the existing Calendar and faculty schedule. Remove only their proven AFC counterparts in the same transaction. Retain University Travel, Vacation, RSL, leave and owner-confirmed OPA in AFC. Course Calendar replacement capability is separate; current Course Calendar data is not replaced.

Erin Zachar is departed: exclude source rows267,297,563,773; do not create an active Faculty identity. The existing Canton record has now been deactivated with history/audit preserved. Archive reuses Inactive Faculty and Restore, rather than a second faculty directory.

## Evidence and scope

Source: AFC Tracker Lookup (2).xlsx, SHA256 4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF. AFC records A–D supply faculty name, inclusive start date, inclusive end date and purpose.812 rows comprise264 retained AFC,547 working candidates and1 blank purpose before exclusions/quarantine.

SELECT-only exact lineage/identity/date/purpose reconciliation originally found541 unique active imported AFC work records. A refreshed read still finds541 targets; all valid retained rows now have exact active counterparts, including row812 previously proposed for insertion. Concurrent manual AFC use is occurring: Dashboard progressed803→804→805 during audit. Preview must be regenerated before any commit; these counts are evidence, never an immutable deletion list.

Excluded: Erin's4 rows. Quarantined: reversed dates256/525, missing faculty307, missing purpose487, and8 source rows forming4 duplicate retained-AFC pairs. Existing absence history is preserved. No automatic date correction, deduplication or deletion of unclassified AFC.

The file has no separate course, academic year, clock-time, room, rotation type or group columns. Some purpose labels contain time/date text; retain it literally until an explicit parser/mapping is reviewed. Midnight Excel values are dates. Preserve all exact ranges, including20 working ranges outside May2026–April2027.

## Approaches and recommendation

1. **Recommended: a narrow SQL CalendarActivity range domain.** Existing Session remains the authority for timed teaching. CalendarActivity holds the missing date-range work domain, references canonical Faculty and optional verified Course, and shares existing Calendar/schedule adapters. No copied faculty catalog or second database. This matches the source grain and avoids triggering Session DOE calculations.
2. Extend Session to represent date ranges and absent course/time/year. This would change many existing non-null contracts, write validators, SWAP logic and DOE consumers; substantially greater regression risk.
3. Keep work records in AFC with display-only Calendar mirrors. This produces duplicate authority and does not meet the owner's AFC classification requirement.

Owner decision2026-10-14: approach1 and this written design approved; proceed to implementation planning.

## Proposed domain contract

- CalendarActivity: stable activity ID; canonical FacultyId; allowlisted activity category; original label; inclusive start/end DATE; nullable verified CourseId; nullable explicit clock-time evidence; source batch/hash/sheet/row; optimistic version; created/updated audit identity.
- Do not create missing course/year/room/group/DOE values. A known named rotation participant category is not evidence of a particular rotation type or credit.
- Academic-year filtering uses explicit approved range intersection for date-only activities, with a visible date-range description; it does not assign an invented source academic year.
- Import dataset is explicitly named afc-working-activities with this exact source hash and approved original date extent. Later CCC/rotation full replacements use separate explicit dataset/year scope and a completeness assertion.
- Each imported activity belongs to one source row/lineage, enforced by unique keys. Existing faculty references are retained; deactivated faculty cannot silently become active.
- Staging and import receipt reuse existing source/import audit concepts. Private source names, IDs, notes and deletion maps are admin-only.

## User flows

Administrator uploads Excel, sees validation and category counts, exclusions/quarantine, the541 exact two-sided mappings and source dates, then obtains an expiring preview version. Commit is explicit and source-bound.
Calendar shows date-range working activities in a separate existing view lane, with source title and assignee; missing time/room/group are shown as not provided. Faculty schedule uses the same authorized read projection. Existing teaching session Edit/Manage/SWAP stays on Session records.

Public/faculty reads expose only authorized working schedule fields. AFC remains binary availability for other faculty; never disclose retained AFC purpose, email, UCID, DOE or HR through the activity adapter or candidate response.

## Availability must ship before AFC cleanup

Shared server availability combines retained AFC, timed Sessions and CalendarActivity.
A date-only activity intersecting the candidate session date produces Needs Review, not Available or a fabricated timed overlap. Candidate listing and final approval/apply recheck enforce this consistently. Faculty cannot override it. Administrators must use an explicit audited resolution with verified time evidence; an unresolved record remains ineligible for automatic apply.

Adding/changing/deleting an activity and applying a SWAP must use the same faculty/date locking contract. Pending target snapshots, activity versions and availability are rechecked inside the final transaction; a concurrent work-range insertion cannot pass between recheck and apply. The implementation plan must name the actual locking queries and shared repository adapter, not rely on a browser check.

## Atomic commit and recovery

1. Recheck administrator scope, write gate, expiring preview, workbook hash, dataset/date scope and idempotency key.
2. Lock staged import and source/target rows. Resolve exact canonical/registered alias/accepted import lineage identities; reject ambiguities and deactivated targets.
3. Recheck latest AFC active status, expected rowversion, category, original dates/purpose and unique activity mapping. Revalidate full dataset revision and related availability facts.
4. Insert only validated CalendarActivity rows. Permanently delete exactly matched imported AFC rows only after authoritative activity records exist within this transaction. Do not delete unrelated, retained, manual or unclassified AFC.
5. Write restricted durable before-image recovery metadata, row-level source bindings and one commit receipt/audit in the same transaction. Return public-safe counts, not private deletion JSON.
6. Commit once. Any stale row or failure rolls back the whole operation. Reusing the same key/source returns the existing receipt; a conflicting key is rejected.

Permanent deletion requires an administrator-only recovery artifact containing exact before-images and schema/source bindings, stored outside public Hosting. Recovery is a separately authorized admin operation with current reference/conflict checks; it never rewinds later unrelated changes or uses broad table restoration.

No Session create/delete, DOE recalculation, policy/published update or ordinary AFC cancellation is part of this transaction.

## Permissions and release

Keep Firebase identity → University API → SQL authority. New writes remain closed behind independent gates until accepted release. Use dedicated least-privilege execute/read roles; current temporary runtime exception is not a blanket permission expansion.
SQL migration and rollback, API/static artifact freeze promotion, exact-main CI and coordinated release need focused reviews. Actual source migration needs a refreshed concrete preview and explicit operation authorization. Prior PR94 release approval does not authorize this migration.

The unrelated Faculty archive API defect discovered today is persisted QUOTED_IDENTIFIER=0 on DeactivateFaculty. One authorized Canton archive was completed using the unchanged procedure body as a parameterized admin batch under correct session settings, preserving every original guard/audit. No stored procedure was altered. Repair that metadata through a focused reviewed SQL correction; do not conflate it with activity import.

## Required acceptance

- Reconcile the regenerated version-bound target manifest to exact source lineage;541 is the current preview count, never a hardcoded acceptance expectation. Cover row812 nowexisting, Erin exclusions, bad dates/missing values/duplicate absence quarantine, cross-year ranges and no fabricated fields.
- Read/preview/export privacy; admin authorization; closed gate and scope denial; deactivated faculty rejection.
- SQL rollback after insert/delete/audit failure; concurrent stale source/target, replay and differing-source key; unrelated AFC/Session/DOE/published counts unchanged.
- Candidate Needs Review and final apply denial for date-only ranges; verified-time boundaries, adjacent intervals and activity/SWAP concurrent race.
- Calendar/faculty schedule/category filters and truthful source date/time display in Chrome.
- npm test, server suite, SQL migration/rollback fixtures, source/package build and repository/artifact freezes.

## Next stage

Written-design review is complete. Review docs/superpowers/plans/2026-10-14-calendar-working-activities-implementation.md and select its execution method next. No product code or new schema is written before that skill prerequisite is complete.
