# Workstream 5B Design — ADC/LAB Roles, Approval Routing, Privacy, Push Back & Withdraw

**Date:** 2026-09-17  
**Repository:** `Alex1122341/Teaching-assignment`  
**Status:** Design approved in chat; implementation not started

## 1. Purpose

Workstream 5B introduces formal `adc` and `lab` roles, routes timetable-change approvals by responsibility, preserves ADFA as the authority for all Faculty/instructor assignment, adds push-back/resubmission/withdraw behavior, adds workflow notifications, and introduces a sanitized calendar data layer so ADC/LAB can work with timetable data without receiving confidential Faculty identifiers or DOE/AFC details.

This design assumes Workstream 5A provides the canonical scheduling/time/conflict engine. WS5B must consume that shared API rather than inventing another overlap implementation.

## 2. New Formal Roles

Add two formal roles:

```text
adc
lab
```

Existing ADFA roles remain in place. The new roles must **not** simply be added to the generic admin helper because that would grant unrelated Faculty Dashboard and administrative capabilities.

Role labels:

```text
adc -> ADC
lab -> LAB
```

User Management must support selecting `ADC` and `LAB` as primary roles.

### 2.1 Existing Authentication accounts

The following Firebase Authentication users already exist and must be linked through Firestore `users/{uid}` profiles rather than recreated:

```text
lab@ucalgary.ca
UID: lsxm9IKWQpYgJb89VdnjypRdVHo1
role: lab

dvm@ucalgary.ca
UID: CEEEPBkcjDbuTDKhsKqGngQlHIr1
role: adc
```

The initial Firestore profiles should be active and should require a password change on first normal dashboard sign-in:

```text
active: true
mustChangePassword: true
```

No temporary password is to be committed to source control or embedded in client code.

## 3. Capability-Based Authorization

Do not model ADC/LAB as broad admins. Introduce explicit capability decisions in shared frontend helpers and matching Firestore rules.

Conceptual capabilities include:

```text
canViewCalendar
canAddSessions
canAddOneSession
canSelectSessions
canEditCourseFields
canEditInstructor
canEditLabTopic
canReviewAdcScope
canReviewLabScope
canReviewAdfaScope
canViewFullApprovalOverview
```

### 3.1 Tool access

During this testing phase, existing ADFA permissions remain available.

| Tool / capability | ADFA Admin | ADC | LAB |
|---|---:|---:|---:|
| View Calendar | Yes | Yes | Yes |
| + Add Sessions | Yes | Yes | No |
| + Add One | Yes | Yes | No |
| Select Sessions | Yes | Yes | Yes |
| Edit course/date/time/type/room | Yes, retained for testing | Yes | No |
| Edit ordinary non-LAB topic | Yes, retained for testing | Yes | No |
| Edit LAB topic | Yes, retained for testing | No | Yes |
| Edit/assign instructor | Yes | No | No |

Future ADC/LAB dashboards are out of scope for this workstream. For now both roles land on/use the timetable and their role-specific approval tools.

## 4. Grey-Out Behavior

Fields outside the signed-in office's responsibility remain visible as context but are disabled/greyed out.

### 4.1 ADC

ADC may edit:

- course / course number;
- date;
- start/end time;
- type;
- room;
- ordinary topic on non-LAB sessions.

ADC must see but cannot edit:

- instructor / Faculty assignment;
- LAB topic.

### 4.2 LAB

LAB may edit only the LAB topic on an existing LAB session.

LAB sees but cannot edit:

- course / course number;
- date;
- start/end time;
- room;
- type;
- instructor / Faculty assignment.

`Select Sessions` remains available to LAB, but the multi-session review editor must restrict editable fields to LAB topic and restrict selection/edit application to relevant LAB sessions.

### 4.3 ADFA

ADFA retains the existing broad edit tools during this testing period. In particular, Instructor/Faculty assignment remains ADFA-owned for all session types.

A later workstream may choose to narrow ADFA direct course-field editing, but WS5B does not remove it.

## 5. New Session Creation

ADC owns new-session scheduling creation.

### 5.1 Ordinary session

ADC may set:

- course;
- date;
- time;
- type;
- room;
- ordinary topic.

Instructor starts unassigned unless later assigned by ADFA.

### 5.2 LAB session

When ADC creates a LAB session:

```text
Course       -> ADC sets
Date         -> ADC sets
Time         -> ADC sets
Type         -> ADC sets value LAB
Room         -> ADC sets
Lab Topic    -> system sets TBD
Instructor   -> unassigned
```

ADC cannot enter the LAB topic during creation.

If ADC changes an existing non-LAB session to `LAB`, the topic is reset to `TBD` so ADC cannot carry a previously entered ordinary topic into the LAB-owned field.

If ADC changes `LAB` to a non-LAB type, ordinary topic becomes ADC-editable again.

## 6. Field Responsibility & Approval Routing

A single Faculty/HICC/VISC change request can contain changes owned by several offices. The system automatically maps changed fields to required approval offices.

### 6.1 Ordinary session routing

```text
Course / Course Number -> ADC
Date                   -> ADC
Start / End             -> ADC
Type                    -> ADC
Room                    -> ADC
Ordinary Topic          -> ADC
Instructor / Faculty    -> ADFA
```

### 6.2 LAB session routing

```text
Course / Course Number -> ADC
Date                   -> ADC
Start / End             -> ADC
Type                    -> ADC
Room                    -> ADC
LAB Topic               -> LAB
Instructor / Faculty    -> ADFA
```

Routing must be recomputed if a request revision changes the session type because moving into or out of LAB changes which office owns Topic.

## 7. One Request, Internal Multi-Office Approval

The chosen model is **one user-facing request with internal office-scoped approvals**.

Faculty/HICC/VISC see only the overall state. They do not need to know which office is currently processing the request.

A representative shared request structure is:

```text
requestSchema: office-routing-v1
status: pending
revision: 1
requiredApprovals:
  adc: true
  adfa: true
  lab: false
approvalScopes:
  adc.fields: [start, end]
  adfa.fields: [assignments]
  lab.fields: []
approvals:
  adc.status: approved
  adc.scopeHash: ...
  adfa.status: pending
  lab.status: not_required
```

Each office approval records a deterministic fingerprint/hash of that office's approved scope. On resubmission, unchanged approved scopes can be retained safely instead of relying only on disabled UI fields.

## 8. Faculty-Facing Status

Faculty/HICC/VISC see simple overall states only:

```text
Pending
Pending - Update required
Approved
Rejected
Withdrawn
```

They must not be shown office routing such as `ADC approved` or `ADFA pending`.

When pushed back, the requester sees the push-back message and actions to edit/resubmit or withdraw, without needing to know the internal office identity unless later intentionally designed.

## 9. Office Approval Views

Each office sees the full basic session context necessary to understand the request, but can act only on its own scope.

Example mixed LAB request:

```text
Date        Sep 21 -> Sep 22       ADC
Room        CSB 101 -> CSB 116     ADC
Lab Topic   Suture -> Advanced     LAB
Instructor  Dr. A -> Dr. B         ADFA
```

### 9.1 ADC/LAB context

ADC and LAB may see fields outside their scope as context, with office status:

```text
Date
Sep 21 -> Sep 22
ADC: Approved

Lab Topic
Suture -> Advanced
LAB: Pending

Faculty Assignment
Proposed Faculty: Dr. B
ADFA: Pending
```

They can only approve/reject/push back their own office scope.

A single office decision covers all fields currently assigned to that office for the request; it is not one button click per field.

### 9.2 ADFA view

ADFA retains the richer approval interface currently used for Faculty assignment decisions. It may use:

- Faculty names and internal identifiers as authorized;
- DOE information;
- current/projected DOE;
- timetable availability/conflict details;
- AFC/Away From Campus information as currently authorized;
- conflict override controls;
- request context and other office statuses.

The ADC/LAB privacy restrictions must not strip information from the ADFA approval experience.

### 9.3 Owner / ADFA General overview

Owner/ADFA General can see the full approval matrix, for example:

```text
Request   ADC       LAB       ADFA      Overall
#101      Approved  -         Pending   Pending
#102      Approved  Approved  Approved  Approved
#103      Rejected  -         Pending   Rejected
```

## 10. Privacy Boundary for ADC/LAB

For Faculty assignment context, ADC/LAB may see only basic sanitized information such as:

```text
Faculty Assignment
Proposed Faculty: Dr. Jane Smith
ADFA Status: Pending / Approved / Rejected
```

ADC/LAB must **not** receive or display:

- UCID / Faculty ID;
- Faculty email;
- DOE values;
- current/projected DOE;
- contract teaching target;
- detailed availability calculations;
- AFC/Away From Campus records;
- AFC dates/reason/purpose;
- HR fields;
- private Faculty Directory detail.

This is a data-delivery boundary, not merely a CSS/UI hiding rule.

## 11. Sanitized Calendar Layer

Current Firestore sessions are readable to every `ready()` user and contain internal assignment data. That is incompatible with the new ADC/LAB privacy requirement.

Introduce a sanitized derived collection conceptually named:

```text
calendar_sessions/{sessionId}
```

It contains only the timetable fields ADC/LAB need, for example:

```text
sessionId
course
courseName
date
start
end
timeUnknown
type
topic
room
instructorNames // names only
```

It must not contain:

```text
assignments[].ucid
facultyIds
DOE fields
AFC data
private Faculty references
```

### 11.1 Read boundaries

Conceptual rule:

```text
ADFA / Owner
  sessions            read allowed
  calendar_sessions   read allowed

ADC / LAB
  sessions            read denied
  calendar_sessions   read allowed
```

The exact Faculty/HICC/VISC read model must be preserved carefully during implementation; WS5B must not accidentally break existing self-service or group workflows. The rule change must be designed role-by-role and tested in the Emulator.

### 11.2 Keeping sanitized calendar in sync

One canonical `buildSanitizedCalendarSession()`-style builder must derive the sanitized document from a source session.

All relevant writes must keep source and sanitized representations consistent, including:

- Add One;
- Add Sessions;
- direct ADC edits;
- direct LAB topic edits;
- ADFA edits;
- multi-session edits;
- final approval apply;
- bulk import/restore paths where sessions change;
- deletes.

Where possible, a Firestore batch/transaction must update source session + sanitized calendar document atomically.

Bulk import/restore and repair tooling must not leave this collection silently stale. Implementation should provide deterministic verification/rebuild coverage for `calendar_sessions`, or integrate it into an existing integrity-verification path, before WS5B is considered complete.

## 12. Private Approval Data

Because Firestore cannot hide individual fields in a document after the client is allowed to read it, confidential approval data must not live in the same readable document as ADC/LAB approval context.

Use a split model conceptually like:

```text
change_requests/{id}
  sanitized/shared request and approval status

change_request_private/{id}
  ADFA/internal Faculty assignment references and confidential data
```

ADC/LAB must be denied reads to the private collection.

The shared request may contain a proposed Faculty **display name** and ADFA status but not private identifiers/DOE/AFC data.

Faculty self-replacement can continue to use privacy-safe opaque candidate keys; resolution from opaque key to internal Faculty identity remains ADFA/private behavior.

## 13. Legacy Request Privacy

Existing legacy `change_requests` can contain unsanitized Faculty fields. ADC/LAB must not be granted broad read access to those documents.

New routed requests must carry a schema marker such as:

```text
requestSchema: office-routing-v1
```

Firestore rules must allow ADC/LAB reads only for the sanitized routed schema they are authorized to review. Legacy requests remain ADFA-compatible and ADFA-only unless explicitly migrated by a deterministic migration.

This prevents adding ADC/LAB from accidentally exposing UCIDs or other legacy private fields.

## 14. Approval Decision Model

Each required office has a scoped decision state such as:

```text
pending
approved
push_back
rejected
not_required
cancelled
```

Overall request states include:

```text
pending
update_required
approved
rejected
withdrawn
```

### 14.1 Final apply

No timetable fields are applied until every currently required office has approved.

When all required approvals are complete:

1. reload the latest source session;
2. run stale-base protection;
3. run canonical WS5A schedule/conflict checks;
4. perform any required ADFA conflict override confirmation before final approval is accepted;
5. atomically apply the full request patch plus audit/log/sanitized-calendar updates as feasible;
6. mark the exact revision as applied.

Finalization must be idempotent. Two offices approving at nearly the same time must not apply the request twice. Use a Firestore transaction or equivalent guarded transition with `appliedRevision` / `appliedAt` checks.

### 14.2 Reject

Any required office may reject.

```text
any required office rejects
-> overall rejected
-> no timetable changes applied
-> remaining pending office decisions become cancelled/not actionable
```

Already completed office decisions remain preserved in audit history.

## 15. Push Back & Resubmission

`Push Back` is distinct from `Reject`.

Office action buttons become conceptually:

```text
Approve
Push Back
Reject
```

Push Back requires a nonblank message/reason.

After push back:

```text
overall = update_required
```

The requester may:

```text
Edit & Resubmit
Withdraw Request
```

### 15.1 Other office decisions continue

A push back returns only that office's scope for revision. It does not erase approvals already given by other offices.

Unchanged scopes that are still pending may continue to be reviewed while the returned scope is being corrected, provided their approved/pending data is immutable to the requester. If multiple offices push back, the requester may edit all returned scopes.

### 15.2 Preserve prior office approvals

If ADC and LAB approved and ADFA pushes back, a requester editing only the ADFA-owned fields does not need ADC/LAB reapproval.

Previously approved fields are greyed out during revision so the requester cannot silently change them. Backend scope-hash/revision checks enforce the same rule even if the UI is bypassed.

### 15.3 Safety exception: date/time invalidates ADFA approval

If a resubmission changes Date, Start, or End while a Faculty assignment exists, any prior ADFA approval must automatically reopen to `pending` because availability/conflict meaning may have changed.

Example:

```text
ADFA approved Dr. Smith for 09:00-10:00
ADC pushes back time
requester changes to 14:00-15:00
-> ADFA approval reopens
```

### 15.4 Type changes recompute routing

Changing session Type into or out of `LAB` recomputes required routing because topic ownership changes.

### 15.5 Changing already approved unrelated fields

A requester cannot change a field already approved by another office within a scoped push-back revision. To change previously approved scope, the requester must withdraw and submit a new request.

## 16. Direct ADC Date/Time Changes With Assigned Faculty

ADC is allowed to directly edit its owned course/date/time fields without submitting an approval request. However, changing Date/Start/End on a live session that already has an assigned instructor can affect the validity of that assignment.

Because ADC must not receive private availability/AFC data, the system must not expose those checks to ADC. Instead:

- the ADC change may save if it satisfies ADC's own scheduling validation;
- ADFA receives a sanitized workflow notification that the schedule changed and the existing Faculty assignment should be rechecked;
- ADFA can use its full authorized information to review/adjust the assignment;
- any actual ADFA reassignment still uses the normal conflict-warning/override rules.

This preserves ADC's direct-edit authority while keeping Faculty-assignment responsibility with ADFA and avoiding private data leakage to ADC.

## 17. Withdraw for Timetable Requests

A requester may withdraw a timetable request while it is not finally applied, including:

```text
pending
update_required
```

Withdraw is terminal for that request:

```text
status = withdrawn
changes applied = none
```

The Firestore document is retained for audit; it is not deleted.

Any prior office approvals remain visible in authorized audit history but cannot later cause the withdrawn request to apply.

Withdrawal and final approval/apply must use guarded transactional transitions so a request cannot be both applied and withdrawn in a race.

## 18. Withdraw for AFC

Extend AFC statuses with:

```text
withdrawn
```

The requester may withdraw an AFC request while:

```text
pending_report_to
pending_admin
```

This includes the case where Reports To already signed and the request is waiting on ADMIN.

After withdrawal:

- the request is terminal;
- no final approved PDF is created;
- existing signatures/history remain in the audit trail;
- a later attempt requires a brand-new AFC request and applicant signature.

Approved, rejected, or already withdrawn AFC requests cannot be withdrawn again.

Firestore rules and AFC actions must explicitly enforce requester-only withdrawal and legal source statuses. AFC approval and withdrawal must be guarded so they cannot both win concurrently.

## 19. Workflow Notifications

Add a small side-panel/notification window for office/admin users.

Role-scoped events include:

```text
new request assigned to your office
pushed-back request resubmitted
another required office approved/rejected/pushed back
request fully approved and applied
request withdrawn
ADC direct date/time change requires ADFA assignment recheck
```

After successful full approval, each participating office/admin should receive a visible completion notification.

ADC/LAB notification payloads must remain sanitized and must not contain UCID, DOE, availability details, AFC data, or other private Faculty information.

Owner/ADFA General may receive overall workflow notifications.

Because the application remains Spark/client-only, notification creation must be part of authorized workflow writes with rules constraining actor, target, and allowed payload. No Cloud Function is assumed.

## 20. Audit Lifecycle

Audit/history must capture the full request lifecycle rather than only the final result.

Example:

```text
10:02 Faculty submitted
10:12 ADC approved
10:18 LAB approved
10:24 ADFA pushed back: "Please select another instructor"
10:37 Faculty resubmitted revision 2
10:45 ADFA approved
10:45 Request fully approved
10:45 Changes applied to live timetable
```

Withdraw example:

```text
10:02 submitted
10:12 ADC approved
10:18 requester withdrew
```

Conflict override events and direct ADC schedule-change recheck notifications should also be auditable.

## 21. Legacy Request Compatibility

Existing `change_requests` created before WS5B may not have scoped approvals.

Implementation must identify legacy request shape and continue routing it through the existing ADFA-only decision path until resolved, while all newly created requests use `office-routing-v1` scoped routing.

Do not silently reinterpret old requests into new multi-office approvals without a deterministic migration.

## 22. Firestore Rules

This workstream requires rule changes and therefore Firebase Emulator tests before manual deployment.

Rules must enforce, at minimum:

- `adc` and `lab` are valid active roles;
- ADC/LAB can read only the calendar/session data authorized for them;
- ADC cannot update instructor/private Faculty assignment fields;
- ADC cannot update LAB topic;
- LAB can update only LAB topic on eligible LAB sessions;
- LAB cannot create/delete sessions;
- office decision writes can modify only the caller's scoped approval state;
- ADC/LAB can read only sanitized `office-routing-v1` requests assigned/relevant to their office;
- ADC/LAB cannot read `change_request_private` or unsanitized legacy request data;
- requester-only timetable withdraw/resubmit transitions are valid;
- requester-only AFC withdraw transition is valid;
- terminal requests cannot be reactivated by unauthorized writes;
- private Faculty/AFC collections remain inaccessible to ADC/LAB except where an explicitly sanitized collection exists;
- `calendar_sessions` content is constrained to the approved sanitized schema as far as practical in rules;
- final apply/withdraw transitions are race-safe and idempotent.

UI grey-out must never be treated as authorization by itself.

## 23. Testing Matrix

Automated/unit tests should cover:

1. role normalization/labels for `adc` and `lab`;
2. User Management role selection and existing-auth profile linking;
3. capability matrix for ADFA/ADC/LAB;
4. ADC Add One/Add Sessions access;
5. LAB only Select Sessions access;
6. greyed/disabled non-owned fields;
7. ADC cannot edit LAB topic;
8. LAB cannot edit date/time/course/room/type/instructor;
9. ADC cannot edit instructor;
10. ADFA retains existing edit access for testing;
11. ordinary routing to ADC + ADFA;
12. LAB routing to ADC + LAB + ADFA;
13. one user-facing request with multiple office states;
14. office can decide only its scope;
15. any reject terminates without partial apply;
16. push back requires reason;
17. other office approvals survive push back when scope is unchanged;
18. resubmission scope hashes preserve only unchanged approvals;
19. date/time revision reopens prior ADFA approval;
20. type change recomputes LAB routing;
21. withdrawn request never applies;
22. AFC withdraw from `pending_report_to`;
23. AFC withdraw from `pending_admin` after Reports To signature;
24. sanitized `calendar_sessions` contains no forbidden Faculty fields;
25. ADC/LAB read of source private session/approval data is denied in Emulator;
26. legacy unsanitized requests remain unreadable to ADC/LAB;
27. ADC/LAB notification data remains sanitized;
28. direct ADC date/time edit with assigned Faculty creates ADFA recheck notification without exposing private availability data to ADC;
29. simultaneous final approvals apply exactly once;
30. simultaneous withdraw/final-approval race has one legal winner;
31. final all-office approval creates correct audit entries;
32. legacy requests remain resolvable through ADFA compatibility behavior;
33. sanitized calendar verification/rebuild detects and repairs missing/stale read-model documents.

Manual browser acceptance must include at least one mixed LAB request passing through ADC/LAB/ADFA, one push-back/resubmit flow, one withdrawal, one conflict override, direct ADC and LAB edits with greyed fields, the side notification panel, and privacy inspection while signed in as ADC and LAB.

## 24. Delivery & Deployment Order

WS5B must not be merged before WS5A provides the canonical scheduling core it depends on.

Recommended order:

```text
WS5A branch / PR
-> automated tests
-> GitHub Pages manual test
-> explicit user approval
-> merge

WS5B branch based on merged WS5A
-> unit/UI tests
-> Firebase Emulator security-rule tests
-> GitHub Pages manual role/workflow test
-> explicit user approval
-> merge
-> manually deploy Firestore rules only after approved verification
```

The GitHub Pages test site uses live Firebase, so destructive permission/privacy scenarios must be tested in the Emulator. Live manual testing should use reversible normal workflow actions and dedicated test accounts.

## 25. Definition of Done

WS5B is complete when:

- `adc` and `lab` are formal User Management roles;
- the two existing Auth accounts are represented by correct Firestore profiles without recreating Auth users;
- ADC/LAB can view the calendar with the approved tool access;
- office-owned fields are editable and all non-owned fields are visibly greyed/disabled;
- Firestore rules independently enforce the same boundaries;
- Faculty/HICC/VISC requests route to ADC/LAB/ADFA by field responsibility;
- Faculty-facing status remains simple while authorized admins see the approval matrix;
- ADC/LAB see only sanitized Faculty assignment names/status and cannot access UCID/DOE/AFC/availability/private Faculty data;
- ADFA retains the current information-rich Faculty approval experience;
- sanitized calendar delivery prevents ADC/LAB from receiving private source session assignment data;
- sanitized calendar integrity is verifiable/repairable rather than silently divergent;
- Push Back, scoped resubmission, safety reapproval, Reject, and Withdraw behave as designed;
- AFC supports requester withdrawal before final decision;
- direct ADC time/date edits generate ADFA assignment-recheck notifications where appropriate;
- workflow notifications appear for assigned/updated/completed activity without leaking private data;
- audit history records the complete lifecycle;
- Emulator tests prove the security boundaries;
- browser acceptance passes on the exact test build;
- the user explicitly approves the exact WS5B PR/version before merge.
