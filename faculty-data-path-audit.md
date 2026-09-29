# Faculty Data-Path Audit

**PAWS support task 2**, a read-only research deliverable.

| | |
|---|---|
| Repository | `Alex1122341/Teaching-assignment` |
| Current-state baseline | `main` @ `5ecbb39` ("Handle portable CLI stderr during Azure bootstrap") |
| P3 progress check | `origin/feature/scoped-parallel-assignment-workflow` @ `6ce74ef`, read only through a detached worktree. Nothing was checked out on, committed to, or pushed to that branch. |
| Target reference | P3 Design Spec `docs/superpowers/specs/2026-09-22-scoped-parallel-teaching-assignment-workflow-design.md` §11.6–§11.11 (last changed 2026-09-23); Implementation Plan Task 8 (Published Faculty views) and Task 9 (Published-base Change Requests) |
| Scope | "Ordinary Faculty" means the roles `faculty`, `hicc` and `visc` as they use the normal calendar. The code treats all three alike through `roleIsFaculty()` / `facultyMember()`. HICC/VISC *Teaching Assignment* tools are Working by design and are out of scope. |
| Changes made | None. No code, rules, seed data or live data was touched, and no emulator or live Firebase/Azure project was contacted. |

---

## 1. Summary

In brief:

1. **Every Faculty surface reads Working data today.** The Main Timetable, My Teaching, Faculty Dashboard self-mode, the AFC teaching check, Change Requests and export all read the Working `sessions` collection. No Published layer exists yet on `main` or on the P3 branch: there is no `timetable_publications` rule, no `timetable-publication.js` and no `activeReleaseId` reader. Plan Tasks T8 and T9 have not started.
2. **Firestore rules allow more than the client uses.**
   - `sessions` is readable by any `privateReader()`, which includes Faculty.
   - `calendar_sessions` is readable by any `ready()` user.
   - Only the *client query* limits Faculty to their own sessions (`facultyIds array-contains`).
   - One Faculty-reachable path already ignores that limit: **CSV / .ics export with scope "All"** calls `ensureAllSessions()`, which runs an unfiltered `sessions.get()` and loads the entire Working timetable into the Faculty browser (§3, finding F2).
3. **Faculty receive private fields.** Working `sessions` documents carry every co-teacher's `assignments[]`, including `ucid`, `doeRate`, `doeCredit` and `creditedHours`, plus `facultyIds`. P3 §11.11 says exact DOE figures and private Faculty identifiers must never reach Faculty (F3).
4. **The P3 branch is in a risky in-between state.** T7 rules now deny non-admin reads of Teaching-Assignment-owned `sessions`, but the Faculty clients still query `sessions`. Once any TA-owned session falls inside a Faculty query range, Firestore will likely reject the whole query and the Faculty timetable will show "could not be read". This needs emulator confirmation (F4).
5. **A new data path was added after P3.** On 2026-09-24, `main` gained an **Azure SQL session read API** (`GET /api/data/sessions`, `/api/v1/sessions`). It returns a Faculty member's own sessions straight from `paws.Session`, which has no Working/Published split. P3 does not cover it (F6).
6. **The plan leaves several paths unnamed.** T8 lists only `timetable.js`, `faculty-admin.js` and `timetable-publication.js`. Not named in T8 or T9: the AFC teaching check (`afc-workflow.js`), the Change Request session picker (`approval-workflow.js`), the shared page-data API consumers, the "All" export path, change history, and the Azure SQL routes (F5).

---

## 2. P3 target model (reference)

This summarises spec §11.6–§11.11 and plan T8/T9.

| Layer | Store | Faculty access (target) |
|---|---|---|
| Working source | `sessions` | **Denied** (§11.10) |
| Working projection | `calendar_sessions` | **Denied** (§11.10). It must not be repurposed as Published data (§11.6). |
| Published | `timetable_publications/{academicYearKey}.activeReleaseId` → `releases/{releaseId}/sessions/{sessionId}` (immutable, allowlisted) | **Allowed**: the complete *active* release only, with no inactive-release history (§11.10) |

The spec and plan also set these rules:
- Main Timetable may show the complete active release, and My Teaching filters that same release (§11.10).
- Faculty Dashboard self-mode "and other Faculty self-service surfaces" use Published data only (§11.10).
- If no release exists, Faculty see "Timetable has not yet been published" (§11.7).
- Missing or corrupt publication state fails closed, with **no Working fallback** (§11.11; plan T8 Step 5).
- Change Requests start from the Published view and carry `baseReleaseId` plus base-session evidence. The final apply fails closed when the base is stale (T9).

---

## 3. Data-path matrix

`main` @ `5ecbb39` unless stated. **P3 branch** shows the state at `6ce74ef`.

### 3.1 Primary Faculty surfaces

| # | Surface / trigger | Code (main) | Current source and query | What reaches the Faculty browser | Rule gate today | P3 target source | P3 branch status |
|---|---|---|---|---|---|---|---|
| 1 | **Main Timetable** (week/day/list views after sign-in) | `timetable.js:455` `subscribeSessions()` → `:227` `sessionQueryForRange()`; `:85` `sessionCollection()` returns `sessions` for Faculty | `sessions` where `date` in visible range **and** `facultyIds array-contains <own facultyId>` (live `onSnapshot`) | Full Working docs for **own** sessions only. Co-teachers' `assignments[]` (UCID, DOE credit) come along inside each doc. | `sessions` read: `privateReader()` (`firestore.rules:487`) | Active release `…/releases/{activeReleaseId}/sessions`. The complete release may be shown. | Unchanged client. Rules now deny TA-owned docs, which is a query-rejection risk (F4). |
| 2 | **My Teaching** button | `index.html:137`; `afc-timetable-panel.js:82` dispatches `ucvm:show-teaching` → `timetable.js:842` sets `myTimetableOnly=true` and the day view; `:894` filter uses `sessionBelongsToCurrentFaculty()` (`:725`) | Same `sessions` cache as #1; filtering happens client-side | Same as #1 | Same as #1 | The same active release, filtered to the Faculty member's own assignments | Unchanged |
| 3 | **Faculty Dashboard self-mode** (`faculty-admin.html` opened by `faculty`/`hicc`/`visc`) | `faculty-admin.js:90` `isSelfServiceProfile()` → `:94` `enterSelfMode()` → `:92` `loadSelfFaculty()` → `:10` `listenFacultySessions(id)` | `faculty/{ownFacultyId}` (get) + `sessions` where `facultyIds array-contains <id>` (live, **no date limit**) | Own Faculty record, plus every Working session they are assigned to, across all years | `faculty` get: `ownFacultyId()` (`:493`); `sessions`: `privateReader()` | Active release (Published only; §11.10) | Unchanged client; same query-rejection risk as #1 |
| 4 | **CSV / Calendar (.ics) export** (buttons visible to every signed-in role: `index.html:172–173`) | `timetable.js:1918` `openExportDialog()`; `:1932` scope "All" → `:479` `ensureAllSessions()`; "Date range"/"Academic" → `ensureSessionsForRange()` | **"All": `sessions.get()` with no filter at all.** The other two scopes use the #1 query. | **"All" loads the entire Working `sessions` collection into memory.** Output rows are filtered afterwards by My Timetable (`filteredSessions`, `:894`), but every document has already been delivered. | `privateReader()` permits the unfiltered list | Active release only | Unchanged (F2) |
| 5 | **AFC request, teaching-conflict check** (timetable panel) | `afc-workflow.js:8` `data()` = `UCVM_PAGE_DATA` in timetable mode; `:18`, `:30` call `ensureSessionsForRange(a,b)`; `:12` `matchingSessions()` filters by own IDs/names | `sessions` via #1's filtered range query | Own Working sessions in the AFC date range | `privateReader()` | Published (a "Faculty self-service surface", §11.10). **The empty-release behaviour is undefined** (see F7). | Unchanged |
| 6 | **AFC request, stored teaching snapshot** | `afc-workflow.js:31` writes `teachingSessions:[{id,date,start,end,course,topic}]` into `afc_requests/{id}`; read back by requester or report-to (`firestore.rules:672–673`, `afcRead`) | Copy taken from Working `sessions` (#5) at submit time | Own AFC records, including the frozen session list | `ready() && afcRead()` | Not stated. Presumably the snapshot is taken from the Published release, and existing records stay as history. | Unchanged |
| 7 | **Change Request, session picker and base snapshot** (Faculty are the only role that may create one: `validRoutedRequestCreate` → `facultyMember()`, `firestore.rules:49`) | `approval-workflow.js:146` `listenSessions()` reads `UCVM_PAGE_DATA.sessions()`; `approval-request.js:75` builds `basePublic` from the chosen session | Working `sessions` (the #1 cache) | Own sessions; own `change_requests` docs including `basePublic`/`patchPublic` (`approval-workflow.js:189–191`, `where requesterUid == uid`) | `change_requests` read: `routedRequestRead()`, requester branch (`:194`) | Published release view plus `baseReleaseId` and base-session evidence, with stale check on apply (T9) | Unchanged |
| 8 | **My Change History** (timetable panel and Dashboard History tab) | `afc-timetable-panel.js:59` and `faculty-admin.js:113` → `faculty-access.js:90` `logs()`; `:99` adds `where changedBy == uid` for non-admins | `session_change_log` (+ `faculty_change_log` on the Dashboard, + `account_audit`), own entries only, 20 per page | Log entries the Faculty member authored, holding Working before/after values. Ordinary Faculty cannot create session logs (`:656`, admin/office only), so in practice this is mostly account events. | `historyReader()` (`:11`) | **Not specified by P3** (F7). The spec says only "no inactive release history". | Unchanged |

### 3.2 Shared plumbing and direct collection access

| # | Path | Code (main) | Current behaviour | Faculty exposure | P3 target | P3 branch status |
|---|---|---|---|---|---|---|
| 9 | **Page-data API `window.UCVM_PAGE_DATA`** | `timetable.js:258–274` | Exposes `sessions()` (the #1 cache), `ensureSessionsForRange()`, and **`allSessions()` → `ensureAllSessions()` (unfiltered `sessions.get()`)** to every script on `index.html`. Consumers: `afc-workflow.js`, `approval-workflow.js`, `faculty-swap-safe.js`, `availability-lookup.js`, `asset-loader.js`. | `allSessions()` is callable from a Faculty session (the rules permit it). The only in-app Faculty caller is export (#4); the admin-only callers are listed in #11. | All Faculty-facing methods resolve to the active release, with **no Working fallback** (T8 Step 5) | Unchanged |
| 10 | **Direct `sessions` reads** | `firestore.rules:487` `allow read: if privateReader()` | Any active non-restricted user may `get`/`list` **every** Working session | Whole collection, including all `assignments[]` DOE and UCID fields (F3) | **Denied** to ordinary Faculty (§11.10; spec acceptance item 25) | Branch rule (`:767`): TA-owned docs readable only by `taAdmin() && taSessionRead()`; all other docs still `privateReader()`. **Faculty are not denied yet.** |
| 11 | **Unfiltered helper `ensureSessionsForDates()`** | `timetable.js:245` | `sessions where date in [...]`, with no Faculty filter | Not reachable by Faculty in the UI. Callers are the admin swap (`:627`), the office scoped editor (`:1113`), and bulk/maintenance flows (`:682, :1208, :1349, :1489`). Listed so the T8 rework does not overlook it. | Working, for authorised roles only | Unchanged |
| 12 | **Direct `calendar_sessions` reads** | `firestore.rules:477–478` `allow read: if ready()` | The Faculty client never queries it (`sessionCollection()` returns `sessions` for Faculty), but the rule lets any ready user list the whole sanitized Working projection | Whole projection (allowlisted fields: `calendar-session.js` `fromSource()`) | **Denied** to ordinary Faculty (§11.10) | Branch rule `taCalendarRead(id)` (`:756`): allowed unless TA-owned. **Faculty are not denied yet.** |
| 13 | **CCC overlay** ("Show CCC" checkbox, `index.html:117`) | `timetable.js:734` `loadCccEvents()` → `public_schedule/ccc_events` | One document of sanitized AFC CCC events, overlaid on the timetable | Readable by `privateReader()` (`:647`) | Not addressed by P3. It isn't session data, but it is shown on the Faculty timetable. | Unchanged |

### 3.3 Bootstrapped and alternate sources

| # | Path | Code (main) | Current behaviour | Faculty exposure | P3 target | P3 branch status |
|---|---|---|---|---|---|---|
| 14 | **Frontend Demo (GitHub Pages) bootstrapped data** | `tools/stage-github-pages.js:7–15` builds `pages-demo-data.js` from `tools/seed/dataset.js`; `tools/pages-demo-runtime.js` installs a browser-local fake Firestore | Seeded `sessions/*` (`dataset.js:283`, with full `assignments[]` incl. `doeCredit`) and `calendar_sessions/*` (`:310`), stored in `localStorage` | The demo Faculty persona gets the same code paths as #1–#9, **with no security rules enforced** (the fake store has no rules engine). Synthetic data only. The Lab staging job asserts the runtime is absent (`.github/workflows/firebase-lab-pages.yml:68`). | T12: add a sealed-release demo fixture plus a "no-release" Academic Year fixture | Not yet |
| 15 | **Azure SQL runtime bootstrap + session read API** (added to `main` 2026-09-24) | Loader: `tools/load_paws_azure_sql_empty.ps1`, `tools/bootstrap_paws_azure_runtime.ps1` (workbook → `paws.Session`). API: `server/src/routes/data-routes.js` `GET /api/data/sessions`, `/api/v1/sessions`; `server/src/data/sql-session-repository.js` reads `paws.vCalendarSession` (`database/azure-sql/002_calendar_view.sql`) | For `faculty`/`hicc`/`visc` the API adds `EXISTS SessionAssignment … LOWER(f.Email)=LOWER(@facultyEmail)` and returns own sessions in `start..end`. Other roles get all sessions. | Own sessions with course, topic, type, date/time, room and instructor names (no DOE). **No browser client on `main` calls this API yet.** | **Undefined.** P3 predates it, and the Azure cutover spec (`docs/superpowers/specs/2026-09-24-azure-sql-cutover-design.md`) has no Working/Published split. | Not present on the P3 branch |

HICC and VISC use the same #1–#8 paths for their normal calendar. P3 §11.10 moves that calendar to Published, while their Teaching Assignment tools keep separate, scoped Working queries (T8 Step 6).

---

## 4. Findings (reported, not fixed)

**F1. There is no Published source to switch to yet.** Neither `main` nor the P3 branch has `timetable_publications` rules, a release reader, or `timetable-publication.js`. Every row in §3 still reads Working data. The target sources in §3 describe the plan, not something that already exists.

**F2. The "All" export gives Faculty the whole Working timetable.** CSV/.ics export is visible to all roles (`index.html:172–173`; not hidden in `timetable.js:1874–1902`). Scope "All" calls `ensureAllSessions()` (`timetable.js:479`), which runs `sessions.get()` with no `facultyIds` limit. The rules permit it (`privateReader()`), and the My Timetable filter only runs after the data has arrived. `UCVM_PAGE_DATA.allSessions()` (`:269`) offers the same unfiltered read to any page script. T8's "no broad Working query + client-only filter" rule has to cover this path explicitly.

**F3. Faculty receive private fields inside Working documents.** Each `sessions` document embeds every co-teacher's `assignments[]` (`ucid`, `doeRate`, `doeCredit`, `creditedHours`; see `tools/seed/dataset.js:268–278`) and `facultyIds`. Through paths #1, #3 and #4, Faculty receive these for their own sessions today, and for all sessions through #4 and #10. P3 §11.11 lists exact DOE figures and private Faculty identifiers as never publishable. The branch rule comment (`firestore.rules:765–766`, P3 branch) acknowledges the problem.

**F4. The P3 branch could break the Faculty timetable before T8 lands** *(likely, needs emulator confirmation)*. On `6ce74ef`, `sessions` read is `taOwned(resource.data) ? (taAdmin() && taSessionRead(...)) : privateReader()`. The Faculty client still lists `sessions` (#1, #3, #4). Firestore rejects a *list* query if any document it could return fails the rule, and this rule depends on document fields the query doesn't constrain. So once any TA-owned session falls inside a Faculty range, the whole query will probably be denied and the timetable shows "The synchronized Firestore timetable could not be read" (`timetable.js:474`). This matters if T7 is merged or deployed before T8. The Faculty client already has the branch rules' allowed alternative (`calendar_sessions`) in `sessionCollection()`, but it doesn't use it for Faculty.

**F5. Plan coverage gaps.** T8 names `timetable.js` (#1, #2, #4, #9, #11) and `faculty-admin.js` (#3). T9 names `approval-request.js` (#7, base provenance). These paths are **not named** in T8 or T9:

| Path | File | Why it matters |
|---|---|---|
| #5 AFC teaching check | `afc-workflow.js` | Consumes `UCVM_PAGE_DATA`. It follows the timetable only if page-data is repointed, and it needs its own empty-release behaviour (F7). |
| #7 CR session picker | `approval-workflow.js` (`listenSessions`) | Chooses which session a request starts from, so it must pick from the release, not Working |
| #8 Change history | `faculty-access.js` `logs()` | Target not defined |
| #9 `allSessions()` | `timetable.js:269` | An unfiltered API surface |
| #12 `calendar_sessions` deny | `firestore.rules` | T7/T12 must add the Faculty deny; the branch hasn't yet |
| #15 Azure SQL API | `server/src/routes/data-routes.js`, `sql-session-repository.js` | Outside P3 entirely |

An earlier revision of the plan listed "Alternate Faculty surfaces — timetable, My Teaching, Faculty Dashboard self-mode and AFC/page-data integrations" as risk 8. The current plan text no longer mentions AFC or page-data.

**F6. The Azure SQL read path has no Published concept.** `paws.Session` / `paws.vCalendarSession` hold the current (Working-equivalent) timetable, and the API serves it to Faculty directly. If the Azure beta becomes the Faculty-facing runtime, P3's "Faculty see only the active sealed release" guarantee won't hold there unless the SQL schema gains a release model or the API is restricted. This is a scope decision for the project owner.

**F7. Behaviours the spec doesn't define.**
- **AFC when no release exists.** Today the AFC coverage requirement is triggered by finding teaching sessions (`afc-workflow.js:31`: "Coverage is required because teaching assignments were found"). If the Published source is empty ("not yet published"), the check finds nothing and lets a request through *without* coverage. Failing closed for the timetable view does not by itself make the AFC check fail closed.
- **Change history.** Whether `session_change_log` entries, which contain Working before/after values, remain visible to their Faculty authors after P3.
- **CCC overlay** (`public_schedule/ccc_events`) and **stored AFC snapshots** (`afc_requests.teachingSessions`): P3 doesn't say whether these stay as they are.

**F8. A dead Dashboard AFC branch (minor).** `afc-workflow.js:8` uses `window.UCVM_FACULTY_DATA` in non-timetable mode, but nothing on `main` defines it. In practice, AFC runs only from the timetable panel, which is worth knowing when T8 repoints the data sources.

---

## 5. Method

1. Fetched `origin` (read only) and created two detached worktrees, for `main` @ `5ecbb39` and for the P3 branch @ `6ce74ef`. I did not check out or write to either branch.
2. Listed every client-side Firestore collection access (`collection('…')` and the `*_COLLECTION` constants) and every session-bearing read: `sessions`, `calendar_sessions`, `session_change_log`, `public_schedule`, `afc_requests`, `change_requests`, and `settings/*` indexes.
3. Traced each read to the UI entry point and role gate that reaches it (`roleIsFaculty`, `facultySelfService`, `isSelfServiceProfile`, `UCVM.admin`), and dropped paths unreachable by Faculty (admin swap, office scoped editor, availability lookup, bulk import).
4. Checked each path against the matching `firestore.rules` read condition, to separate what the client *asks for* from what the rules *allow*.
5. Covered non-Firestore sources: the Pages demo seed, the Lab runtime, and the new Azure SQL server routes and loader.
6. Took each target source from spec §11.6–§11.11 and plan T8/T9. I compared the P3 branch's rules and Faculty client functions against `main` to fill in the "P3 branch status" column.

I ran no tests and no emulator. F4 is an inference from Firestore query semantics and needs emulator confirmation.
