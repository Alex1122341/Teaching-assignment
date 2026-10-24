# History search, CCC template and record-linked AFC originals

## Intent and authorization

The user requests compact, searchable academic-year history, a downloadable usable CCC template, optional original-PDF archival inside manual AFC creation, per-record downloads/N/A and faculty access to their own originals. The follow-up prioritizes scanning many history entries and Lookup-style keyword search with a Search/Enter action. Earlier standing instructions authorize sequential implementation without repetitive approval questions, tests, reviewed PRs and release of accepted changes. Existing Beta repository/school identity remain authorized.

## History

Use six compact columns: Time; Type / Domain; Session; Change (field plus From / To); Start / End; By whom. Display N/A for missing facts, preserving numeric zero and false. Course accompanies the session label. Two-line summaries and explicit expansion retain full values without 2–3 large rows filling the screen. Keep 100-row pagination, exact total and complete filtered CSV/XLSX exports. Exports use individual typed columns rather than visually combining fields.

Add one keyword search box. Search/Enter queries all permitted projected rows in the selected academic year, before pagination/export snapshots. Case-insensitive space-separated terms all match the combined authorized visible fields; no secret/raw audit JSON or internal identity keys enter the search document. Preserve structured advanced filters behind disclosure. A selected academic year is always present, defaults to the current displayed business year or Calgary May–April year, and cannot mean all years. Snapshot rows and exports carry that exact selected year.

Year attribution: authoritative recorded academic-year fields for teaching and policy; source date-range overlap for AFC/working records; a global Lookup edit without recorded business year belongs to the Calgary academic year when the edit occurred. Explicit but malformed/contradictory evidence must not fall back to another year. Missing source year/dates for other domains stays excluded with coverage text. Session moves and ranges spanning years may appear in each affected year, with the selected year shown. Changed-on date filters remain independent of activity dates. Source audit facts are never rewritten.

Actor display uses a recorded human name only; N/A when unavailable. Never expose Firebase UID/email as an actor fallback. SQL and projection permit this label only on already-authorized rows; private field allowlists remain unchanged.

## CCC template

An authenticated administrator download returns a genuine .xlsx with exactly one visible sheet CCC, six ordered headers Faculty ID, Faculty Name, Start Date, End Date, Course Code, Label. Header-only, no synthetic business rows or extra instruction sheets. UI explains exact ID or exact current name (both must agree), YYYY-MM-DD / genuine Excel date cells, May1–April30 selected year, optional Course Code/Label(default CCC), no formulas,512KiB/5000 rows. Read-only template generation works with CCC commit disabled. Existing parser still rejects an empty upload; template must be completed before upload.

## AFC originals and record linkage

Move the document controls inside Create AFC Record / Single Entry. Faculty selection comes from the manual record form, optional PDF selected there. On Create, validate/upload the original through the existing bounded PDF service, then create the manual AFC record and attach that exact document in one SQL transaction. The archive upload can survive a failed create as a faculty-owned unlinked original; retries reuse its upload key and confirmed document rather than duplicate uploads. UI must explain an archive that is saved but whose AFC creation failed. No successful AFC is reported before record readback confirms it and its document link.

Use an additive confidential linking table with FK to manual record, FK to document, unique record/document bindings. A reviewed wrapper validates live admin identity, active faculty and same-faculty/same-uploader/unlinked document, executes existing CreateAfcRecord inside an outer transaction, binds the document and audits linkage; any failure rolls back record/link/audit together. No changes to existing AFC reasons, cancellation/version/availability rules, approval artifacts, batch import or imported rows. Older records without PDF show N/A; new optional no-PDF records also show N/A. Do not fabricate legacy files or attach by names/date guesses.

Admin AFC table and authorized faculty profile AFC rows include Download PDF for the linked original, N/A otherwise. Original list/get SQL procedures allow admins or active faculty/hicc/visc whose current UserProfile.FacultyId equals the document faculty. Deny others, unlinked faculty, inactive/must-change-password accounts and spoofed faculty/document IDs. SQL ownership is rechecked inside the transaction. List metadata only; binary remains authenticated attachment/no-store/nosniff/CSP sandbox with hash validation and download audit. Own faculty archive list remains available for historical unlinked originals without exposing another person's documents. Upload stays admin-only and gated.

## Verification/release

TDD for year boundaries, range overlap, keyword completeness beyond100 rows, immutable export, XSS/formula protection, compact full-value access, genuine template/parser compatibility, optional PDF create/readback/uncertain outcomes, SQL atomic link rollback and ownership, self download/IDOR and revoked identity. Run root/server suites, SQL acceptance in isolated CI and browser QA with synthetic in-memory data. Independent whole-branch product review then separate immutable freeze promotion; exact-head/exact-main artifacts before SQL/API/Hosting coordinated release. Keep CCC commit false, never replay540, preserve Course Calendar/DOE/policy and existing write gates. Update original Excel and continuity with actual evidence and manual limits.
