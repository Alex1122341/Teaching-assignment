# Unified VISTA Lightweight Audit — 2026-09-19

## Scope and verified baseline

This audit is based on the unified security + DOE integration baseline commit:

- baseline SHA: `39e2e5f294eccc9d0dcdad372c03577d0e2577a8`
- parent security/database line: PR #46 / `0f5a7c9156634dc5a359c15198e18b4570b5b60e`
- parent DOE server-authority line: PR #45 / `f2e5c0453246c4b596b78649f66a75d58d6eac2d`
- integration review: Draft PR #48
- no merge to `main`, Azure production deployment, production Rules deployment, live-data migration, DOE publication, or production recalculation was performed.

Exact-head verification at this baseline:

- DOE API Test run `35465795318`: success.
- GitHub Pages Test Site run `35465795259`: success.
- Test run `35465795314`: success.
- static root suite: 715 tests / 626 passed / 89 emulator-gated skipped / 0 failed.
- static server suite: 112 / 112 passed.
- emulator root suite: 715 / 715 passed / 0 skipped / 0 failed.
- emulator server suite: 112 / 112 passed.
- static build: 62 files / 1,934,772 bytes.

The committed `firebase-config.js` remains a lab-targeting template with placeholder SDK values. Therefore the successful Pages workflow proves the exact-head test/emulator/build/staging/deployment pipeline, but not an authenticated browser session against the lab cloud project. Interactive cloud-preview acceptance requires CI/runtime injection of usable lab Firebase SDK configuration; production values must not be substituted.

## Executive finding

The repository is no longer meaningfully improved by deleting tests, historical plans, or small source modules. The remaining user-visible cost is deployment fragmentation:

- 62 browser deployment assets;
- 52 deployed JavaScript assets;
- Timetable: 31 direct local scripts / 352,176 JS bytes;
- Faculty Dashboard: 27 direct local scripts / 345,652 JS bytes;
- User Management: 11 direct local scripts / 101,788 JS bytes;
- Password: 4 direct local scripts / 25,907 JS bytes.

The current DOE server-authority cutover has already removed the browser policy engine/service modules from active deployment. Compared with the pre-integration DOE head, Timetable fell from 34 direct scripts / 459,729 bytes to 31 / 352,176 bytes, and Faculty Dashboard from 28 / 435,688 bytes to 27 / 345,652 bytes.

The recommended next optimization is therefore **modular source + deterministic deployment bundling**, not source-tree flattening or aggressive deletion.

## Repository versus deployment measurements

| Metric | Unified baseline |
|---|---:|
| Tracked files | 254 |
| Root files | 79 |
| All JavaScript files | 185 |
| JS test files under `tests/` | 86 |
| Documentation files under `docs/` | 32 |
| Tool files under `tools/` | 17 |
| Server-side files under `server/` | 32 |
| Browser deployment assets | 62 |
| Browser deployment JS assets | 52 |
| Browser deployment CSS assets | 5 |
| Browser deployment bytes | 1,934,772 |
| AFC PDF bytes | 1,042,973 |
| Browser deployment bytes excluding PDF | 891,799 |
| Browser deployment JS bytes | 742,264 |

## Per-page startup cost

| Page | Direct local JS requests | Direct JS bytes | Local CSS |
|---|---:|---:|---:|
| Timetable / `index.html` | 31 | 352,176 | 1 |
| Faculty Dashboard / `faculty-admin.html` | 27 | 345,652 | 2 |
| User Management | 11 | 101,788 | 2 |
| Password | 4 | 25,907 | 1 |

Intentional dynamic boundaries remain:

- `approval-workflow.js` — 83,683 B;
- `faculty-admin-enhancements.js` — 26,847 B;
- `faculty-swap-safe.js` — 21,174 B where loaded on demand by Timetable;
- `faculty-swap-handoff.js` — 190 B compatibility marker;
- `afc-form-values.js` — 1,169 B;
- `afc-pdf-browser.js` — 3,484 B;
- PDF-lib from CDN and the 1,042,973-byte AFC PDF template remain lazy.

## Existing runtime-read simplification status

The September 15 read-efficiency work is treated as implemented behavior, not an unchecked-plan backlog. Current tests and `PERFORMANCE_REPORT.md` retain the targeted-read, incremental-index, direct-audit, split-dataset, history-pagination, and lazy replacement-directory boundaries. Reimplementing those items is out of scope.

The integration also preserves:

- `firebase-config.js` before shared Firebase helpers;
- `settings/people_index` instead of broad faculty-role `/users` listing;
- append-only session/faculty audit logs;
- sanitized faculty-swap projection guards;
- DOE server-authority/browser-read-only cutover;
- exact-head emulator coverage for Rules and Auth boundaries.

## Approach comparison

### Approach A — conservative dead-code/tool cleanup

Benefits are small. No active browser runtime file is currently proven removable simply by grep/size.

- `tools/sync_ccc_public_schedule.js`: candidate orphan, but external/manual use has not been disproved. **Owner decision required; do not delete.**
- `tools/migrate-faculty-roles.js`: one-time migration helper. Retain until rollback/history value and operational retirement are explicitly confirmed.
- `faculty-swap-handoff.js`: still a compatibility source and must not be deleted merely because it is 190 bytes.
- Tests and historical design evidence are not deployment assets and should not be removed to improve a file-count metric.

Recommendation: keep Approach A limited to future proven orphans.

### Approach B — deployment bundling while retaining modular source

This is the recommended approach.

First stage constraints:

- no source minification;
- no tree shaking;
- no ESM migration;
- no broad source-directory move;
- source HTML remains readable and explicit;
- `tools/build-static.js` generates bundle artifacts and transformed deployment HTML;
- bundle order is deterministic and derived from the existing script order;
- startup/lazy boundaries are tested;
- source files remain independently testable and reviewable.

Measured target range:

- deployed JS assets: 52 → approximately 18–24;
- Timetable direct JS requests: 31 → approximately 8–12;
- Faculty Dashboard: 27 → approximately 9–12;
- User Management: 11 → approximately 5–6;
- Password: 4 → approximately 3;
- per-page startup JS bytes: effectively unchanged apart from small bundle separators;
- total generated JS bytes must remain within a documented small overhead ceiling; prototype must be revised if duplication exceeds 5%.

### Approach C — source-tree reorganization

Rejected for this project phase. Moving files under `src/` would change paths across HTML, tests, manifests, build tooling and history while not reducing bytes or request count.

## Candidate bundle topology

The first implementation should prototype bundles only from verified ordered sequences. Candidate shared/runtime groups include:

- `faculty-scheduling.bundle.js`: `faculty-doe.js` + `scheduling-core.js`;
- `data-audit.bundle.js`: `data-index.js` + `index-maintenance.js` + `audit-details.js`;
- `identity.bundle.js`: `firebase-config.js` + `faculty-access.js`;
- page-specific Timetable approval/app groups;
- Faculty DOE-admin and Faculty admin groups;
- User Management page group;
- lazy approval workflow bundle where compatibility order can be preserved;
- lazy AFC-PDF helper bundle.

The prototype may keep small cross-page files standalone if combining them would reorder execution or duplicate too many bytes. Request reduction is not permission to alter semantics.

## Cacheability finding

Current Firebase Hosting configuration sends `no-cache, max-age=0, must-revalidate` for HTML/JS/CSS. Content hashing and immutable caching may provide a later benefit, but it is explicitly **Phase 2** and not part of the first bundling change. First establish bundle correctness with current caching semantics.

## File classification summary

| Category | Files | Bytes |
|---|---:|---:|
| active product documentation | 7 | 59,138 |
| build/deployment tooling | 13 | 30,373 |
| candidate orphan / owner decision | 1 | 4,230 |
| dependency/build metadata | 3 | 378,386 |
| deployed browser runtime | 62 | 1,934,772 |
| deployed DOE API runtime | 14 | 143,760 |
| historical evidence/design/plan | 29 | 637,905 |
| migration/maintenance tooling | 7 | 97,462 |
| non-deployed shared source/support | 7 | 125,674 |
| repository configuration | 2 | 824 |
| security/hosting configuration | 5 | 85,007 |
| test/support | 104 | 671,732 |

No generated/untracked build output is part of the tracked-file inventory.

## Complete tracked-file classification

The table below classifies every tracked blob at the verified baseline. A file being non-deployed does not make it deletable; tests, server runtime, security configuration and historical evidence are intentionally retained.

| File | Category | Bytes |
|---|---|---:|
| `.firebaserc` | security/hosting configuration | 149 |
| `.gitattributes` | repository configuration | 692 |
| `.github/workflows/azure-production-deploy.yml` | build/deployment tooling | 2,702 |
| `.github/workflows/azure-static-web-apps.yml` | build/deployment tooling | 1,306 |
| `.github/workflows/doe-api-test.yml` | build/deployment tooling | 908 |
| `.github/workflows/github-pages-test.yml` | build/deployment tooling | 1,916 |
| `.github/workflows/test.yml` | build/deployment tooling | 835 |
| `.gitignore` | repository configuration | 132 |
| `absence-from-campus-app.pdf` | deployed browser runtime | 1,042,973 |
| `account-profile.js` | deployed browser runtime | 2,699 |
| `afc-actions.js` | deployed browser runtime | 3,370 |
| `afc-form-state.js` | deployed browser runtime | 573 |
| `afc-form-values.js` | deployed browser runtime | 1,169 |
| `afc-pdf-browser.js` | deployed browser runtime | 3,484 |
| `afc-timetable-panel.js` | deployed browser runtime | 4,088 |
| `afc-workflow.js` | deployed browser runtime | 15,313 |
| `AGENTS.md` | active product documentation | 3,105 |
| `approval-finalizer.js` | deployed browser runtime | 4,595 |
| `approval-lifecycle.js` | deployed browser runtime | 12,981 |
| `approval-office-view.js` | deployed browser runtime | 1,999 |
| `approval-request.js` | deployed browser runtime | 7,945 |
| `approval-routing.js` | deployed browser runtime | 1,633 |
| `approval-scheduling.js` | deployed browser runtime | 772 |
| `approval-state.js` | deployed browser runtime | 3,371 |
| `approval-workflow.js` | deployed browser runtime | 83,683 |
| `asset-loader.js` | deployed browser runtime | 2,161 |
| `audit-details.js` | deployed browser runtime | 3,177 |
| `availability-lookup.js` | deployed browser runtime | 5,494 |
| `bulk-import-backup.js` | deployed browser runtime | 7,971 |
| `bulk-import-controller.js` | deployed browser runtime | 29,340 |
| `bulk-import-core.js` | deployed browser runtime | 6,806 |
| `bulk-import-firestore.js` | deployed browser runtime | 11,004 |
| `bulk-import-ui.js` | deployed browser runtime | 17,000 |
| `calendar-session-maintenance.js` | deployed browser runtime | 2,310 |
| `calendar-session.js` | deployed browser runtime | 1,364 |
| `data-index.js` | deployed browser runtime | 14,162 |
| `derived-index-health.js` | deployed browser runtime | 11,103 |
| `docs/database/CONFIGURATION.md` | active product documentation | 5,154 |
| `docs/database/SCHEMA.md` | active product documentation | 16,884 |
| `docs/doe-api-deployment.md` | active product documentation | 3,897 |
| `docs/superpowers/plans/2026-09-14-faculty-account-role-cleanup.md` | historical evidence/design/plan | 13,713 |
| `docs/superpowers/plans/2026-09-14-timetable-faculty-afc-consolidation.md` | historical evidence/design/plan | 27,933 |
| `docs/superpowers/plans/2026-09-15-azure-pr-preview-deployment.md` | historical evidence/design/plan | 23,823 |
| `docs/superpowers/plans/2026-09-15-github-pages-test-azure-production.md` | historical evidence/design/plan | 36,114 |
| `docs/superpowers/plans/2026-09-15-runtime-read-and-code-simplification.md` | historical evidence/design/plan | 11,782 |
| `docs/superpowers/plans/2026-09-16-safe-bulk-import-recovery.md` | historical evidence/design/plan | 40,331 |
| `docs/superpowers/plans/2026-09-17-approval-routing-roles-privacy.md` | historical evidence/design/plan | 60,637 |
| `docs/superpowers/plans/2026-09-17-derived-index-verification-rebuild.md` | historical evidence/design/plan | 52,192 |
| `docs/superpowers/plans/2026-09-17-scheduling-core.md` | historical evidence/design/plan | 26,064 |
| `docs/superpowers/plans/2026-09-17-workstream-5-self-review-amendments.md` | historical evidence/design/plan | 8,249 |
| `docs/superpowers/plans/2026-09-18-doe-policy-engine.md` | historical evidence/design/plan | 35,154 |
| `docs/superpowers/plans/2026-09-18-university-closures-timetable.md` | historical evidence/design/plan | 37,741 |
| `docs/superpowers/plans/2026-09-19-unified-annual-doe-rulebook.md` | historical evidence/design/plan | 50,283 |
| `docs/superpowers/specs/2026-09-14-faculty-account-role-cleanup-design.md` | historical evidence/design/plan | 5,300 |
| `docs/superpowers/specs/2026-09-14-timetable-faculty-afc-consolidation-design.md` | historical evidence/design/plan | 9,220 |
| `docs/superpowers/specs/2026-09-15-azure-pr-preview-deployment-design.md` | historical evidence/design/plan | 10,476 |
| `docs/superpowers/specs/2026-09-15-github-pages-test-azure-production-design.md` | historical evidence/design/plan | 17,150 |
| `docs/superpowers/specs/2026-09-15-runtime-read-and-code-simplification-design.md` | historical evidence/design/plan | 9,302 |
| `docs/superpowers/specs/2026-09-16-bulk-import-recovery-design.md` | historical evidence/design/plan | 11,434 |
| `docs/superpowers/specs/2026-09-16-derived-index-verification-rebuild-design.md` | historical evidence/design/plan | 18,162 |
| `docs/superpowers/specs/2026-09-17-approval-routing-roles-privacy-design.md` | historical evidence/design/plan | 25,488 |
| `docs/superpowers/specs/2026-09-17-approval-routing-spark-finalization-addendum.md` | historical evidence/design/plan | 4,900 |
| `docs/superpowers/specs/2026-09-17-scheduling-core-design.md` | historical evidence/design/plan | 8,072 |
| `docs/superpowers/specs/2026-09-18-doe-policy-engine-design.md` | historical evidence/design/plan | 40,224 |
| `docs/superpowers/specs/2026-09-18-university-closures-timetable-design.md` | historical evidence/design/plan | 13,834 |
| `docs/superpowers/specs/2026-09-19-unified-annual-doe-rulebook-design.md` | historical evidence/design/plan | 28,828 |
| `docs/testing/2026-09-17-ws5a-browser-checklist.md` | historical evidence/design/plan | 4,847 |
| `docs/testing/2026-09-17-ws5b-foundation-verification.md` | historical evidence/design/plan | 3,692 |
| `docs/testing/2026-09-17-ws5b-progress.md` | historical evidence/design/plan | 2,960 |
| `doe-api-client.js` | deployed browser runtime | 5,949 |
| `doe-formula.js` | non-deployed shared source/support | 9,029 |
| `doe-policy-admin.css` | deployed browser runtime | 7,882 |
| `doe-policy-admin.js` | deployed browser runtime | 36,693 |
| `doe-policy-engine.js` | non-deployed shared source/support | 21,285 |
| `doe-policy-firestore.js` | non-deployed shared source/support | 24,432 |
| `doe-policy-repository.js` | non-deployed shared source/support | 21,189 |
| `doe-policy-service.js` | non-deployed shared source/support | 46,407 |
| `doe-rulebook-admin.js` | deployed browser runtime | 18,639 |
| `doe-worksheet-view.js` | deployed browser runtime | 5,882 |
| `faculty-access.css` | deployed browser runtime | 4,256 |
| `faculty-access.js` | deployed browser runtime | 14,771 |
| `faculty-account-planner.js` | deployed browser runtime | 7,687 |
| `faculty-admin-enhancements.js` | deployed browser runtime | 26,847 |
| `faculty-admin.css` | deployed browser runtime | 29,591 |
| `faculty-admin.html` | deployed browser runtime | 37,859 |
| `faculty-admin.js` | deployed browser runtime | 73,469 |
| `faculty-doe.js` | deployed browser runtime | 2,117 |
| `faculty-swap-handoff.js` | deployed browser runtime | 190 |
| `faculty-swap-safe.js` | deployed browser runtime | 21,174 |
| `firebase-config.js` | deployed browser runtime | 2,651 |
| `firebase.json` | security/hosting configuration | 717 |
| `firestore.indexes.json` | security/hosting configuration | 2,203 |
| `firestore.rules` | security/hosting configuration | 81,805 |
| `index-maintenance.js` | deployed browser runtime | 23,085 |
| `index.html` | deployed browser runtime | 13,004 |
| `information-center.js` | deployed browser runtime | 4,053 |
| `maintenance-state.js` | deployed browser runtime | 8,110 |
| `office-capabilities.js` | deployed browser runtime | 1,770 |
| `package-lock.json` | dependency/build metadata | 377,084 |
| `package.json` | dependency/build metadata | 1,109 |
| `password.html` | deployed browser runtime | 1,810 |
| `password.js` | deployed browser runtime | 2,337 |
| `PERFORMANCE_REPORT.md` | active product documentation | 7,818 |
| `scheduling-core.js` | deployed browser runtime | 4,690 |
| `server/.env.example` | non-deployed shared source/support | 141 |
| `server/package.json` | dependency/build metadata | 193 |
| `server/README.md` | non-deployed shared source/support | 3,191 |
| `server/src/app.js` | deployed DOE API runtime | 5,025 |
| `server/src/auth/firebase-auth.js` | deployed DOE API runtime | 932 |
| `server/src/doe/calculation-service.js` | deployed DOE API runtime | 12,807 |
| `server/src/doe/firestore-repository.js` | deployed DOE API runtime | 31,026 |
| `server/src/doe/legacy-policy-runtime.js` | deployed DOE API runtime | 10,548 |
| `server/src/doe/policy-admin-service.js` | deployed DOE API runtime | 15,001 |
| `server/src/doe/reserve-service.js` | deployed DOE API runtime | 4,148 |
| `server/src/doe/rulebook-service.js` | deployed DOE API runtime | 17,088 |
| `server/src/doe/target-service.js` | deployed DOE API runtime | 3,298 |
| `server/src/doe/workflow-preview-service.js` | deployed DOE API runtime | 14,001 |
| `server/src/doe/worksheet-service.js` | deployed DOE API runtime | 5,652 |
| `server/src/http/errors.js` | deployed DOE API runtime | 782 |
| `server/src/routes/doe-routes.js` | deployed DOE API runtime | 18,544 |
| `server/src/server.js` | deployed DOE API runtime | 4,908 |
| `server/test/app.test.js` | test/support | 3,083 |
| `server/test/calculation-service.test.js` | test/support | 5,686 |
| `server/test/doe-routes.test.js` | test/support | 16,215 |
| `server/test/firestore-repository.test.js` | test/support | 21,825 |
| `server/test/guideline-rules.test.js` | test/support | 2,781 |
| `server/test/guideline-scenarios.test.js` | test/support | 2,139 |
| `server/test/legacy-policy-runtime.test.js` | test/support | 1,861 |
| `server/test/policy-admin-service.test.js` | test/support | 8,330 |
| `server/test/reserve-service.test.js` | test/support | 3,384 |
| `server/test/role-assignment.test.js` | test/support | 2,656 |
| `server/test/rulebook-service.test.js` | test/support | 14,696 |
| `server/test/server-wiring.test.js` | test/support | 2,626 |
| `server/test/target-service.test.js` | test/support | 1,699 |
| `server/test/workflow-preview-service.test.js` | test/support | 6,110 |
| `server/test/worksheet-service.test.js` | test/support | 5,532 |
| `session-guard.js` | deployed browser runtime | 6,148 |
| `SETUP.md` | active product documentation | 19,094 |
| `signature-capture.js` | deployed browser runtime | 5,856 |
| `staticwebapp.config.json` | security/hosting configuration | 133 |
| `test-support/afc-policy.js` | test/support | 2,575 |
| `test-support/policy.js` | test/support | 1,215 |
| `test-support/source-function.js` | test/support | 674 |
| `tests/account-profile.test.js` | test/support | 4,065 |
| `tests/afc-timetable-integration.test.js` | test/support | 13,191 |
| `tests/afc-withdraw-security-emulator.test.js` | test/support | 3,967 |
| `tests/afc.test.js` | test/support | 11,833 |
| `tests/approval-lifecycle-security-emulator.test.js` | test/support | 8,293 |
| `tests/approval-lifecycle.test.js` | test/support | 9,626 |
| `tests/approval-request.test.js` | test/support | 6,947 |
| `tests/approval-security-emulator.test.js` | test/support | 4,472 |
| `tests/approval.test.js` | test/support | 24,664 |
| `tests/audit-log-append-only-emulator.test.js` | test/support | 4,468 |
| `tests/audit.test.js` | test/support | 20,078 |
| `tests/azure-deployment.test.js` | test/support | 4,703 |
| `tests/bulk-import-controller.test.js` | test/support | 17,980 |
| `tests/bulk-import-maintenance-security-emulator.test.js` | test/support | 7,728 |
| `tests/bulk-import.test.js` | test/support | 14,307 |
| `tests/calendar-session-maintenance-security-emulator.test.js` | test/support | 3,014 |
| `tests/calendar-session-security-emulator.test.js` | test/support | 5,791 |
| `tests/calendar.test.js` | test/support | 7,094 |
| `tests/data-index.test.js` | test/support | 5,558 |
| `tests/derived-index-health.test.js` | test/support | 5,477 |
| `tests/doc-references.test.js` | test/support | 3,350 |
| `tests/doe-api-consumers.test.js` | test/support | 12,283 |
| `tests/doe-api-packaging.test.js` | test/support | 1,179 |
| `tests/doe-assignment-migration.test.js` | test/support | 3,461 |
| `tests/doe-canonical-consistency.test.js` | test/support | 3,266 |
| `tests/doe-formula.test.js` | test/support | 3,385 |
| `tests/doe-no-client-policy.test.js` | test/support | 3,247 |
| `tests/doe-policy-admin.test.js` | test/support | 5,970 |
| `tests/doe-policy-engine.test.js` | test/support | 14,276 |
| `tests/doe-policy-mapping-rules.test.js` | test/support | 764 |
| `tests/doe-policy-migration.test.js` | test/support | 7,772 |
| `tests/doe-policy-preview.test.js` | test/support | 8,147 |
| `tests/doe-policy-publication.test.js` | test/support | 13,271 |
| `tests/doe-policy-recalculate.test.js` | test/support | 12,514 |
| `tests/doe-policy-repository.test.js` | test/support | 6,335 |
| `tests/doe-policy-security-emulator.test.js` | test/support | 13,803 |
| `tests/doe-policy-timetable-integration.test.js` | test/support | 11,369 |
| `tests/doe-rulebook-admin.test.js` | test/support | 6,158 |
| `tests/doe-worksheet-view.test.js` | test/support | 3,691 |
| `tests/emulator-isolation.test.js` | test/support | 3,497 |
| `tests/faculty-self-dashboard-security-emulator.test.js` | test/support | 1,756 |
| `tests/faculty-swap-security-emulator.test.js` | test/support | 5,824 |
| `tests/faculty-swap.test.js` | test/support | 10,698 |
| `tests/faculty.test.js` | test/support | 14,253 |
| `tests/firebase-config.test.js` | test/support | 3,362 |
| `tests/firestore-cleanup.test.js` | test/support | 3,367 |
| `tests/github-pages.test.js` | test/support | 9,003 |
| `tests/history-visibility.test.js` | test/support | 1,273 |
| `tests/hosting-boundary.test.js` | test/support | 2,981 |
| `tests/index-maintenance-emulator.test.js` | test/support | 7,891 |
| `tests/index-maintenance-rebuild-race.test.js` | test/support | 1,930 |
| `tests/index-maintenance.test.js` | test/support | 12,170 |
| `tests/information-signature-availability.test.js` | test/support | 2,182 |
| `tests/legacy-approval-companion-emulator.test.js` | test/support | 5,094 |
| `tests/maintenance-state.test.js` | test/support | 3,690 |
| `tests/office-capabilities.test.js` | test/support | 4,297 |
| `tests/office-timetable-rules.test.js` | test/support | 1,045 |
| `tests/office-timetable-security-emulator.test.js` | test/support | 5,664 |
| `tests/page-modules.test.js` | test/support | 5,162 |
| `tests/password-flow.test.js` | test/support | 2,499 |
| `tests/password-security-emulator.test.js` | test/support | 2,517 |
| `tests/people-index-security-emulator.test.js` | test/support | 5,659 |
| `tests/policy.test.js` | test/support | 1,734 |
| `tests/projection-sanitization.test.js` | test/support | 5,173 |
| `tests/read-efficiency.test.js` | test/support | 3,435 |
| `tests/rules-evaluation-budget.test.js` | test/support | 4,517 |
| `tests/runtime-assets.test.js` | test/support | 6,819 |
| `tests/scheduling-core.test.js` | test/support | 3,989 |
| `tests/scheduling.test.js` | test/support | 7,279 |
| `tests/security-emulator.test.js` | test/support | 10,299 |
| `tests/session-guard.test.js` | test/support | 1,729 |
| `tests/sessional-tab.test.js` | test/support | 700 |
| `tests/setup-office-linking.test.js` | test/support | 718 |
| `tests/swap-calendar-highlight.test.js` | test/support | 900 |
| `tests/targeted-reads.test.js` | test/support | 5,167 |
| `tests/timetable-multi-edit-ui.test.js` | test/support | 6,698 |
| `tests/timetable-selection.test.js` | test/support | 12,367 |
| `tests/timetable-university-closures.test.js` | test/support | 8,683 |
| `tests/timetable.test.js` | test/support | 12,351 |
| `tests/university-closures.test.js` | test/support | 2,386 |
| `tests/user-management.test.js` | test/support | 3,436 |
| `tests/workflow-notification-security-emulator.test.js` | test/support | 4,354 |
| `tests/workflow-notification.test.js` | test/support | 8,200 |
| `tests/ws5a-approval-actions.test.js` | test/support | 6,678 |
| `tests/ws5a-behavior.test.js` | test/support | 10,152 |
| `tests/ws5b-security-matrix-emulator.test.js` | test/support | 7,570 |
| `timetable-selection.js` | deployed browser runtime | 18,683 |
| `timetable.css` | deployed browser runtime | 42,961 |
| `timetable.js` | deployed browser runtime | 162,016 |
| `tools/build-doe-api.js` | build/deployment tooling | 1,587 |
| `tools/build-firebase-config.js` | build/deployment tooling | 3,393 |
| `tools/build-static.js` | build/deployment tooling | 1,536 |
| `tools/deploy_azure_static_web.ps1` | build/deployment tooling | 4,386 |
| `tools/doe-policy-2026-27-seed.json` | migration/maintenance tooling | 27,540 |
| `tools/export_firestore_rest.py` | migration/maintenance tooling | 6,144 |
| `tools/import_firestore_azure_sql.ps1` | migration/maintenance tooling | 8,290 |
| `tools/migrate-faculty-roles.js` | migration/maintenance tooling | 1,099 |
| `tools/optimize_firestore_data.py` | migration/maintenance tooling | 15,710 |
| `tools/plan-doe-assignment-migration.js` | build/deployment tooling | 3,222 |
| `tools/README.md` | active product documentation | 3,186 |
| `tools/seed-database.js` | migration/maintenance tooling | 8,223 |
| `tools/seed/dataset.js` | migration/maintenance tooling | 30,456 |
| `tools/stage-github-pages.js` | build/deployment tooling | 3,869 |
| `tools/static-assets.json` | build/deployment tooling | 1,567 |
| `tools/sync_ccc_public_schedule.js` | candidate orphan / owner decision | 4,230 |
| `tools/test-static.js` | build/deployment tooling | 3,146 |
| `university-closures.js` | deployed browser runtime | 4,227 |
| `user-management.css` | deployed browser runtime | 4,899 |
| `user-management.html` | deployed browser runtime | 7,273 |
| `user-management.js` | deployed browser runtime | 20,601 |
| `workflow-notifications.js` | deployed browser runtime | 5,052 |

## Decision

Proceed with Approach B after owner review of the accompanying design and implementation plan. Do not perform broad source reorganization, test/doc deletion, minification, cache-policy changes, or maintenance-tool deletion in the same change.
