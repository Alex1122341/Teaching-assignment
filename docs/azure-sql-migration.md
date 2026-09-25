# PAWS Azure SQL authoritative workbook migration

This runbook covers Phase 1 of the PAWS Firestore-to-Azure SQL cutover. The three approved workbooks are the sole initialization source. The current live migration checkpoint is a verified-empty Azure SQL lab database followed by a guarded, non-destructive schema/data load.

## Safety boundary

Target lab resources:

- SQL server: `ucvm-teaching-lab-xz-20260911.database.windows.net`
- database: `teaching-assignment-lab`

The supplied workbooks and generated import package are private. **Do not commit** the workbooks, generated JSONL package contents, device tokens, SQL access tokens, or any other credential material.

Firestore is not a source for this import. Do not compare against it, backfill from it, or use it to fill workbook gaps.

All non-empty workbook rows are preserved as generic `staging` evidence. Business-source rows are additionally preserved in typed `staging.*Raw` tables. Invalid records and explicitly excluded former-Faculty records stay in staging/validation evidence; they are not silently guessed into canonical relationships.

Canonical real-Faculty names come only from the Faculty Master `Preferred FULL Name (Last, First)` column and are rendered in PAWS as `First, Last`.

## 1. Build the private import package

Install the migration dependency from the approved migration branch:

```powershell
python -m pip install -r tools/requirements-azure-sql-migration.txt
```

Build the package outside the repository:

```powershell
python tools/build_azure_sql_import.py `
  --workload "C:\path\PAWS_Faculty_Workload_Normalized.xlsx" `
  --afc "C:\path\AFC Tracker Lookup (1).xlsx" `
  --faculty "C:\path\Partial Faculty Master List - September 21, 2026.xlsx" `
  --output-root "C:\path\PAWS Azure Import Package"
```

For the approved 2026-09-24 source set, the source manifest SHA-256 is:

```text
e549a5d5aed4846a3f4860284049e77d258e1a5c236f80d4ea858cec5eab1cc4
```

The package must account for:

- 6,838 non-empty raw workbook rows;
- 116 Faculty Master business rows;
- 116 Education & Experience rows;
- 14 Joint Appointments;
- 4,974 Teaching Assignment source rows;
- 1,937 canonical Sessions;
- **4,970 canonical SessionAssignments**;
- 162 Role Assignment rows;
- 43 Courses;
- 24 DOE Rules;
- 14 Account Roles;
- 798 AFC raw records;
- 791 canonical AFC records.

### Former Faculty: Erin Zachar

`Zachar, Erin` is no longer Faculty and is explicitly excluded from canonical PAWS business data.

For this approved source set:

- 4 Teaching Assignment source rows remain in typed/raw staging evidence but are excluded from `paws.SessionAssignment`;
- 4 AFC source rows remain in typed/raw staging evidence but are excluded from `paws.AfcRecord`;
- Erin must not appear in canonical `paws.Faculty`, `paws.SessionAssignment`, or `paws.RoleAssignment`;
- the 8 exclusions are reported as `TEACHING_FORMER_FACULTY_EXCLUDED` and `AFC_FORMER_FACULTY_EXCLUDED`, not as unresolved identity guesses.

The complete validation report for this source set contains 14 issues:

- 4 `TEACHING_FORMER_FACULTY_EXCLUDED`;
- 4 `AFC_FORMER_FACULTY_EXCLUDED`;
- 2 `AFC_END_BEFORE_START`;
- 1 `AFC_FACULTY_MISSING`;
- 1 `AFC_PURPOSE_MISSING`;
- 2 `FACULTY_EMAIL_INVALID` for source placeholder value `TBC`; the raw value remains staging evidence while canonical Faculty email is `NULL`.

## 2. Read-only Azure inventory

The read-only planner is:

```powershell
powershell -ExecutionPolicy Bypass -File tools/plan_paws_azure_sql_reset.ps1 `
  -Server "ucvm-teaching-lab-xz-20260911.database.windows.net" `
  -Database "teaching-assignment-lab"
```

It authenticates through Microsoft Entra device flow and performs catalog reads only.

Before the 2026-09-24 reset, the reviewed inventory contained exactly 18 legacy PAWS application objects. The exact destructive reset tool used for that reviewed scope is `tools/reset_paws_azure_sql_exact.ps1`; it is pinned to that inventory and requires the typed confirmation `RESET teaching-assignment-lab`.

That reset has already been completed for the current migration. Do not re-run it against a changed inventory.

The independent post-reset inventory is:

```text
objectCount: 0
inventorySha256: 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
```

This is the SHA-256 of the canonical empty inventory `[]`.

## 3. Guarded empty-database preview

The current loader is `tools/load_paws_azure_sql_empty.ps1`.

It is intentionally not a reset tool. It contains no application-object removal path and refuses to continue unless:

- the server is exactly the reviewed PAWS lab server;
- the database is exactly `teaching-assignment-lab`;
- the package source manifest is exactly `e549a5d5aed4846a3f4860284049e77d258e1a5c236f80d4ea858cec5eab1cc4`;
- package line counts and validation issue counts match the approved source set;
- the live database inventory has `objectCount = 0`;
- the live inventory hash is exactly `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.

Run preview first:

```powershell
powershell -ExecutionPolicy Bypass -File tools/load_paws_azure_sql_empty.ps1 `
  -PackagePath "C:\path\PAWS Azure Import Package\e549a5d5aed4846a3f4860284049e77d258e1a5c236f80d4ea858cec5eab1cc4"
```

Preview performs local package validation plus live read-only Azure inventory validation. It does not create schemas or load data.

## 4. Apply the schema and data load

Only after preview returns `mode: preview` with the approved source and empty-inventory hashes, run:

```powershell
powershell -ExecutionPolicy Bypass -File tools/load_paws_azure_sql_empty.ps1 `
  -PackagePath "C:\path\PAWS Azure Import Package\e549a5d5aed4846a3f4860284049e77d258e1a5c236f80d4ea858cec5eab1cc4" `
  -Apply
```

Apply:

1. starts one Azure SQL transaction;
2. executes `database/azure-sql/001_foundation.sql`;
3. executes `database/azure-sql/002_calendar_view.sql`;
4. bulk-loads generic raw rows and typed staging rows;
5. bulk-loads canonical `paws.*` rows;
6. verifies expected counts and canonical exclusion of Erin Zachar;
7. runs SQL constraint verification;
8. marks `staging.ImportBatch` complete;
9. commits only after all checks pass.

Any exception before commit rolls the transaction back. The loader does not apply the application-permissions script yet; managed-identity permissions belong to the later App Service/API phase.

## 5. Required post-load evidence

A successful result must demonstrate:

- 6,838 generic raw rows;
- 4,974 Teaching Assignment raw rows;
- 1,937 canonical Sessions;
- 4,970 canonical SessionAssignments;
- 798 AFC raw rows;
- 791 canonical AFC records;
- Erin Zachar absent from canonical Faculty/SessionAssignment/RoleAssignment data;
- all 14 validation issues preserved as evidence;
- enabled SQL constraints report no violations;
- `paws.vCalendarSession` returns 1,937 canonical sessions;
- `staging.ImportBatch` stores the exact source-manifest SHA and completed status.

Phase 1 does not switch the PAWS frontend to Azure SQL. Firebase Authentication remains, and the later API/frontend cutover will move business-data reads and writes behind the Azure App Service API.

## Beta runtime: Static Web Apps Managed Functions -> Azure SQL

The current beta runtime path is intentionally different from the later App Service + Managed Identity design. It reuses the existing Free Static Web App and places a thin Managed Functions boundary between browser JavaScript and Azure SQL:

```text
Firebase-authenticated browser
        |
        | same-origin /api/*
        v
ucvm-teaching-lab-web Managed Functions
        |
        | server-side beta SQL credential
        v
teaching-assignment-lab
        |
        +-- paws.*       application runtime
        +-- staging.*    denied to runtime principal
```

The browser never receives a SQL connection string and never connects to SQL directly. The first accepted slice reads identity/profile and timetable sessions only. Session mutations remain disabled while the browser is configured for `azure-sql`, so the beta does not create a hidden Azure-SQL-read/Firestore-write split.

The dedicated beta SQL principal is `paws_swa_beta`. Its tracked permission file is `database/azure-sql/004_swa_beta_permissions.sql`. The first slice grants only:

- `SELECT` on `paws.UserProfile`;
- `INSERT` on `paws.UserProfile` for approved first-link provisioning;
- `SELECT` on `paws.Faculty`;
- `SELECT` on `paws.SessionAssignment`;
- `SELECT` on `paws.vCalendarSession`;
- an explicit deny for read/write access to `staging`.

The password is not stored in that SQL file or in GitHub. `tools/configure_paws_swa_beta.ps1` creates/rotates the contained user in memory and then applies the static grant file.

### Preview the beta configuration target

Run:

```powershell
.\tools\configure_paws_swa_beta.ps1 -Preview
```

The preview is read-only with respect to PAWS application resources: it validates the pinned subscription, resource group, Static Web App, SQL server/database and reports the expected application-setting names. Review this output before any apply.

### Apply only after explicit approval

The live configuration command is intentionally separate:

```powershell
.\tools\configure_paws_swa_beta.ps1 `
  -Apply `
  -FirebaseServiceAccountPath "C:\private\tester-teaching-service-account.json"
```

The operator supplies only a **local file path**. Do not paste Firebase Admin JSON, database passwords, ID tokens, device codes, or connection strings into documentation, issues, PR comments, or chat.

On apply the script:

1. verifies the exact existing SWA and Azure SQL targets;
2. validates the local Firebase service-account project ID;
3. collects the approved bootstrap account identity locally and serializes `PAWS_ACCOUNT_BOOTSTRAP_JSON` in memory;
4. generates a strong SQL password in memory unless `-PromptForSqlPassword` is explicitly requested;
5. uses the existing Entra SQL access helper to create/rotate `paws_swa_beta`;
6. applies `004_swa_beta_permissions.sql`;
7. constructs the SQL connection string in memory;
8. writes the six required SWA server-side Application Settings;
9. verifies the required setting **names only** and clears secret-bearing variables.

The six setting names are:

```text
PAWS_SQL_CONNECTION_STRING
PAWS_SQL_READS
PAWS_SQL_AUTH
PAWS_ACCOUNT_BOOTSTRAP_JSON
FIREBASE_PROJECT_ID
FIREBASE_SERVICE_ACCOUNT_JSON
```

After configuration, the release remains gated: a successful `main` Azure build produces the exact `.azure-production/app` + `.azure-production/api` handoff, and the manual Azure Production Deploy workflow must use that build's source run ID and exact commit SHA. The deploy job then requires `/api/health/sql` to report healthy Azure SQL connectivity.

The App Service bootstrap below is a later production-grade path. It is **not a prerequisite for the current SWA Managed Functions beta**.

## Runtime bootstrap: App Service -> Azure SQL

After the authoritative import is complete, `tools/bootstrap_paws_azure_runtime.ps1` performs the guarded one-time runtime wiring:

1. uses an existing App Service when it can choose one unambiguously;
2. creates a Node 22 App Service only when `-CreateIfMissing` is explicitly supplied;
3. enables a system-assigned managed identity;
4. configures SQL runtime settings and the server-side account bootstrap allowlist;
5. grants the managed identity application access to `paws.*` and explicitly denies `staging.*`;
6. configures the GitHub production API variables and publish-profile environment secret;
7. dispatches the exact-current-main API deployment and verifies `/api/health`.

The script does not enable the Azure SQL 0.0.0.0 "Allow Azure services" firewall rule unless `-AllowAzureServicesToSql` is explicitly supplied.

Example when an API App Service does not exist yet:

```powershell
.\tools\bootstrap_paws_azure_runtime.ps1 -CreateIfMissing
```

The bootstrap email is prompted interactively so it does not need to be committed or placed on the command line. The default creation SKU is `F1`; use `-Sku B1` (or another supported SKU) only when intentionally selecting a paid App Service tier.

### No-admin CLI fallback

The runtime bootstrap does not require MSI installation of Azure CLI or GitHub CLI. If `az` or `gh` is not available on `PATH`, it downloads official portable ZIP distributions into `%LOCALAPPDATA%\PAWS\portable-tools` and prepends only the extracted command directory to the current PowerShell process `PATH`.

- Azure CLI uses Microsoft's `https://aka.ms/installazurecliwindowszipx64` no-admin ZIP.
- GitHub CLI resolves the latest official `windows_amd64.zip` release asset from `cli/cli`.
- If GitHub CLI is not authenticated, the bootstrap starts `gh auth login --web`.
