# PAWS Multi-Academic-Year Frontend Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Implement a testable, synthetic browser-local PAWS multi-academic-year workspace in the Testing repository; postpone every database and Beta step.

**Architecture:** Introduce a small pure state-transition model using the existing \`UCVM_PAWS_DEMO_API.store.tables\` synthetic data as a bootstrap input, then expose the agreed workflows through a browser-only modal accessible from the main PAWS pages. Use a separate namespace/key for multi-year demo state to avoid corrupting existing single-year sample workflows. Preserve all existing pages and compile-time assets.

**Tech Stack:** Vanilla JS, browser localStorage, UMD CommonJS export for Node tests, existing \`frontend/\` PAWS pages, existing \`tools/static-assets.paws.json\`, Node \`node:test\` and GitHub Pages PAWS Demo workflow.

**Spec:** \`docs/superpowers/specs/2026-10-29-multi-academic-year-management-design.md\` (2026-10-29 Demo-only addendum overrides backend implementation details)

## Global Constraints
- Work only in \`UCVM-Teaching-Assignment/Teaching-assignment\` and default PAWS Demo mode; no SQL/Firestore/Firebase Lab/Beta changes.
- Use synthetic sample records, no real names/UCIDs; save browser-local changes only and mark simulated permissions non-authoritative.
- Calendar remains home. Preserve other current workflows and CSS tokens.
- Academic years start May 1 and end April 30; canonical key \`YYYY-YY\`.
- Course Catalog is shared, annual Course metadata snapshotted; next-year Courses, Sessions, Assignments empty at creation.
- Publish per annual Course by authorized scoped Course publisher only, after recorded finalization; separate initial DOE publication.
- Working changes never leak into Faculty Published; Archived Faculty Calendar denied while own Published Teaching/DOE remains.
- Owner-only Retire/Restore; full audit/immutable conflict snapshot; restoration recomputes against the latest shared AFC.
- Keep all long-term Beta SQL notes in \`docs/architecture/multi-year-beta-migration-notes.md\`.

## Review Focus
1. Existing synthetic roles have July-June dates; rollover must not mistake them for full May-Apr terms. Add a distinct full-year eligible fixture.
2. A role label alone cannot grant publication rights to unrelated Courses; compare actor scope against exact per-Course publisher list.
3. Retire with pending Draft must preserve Published and original archived conflict snapshot; Restore must not republish Draft.
4. Faculty direct year navigation must not render archived Calendar or another person's DOE.
5. Reload/reset and stale storage states should restore valid v1 snapshot without corrupting the rest of PAWS.

---

### Task 1: Document scope and implement pure multi-year demo state
**Files:**
- Create: \`frontend/scripts/multi-year-demo-model.js\`
- Test: \`tests/multi-year-demo-model.test.js\`
- Modify: \`docs/superpowers/specs/2026-10-29-multi-academic-year-management-design.md\`
- Create: \`docs/architecture/multi-year-beta-migration-notes.md\`

**Interfaces:**
- Produces: \`PAWS_MULTI_YEAR_DEMO_MODEL.createEngine({storage,source,now})\` exposing \`getState()\`, \`createYear(actor,year)\`, \`addCourse(actor,year,code)\`, \`addSession(actor,year,code,session)\`, \`editAssignment(actor,year,code,sessionId,facultyId)\`, \`finalizeCourse(actor,year,code)\`, \`publishCourse(actor,year,code)\`, \`approvePolicy(actor,year)\`, \`publishDoe(actor,year)\`, \`setOverride(actor,year,facultyId,value)\`, \`retireYear(actor,year)\`, \`restoreYear(actor,year)\`, \`getTeaching(actor,year)\`, \`getCalendar(actor,year)\`, \`getDoe(actor,year)\`, \`getConflicts(actor,year)\`, \`addAfc(actor,item)\`, \`copyHistorical(actor,year,code,sessionId,sourceId)\` and \`confirmRole(actor,year,roleId)\`. All mutations validate year/role/scope/state and persist locally.

- [ ] Step 1: Write Node tests for bootstrap 2026-27 Published parity and empty new year; expect FAIL.
- [ ] Step 2: Run \`node --test tests/multi-year-demo-model.test.js\`; verify FAIL.
- [ ] Step 3: Implement model and dates, year/scoped actions, release/version audit, DOE, roles, conflict snapshot. Keep state small and JSON-serializable.
- [ ] Step 4: Run tests; expect PASS.
- [ ] Step 5: Commit feature with tests.

### Task 2: Interactive multi-year Demo workspace
**Files:**
- Create: \`frontend/scripts/multi-year-demo.js\`
- Create: \`frontend/styles/multi-year-demo.css\`
- Modify: \`frontend/pages/index.html\`, \`frontend/pages/faculty-admin.html\`, \`frontend/pages/teaching-assignments.html\`
- Modify: \`tools/static-assets.paws.json\`

**Interfaces:** Consumes the Task 1 engine and \`window.UCVM_PAWS_DEMO_API.store.tables\` plus simulated Firebase Auth UID; exposes browser-only modal sections Calendar, Courses/Working/Published/History, DOE, Annual Roles, Archive/Restore and Course Catalog. Uses event delegation and user-safe HTML encoding.

- [ ] Step 1: Add tests/assertions for mounted script paths and manifest entries; expect FAIL.
- [ ] Step 2: Implement modal shell, role/year selector, stateful panels and mutation confirmation. Clearly mark browser-local simulation.
- [ ] Step 3: Add assets to PAWS manifest and link only from PAWS pages.
- [ ] Step 4: Verify tests and generated demo HTML; commit.

### Task 3: Regression and user handoff
**Files:**
- Test: \`tests/multi-year-demo-model.test.js\`
- Modify: \`docs/acceptance/PAWS_TESTING_MANUAL_ACCEPTANCE.md\` (new multi-year Demo section) and, if needed, the authoritative JSON/Excel case catalog on a separate exact-sync update.

- [ ] Step 1: Exercise 2026/27 migration, 2027/28 creation, per-Course publish, DOE Pending/publish, override, role eligibility, Owner archive/restore, history Calendar denial.
- [ ] Step 2: Run \`npm test\`, \`npm run test:all\`, build PAWS Demo, stage GitHub Pages, browser smoke, preserving existing failures honestly.
- [ ] Step 3: Record exact PR/SHA, screenshots/issues and Demo-only acceptance limitations. Do not merge or ship Beta without Owner acceptance.
- [ ] Step 4: Commit final testing docs and leave PR open for user manual review.

## Deferred: Beta
SQL design/migration and actual authentication/permissions live only in the separate MD. No database implementation or SQL test signoff in this plan.
