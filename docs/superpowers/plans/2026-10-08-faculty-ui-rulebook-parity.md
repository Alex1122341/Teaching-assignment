# Faculty UI and DOE Rule Book Implementation Plan

> Execute with superpowers:subagent-driven-development. Owner directed completion and publication without further design-stage pauses.

**Goal:** Reference-like Lookup/Edit and functional structured annual DOE administration with manual signed adjustments retained.
**Architecture:** Adapt presentation to existing SQL API contracts; extend backend lifecycle only for demonstrated reference gaps. Preserve policy provenance, manual adjustments, revision guards and privacy.
**Tech Stack:** Vanilla JavaScript/CSS, Node, SQL Server, Firebase Hosting.
**Spec:** ../specs/2026-10-08-faculty-ui-doe-rulebook-parity-design.md

## Constraints

- No new or local tests under developer instruction; inspect syntax/build and established automatic CI.
- No synthetic live allocations, automatic publication or bulk recalculation.
- Existing verified workload values and deferred targets remain unchanged.
- No Firestore business paths or Demo fixtures.

## Tasks

- [x] Faculty UI: modify faculty-admin.js, faculty-admin-management.js, faculty-admin.html and faculty-admin.css. Group editor/profile fields, expandable course details, AFC archive, responsive reference layout. Preserve controls, canonical identity and manual editor.
- [x] Rule UI: modify faculty-admin-doe-policy.js and create faculty-admin-doe-rulebook.js/css as needed. Typed rule/mapping/reference/reserve editors, categories/groups/tabs, validation/impact/history/lifecycle through authenticated existing APIs; preserve unedited bundle fields, safe revision and single-flight behavior.
- [x] Backend lifecycle: inspect reference/current engines and permissions, implement Clone as Draft or other gaps narrowly, bind scoped capabilities for the requested actual operations; no deployment-triggered publication/recalculation.
- [x] Task reviews and broad branch review; repair findings.
- [x] Product commit and separate reviewed runtime freeze promotion. Update established inventory assertions only where manifests/interfaces change.
- [x] PR, exact-main CI, guarded SQL changes if required,60+file source attestation/API cutover and rollback, Hosting-only release.
- [x] Live read-only acceptance screenshots and durable release checkpoint.

## Review focus

Stale faculty/policy selection; zero/negative/manual DOE versus baseline recalculation; ambiguous/missing mapping data; losing unseen bundle properties during typed edits; unsupported profile fields; narrow roles and immutable Active policy; double submission and same-revision publication checks.

## Decisions

Ruling: proceed through implementation and publication stages without additional design approval requests, following the owner's explicit instruction.
Ruling: preserve current formal reserve35/0.5/15/7.5/3-year inputs; visible Demo values are not authoritative.

Post-release SQL hotfix PR78 completed: exact-main CI37947990687, guarded API cutover, Hosting-only release and live screenshots/checkpoint recorded in agent.Ai/updates/2026-10-09-faculty-rulebook-release-complete.md.