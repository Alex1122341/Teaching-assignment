# Faculty Lookup/Edit and DOE Rule Book reference parity

Date: 2026-10-08 (America/Denver)
Status: Written design awaiting owner review

## Approved direction

The owner requests Lookup/Edit close to the supplied GitHub Pages reference and its DOE Rules architecture, logic and functions. The owner confirmed retaining negotiated manual signed DOE adjustments while the rule system computes baseline DOE.

Reference: https://alex1122341.github.io/Teaching-assignment/faculty-admin.html
Controlled production: https://tester-teaching.web.app/faculty-admin.html
Starting production release: e1005a909eca0c18df19f3a8f23b722d01084896.

## Approach

Adapt the reference UI and policy contracts into the existing SQL-backed application. Reuse existing policy lifecycle, calculation engine and administrator APIs where compatible. Extend only demonstrated gaps.

Wholesale repository synchronization would restore incompatible Firestore business paths and Demo behavior. A cosmetic-only change would leave the requested rule functionality incomplete. The selected approach delivers reference UI/function parity through the current trusted backend.

## Lookup

- Keep the reference split layout: searchable faculty list, selected profile, clear selection and scroll regions.
- Match reference spacing, typography, borders, section headings, controls and responsive stacking.
- Group profile information into identity/contact, appointment, specialty/education and location/internal information when authorized and available.
- Show scheduled DOE, baseline role DOE, supervision, manual adjustments, total assigned, contract/effective target and remaining/overage with explicit provenance.
- Present course/teaching activity groups as expandable details, organized by academic year level and canonical course. Retain actual SQL session identifiers and calculated/stored credits.
- Present role appointments and source evidence without conflating access roles and DOE allocations.
- Show current/upcoming AFC separately from past archive, applying existing field-level privacy and permissions.
- Never convert missing data to zero. Explicit zero remains a valid recorded value.

## Edit Faculty

- Replace the undifferentiated field grid with reference-style sections and an accessible scrollable dialog, close/cancel controls and clear save feedback.
- Persist supported Faculty/profile fields through existing SQL APIs, preserving faculty IDs, relations, validation and audit.
- Add a field only when its SQL storage and authorization contract are explicit. Unsupported fields must be documented rather than presented as fake editable inputs.
- Preserve the manual DOE editor, scope suggestions/canonical tags, signed values, required negative reason, revisions, edit/deactivate and separate helper credit.
- Group annual target override separately from role adjustments. Preserve Contract Teaching DOE and the source value; approved overrides retain their reason and audit.
- Keep loading/error/save state local to the selected faculty; stale responses cannot populate another record.

## DOE Rules surface

Replace the primary JSON editor with the reference structured rule interface:

1. Academic year and policy version selectors with status/revision.
2. Lifecycle controls: New Policy Year, Clone as Draft, Copy from Previous Year, Validate, Impact Preview, Publish, Archive and Recalculate.
3. Main tabs: Rule Book, Course Mapping, VISC Subjects, Preview & Validate, History.
4. Rule groups: Assigned Teaching, Course Coordination, Clinical Rotations, Supervision, HICC/VISC, Reserve Logic, Other/Approved Activities.
5. Category tabs: Teaching Rules, Role Rules, Supervision & Complex, Target Rules, Exceptions.
6. Structured rule tables/editors for stable rule keys, selectors, declared inputs, calculation mode, rates, tiers, caps, formulas, effective/review status and linked references.
7. Reference panel/editor with title, section, table, page, effective date, annual review and optional notes stored separately.
8. Course/subject mapping tables and editors for canonical identities, units/stage/development and provenance.
9. Reserve editor for split threshold/ratio, ceilings, rolling years and reference/review status.

Controls must reflect actual server capability. The interface must never advertise successful persistence when a gate, permission or required input prevents it.

## Rule architecture and calculation

- SQL remains authoritative for policy versions, relational rules/selectors/parameters/tiers/inputs, references, mappings, exceptions and calculation snapshots.
- One Active policy per academic year. Active versions are immutable; edits occur on revision-checked drafts.
- Publishing requires validation and impact evidence for the exact current draft revision. Any mutation invalidates those approvals.
- Rule matching, formulas and calculation run in the trusted API; frontend presents results and explainers.
- Port the reference calculation semantics only after comparison with the existing engine. Preserve explicit required facts, caps, tiers, deterministic selection and safe formula parsing.
- Missing/ambiguous rules or mappings yield actionable Needs Review, including the exact missing field/source; no silent zero or fallback rate.
- Recalculation creates immutable evidence and updates eligible baseline records through existing controlled operations. It never modifies negotiated manual records.
- Copying a prior year creates a draft with reviewable mappings/references; prior-year exceptions are not silently carried forward.
- Errors and stale revisions remain visible, and all mutations retain actor/time/before-after audit.

## Operational values and manual adjustment interaction

The hosted reference labels itself synthetic and non-authoritative. Its visible Demo reserve parameters differ from its formal repository seed. Demo fixtures/rates must not become production inputs.

Use the approved Guidelines/MASTER and existing verified SQL sources. Current formal reserve values are threshold35%, split0.5, high-teaching ceiling15%, teaching-focused ceiling7.5%, rolling3 years. Any proposed change must appear in a draft and impact preview, with evidence.

Compute baseline supervision reserve before applying negotiated manual credits. Then add active signed manual adjustments to assigned DOE and subtract assigned DOE from the effective target. A -2 entry reduces assigned DOE by two percentage points; it must not be canceled by a recomputed supervision reserve.

Imported operational/prorated values remain visible with their own provenance. Where authoritative source values and rule-calculated estimates differ, display the reconciliation and require an explicit approved action before replacing persisted baseline credits.

No automatic counterpart entry for a helper. No invented target values, supervision counts or negotiated allocations.

## Permissions and rollout

- Preserve Firebase identity, University API authorization, SQL authority and existing privacy rules.
- Rule draft administration, publication and recalculation retain separate capabilities and narrow SQL operation permissions.
- Activate the required rule capabilities only after repository permission contracts, audit, revision protection and live source state are verified. Do not grant unrestricted SQL access or change the existing principal's broad privileges.
- Actual publication/recalculation is an explicit administrator action with impact preview; merely deploying this feature does not publish a changed annual policy or bulk-rewrite faculty allocations.
- Keep new UI/features on an isolated feature branch and reviewed PR with separate frozen-runtime promotion.
- Release only after exact-main CI, required guarded SQL migration, source-attested API cutover with rollback, and Firebase Hosting-only deployment.

## Acceptance

- Lookup and Edit are visually compared with the reference at desktop and narrow widths; sections and controls are usable without clipping or nested scroll traps.
- Authorized data remains complete; missing values remain distinguishable from zero.
- Manual signed DOE still contributes once to all detail/list/summary totals and survives baseline recalculation.
- Structured policy editing produces the expected SQL bundle, preserves unedited fields, rejects stale revisions and shows authoritative failures.
- Rule mapping, validation, preview, lifecycle and history expose the reference functions through working API capabilities.
- Draft changes cannot mutate Active policy; publication cannot bypass same-revision validation/impact; no automatic bulk recalculation occurs on deployment.
- Live acceptance uses read-only inspection unless a real authorized input is supplied. No fabricated production faculty adjustments or policy publication.
- Screenshots and release identifiers are recorded in continuity documentation.

## Scope boundaries

This task concerns Faculty Lookup/Edit and DOE Rules. Other Demo sections are not additional implementation scope. No import reruns, account impersonation controls, synthetic fixtures, Firestore business fallback or unrelated timetable redesign.

## Next stage

Owner reviews this written design. After approval, write the implementation plan and present it for review/execution choice, as required by the brainstorming skill. No product implementation starts before these stages.
