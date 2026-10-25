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
