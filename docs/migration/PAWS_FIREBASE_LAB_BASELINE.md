# PAWS Firebase Lab — Baseline Inspection

Inspected: 2026-10-25
Project: **`vista-teaching-lab`** (verified, not assumed)
Repository HEAD at inspection: `cc7cd33` (post-#89 merge)

---

## 1. Live environment — what actually exists

Verified with the Firebase CLI (14.27.0, authenticated) rather than assumed from
the repository.

| Item | Finding |
|---|---|
| Authenticated projects | `vista-teaching-lab`, `tester-teaching`, `paws-testing-ucvm-20261022` |
| Firestore | `projects/vista-teaching-lab/databases/(default)` exists |
| Hosting site | `vista-teaching-lab` → https://vista-teaching-lab.web.app |
| Web app | `VISTA Web` — `1:718796027246:web:94570662a715dde67bfd7f` |
| Cloud Functions / Run | **Not usable.** `testIamPermissions` for `cloudfunctions.functions.list` and `run.services.list` returns an empty granted set, so no server runtime can be deployed here. |

**Consequence:** Firebase Hosting in this project is static-only. The PAWS API
cannot be a Firebase Function. It must run on a separate Node runtime, with
`apiOrigin` configured to point at it — the repository already has SWA and ACA
workflows for that. No billing upgrade was attempted.

---

## 2. Firestore inventory

21 root collections, read-only inspection:

| Collection | Docs | Collection | Docs |
|---|---|---|---|
| `sessions` | 84 | `calendar_sessions` | 84 |
| `users` | 29 | `faculty` | 14 |
| `settings` | 7 | `change_request_approvals` | 6 |
| `change_request_audit` | 4 | `afc_audit` | 3 |
| `afc_requests` | 3 | `change_requests` | 3 |
| `change_request_private` | 3 | `change_request_workflow` | 3 |
| `faculty_groups` | 2 | `account_audit` | 1 |
| `audit_events` | 1 | `bulk_import_jobs` | 1 |
| `faculty_change_log` | 1 | `public_info` | 1 |
| `public_schedule` | 1 | `session_change_log` | 1 |
| `workflow_notifications` | 1 | | |

This is far below the reference scale (≈120 faculty, ≈1,937 sessions, ≈4,970
assignments, ≈791 AFC records). The dataset is **not** sufficient for acceptance
testing and must be rebuilt.

---

## 3. Privacy audit — counts only, no values printed

Method: schema inspection plus email-domain classification across `faculty`,
`users`, `sessions`, `afc_requests`, `calendar_sessions`. A regex-only scan was
not relied on.

| Collection | Docs | Has name | Has email | Email domains found |
|---|---|---|---|---|
| `faculty` | 14 | 14 | 14 | `example.test` = 14 |
| `users` | 29 | 29 | 29 | `example.test` = 28, **`ucalgary.ca` = 1** |
| `sessions` | 84 | — | — | none |
| `afc_requests` | 3 | — | — | none |

**Findings requiring action**

1. **One `users` document carries a real institutional email domain
   (`ucalgary.ca`).** It must be replaced with a synthetic identity. Its values
   were deliberately not read into any log or report.
2. `afc_requests` carries `applicantSignature`, `adminSignature`,
   `contactAddress`, `purposeDestination` and `reportsTo`. Signatures and contact
   addresses are personal data even when the surrounding record is synthetic;
   these fields need inspection and replacement before the lab is treated as
   privacy-safe.
3. `sessions.topic`, `sessions.instructorNames` and `calendar_sessions.instructor`
   are free text that can embed personal names. They require a content check
   before any of it is preserved.
4. `faculty` uses synthetic emails but its identifiers do not follow the intended
   `9000xxxx` synthetic pattern, so there is no positive evidence that the UCIDs
   and faculty ids are synthetic rather than real values re-domained.

**Not yet privacy-safe.** The lab currently fails the "zero known real-person
data" bar.

---

## 4. Frontend defects — fixed in this change

| Defect | Status |
|---|---|
| Five scripts carried their own Firebase config pointing at `tester-teaching` | Fixed — one `paws-runtime-config.js` |
| Committed Cloudflare Tunnel API origin | Fixed — empty origin means same-origin |
| `ucalgary.ca` sign-in pre-check rejecting synthetic accounts | Fixed — `example.test` |
| No script ordering guarantee for the config | Fixed — loaded first on all five pages |

Pinned by `server/test/lab-runtime-config.test.js` (7 assertions).

---

## 5. Backend scope — the honest assessment

The API surface is large:

- **34 modules** in `server/src/data/`, exposing roughly **60 repository methods**.
- **156 methods** on `frontend/scripts/paws-data-client.js` across dozens of
  `/api/v1/*` endpoints.
- **119 SQL migrations** whose behaviour lives partly in stored procedures.

The ported repositories are SQL-shaped: they call `db.query(text, params)` and
`db.transaction(fn)`. A Firestore adapter cannot satisfy that contract by
interpreting SQL text — each repository needs a genuine Firestore implementation
of its semantic methods, preserving transactions, revision preconditions,
idempotency keys, append-only audit and publication immutability.

That is a multi-week build, not a single change. Proposing to "finish" it in one
pass would mean shipping a shallow mock that reports success while persisting
nothing — precisely what the brief forbids.

**Recommended order**, each step independently verifiable:

1. Provider seam: `PAWS_DATA_BACKEND`, composition switched by injection, SQL
   repositories untouched. *(small, unblocks everything else)*
2. Vertical slice: calendar session read path on Firestore, end to end through
   the real API, verified in the browser.
3. Faculty and identity, because every other domain resolves an actor through it.
4. Teaching Assignment workflow, the most revision-sensitive domain.
5. DOE, AFC, SWAP, history, trainees.
6. Seed generator at reference scale, then the privacy audit re-run.
7. Publication switch and lab deployment.

---

## 6. Blockers, stated precisely

| Blocker | Effect |
|---|---|
| No Cloud Functions / Cloud Run permission, and no billing upgrade attempted | The API cannot run inside Firebase. It needs a separate Node runtime. |
| No service-account key available locally | Firebase Admin operations (creating Auth test accounts, privileged seeding) cannot be executed from this environment. Firestore REST access works through the CLI's own credential. |
| No Azure deployment credential verified | The API runtime cannot be deployed from here either. |
| Reference-scale course data not available | Course codes and titles must be preserved where legitimate; without the source workbook, supplemental sessions can only be synthetic. |

None of these was worked around by pretending a step succeeded.

---

## 7. Firestore backend status (commit `264a6d4`)

`PAWS_DATA_BACKEND=firestore` builds every repository from Firestore. Nothing
falls back to SQL: a domain without a Firestore implementation is a refusing
proxy, and the route reports it as **HTTP 501 `BACKEND_OPERATION_UNSUPPORTED`**,
not 503.

### Implemented (2 of 26)

| Repository | Operations |
|---|---|
| `sessions` | `list`, `getById` — mapped to the exact SQL row shape |
| `users` | `findByUid` |

### Returns 501 under Firestore (24)

`afcApproval` `afcArtifact` `afcForm` `afcRequest` `afcWrite` `calendarActivity`
`cccReplacement` `cccSchedule` `changeHistory` `dashboard` `doeAssignment`
`doeEngine` `doePolicy` `doeTarget` `doeTargetOverride` `doeWorksheet`
`facultyAdmin` `facultyAvailability` `leadershipDirectory` `manualDoe`
`schedulingTask` `swap` `teachingAssignmentWorkflow` `trainee`

### Deliberately refusing writes

| Operation | Why |
|---|---|
| `sessions.updateExisting` / `createNew` / `createBatch` / `replaceAssignments` | The SQL versions delegate to stored procedures that own audit, revision checks and assignment history. Reporting success before that exists would be a lie. |
| `users.provision` | The SQL path is a read-then-insert on first sign-in, which is how an unknown account acquires a role by simply signing in. Lab profiles are seeded; unknown uids get 403 `PROFILE_NOT_PROVISIONED`. |

### Academic-year boundary — resolved

May, not September. `019_session_create_and_assignment_api.sql:83-84` rejects a
date outside `DATEFROMPARTS(year,5,1) .. DATEFROMPARTS(year+1,5,1)`, and both
`053_ccc_master_slots.sql` and `master-source-domain.js` use `MONTH < 5`.

### Not yet started

Faculty and identity beyond `findByUid`, roles and appointments, and the
reference-scale seed. The lab also still contains the institutional email and
unverified faculty identifiers recorded in §3, so the faculty interfaces must not
be published before that data is replaced.
