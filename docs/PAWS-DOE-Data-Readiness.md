# PAWS DOE Data Readiness

> **Historical Beta snapshot (2026-10-04).** These row counts, missing-policy claims and source readings cannot be relied upon for current Faculty DOE. Reconcile the current MASTER and live Beta from authorized sources. The Testing Demo contains synthetic data only.

**Environment:** live Beta `VetMed-Ops`
**Academic year:** `2026-27`
**Audit date:** 2026-10-04

## Current authoritative storage

- Active Faculty rows: **120**.
- `DoePolicyVersion`: **0** rows.
- `DoeFacultyTarget`: **0** rows; contract-target coverage is **0/120**.
- `DoeRuleSeed`: **24** legacy seed rows; 23 contain a rate/tier value, and all 24 have the source authority-indicator and source-link fields populated. These are retained source-seed metadata, not an approved effective policy/version or a demonstrated mapping to each current assignment. They are not applied automatically.
- `SessionAssignment`: **4,970** rows. In 2026–27, **91** assignments lack DOE credit, rate, or unit: **26 OSCE** and **65 Quiz/Midterm**. All 91 have a null `TeachingRole`, so neither the assignment role nor a per-assignment DOE rate can be determined from the current assignment record.
- `RoleAssignment`: **162** rows. **78** have neither `DoeMappedValue` nor `DoeOverrideValue`: **64** `Course Coordinator / HICC (legacy ambiguous)` and **14** `CCC`. All 162 lack `RoleCategory`, `EffectiveDate`, and `ExpirationDate`.
- Active Faculty FTE is null for **108/120**. No contract teaching target is calculated from FTE in the browser or from a guessed global percentage.

## What can be derived safely now

- Stored assignment and role DOE values may be displayed as stored evidence.
- Missing-value counts and academic-year/session timing classifications may be reported.
- Source rows can be imported without calculation into a versioned staging/seed table, preserving source row, source file/link, and import batch.
- Nothing in the current reviewed data uniquely determines the 120 individual Contract Teaching DOE targets.
- The 91 teaching-assignment gaps cannot be filled from the session type alone.
- The 78 missing role values cannot be filled from the role label alone. The legacy HICC label is explicitly ambiguous; `CCC` has no approved effective value in the target table.
- The 24 DOE rule seeds do not provide a reviewed active policy-version-to-current-assignment mapping. Their presence does not authorize applying the rates to live records.

No DOE values were changed. No stored rates were inferred from the legacy client-side role-rate table.

## Authoritative data required

### Individual contract teaching targets

Provide, for every in-scope faculty member and academic year:

- stable `FacultyId` or a resolvable canonical Faculty identity;
- `AcademicYear`;
- `ContractTeachingDoe`;
- source document/reference and effective date;
- approved policy/version identifier and version label.

For explicit deviations, also provide `OverrideDoe`, `OverrideReason`, and `OverrideNotes`. Do not use a null FTE as a substitute for an approved target.

### Role mapping and temporal applicability

Provide a versioned mapping with:

- `RoleType` and scope (course/subject/academic year where applicable);
- effective and expiration dates;
- mapped DOE, including an explicit numeric zero where that is the approved value;
- authoritative source/reference and policy version;
- an explicit override value/reason where required.

Clarify whether the 64 legacy `Course Coordinator / HICC` rows represent HICC, course coordination, or separate concepts before mapping them. Provide the approved DOE source for the 14 CCC rows. Supply effective and expiration dates for each role assignment; current coverage is **0/162** complete role windows.

## Recommended target import contract

| Field | Requirement |
|---|---|
| `FacultyId` | Required; resolve against canonical Faculty before import. |
| `AcademicYear` | Required canonical `YYYY-YY`. |
| `ContractTeachingDoe` | Required approved target; preserve numeric zero. |
| `Source` | Required source document/reference. |
| `PolicyVersionId` or `VersionLabel` | Required; resolve to an approved `DoePolicyVersion`. |
| `OverrideDoe` | Optional explicit override. |
| `OverrideReason` / `OverrideNotes` | Required when an override is present. |

Loading approved rows into `DoeFacultyTarget` under an approved `DoePolicyVersion` is the data change that enables complete faculty-target reporting. Until then, the UI must continue to show target DOE as unavailable rather than manufacturing a value.

## Change record

The approved sanitized 2026–27 DOE workbook passed local structural validation: **115** source rows and **0** numeric/total validation errors. A server-side read-only reconciliation against the current live Faculty roster found **0** exact active identity matches, **0** exact inactive matches, **112** exact-UCID rows whose FullName did not match the stored Faculty display name, and **3** source UCIDs with no Faculty row. Database UCID duplicates: **0**. Name checks were aggregate-only; no names or UCIDs were emitted.

The import was not applied. The identity conflicts exceed the approved zero-conflict gate, and no field was remapped or name normalization guessed. `DoePolicyVersion`, `DoeFacultyTarget`, and `DoeFacultyAllocation` contain **0** rows. The empty versioned allocation table was installed so the runtime can read the normalized DOE surface; its guarded rollback refuses to drop the table if any allocation row is later inserted. The importer remains blocked until the authoritative source identity discrepancies are resolved.
