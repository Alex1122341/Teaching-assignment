# PAWS Multi-Year — Frontend Demo Manual Acceptance

**Status:** Not run / Owner testing pending.
**Target:** GitHub Pages PAWS Frontend Demo in \`UCVM-Teaching-Assignment/Teaching-assignment\`, only when its banner confirms the exact tested PR/head SHA.
**Storage:** Synthetic browser-local data only; no SQL, Firestore, Beta or durable shared backend.
**Feature entry:** \`Academic Years · Demo\` in the Timetable, Faculty Dashboard or Teaching Assignments top bar. The current PAWS timetable and Dashboard remain separately usable; the Academic Years window is a **self-contained test workspace**, not a live rewrite of those original pages.

## Start

1. Open the current Testing site. Confirm its TEST SITE / Frontend Demo banner, selected PR and SHA. A different PR's build may replace the shared Pages site.
2. Use the Demo's synthetic role/sign-in controls and choose **Owner**. Sign-in is simulated; it cannot prove production security.
3. Choose **Academic Years · Demo**. The window should show 2026-27 and seven tabs (Calendar, Teaching, Courses & Assignments, DOE, Roles, Archive & AFC, Course Catalog).
4. **Reset multi-year Demo** clears only this separate workspace's browser-local state, not every change on the existing PAWS pages. Opening in another browser/profile starts from independent seed records.
5. Note your role and 2026-27 data before a test. Select different roles with the Demo role selector outside the modal (close/reopen for fresh identity).

## Functional cases

| ID | Role / action | Expected result | Actual / evidence | Result |
| --- | --- | --- | --- | --- |
| MYD-01 | Owner, open 2026-27 Teaching | Existing synthetic assignments visible from initial Published snapshot | | Not run |
| MYD-02 | Owner, open 2026-27 DOE | Existing visible DOE and override values preserved | | Not run |
| MYD-03 | Owner, click Create Next Year | 2027-28 Planning; Course and Session lists empty; rules Draft | | Not run |
| MYD-04 | Owner, Roles for 2027-28 | Eligible full-May-Apr roles Confirmed; partial/exception roles Draft with reasons | | Not run |
| MYD-05 | ADFAD, confirm one Draft role | Annual 2027-28 role becomes Confirmed; 2026-27 unchanged | | Not run |
| MYD-06 | Owner/ADFAD, add VTMD 306 from Catalog | New annual Course snapshot created with no sessions/assignments | | Not run |
| MYD-07 | ADFAD, change VTMD 306 Catalog title | Existing annual Course retains original title; Catalog uses new title | | Not run |
| MYD-08 | ADFAD, add 2027-28 session | Working contains session; Faculty sees no unpublished Teaching | | Not run |
| MYD-09 | ADFAD, Finalize Working; HICC course lead, Publish | VTMD 306 gets Published v1; other Courses remain Draft | | Not run |
| MYD-10 | Course lead outside VTMD 306 scope, attempt Publish VTMD 304 | Denied in simulated domain model | | Not run |
| MYD-11 | ADFAD, edit Published session instructor | Working changes, Published Faculty Teaching stays v1 until Publish Changes | | Not run |
| MYD-12 | ADFAD, Finalize; Course lead, Publish Changes | New immutable Course release and published instructor becomes visible | | Not run |
| MYD-13 | Faculty, view 2027-28 DOE before initial publication | Pending even when Teaching is Published | | Not run |
| MYD-14 | ADFAD, Approve Rules and Publish initial DOE | DOE Published; Working preview kept internal | | Not run |
| MYD-15 | ADFAD, set DOE Override then republish changed Course | Override remains effective, calculated base changes and Needs ADFAD Review appears | | Not run |
| MYD-16 | Owner, Retire 2026-27 with Draft edits pending | Warns about pending Courses; keeps Published official; Working preserved internal | | Not run |
| MYD-17 | Faculty, open archived 2026-27 Calendar / Teaching / DOE | Calendar hidden; own Published Teaching/DOE visible | | Not run |
| MYD-18 | ADFAD/ADC/LAB, archived 2026-27 Calendar | Read-only historical Calendar visible | | Not run |
| MYD-19 | ADFAD, add shared synthetic AFC after Retire | Original archived Conflict snapshot unchanged | | Not run |
| MYD-20 | Owner, Restore 2026-27 | Returns Active, recomputes live conflicts from latest shared AFC, original snapshot unchanged | | Not run |
| MYD-21 | Faculty login/default year | Current academic year displayed; planning role remembers selected authorized year | | Not run |
| MYD-22 | Reload browser and reopen Demo | Multi-year browser-local edits survive reload; Reset clears just multi-year state | | Not run |
| MYD-23 | Try malformed/out-of-year session date | Rejected; other years/data unchanged | | Not run |
| MYD-24 | Existing Calendar / Dashboard / AFC outside modal | Existing PAWS Demo functions continue to work unchanged | | Not run |

**Result vocabulary:** Not run / Pass / Fail / Blocked / N/A. Do not record a Pass for real security, concurrent-user persistence, SQL/Firebase permissions, database migration, real notifications, or Beta behavior from this Demo.

## Known Demo-only limitations

- The Academic Years window has its **own** year selector and versioned synthetic data. The current main Calendar, Teaching Assignments and Faculty Dashboard pages are not yet rewritten to use those new year records. This is an interactive UX/business-flow prototype rather than a full integrated replacement.
- Simulated Owner, Faculty, HICC, ADC and LAB are browser-selected fixtures. Real security and trusted approval predicates are deferred to Beta.
- DOE results demonstrate version/override behavior using sample credits, not approved University DOE arithmetic. SQL implementation and formal calculation reconciliation are deferred to \`docs/architecture/multi-year-beta-migration-notes.md\`.
- The 2026-27 source in the Demo is synthetic. No actual University data is imported or modified.
- Some deep DVM course structure and non-teaching activities in the existing pages still use the original single-year sample environment. Do not treat the demo window as a live global migration.
- Every manual acceptance requires the tested PR/SHA, role, browser and evidence.

## Coursedog-inspired enhancements (PR #96 follow-up)

**Scope:** Same browser-only synthetic Demo; the test page header now carries an Academic Year Selector synchronized with the multi-year workspace. It opens the Demo Calendar on a year switch so that the original single-year Calendar is never mislabeled.

| ID | Manual scenario | Expected behavior | Result |
| --- | --- | --- | --- |
| MYD-25 | Select 2027-28 in Calendar top Academic Year selector | Opens the Demo Calendar using 2027-28; original Beta-derived Calendar remains unchanged | Not run |
| MYD-26 | Newly created 2027-28 before optional rollover | No annual Course, Session or Assignment records | Not run |
| MYD-27 | Rollover preview: VTMD 306 from 2026-27 Published, default fields | Shows release, counts, source/destination; copies Course metadata only after confirmation | Not run |
| MYD-28 | Rollover selecting Session topics but no schedule | Creates unscheduled Working Sections without teachers; Publish Review blocks unscheduled publication | Not run |
| MYD-29 | Rollover selecting Sessions, Instructor, Dates/Room | Copies previous Published data, shifts year date, excludes ineligible Faculty, resets approvals/DOE | Not run |
| MYD-30 | Attempt rollover into existing annual Course | Rejects rather than overwrites existing Course/Working or Published data | Not run |
| MYD-31 | ADFAD/Owner Scheduling Phase select Planning -> Review -> Active | Stage badge updates; invalid or unauthorized transitions denied; Published Course pointers unchanged | Not run |
| MYD-32 | Publish Review: unfinalized, missing date, inactive Faculty, conflicting AFC | Shows Block vs Warning clearly, Working/Published diff and DOE impact before commit | Not run |
| MYD-33 | Publish Changes with DOE already released and manual override | Published recalculation runs; override persists and Needs ADFAD Review remains | Not run |
| MYD-34 | Year Comparison as ADFAD and Faculty | ADFAD sees authorized Published teaching/DOE; Faculty sees only own, future DOE Pending displayed | Not run |
| MYD-35 | Switch simulated account Owner -> Faculty | Faculty defaults current year; previous privileged workspace is not retained | Not run |
| MYD-37 | Select 2027-28 then close Academic Year workspace | Original 2026-27 Calendar is masked with an explicit shortcut to the selected-year Demo; no mixed-year display | Not run |
| MYD-36 | Re-open on mobile and reload after modifications | Selector, actions, tables remain usable; synthetic state persists per browser | Not run |

**Limit:** Header year navigation and this workspace share one Demo state, but the original legacy Calendar/Dashboard data pipelines are *not* migrated or rewritten. The header selector opens the Demo view to avoid showing mismatched year labels.

## Handoff rule

After Owner manually accepts the Testing UI, plan a separate Beta review of actual table schema, authorization, DOE rules, data migration and integration. Do not merge sample identities or change live data as part of this acceptance.
