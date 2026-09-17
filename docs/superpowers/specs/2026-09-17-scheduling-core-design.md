# Workstream 5A Design — Canonical Scheduling & Time Logic

**Date:** 2026-09-17  
**Repository:** `Alex1122341/Teaching-assignment`  
**Status:** Design approved in chat; implementation not started

## 1. Purpose

Workstream 5A creates one canonical scheduling/time engine for the timetable application so date/time validation, duration calculations, timetable overlap detection, Faculty assignment conflict checks, bulk entry, single-session editing, multi-session editing, approval review, and later office-specific workflows all use the same rules.

The current application has multiple overlapping implementations, including `timeToMinutes()`, `availabilityTimeMinutes()`, `blockHours()`, and separate overlap logic in the timetable and approval workflow. They are similar but not identical. Workstream 5A replaces those duplicated business rules with a shared `scheduling-core.js` API.

This workstream deliberately does **not** implement the new ADC/LAB roles or multi-office approval routing. Those belong to Workstream 5B. Workstream 5B will consume the canonical scheduling API created here.

## 2. Core Principles

- Time and overlap meaning must be defined once.
- Adjacent sessions are not overlapping.
- Invalid or unknown time is not silently treated as a valid schedule.
- Existing `timeUnknown` behavior remains supported.
- Faculty conflict detection uses the same interval rules everywhere.
- Admin conflicts are warnings with deliberate override, not silent acceptance and not a hard block.
- Existing audit, stale-request, DOE, and privacy behavior must not be weakened.

## 3. Canonical Time Model

All valid session times normalize to minutes after midnight.

Examples:

```text
09:00  -> 540
10:30  -> 630
14:45  -> 885
```

The parser may accept existing supported UI forms for compatibility, but the canonical stored/displayed timetable form remains 24-hour `HH:MM` unless an existing field explicitly uses another format.

### 3.1 Valid interval

A known-time session interval is valid only when:

```text
start < end
```

Examples:

```text
09:00-10:00  valid
14:45-16:15  valid
10:00-10:00  invalid
11:00-10:00  invalid
```

Cross-midnight teaching sessions are out of scope for this academic timetable and are invalid unless separately designed later.

### 3.2 Duration

Duration is derived from canonical minutes:

```text
09:00-10:30
= 90 minutes
= 1.5 hours
```

DOE-related session-hour calculations that currently derive duration from timetable time must use this canonical duration function. Existing explicit credited-hour values remain governed by their current assignment rules and are not automatically overwritten merely because this helper exists.

## 4. Canonical Overlap Rule

Two valid known-time intervals overlap only when:

```text
aStart < bEnd && bStart < aEnd
```

Therefore adjacent intervals do **not** overlap:

```text
09:00-10:00
10:00-11:00
=> no overlap
```

But even one minute of intersection is a conflict:

```text
09:00-10:01
10:00-11:00
=> overlap
```

Unknown/invalid time does not return a false certainty. Callers receive an explicit unknown/check-needed result rather than treating the session as clear.

## 5. Proposed Shared API

A shared static module `scheduling-core.js` will expose business-oriented functions conceptually equivalent to:

```js
parseTime(value)
formatTime(minutes)
validateInterval(start, end, { timeUnknown })
durationMinutes(start, end)
durationHours(start, end)
intervalsOverlap(aStart, aEnd, bStart, bEnd)
normalizeDate(value)
validateSessionTiming(session)
findFacultyConflicts({ facultyId, date, start, end, sessions, excludeSessionId })
```

The exact names may vary during implementation, but all timetable/approval callers must consume one shared interpretation rather than keeping local copies.

## 6. Faculty Conflict Result

Conflict checks should return structured results instead of a bare boolean, for example:

```js
{
  status: 'conflict', // clear | conflict | check_needed
  conflicts: [...],
  possibleConflicts: [],
  reason: 'overlap'
}
```

`check_needed` covers cases such as another same-day assigned session having unknown/invalid time.

This structured result allows the same engine to serve:

- timetable assignment UI;
- Faculty replacement UI;
- bulk add validation;
- multi-session editing;
- ADFA approval review;
- Workstream 5B push-back/resubmission checks.

## 7. Admin Conflict Override

The approved policy is **warning + explicit admin override**.

When an ADFA-authorized operation would assign a Faculty member to a genuinely overlapping session, the system must display a clear warning and require a deliberate confirmation before saving/applying.

Example:

```text
WARNING: Faculty timetable conflict

VTMD 304  09:00-10:30
VTMD 315  10:00-11:00
Overlap: 10:00-10:30

[Cancel]
[Override and Continue]
```

An override must be auditable. The audit record should capture enough information to show that a timetable conflict existed and an authorized user deliberately proceeded.

Unknown-time/check-needed conditions should also be surfaced rather than silently treated as available.

## 8. Integration Points

Workstream 5A replaces local scheduling logic in these areas where applicable:

- timetable day/week layout time parsing;
- single-session form validation;
- `+ Add Sessions` bulk validation;
- multi-session edit validation;
- session duration / DOE-hour fallback calculation;
- timetable Faculty availability checks;
- faculty-swap availability checks;
- approval-workflow overlap checks;
- future ADC/LAB/ADFA routing in Workstream 5B.

The implementation should avoid unrelated rendering/refactor work. The goal is canonical behavior first.

## 9. Compatibility Requirements

- Existing valid 24-hour timetable data must continue to work without migration.
- Existing `timeUnknown: true` sessions remain valid records and must not receive invented times.
- Existing adjacent sessions remain allowed.
- Existing session IDs, Firestore collection names, and audit history remain unchanged in WS5A.
- No new role vocabulary is introduced in WS5A.
- No Firebase Cloud Functions are introduced.

## 10. Testing

Tests must cover at minimum:

1. 24-hour time parsing.
2. Supported compatibility time forms, if retained.
3. invalid minute/hour values.
4. start == end invalid.
5. end < start invalid.
6. duration in minutes/hours.
7. adjacent intervals do not overlap.
8. one-minute intersection overlaps.
9. nested and identical intervals overlap.
10. unknown/invalid-time sessions produce `check_needed`, not a false clear result.
11. exclusion of the session currently being edited.
12. same Faculty on different dates is not a conflict.
13. Faculty identification follows the existing canonical/authorized assignment identity path rather than weakening privacy.
14. bulk add and multi-edit use the shared validator.
15. ADFA override requires explicit confirmation and is represented in audit details.

## 11. Delivery Discipline

Workstream 5A will use its own implementation branch/PR. The GitHub Pages test deployment must be manually browser-tested before the PR is merged. The PR must not be merged until the exact tested version is explicitly approved.

Firestore rule changes are not expected merely to centralize time logic. If implementation reveals a rule change is necessary, it must be separately tested in the Firebase Emulator before any manual rules deployment.

## 12. Definition of Done

WS5A is complete when:

- one canonical scheduling core owns time parsing, duration, interval validation, and overlap meaning;
- duplicated business-rule implementations no longer determine inconsistent outcomes;
- timetable, availability, bulk edit, multi-edit, and approval checks agree on overlap behavior;
- adjacent end/start sessions are confirmed non-conflicting;
- genuine Faculty overlap produces an explicit warning and deliberate ADFA override path;
- automated tests pass;
- manual browser testing passes on the fixed GitHub Pages test site;
- the user explicitly approves that exact PR/version before merge.
