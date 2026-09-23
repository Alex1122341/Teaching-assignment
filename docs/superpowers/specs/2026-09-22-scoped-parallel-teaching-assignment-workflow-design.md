# PAWS Scoped Parallel Teaching Assignment Workflow — Design Spec

Date: 2026-09-22  
Status: Approved design baseline  
Repository: `Alex1122341/Teaching-assignment`  
Implementation branch: `feature/scoped-parallel-assignment-workflow`

## 1. Purpose

Replace the current serial Teaching Assignment preparation model with a scoped, parallel contribution model while preserving the existing explicit Change Request approval lifecycle.

This design applies only to the normal Teaching Assignment preparation flow. It does not replace or weaken the routed Change Request approval flow.

## 2. Repository and branch baseline

The implementation branch is created from:

`fix/workflow-functional-completion`

That remote branch contains the current PR #67 Work Queue, LAB roster, and approval wiring that must be preserved.

Before product-code implementation begins on the home computer, the implementation worktree must merge the latest `origin/main` into this feature branch and run baseline tests.

The unfinished local PR #67 worktree on the company computer is not available on the home computer and must not be reconstructed or assumed to exist.

Useful company-computer work may be reconciled later. Old serial-readiness D2 logic must not be imported blindly because this design supersedes it.

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

Prefer authoritative academic scopes on the user's existing authorization profile so Firestore rules can evaluate them through the already-required profile read without depending on a stale derived authorization cache.

A compatible shape is:

```js
academicScopes: {
  hicc: [
    { course: "VTMD 505" },
    { course: "VTMD 506", subjectKey: "surgery" }
  ],
  visc: [
    { course: "VTMD 521", subjectKey: "imaging" }
  ],
  rotation_coordinator: [
    { course: "VTMD 590" }
  ]
}
```

Exact storage may reuse an existing canonical structure if repository inspection finds a safer equivalent, but the authorization contract above must remain unchanged.

`faculty_groups` may continue to support group/member administration; it should not become the only authorization source if that requires fuzzy matching or stale derived access state.

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
- Other Office
- Student

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
4. Cross-course HICC/VISC Topic writes are denied.
5. Cross-Subject HICC/VISC Topic writes are denied when Subject scope is present.
6. Suggestions cannot contain private Faculty/DOE/AFC/HR fields.
7. Suggestions cannot silently become assignments.
8. Notes are denied to ordinary Faculty, Other Office and Student.
9. Notes never enter calendar/public projections.
10. Roster read is currently allowed to every active authenticated PAWS user.
11. Roster write remains role-restricted.
12. LAB roster completion does not block ADFA readiness.
13. Existing explicit routed approval order remains enforced.
14. Normal Teaching Assignment preparation creates no Change Request approval records.
15. DOE suggestion/preview data never becomes authoritative DOE without the trusted final-assignment/DOE path.

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

## 18. Implementation sequence

The detailed implementation plan must be written separately after this design is approved.

The plan should broadly sequence work as:

1. merge latest main into the new feature worktree and establish clean baseline
2. pure logic scope/readiness/contribution tests
3. scoped responsibility model
4. parallel readiness and Work Queue
5. contribution persistence and notes/suggestions
6. Firestore rules and emulator tests
7. LAB temporary roster-read rule
8. ADFA UI integration
9. candidate safe projection
10. DOE regression protections
11. explicit approval regression
12. full static/server/emulator/browser verification

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
