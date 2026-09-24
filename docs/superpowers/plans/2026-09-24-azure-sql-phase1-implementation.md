# PAWS Azure SQL Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the Phase 1 clean-rebuild migration path that turns the three approved private workbooks into a complete raw staging import plus normalized `paws.*` Azure SQL foundation, without using Firestore and without changing the shipped PAWS frontend runtime.

**Architecture:** Python/OpenPyXL builds a deterministic private import package from the three workbooks. A reviewed Azure SQL DDL creates the `staging` and `paws` schemas, while a PowerShell importer uses Microsoft Entra device authentication, verifies an exact preflight object-inventory hash, performs the reset/schema/load/verification inside one SQL transaction where supported, and fails closed on any invariant mismatch. Private workbooks and generated packages stay outside Git.

**Tech Stack:** Python 3.11+, openpyxl 3.1.5, Python unittest, PowerShell 7/Windows PowerShell compatible SQL client code, Azure SQL Database, Microsoft Entra device authentication, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-24-azure-sql-cutover-design.md`


## 2026-09-24 execution amendment

This amendment supersedes the original Task 4 / Task 7 combined reset-and-import Apply path below:

- the reviewed 18-object reset was completed separately with `tools/reset_paws_azure_sql_exact.ps1`;
- the independent post-reset planner verified `objectCount = 0` and inventory SHA-256 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`;
- the broad `tools/import_paws_azure_sql.ps1` described later in this historical plan was not shipped;
- the current Apply path is the non-destructive, empty-database-only `tools/load_paws_azure_sql_empty.ps1`, which refuses any non-empty inventory and loads schema/data in one transaction;
- `Zachar, Erin` is confirmed former Faculty: 4 Teaching Assignment and 4 AFC source rows remain in staging/validation evidence but are excluded from canonical business rows;
- canonical `paws.SessionAssignment` count is therefore 4,970, while typed/raw Teaching Assignment count remains 4,974.


## Global Constraints

- The three 2026-09-24 workbooks are the sole authoritative initialization source; do not compare against or backfill from Firestore.
- Every real Faculty canonical name comes from `Preferred FULL Name (Last, First)` in the Faculty Master and is rendered everywhere in PAWS as `First, Last`; HR/source names may assist deterministic matching only and must never become the canonical display name.
- Every non-empty row from every workbook sheet must be represented in generic raw staging evidence.
- Invalid or unresolved rows must be preserved and reported; no fuzzy Faculty identity match may create an authoritative relationship.
- The Azure reset is limited to the `teaching-assignment-lab` database and must never delete the logical SQL Server, subscription/resource group, Entra administrator, server firewall/network settings, system databases, system schemas, or SQL security principals.
- Existing PAWS application/mirror data must not survive a successful clean rebuild, including legacy `dbo.FirestoreDocument` and `dbo.FirestoreImportRun`.
- The application runtime receives no permission on `staging.*`.
- Phase 1 changes migration tooling, DDL, tests, and documentation only; it must not switch the Azure frontend from Firestore or move the frozen runtime baseline.
- No private workbook, generated raw package, database token, password, or Azure access token may be committed.
- The real destructive Azure apply is a separate security-sensitive/destructive gate after the read-only inventory plan has been reviewed.

## Review Focus

1. **Workbook sparsity/formulas:** blank trailing rows, helper sheets, duplicate-looking lookup sheets, formula cells and array formulas must not disappear from raw staging just because they are not business-source rows. Task 1 tests a sparse/formula workbook and verifies generic raw row preservation.
2. **Date/time normalization:** Excel datetime/time objects and text values must normalize deterministically without converting unknown times to midnight. Task 1 tests date/time serialization and Task 2 tests canonical Session keys.
3. **Identity ambiguity and display drift:** surname variants, accents and multi-surname forms may resolve only through exact Master fields, a unique HR crosswalk, or an explicit alias map; an unknown person must remain unresolved, and every resolved result must display the Faculty Master Preferred Name as `First, Last`. Task 2 tests crosswalks, aliases, an unknown source name, and canonical display formatting.
4. **Session grouping/multiplicity:** multiple Faculty rows for one teaching event must produce one Session and multiple SessionAssignment rows, with no assignment loss. Task 2 pins the grouping key and multiplicity.
5. **Destructive reset safety:** wrong database name, changed object inventory, missing typed confirmation, or a package whose hashes/counts do not match must fail before destructive SQL. Task 4 tests the PowerShell/SQL contract statically; the Azure integration run must prove each guard before Apply.

---

### Task 1: Deterministic private workbook package and raw-row preservation

**Files:**
- Modify: `.gitignore`
- Create: `tools/requirements-azure-sql-migration.txt`
- Create: `tools/azure_sql_migration/__init__.py`
- Create: `tools/azure_sql_migration/workbooks.py`
- Create: `tools/azure_sql_migration/package.py`
- Create: `tools/build_azure_sql_import.py`
- Create: `tests/python/test_azure_sql_workbook_package.py`

**Interfaces:**
- Consumes: three workbook paths supplied explicitly on the CLI.
- Produces: a directory in `azure-sql-import-private/<manifest-sha>/` containing `manifest.json`, `raw_rows.jsonl`, and one JSONL file per typed business-source sheet added in Task 2.
- Public Python entrypoints:
  - `serialize_cell(value) -> JSON-safe scalar/object`
  - `iter_nonempty_rows(ws_formula, ws_values) -> iterator[dict]`
  - `inspect_workbook(path) -> WorkbookRecord`
  - `build_package(workbook_paths, output_root) -> pathlib.Path`

- [ ] **Step 1: Write the failing raw-package tests**

Create `tests/python/test_azure_sql_workbook_package.py` with a synthetic workbook generated inside a temporary directory. The test must create:
- one ordinary data sheet with a header and two data rows;
- one blank trailing row;
- one formula cell;
- one date cell;
- one time cell;
- one helper sheet with non-tabular text.

The tests assert:

```python
class WorkbookPackageTests(unittest.TestCase):
    def test_preserves_every_nonempty_row_and_formula_text(self):
        package = build_test_package()
        manifest = json.loads((package / "manifest.json").read_text())
        raw = read_jsonl(package / "raw_rows.jsonl")

        self.assertEqual(manifest["format"], "paws-azure-sql-import-v1")
        self.assertEqual(manifest["totals"]["nonEmptyRows"], 5)
        self.assertEqual(len(raw), 5)
        formula_cells = [
            cell for row in raw for cell in row["cells"]
            if cell.get("formula")
        ]
        self.assertEqual(formula_cells[0]["formula"], "=A2*2")

    def test_serializes_excel_date_and_time_deterministically(self):
        package = build_test_package()
        raw = read_jsonl(package / "raw_rows.jsonl")
        flattened = json.dumps(raw, sort_keys=True)
        self.assertIn("2026-09-24", flattened)
        self.assertIn("08:30:00", flattened)

    def test_build_is_content_addressed_and_repeatable(self):
        first = build_test_package()
        second = build_test_package()
        m1 = json.loads((first / "manifest.json").read_text())
        m2 = json.loads((second / "manifest.json").read_text())
        self.assertEqual(m1["sourceManifestSha256"], m2["sourceManifestSha256"])
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
python -m pip install -r tools/requirements-azure-sql-migration.txt
python -m unittest tests.python.test_azure_sql_workbook_package -v
```

Expected: import/module failure because the migration package builder does not exist yet.

- [ ] **Step 3: Implement minimal workbook/package code**

`tools/requirements-azure-sql-migration.txt` must contain:

```text
openpyxl==3.1.5
```

Add these ignores:

```text
azure-sql-import-private/
*.paws-import.json
*.paws-import.jsonl
```

`serialize_cell` must emit ISO strings for Python `datetime/date/time`, preserve booleans/numbers/strings, and emit `None` for blank cells.

Open each workbook twice:
- `data_only=False` for formula text;
- `data_only=True` for cached/value representation.

A raw row has this contract:

```json
{
  "workbook": "example.xlsx",
  "sheet": "Teaching Assignments",
  "sheetIndex": 2,
  "sourceRow": 17,
  "cells": [
    {
      "column": 1,
      "coordinate": "A17",
      "header": "faculty_name",
      "value": "Example, Faculty",
      "formula": null
    }
  ]
}
```

A row is non-empty when at least one formula-text cell or value cell is non-blank. Do not use `ws.max_row - 1` as a data count.

The manifest must contain:
- format;
- each file name, byte length and SHA-256;
- each sheet name/index/max row/max column/non-empty-row count;
- total non-empty rows;
- deterministic `sourceManifestSha256` computed from sorted file hashes/sheet counts, excluding generation time.

- [ ] **Step 4: Verify GREEN and run the existing static suite**

Run:

```bash
python -m unittest tests.python.test_azure_sql_workbook_package -v
npm test
```

Expected: Python tests PASS; existing Node suite has no new failures.

- [ ] **Step 5: Commit Task 1**

```bash
git add .gitignore tools/requirements-azure-sql-migration.txt tools/azure_sql_migration tools/build_azure_sql_import.py tests/python/test_azure_sql_workbook_package.py
git commit -m "feat: build deterministic Azure SQL import packages"
```

---

### Task 2: Typed extraction, explicit Faculty resolution, and normalized import rows

**Files:**
- Create: `tools/azure_sql_migration/constants.py`
- Create: `tools/azure_sql_migration/identity.py`
- Create: `tools/azure_sql_migration/normalize.py`
- Create: `tools/azure_sql_migration/name_aliases.json`
- Modify: `tools/azure_sql_migration/package.py`
- Modify: `tools/build_azure_sql_import.py`
- Create: `tests/python/test_azure_sql_normalization.py`

**Interfaces:**
- Consumes: Task 1 raw workbook records.
- Produces typed staging JSONL:
  - `faculty_raw.jsonl`
  - `faculty_professional_raw.jsonl`
  - `joint_appointment_raw.jsonl`
  - `faculty_overview_raw.jsonl`
  - `teaching_assignment_raw.jsonl`
  - `role_assignment_raw.jsonl`
  - `course_raw.jsonl`
  - `doe_rule_raw.jsonl`
  - `account_role_raw.jsonl`
  - `afc_record_raw.jsonl`
- Produces normalized JSONL:
  - `faculty.jsonl`
  - `faculty_alias.jsonl`
  - `faculty_professional_profile.jsonl`
  - `joint_appointment.jsonl`
  - `course.jsonl`
  - `session.jsonl`
  - `session_assignment.jsonl`
  - `afc_record.jsonl`
  - `role_assignment.jsonl`
  - `doe_rule_seed.jsonl`
  - `role_definition.jsonl`
  - `validation_issues.jsonl`
- Public entrypoints:
  - `normalize_name(value) -> str`
  - `FacultyResolver.resolve(source_name, ucid=None, email=None) -> Resolution`
  - `canonical_session_key(row) -> str`
  - `normalize_package(package_dir) -> dict`

- [ ] **Step 1: Write identity/session normalization tests first**

Create tests that prove:
- Preferred Name exact match resolves.
- HR Name exact match resolves.
- explicit aliases resolve;
- an unknown source person remains unresolved;
- `Z-Sessional` becomes `sessional_pool`;
- `Z-Other` becomes `other_pool`;
- the two new-hire placeholder records become `vacancy`;
- two assignment rows with the same canonical event key generate one Session and two SessionAssignments;
- Session IDs are stable across repeated normalization;
- a bad AFC range is reported and excluded from normalized `afc_record.jsonl`.

The explicit alias map must include only source variants that are unambiguous in the approved Master file:

```json
{
  "Haddad Pinho, Renata": "Pinho, Renata",
  "Petersen Dias, Angelica": "Dias, Angelica",
  "Juarez Davila, Manuel": "Juárez Davila, Manuel",
  "de Anhaia Camargo, Vinicius": "Camargo, Vinicius",
  "Rancourt, Derrick E.": "Rancourt, Derrick"
}
```

Do not add an alias for `Zachar, Erin`.

Add naming assertions using real-style examples:
- `Alfajaro, Mia` → `Mia, Alfajaro`;
- HR source `Whiteside, Douglas` → Preferred `Doug, Whiteside`;
- alias source `Juarez Davila, Manuel` → Preferred `Manuel, Juárez Davila`;
- source `van der Meer, Franciscus` → Preferred `Frank, van der Meer` through the unique HR crosswalk.

`HR FULL Name` remains staging evidence only; normalized Faculty records do not carry it as a competing display-name field.

- [ ] **Step 2: Run normalization tests and verify RED**

```bash
python -m unittest tests.python.test_azure_sql_normalization -v
```

Expected: FAIL because resolver/normalizer entrypoints do not exist.

- [ ] **Step 3: Implement the minimum explicit normalization pipeline**

Identity matching order is exactly:
1. non-blank UCID exact match;
2. normalized institutional email exact match;
3. exact normalized Faculty Master Preferred Name in source `Last, First` form;
4. exact normalized HR-name crosswalk when unique;
5. explicit alias file;
6. unresolved.

After any successful match, output name fields are built only from the matched Faculty Master Preferred Name. Parse the source `Last, First` value at the first comma into `PreferredLastName` and `PreferredFirstName`, then set `DisplayName = PreferredFirstName + ", " + PreferredLastName`. Do not copy the HR/source name into normalized display fields.

`normalize_name` may normalize Unicode form, case for comparison, trim whitespace, and collapse repeated whitespace. It must not remove accents or arbitrarily drop surname tokens to force a match.

Use deterministic UUIDv5 identifiers with explicit PAWS URL keys, for example:

```python
def stable_id(kind: str, key: str) -> str:
    return str(uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"https://paws.ucalgary.ca/azure-sql/{kind}/{key}"
    ))
```

The canonical Session key is constructed from:
- academic_year
- curriculum_year
- course
- topic
- session_type
- date
- start
- end

Normalize date to `YYYY-MM-DD`; normalize known time to `HH:MM:SS`. Blank time remains blank and is not converted to `00:00:00`.

Legacy Role rows do not contain effective dates. Do not invent them. Their normalized rows retain `AcademicYear` and null `EffectiveDate`/`ExpirationDate`.

DOE formula outputs that are not reliably cached are recomputed only for the simple documented source fact `rate * quantity`; documentary/review-required rows retain their status and source evidence rather than receiving invented DOE values.

- [ ] **Step 4: Verify GREEN**

```bash
python -m unittest tests.python.test_azure_sql_workbook_package tests.python.test_azure_sql_normalization -v
npm test
```

Expected: all migration Python tests PASS and existing Node tests show no new failure.

- [ ] **Step 5: Commit Task 2**

```bash
git add tools/azure_sql_migration tests/python/test_azure_sql_normalization.py
git commit -m "feat: normalize PAWS workbook data for Azure SQL"
```

---

### Task 3: Azure SQL foundation schema and application permission boundary

**Files:**
- Create: `database/azure-sql/001_foundation.sql`
- Create: `database/azure-sql/002_calendar_view.sql`
- Create: `database/azure-sql/003_app_permissions.sql`
- Create: `tests/python/test_azure_sql_schema_contract.py`

**Interfaces:**
- Consumes: normalized package table/file names from Task 2.
- Produces schemas/tables/views compatible with the importer in Task 4.
- Required schemas: `staging`, `paws`.
- Required normalized tables:
  - `paws.Faculty`
  - `paws.FacultyAlias`
  - `paws.FacultyProfessionalProfile`
  - `paws.JointAppointment`
  - `paws.Course`
  - `paws.Session`
  - `paws.SessionAssignment`
  - `paws.AfcRecord`
  - `paws.RoleAssignment`
  - `paws.DoeRuleSeed`
  - `paws.RoleDefinition`
  - empty foundation tables `paws.UserProfile` and `paws.AuditEvent`
  - `paws.vCalendarSession`

- [ ] **Step 1: Write schema contract tests first**

The tests read SQL text and assert:
- `staging.ImportBatch/ImportWorkbook/ImportSheet/ImportRow` exist;
- all ten typed staging tables exist;
- all normalized tables listed above exist;
- `paws.Faculty` uses `uniqueidentifier` primary key, has `PreferredFirstName`, `PreferredLastName`, and `DisplayName`, omits HR name as a canonical display field, and nullable UCID/email uniqueness is enforced through filtered unique indexes;
- `paws.AfcRecord` has `CHECK (EndDate >= StartDate)`;
- `paws.RoleAssignment` allows negative DOE override and checks only that ExpirationDate is later than EffectiveDate when both are present;
- `paws.SessionAssignment` has FKs to Session and Faculty;
- `paws.vCalendarSession` selects from canonical Session/Assignment data;
- the app permission script grants on `paws` and contains an explicit `DENY` for `staging`;
- no SQL file creates or uses a SQL password.

- [ ] **Step 2: Run schema contract and verify RED**

```bash
python -m unittest tests.python.test_azure_sql_schema_contract -v
```

Expected: FAIL because the DDL does not exist.

- [ ] **Step 3: Implement the DDL**

`001_foundation.sql` must:
- create `staging` and `paws` if absent;
- create import provenance tables first;
- create typed staging tables with `ImportBatchId`, `ImportRowId`, source fields, `ValidationStatus`, `ValidationErrorsJson`;
- create normalized tables with explicit PK/FK/check/index definitions;
- avoid year-specific columns such as `doeOverride2026_27`;
- keep `paws.UserProfile` empty unless a later authenticated account import supplies Firebase UIDs.

`002_calendar_view.sql` must build `paws.vCalendarSession` from `paws.Session` plus display-safe assignment names; it must not expose UCID, email, DOE values, AFC purpose, or HR fields.

`003_app_permissions.sql` must be parameterized by a SQLCMD-style/apply-time principal variable rather than hard-code a secret. Its effective behavior is:
- grant required SELECT/INSERT/UPDATE/DELETE/EXECUTE on `paws`;
- deny SELECT/INSERT/UPDATE/DELETE on `staging`;
- do not grant `db_owner`.

- [ ] **Step 4: Verify schema contract GREEN**

```bash
python -m unittest tests.python.test_azure_sql_schema_contract -v
python -m unittest discover -s tests/python -p "test_azure_sql_*.py" -v
npm test
```

Expected: PASS with no new existing-suite failures.

- [ ] **Step 5: Commit Task 3**

```bash
git add database/azure-sql tests/python/test_azure_sql_schema_contract.py
git commit -m "feat: define PAWS Azure SQL foundation schema"
```

---

### Task 4: Read-only reset planner and guarded transactional Azure importer

**Files:**
- Create: `tools/azure_sql_migration/sql_access.ps1`
- Create: `tools/plan_paws_azure_sql_reset.ps1`
- Create: `tools/import_paws_azure_sql.ps1`
- Create: `tests/python/test_azure_sql_importer_contract.py`

**Interfaces:**
- `plan_paws_azure_sql_reset.ps1` is read-only and emits one JSON object with:
  - server;
  - database;
  - ordered user-object inventory;
  - object count;
  - `inventorySha256`.
- `import_paws_azure_sql.ps1` requires:
  - `-PackagePath`
  - `-ExpectedSourceManifestSha256`
  - `-ExpectedInventorySha256`
  - `-Confirmation "RESET teaching-assignment-lab"`
  - optional server/database defaults fixed to the current lab resources.
- Apply emits a machine-readable success report with import counts and verification results.

- [ ] **Step 1: Write importer safety contract tests first**

The static tests assert the scripts contain all of these fail-closed controls:
- exact database-name assertion for `teaching-assignment-lab`;
- exact confirmation string `RESET teaching-assignment-lab`;
- source manifest hash comparison;
- current inventory hash comparison against the previously reviewed plan;
- no destructive statement in the planner;
- planner queries `sys.objects`/schemas only;
- importer starts a SQL transaction before destructive object removal;
- importer removes existing user application objects but does not drop the database, logins/users, roles, firewall rules, or the logical server;
- importer rolls back in `catch`;
- bulk copy participates in the active transaction;
- post-load SQL checks run before commit;
- success JSON is emitted only after commit.

- [ ] **Step 2: Run importer contract and verify RED**

```bash
python -m unittest tests.python.test_azure_sql_importer_contract -v
```

Expected: FAIL because the scripts do not exist.

- [ ] **Step 3: Implement shared Entra SQL access and the read-only planner**

Reuse the existing device-flow pattern but isolate it in `sql_access.ps1`. Do not print the access token.

The planner:
1. opens Azure SQL using the Entra token;
2. verifies `DB_NAME()`;
3. selects user-created schemas/objects from catalog views;
4. canonicalizes rows in deterministic order;
5. hashes the canonical JSON;
6. prints the JSON plan;
7. performs no DDL/DML.

- [ ] **Step 4: Implement guarded Apply**

The importer:
1. validates the private package manifest and all JSONL counts locally;
2. opens SQL;
3. verifies exact database;
4. re-reads object inventory and matches `ExpectedInventorySha256`;
5. verifies the typed confirmation;
6. begins a SQL transaction;
7. drops existing PAWS user application objects in dependency-safe order while leaving security principals/system objects intact;
8. executes `001_foundation.sql` and `002_calendar_view.sql`;
9. bulk-copies generic raw rows, typed staging rows and normalized rows;
10. runs required count/FK/uniqueness/anomaly checks;
11. inserts/updates `staging.ImportBatch` completion evidence;
12. commits;
13. emits success JSON.

Any exception before commit calls `Rollback()` and exits non-zero.

The first implementation does not run `003_app_permissions.sql` because the App Service managed-identity principal does not yet exist in Phase 1. That permission script is exercised in Phase 2 when the principal is provisioned.

- [ ] **Step 5: Verify importer contract GREEN**

```bash
python -m unittest tests.python.test_azure_sql_importer_contract -v
python -m unittest discover -s tests/python -p "test_azure_sql_*.py" -v
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add tools/azure_sql_migration/sql_access.ps1 tools/plan_paws_azure_sql_reset.ps1 tools/import_paws_azure_sql.ps1 tests/python/test_azure_sql_importer_contract.py
git commit -m "feat: add guarded Azure SQL reset and import tools"
```

---

### Task 5: CI and operator documentation for the migration toolchain

**Files:**
- Create: `.github/workflows/azure-sql-migration-test.yml`
- Create: `docs/azure-sql-migration.md`
- Create: `tests/python/test_azure_sql_docs_contract.py`

**Interfaces:**
- CI tests tooling only; it receives no workbook and no Azure credential.
- Documentation gives exact local commands for package build, read-only plan, reviewed destructive apply, and verification.

- [ ] **Step 1: Write docs/workflow tests first**

Tests assert:
- workflow uses Python, installs `tools/requirements-azure-sql-migration.txt`, and runs all `test_azure_sql_*.py`;
- workflow has `contents: read` only and no Azure/secret usage;
- docs state private workbooks/packages must stay out of Git;
- docs identify the exact current lab server/database;
- docs show a read-only Plan command before Apply;
- docs explicitly state Apply is destructive;
- docs state Firestore is not a source for this import;
- docs explain that unresolved/invalid rows remain in staging;
- docs contain the exact confirmation string.

- [ ] **Step 2: Run and verify RED**

```bash
python -m unittest tests.python.test_azure_sql_docs_contract -v
```

Expected: FAIL because workflow/docs are absent.

- [ ] **Step 3: Add CI workflow**

Use:

```yaml
name: Azure SQL Migration Tests

on:
  pull_request:
    paths:
      - "database/azure-sql/**"
      - "tools/azure_sql_migration/**"
      - "tools/build_azure_sql_import.py"
      - "tools/plan_paws_azure_sql_reset.ps1"
      - "tools/import_paws_azure_sql.ps1"
      - "tests/python/test_azure_sql_*.py"
      - "tools/requirements-azure-sql-migration.txt"
  push:
    branches: [main]
    paths:
      - "database/azure-sql/**"
      - "tools/azure_sql_migration/**"
      - "tools/build_azure_sql_import.py"
      - "tools/plan_paws_azure_sql_reset.ps1"
      - "tools/import_paws_azure_sql.ps1"
      - "tests/python/test_azure_sql_*.py"
      - "tools/requirements-azure-sql-migration.txt"

permissions:
  contents: read

jobs:
  migration_tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: python -m pip install -r tools/requirements-azure-sql-migration.txt
      - run: python -m unittest discover -s tests/python -p "test_azure_sql_*.py" -v
```

- [ ] **Step 4: Write operator documentation**

The package command must use explicit paths and output outside Git:

```powershell
python tools/build_azure_sql_import.py `
  --workload "C:\path\PAWS_Faculty_Workload_Normalized.xlsx" `
  --afc "C:\path\AFC Tracker Lookup (1).xlsx" `
  --faculty "C:\path\Partial Faculty Master List - September 21, 2026.xlsx" `
  --output-root "..\azure-sql-import-private"
```

The read-only plan command:

```powershell
powershell -ExecutionPolicy Bypass -File tools/plan_paws_azure_sql_reset.ps1 `
  -Server "ucvm-teaching-lab-xz-20260911.database.windows.net" `
  -Database "teaching-assignment-lab"
```

The destructive Apply example must require values copied from the locally generated package manifest and reviewed plan, never hard-code a token:

```powershell
powershell -ExecutionPolicy Bypass -File tools/import_paws_azure_sql.ps1 `
  -PackagePath "..\azure-sql-import-private\<content-addressed-package>" `
  -ExpectedSourceManifestSha256 "<manifest sha256>" `
  -ExpectedInventorySha256 "<reviewed inventory sha256>" `
  -Confirmation "RESET teaching-assignment-lab"
```

The angle-bracket values are operator-supplied runtime values, not implementation placeholders.

- [ ] **Step 5: Verify GREEN and full local suite**

```bash
python -m unittest discover -s tests/python -p "test_azure_sql_*.py" -v
npm test
node tools/beta-freeze.js
```

Expected:
- all migration tests PASS;
- no new Node suite failure;
- frozen runtime check still passes because no shipped runtime asset changed.

- [ ] **Step 6: Commit Task 5**

```bash
git add .github/workflows/azure-sql-migration-test.yml docs/azure-sql-migration.md tests/python/test_azure_sql_docs_contract.py
git commit -m "ci: verify Azure SQL migration tooling"
```

---

### Task 6: Build and verify the real private import package

**Files:**
- No private input/output file is committed.
- Modify only if a failing real-data case requires a TDD fix to Tasks 1-5.

**Interfaces:**
- Consumes the three conversation-supplied workbooks.
- Produces a private content-addressed package and a concise validation report.

- [ ] **Step 1: Build the real package**

Run against the supplied files:

```bash
python tools/build_azure_sql_import.py \
  --workload "/mnt/data/PAWS_Faculty_Workload_Normalized.xlsx" \
  --afc "/mnt/data/AFC Tracker Lookup (1).xlsx" \
  --faculty "/mnt/data/Partial Faculty Master List - September 21, 2026.xlsx" \
  --output-root "/mnt/data/azure-sql-import-private"
```

- [ ] **Step 2: Verify the authoritative source counts**

The report must prove:
- Faculty Master / Key: 116 Faculty business rows, plus the `Key!A119` formula summary row preserved in generic raw staging;
- Faculty Professional records: 116 normalized source records;
- Joint Appointments: 14;
- Teaching Assignments: 4,974;
- canonical Sessions: 1,937;
- Role Assignments: 162;
- Courses: 43;
- DOE Rules: 24;
- Account Roles: 14;
- AFC records: 798.

The parser must derive counts from non-empty rows, not worksheet max-row values.

- [ ] **Step 3: Verify known anomalies and no silent identity guessing**

The report must include at least:
- all 116 Faculty Master records have UCID and email;
- all 116 Faculty canonical display names are derived from the Preferred Name and formatted `First, Last`; HR/source names may resolve identity but never replace the Preferred display name;
- 1 AFC row without Faculty Member;
- 1 AFC row without Purpose;
- 2 AFC rows with End earlier than Start;
- `Zachar, Erin` is confirmed former Faculty; 4 Teaching Assignment rows and 4 AFC rows remain in staging/validation evidence but are explicitly excluded from canonical business data;
- the five explicit alias variants map only to their explicit targets;
- pool/vacancy placeholders are represented as non-Faculty record types;
- AFC validation reports exactly 2 `End < Start`, 1 missing Faculty Member, and 1 missing Purpose for this source set.

If any expected count or anomaly differs, stop and add a failing regression test before changing normalization logic.

- [ ] **Step 4: Re-run all tests after real-data verification**

```bash
python -m unittest discover -s tests/python -p "test_azure_sql_*.py" -v
npm test
node tools/beta-freeze.js
```

- [ ] **Step 5: Commit only code/test fixes if real-data validation required them**

Do not commit the package or workbooks.

---

### Task 7: Read-only Azure inventory plan and destructive-apply gate

**Files:**
- No code change expected unless the read-only planner exposes a tested defect.

**Interfaces:**
- Consumes the current live `teaching-assignment-lab` object catalog.
- Produces the exact inventory JSON/hash that gates Apply.

- [ ] **Step 1: Run the read-only reset planner from an authorized workstation**

```powershell
powershell -ExecutionPolicy Bypass -File tools/plan_paws_azure_sql_reset.ps1 `
  -Server "ucvm-teaching-lab-xz-20260911.database.windows.net" `
  -Database "teaching-assignment-lab"
```

Authenticate through the Microsoft Entra device prompt. The token must never be copied into chat or source control.

- [ ] **Step 2: Review the inventory**

Confirm the inventory contains only objects belonging to this dedicated PAWS lab database. Legacy mirror objects such as `dbo.FirestoreDocument` / `dbo.FirestoreImportRun` are expected if still present.

If an unrelated/unknown object is present, do not Apply. Investigate it first.

- [ ] **Step 3: Stop for the destructive-operation confirmation**

At this point the implementation executor must present:
- server/database;
- inventory object names;
- inventory SHA-256;
- package source-manifest SHA-256;
- normalized count summary;
- known excluded-invalid/unresolved rows.

The executor must obtain an explicit go-ahead before invoking Apply, even though the clean rebuild is the approved project goal.

- [ ] **Step 4: After explicit confirmation, run guarded Apply**

```powershell
powershell -ExecutionPolicy Bypass -File tools/import_paws_azure_sql.ps1 `
  -PackagePath "..\azure-sql-import-private\<content-addressed-package>" `
  -ExpectedSourceManifestSha256 "<manifest sha256>" `
  -ExpectedInventorySha256 "<reviewed inventory sha256>" `
  -Confirmation "RESET teaching-assignment-lab"
```

- [ ] **Step 5: Verify Azure postconditions**

The success report must prove:
- no legacy mirror table remains;
- all generic raw rows and typed staging counts match package manifest;
- 116 Faculty business rows are preserved in typed staging, while the `Key!A119` summary formula row is preserved in generic raw staging;
- 4,974 Teaching Assignment source rows are preserved;
- 1,937 canonical Sessions exist;
- 4,970 canonical SessionAssignments exist; the 4 former-Faculty Teaching Assignment rows for `Zachar, Erin` remain enumerated in staging/validation evidence;
- 798 AFC raw records exist, while invalid/unresolved AFC rows are excluded from `paws.AfcRecord` and counted in validation evidence;
- all enabled FK/check/unique constraints pass;
- `paws.vCalendarSession` returns canonical session data;
- `staging.ImportBatch` records the exact source manifest hash and completed status.

---

## Self-review result

- **Spec coverage:** Phase 1 database reset/import, raw preservation, normalized foundation, explicit identity handling, Calendar projection, permissions boundary, no-Firestore source, and destructive safety are all mapped to Tasks 1-7. API/frontend cutover remains intentionally outside this Phase 1 plan and is covered by later plans in the approved spec.
- **Placeholder scan:** no implementation step is left unspecified; angle-bracket strings in the operator command are explicitly runtime values copied from generated evidence.
- **Type consistency:** package file names, Python entrypoints, schema names, SQL table names, and PowerShell parameters are consistent across producer/consumer tasks.
- **Review Focus:** each of the five high-risk failure modes has a concrete test or gate in the owning task.
