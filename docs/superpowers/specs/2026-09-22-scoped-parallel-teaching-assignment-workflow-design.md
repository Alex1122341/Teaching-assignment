# PAWS Scoped Parallel Teaching Assignment Workflow — Design Spec

Date: 2026-09-22  
Status: Approved design baseline — P3.1 architecture lock (grouped HICC/VISC review + versioned timetable publication)  
Repository: `Alex1122341/Teaching-assignment`  
Implementation branch: `feature/scoped-parallel-assignment-workflow`

## 1. Purpose

Replace the old serial office-gating model with a Teaching Assignment workflow that has three clear layers:

1. parallel Working preparation by ADC/DVM, LAB and the responsible HICC;
2. a HICC-owned review chain in which the HICC submits to its group VISC, the VISC approves or pushes back, and the HICC performs the final submit to ADFAD;
3. a separate versioned timetable publication boundary so unfinished Working changes never leak to ordinary Faculty.

The explicit Change Request workflow remains separate and serial.

The existing `sessions` + `calendar_sessions` pair remains the internal Working layer. Faculty consume only the active Published release.

Terminology is updated for all user-facing text and documentation:
- `ADFAD` -> `ADFAD`
- `ADC/DVM` -> `ADC/DVM`

Existing technical keys such as `adfa`, `adfa_general`, `adfa_regular`, and `adc` remain unchanged in this phase to avoid an unnecessary data/rules migration.

This design does not redesign DOE formulas and does not treat ADFAD session finalization as timetable publication.

## 2. Repository and branch baseline

The implementation branch is created from:

`fix/workflow-functional-completion`

That remote branch contains the current PR #67 Work Queue, LAB roster, and approval wiring that must be preserved.

Before product-code implementation begins on the home computer, the implementation worktree must merge the latest `origin/main` into this feature branch and run baseline tests.

The unfinished local PR #67 worktree on the company computer is not available on the home computer and must not be reconstructed or assumed to exist.

The company-computer WIP was preserved on `handoff/pr67-phase-a-wip` at checkpoint `11b14aea01498efb19a7adca27cb80d69614811c`. Reconciliation concluded:
- D1 LAB roster/group consistency contains reusable integrity ideas but must be reimplemented cleanly; the handoff commit must not be cherry-picked wholesale.
- D2 serial readiness is superseded and must not be continued.
- D3 added no reusable local implementation.

In particular, a referenced LAB group that does not exist must fail closed, while LAB group/roster completion remains independent from HICC/VISC review and ADFAD assignment readiness.

## 3. Separate the lifecycles

### 3.1 Normal Teaching Assignment preparation and grouped review

The target flow is:

```text
ADC/DVM creates the session skeleton
          |
          +----------------------+
          |                      |
         LAB              responsible HICC
 operational work        prepares own package
          |                      |
          +-----------> HICC Submit for VISC Review
                                 |
                                 v
                           VISC REVIEW
                           /          \
                    Push Back        Approve
                       |                |
                       v                v
                  HICC revise      VISC Approved
                       \                /
                        \              /
                         HICC Final Submit
                                 |
                                 v
                              ADFAD
                    final review / Faculty assignment
                                 |
                                 v
                        ADFAD Approve & Submit
```

The responsibility chain is intentionally asymmetric:

- HICC owns the Teaching Assignment package for its assigned course/Subject scope.
- VISC is the leader/reviewer for a Teaching Assignment group and can review all HICC packages in that group.
- VISC approves or pushes back; VISC does not perform the final submit to ADFAD.
- HICC performs the final submit to ADFAD after the current package revision has VISC approval.
- ADFAD performs final Faculty assignment and authoritative submission.
- LAB work stays operational and parallel; LAB roster completion does not block this review chain.

### 3.2 Explicit Change Request approval

The existing routed Change Request flow remains separate and serial:

```text
Change Request
  -> ADC/DVM approval when required
  -> LAB approval when required
  -> ADFAD approval when required
  -> Apply
```

Existing approval lifecycle, routing, order enforcement, push-back, reject, resubmit, and finalizer behavior remain intact unless a separate approved design changes them.

A Change Request created from a Published release retains publication provenance such as `baseReleaseId` plus existing/public base-session evidence. Final apply revalidates current Working state and fails closed when the reviewed base is stale.

The HICC/VISC Teaching Assignment package review is not a Change Request and must not create `change_request*` records.

### 3.3 Working versus Published timetable boundary

Normal Teaching Assignment review and timetable publication are separate:

```text
INTERNAL WORKING LAYER
sessions
  -> calendar_sessions (sanitized Working projection)
  -> ADC/DVM / LAB / HICC / VISC review / ADFAD / Developer-Owner
  -> ADFAD Approve & Submit
  -> finalized Working assignment

EXPLICIT PUBLICATION
  -> build complete Academic-Year release
  -> validate
  -> seal
  -> atomically switch activeReleaseId

FACULTY-FACING PUBLISHED LAYER
  -> active sealed release only
```

`ADFAD Approve & Submit` is session-level final assignment authority. It does not publish the timetable.

`Publish Timetable` is timetable-level release authority. It does not create/change final assignments and does not trigger DOE.

Working edits after a release is active do not change what Faculty see until a later explicit Publish.

## 4. Session skeleton, ownership, and readiness

### 4.1 ADC/DVM skeleton

ADC/DVM owns the base scheduling skeleton:

- course
- date
- start
- end
- session type

Year/semester/week may remain derived or stored under the existing canonical session model.

Room is not a review or ADFAD readiness gate.

### 4.2 Teaching Assignment ownership fields

Each HICC-owned Working session carries trusted ownership metadata:

```text
teachingAssignmentGroupId
responsibleHiccUid
```

These fields are assigned through trusted administration/group configuration.

HICC and VISC cannot change either field themselves.

### 4.3 Topic

For LEC and SRL:

- responsible HICC may create/edit Topic within exact authorized course/Subject scope.
- ADC/DVM may continue approved scheduling/content support where existing policy permits.

For LAB:

- LAB may create/edit LAB Topic.
- responsible HICC may review the package content within its assigned scope.

VISC is a reviewer, not a direct Topic editor. If VISC requires a change, VISC uses Push Back with a review comment; the HICC changes and resubmits.

Topic edits continue to use audit logging and do not create a separate Topic approval record.

### 4.4 Content readiness

A HICC package is content-ready for VISC review when every included session has:

- course
- valid date
- start
- end
- session type
- valid Topic

The following do not block VISC review or later ADFAD assignment:

- room
- Faculty suggestions
- contributor notes
- LAB group completion
- LAB roster completion

### 4.5 Review and handoff readiness

The package lifecycle is:

```text
draft
 -> HICC Submit for VISC Review
visc_review
 -> VISC Push Back -> changes_requested -> HICC revise/resubmit
 -> VISC Approve   -> visc_approved
visc_approved
 -> HICC Final Submit -> submitted_to_adfad
submitted_to_adfad
 -> ADFAD final Faculty assignment
 -> adfad_finalized
```

ADFAD must not receive a normal Teaching Assignment package merely because Topic/content fields are complete.

ADFAD queue entry requires:
- latest HICC package content is content-ready;
- VISC approved the same current review revision/fingerprint;
- HICC performed Final Submit after that approval.

Any review-relevant Working change after VISC approval invalidates that approval and requires HICC resubmission for VISC review before another Final Submit.

## 5. Parallel Working contributions

ADC/DVM, LAB and the responsible HICC may contribute independently while the package is in an editable Working state.

A contributor may:
- suggest one or more Faculty where permitted;
- maintain their own internal Teaching Assignment note;
- edit only the fields allowed by their role/scope.

One contributor's save must not overwrite another contributor's suggestion or note.

VISC is not a peer contributor in this model. VISC review actions and review comments belong to the HICC package review record, not to the actor contribution document.

HICC owns the final package handoff to ADFAD.

## 6. HICC scope and VISC group leadership

### 6.1 Base identity, operational access, and academic responsibility

Base identity, operational office access, HICC academic scope, and VISC group leadership are separate concepts.

Do not grant authority solely because `role == 'hicc'` or `role == 'visc'`.

### 6.2 HICC Course and optional Subject scope

HICC scope supports:

1. Course-wide
2. Course + Subject

Examples:

```text
HICC -> VTMD 505
HICC -> VTMD 506 / Surgery
HICC -> VTMD 506 / Anesthesia
```

Rules:
- course-wide scope covers all Subjects in that exact course;
- Subject-limited scope requires exact course + exact `subjectKey`;
- no substring/fuzzy matching;
- Topic text is never authorization evidence.

### 6.3 Canonical Subject model

Subject is separate from Topic.

Example:

```text
course:     "VTMD 505"
subjectKey: "surgery"
topic:      "Pre-operative Management"
```

Subject comes from the administrator-maintained canonical Subject catalog.

HICC does not create arbitrary authorization Subjects. VISC does not change Subject to broaden review authority.

### 6.4 HICC authorization storage

Use bounded profile-local exact tokens:

```text
academicScopeTokens:
  hicc|VTMD 505|*
  hicc|VTMD 506|surgery
  rotation_coordinator|VTMD 590|*
```

Rules:
- grammar is exactly `responsibility|COURSE|subjectKey`;
- `*` means course-wide;
- matching is exact after normalization;
- malformed/legacy missing tokens fail closed;
- no derived `user_scopes/{uid}` cache;
- HICC role name alone grants no academic authority.

VISC review authority is not represented by a course/Subject token. It comes from Teaching Assignment group leadership.

### 6.5 Teaching Assignment groups

Use a dedicated collection; do not repurpose the existing HICC-owned `faculty_groups` swap/member model.

Canonical collection:

`teaching_assignment_groups/{groupId}`

Conceptual record:

```js
{
  name: "Bovine",
  leaderViscUid: "uid-visc-bovine",
  hiccUids: ["uid-hicc-a","uid-hicc-b","uid-hicc-c"],
  active: true,
  updatedBy,
  updatedAt
}
```

Rules:
- one VISC leads a group in the first implementation;
- a VISC may lead more than one group;
- a HICC may belong only to groups explicitly assigned by trusted administration;
- VISC may review all HICC packages/sessions in groups they lead;
- HICC remains limited to its own `responsibleHiccUid` sessions plus exact course/Subject scope;
- HICC/VISC cannot change group leadership or membership;
- group membership is not DOE evidence.

### 6.6 Deprecated `other_office` role

`other_office` is not part of the target PAWS role model.

It receives no new Teaching Assignment, review, Working timetable, publication, or final-assignment capability.

During Task 6, perform a read-only dependency check before removing runtime acceptance. If an active account depends on it, stop and report the migration requirement.

Future offices receive explicit capabilities/scopes based on real business requirements; do not create another generic placeholder role.

## 7. Faculty suggestions

Suggestions are advisory only.

Requirements:
- ADC/DVM, LAB and responsible HICC may suggest Faculty where permitted.
- multiple Faculty may be suggested;
- contributor provenance is retained;
- suggestions never automatically become final assignments;
- VISC reviews the HICC package but does not directly convert/edit suggestions as a peer contributor;
- ADFAD may accept any subset, remove suggestions, or manually select other Faculty;
- authoritative assignment occurs only on explicit ADFAD Approve & Submit.

Safe suggestion payload:
- opaque `candidateKey`
- display name
- source/provenance
- no UCID
- no email
- no exact DOE
- no AFC reason
- no HR/private fields.

## 8. Contribution and package-review storage

### 8.1 Actor-scoped contributions

Use:

`session_assignment_contributions/{sessionId}__{sourceRole}__{actorUid}`

Conceptual document:

```js
{
  sessionId,
  course,
  subjectKey,
  sourceRole,          // adc | lab | hicc | future approved contributor
  actorUid,
  actorDisplayName,
  suggestions: [{ candidateKey, displayName }],
  note,
  updatedAt
}
```

Each contributor owns their own document.

VISC review is not stored here.

### 8.2 HICC Teaching Assignment submission package

Use:

`teaching_assignment_submissions/{submissionId}`

A submission represents one HICC's Teaching Assignment package for one Academic Year and one Teaching Assignment group.

Conceptual fields:

```js
{
  academicYearKey,
  groupId,
  hiccUid,
  viscUid,
  status,                    // draft | visc_review | changes_requested |
                             // visc_approved | submitted_to_adfad | adfad_finalized
  revision,
  reviewFingerprint,
  viscApprovedFingerprint,
  viscReviewComment,
  submittedForReviewAt,
  viscReviewedAt,
  finalSubmittedAt,
  updatedAt
}
```

The package covers all current Working sessions where:
- Academic Year matches;
- `teachingAssignmentGroupId == groupId`;
- `responsibleHiccUid == hiccUid`;
- session course/Subject is within the HICC's exact authorized scope.

Review-relevant edits produce a new revision/fingerprint.

A VISC approval is valid only for the exact reviewed fingerprint.

HICC Final Submit is allowed only while current fingerprint equals `viscApprovedFingerprint`.

The package review record is separate from explicit Change Request records.

## 9. Teaching Assignment and review notes

Contributor notes are internal.

Readable by:
- ADFAD
- ADC/DVM and LAB where needed for Teaching Assignment work
- responsible HICC
- VISC when reviewing a package in a group they lead
- Developer/Owner/high-trust administration

Not readable by:
- ordinary Faculty without Teaching Assignment responsibility
- Student-facing users

VISC Push Back/review comments live on the package review record and are visible to the responsible HICC and ADFAD/high-trust users.

Notes/review comments never enter:
- Working calendar projection
- Published timetable release
- ordinary Faculty self-view
- Student-facing projection
- broad audit text

Audit may record safe facts such as "Teaching Assignment note updated", "VISC approved package", or "VISC requested changes" without copying private note/comment bodies.

## 10. LAB groups and roster

LAB continues to support:

- Group A/B/C and additional groups
- group metadata
- roster membership

### 10.1 Temporary roster visibility rule

For the current phase, the full LAB roster is readable by every authenticated, active PAWS user.

This is an explicit temporary product decision.

Read permission does not imply write permission.

Roster management remains limited to LAB and existing approved administrative/high-trust roles.

This temporary read rule must be isolated so a future Student-facing design can narrow visibility without redesigning the LAB data model.

### 10.2 Readiness

LAB group or roster incompleteness never blocks ADFAD Faculty-assignment readiness.

LAB outstanding work remains independently visible to LAB.

## 11. HICC/VISC package review, ADFAD final assignment, and publication

### 11.1 HICC Submit for VISC Review

Responsible HICC may submit its current package for VISC review only when:
- package content is ready;
- every included session is owned by that HICC and exact-scope authorized;
- current package fingerprint is recorded.

While in `visc_review`, VISC reviews all HICC package sessions in the group.

### 11.2 VISC Approve / Push Back

VISC may:
- Approve the reviewed fingerprint;
- Push Back with an internal review comment.

VISC may not:
- directly edit HICC Topic as part of review;
- change HICC scope/group ownership;
- Final Submit to ADFAD;
- assign Faculty authoritatively.

Push Back returns the package to HICC for revision/resubmission.

### 11.3 HICC Final Submit to ADFAD

After VISC approval, the HICC performs Final Submit.

Final Submit succeeds only if:
- package status is `visc_approved`;
- current review fingerprint still equals `viscApprovedFingerprint`.

If review-relevant Working data changed after approval, Final Submit fails closed and the package requires VISC re-review.

Final Submit moves the package to `submitted_to_adfad`.

### 11.4 ADFAD final Faculty assignment

ADFAD is the final Faculty assignment authority.

ADFAD may:
- review package/session fields;
- review contributor suggestions/provenance;
- review internal notes and VISC outcome;
- select one or multiple Faculty;
- remove suggested candidates;
- manually choose different Faculty.

Reuse the existing multi-Faculty assignment model. Do not duplicate sessions per Faculty.

### 11.5 ADFAD Approve & Submit

The authoritative session-level flow is:

```text
submitted_to_adfad package
 -> ADFAD final selection
 -> Approve & Submit
 -> Working session assignments[]
 -> derived facultyIds/instructor
 -> sanitized Working calendar projection
 -> audit
 -> DOE recalculation request when Rule Book-relevant facts changed
```

Do not create a redundant `adfadSubmittedAt`/technical mirror state solely to duplicate assignment evidence.

ADFAD Approve & Submit does not publish the timetable.

HICC Submit, VISC Approve/Push Back, and HICC Final Submit do not trigger authoritative DOE.

### 11.6 Versioned timetable publication

Keep:

```text
sessions
  = authoritative Working source

calendar_sessions
  = sanitized Working projection
```

Do not repurpose `calendar_sessions` as Published data.

Canonical release family:

```text
timetable_publications/{academicYearKey}
  activeReleaseId

timetable_publications/{academicYearKey}/releases/{releaseId}
  release metadata

timetable_publications/{academicYearKey}/releases/{releaseId}/sessions/{sessionId}
  immutable Faculty-facing snapshots
```

A release covers the complete timetable for one Academic Year in this phase.

### 11.7 Release lifecycle

Candidate lifecycle:

```text
building -> validated -> sealed
```

Only a sealed release may become active.

Faculty-visible publication is one atomic `activeReleaseId` pointer switch.

If no release exists, Faculty see "Timetable has not yet been published."

Failure leaves the prior active release unchanged.

### 11.8 Release immutability, republish, and concurrency

A sealed release is immutable.

Working edits never mutate a sealed release.

Republish creates a new release.

Restore/rollback creates a new forward release copied from a prior sealed snapshot; do not normally move the pointer backward.

Concurrent publishers must transactionally compare the candidate's expected prior `activeReleaseId`; a loser must rebuild rather than blindly retry activation.

### 11.9 Publication authority

Initial Publish authority is limited to:
- Developer
- Owner / ADFAD General-equivalent high-trust authority

ADFAD Regular, ADC/DVM, LAB, HICC, VISC and ordinary Faculty cannot publish.

Final-assignment capability and Publish capability remain separate.

### 11.10 Faculty-facing visibility

Ordinary Faculty:
- cannot read Working `sessions`;
- cannot read Working `calendar_sessions`;
- can read only the complete active Published release;
- see no inactive release history in the first implementation.

Main Timetable may display the complete active release.

`My Teaching` filters that same release.

Faculty Dashboard self-mode and other Faculty self-service surfaces use Published data only.

HICC/VISC normal Faculty view also uses Published data. Their Teaching Assignment tools use separate authorized Working queries:
- HICC -> own assigned scope/package;
- VISC -> all packages/sessions in groups they lead.

### 11.11 Published snapshot privacy

Release session documents use an explicit allowlist.

Never publish:
- contributor notes
- VISC review comments
- suggestions
- roster/student data
- exact DOE/target/variance/formula
- HR/AFC private details
- private Faculty identifiers
- internal review/audit bodies

Missing/corrupt publication state fails closed and never falls back to Working data.

## 12. Candidate availability and workload

Contributor roles may see only safe candidate information:

Availability:

- Available
- Limited
- Unavailable
- Unknown

Coarse workload:

- Available Capacity
- Near Load
- At Load
- Overload
- Needs Review

Do not expose:

- unavailable reason
- AFC reason/dates beyond an already-approved sanitized availability window
- medical/private information
- exact DOE
- exact target
- exact variance
- DOE formula
- salary/HR data

Reuse or extend the existing sanitized Faculty swap/availability index where safe.

No client-side hiding of private values is acceptable; the private values must not be delivered to unauthorized clients.

## 13. DOE boundaries

### 13.1 General rule

Teaching Assignment workflow does not calculate DOE itself.

Authoritative DOE remains:

- server-side
- controlled by the active Annual DOE Rule Book
- backed by the existing policy engine and mappings
- fail-closed on missing or ambiguous rule/mapping inputs

Suggestions and notes never create authoritative DOE.

Final assignment is the event that may feed Teaching DOE recalculation.

### 13.2 Subject and DOE

Adding `subjectKey` to a Teaching Assignment session does not, by itself:

- change Teaching DOE
- trigger authoritative Teaching DOE recalculation
- imply a fixed DOE value

Subject affects DOE only if an active Annual Rule Book rule explicitly declares Subject mapping as an input/requirement, or when Subject is part of a separate role assignment such as VISC.

### 13.3 Teaching DOE versus role DOE

Teaching session DOE and academic-role DOE are separate evidence lines.

Example:

```text
Session assignment
  -> LAB/LEC/SRL teaching rule
  -> Teaching DOE line

HICC/VISC role assignment
  -> course/subject mapping
  -> role rule
  -> Role DOE line
```

They are aggregated later in the Faculty worksheet; they are not the same calculation.

### 13.4 HICC/VISC DOE varies by assignment scope

Do not simplify HICC or VISC DOE to a fixed value per role name.

Each role assignment is independently calculated from at least:

- Faculty
- role type
- course
- Subject when applicable
- Academic Year
- active Annual DOE Rule Book
- approved course/Subject mapping

Therefore:

```text
HICC -> VTMD 505  may produce DOE result A
HICC -> VTMD 506  may produce DOE result B
VISC -> VTMD 521 / Surgery may produce DOE result C
VISC -> another course/Subject may produce DOE result D
```

A, B, C and D are not required to match.

The same role/course may also differ between academic years when the Annual Rule Book changes.

Missing or ambiguous course/Subject mappings must return Needs Review/fail closed. Never copy the previous course's DOE and never invent a default.

### 13.5 Publication and DOE

Timetable publication is a presentation/release action, not a DOE calculation event.

The following never trigger authoritative DOE by themselves:

- contribution suggestion save
- Teaching Assignment note save
- Subject-only change when the active Rule Book does not declare Subject relevant
- release build
- release validation
- release seal
- active release pointer switch
- republish/restore release

The existing authoritative final-assignment path remains the only Teaching Assignment event that may request DOE recalculation when Rule Book-relevant facts changed.

## 14. Work Queue behavior

The normal Teaching Assignment Work Queue follows responsibility, not the old ADC/DVM -> LAB -> ADFAD serial office gate.

Desired queues:

- **ADC/DVM:** incomplete base scheduling skeleton.
- **LAB:** LAB-specific operational work; independent from HICC/VISC review.
- **HICC:** own package draft work, VISC push-backs, and VISC-approved packages awaiting HICC Final Submit.
- **VISC:** packages submitted for review from every HICC in groups the VISC leads.
- **ADFAD:** only packages that have VISC approval and were Final Submitted by HICC.

Optional suggestions/notes do not create permanent blocking queue items.

LAB roster outstanding may remain after HICC/VISC review or ADFAD final assignment.

A content-ready HICC package does not enter ADFAD queue automatically.

Explicit Change Request queue remains separate and keeps existing routed approval semantics.

## 15. Security invariants

The implementation must prove:

1. HICC role alone grants no course/Subject authority.
2. HICC exact Course/Subject scope is enforced.
3. HICC can act only on sessions/packages where `responsibleHiccUid == request.auth.uid`.
4. HICC cannot change `teachingAssignmentGroupId` or `responsibleHiccUid`.
5. VISC role alone grants no global review authority.
6. VISC can read/review all HICC packages in groups they lead.
7. VISC cannot read/review packages from groups they do not lead.
8. VISC review authority does not grant Topic/suggestion/final-assignment edit authority.
9. VISC cannot Final Submit to ADFAD.
10. HICC cannot Final Submit unless current fingerprint equals the latest VISC-approved fingerprint.
11. A review-relevant edit after VISC approval invalidates Final Submit until re-review.
12. ADFAD normal queue contains only HICC Final Submitted packages.
13. Normal Teaching Assignment package review creates no `change_request*` documents.
14. Explicit Change Request routed approval order remains enforced separately.
15. Suggestions cannot contain private Faculty/DOE/AFC/HR fields.
16. Suggestions never silently become authoritative assignments.
17. Internal notes/review comments are denied to ordinary Faculty and Student-facing users.
18. Notes/review comments never enter Working calendar or Published projections.
19. Roster read is temporarily allowed to every active, password-complete PAWS user.
20. Roster write remains restricted.
21. Missing referenced LAB group fails closed.
22. LAB roster completion does not block HICC/VISC review or ADFAD assignment.
23. HICC submit, VISC approve/push-back, and HICC Final Submit do not trigger authoritative DOE.
24. Authoritative ADFAD assignment remains the Teaching Assignment event that may trigger DOE when Rule Book-relevant facts changed.
25. Ordinary Faculty are denied direct Working `sessions` and `calendar_sessions` reads.
26. Faculty-visible timetable data comes only from the active sealed release.
27. Inactive/building/unsealed/failed releases are not Faculty-readable.
28. Release snapshots use a strict public-field allowlist.
29. Sealed releases are immutable.
30. Working writes never mutate sealed releases.
31. Missing/corrupt publication state never falls back to Working.
32. Publish authority is narrower than final-assignment authority.
33. ADFAD Approve & Submit never changes `activeReleaseId`.
34. Publish never changes final assignments and never triggers DOE.
35. Concurrent publish attempts cannot create mixed-version Faculty views.
36. Published-origin Change Requests retain base provenance and fail closed on stale Working state.
37. `other_office` grants no target runtime authority after the T6 removal gate.
38. Anonymous/inactive/password-change-required users are denied protected reads.
39. Firestore rules, not UI hiding, enforce access boundaries.
40. Technical keys `adfa*` and `adc` may remain internally, but user-facing labels must render ADFAD and ADC/DVM.

## 16. Existing modules to preserve or extend

Prefer extension over rewrite.

Preserve or reuse:

- `faculty-assignment.js` multi-Faculty model
- `lab-groups.js` group/roster parsing and sanitization patterns
- `faculty-suggestions.js` privacy-safe suggestion guards
- `data-index.js` sanitized candidate identity/availability patterns
- `scheduling-core.js`
- `calendar-session.js` projection boundary
- existing DOE policy engine/server services
- existing Change Request approval lifecycle/routing/state/finalizer

The implementation may change normal Teaching Assignment readiness consumers, Work Queue behavior, scoped capabilities, contribution persistence, and Firestore rules as required by this design.

## 17. Testing strategy

Implementation follows TDD.

At minimum cover:
- ADC/DVM skeleton readiness
- HICC content readiness
- HICC Submit for VISC Review
- VISC group-wide visibility
- VISC cross-group denial
- VISC Approve
- VISC Push Back
- HICC revision/resubmit
- VISC approval fingerprint
- post-approval edit invalidates Final Submit
- HICC Final Submit to ADFAD
- VISC cannot Final Submit
- ADFAD queue gating
- LAB roster not blocking package review/ADFAD
- exact HICC Course/Subject scope
- Teaching Assignment group ownership
- VISC review-only capability
- actor-scoped suggestions/notes
- multi-Faculty ADFAD final assignment
- DOE non-trigger from HICC/VISC review actions
- DOE remains authoritative only through existing trusted assignment path
- explicit Change Request approval regression
- Faculty Working-read denial
- active-release-only Faculty reads
- sealed release immutability
- Publish concurrency
- Working edits after publish remain invisible until republish
- Faculty Timetable/My Teaching/Dashboard Published-only sourcing
- `other_office` removal regression
- ADFAD / ADC/DVM-DVM user-facing terminology regression
- Firestore rules-budget regression
- browser smoke regression

## 18. Implementation sequence

1. T1 — isolated worktree, latest main merge, clean baseline gate **(completed)**
2. T2 — canonical HICC Course/Subject scope helper
3. T3 — canonical Subject catalog and `subjectKey` Working projection
4. T4 — HICC package readiness + VISC review state/revision model
5. T5 — ADC/DVM/LAB/HICC actor-scoped contributions and safe package fingerprinting
6. T6 — Teaching Assignment groups, VISC leader/HICC membership, User Management, role capabilities, terminology update, `other_office` retirement
7. T7 — Firestore security for HICC ownership, VISC group review, submissions, contributions/notes/roster, and publication boundary
8. T8 — Work Queue/UI for HICC submit -> VISC approve/push-back -> HICC Final Submit -> ADFAD queue, plus Published-only Faculty views
9. T9 — ADFAD final assignment/Approve & Submit, explicit timetable Publish, and Published-base Change Request stale protection
10. T10 — safe candidate availability/coarse workload
11. T11 — DOE regression guards, including no DOE from HICC/VISC review or Publish
12. T12 — schema/docs/fixtures, terminology/security/review-flow regression, emulator/static/server/browser verification

T4-T9 are P3.1-critical. Do not execute them from the pre-P3.1 plan text.

## 19. Out of scope

This design does not:

- redesign DOE formulas
- hardcode new DOE percentages
- publish DOE policy
- seed live production data
- deploy production Firebase
- modify Azure
- merge PR #67
- reconstruct the company-computer local PR #67 worktree
- design the future Student-facing roster privacy model
- expose inactive/previous timetable releases to ordinary Faculty
- support partial course/term publication in the first version; the initial release unit is one complete Academic Year
- implement pointer-backward rollback; restoration is a new forward release
- redesign `calendar_sessions` into the Published store
- create a generic replacement for the deprecated `other_office` role
- migrate internal technical identifiers `adfa`, `adfa_general`, `adfa_regular`, or `adc` solely for the terminology update
- make VISC a direct HICC content editor
- let VISC Final Submit a HICC package to ADFAD
- make LAB roster completion a HICC/VISC/ADFAD gate
- merge the existing `faculty_groups` swap/member model into the new Teaching Assignment group model
