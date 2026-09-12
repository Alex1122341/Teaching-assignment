# AFC And Audit Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add role-scoped change history, remove Assigned AD, highlight active DOE overrides, and provide a signed absence-from-campus request and approval workflow that produces one private read-only PDF.

**Architecture:** Keep browser reads small by loading history and AFC data only when their tabs open. Put AFC validation, report-to routing, approval, faculty-record updates, PDF generation, and file authorization in Firebase callable functions; keep the generated PDF private in Cloud Storage. Firestore rules enforce self-only history for all roles except ADFA Regular and ADFA General.

**Tech Stack:** Static HTML/CSS/JavaScript, Firebase Auth, Firestore, Cloud Functions v2, Cloud Storage, pdf-lib, Node test runner.

**Spec:** User request dated 2026-09-12 and `C:/Users/xinyu/Desktop/absence-from-campus-app.pdf`

## Global Constraints

- Other Office can perform its existing operational work but sees only its own history.
- ADFA Regular and ADFA General see all change history.
- Approved AFC PDFs are immutable to browser clients and readable only by the requester, routed report-to approver, and ADFA administrators.
- Workday calculation excludes weekends and published UCalgary closures for 2026-2027.
- Business/Other requires purpose and destination; teaching during the requested range requires coverage details.

---

### Task 1: Role-scoped history and account logs

**Files:**
- Modify: `faculty-access.js`
- Modify: `firestore.rules`
- Create: `firestore.indexes.json`
- Test: `tests/history-visibility.test.js`

**Interfaces:**
- Produces: `UCVM.historyAll(profile): boolean` and filtered paginated history queries.

- [ ] Write tests proving ADFA roles can query all records and Other Office/faculty queries include `changedBy == uid`.
- [ ] Run the tests and confirm they fail.
- [ ] Implement the role helper, include account audit entries in the visible history, and tighten Firestore reads.
- [ ] Run the tests and confirm they pass.

### Task 2: Faculty lookup cleanup and DOE override badge

**Files:**
- Modify: `faculty-admin.html`
- Modify: `faculty-admin-enhancements.js`
- Modify: `functions/index.js`
- Test: `tests/faculty-lookup.test.js`

**Interfaces:**
- Produces: highlighted `doeOverride2026_27` badge and idempotent `removeAssignedAdFields` callable.

- [ ] Write tests proving Assigned AD is absent and active overrides render beside the faculty name.
- [ ] Run the tests and confirm they fail.
- [ ] Remove Assigned AD from lookup, editor, filters, search and exports; add the badge and cleanup callable.
- [ ] Run the tests and confirm they pass.

### Task 3: AFC policy and callable workflow

**Files:**
- Create: `functions/afc-policy.js`
- Modify: `functions/index.js`
- Modify: `functions/package.json`
- Copy: `functions/templates/absence-from-campus-app.pdf`
- Test: `tests/afc-policy.test.js`

**Interfaces:**
- Produces: `submitAfcRequest`, `listAfcRequests`, `reviewAfcRequest`, `getAfcPdf` callable functions.

- [ ] Write tests for workdays, holidays, required business purpose, required teaching coverage, and state transitions.
- [ ] Run the tests and confirm they fail.
- [ ] Implement validation, report-to resolution, signatures, approval, faculty AFC update, private PDF generation and authorized download.
- [ ] Render a generated sample and inspect both pages for clipping or stale fields.
- [ ] Run tests and confirm they pass.

### Task 4: AFC dashboard user interface

**Files:**
- Modify: `faculty-dashboard.html`
- Modify: `faculty-dashboard.js`
- Create: `afc-workflow.js`
- Modify: `faculty-access.css`
- Modify: `tools/deploy_azure_static_web.ps1`
- Test: `tests/afc-ui.test.js`

**Interfaces:**
- Consumes: AFC callable functions and `UCVM_FACULTY_DATA`.
- Produces: request form, assignment warning, coverage field, electronic signature, approval queue, and PDF download.

- [ ] Write tests for required controls and lazy loading.
- [ ] Run the tests and confirm they fail.
- [ ] Implement the dashboard tab and workflow UI.
- [ ] Run syntax, unit, and rules tests.

### Task 5: Deploy, migrate, verify and estimate reads

**Files:**
- Modify: `firebase.json`
- Modify: `README_FIRST.txt` if deployment behavior needs documentation.

**Interfaces:**
- Produces: deployed Firebase and Azure websites, deployed rules/indexes/functions, Assigned AD cleanup result, and documented read estimates.

- [ ] Deploy functions, rules, indexes and Firebase Hosting.
- [ ] Run the one-time Assigned AD cleanup and verify no records retain the field.
- [ ] Deploy Azure Static Web Apps.
- [ ] Verify role-scoped history, AFC form/approval/PDF, override badge and both hosts in Chrome.
- [ ] Calculate per-login and daily Firestore reads using observed query sizes and explain how long 50,000 reads lasts.
