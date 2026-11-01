# Markdown documentation cleanup — 2026-11-01

**Source:** PAWS Testing repository, PR #99 checkpoint. Reviewed all **198** tracked Markdown files by title, content and purpose. Compared current workflow/build sources and searched GitHub references for all proposed removals.

## Changes

- Removed **36** redundant, superseded or one-off Beta release/freeze/promotion/reconciliation notes (approximately 98 KB). Every original is recoverable from Git history.
- Removed a duplicate root-level performance report (the historical retained copy is `docs/performance/2026-legacy-performance-report.md`).
- Removed the superseded 2026-10-20 Dashboard History reset presentation note; `docs/dashboard-history-archive-restoration-20261020.md` preserves its replacement decision.
- Kept the main Faculty Availability full acceptance report and other substantial safety evidence; removed repeated interim reconciliation/freeze notes.
- Replaced the old 27 KB Spark/Azure `docs/SETUP.md` with the current Testing setup and explicit historical production/account caveats.
- Marked legacy Firebase Pages proposals, preliminary port stages, old DOE/data quality snapshots and outdated architecture checklists as historical.
- Updated the documentation map, active organization URL and legacy URL assertions in tests.

## Retained intentionally

- Product constitution and all current agent rules; mandatory PR public `CHANGELOG.json`.
- Role/security authority matrix, environment/Graphify documentation, database/schema/migration and recovery runbooks.
- All **80** `docs/superpowers/specs/` and `docs/superpowers/plans/` design records; these document prior decisions and include paths protected by `tests/doc-references.test.js`. They are **not** current commands.
- Audit/acceptance reports with substantive evidence, including production/rollback distinctions.

## Ongoing documentation policy

Use [the current documentation map](../README.md) and verify the actual authority/mode. Keep a single current setup per deployment mode. Do not append another one-file-per-commit freeze/release note when the public PR `CHANGELOG.json` already records the change. Run document reference tests, exact-head CI and browser Demo smoke before interpreting a change as deployed.
