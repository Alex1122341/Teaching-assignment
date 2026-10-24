# Teaching Schedule HICC–CC / VISC directory (2026-10-22)

Branch `feature/hicc-visc-directory-20261022`, based on `main` @ `924cc6761a3b2dfba4f19c2df912436cbd965b43` (which contains `a46c3bd`, the starting point named in the task, plus PR #130 CCC Schedule). Product `de4d3cac`, governance `d8dfcada`.

## 1. Inspection and reuse

| Existing piece | Finding | Reused how |
|---|---|---|
| `index.html` `course-list-btn` and `timetable.js` `openCourseList()` | Static course list from bundled `COURSES` plus loaded sessions; no role data | Removed (button, binding, renderer). `courseCodes()`/`COURSES` stay because filters and session editing use them. |
| `timetable.css` `.course-list-btn` | UCalgary red treatment (light and dark) | The two new buttons keep this class; `leadership-directory.css` only stacks them. |
| CCC Schedule (PR #130) `ccc-schedule.js` overlay | The current accessible PAWS dialog pattern: `role="dialog"`, Escape, focus trap and restore, Refresh, live status, fail-closed rendering | Same pattern and CSS tokens for the directory dialog. The older `showModal()` in `timetable.js` has no Escape or focus handling, so it was not used. |
| `faculty-role-periods.js` | Dashboard rules: periods override legacy dates; inclusive Calgary dates; a missing start means *Dates needed*; all-future means *not started*; gaps are inactive | Ported to `server/src/roles/role-effective-status.js` (the server artifact cannot load a browser file). A parity test runs both over the same cases. |
| `paws-data-client.js` | Authenticated GET helper, support-context header, 401 refresh | New `leadershipDirectory(academicYear)` method. |
| Academic year | `UCVM_PAGE_DATA.academicYear()` in `timetable.js` (list year or the week's year via `sqlAcademicYearForDate`) | Passed to the dialog. The API canonicalises it with `server/src/data/academic-year.js`. |
| `/api/v1/dashboard/roles` | Administrator-only; returns DOE values, overrides, notes and details | **Not widened, not reused as a response.** Its SQL shape (RoleAssignment + RoleAppointmentSchedule + active Faculty + `facultyDisplayNameSql`) is reused in a separate projection. |
| `validateAuthorizedProfile` (`data-api.js`) | Active, no forced password change, supported role, Faculty link for Faculty-scoped roles | Same gate as the CCC Schedule. |
| `paws.Subject`, `TeachingResponsibility*` | `paws.Subject` is not granted to `paws_runtime_read`. No column links a RoleAssignment to a Subject. Per the task's live findings, the responsibility tables hold only one HICC and one VISC entry. | Not used. VISC rows show the recorded `CourseOrSubjectOrRotation`, never a session topic. |
| Grants (017, 029, 035) | `paws_runtime_read` may read RoleAssignment (incl. RoleType, scope, dates; **not** CourseId), RoleAppointmentSchedule, the Faculty name columns and Course(CourseCode, CourseName) | The query uses only those columns, so **no SQL migration is needed**. Checked on SQL Server under `EXECUTE AS` the runtime user (§4). |

## 2. Source and mapping

`GET /api/v1/dashboard/leadership-directory?academicYear=YYYY-YY` (read-only; routed before the administrator Dashboard API; `Cache-Control: private, no-store`).

| List | RoleType (exact, trimmed, case-insensitive) | Shown as |
|---|---|---|
| HICC–CC | `HICC` | `HICC · <scope>` |
| HICC–CC | `Course Coordinator` | `CC · <scope>` |
| VISC | `VISC` | `VISC · <scope>` |
| — | `Course Coordinator / HICC (legacy ambiguous)`, Rotation Participant, CCC, Designated Rotation Coordinator, manual DOE adjustments, anything else | excluded |

- **Population:** `paws.RoleAssignment` rows for exactly the requested academic year, joined to an **active** Faculty record (the same population as the administrator Roles tab). Unresolved rows (`FacultyId` NULL) are not shown. `tools/leadership-directory-reconcile.sql` counts them.
- **Scope:** the Course code when `CourseOrSubjectOrRotation` matches exactly one `paws.Course.CourseCode`. Otherwise the recorded text. Otherwise *Not recorded*. Nothing is guessed.
- **Faculty name:** `facultyDisplayNameSql` (preferred first and last name, else DisplayName).
- **Periods:** RoleAppointmentSchedule `PeriodsJson` when a schedule row exists. Otherwise legacy Effective/Expiration as one period. Never the academic year.
- **Status on the Calgary date** (`America/Edmonton`, inclusive dates):
  - **Active**: a period covers today; shows that period's end, or *No end date*.
  - **Dates needed**: a period lacks its start and has not ended; shows *End date not recorded*, or *Start date not recorded · Ends …*.
  - **Upcoming**: only future periods; shows the start and end.
  - **Inactive**: ended, or in a gap; shows *Ended …* and, for a gap, *Resumes …*. An explicitly empty schedule shows *No effective period recorded*.
- **Duplicates:** only rows with the same role, scope, Faculty member and recorded dates collapse. Different courses, roles or periods each stay.
- **Order:** HICC–CC sorts naturally by scope, then HICC before CC, then name. VISC sorts by subject, then name. Rows without a scope go last. The order is total, so it never depends on SQL row order.
- **Response:** `{academicYear, asOfDate, hiccCc[], visc[]}`. Each entry is `{roleType, scope, facultyName, status, startDate, endDate[, nextStartDate]}`. No DOE, IDs, emails, UCIDs, UIDs, notes, details or source fields. At most 1000 rows; more fails closed with 503.
- **Freshness:** the dialog fetches on every open and on Refresh, so period edits made in the Faculty Dashboard appear on the next open or refresh.

## 3. UI

Under **Teaching Schedule** the two buttons **HICC–CC List** and **VISC List** are stacked vertically, equal width and height, in UCalgary red. They show only when signed in. Each opens a two-column dialog:

- Columns: *Course / Subject* or *Subject*, and *Faculty* with the status line below the name.
- Subtitle: academic year and status date.
- A record count, *Show inactive / upcoming* (off by default, so Active and Dates needed show), Refresh, a loading state, an honest empty state, and an error state with Retry.
- Escape closes, Tab stays inside the dialog, focus returns to the button, and status changes are announced. Status colours always come with text.

## 4. Verification

| Check | Command / where | Result |
|---|---|---|
| New server tests | `cd server && node --test test/leadership-directory.test.js` | 20/20 pass (role mapping, dates incl. Calgary midnight and DST, API 401/403/400/503, minimal projection, no DOE or identifiers, route, read-only SQL) |
| New frontend tests | `node --test tests/leadership-directory-view.test.js` | 10/10 pass (two buttons replace Course List, dialog a11y markup, wiring, status text, default filter, two columns, escaping, validation, **parity with `faculty-role-periods.js`**) |
| Root suite, Linux | `node --test tests/*.test.js` at `1f1deaf` | 1036 tests: 983 pass, **1 fail**, 52 skipped. The failure is the PowerShell recovery test (no PowerShell in the container); it fails identically on `main` `924cc676` in the same container (1025 tests: 972 pass, 1 fail). |
| Server suite, Linux | `cd server && node --test test/*.test.js` | 842 tests: 832 pass, **5 fail**, 5 skipped. The same 5 fail on `main` (they need PowerShell or Docker). |
| Root suite, Windows laptop | same, at `1f1deaf` | **1036 tests: 984 pass, 0 fail**, 52 skipped (emulator); includes the PowerShell recovery test |
| Server suite, Windows laptop | same, at `1f1deaf` | 842 tests: 835 pass, **3 fail** (Docker not installed), 4 skipped |
| Firebase emulator tests | `npm run test:emulator` | **NOT EXECUTED.** No emulator or Java here. The 52 skipped root tests are these, and they are not counted as passes. |
| SQL Server check (LocalDB, synthetic) | `node tools/leadership-directory-sql-check.js <repo> PAWSTestSim` → `docs/evidence/hicc-visc-localdb-sql-check.json` | **Pass.** The exact repository query ran under `EXECUTE AS USER = paws_testing_runtime` (`paws_runtime_read` member). It returned only HICC / Course Coordinator / VISC and excluded the legacy label, Rotation, inactive Faculty and other years. Gap, legacy, no-date and unscoped cases were correct. The transaction rolled back (0 rows left). |
| Responsive UI | Headless Chromium, 1366/768/390/320 px, light and dark (`docs/evidence/hicc-visc-ui/`) | **Pass** in 8/8 layouts: two equal stacked buttons below the heading, no horizontal overflow, two columns with aligned names, focus on Close, Escape restores focus, Tab wraps, Refresh refetches, loading/error+Retry/empty states. The API was stubbed and the Firebase sign-in gate removed in the harness. |
| Freeze | `node tools/beta-freeze.js` and `--artifact .azure-production/app`; `beta-api-freeze.js` (+ `--artifact`); `verify-beta-candidate.js` | ok, zero drift; static 87, API runtime 114 |
| Release manifest | `docs/evidence/hicc-visc-directory-release-manifest-20261022.json` | Hosting artifact 87 files = manifest, byte-identical to source; API artifact 115 files, freeze ok |

## 5. Production release

**Status: BLOCKED.** No code, build or check is blocking it. Each item below needs Alex.

| Needed | Why I could not do it |
|---|---|
| Live SQL reconciliation (`tools/leadership-directory-reconcile.sql`) | No access to ITAPPVETOPSDB01 from this session |
| Current production API/Hosting SHA and the 27 gate values | Same; the University API is loopback-only on the school server |
| Stage API on a loopback port, cutover and rollback, recovery CheckOnly | Must run on the school server under the approved runtime identity |
| Firebase Hosting deploy to `tester-teaching` | Requires the Owner's authorized Firebase CLI session, and a merged, exact-main release |
| PR review and merge | Repository governance: the governance commit needs independent review; PR #125 is still open and overlaps `tools/beta-freeze.js` / `tools/static-assets.json` (merge order must be decided) |

**Owner release sequence:**
1. Review and merge this PR.
2. On the school server: build a versioned runtime from exact `main`, start it on a loopback Stage port, check `/api/health/sql`, compare all 27 gates by name and value, and test the directory with anonymous (expect 401), an unsupported account (expect 403) and an authorized account. Compare the totals with the reconciliation SQL and confirm there are no DOE fields.
3. Cut over with the existing recovery config refresh.
4. Run `firebase deploy --only hosting --project tester-teaching --config firebase.hosting-only.json` from the exact-main artifact.
5. Compare the 87 live files with the release manifest, test both buttons, and run recovery CheckOnly.

**Rollback:** point the launcher and recovery config back to the previous release folder (no SQL change to undo), and use Hosting *Roll back* to the previous release in the Firebase console.
