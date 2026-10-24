# PAWS DOE/FTE, AFC, and Session Edit Completion

## Goal

Complete one compatible PAWS Beta milestone from main `340f599e13de98847b2e41a057be32517e79fee7`: show explicit administrator display labels, correct current-source copy, import authoritative 2026-27 DOE/FTE contract data, expose the UCVM Workload Guidelines as a versioned rule reference, reconcile the latest AFC snapshot without losing source history or entered purpose, add an administrator-only AFC multi-input workflow, and activate the existing SQL-backed scalar session edit path for administrators only.

## Architecture

Retain the existing internal role keys and server authorization model; map keys to display labels at presentation boundaries. Keep the current SQL/API business-data path and historical infrastructure references intact. DOE contract targets and allocations use the existing year-versioned target domain and migration 013 allocation table; assigned teaching and service-role records remain separate domains. Rules that cannot be applied without source semantics remain references and unresolved evidence instead of fabricated values.

DOE/FTE ingestion joins only by exact unique normalized UCID. A name difference becomes an audit warning. Numeric FTE values, including zero, are applied; blank values remain blank. The current owner-authorized source snapshot is reconciled idempotently with per-row validation, source provenance, and aggregate counts. AFC workbook refresh preserves the imported history domain and exact Purpose text; structurally invalid or ambiguous source rows are isolated. Manual AFC batches use the four source-facing fields, a 20-row maximum, server-side role checks, full validation before transaction, deterministic duplicate protection, and audit evidence. Session edits continue through Firebase authentication, University API role enforcement, `paws_api.UpdateCalendarSession`, VetMed-Ops, and AuditEvent with no Firestore fallback.

## Data and rule invariants

- UCID is the only DOE/FTE identity key. No UCID fuzzy matching; no name-only writes.
- FTE is separate from DOE. Blank does not mean zero or 1.0; numeric zero is preserved.
- DOE target/allocation upserts are year-scoped and idempotent, with stable source references rather than private source documents stored in SQL.
- Workload Guidelines provenance includes approval/effective/update dates and rule inputs, basis, value/tier, year/stage and policy version where applicable.
- Preserve the reviewed teaching, coordination, rotation, supervision, HICC and VISC rates. Do not infer the unresolved 91 teaching-assignment DOE rows, 64 ambiguous Course Coordinator/HICC rows, or 14 CCC rows without authoritative inputs. Do not derive Research, PPVM, or Service/Admin individual values from ranges or role labels.
- Latest AFC import keeps `paws.AfcRecord` distinct from manual AFC and workflow requests. Reconcile by deterministic Faculty identity plus dates and exact Purpose; preserve provenance and history. Do not fuzzy-match, silently discard anomalies, or guess a correction.
- Multi-input AFC accepts no more than 20 rows and preserves entered Purpose exactly. Validate every row and all duplicates before any transaction writes. Retrying a request must not create duplicates.
- Only established administrator keys may edit canonical session scalar fields. Faculty/HICC/VISC remains server-denied. Synthetic session residue is removed after acceptance; immutable audit evidence may remain.

## User-facing behavior

- Display `adfa_general` as **ADFAD Owner** and `adfa_regular` as **ADFAD Admin** without changing persisted keys.
- Current business-source copy identifies PAWS University API / VetMed-Ops. Preserve legitimate Azure hosting, rollback, resource and historical evidence.
- Faculty workload view separates FTE, contract DOE categories, assigned teaching DOE, service/role DOE, rule provenance and completeness; it does not present a blended total.
- Authorized administrators see truthful editable timetable status; Faculty/HICC/VISC see read-only status. Do not expose unsupported Firestore-backed create/bulk session controls.
- AFC multi-input mirrors `Faculty Member`, `Start`, `End`, `Purpose` with paste, row edit/remove, row status, validate/review and submit controls.

## Rollout and acceptance

Implement and verify locally on one feature branch from the exact accepted main. Inspect migration state before selecting a new migration number; never blindly re-run 012/013. Reconcile sources in dry-run mode, inspect anomaly and identity counts, then apply only deterministically validated DOE/FTE and AFC records using the already-authorized live-write scope. Verify aggregate counts and row-level representation. Test administrator session edit using one unmistakably synthetic UUID sentinel through the actual public API/UI, prove database mutation, AuditEvent, browser refresh, server-side Faculty denial and no Firestore write, then remove only the synthetic business row. Finish focused and release-level tests, diff/secret checks, PR/CI, normal Beta release and authenticated acceptance when each gate is satisfied.

Stop only for wrong-person write risk, unresolved source correction that would alter a real person's record, data-loss risk, a material security defect, or an unavailable external dependency with no safe alternative. Isolate the specific blocked rows or feature and continue independent work.
