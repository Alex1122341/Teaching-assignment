# Bulk Session Entry and Outlook Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add fast spreadsheet-style session creation, simplify the faculty teaching surfaces, and give administrators a reviewable Outlook invitation export.

**Architecture:** Extend the existing single-file timetable UI and Firestore batch-write pattern without adding a new backend. Keep `faculty-dashboard.html` focused on list/history/AFC and generate Outlook invitations locally from already-authorized timetable and Faculty Directory data.

**Tech Stack:** Static HTML/CSS/JavaScript, Firebase Auth and Firestore compat SDK, Node test runner, Firebase Hosting, Azure Static Web Apps.

**Spec:** `docs/superpowers/plans/2026-09-13-bulk-session-outlook-design.md`

## Global Constraints

- Preserve current Firestore role checks and session audit logging.
- Cap bulk creation at 200 rows / 400 Firestore writes.
- Faculty calendar matching must prefer linked Faculty Directory ID and fall back to normalized names.
- Outlook export must never send invitations or alter calendars without Microsoft authorization.
- Keep Firebase and Azure deployments on the same committed source.

---

### Task 1: Faculty landing and simplified page surfaces

**Files:**
- Modify: `index.html`
- Modify: `faculty-dashboard.html`
- Modify: `faculty-dashboard.js`
- Test: `tests/timetable-bulk-outlook.test.js`

**Interfaces:**
- Consumes: `roleIsFaculty(currentUser)`, `myTimetableOnly`, and the existing timetable filters.
- Produces: Faculty login state `{viewMode:'day', myTimetableOnly:true}` and a dashboard with list/history/AFC only.

- [x] **Step 1: Write failing static behavior tests** for the faculty Day/My Timetable default and absence of the duplicate dashboard calendar and Latest Updates panel.
- [x] **Step 2: Run `node --test tests/timetable-bulk-outlook.test.js`** and confirm the missing behavior fails.
- [x] **Step 3: Update the timetable login initialization and remove dashboard calendar markup/listeners.**
- [x] **Step 4: Remove the Latest Updates sidebar and move export controls to a compact bottom bar.**
- [x] **Step 5: Re-run the focused test and confirm it passes.**

### Task 2: Spreadsheet-style bulk session creation

**Files:**
- Modify: `index.html`
- Test: `tests/timetable-bulk-outlook.test.js`

**Interfaces:**
- Consumes: `ensureFacultyDirectory()`, `academicPositionForDate()`, `finalizeInstructorAssignments()`, and `firestoreSafeSession()`.
- Produces: `openBulkSessionForm()`, `parseBulkPaste(text)`, `validateBulkRows(rows)`, and `saveBulkSessions(rows)`.

- [x] **Step 1: Add failing tests** for the bulk button, editable row table, add/duplicate/paste/remove controls, 200-row cap, faculty resolution, validation, and atomic session plus audit writes.
- [x] **Step 2: Run the focused tests and confirm they fail because the bulk editor is absent.**
- [x] **Step 3: Implement the editable table and tab-separated paste parser.**
- [x] **Step 4: Implement faculty resolution, availability warnings, row validation, and one Firestore batch commit.**
- [x] **Step 5: Re-run the focused tests and confirm they pass.**

### Task 3: Admin Outlook invitation package

**Files:**
- Modify: `index.html`
- Test: `tests/timetable-bulk-outlook.test.js`

**Interfaces:**
- Consumes: `ensureAllSessions()`, `ensureFacultyDirectory()`, `exportFilteredRows()`, and Faculty Directory emails.
- Produces: `openOutlookInviteDialog()` and `exportOutlookInvites(rows, organizer)`.

- [x] **Step 1: Add failing tests** for an admin-only Outlook control, preview/confirmation copy, `METHOD:REQUEST`, organizer, attendees, and filtered-session reuse.
- [x] **Step 2: Run the focused tests and confirm the feature is absent.**
- [x] **Step 3: Implement a preview dialog and local invitation-package generation without external transmission.**
- [x] **Step 4: Re-run focused and full tests.**

### Task 4: Browser QA and deployment

**Files:**
- Verify: `index.html`, `faculty-dashboard.html`
- Deploy: Firebase Hosting and Azure Static Web Apps

**Interfaces:**
- Consumes: committed static files.
- Produces: matching live Firebase and Azure pages.

- [x] **Step 1: Run JavaScript syntax checks, `git diff --check`, and all Node/Emulator tests.**
- [x] **Step 2: Use the available Browser integration to verify the timetable, bulk dialog, compact export bar, Outlook preview, faculty default state, and responsive layout.**
- [x] **Step 3: Deploy Firebase and Azure, then verify live markers and HTTP 200 responses.**
- [x] **Step 4: Commit, push `main`, and verify the remote commit.**

