# Faculty Account and DOE Role Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the administrative UI, show effective DOE targets, import source workload roles into editable managed roles, and safely provision missing faculty Firebase accounts with audited role mappings.

**Architecture:** Pure CommonJS/browser modules calculate effective DOE, normalize roles, classify provisioning candidates, and build immutable Firestore payloads. Existing pages consume those helpers; Firebase Authentication account creation runs through a secondary app so the Owner session is retained. A separate owner-only migration page performs dry-run review before writes.

**Tech Stack:** Static HTML/CSS/JavaScript, Firebase 9 compat SDK, Firestore, Firebase Authentication, Node test runner, Firebase Firestore/Auth emulators.

**Spec:** `docs/superpowers/specs/2026-09-14-faculty-account-role-cleanup-design.md`

## Global Constraints

- Existing Owner, Administrator, and Other Office accounts must never be overwritten or demoted.
- The temporary password must not be committed, logged, stored in Firestore, or included in reports.
- New accounts must set `mustChangePassword: true`.
- Source workbook role data remains unchanged and every migration is idempotent.
- The existing primary `role` remains compatible with Firestore rules; `facultyRoles` records all faculty-facing roles.

---

### Task 1: Effective DOE helper and Timetable labels

**Files:**
- Create: `faculty-doe.js`
- Modify: `timetable.js`
- Modify: `index.html`
- Modify: `tools/static-assets.json`
- Test: `tests/faculty-doe.test.js`
- Test: `tests/timetable-multi-edit-ui.test.js`

**Interfaces:**
- Produces: `UCVM_FACULTY_DOE.effectiveTarget(faculty): { value: number|null, source: 'override'|'contract'|'none', reason: string }`
- Produces: `UCVM_FACULTY_DOE.targetLabel(faculty): string`

- [ ] **Step 1: Write the failing effective-target tests**

```js
test('override DOE wins over contract DOE',()=>assert.deepEqual(
  DOE.effectiveTarget({doe:{teaching:40},doeOverride2026_27:{value:25,reason:'RSL'}}),
  {value:25,source:'override',reason:'RSL'}));
test('contract DOE is used without an override',()=>assert.equal(
  DOE.effectiveTarget({doe:{teaching:40}}).source,'contract'));
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/faculty-doe.test.js tests/timetable-multi-edit-ui.test.js`
Expected: FAIL because `faculty-doe.js` and the effective DOE label are absent.

- [ ] **Step 3: Implement and consume the helper**

```js
function effectiveTarget(faculty){
  const override=number(faculty?.doeOverride2026_27?.value);
  if(override!==null)return{value:override,source:'override',reason:text(faculty?.doeOverride2026_27?.reason)};
  const contract=[faculty?.doe?.teaching,faculty?.doeTeaching,faculty?.teachingDOE,faculty?.contractTeachingDOE].map(number).find(v=>v!==null);
  return contract===undefined?{value:null,source:'none',reason:''}:{value:contract,source:'contract',reason:''};
}
```

Load the helper before `timetable.js`, replace contract-only text in faculty lists and the batch selector with `targetLabel`, and render a red `Override` badge when `source === 'override'`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/faculty-doe.test.js tests/timetable-multi-edit-ui.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add faculty-doe.js timetable.js index.html tools/static-assets.json tests/faculty-doe.test.js tests/timetable-multi-edit-ui.test.js
git commit -m "Show effective DOE targets in timetable"
```

### Task 2: Change History layout and theme

**Files:**
- Modify: `faculty-admin.html`
- Modify: `faculty-admin.css`
- Modify: `faculty-access.js`
- Test: `tests/page-modules.test.js`
- Test: `tests/audit-details.test.js`

**Interfaces:**
- Consumes: `UCVM.logs(element, options)` and `UCVM_AUDIT_DETAILS.entries(log)`.
- Produces: a full-width `.history-panel` with expandable details and wrapped values.

- [ ] **Step 1: Add failing structure and styling assertions**

```js
assert.match(html,/id="history-view" class="panel history-panel hidden"/);
assert.match(css,/\.history-panel\s*\{[^}]*width:\s*100%/s);
assert.match(css,/\.audit-table[^}]*table-layout:\s*fixed/s);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/page-modules.test.js tests/audit-details.test.js`
Expected: FAIL because the history-specific layout is absent.

- [ ] **Step 3: Implement the full-width themed history panel**

Add the standard panel heading and responsive table wrapper. Set stable widths for timestamp, actor, action, and record columns; give Before → After the remaining width; wrap text; keep `details` rows styled with the same red/gold palette.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/page-modules.test.js tests/audit-details.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add faculty-admin.html faculty-admin.css faculty-access.js tests/page-modules.test.js tests/audit-details.test.js
git commit -m "Unify and widen change history"
```

### Task 3: Role cleanup and account planning module

**Files:**
- Create: `faculty-account-planner.js`
- Create: `tools/migrate-faculty-roles.js`
- Modify: `faculty-admin-enhancements.js`
- Modify: `firestore.rules`
- Test: `tests/faculty-account-planner.test.js`
- Test: `tests/security-emulator.test.js`

**Interfaces:**
- Produces: `UCVM_ACCOUNT_PLANNER.normalizedManagedRoles(faculty): ManagedRole[]`
- Produces: `UCVM_ACCOUNT_PLANNER.facultyRoles(faculty): ('hicc'|'visc'|'faculty')[]`
- Produces: `UCVM_ACCOUNT_PLANNER.primaryRole(roles): 'hicc'|'visc'|'faculty'`
- Produces: `UCVM_ACCOUNT_PLANNER.plan(faculty, users, authEmails): ProvisionPlan`

- [ ] **Step 1: Write failing normalization and planning tests**

```js
test('source HICC and VISC roles become unique managed roles',()=>{
  const roles=planner.normalizedManagedRoles({facultySummary2026_27:{roles:[
    {type:'HICC',assignment:'VMED 501',doe:2},
    {type:'HICC',assignment:'VMED 501',doe:2},
    {type:'VISC',assignment:'VISC'}]}});
  assert.deepEqual(roles.map(x=>x.type),['HICC','VISC']);
});
test('HICC is primary while all faculty roles are preserved',()=>{
  assert.equal(planner.primaryRole(['visc','hicc','faculty']),'hicc');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/faculty-account-planner.test.js tests/security-emulator.test.js`
Expected: FAIL because planner and `facultyRoles` rule support do not exist.

- [ ] **Step 3: Implement stable role keys and safe merge behavior**

```js
const key=role=>[normalizeType(role.type),normalize(role.assignment),number(role.doe)||0].join('|');
function normalizedManagedRoles(faculty){
  const existing=Array.isArray(faculty.managedRoles2026_27)?faculty.managedRoles2026_27:[];
  const imported=sourceRoles(faculty).filter(supported).map(toManagedRole);
  return uniqueByKey([...existing,...imported],key);
}
```

The migration writes only changed faculty documents, adds `roleMigration2026_27`, `updatedBy`, and `updatedAt`, and writes `faculty_change_log` entries. Extend user create/update rule allowlists to accept `facultyRoles` only when it is a list whose values are in `['hicc','visc','faculty']`.

- [ ] **Step 4: Run focused and emulator tests and verify GREEN**

Run: `npm run test:emulator`
Expected: the full suite passes, including privileged-account preservation and accepted `facultyRoles` writes.

- [ ] **Step 5: Commit**

```bash
git add faculty-account-planner.js tools/migrate-faculty-roles.js faculty-admin-enhancements.js firestore.rules tests/faculty-account-planner.test.js tests/security-emulator.test.js
git commit -m "Normalize editable faculty workload roles"
```

### Task 4: Faculty-first User Management form

**Files:**
- Modify: `user-management.html`
- Modify: `user-management.js`
- Modify: `user-management.css`
- Modify: `tools/static-assets.json`
- Test: `tests/user-management.test.js`
- Test: `tests/runtime-assets.test.js`

**Interfaces:**
- Consumes: `UCVM_ACCOUNT_PLANNER.primaryRole` and `facultyRoles`.
- Produces: `identityFromFaculty(faculty): { facultyId, name, email }`.
- Produces: new-account form state with hidden UID and read-only derived identity.

- [ ] **Step 1: Write failing form behavior tests**

```js
assert.doesNotMatch(html,/id="account-name"[^>]*required/);
assert.doesNotMatch(html,/id="account-email"[^>]*required/);
assert.match(source,/identityFromFaculty/);
assert.match(source,/secondaryAuth/);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/user-management.test.js tests/runtime-assets.test.js`
Expected: FAIL because the form requires typed identity and has no secondary Auth instance.

- [ ] **Step 3: Implement derived identity and secondary Auth creation**

Create a readonly identity summary driven by `account-faculty`. Hide UID for new users and display it read-only for an existing user. Initialize a named secondary Firebase app from `UCVM.config`, call `createUserWithEmailAndPassword(email, temporaryPassword)`, capture `credential.user.uid`, sign the secondary app out, then write the Firestore profile and `account_audit` record from the Owner session.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/user-management.test.js tests/runtime-assets.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add user-management.html user-management.js user-management.css tools/static-assets.json tests/user-management.test.js tests/runtime-assets.test.js
git commit -m "Create faculty accounts from profile records"
```

### Task 5: Owner dry-run and bulk provisioning

**Files:**
- Modify: `user-management.html`
- Modify: `user-management.js`
- Modify: `user-management.css`
- Test: `tests/user-management.test.js`
- Test: `tests/faculty-account-planner.test.js`

**Interfaces:**
- Consumes: `UCVM_ACCOUNT_PLANNER.plan`.
- Produces: dry-run summary and reviewed execution loop with create/update/skip/error results.

- [ ] **Step 1: Write failing bulk-flow tests**

```js
assert.match(html,/id="account-bulk-preview"/);
assert.match(html,/id="account-bulk-run"[^>]*disabled/);
assert.match(source,/renderProvisionPlan/);
assert.match(source,/account_provisioned/);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/user-management.test.js tests/faculty-account-planner.test.js`
Expected: FAIL because the dry-run and execution controls are absent.

- [ ] **Step 3: Implement preview, execution, and reconciliation**

Preview loads active faculty plus current users, classifies all rows, and enables Run only for the exact preview revision. Run requests the temporary password without retaining it, processes accounts sequentially to avoid rate limits, records `account_provisioned` audits, and shows created/skipped/failed counts plus failed faculty IDs without passwords.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/user-management.test.js tests/faculty-account-planner.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add user-management.html user-management.js user-management.css tests/user-management.test.js tests/faculty-account-planner.test.js
git commit -m "Add reviewed faculty account provisioning"
```

### Task 6: Full verification, production migration, and deployment

**Files:**
- Modify: `SETUP.md`
- Verify: `tools/static-assets.json`

**Interfaces:**
- Consumes the complete UI, migration, planner, Firebase Auth, Firestore rules, and audit flow.
- Produces production role-cleanup and account-provisioning reconciliation reports without credentials.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`
Expected: all static tests pass.

Run: `npm run test:emulator`
Expected: all Firestore/Auth emulator tests pass.

- [ ] **Step 2: Run rendered QA**

Serve the allowlisted site locally and verify: Change History desktop width, Timetable Override DOE label, User Management faculty selection, account dry-run, desktop/mobile overflow, console warnings/errors, and one state-changing interaction in each modified flow.

- [ ] **Step 3: Run production role dry-run**

Run the owner migration utility in dry-run mode and record total faculty, changed faculty, imported roles, duplicates suppressed, invalid emails, existing accounts, protected privileged accounts, and accounts proposed for creation.

- [ ] **Step 4: Apply role cleanup and account provisioning**

Apply only the reviewed dry-run revision. Supply the temporary password at runtime, never as a command argument committed to a script or captured in a report. Stop on disabled Email/Password sign-in or systemic permission errors; continue past isolated duplicate/invalid records and report them.

- [ ] **Step 5: Reconcile production results**

Confirm every created Authentication UID has one matching `users/{uid}` profile, every profile has one `account_audit` creation entry, every new account requires password change, and no privileged account changed role or active status.

- [ ] **Step 6: Deploy and compare assets**

Deploy the same allowlisted build to Firebase Hosting and Azure Static Web Apps. Compare the hash of every allowlisted production asset against the local file and verify both entry pages load.

- [ ] **Step 7: Commit final documentation and push**

```bash
git add SETUP.md tools/static-assets.json
git commit -m "Document faculty account provisioning"
git push origin performance-cleanup
```
