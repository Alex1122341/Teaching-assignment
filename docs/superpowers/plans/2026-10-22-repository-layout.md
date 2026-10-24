# Repository Layout Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this same-PR source cleanup. Work on `chore/retire-azure-frontend-coupling-20261022`, not main.

**Goal:** Organize the source and remove duplicated build logic without changing any public application behavior.

**Architecture:** Move the existing 85 browser assets into `frontend/{pages,scripts,styles,assets}`. Keep the public asset manifest and flattened build outputs unchanged. One shared static builder and an explicit source-path resolver support both build entrypoints and tests.

**Tech Stack:** Existing Node.js 22, plain JavaScript/HTML/CSS, Firebase Hosting; no dependency additions.

**Spec:** `docs/architecture/repository-layout.md`.

## Global Constraints
- Same PR #133; do not merge, deploy or mutate live SQL/API resources.
- Public URLs and runtime bytes remain identical to checkpoint `8249a331a2069d2172db304cc7dff586a7f8df02`.
- Preserve all historical freeze/authorization evidence and current API inputs.
- Only source layout, shared build plumbing, tests and documentation change.

## Review Focus
- Missing, duplicate or unsafe asset names must not delete a previous valid static bundle.
- Symlink inputs/output parents must not escape the repository.
- Historical Git revisions use their own directory layout, not today's working tree.
- CommonJS imports, test function extractors and browser URL references are different path contracts.
- A module that blocks legacy writes or maintains compatibility is not dead code by inspection alone.

## Task 1: Pin the unchanged public contract
- [x] Add `tests/repository-layout.test.js`: source relocation, unchanged 85 assets, shared builder, root guide.
- [x] Run it against the old layout; observe four expected failures.

## Task 2: Organize sources and share build implementation
- [x] Create `tools/build/frontend-paths.js` and `tools/build/static-bundle.js`.
- [x] Move browser files into four folders without rewriting their contents.
- [x] Delegate `tools/build-static.js` and `tools/build-beta-release.js` to the shared builder.
- [x] Update explicit test source reads/imports and `test-support/source-function.js`.
- [x] Update frozen working-source resolution and Firebase deployment's exact-commit API-origin lookup.
- [x] Add repeatability, manifest-validation, output-boundary and symlink tests.

## Task 3: Documentation and non-runtime cleanup
- [x] Add root and frontend README maps and relocate the historical performance report.
- [ ] Refresh current setup/agent continuity without rewriting historical decisions.
- [ ] Run regression suites and frozen artifact checks; fix evidenced path regressions only.
- [ ] Review the complete diff, commit and push to existing PR #133.
- [ ] Verify final exact-HEAD CI; record actual results in the PR, not assumed success.
