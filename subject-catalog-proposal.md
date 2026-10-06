# Subject Catalog Proposal

**PAWS support task 7.** This is a **proposal only**. The data rows are in `subject-catalog-proposal.csv`; this note explains them.

| | |
|---|---|
| Sources read | `origin/feature/scoped-parallel-assignment-workflow` @ `6ce74ef` (P3, where the Subject catalog lives) and `origin/main` @ `7eb209f` |
| Key grammar followed | `subject-catalog.js` on the P3 branch: `^[a-z][a-z0-9_-]{0,63}$` (lowercase, starts with a letter; `-`/`_` allowed; no spaces). Labels non-blank, ≤ 100 characters. |
| Changes made | None. The Subject model, `teaching_subjects` rules, Firestore data, seed data and DOE mappings were not modified. |

## Main caveat: the repo contains no real course catalogue

Every course, Subject and Topic in the repository comes from one of these:

- **P3 spec/plan examples** (e.g. `VTMD 506 / Surgery`, `VTMD 505` + `surgery` + "Pre-operative Management")
- **Test fixtures** (e.g. Bovine Medicine/Surgery HICC on `VTMD 506`; course `505` "Clinical Skills III" with LAB "Suturing")
- **The synthetic demo seed** (`tools/seed/dataset.js`: `VETM 301–503` with generic topics assigned *at random* across courses)
- **DOE mapping fixtures** (VISC `anatomy`)

The real data lives outside the repo. The Azure SQL docs mention a *Workload / Courses* workbook with **43 courses**, plus the live Firestore sessions, and neither is available here. I didn't read live Firestore.

So no row can be confirmed against real data. Confidence reflects how consistently the repo's own spec and fixtures agree, **not** real-world correctness.

## Confidence scale

| Level | Meaning |
|---|---|
| **High** | Stated explicitly in the P3 spec *and* used consistently in the plan and tests |
| **Medium** | Spec-stated pairing with no topics, **or** consistent across several fixtures but not spec-confirmed, **or** has a conflicting fixture |
| **Low** | A single occurrence, inferred from a topic or group name, or synthetic demo data |
| **Not recommended** | Exists only as a negative test case or placeholder |

## Proposal at a glance

| Course | Subject Key | Display Label | Example Topics | Confidence |
|---|---|---|---|---|
| VTMD 506 | `surgery` | Surgery | Suturing | **High** |
| VTMD 506 | `anesthesia` | Anesthesia | none in data | Medium |
| VTMD 506 | `medicine` | Medicine | none in data | Medium |
| VTMD 505 | `surgery` | Surgery | Pre-operative Management; Surgery basics; Pre-Op Lab; Suturing | Medium (conflict, see below) |
| VTMD 521 | `surgery` | Surgery | none in data | Low |
| VTMD 507 | `surgery` | Surgery | none in data | Low |
| course not stated | `anatomy` | Anatomy | none in data | Medium (subject) / course unknown |
| course not stated | `pharmacology` | Pharmacology | none in data | Low |
| 601 | `neurology` | Neurology | Neuro | Low |
| VTMD 505, VTMD 204, VTMD 507, VTMD 590 | *(course-wide, no Subject needed)* | n/a | VTMD 204: Passports | Medium / Low |
| VETM 301–503 (demo seed) | `anatomy`, `physiology`, `clinical-skills`, `small-animal-medicine`, `surgery`, `diagnostic-imaging`, `anesthesia` | as named | random seed topics | Low (synthetic only) |

The CSV adds an evidence column (file and line) and notes for every row, plus three "not recommended" keys: `surgery-core`, `small animal` and test placeholders.

**Resulting distinct Subject keys** (if every Medium-or-better row were accepted): `surgery`, `anesthesia`, `medicine`, `anatomy`. That's 4 keys. Adding the Low rows would bring in `pharmacology` and `neurology`; the demo-only keys shouldn't go into a real catalogue.

## Things to resolve before creating any Subject records

1. **Course code format is inconsistent.** Many fixtures use bare codes (`505`, `204`, `301`, `601`), while HICC scope and `taExactScope` require `^[A-Z]{2,10} [0-9]{3,4}[A-Z]?$` (e.g. `VTMD 505`). Sessions with bare codes can never match a HICC Course/Subject scope, so the real session data should be checked for this first.
2. **Course 505 has two identities.** Fixtures call it both "Surgery" and "Clinical Skills III", and the spec uses `VTMD 505` as a *course-wide* example. Real data should decide whether 505 needs Subjects at all.
3. **Spelling.** Choose `Anesthesia` vs `Anaesthesia` for the label. The key `anesthesia` is used in the spec and plan.
4. **Relationship to DOE subject mappings.** `anatomy` comes from the DOE VISC subject-mapping fixtures. The spec keeps the Teaching Subject catalog separate from DOE mappings, so reusing the same key is a convenience and not a requirement.
5. **Topics never authorize anything.** Example topics are illustrative only (spec §6.2: "Topic text is never authorization evidence").

## How to get to a real proposal

Running the same method on the real *Workload / Courses* list (43 courses) and an export of current session course/topic pairs would let most rows reach Medium or High with real topics. If you can attach those files, I can regenerate this proposal from them, again without writing anything to Firestore.
