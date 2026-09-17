# WS5A review and browser acceptance

Scope: canonical scheduling/time semantics and explicit ADFA conflict overrides.
This does not implement WS5B ADC/LAB roles or multi-office routing.

## Release boundary

- Keep this PR unmerged until Alex approves the exact GitHub Pages test version.
- The fixed Pages test site uses the LIVE Firebase backend. Do not create, edit,
  delete, import, submit, or approve real records just to exercise a test case.
- Azure production is not part of this PR's test deployment.
- No Firestore rules, indexes, data migration, or Cloud Functions deployment is
  required for WS5A.
- Check the Pages banner's PR number and head SHA before recording acceptance;
  another PR can replace the fixed test site.

## What changed

- Shared parsing, dates, intervals, duration, and Faculty conflict checks now
  serve timetable, selection, sanitized replacement lookup, and approvals.
- Adjacent intervals are allowed. Reversed/zero-length/invalid intervals are
  rejected. Unknown timing is "Check needed", never invented availability.
- Day/week views keep unpositionable sessions discoverable without giving them
  a fabricated clock position.
- Explicit credited hours/DOE values are retained; unavailable inferred hours
  remain null rather than becoming zero.
- Direct add/edit/swap, bulk add, multi-edit, and both approval paths require a
  deliberate confirmation when Faculty conflicts exist. Cancel does not apply
  changes. Audit details record the administrator, timestamp, and sanitized
  conflicting session/date/time details.
- Multi-edit and bulk-add conflict checks use the complete proposed schedule,
  including other rows in the same batch and excluding replaced old rows.
- Approval actions refresh request/session, Faculty/AFC, and timetable context
  before the existing stale checks and final confirmation. This is not a new
  server-side scheduler or a guarantee against every concurrent client race.

## Non-destructive browser checks

1. Confirm the TEST SITE / Not Production / Live Firebase Backend banner and
   record the PR number and head SHA.
2. Sign in as an administrator. Open Day, Week, Month, and List views. Compare
   known session times with their previous display, especially adjacent blocks.
3. Open Select Sessions, select two or three existing rows, then Review selected
   and Back to selection. Confirm the selection is retained. Do not save.
4. In a review/form, inspect equal/reversed or incomplete times and confirm the
   validation message; cancel the form without saving. Do not submit an actual
   change request to manufacture this scenario.
5. Where existing unknown-time records are available, confirm they are labelled
   Check needed / time not specified and remain clickable without a made-up slot.
6. Sign in as Faculty. Check My Faculty Profile and Request replacement for me.
   Candidate availability and Sessional / Other choices must still work, without
   other people's UCIDs, emails, DOE, or AFC reasons. Close without submitting.
7. Where an existing pending approval can safely be inspected, review its impact
   information. Do not approve live records for testing. Use synthetic/emulator
   checks for actual override-write and cancellation scenarios.
8. Confirm the administrator dashboard, audit history, and Faculty self-profile
   still open with no new browser-console errors.

## Automated evidence and remaining manual gate

Recovery regression tests are in tests/ws5a-behavior.test.js and
 tests/ws5a-approval-actions.test.js. They execute extracted production actions
with synthetic data and mock external services, covering cancellation, adjacent
intervals, unknown timing, stale-request rejection, and sanitized override writes.
Core and existing integration tests remain in the normal npm test suite.

In the local execution container, npm test currently reports 301 tests: 271 pass,
29 emulator-only skips, and one environment failure (pwsh executable absent).
The shared static build succeeds with 44 runtime assets. Full npm test and
Firestore/Auth emulator results must come from GitHub Actions before browser
acceptance is requested. Do not describe the local full suite as green.

Manual browser acceptance and release approval are still pending. Record the
actual GitHub run IDs, exact head SHA, and Alex's acceptance in the PR rather
than pre-filling an approval here.

## Follow-on work

WS5B remains separate. Its approved design and plans are included for continuity,
not as implemented functionality. Preserve the searchable future-backend marker:

UCVM_DB_MIGRATION_REVISIT: spark-client-finalizer

The current approved WS5B plan keeps ADFA as final applier for requests that
include Faculty changes until a trusted UCalgary backend can perform the atomic
finalization without exposing confidential Faculty data to ADC/LAB.
