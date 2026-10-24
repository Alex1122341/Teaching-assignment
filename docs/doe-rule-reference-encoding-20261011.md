# DOE rule reference encoding repair — 2026-10-11

## Cause and scope

The snapshot importer read BOM-less UTF-8 JSON with Windows PowerShell's default ANSI decoding. The server source already contained correct U+2013 range dashes; the three active 2026–27 DoeRuleSeed records instead contained U+00E2 U+20AC U+201C. The Lookup API reads these SQL records directly.

## Repair

`tools/repair-doe-rule-reference-encoding.ps1` defaults to a read-only inspection. Apply requires exactly three known guideline rule codes, saves the full active rule seed snapshot as UTF-8 JSON, and updates only RuleLabel, AcademicYearOrStage and RawJson inside one transaction. Original text comparisons reject concurrent changes. Numerical rates, policy IDs and rule IDs are preserved.

Live application: ITAPPVETOPSDB01 / VetMed-Ops, 2026-10-11T21:17:33Z, three rows committed. Backup: `P:\PAWS\Runtime\Acceptance\RuleEncoding-20261011\before-20261011T211733226.json`. It contains the original fields for recovery; restore only the three affected text fields after checking for subsequent edits.

## Evidence

- Read-only SQL after repair: all three dash code points are 8211 (U+2013); rates are 3.5%, 7%, 10%.
- Read-only inspection: zero remaining corrupted range dashes among the 33 active guideline rules.
- Live authenticated Chrome Lookup displays Course coordination 3–5, 6–9, 10–14 units correctly. Screenshot retained locally in `outputs/doe-rule-encoding-live.png`.
- The importer now explicitly uses UTF-8 and rejects already corrupted range labels before opening a SQL connection.
- No additional tests were added or run. No static/API runtime changes, restart or Hosting redeployment are needed for this SQL text correction.
