# PAWS Scoped Parallel Teaching Assignment Workflow — Design Spec

Date: 2026-09-22  
Status: Approved design baseline — P3 architecture lock (parallel workflow + versioned timetable publication)  
Repository: `Alex1122341/Teaching-assignment`  
Implementation branch: `feature/scoped-parallel-assignment-workflow`

## 1. Purpose

Replace the current serial Teaching Assignment preparation model with a scoped, parallel contribution model while preserving the existing explicit Change Request approval lifecycle.

Add a separate Working-versus-Published timetable boundary so internal Teaching Assignment changes can continue without exposing unfinished work to ordinary Faculty. The existing `sessions` + `calendar_sessions` pair remains the internal Working layer; Faculty consume only the active, versioned Published release.

This design does not weaken the routed Change Request approval flow, does not redesign DOE formulas, and does not treat ADFA session finalization as timetable publication.

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

In particular, a referenced LAB group that does not exist must fail closed, while LAB group/roster completion remains independent from ADFA readiness.

## 3. Separate the two workflows

### 3.1 Normal Teaching Assignment preparation

The target flow is:

```text
ADC creates session skeleton
        |
        v
course/date/start/end/type available
        |
        +----------------+----------------+----------------+
        |                |                |                |
       ADC              LAB             HICC             VISC
  contributions    contributions    contributions    contributions
        |                |                |                |
        +----------------+----------------+----------------+
                         |
                 required Topic complete
                         |
                         v
                     ADFA READY
                         |
                         v
               final Faculty assignment
                         |
                         v
                  Approve & Submit
```

ADC, LAB, HICC and VISC are contributors, not approval stages.

### 3.2 Explicit Change Request approval

The existing routed Change Request flow remains separate and serial:

```text
Change Request
  -> ADC approval when required
  -> LAB approval when required
  -> ADFA approval when required
  -> Apply
```

Existing approval lifecycle, routing, order enforcement, push-back, reject, resubmit, and finalizer behavior must remain intact unless a separate approved design explicitly changes them.

A Change Request created from a Published release must retain publication provenance such as `baseReleaseId` plus the existing/public base-session evidence. Final apply must revalidate the current Working session and fail closed when the reviewed base is stale. Publication provenance strengthens stale-write protection; it does not change the ADC/LAB/ADFA approval order.

### 3.3 Working versus Published timetable boundary

Normal Teaching Assignment preparation and timetable publication are separate lifecycles:

```text
INTERNAL WORKING LAYER
sessions
  -> calendar_sessions (sanitized Working projection)
  -> ADC / LAB / scoped HICC / scoped VISC / ADFA / Developer-Owner
  -> ADFA Approve & Submit
  -> finalized Working assignment

EXPLICIT PUBLICATION
  -> build complete Academic-Year release candidate
  -> validate
  -> seal
  -> atomically switch activeReleaseId

FACULTY-FACING PUBLISHED LAYER
  -> active sealed release only
```

`ADFA Approve & Submit` is session-level final assignment authority. It must not publish the timetable.

`Publish Timetable` is timetable-level release authority. It must not create or change final assignments and must not trigger DOE.

Working edits after a release is active do not change what Faculty see until a later explicit Publish.

## 4. Session skeleton and readiness

### 4.1 ADC skeleton

ADC owns the base session skeleton:

- course
- date
- start
- end
- session type

Year/semester/week may remain derived or stored according to the existing canonical session model, but they are not additional ADFA readiness gates unless required by an existing canonical invariant.

Room is not an ADFA readiness gate.

### 4.2 Topic

For LEC and SRL:

- ADC may create or edit Topic.
- Scoped HICC may create or edit Topic within their authorized scope.
- Scoped VISC may create or edit Topic within their authorized scope.

For LAB:

- LAB may create or edit Topic.
- Scoped HICC/VISC may create or edit Topic within their authorized scope.
- ADC is not the primary LAB Topic editor.

Topic edits use the existing audit model and do not create a separate Topic approval step.

### 4.3 ADFA readiness

ADFA is ready when all of these are complete:

- course
- valid date
- start
- end
- session type
- valid Topic

The following do not block ADFA readiness:

- Faculty suggestions
- contributor notes
- LAB group completion
- LAB roster completion
- ADC approval
- LAB approval
- HICC approval
- VISC approval

Derived UI states should distinguish:

- session skeleton incomplete
- Topic incomplete
- ready for ADFA assignment
- final assignment present

Do not create a second persistent approval state machine for normal Teaching Assignment preparation.

## 5. Parallel contributions

ADC, LAB, HICC and VISC may contribute independently after the base session exists.

A contributor may:

- suggest one or more Faculty
- maintain their own Teaching Assignment note
- perform the fields permitted by their operational or scoped role

One contributor's work must not overwrite another contributor's suggestions or note.

## 6. Academic responsibility and scope

### 6.1 Base identity versus scoped responsibilities

Base identity, operational office access, and academic responsibilities are separate concepts.

Effective authority is derived from:

`user + responsibility + resource scope`

Do not grant global academic powers merely because `role == 'hicc'` or `role == 'visc'`.

### 6.2 Course and optional Subject scope

Academic scope supports two levels:

1. Course-wide scope
2. Course + Subject scope

Examples:

```text
HICC -> VTMD 505                  // whole course
HICC -> VTMD 506 / Surgery       // subject-limited
HICC -> VTMD 506 / Anesthesia    // subject-limited
VISC -> VTMD 521 / Imaging
```

Authorization rules:

- A course-wide scope authorizes all sessions in that course.
- If no course-wide scope exists, a course + Subject scope authorizes only sessions whose course and Subject both match.
- Course matching is exact.
- Subject matching is exact by stable key.
- Never use substring matching on course, Subject, group name, tag, or Topic text for authorization.

### 6.3 Canonical Subject model

Subject is separate from Topic.

Example:

```text
course:     "VTMD 505"
subjectKey: "surgery"
topic:      "Pre-operative Management"
```

Subject must come from an administrator-maintained canonical Subject catalog.

Use a stable `subjectKey` plus a display label. HICC/VISC do not create arbitrary free-text Subjects as authorization keys.

Topic remains free instructional content and must never be used as the authorization key.

### 6.4 Authorization storage

The canonical implementation uses a bounded profile-local token list so Firestore rules can evaluate exact scope membership through the already-required user profile read.

Canonical shape:

```text
academicScopeTokens:
  hicc|VTMD 505|*
  hicc|VTMD 506|surgery
  visc|VTMD 521|imaging
  rotation_coordinator|VTMD 590|*
```

Rules:

- token grammar is exactly `responsibility|COURSE|subjectKey`
- `*` means course-wide authority
- responsibility, course and Subject components are bounded
- components may not contain `|`
- matching is exact after canonical normalization
- legacy profiles without tokens remain valid but gain no scoped authority
- do not create a derived `user_scopes/{uid}` authorization cache
- `faculty_groups` remains group/member administration, not the sole authorization source

### 6.5 Deprecated `other_office` role

`other_office` is not part of the target PAWS role model.

It receives no new parallel-workflow, Working-timetable, contribution, publication, or final-assignment capability.

During Task 6 implementation, perform a read-only dependency check using existing safe tooling. If an active account still depends on `other_office`, stop and report the migration requirement before removing runtime acceptance. If no active account depends on it, remove `other_office` from active role enums, capability maps, provisioning choices, Firestore authorization, demo fixtures, and runtime tests.

Historical audit/doc text may still contain the string. Future offices must receive explicit capabilities/scopes tied to real business requirements; do not introduce another generic placeholder role.

## 7. Faculty suggestions

## 7. Faculty suggestions

Suggestions are advisory only.

Requirements:

- ADC, LAB, HICC and VISC may suggest Faculty.
- Multiple Faculty may be suggested.
- Multiple contributor sources may coexist.
- Suggestion provenance must be retained.
- Suggestions must not overwrite another contributor's suggestions.
- Suggestions must never automatically become final assignments.
- Accepting suggestions in the ADFA UI only populates an editable final selection.
- Authoritative assignment occurs only on explicit ADFA Approve & Submit.

Reuse the existing privacy-safe candidate model:

- opaque `candidateKey`
- display name
- source/provenance
- no UCID
- no raw Faculty ID when avoidable
- no email
- no exact DOE
- no AFC reason
- no HR/private fields

Keep the current fail-closed principle that a suggestion is not an assignment.

## 8. Contribution storage

Use a contribution-oriented persistence model so suggestions and notes share the same actor/source boundary and do not race in one shared document.

Preferred collection:

`session_assignment_contributions`

Preferred document identity:

`{sessionId}__{sourceRole}__{actorUid}`

Conceptual document:

```js
{
  sessionId,
  course,
  subjectKey,
  sourceRole,          // adc | lab | hicc | visc | future scoped role
  actorUid,
  actorDisplayName,
  suggestions: [
    { candidateKey, displayName }
  ],
  note,
  updatedAt
}
```

Each contributor owns their own document. ADFA reads all applicable contribution documents for a session.

Do not place Teaching Assignment notes in `sessions` or `calendar_sessions`.

## 9. Teaching Assignment notes

Notes are more restricted than roster data.

Readable by:

- ADFA
- Teaching Assignment offices such as ADC and LAB
- HICC
- VISC
- future explicitly approved scoped Teaching Assignment roles
- Developer/Owner/administrative roles according to existing high-trust policy

Not readable by:

- ordinary Faculty without a Teaching Assignment responsibility
- Student

The deprecated `other_office` role receives no target runtime access.

A Teaching Assignment role may see the Teaching Assignment notes needed for that workflow. Scoped academic roles still remain course/Subject-scoped for any write or workflow action.

Notes must not leak into:

- public calendar projection
- ordinary Faculty self-view
- Student-facing projection
- broad public audit text

Audit may record that a note changed without copying note content if an audit record is required.

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

LAB group or roster incompleteness never blocks ADFA Faculty-assignment readiness.

LAB outstanding work remains independently visible to LAB.

## 11. ADFA final assignment

ADFA is the final Faculty assignment authority for normal Teaching Assignment preparation.

ADFA sees:

- session fields
- Topic
- safe LAB group/roster information
- all contributor suggestions with provenance
- all Teaching Assignment notes
- safe candidate availability/workload summaries

ADFA may:

- accept any subset of suggestions into an editable final selection
- remove accepted suggestions before save
- manually add different Faculty
- assign multiple Faculty to one session

Reuse the existing multi-Faculty assignment model. Do not duplicate sessions per Faculty.

### 11.1 Approve & Submit

Accepting a suggestion is not an authoritative write.

The desired UI flow is:

```text
review suggestions
 -> build/edit final Faculty selection
 -> Approve & Submit
 -> authoritative session assignment write
 -> sanitized calendar projection
 -> audit
 -> DOE recalculation request when relevant
```

Do not create a redundant `adfaSubmittedAt` state solely to represent the same fact if the authoritative assignment write already provides the canonical evidence.

Approve & Submit changes the authoritative Working session only. It must not create a timetable release and must not change an active release pointer.

### 11.2 Versioned timetable publication

Keep the current source/mirror split as the internal Working layer:

```text
sessions
  = authoritative Working session source

calendar_sessions
  = sanitized Working projection
```

Do not repurpose `calendar_sessions` as Published data. Existing paired-write, bulk-import, repair, timetable-editing and DOE persistence paths depend on its Working-layer semantics.

Use a separate versioned release family. The implementation plan may refine field names, but the contract is:

```text
timetable_publications/{academicYearKey}
  activeReleaseId

timetable_publications/{academicYearKey}/releases/{releaseId}
  release metadata

timetable_publications/{academicYearKey}/releases/{releaseId}/sessions/{sessionId}
  immutable Faculty-facing session snapshots
```

A release covers the complete timetable for one Academic Year in this phase.

### 11.3 Release lifecycle

A candidate release progresses conceptually through:

```text
building -> validated -> sealed
```

Only a sealed release may become active.

Building and validation occur while the prior release remains active. The Faculty-visible publication event is one atomic pointer transaction that changes `activeReleaseId`.

If first publication has no active release yet, Faculty see a controlled "Timetable has not yet been published" state.

If build, validation, seal, or activation fails, the prior active release remains unchanged.

### 11.4 Release immutability and republish

A sealed release is immutable.

Working changes after publication never mutate a sealed release.

Republish creates a new release version, validates and seals it, then atomically switches the pointer.

Rollback, when needed, is represented as a new release copied from a prior sealed snapshot and published forward. Do not move the pointer backward to an old release as the normal rollback mechanism.

### 11.5 Publication concurrency

Each candidate records the active release it was based on and a deterministic fingerprint of the Working source snapshot used to build it.

Before activation:

- recompute/validate the Working source fingerprint
- verify the candidate is complete and sealed
- transactionally verify the active pointer still equals the candidate's expected prior value

If another publisher wins first, the losing candidate is not activated and must be rebuilt from current Working state.

### 11.6 Publication authority

Initial Publish authority is limited to:

- Developer
- Owner / ADFA General-equivalent high-trust authority

ADFA Regular, ADC, LAB, HICC, VISC and ordinary Faculty cannot publish.

Final-assignment capability and publication capability are separate.

### 11.7 Faculty-facing visibility

Ordinary Faculty:

- cannot read `sessions`
- cannot read `calendar_sessions`
- can read the complete active Published timetable for the selected Academic Year
- see only the active release, not inactive release history

The main Timetable may display the whole active Published timetable.

`My Teaching` is a convenience filter over that same active release. It is not the authorization boundary.

Faculty Dashboard self-mode and other Faculty self-service surfaces must also use Published data only. No Faculty-facing path may silently fall back to Working collections.

HICC/VISC have two distinct surfaces:

- normal Faculty timetable view -> active Published release
- scoped Teaching Assignment work tools -> exact-scope Working queries only

ADC/LAB/ADFA/Developer-Owner continue to use the Working layer for authorized internal work.

### 11.8 Published snapshot privacy

Release session documents use an explicit allowlist. Never spread/copy a Working session object wholesale.

Published snapshots may contain approved scheduling display fields such as course, Subject, date, time, type, Topic, room, instructor display names and non-private LAB group identifiers.

Published snapshots must not contain:

- contributor notes
- suggestions
- roster/student data
- exact DOE, target, variance or formula data
- HR/AFC private details
- private Faculty identifiers
- internal approval/audit payloads

A missing or corrupt active pointer, missing release metadata, or incomplete/unsealed release fails closed. Faculty clients must never guess the newest release or fall back to Working data.

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

The Work Queue must stop representing normal Teaching Assignment preparation as a serial ADC -> LAB -> ADFA chain.

Desired behavior:

- ADC sees incomplete skeleton work.
- LAB sees LAB-specific outstanding work.
- HICC/VISC receive scoped Topic work when required Topic is missing in their authorized course/Subject scope.
- Optional Faculty suggestions do not create blocking work.
- Optional notes do not create blocking work.
- ADFA receives the session when skeleton + Topic are complete.
- LAB roster outstanding may remain visible to LAB even after ADFA becomes ready or final assignment is saved.

HICC/VISC may still open their authorized session after required Topic work is complete to update their own suggestion or note, but optional work should not leave a permanent blocking/red Work Queue item.

## 15. Security invariants

The implementation must prove these with code-level and Firestore emulator tests:

1. `role == 'hicc'` alone does not grant all-course authority.
2. `role == 'visc'` alone does not grant all-course authority.
3. Course and Subject authorization are exact-match.
4. Cross-course HICC/VISC Working reads and Topic writes are denied.
5. Cross-Subject HICC/VISC Working reads and Topic writes are denied when Subject scope is present.
6. Scoped contributors cannot change `course` or `subjectKey` to expand authority.
7. Topic text never establishes authorization.
8. Suggestions cannot contain private Faculty/DOE/AFC/HR fields.
9. Suggestions cannot silently become assignments.
10. Notes are denied to ordinary Faculty and Student-facing users.
11. Notes never enter Working calendar or Published projections.
12. Roster read is temporarily allowed to every active, password-complete PAWS user.
13. Roster write remains role-restricted.
14. Missing referenced LAB group fails closed for integrity.
15. LAB roster completion does not block ADFA readiness.
16. Existing explicit routed approval order remains enforced.
17. Normal Teaching Assignment preparation creates no Change Request approval records.
18. DOE suggestion/preview data never becomes authoritative DOE without the trusted final-assignment/DOE path.
19. Ordinary Faculty are denied direct reads of Working `sessions`.
20. Ordinary Faculty are denied direct reads of Working `calendar_sessions`.
21. Faculty-visible timetable data comes only from the active sealed release.
22. Inactive/building/validated-but-unsealed/failed release sessions are not Faculty-readable.
23. Release session documents use a strict public-field allowlist.
24. Sealed release metadata and session snapshots are immutable.
25. The active release cannot be deleted or modified in place.
26. Working writes never mutate an existing sealed release.
27. Missing/corrupt publication state never falls back to Working data.
28. Publication authority is narrower than final-assignment authority.
29. Approve & Submit never changes `activeReleaseId`.
30. Publish never changes final assignments and never triggers DOE.
31. Concurrent publish attempts cannot create mixed-version Faculty views.
32. Change Requests preserve Published-base provenance and final apply fails closed on stale Working state.
33. `other_office` grants no target runtime authority after the approved T6 removal gate.
34. Inactive, anonymous, and password-change-required accounts are denied Working, Published and roster reads.
35. Firestore rules, not UI hiding, enforce the boundary.

## 16. Existing modules to preserve or extend

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

Implementation must follow TDD.

At minimum cover:

- parallel readiness
- LAB roster not blocking ADFA
- room not blocking ADFA
- Topic required
- ADC LEC/SRL Topic edit
- LAB LAB-Topic edit
- scoped HICC/VISC Topic edit
- course-wide scope
- course + Subject scope
- exact-match cross-scope denial
- one user with multiple responsibilities
- four-source Faculty suggestions
- suggestion provenance
- multi-Faculty final assignment
- notes visibility matrix
- temporary roster read visibility for all active authenticated PAWS users
- roster write restrictions
- candidate privacy
- DOE non-trigger from suggestion/note/Subject-only changes
- HICC/VISC DOE independent per course/Subject/year
- explicit approval regression
- Firestore rules expression-budget regression
- browser smoke regression
- direct Faculty denial for Working `sessions` and `calendar_sessions`
- exact-scope HICC/VISC Working queries
- active-release-only Faculty reads
- inactive release ID guessing denial
- strict Published-session allowlist
- no-release and corrupt-pointer fail-closed behavior
- sealed release immutability
- atomic pointer activation and concurrent publisher conflict
- Working edits after publish remain invisible until republish
- Approve & Submit does not publish
- Publish does not assign or trigger DOE
- Faculty Timetable and Faculty Dashboard self-mode use Published data only
- Change Request `baseReleaseId`/base-session stale protection
- deprecated `other_office` runtime removal regression

## 18. Implementation sequence

The approved implementation sequence is:

1. T1 — isolated worktree, merge latest main, clean baseline gate
2. T2 — exact academic Course/Subject scope helper
3. T3 — canonical Subject catalog and `subjectKey` Working projection
4. T4 — parallel field-based preparation readiness
5. T5 — four-source suggestions and actor-scoped contributions
6. T6 — scoped capabilities, User Management scope assignment, Topic policy, publication capability, and `other_office` retirement
7. T7 — Firestore authorization for scoped Working data, contributions/notes/roster, and the versioned publication boundary
8. T8 — Work Queue plus role-correct Working/Published UI and scoped HICC/VISC Working queries
9. T9 — ADFA suggestion review/Approve & Submit plus explicit versioned Publish Timetable and Change Request publication provenance
10. T10 — safe availability and coarse workload projection
11. T11 — DOE regression guards including no-DOE-on-publish
12. T12 — schema/docs/fixtures, explicit approval regression, publication security regression, static/server/emulator/browser verification

T7, T8 and T9 are the publication-critical implementation tasks. Do not start them from the pre-P3 plan text.

## 19. Out of scope

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
