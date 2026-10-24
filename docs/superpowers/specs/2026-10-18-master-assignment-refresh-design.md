# MASTER assignment refresh — design proposal

Status: source reconciliation complete; owner approved this design on 2026-10-18 and requested the implementation plan. No implementation or live data mutation is authorized by this document alone.

## Goal and authority

Use the owner-supplied Teaching Assignments 2026 27 MASTER.xlsx as the current source for CCC scheduling, HICC courses, VISC areas, rotations, appointment periods and trainee supervision. Source SHA256 is `cb85141c7c80015332ebd908ddd6253f577fc39e658efa35b5422a8f8f1c0380`. Preserve the original workbook byte-for-byte. Cell-level private evidence is kept outside Git, including a saved source snapshot and the owner-facing reconciliation workbook.

Continue the explicitly selected University API / VetMed-Ops Beta workstream. Do not upload actual University workbook data into the separate synthetic Firestore Pages lab. Ordinary faculty see only their own confidential supervision/DOE details through server-authorized responses.

The owner's newest DOE instruction is decisive: compare workbook, stored values and authoritative engine output; report any difference and preserve the current DOE. Do not reuse the previous October 11 permission to overwrite a new discrepancy. No browser arithmetic, automatic proration, automatic policy publication or broad recalculation.

## Source findings

- The workbook has 34 sheets. The requested primary sources are CCC, HICCs, VISCs, Rotations and # Trainees. Summary/MASTER are cross-checks, not independent assignment feeds.
- HICC: 36 named source assignments versus 35 current, with four additional unassigned course definitions. One named source assignment has no DOE allocation.
- VISC: 34 named source assignments versus 35 current, plus three unassigned source rows. The removed current assignment has recorded DOE; report this separately rather than silently deleting its credit.
- Rotations: 38 participant rows and 12 named coordinators versus 38 and 11 current. Preserve category placeholders already explicitly present in the source; do not invent a person from narrative notes. Two existing coordinator allocations differ: source 1% each, recorded/engine 2% each. One participant has no source DOE.
- CCC: 413 populated staffing slots on 222 dates, May 5 2026 through April 29 2027. There are 402 exact resolved faculty/date slots and 11 literal Locum slots without a resolved person. Current 161 CCC activities share 41 identity/date keys; 361 new keys and 120 old-only keys are differences, not an approved deletion manifest.
- The CCC 22 faculty totals, including half-day deductions, agree with existing recorded DOE. Schedule replacement is needed independently of those matching totals.
- Trainees: 113 named source rows, 111 exact identity matches, one previously departed person to exclude, and one unresolved identity. Of the 111 matched rows, five lack the source DOE total cells. Source seven-category counts agree with the corresponding current evidence. Summed supervision assignments are 333 across 74 source faculty with positive counts; no student identities establish deduplicated headcount.
- Source fourth-year-preceptor footer includes the numeric guide row. Actual named-row quantity is 53, not footer 61. Preserve the original and explain the reconciliation.
- Read-only engine comparison covered 251 existing resolved items: 243 agree, two numeric differences, six missing source DOE values. Source allocations missing for new assignments are additional issues, not included in that 251-item claim.

## Approaches

1. **Recommended: one source reconciliation, separate domain commits.** Reuse existing annual policy, appointment schedules, CalendarActivity and supervision evidence. Replace the complete CCC dataset, while applying precise metadata/date updates elsewhere and preserving DOE exceptions. This provides full CCC coverage and limits unrelated deletion.
2. Replace every role/supervision dataset wholesale. Easier import logic but loses stable identifiers, exceptions and removed-role credit unless separately reconciled. Not recommended on these source differences.
3. Import only the 402 resolved CCC slots through the current template. Minimal engineering but omits all Locum coverage and cannot honestly be called a full replacement. Not recommended.

## Dates and appointments

Default appointment period is inclusive May 1 2026 through April 30 2027. An explicit day is preserved; a month-only start uses its first day and month-only end its last day. Resolve a missing year only when the selected academic year and source context make it unique. Conflicting dates remain review issues.

Use RoleAppointmentSchedule for multiple periods and existing optimistic concurrency/audit. An Ends/Restarts pair becomes two nonoverlapping periods, preserving the gap. Read structured cells and explicit role-date notes together. Ordinary leave/RSL notes are not automatically a second absence import or a role suspension, especially when the source separately grants full role credit. Retain the source notes privately for administrators.

Appointment dates describe role eligibility, not full-day working sessions. The annual default must never turn a rotation appointment into a year-long availability conflict. Rotation actual dates require confirmed source evidence. TBD, roughly, proposed, canceled and contradictory day/date text remains inspectable and explicitly unconfirmed.

## CCC full-year replacement

Extract typed date, source staffing column, faculty identity or literal staffing label, rotation/block text, closure and schedule notes. Record source hash/sheet/row/column for every slot. The 1.6 MiB master is read by trusted import tooling; do not enlarge the public parser's limits or pass the whole master into the six-column CCC parser.

Represent unresolved CCC staffing in the same CalendarActivity authority: extend it with a narrowly typed unassigned-CCC case (null faculty only for a validated CCC staffing placeholder, retained label Locum). Other activity categories still require a real faculty identity. Update all calendar/API/preview/recovery paths that assume a non-null faculty before enabling this case. Unassigned slots display in authorized schedules but do not create a faculty DOE line, AFC entry or personal availability block. No generic Locum faculty account is created.

The whole-year preview must contain all 413 source slots, all exact current target IDs/versions and all source exceptions. A resolved-only subset cannot pass completeness confirmation. Preserve missing times; no invented AM/PM split from an annual half-day total.

Reuse separate stage/commit gates, source-bound manifest, stale/expiry checks, faculty locks, idempotency and rollback/recovery patterns. Extend receipt/recovery to placeholders. Apply the complete old/new set in one transaction, with source metadata and durable history. Export and verify private recovery evidence. Refresh the exact preview immediately before owner confirmation and execution. Do not replay the completed 540-record AFC migration, change non-CCC activities or Course Calendar, or modify DOE as a side effect.

## HICC / VISC / Rotation and DOE engine

Reconcile exact faculty plus source course/area/rotation scope against existing stable role IDs. Update courses, literal grouped VISC subject areas, source notes, quantity evidence and effective schedules through trusted server tooling. Preserve multi-subject labels as one literal source mapping unless the source explicitly separates them. Store unassigned definitions without granting authority or credit to a guessed faculty member.

Produce a new source-referenced candidate in the annual engine workflow, retaining existing rules, stable scope keys and approved exceptions. Compare current stored DOE, current engine preview, candidate engine preview and explicit source allocation. Matching values may proceed with approved source updates. Mismatching values and missing source allocations are excluded from any credit write. A role removal that would change DOE is held as an explicit discrepancy. Ordinary metadata updates do not erase recorded allocation or override evidence. New roles with missing source DOE remain Needs review rather than receiving inferred default credit.

Publication/recalculation is a separate, explicitly scoped trusted operation after a no-unapproved-DOE-change impact preview. Engine comparison must use the exact canonical identifiers returned by the repository, not analysis-only normalized identity strings.

## Trainee data and Dashboard

Use a source-backed annual supervision snapshot, preserving seven category counts, original blanks, cached totals, calculation evidence, notes, source cells/hash and import status. Keep source DOE and current authoritative raw/applied supervision DOE distinct. Missing source totals do not overwrite existing DOE. Source identities unresolved or previously deactivated are retained as private issues, not automatically added/reactivated. An incomplete replacement does not erase unmatched current faculty snapshots.

Add one lazy-loaded **Trainees** Faculty Dashboard tab. Reuse the selected academic year and role helpers. Administrators may query authorized all-faculty data; a faculty user receives their own rows only. No broad private dataset is delivered and hidden in browser code.

Opening view: supervision-assignment total, faculty with trainees (admin only), source/DOE issues and raw/applied DOE when authorized. Below it, seven category totals and a compact searchable faculty table with counts, source DOE, current DOE and status. Notes/source detail expand per row; default pagination 25 rows, with authorized full-result export and consistent keyword/category filters. The measure is supervision assignments, not unique students, since no student identifiers are supplied. VETM 581/591 notes remain related working-session context, not extra trainee counts. Empty category cells retain missing-state provenance even where the explicit workbook formula treats them as zero for a calculated total.

## Delivery sequence and verification

1. Source parser/reconciliation and date normalization; synthetic fixtures rather than real workbook committed to Git.
2. Appointment/dictionary/rotation source update preview and DOE no-change guard.
3. Complete CCC placeholder-aware full-year preview/atomic replacement/recovery.
4. Authorized trainee source service and lazy Dashboard tab.
5. Focused TDD, SQL stale/race/rollback and unchanged-DOE checks, permission/privacy checks, full npm test, independent review and separately reviewed immutable runtime promotion.
6. Exact-main CI/artifact validation, coordinated release, fresh data preview, approved source commit and live acceptance; update original progress ledger accurately by capability, data application and deployment.

No implementation, SQL mutation, merge or deployment has occurred for this task. Human identity/date questions can be held while independent scoped work proceeds. Actual complete CCC replacement cannot omit unresolved slots or silently relabel a partial source as complete.
