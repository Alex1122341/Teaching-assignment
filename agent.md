# First visit: understand this repository

PAWS helps UCVM staff coordinate teaching, faculty workload/DOE, appointments, absence, changes and approvals. This repository is the **Testing** line, `UCVM-Teaching-Assignment/Teaching-assignment`. Its normal Pages deployment is a synthetic, browser-local **PAWS Frontend Demo**. Firebase Lab is a separate, manually selected mode. The real SQL Beta is a different repository and deployment.

## Read in this order

1. [AGENTS.md](AGENTS.md): working rules and required checks.
2. [Environment map](docs/architecture/testing-environments.md): identify the selected mode, source tree and actual authority before editing.
3. [PAWS Constitution](PAWS_CONSTITUTION.md): mandatory product rules. Policy is not a claim that every old screen already complies.
4. [Role matrix](docs/security/role-matrix.md): read the row for the feature and authority being changed; check its code references and gaps.
5. [Graphify guide](docs/architecture/script-dependency-graph.md): query the index **before tracing imports, calls, build wiring or change impact**, then verify current source. Refresh a missing or stale graph.
6. [Manual acceptance](docs/acceptance/PAWS_TESTING_MANUAL_ACCEPTANCE.md): find the affected test IDs, run them in the stated lane, and record actual results.

## Establish a breakpoint

Record the remote, branch/HEAD, clean or dirty state, selected build mode and test-site PR/SHA. Historical SQL/Azure reports and copied Beta code are reference material; they do not make this site a production backend. Preserve another person's uncommitted work.

Finish with a precise handoff: files changed, commit/PR, tests executed versus skipped, environment tested, evidence and remaining gaps. After every merge, rebuild Graphify from the exact merged main and verify a representative edge against source. Never convert Demo results into real Auth, SQL, email, storage or security signoff.
