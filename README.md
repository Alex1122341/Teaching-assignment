# PAWS Testing

This is **UCVM-Teaching-Assignment/Teaching-assignment**, the teaching-assignment and workload application's Testing repository. It provides a cloud-free PAWS Frontend Demo, an explicitly selected Firebase Lab path, and reusable API/policy tests. It is not the deployed University SQL Beta service.

Start with [agent.md](agent.md). Agents must also read [AGENTS.md](AGENTS.md).

- [PAWS Constitution](PAWS_CONSTITUTION.md): product invariants, names, privacy and approval boundaries.
- [Environment and source map](docs/architecture/testing-environments.md): which application each build actually serves.
- [Role matrix](docs/security/role-matrix.md): permissions by authority, with source references and known differences.
- [Script relationships / Graphify](docs/architecture/script-dependency-graph.md): checked-in snapshot, refresh commands and limitations.
- [English manual acceptance checklist](docs/acceptance/PAWS_TESTING_MANUAL_ACCEPTANCE.md): all Beta feature families, with Demo versus backend evidence separated.

## Preview the current PAWS Frontend Demo

Use Node22. Install root and server dependencies (`npm ci` and `npm ci --prefix server`). Build with:

```powershell
node tools/build-static.js
node tools/build-paws-pages.js
node tools/stage-github-pages.js --directory .deploy-static --mode paws --pr 1 --head-sha <40-character-commit-SHA> --build-sha <same-SHA>
python -m http.server 19069 --bind 127.0.0.1 --directory .deploy-static
```

The example PR1 is a local preview label, not deployment evidence. Open `http://127.0.0.1:19069/` and verify its TEST SITE / Frontend Demo banner. Only synthetic data belongs here. The role tester and simulated sign-in do not establish real authentication or security acceptance.

The shared Pages address is derived from this organization/repository: `https://ucvm-teaching-assignment.github.io/Teaching-assignment/`. Confirm the current banner, PR/SHA and mode before testing: same-repository PR workflows publish to a shared URL that can be replaced by another run. Publishing a Firebase Lab artifact requires a separate explicit operator action.

Run `npm test` and `npm run test:all` for repository checks. See workflow definitions for emulator and browser prerequisites. A successful test does not publish or certify Beta.
