# Manual DOE adjustments implementation plan

> Use superpowers:executing-plans for inline implementation.

**Goal:** Implement the owner's confirmed manual Course / Subject / Scope and signed DOE entry design.
**Architecture:** Dedicated manual assignment records, additive to existing source DOE, with administrator authorization, a separate write gate, transactional revision checks and immutable audit. Existing annual calculation and target override permissions stay unchanged.
**Stack:** Vanilla JavaScript, Node API, SQL Server, Firebase Hosting.
**Spec:** Owner's confirmed proposal in this conversation: editable scope with existing suggestions and canonical tags; signed percentages including zero; additive adjustments; negative values require notes; manual edit/deactivate, no automatic counterpart entry.

## Tasks

- [x] SQL migration: dedicated manual table and narrowly granted save/deactivate procedure; source suggestions use existing data only.
- [x] API/repository: scoped capability and authenticated administrator routes; validate identities, numeric range/precision, revisions, scope and negative notes.
- [x] Read integration: manual role credits in worksheet totals, DOE list and Roles & Appointments search; do not replace imported trainee or role sources.
- [x] Editor: manual input, datalist suggestions, save/edit/deactivate, duplicate click guard, inline failures, retain existing target controls.
- [x] Independent code review and any necessary repairs.
- [x] Separate freeze promotion, reviewed PR, exact-main CI, SQL migration, API cutover, Hosting publish, read-only live UI acceptance and continuity checkpoint.

## Review focus

Negative and zero values; unchanged baseline sources; stale edits and concurrent saves; foreign faculty/year IDs; unknown free-text scope versus known canonical tags; disabled annual write gates; manual provenance without fabricated policy calculations.

No new tests or local test execution under the current developer instruction. Existing CI runs the repository's established suites. Do not create invented negotiated DOE records during live acceptance.
