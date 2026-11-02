# PAWS Testing: maximum ten GitHub branches

**Repository:** UCVM-Teaching-Assignment/Teaching-assignment (not the Beta SQL repository). The cap is **10 total**, including the default branch main. Up to **9 additional branch references** are retained for short-term recovery. This policy does not touch PAWS, Firestore, University SQL or the Testing website's synthetic data.

## Automation

The workflow in .github/workflows/branch-retention.yml runs after a PR targeting main is **merged** (not merely closed), every day at **07:17 UTC**, and by manual workflow_dispatch. A manually triggered workflow defaults to a dry run.

When the total branch count exceeds ten, it removes the **oldest eligible merged-PR branch** first, keeping newer branches until the count is at most ten. The candidate's current SHA must exactly match the head SHA of a PR actually merged into main from the same repository. The job re-fetches branch state and open PRs immediately before each deletion. GitHub has no conditional branch DELETE, so a very small race with a concurrent push remains; do not push to obsolete merged feature branches during cleanup.

**Never automatically delete:** main, GitHub-protected branches, branches used by open PRs, branches with changes since the corresponding merge, branches without proven merged-PR history at their current SHA, or long-lived master/develop/development/production/release/*/hotfix/*/stable/*/archive/*/backup/* branches. Failed/closed-but-unmerged PRs are retained.

When these exclusions make the ten-branch cap impossible, the workflow fails with an explicit report. A maintainer must merge, archive or review the extra branches manually; the script cannot silently erase unmerged work.

GitHub's native repository setting delete_branch_on_merge intentionally remains **OFF**. Enabling it would immediately delete *all* merged branches and defeat the user-requested ten-branch recovery buffer.

## Permissions, proof and restoration

The workflow uses GITHUB_TOKEN with contents: write and pull-requests: read, and rejects execution outside this exact Testing repository. If organization policy blocks deletion, the job will fail with the GitHub API status. The summary identifies candidate names, dates and deletions. A passing dry-run or planner test does not by itself verify live deletion permission.

Git commits/merged PRs remain in history after branch refs are removed. To restore a previously deleted branch, recreate the ref from the merged PR's recorded head SHA (while that Git object is available). Keeping ten refs is **not** a reliable offsite backup; use release tags or independent backups for durable recovery.

Root Node tests: tests/branch-retention.test.js verify the ten-total cap, oldest-first pruning, active PR protection, moved/unmerged refs, protected and reserved names, fork evidence rejection and fail-closed validation. No synthetic or real PAWS database data is altered by these tests.
