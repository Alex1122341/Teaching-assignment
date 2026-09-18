# Shared University Closures + Timetable Overlay Design

**Date:** 2026-09-18  
**Status:** Proposed / user-approved design direction, awaiting written-spec review  
**Repository:** `Alex1122341/Teaching-assignment`

## Goal

Create one canonical University of Calgary closure calendar used by both AFC working-day calculations and the timetable UI.

The current AFC implementation hard-codes closure dates inside `afc-workflow.js`, while the timetable has a separate synthetic overlay mechanism for CCC. This change removes the duplicated closure knowledge and adds a read-only timetable overlay controlled by a checkbox beside **Show CCC**.

The timetable representation will use the user-selected “B” design: a closure appears as a full teaching-day block from **07:30 to 17:00** so a closed day is immediately obvious.

## Non-goals

This work does **not**:

- create Firestore documents for University closures;
- make closures editable by ADFA, ADC, LAB, HICC, VISC, or Faculty;
- treat closures as teaching sessions for DOE, workload, Faculty conflicts, approval routing, or audit logs;
- infer “University closed” from term breaks, reading weeks, Fall Break, or days with no teaching;
- change CCC storage or AFC request data;
- change Firestore Rules;
- introduce a backend service.

## Source-of-truth model

Add a pure static module:

- `university-closures.js`

It is the only application source of closure dates and closure names.

The module exposes a browser global and a CommonJS export for Node tests:

- `UCVM_UNIVERSITY_CLOSURES.entries`
- `UCVM_UNIVERSITY_CLOSURES.get(date)`
- `UCVM_UNIVERSITY_CLOSURES.isClosed(date)`
- `UCVM_UNIVERSITY_CLOSURES.between(startDate, endDate)`
- `UCVM_UNIVERSITY_CLOSURES.countWorkingDays(startDate, endDate)`

Dates are stored as `YYYY-MM-DD` calendar dates. Date-only logic must not depend on the browser timezone. Range functions are inclusive.

Each catalog row has this shape:

```js
{
  date: '2027-02-15',
  name: 'Family Day',
  category: 'university_closure'
}
```

The catalog is sorted by date and date keys are unique.

## 2027 catalog

The initial 2027 runtime catalog preserves the dates already used by AFC so the AFC result does not silently change during this refactor.

| Date | Display name |
| --- | --- |
| 2027-01-01 | New Year's Day |
| 2027-02-15 | Family Day |
| 2027-03-26 | Good Friday |
| 2027-03-29 | Easter Monday |
| 2027-05-24 | Victoria Day |
| 2027-07-01 | Canada Day |
| 2027-08-02 | Heritage Day |
| 2027-09-06 | Labour Day |
| 2027-09-30 | National Day for Truth and Reconciliation |
| 2027-10-11 | Thanksgiving Day |
| 2027-11-11 | Remembrance Day |
| 2027-12-27 | Holiday Observance — University Closed |
| 2027-12-28 | Holiday Observance — University Closed |
| 2027-12-29 | Holiday Observance — University Closed |
| 2027-12-30 | Holiday Observance — University Closed |
| 2027-12-31 | Holiday Observance — University Closed |

The 2026 dates already used by AFC are moved into the same module as well so the refactor preserves existing 2026–27 behavior.

### Calendar interpretation

Only dates that are actually treated as University closure dates belong in this catalog.

Examples explicitly **not** included:

- Winter / Term Break when the University is open;
- Fall Break when the University is open;
- DVM-specific non-teaching days unless they are also institutional University closures;
- weekends merely because there is no teaching.

For December 2027, the existing AFC application data contains the weekday closure dates Dec. 27–31. Those dates remain unchanged in this implementation and use the generic “Holiday Observance — University Closed” label rather than inventing a specific holiday name for each day.

## External verification basis

The design was cross-checked against current University of Calgary public sources before implementation:

- Registrar Academic Dates: named 2026–27 closures including New Year's Day, Family Day, Good Friday, Easter Monday, Victoria Day, Canada Day, Heritage Day, Labour Day, National Day for Truth and Reconciliation, Thanksgiving, and Remembrance Day.
- UCalgary Tentative Future Dates: Fall 2027 lists Labour Day, Sept. 30, Thanksgiving, and Remembrance Day as University closed, while explicitly listing Fall Break as University open.
- MaPS Employee Handbook: December closure is Dec. 25–31 or as designated.

These external sources are verification references. Runtime behavior still uses the explicit static catalog checked into this repository; the app does not fetch external websites.

## AFC behavior

`afc-workflow.js` will no longer own a local `holidays` set.

Its working-day calculation delegates to:

```js
UCVM_UNIVERSITY_CLOSURES.countWorkingDays(startDate, endDate)
```

Semantics remain:

1. inclusive start/end date range;
2. Saturday and Sunday never count as working days;
3. catalog closure dates never count as working days;
4. a closure falling on a weekend is not double-subtracted;
5. invalid or reversed ranges keep the current AFC validation behavior.

The AFC UI text continues to explain that the count excludes weekends and published UCalgary holidays/closures.

## Timetable control

Add a second checkbox beside the existing **Show CCC** control:

- **Show University Closures**

State:

- default: off;
- reset filters: returns to off;
- independent from `showCcc`;
- does not require Firestore reads because the catalog is bundled static data.

The closure checkbox follows the same overall display lifecycle as CCC: turning it on injects synthetic rows into the current rendered timetable range; turning it off removes them.

## Synthetic timetable row

For each catalog entry in the visible range, the timetable creates a display-only synthetic row:

```js
{
  id: 'closure-2027-02-15',
  date: '2027-02-15',
  week: <academic week>,
  semester: <academic semester>,
  year: '',
  course: 'UC',
  courseName: 'University Closed',
  type: 'CLOSURE',
  topic: 'Family Day',
  instructor: '',
  assignments: [],
  room: '',
  start: '07:30',
  end: '17:00',
  timeUnknown: false,
  isUniversityClosure: true,
  sourceSystem: 'UCalgary University Closure Calendar'
}
```

These rows exist in memory only. They are never written to `sessions`, `calendar_sessions`, indexes, or audit collections.

## Timetable rendering

A closure is rendered in Day, Week, Month, and List views.

### Day / Week

The block occupies 07:30–17:00, matching the user-approved “B” presentation.

The block content is closure-specific rather than using the normal teaching-session text:

- line 1: **University Closed**
- line 2: the closure name, for example **Family Day**
- line 3: **07:30–17:00 · Institutional closure**

Use a dedicated visual class such as `tg-type-closure`. It must be visually distinct from CCC and normal teaching types while respecting the existing light/dark theme.

### Month

The event label is:

- **University Closed**
- closure name

### List

The row shows:

- Date
- 07:30–17:00
- University Closed
- Closure
- the closure name
- blank Faculty
- blank Room

## Filtering semantics

University closures are a global institutional overlay, not a course or Faculty assignment.

When **Show University Closures** is on:

- date range / current calendar period controls whether the closure is in scope;
- semester and month navigation still apply;
- the closure is **not** hidden by Year, Course, Type, My Timetable, or Faculty filters;
- the closure does not become a selectable “course” in the Course filter.

This avoids a misleading state where the user explicitly enables University closures but a course filter silently hides them.

Search behavior also does not suppress a closure overlay; the explicit closure checkbox is the authority for whether the institutional marker is visible.

## Read-only protection

Create a shared timetable predicate, for example:

```js
isReadOnlySynthetic(session)
```

It returns true for both:

- `session.isCcc`
- `session.isUniversityClosure`

Use it consistently wherever timetable interaction currently special-cases CCC.

For a University closure:

- no Edit Session button;
- no SWAP Faculty button;
- cannot enter Select Sessions;
- cannot enter bulk/multi-edit;
- cannot create a change request;
- clicking the block opens detail only.

The detail modal states:

- **University Closure — read-only institutional calendar record**
- closure name;
- date;
- source: `UCalgary University Closure Calendar`.

## DOE, Faculty availability, conflicts, and workload

Closure rows never enter the canonical session arrays used for scheduling calculations.

They are injected only for rendering/export projection. Therefore they must not:

- create Faculty conflicts;
- count as assigned teaching;
- change DOE;
- change AFC teaching-session detection;
- appear in Faculty teaching summaries;
- trigger assignment recheck events;
- affect derived indexes.

A future separate validation feature may warn about real teaching sessions scheduled on a closure date, but that is explicitly outside this task.

## Export behavior

The current export flow already respects the CCC display toggle. University closures will follow the same user-facing rule:

- if **Show University Closures** is off, closures are excluded;
- if it is on, closures are included in CSV and standard ICS exports.

CSV adds a clear `University Closure` boolean column.

For standard ICS export, a University closure is exported as an **all-day event**, even though the timetable display occupies 07:30–17:00. The all-day export better represents the institutional meaning and matches the existing synthetic-event approach used by CCC.

University closures are **always excluded from Outlook teaching invitation packages**. A closure must never generate organizer/attendee meeting invitations.

## Static asset and load order

`university-closures.js` must be included in:

- `tools/static-assets.json`
- `index.html`

It loads before:

- `timetable.js`
- `afc-workflow.js`

This guarantees both consumers use the same catalog.

If another page directly loads `afc-workflow.js`, its script chain must also load `university-closures.js` first.

## Files expected to change

Create:

- `university-closures.js`
- `tests/university-closures.test.js`
- focused timetable closure regression test(s), name chosen during planning

Modify:

- `afc-workflow.js`
- `test-support/afc-policy.js` or replace its duplicated closure catalog with the shared module
- `tests/afc-policy.test.js`
- `index.html`
- `timetable.js`
- `timetable.css`
- `tools/static-assets.json`
- runtime asset/load-order tests
- export tests if present / required

No Firestore Rules change is expected.

## Test requirements

### Closure core

Tests must prove:

- catalog dates are unique and sorted;
- known 2026 and 2027 closures resolve to the expected names;
- non-closure dates return false/null;
- `between()` is inclusive and date-only safe;
- weekend handling is correct;
- `countWorkingDays()` matches existing AFC behavior;
- the existing regression `2026-12-21` through `2027-01-04` remains **5 working days**.

### AFC integration

Tests must prove:

- `afc-workflow.js` no longer owns a second closure list;
- AFC reads the shared closure module;
- working-day output does not change for existing covered ranges.

### Timetable overlay

Tests must prove:

- the control exists and defaults off;
- reset returns it to off;
- turning it on creates the correct synthetic closure row;
- the row uses 07:30–17:00;
- the block carries the real closure name;
- closure rows render in Day / Week / Month / List projections;
- closures remain visible even when Year/Course/Type/My Timetable filters would hide normal sessions;
- closure rows are read-only and excluded from selection/edit/swap;
- closure rows never enter Firestore write plans, DOE, conflict, or derived-index paths.

### Export

Tests must prove:

- CSV/ICS include closures only when the closure toggle is on;
- ICS closure event is all-day;
- Outlook invitation export excludes closures.

### Build/runtime

Run the repository's full static/unit suite and Firestore/Auth Emulator suite. The exact GitHub Pages test artifact must then be manually browser-tested before merge, following the repository's existing acceptance workflow.

## Manual acceptance checklist

On the GitHub Pages test site:

1. Confirm **Show University Closures** appears beside **Show CCC**.
2. Leave it off and verify no closure blocks are visible.
3. Turn it on and navigate to at least:
   - 2027-02-15 — Family Day
   - 2027-03-26 — Good Friday
   - 2027-09-30 — National Day for Truth and Reconciliation
   - one Dec. 27–31 closure day
4. Verify each closure occupies 07:30–17:00 and shows the correct closure name.
5. Verify Day, Week, Month, and List views.
6. Turn on a restrictive course/type/My Timetable filter and verify the enabled closure overlay remains visible.
7. Enter Select Sessions and verify closure blocks cannot be selected.
8. Click a closure and verify only read-only detail is available.
9. Check an AFC date range containing a closure and confirm the working-day count still excludes it.
10. Export CSV/ICS with the closure toggle on and verify closures are included; verify Outlook teaching invitation export does not include them.

## Rollout and merge boundary

Implement this work on its own feature branch / PR.

Do not mix it into Audit R05 PR #38 or any student-owned privacy / approval-security / AFC authorization / 200-row branch.

The workflow remains:

feature branch → tests → GitHub Pages test site → manual browser acceptance → explicit user merge approval → merge to `main` → main verification/build → separate production approval.
