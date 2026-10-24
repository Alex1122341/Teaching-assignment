# PAWS Beta Repository Hygiene Audit

**Repository:** `Alex1122341/Teaching-assignment-azure`
**Audit date:** 2026-10-04
**Before cleanup:** 56 remote branches (including `main`), 9 open pull requests
**Main at audit start:** `783777f2dd0693cbc521ebc625817872514c2ada`

## Branch classification before cleanup

The 41 refs below were ancestors of the audit-start `origin/main`. Their commits are already reachable through main history, so deleting those branch refs does not remove the commits.

### A. `MERGED_INTO_MAIN` — 41

`docs/beta-r4d11-final-release-closure`, `feature/azure-sql-cutover-foundation`, `feature/b3b-fc1-vetmedops-cutover`, `feature/b3b-vetmedops-frontend-api-cutover`, `feature/beta-b2b-login-ux-performance`, `feature/beta-r4d10a-dashboard-api-read`, `feature/beta-r4d10a-live-principal-grant`, `feature/beta-r4d10a2-dashboard-api-complete`, `feature/beta-r4d10a2-grant-safe-counts`, `feature/beta-r4d10b-dashboard-api-client-auth`, `feature/beta-r4d11a-dashboard-ui-doe-parity`, `feature/beta-r4d11c-dual-runtime-governance`, `feature/beta-r4d12a1-ta-authority-foundation`, `feature/beta-r4d12a5-concurrent-responsibility-assignees`, `feature/beta-r4d12b0-approval-queue-real-data-cleanup`, `feature/beta-r4d12b1-afc-dashboard-write-foundation`, `feature/beta-r4d12b1d-r-afc-unfiltered-list`, `feature/beta-r4d12b2a-auth-continuity`, `feature/beta-r4d9b-aca-direct`, `feature/beta-r4d9e-calendar-period-mapping`, `feature/beta-r4d9g-unpositioned-session-visibility`, `feature/beta-r4d9h-admin-timetable-access`, `feature/beta-r4d9j-session-time-reconciliation`, `feature/beta-r4d9j2-owner-24h-session-patch`, `feature/p2a-doe-target-domain`, `feature/p3-beta-end-to-end-cutover`, `feature/p3-stage-a-activation-prep`, `feature/p3b1-afc-request-sql-foundation`, `feature/p3b2-afc-approval-foundation`, `feature/p3b3-afc-frontend-api`, `feature/p3b4-afc-approved-artifact`, `feature/vetmedops-university-api-host`, `feature/vetmedops-windows-auth-runtime`, `fix/azure-beta-freeze-hardening`, `fix/beta-r4d10a-academic-year-format`, `fix/beta-r4d10a-dashboard-405-binding`, `fix/beta-r4d10a-readonly-proof-hasperms`, `fix/beta-r4d11g2-acr-tag-guard`, `task/beta-r1-connect-azure-sql`, `task/beta-r4d4-aca-packaging`, `task/beta-r4d6a-acr-oidc-publish`.

### B. `FULLY_SUPERSEDED` — 2

| Branch | Head at audit | Reason |
|---|---|---|
| `feature/beta-azure-sql-runtime-read` | `d9244f5b0a841470ebf1a67b043f59c4b83ad9c2` | The earlier 44-file SQL read candidate is replaced by the current P3 University API/runtime and SQL-backed UI in main. PR #4 is stale and based on an obsolete cutover branch. |
| `feature/p3a-self-service-afc-write` | `d71841b7c7d1264fc73719e6d02b07618f5b592d` | The earlier dashboard API write path is superseded by the current authenticated SQL AFC request APIs; it must not restore legacy Firestore business writes. |

### C. `UNIQUE_VALID_WORK` — 3, integrated into stabilization

| Branch | Head at audit | Disposition |
|---|---|---|
| `feature/beta-b2b-mobile-login-recovery` | `c64c943d85cec9a5621b2cd5dd933196f99d9567` | Integrated: bounded transient mobile login bootstrap retry and regression coverage. |
| `feature/beta-performance-always-on` | `d0d63adcfe9db4678eeaa1219fe5f48a4a27052a` | Integrated: full-session prefetch/navigation continuity and performance coverage. |
| `feature/beta-navigation-continuity` | `06a9d54a65d7445dcf30d369a078e8a76710733a` | Integrated: dashboard navigation continuity; merge commit is in the stabilization branch. |

### D. `OBSOLETE / ABANDONED` — 7 historical documentation snapshots

These branches contain chronological state snapshots from superseded Beta milestones. They are not current operating instructions; preserve each exact head in this record, close its stale PR when applicable, then remove its remote ref.

| Branch | Head at audit | Open PR |
|---|---|---|
| `docs/agent-ai-beta-r2b-r3-blocked` | `93d1bb955efaada69eedc500e3b4769bb747c5d9` | #9 |
| `docs/agent-ai-pr3-merged` | `de82417275a163a78764dafdee00cc997f1ceb4a` | #10 |
| `docs/azure-separation-architecture` | `d625414dbe7ec0cd29c8783cb025d90d4dad2c8f` | #2 |
| `docs/beta-a1-adfa-general-access` | `b3f2dea751fec1e6835ab827e0e8296c77ca4d20` | #12 |
| `docs/beta-r2-preview-update` | `70fc44a865c1943992010ffcec3336bcec6da32a` | #8 |
| `docs/beta-r3a2-pr6-main-integration` | `0ac4fd20203b7336e95bbd1b44aabc89fcbe135f` | #11 |
| `docs/beta-r3b-main-promotion-continuity` | `07fe9d12a1f5639fe56d1e63807ccc69f4a4dea1` | #13 |

### E. `ACTIVE_FUTURE_WORK` — 2 retained

| Branch | Head at audit | Why retained |
|---|---|---|
| `docs/agent-ai-continuity` | `486f67bb3a62c0312cd94dfa2be324590ad59eec` | Contains the useful agent handoff, architecture, domain, data-model, workflow, and release continuity system. |
| `feature/faculty-enrichment-phase-a` | `a940902018315ca983ec2d6d362a1c1231247e07` | Contains unique schema and read-only preview work. Its blank-FTE default of 1.0 conflicts with the no-inference rule, so PR #5 is closed as blocked while the branch is retained for future review. Do not execute its import or infer FTE. |

## Open PR disposition before cleanup

At audit start all 9 PRs were open and drafts. None is safe to merge as-is. Close #2, #4, and #8–#13 with a short reason tied to the classifications above; close #5 while retaining its unique branch because its current FTE default violates the source-authority rule. The stabilization feature branch carries the reviewed current changes in one replacement PR.

## Cleanup result

The audit began at 56 remote branches and 9 open PRs. The stabilization branch and PR #48 raised the cleanup-time inventory to 57 branches and 10 open PRs. After merge and cleanup, GitHub has 3 branches and 0 open PRs.

- **Merged:** PR #48, `PAWS: post-P3 Beta stabilization`, merged with merge commit `e03fd867c4b5af36a2d980e7a515bd13af2d34d3`.
- **Closed as superseded, obsolete, or blocked:** PRs #2, #4, #5, and #8–#13. PR #5's branch remains because it contains unique future schema/preview work; its unsafe blank-FTE default is not approved.
- **Retained branches:** `docs/agent-ai-continuity` for current agent handoff/architecture memory; `feature/faculty-enrichment-phase-a` for unique schema and read-only preview work pending a corrected no-inference contract.
- **Deleted remote refs:** merged refs, superseded/obsolete refs, and the completed stabilization ref after their heads were documented above or made reachable from `main`.

The deployed stabilization main was `e03fd867c4b5af36a2d980e7a515bd13af2d34d3`. Its exact-main build and SQL migration checks succeeded (runs `37255508927` and `37255508911`); ACR publish, ACA deploy, and Static Deploy succeeded (runs `37255826375`, `37255946409`, and `37256161825`).
