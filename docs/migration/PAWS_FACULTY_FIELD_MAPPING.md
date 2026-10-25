# Faculty & Identity — Field Mapping

Inspected: 2026-10-25 · Project: `vista-teaching-lab` · Branch: `feat/paws-firestore-lab`

Sources compared:
- Firestore `faculty` collection (live, 14 documents, 34 fields each)
- Firestore `users` collection (live, 29 documents)
- SQL projection: `server/src/data/sql-dashboard-repository.js` `faculty()` (line 376)
- Frontend contract: `frontend/scripts/paws-data-client.js`
- Role policy: `server/src/auth/role-policy.js`
- Seed generator: `tools/seed/dataset.js`

---

## 1. The four identities are not interchangeable

| Identity | Lives in | Format observed | Used for |
|---|---|---|---|
| **Firebase Auth UID** | Firebase Auth; mirrored as the `users` document id | opaque, e.g. `xY3…` | login, session, audit actor |
| **User profile** | `users/{uid}` | one document per account | role, active, mustChangePassword, facultyId link |
| **Faculty ID** | `faculty` document id | synthetic, `fac-001` style | business key for teaching data |
| **UCID** | `faculty.ucid` | 8 digits | institutional employee number |

The SQL API uses a **UUID** as `FacultyId`. The lab uses `fac-001`. They are the
same *role* in the model but different *formats*. Nothing may treat them as
interchangeable, and no validation may be relaxed to let one pass as the other.

Resolution adopted:
- The Firestore repository uses the `faculty` document id as `facultyId` verbatim.
- It does **not** coerce, hash or re-format it.
- `users.facultyId` must equal a `faculty` document id. A link that resolves to
  nothing is a broken reference and is reported as such, never silently ignored.
- No SQL UUID is ever synthesised from a synthetic id, and vice versa.

---

## 2. Faculty list contract vs. Firestore

The SQL list returns 20 fields. Mapping to `faculty` documents:

| SQL field | Firestore source | Status |
|---|---|---|
| `facultyId` | document id | **present** |
| `preferredFirstName` | `firstName` | **present** |
| `preferredLastName` | `lastName` | **present** |
| `displayName` | derived: `lastName, firstName` | **derived** |
| `ucid` | `ucid` | **present** |
| `email` | `email` | **present** |
| `recordType` | — | **MISSING** |
| `stream` | — | **MISSING** |
| `rank` | `rank` | **present** |
| `fte` | `fte` | **present** |
| `reportsToFacultyId` | — | **MISSING** |
| `reportsToName` | — | **MISSING** (depends on above) |
| `active` | — | **MISSING — see §3** |
| `updatedAtUtc` | `updatedAt` | **present** (Firestore timestamp) |
| `teachingArea` | — | **MISSING** (SQL: `FacultyProfessionalProfile`) |
| `professionalCategory` | — | **MISSING** (SQL: `FacultyProfessionalProfile`) |
| `sessionCount` | derived from `sessions.facultyIds` | **derived** |
| `roleCount` | derived from role assignments | **derived — depends on §4** |
| `afcCount` | derived from `afc_requests` | **derived** |
| `jointAppointmentCount` | — | **MISSING** |

### Firestore fields with no SQL counterpart

`appointmentType`, `currentTitle`, `expiryDate`, `doe`, `doeTeaching`,
`contractTeachingDOE`, `teachingDOE`, `teachingDoeModel2026_27`,
`managedRoles2026_27`, `roleMigration2026_27`, `facultySummary2026_27`,
`workloadPolicy2026_27`, and their `…ImportedAt/By/Source` provenance fields.

These are lab-side working data. They are **not** invented SQL columns and must
not be presented as such.

---

## 3. `active` is missing from live Faculty documents — a real data gap

The SQL contract filters on `f.Active`, the frontend filters by
`status=active|inactive`, and `tools/seed/dataset.js` writes an `active` field.
**The 14 live `faculty` documents do not have it.**

This is not a mapping decision, it is missing data. Handling:

- The repository treats an **absent `active` as `false`**. Fail closed: a record
  whose employment status was never established must not appear as active staff.
- The list response reports `dataQuality.missingActive` with the count, so the
  condition is **visible** rather than silently turning the roster empty.
- `status=active` therefore returns only records that explicitly say active.
  This is correct behaviour on incomplete data, and the count tells the operator
  why the roster looks short.
- Remediation is a seed/repair task, recorded as a blocker, not a code change.

---

## 4. `managedRoles2026_27` is not an appointment

The lab stores `managedRoles2026_27` on the faculty document. It is a denormalised
array carried over from the Firestore-era UI. It is **not** a role assignment
record and must not be promoted into one.

Reasons it cannot serve as the appointment model:
- it has no stable assignment id, so it cannot be addressed, versioned or audited
- it carries no effective/expiration window, so validity cannot be computed
- it is keyed to one academic year in its own field name
- it cannot express multiple concurrent periods

Therefore §5 introduces a separate `role_assignments` collection, and
`managedRoles2026_27` is left in place, read-only, as legacy display data.

---

## 5. Account role vs. academic responsibility

| Concept | Where | Meaning |
|---|---|---|
| Account role | `users.role` → `baseRole` | **permission**: what the account may do (developer, adfa_regular, faculty, hicc, visc, …) |
| Teaching responsibility | `role_assignments` | **business**: who is responsible for a course/subject/rotation, for which period |

They share the word "role" and nothing else. An account with role `faculty` has no
responsibility until a `role_assignments` document says so, and a responsibility
confers no permission.

---

## 6. Proposed role assignment schema

Collection `role_assignments`, document id = stable assignment id (UUID).

```
facultyId        string   required, must resolve to a faculty document
academicYear     string   required, canonical 2026-27
roleType         string   required, e.g. HICC, VISC, ADC, LAB
scopeKind        string   'course' | 'subject' | 'rotation' | 'none'
scopeCode        string   course code / subject / rotation, empty when scopeKind=none
effectiveDate    string   ISO day, inclusive
expirationDate   string   ISO day, exclusive; empty means open-ended
revision         number   optimistic concurrency token, starts at 1
createdAtUtc     timestamp
updatedAtUtc     timestamp
```

Derived, never stored: `active` / `upcoming` / `expired` / `inactive`, computed
from the effective window and the current date so a stored value can never
disagree with the dates.

Audit: append-only `role_assignment_audit` documents, one per accepted write,
carrying the actor, the revision produced, and the before/after field values that
changed. Nothing is ever updated or deleted in the audit collection.

---

## 7. Privacy classification of Faculty fields

| Class | Fields | Rule |
|---|---|---|
| Public directory | `displayName`, `rank`, role type, course/subject scope, effective dates, status | may appear in HICC-CC / VISC directories |
| Self or administrator | `email`, `ucid`, `fte`, `expiryDate`, `appointmentType` | never in a public directory |
| Administrator only | `doe*`, `contractTeachingDOE`, `workloadPolicy*`, `facultySummary*` | administrative views only |

`facultySummary2026_27` and `workloadPolicy2026_27` are maps whose contents were
not inspected field by field; they are treated as administrator-only until proven
otherwise.

---

## 8. Referential integrity rules

- `users.facultyId` → `faculty` document id. Dangling links are reported by
  `findByUid` as `FACULTY_LINK_INVALID`, not silently treated as "no faculty".
- `sessions.facultyIds[]` → `faculty` document ids. Unresolvable entries are
  counted, not dropped.
- `role_assignments.facultyId` → `faculty` document id, validated inside the
  write transaction.
- Deactivation never deletes. It sets `active: false` and appends an audit record,
  so historical references keep resolving.

---

## 9. What this document does not resolve

- `recordType`, `stream`, `reportsTo*`, `teachingArea`, `professionalCategory`,
  `jointAppointmentCount` have no source in the lab. They are reported as
  unavailable rather than fabricated. Adding them is a seed/import task against
  an authoritative source.
- Whether `expiryDate` implies employment status. It is a date with no documented
  semantics here, so it is **not** used to infer `active`.

---

# Corrections after review (commit series starting `fc903d8`)

## Detail contract is structured, not flat

`facultyById()` previously returned a flat row. The SQL contract
(`sql-dashboard-repository.js:815`) returns:

```
{ faculty, academicYear, professionalProfile, jointAppointments,
  roles, afcRecords, contractDoe }
```

The Firestore implementation now returns the same top-level shape. Sections with
no source are `null` **and** listed in `unavailable`, so a consumer can tell
"unavailable" from "this person genuinely has none". An empty array would have
been indistinguishable from a real empty result and is not used.

Currently unavailable: `professionalProfile`, `jointAppointments`, `roles`,
`afcRecords`, `contractDoe`.

## Counting rules

| Count | Source | Rule |
|---|---|---|
| `sessionCount` | `sessions.facultyIds[]` | only sessions whose `date` falls in the requested academic year (1 May – 30 April), matching SQL `c.AcademicYear = @academicYear` |
| `roleCount` | `role_assignments.facultyId` | singular field, equality |
| `afcCount` | `afc_requests.facultyId` | singular field, equality |

The earlier revision used `array-contains` against `facultyIds` for AFC and roles.
Neither collection has that field, so those counts were silently always zero.

A failed count query returns `null` and is named in
`dataQuality.countFailures` with the code `COUNT_QUERY_FAILED`. A zero is a claim
about the data; a failed query makes no claim. The earlier behaviour of returning
0 was fabricating a fact.

Counting is three collection reads per request, not three per faculty. At the
reference scale of roughly 1,900 sessions the previous N+1 approach meant about
6,000 reads for a 200-row page.

## Employment status is three-valued

| `status` | Meaning |
|---|---|
| `active` | `active === true` |
| `inactive` | `active === false` |
| `unknown` | field absent or not a boolean |

`unknown` is **not** folded into `inactive`. The list filter vocabulary stays
`active` / `inactive` / `all` because that is the existing API contract; the third
state is exposed per row via `status` and in aggregate via
`dataQuality.missingActive`, which is enumerable so it survives JSON
serialisation and can be displayed.

## FTE unit contract

FTE is a **fraction of one full-time equivalent**: `1` is full time, `0.8` is four
days. This matches SQL `Fte decimal(6,4)` and the seed generator, which writes `1`
and `0.8`.

Percentages are **not** the contract. A value of `100` is not "100 percent" and is
not scaled; it is an invalid value. Tests that used `100` / `60` were wrong and
have been corrected.

## Identifier validation

Each backend validates against its own identifier contract:

| Backend | Faculty id format |
|---|---|
| SQL | UUID (`8-4-4-4-12` hex) |
| Firestore | document id, `[A-Za-z0-9][A-Za-z0-9_-]{1,62}`, no `..` |

Neither validator is loosened to accept the other's format. The Firestore
repository never coerces a document id into a UUID.

## Still unresolved

- Faculty write operations (`updateFaculty`, `deactivateFaculty`,
  `restoreFaculty`) remain unimplemented and return 501. They need the SQL
  `expectedUpdatedAtUtc` / `expectedProfileVersion` contract translated into a
  genuine Firestore revision precondition, plus an append-only audit design.
  No integer revision is presented as a SQL rowversion.
- `role_assignments` is read for counting only. The collection has no writer yet.
- Date boundary semantics for role periods are **not** yet implemented, so the
  inclusive-versus-exclusive question is unresolved rather than decided.
- Firestore rules still allow a Faculty account to read its whole `faculty`
  document, which contradicts the administrator-only classification of DOE and
  workload policy data in §7. This is a live contradiction and is not fixed.

---

# Role assignments — date semantics resolved

The earlier draft of this document proposed an **exclusive** `expirationDate`. That
was wrong and is withdrawn.

`server/src/roles/role-effective-status.js` is authoritative — it is the server
counterpart of the Faculty Dashboard's `faculty-role-periods.js`, and
`tests/leadership-directory-view.test.js` runs both over the same cases. Its
header states the rule directly:

> `startDate` and `endDate` are **inclusive** Calgary dates; a null `endDate` is
> open-ended.

So the contract is:

| Date | Status |
|---|---|
| day before `startDate` | `upcoming` |
| `startDate` | `active` |
| `endDate` | **`active`** — the last day counts |
| day after `endDate` | `inactive` |
| between two periods | `inactive`, with `nextStartDate` |
| no `startDate` at all | `dates-needed` |

Statuses are `active`, `upcoming`, `inactive`, `dates-needed`. Status is **derived
on read** from the periods and an as-of date in `America/Edmonton`; it is never
stored, because a stored status is a second source of truth that drifts the moment
a date passes.

## Schema as implemented

Collection `role_assignments`:

```
facultyId      string   required, validated inside the transaction
academicYear   string
roleCategory   string
roleType       string   HICC / VISC / ADC / LAB …
scopeKind      'course' | 'subject' | 'rotation' | 'none'
scopeCode      string
periods        array of { startDate, endDate }   inclusive; endDate null = open
revision       number   optimistic concurrency token, starts at 1
createdAtUtc / updatedAtUtc / createdBy / updatedBy
```

Audit collection `role_assignment_audit`, append-only, one document per accepted
write carrying `action`, `revision`, actor, timestamp and the before/after
documents.

## The four concepts stay separate

| Concept | Where it lives |
|---|---|
| Account permission role | `users.role` → `baseRole` |
| Role assignment / appointment | `role_assignments` |
| Stable teaching responsibility | the assignment's `roleType` + scope |
| Temporal responsibility assignee | the assignment's `facultyId` + periods |

They are not merged into one collection. An account with role `faculty` has no
responsibility until an assignment says so, and an assignment confers no
permission.

## Still not implemented

- No HTTP surface yet for role assignments: the repository exists and is tested,
  but no route is mounted and no operation is listed in `IMPLEMENTED_OPERATIONS`.
- HICC-CC and VISC directory projections are not built.
- Faculty writes (`updateFaculty`, `deactivateFaculty`, `restoreFaculty`) remain
  501.
- The Firestore rules contradiction over administrator-only fields is unfixed.
