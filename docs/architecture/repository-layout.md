# Repository organization and simplification

> **Historical PR #133 work journal (2026-10-22).** The checkboxes below record the original implementation and are not pending tasks for current agents. Refer to the [current environment map](testing-environments.md) for source/build ownership.

## Goal and scope
The Owner requested additional cleanup in existing PR #133: make source easier to locate, simplify unnecessary repetition, and preserve the active application. Starting checkpoint: `8249a331a2069d2172db304cc7dff586a7f8df02`.

## Decisions
- Move all 85 public-source files out of the root into `frontend/pages` (5 HTML), `frontend/scripts` (66 JS), `frontend/styles` (13 CSS), and `frontend/assets` (1 public PDF template).
- Preserve public URLs, HTML script/style order, module-relative imports and all browser file bytes. This is a source-layout refactor, not a URL migration or business rewrite.
- Keep CLI configuration and dependency manifests at the root; they have tool-defined locations.
- Keep established server/domain, database, test, deployment and operational tool directories. Do not move operational scripts without evidence that every caller is updated.
- Replace the duplicated static copy loops with `tools/build/static-bundle.js`. Both existing build entrypoints delegate to it. No new package dependency is needed.
- Resolve source locations in one small explicit helper. Tests use `repositoryPath` or direct organized module imports; no global fs patch, symlink aliases or duplicate root files are introduced.
- Historical Git revisions must be read with their own source layout. `sourcePathAtCommit` recognizes the committed frontend README marker; immutable historical commits continue to use original paths. Firebase deployment reads its API-origin configuration from the requested commit, not the current checkout.

## Simplification audit
Removed: duplicate static-file copying/manifest-validation implementation in the two build entrypoints; root-level copies of browser source; ambiguous root file organization; the loose historical performance report (relocated, not erased).

Retained deliberately: runtime authorization and fail-closed legacy interfaces, frozen historical acceptance receipts, SQL migrations, shared `swa-*` University API modules, and deployed business functions. A small or apparently inactive module is not proven dead solely by its name. Deleting legacy approval guards, import recovery, role compatibility or security tests would require a separate dependency/behavior audit.

Deferred: split of the large `timetable.js` and `faculty-admin.js` into smaller business modules, and removal of non-database Azure deployment infrastructure. Combining those changes with physical relocation would obscure review and regressions. Their current features and security gates remain intact.

## Verification contract
1. All four new layout tests fail on the pre-refactor tree (observed: 0 pass / 4 fail).
2. All 85 moved source files compare to immutable PR133 checkpoint content under existing CRLF canonicalization; the public manifest remains exactly unchanged.
3. Static and combined builds have the same public contents and URLs. Only allowlisted assets are packaged.
4. Missing/duplicate/traversal input and unsafe output paths fail closed; invalid input must not delete a previous good static bundle.
5. Root, API and Firebase Emulator regression suites; source and built-artifact freezes; exact-PR CI.
6. No database, live API, Firebase project, production deployment, permission or write-gate changes. No merge is authorized by this cleanup.

## Existing protections
The immutable runtime anchor remains `f78b10a1401bcb8675f8fd5414ec3d98eafa1ffd` because published runtime bytes and public manifest have not changed. `tools/beta-freeze.js` reads working assets from organized source but still compares every byte to immutable Git blobs. The previous product/governance receipt is checked against its historical accepted checkpoint, and new layout tests separately prove current source equivalence. Do not update reporting hashes to hide drift.

## Execution checklist
- [x] Inspect current PR branch, clean workspace and dependency paths.
- [x] Add failing layout tests.
- [x] Move sources, centralize build logic and retain public paths.
- [x] Update test imports/source reads and Firebase source-origin lookup.
- [x] Add root/frontend guides and preserve the historical performance report.
- [ ] Run complete test suites, review diff, resolve real regressions.
- [ ] Push to the existing PR branch, verify final CI and update PR evidence.
