# Coursedog-inspired PAWS Demo Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task with tests first.

**Goal:** Extend the existing PR #96 browser-local PAWS Testing Demo with academic-year selector, selective rollover, unified calendar/course context, lifecycle phases, publication review, and cross-year teaching/DOE comparison.

**Architecture:** Extend `frontend/scripts/multi-year-demo-model.js` pure store API; integrate a shared top-level year selector into `frontend/scripts/multi-year-demo.js` UI. Keep persistence in its versioned browser-local Demo store. No original PAWS data-path rewrites or database changes.

**Tech Stack:** Node 22, browser vanilla JS, localStorage, node:test, PAWS Pages build/browser smoke.

**Spec:** `docs/superpowers/specs/2026-10-29-coursedog-inspired-demo-enhancements.md`.

## Global constraints
- Existing PR `docs/paws-multi-year-design-20261029`; no new PR, no merge.
- No SQL/Firestore/Firebase/Beta write; only Demo test state.
- The May 1–April 30 year boundary, Published-only historical copying, per-Course publishing and DOE privacy remain authoritative.
- Opening a new year stays blank; rollover is optional, explicit and non-destructive.

## Review focus
- Unschedulable rollover sessions remain Draft and cannot silently be published.
- Instructor references must be rechecked against active/eligible faculty; copied DOE Overrides never survive rollover.
- The next-year selector must not cause the original legacy Calendar to show 2026–27 data under a 2027–28 label.
- Phase markers must not bypass existing Course-level authorization or Retire/Restore restrictions.
- DOE and instructor comparison must use published records and self-only Faculty scope.

### Task 1 — Model: selective rollover
**Files:** Modify `frontend/scripts/multi-year-demo-model.js`. Create `tests/multi-year-coursedog.test.js`.
**Interface:** `previewRollover(actor,{fromYear,toYear,code,options})` read-only and `rolloverCourse(actor, request)` atomic new annual Course.

- [ ] Write tests for blank default new year, Catalog-only copy, sessions without times, schedule rollover year shift, faculty eligibility, denied overwrite, and Published-only source.
- [ ] Run red: `node --test tests/multi-year-coursedog.test.js`.
- [ ] Implement minimal behavior, validate all references before mutating state; preserve provenance in working only.
- [ ] Run green and existing model suite, commit.

### Task 2 — Model: publish review, phases and comparison
**Files:** Modify `frontend/scripts/multi-year-demo-model.js`, `tests/multi-year-coursedog.test.js`.
**Interfaces:** `setYearPhase(actor,year,phase)`, `previewPublication(actor,year,code)`, `compareYears(actor,fromYear,toYear)`.

- [ ] Write tests for approval/scope, blocked invalid date, warning on AFC, immutable previous Published release and comparative DOE visibility.
- [ ] Run red tests; implement source Published release diff and validation projection.
- [ ] Run green, commit.

### Task 3 — UX: shared top year selector, rollover wizard and release review
**Files:** Modify `frontend/scripts/multi-year-demo.js`, `frontend/styles/multi-year-demo.css`, `tools/paws-browser-smoke.js`, and relevant acceptance doc.
**Interfaces:** New UI controls use model methods only; header selector shares per-user year setting, navigation to Demo Calendar on future year; rollover wizard (preview, options, confirm), phases and review; comparison panel.

- [ ] Write smoke or integration tests asserting widget availability/functional state changes.
- [ ] Run red; implement UI controls in the Testing-only scripts without changing the legacy calendar engine.
- [ ] Run Node tests and browser smoke through CI. Update PR #96 metadata and manual checklist; leave Draft.

## Done criteria
All new Node tests passing and PAWS Pages CI verified for the exact PR SHA, with no Beta or database modifications. Do not claim real authentication or migration validation from Demo checks.
