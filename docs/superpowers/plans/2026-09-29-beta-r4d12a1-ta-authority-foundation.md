# PAWS Beta R4D12A1 Teaching Assignment Authority Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dormant, forward-only Azure SQL/domain foundation for read-only Teaching Assignment authority without changing the live runtime, UI, DOE semantics, or `SessionAssignment`.

**Architecture:** Add one additive SQL proposal migration under `paws` for Subject, stable HICC/VISC responsibilities, exact HICC course/subject scopes, temporal Faculty assignees, groups, deterministic package metadata, and separate Session ownership. Add pure CommonJS authority/identity helpers and a parameterized SELECT-only repository; keep all modules unmounted from the API.

**Tech Stack:** Azure SQL T-SQL proposal, Node.js 22 CommonJS, Node built-in test runner.

**Spec:** Architect #3 instruction `PAWS BETA-R4D-12A1 SQL TEACHING ASSIGNMENT AUTHORITY FOUNDATION` in the task conversation; Experimental oracle `Teaching-assignment` PR #76 head `6ce74ef832d5d3a801d48d5e3cb03943c7cc47a1`.

## Global Constraints

- Start from Beta main `51ef5d1ba4a1a4595f69e1ba6dcc6ff581cd70bb` and use branch `feature/beta-r4d12a1-ta-authority-foundation`.
- No live SQL apply, SQL data writes, deployment, UI cutover, API route mounting, Firebase/Firestore change, RBAC change, UserProfile change, or DOE modification.
- `SessionAssignment` remains the authoritative final faculty assignment; no final-suggestion table is added.
- Authorization resolves authenticated person -> `UserProfile.FacultyId` -> active temporal assignment; BaseRole and role labels are insufficient.
- Temporal windows are half-open: `activeDate <= asOfDate < expirationDate`; overlap is invalid.
- SQL is additive, rerun-safe where practical, constrained, indexed, FK-aware, and non-destructive.

## Review Focus

1. A Subject key must be canonical and must never be inferred from `Session.Topic`; tests cover normalization and topic non-substitution.
2. A responsibility must remain stable while Faculty assignees change; tests cover handoff, scheduled/expired windows, and overlap rejection.
3. HICC authority must be exact Course plus exact Subject (or documented course-wide scope), while VISC authority is group leadership; tests cover wrong group, wrong course, wrong subject, and role-only forgery.
4. Package identity must remain unchanged across assignee changes and approval metadata must go stale on either revision or fingerprint drift; tests cover deterministic identity and stale approvals.
5. The repository must be SELECT-only and parameterized, with no `staging` reference or runtime registration; static tests pin these safety properties.

### Task 1: Repository baseline and domain contract tests

**Files:**
- Create: `server/test/teaching-assignment-authority.test.js`
- Create: `server/test/sql-teaching-assignment-repository.test.js`

**Interfaces:** Tests specify `server/foundation/teaching-assignment/authority.js` pure functions, package identity helpers, and `server/foundation/sql-teaching-assignment-repository.js` read-only methods.

- [x] Write failing tests for exact subject/responsibility/scope/temporal/group/package/authority behavior and repository safety.
- [x] Run the focused Node tests and confirm failure is due to missing modules/functions.

### Task 2: Pure domain authority and package identity

**Files:**
- Create: `server/foundation/teaching-assignment/authority.js`

**Interfaces:** Export `normalizeSubjectKey`, `normalizeCourseCode`, `subjectRecord`, `responsibilityRecord`, `packageIdentity`, `isCurrentTemporalAssignee`, `isFacultyCurrentAssignee`, `isPackageFresh`, and `workingSessionOwnership`.

- [x] Implement only the behaviors pinned by Task 1, with fail-closed validation and no persistence or browser APIs.
- [x] Run focused domain tests and then commit the pure domain unit.

### Task 3: Additive SQL proposal migration

**Files:**
- Create: `database/azure-sql/005_teaching_assignment_authority_foundation.sql`
- Modify: `server/test/teaching-assignment-authority.test.js` only if static migration assertions need a dedicated section.

**Interfaces:** Define additive `paws.Subject`, `paws.TeachingResponsibility`, `paws.TeachingResponsibilityScope`, `paws.TeachingResponsibilityAssignee`, `paws.TeachingAssignmentGroup`, `paws.TeachingAssignmentGroupHicc`, `paws.TeachingAssignmentPackage`, and `paws.TeachingSessionOwnership` with required FKs/checks/indexes and no changes to existing tables.

- [x] Add rerun-safe existence guards and DDL/static-contract assertions.
- [x] Verify no DML, drops, alters, staging references, `SessionAssignment` semantic changes, or live apply command is introduced.

### Task 4: SELECT-only repository, plan review, regression verification, commit/push

**Files:**
- Create: `server/foundation/sql-teaching-assignment-repository.js`
- Create: `server/test/sql-teaching-assignment-repository.test.js`

**Interfaces:** Export `createSqlTeachingAssignmentRepository({query})` with `getActorResponsibilities`, `getResponsibility`, `getResponsibilityScopes`, `getResponsibilityAssignees`, `getGroupsForResponsibility`, `getPackage`, `listPackagesForActor`, and `getWorkingSessionOwnership`.

- [x] Implement parameterized SELECT-only methods against `paws` objects, without mounting the repository in any router.
- [x] Run focused tests, the full Beta root/server suites, static freeze/API checks, and inspect the final diff for DOE/UI/runtime drift.
- [x] Commit and push only the feature branch; do not open/merge a release PR.
