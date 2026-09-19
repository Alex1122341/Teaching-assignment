# Workstream 5 Implementation Plan — Self-Review Amendments

**Date:** 2026-09-17  
**Status:** Normative corrections to the two Workstream 5 implementation plans. Executors must read this file together with both plans before implementation.

Applies to:

- `docs/superpowers/plans/2026-09-17-scheduling-core.md`
- `docs/superpowers/plans/2026-09-17-approval-routing-roles-privacy.md`

These corrections were identified during the required post-plan spec-coverage, placeholder, and interface-consistency review.

## 1. WS5A: Invalid/unknown duration must not collapse to zero

In Task 3 of the scheduling-core plan, any temporary compatibility adapter around the shared duration API must preserve `null` for invalid/unknown timing.

Do **not** implement this business adapter:

```js
const blockHours=(start,end)=>scheduling.durationHours(start,end)??0;
```

Use:

```js
const blockHours=(start,end,options={})=>scheduling.durationHours(start,end,options);
```

Callers must explicitly handle `null`.

DOE/session-credit fallback must remain:

```js
const hours=scheduling.durationHours(s.start,s.end,{timeUnknown:s.timeUnknown===true});
return hours===null?null:hours;
```

A display/layout path may skip or separately label an invalid/unknown-time session, but it must not turn invalid time into a valid zero-hour business value.

## 2. WS5A: Calendar lane layout must explicitly handle non-valid timing

When `layoutDaySessions()` is migrated to `UCVM_SCHEDULING`, it must not perform arithmetic on `null` minutes.

Build lane items only from valid known-time sessions:

```js
const positioned=[];
const unpositioned=[];
for(const session of items){
  const timing=UCVM_SCHEDULING.validateInterval(session.start,session.end,{timeUnknown:session.timeUnknown===true});
  if(timing.status!=='valid'){
    unpositioned.push(session);
    continue;
  }
  positioned.push({session,startM:timing.startMinutes,endM:timing.endMinutes,lane:0,laneCount:1});
}
```

Preserve the application's existing treatment of unknown-time sessions outside the timed lane; do not invent a start/end time merely to render them.

## 3. WS5B: Direct ADC date/time recheck notification belongs to the notification task

Task 4 of the WS5B plan must not depend on a future module that does not yet exist.

Task 4 should only compute a deterministic signal after a successful ADC public-field edit:

```js
const needsAssignmentRecheck =
  actorOffice==='adc' &&
  ['date','start','end'].some(field=>changedFields.includes(field)) &&
  (currentCalendarSession.instructorNames||[]).length>0;
```

Expose that result to the caller or dispatch an internal event containing sanitized session data only. Do not write a `workflow_notifications` document in Task 4.

Task 9 owns the actual `assignment_recheck_required` notification persistence and subscribes to/calls this signal once `workflow-notifications.js` exists.

## 4. WS5B: Firestore must enforce source/calendar paired integrity

UI batching alone is insufficient. When `calendar_sessions` becomes the ADC/LAB read model, Security Rules must enforce that allowed session writes keep public source fields and the sanitized document synchronized.

Add rule helpers equivalent to:

```rules
function calendarRef(id){
  return /databases/$(database)/documents/calendar_sessions/$(id);
}
function calendarMatchesSourceAfter(id){
  let source = getAfter(/databases/$(database)/documents/sessions/$(id)).data;
  let calendar = getAfter(calendarRef(id)).data;
  return calendar.keys().hasOnly([
      'sessionId','course','courseName','year','semester','week','date','start','end','timeUnknown','type','topic','room','instructorNames','instructor'
    ])
    && calendar.sessionId == id
    && calendar.course == source.get('course','')
    && calendar.courseName == source.get('courseName','')
    && calendar.year == source.get('year',null)
    && calendar.semester == source.get('semester','')
    && calendar.week == source.get('week',null)
    && calendar.date == source.get('date','')
    && calendar.start == source.get('start','')
    && calendar.end == source.get('end','')
    && calendar.timeUnknown == source.get('timeUnknown',false)
    && calendar.type == source.get('type','')
    && calendar.topic == source.get('topic','')
    && calendar.room == source.get('room','')
    && calendar.instructor == source.get('instructor','');
}
```

Firestore Rules cannot conveniently derive `instructorNames` by mapping private assignment arrays. Therefore the safe display string `instructor` is the authoritative cross-document equality field in Rules; application sanitizer tests remain responsible for generating the matching `instructorNames` array from names only.

For source create/update paths that WS5B controls, require `calendarMatchesSourceAfter(id)`.

For source delete paths require:

```rules
!existsAfter(/databases/$(database)/documents/calendar_sessions/$(id))
```

Calendar repair writes are Owner/ADFA General only and must produce an allowlisted sanitized document matching the current source public fields.

## 5. WS5B: ADC/LAB finalizers must not read private `sessions`

Task 8's generic phrase "reload current live source session" applies only to an ADFA finalizer.

ADC/LAB are intentionally denied `sessions` reads and must not gain that permission just to finalize a non-Faculty request.

### 5.1 Non-Faculty request finalization

For a request with `hasFacultyChange == false`, ADC/LAB use `calendar_sessions/{sessionId}` as the public stale-base and optimistic-concurrency anchor.

Transaction flow:

```text
read change_requests public record
read change_request_workflow
read required change_request_approvals
read calendar_sessions current public session
compare current public session with request basePublic for fields protected by stale-base logic
verify all required approvals/current revision
update sessions/{id} with only the authorized public patch; do not read it
set calendar_sessions/{id} to the expected sanitized public result
write audit + request applied state
```

Because every legitimate source-session write is paired with its sanitized calendar write, a concurrent source public-field change also changes the calendar document and causes the transaction's calendar read to retry/fail stale validation.

Private assignment fields remain untouched by the ADC/LAB partial source update.

### 5.2 Faculty-change request finalization

For `hasFacultyChange == true`, the approved Spark constraint applies:

```text
ADFA only
-> read private source session + private request record
-> run stale-base + DOE/AFC/availability/conflict checks
-> apply full patch
```

The exact migration marker remains mandatory:

```text
UCVM_DB_MIGRATION_REVISIT: spark-client-finalizer
```

Do not grant ADC/LAB source-session read access as a workaround.

## 6. WS5B: Calendar maintenance write authorization

The calendar verify operation is read-only and available only to authorized admin maintenance UI.

Calendar repair is restricted to Owner / ADFA General. Each repair transaction must freshly read the source session and write only `UCVM_CALENDAR_SESSION.fromSource(source,id)` or delete the calendar document when the source no longer exists.

Emulator tests must assert ADC/LAB cannot invoke arbitrary calendar repair writes.

## 7. WS5B: Public request assignment data remains display-only

The requester-visible `change_requests/{id}` may contain:

```text
currentFacultyName
proposedFacultyName
```

It must not contain assignment arrays, Faculty IDs, opaque-key ownership maps, DOE values, availability details, or AFC data.

Routing `hasFacultyChange` is stored in the office-only workflow record. Private assignment references remain in `change_request_private/{id}`.

## 8. Self-review completion check

With these amendments applied during execution:

- scheduling semantics remain canonical and null-safe;
- ADC/LAB privacy is not weakened to support finalization;
- the sanitized calendar is a rules-enforced synchronized read model, not merely a UI convention;
- Task 4 no longer depends on the later notification module;
- Spark-era ADFA-last finalization for Faculty changes remains explicitly temporary and discoverable for the future UCalgary database/API migration.
