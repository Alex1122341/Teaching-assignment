# Workstream 5B ADC/LAB Approval Routing, Privacy & Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add formal ADC/LAB roles, role-scoped timetable tools, sanitized calendar reads, field-owned multi-office approvals, push-back/resubmission/withdraw, workflow notifications, and AFC withdrawal without exposing private Faculty data to ADC/LAB.

**Architecture:** Keep one logical timetable-change request while physically separating data by privacy boundary: requester-visible sanitized request data, office-only routing/approval records, and ADFA-only private Faculty assignment data. ADC/LAB read `calendar_sessions` instead of private `sessions`; every source-session write keeps the sanitized read model synchronized. Pure routing/state modules determine office scopes and legal transitions, while Firestore Rules enforce the same capability boundaries. Because the current deployment is Spark/client-side, requests containing Faculty changes finalize through ADFA after all other required offices approve; this temporary architectural constraint is marked for replacement when the project moves to a trusted UCalgary database/API backend.

**Tech Stack:** Vanilla JavaScript, Node `node:test`, Firebase Authentication, Firebase Web compat SDK, Cloud Firestore + Security Rules, Firebase Emulator Suite, static HTML/CSS.

**Spec:**
- `docs/superpowers/specs/2026-09-17-approval-routing-roles-privacy-design.md`
- `docs/superpowers/specs/2026-09-17-approval-routing-spark-finalization-addendum.md`
- Depends on: `docs/superpowers/specs/2026-09-17-scheduling-core-design.md`

## Global Constraints

- Formal roles added by this workstream are exactly `adc` and `lab`, displayed as `ADC` and `LAB`.
- Do not add ADC/LAB to the existing broad `UCVM.admin()` permission because that would grant unrelated Faculty Dashboard/admin access.
- Existing ADFA direct timetable permissions remain available during this testing phase.
- ADC receives View Calendar, `+ Add Sessions`, `+ Add One`, and `Select Sessions` plus direct edit authority for course/date/time/type/room and ordinary non-LAB topic.
- LAB receives View Calendar and `Select Sessions`; LAB may edit only LAB Topic.
- Fields outside an office's responsibility remain visible as context but are disabled/greyed out.
- ADFA remains responsible for all Instructor/Faculty assignment changes for all session types and retains the current rich DOE/AFC/availability context.
- ADC/LAB must never receive UCID/Faculty ID, Faculty email, DOE values, detailed availability data, AFC records/dates/reasons/purpose, HR fields, or private Faculty Directory data.
- ADC/LAB Faculty-change context may contain only basic display information such as proposed Faculty name and ADFA Pending/Approved/Rejected state.
- A LAB session created by ADC starts with `topic: 'TBD'` and no Instructor assignment.
- Changing a non-LAB session to LAB resets Topic to `TBD`; changing LAB to non-LAB makes ordinary Topic ADC-editable.
- Faculty/HICC/VISC requesters see only overall workflow states: Pending, Pending - Update required, Approved, Rejected, Withdrawn.
- One office Reject terminates the whole request with no timetable changes applied.
- Push Back returns only that office scope; unchanged approvals from other offices remain valid.
- A Date/Start/End revision with an assigned Faculty reopens any prior ADFA approval.
- Type changes recompute routing because LAB Topic ownership can change.
- No timetable patch is applied until all currently required approvals are complete.
- If a request contains a Faculty/Instructor change, ADFA is the final applying approver in the current Spark architecture.
- Implementation must contain the exact marker `UCVM_DB_MIGRATION_REVISIT: spark-client-finalizer` in the finalization code.
- Faculty may Withdraw a pending/update-required timetable request; withdrawal is terminal and retains audit history.
- Faculty may Withdraw AFC requests in `pending_report_to` or `pending_admin`; approved/rejected/withdrawn AFC requests are terminal.
- Firestore Rules, not CSS/hidden buttons, must enforce authorization and privacy boundaries.
- Firestore Rules are deployed manually/separately after Emulator verification; CI does not deploy them.
- Destructive/permission/import/recovery tests run against Firebase Emulator, not the live Firebase project used by GitHub Pages testing.
- Do not merge the implementation PR until the exact GitHub Pages test build is manually browser-tested and explicitly approved by the user.

---

## File Structure

**Create**

- `office-capabilities.js` — pure canonical capability map for normalized roles.
- `calendar-session.js` — pure sanitizer for private `sessions` -> public/sanitized `calendar_sessions`.
- `calendar-session-maintenance.js` — Owner/admin verify + repair helpers for the sanitized calendar read model.
- `approval-routing.js` — pure field-to-office routing and scope/signature builder.
- `approval-state.js` — pure request transition/finalizer/revision planner.
- `workflow-notifications.js` — sanitized notification builder + side-panel client.
- `tests/office-capabilities.test.js`
- `tests/calendar-session.test.js`
- `tests/calendar-session-security-emulator.test.js`
- `tests/calendar-session-maintenance.test.js`
- `tests/approval-routing.test.js`
- `tests/approval-state.test.js`
- `tests/approval-security-emulator.test.js`
- `tests/workflow-notifications.test.js`
- `tests/afc-withdraw-security-emulator.test.js`

**Modify**

- `faculty-access.js` — recognize ADC/LAB labels and office-account identity behavior while keeping broad admin semantics unchanged.
- `index.html` — load new shared modules and add workflow-notification panel shell.
- `timetable.css` — greyed-field and notification-panel styles.
- `timetable.js` — role-valid profile list, sanitized collection selection, role-scoped tools/editors, paired writes, ADC assignment-recheck notification.
- `timetable-selection.js` — role-aware editable field planner and paired calendar write support.
- `approval-workflow.js` — new logical request schema, office queues, sanitized office rendering, ADFA private rendering, push back/resubmit/withdraw/finalize.
- `user-management.html` — ADC/LAB roles plus non-faculty office-account identity/UID controls.
- `user-management.js` — official ADC/LAB profile creation/linking without requiring Faculty records.
- `bulk-import-core.js` — reduce session/stale batch sizes so source + sanitized writes stay below Firestore's 500-operation batch limit.
- `bulk-import-firestore.js` — pair session set/delete/restore with `calendar_sessions` set/delete.
- `bulk-import-controller.js` — verify sanitized calendar health in import/restore final gates if needed by the store contract.
- `derived-index-health.js` and/or `index-maintenance.js` — expose calendar read-model health/repair in Owner maintenance UI without weakening WS4 derived-index behavior.
- `afc-actions.js` — requester withdrawal action.
- `afc-workflow.js` — Withdraw UI/status.
- `firestore.rules` — formal roles, sanitized calendar rules, split request privacy, office decisions, notifications, AFC withdraw.
- `firestore.indexes.json` — office approval/notification queue indexes where required.
- `tools/static-assets.json` — publish all new browser modules.
- Existing tests: `tests/user-management.test.js`, `tests/timetable-selection.test.js`, `tests/timetable-multi-edit-ui.test.js`, `tests/security-emulator.test.js`, `tests/bulk-import-firestore.test.js`, `tests/bulk-import-controller.test.js`, `tests/afc-ui.test.js`, `tests/afc-policy.test.js`, `tests/runtime-assets.test.js`, `tests/page-modules.test.js`.

---

### Task 1: Add formal ADC/LAB roles and explicit capability policy

**Files:**
- Create: `office-capabilities.js`
- Create: `tests/office-capabilities.test.js`
- Modify: `faculty-access.js`
- Modify: `index.html`
- Modify: `tools/static-assets.json`
- Modify: `tests/runtime-assets.test.js`

**Interfaces:**
- Consumes: normalized role strings produced by `UCVM.role()`.
- Produces:
  - `UCVM_OFFICE_CAPABILITIES.forRole(role) -> capability object`
  - `UCVM_OFFICE_CAPABILITIES.officeForRole(role) -> 'adfa'|'adc'|'lab'|''`
  - `UCVM_OFFICE_CAPABILITIES.isOfficeAccount(role) -> boolean`
- `UCVM.admin()` remains unchanged for ADC/LAB.

- [ ] **Step 1: Write failing capability tests**

Create `tests/office-capabilities.test.js` with assertions equivalent to:

```js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'office-capabilities.js'),'utf8'),context);return context.window.UCVM_OFFICE_CAPABILITIES;}

test('ADC receives calendar scheduling tools but not instructor or lab-topic authority',()=>{
  const c=load().forRole('adc');
  assert.equal(c.canViewCalendar,true);
  assert.equal(c.canAddSessions,true);
  assert.equal(c.canAddOneSession,true);
  assert.equal(c.canSelectSessions,true);
  assert.equal(c.canEditCourseFields,true);
  assert.equal(c.canEditInstructor,false);
  assert.equal(c.canEditLabTopic,false);
});

test('LAB receives calendar and selection with lab-topic authority only',()=>{
  const c=load().forRole('lab');
  assert.equal(c.canViewCalendar,true);
  assert.equal(c.canAddSessions,false);
  assert.equal(c.canAddOneSession,false);
  assert.equal(c.canSelectSessions,true);
  assert.equal(c.canEditCourseFields,false);
  assert.equal(c.canEditInstructor,false);
  assert.equal(c.canEditLabTopic,true);
});

test('ADFA keeps existing timetable authority for the testing phase',()=>{
  const c=load().forRole('adfa_regular');
  assert.equal(c.canAddSessions,true);
  assert.equal(c.canEditCourseFields,true);
  assert.equal(c.canEditInstructor,true);
  assert.equal(c.canEditLabTopic,true);
});
```

- [ ] **Step 2: Run the capability test and verify failure**

```bash
node --test tests/office-capabilities.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the explicit capability map**

Create `office-capabilities.js` with a frozen capability shape:

```js
'use strict';
window.UCVM_OFFICE_CAPABILITIES=(()=>{
  const empty=()=>({
    canViewCalendar:false,canAddSessions:false,canAddOneSession:false,canSelectSessions:false,
    canEditCourseFields:false,canEditInstructor:false,canEditLabTopic:false,
    canReviewAdcScope:false,canReviewLabScope:false,canReviewAdfaScope:false,canViewFullApprovalOverview:false
  });
  function officeForRole(role){
    role=String(role||'').toLowerCase();
    if(['adfa_general','adfa_regular'].includes(role))return'adfa';
    if(role==='adc')return'adc';
    if(role==='lab')return'lab';
    return'';
  }
  function isOfficeAccount(role){return Boolean(officeForRole(role))||String(role||'')==='other_office';}
  function forRole(role){
    role=String(role||'').toLowerCase();
    const c=empty();
    c.canViewCalendar=true;
    if(['adfa_general','adfa_regular'].includes(role))Object.assign(c,{canAddSessions:true,canAddOneSession:true,canSelectSessions:true,canEditCourseFields:true,canEditInstructor:true,canEditLabTopic:true,canReviewAdfaScope:true,canViewFullApprovalOverview:true});
    else if(role==='adc')Object.assign(c,{canAddSessions:true,canAddOneSession:true,canSelectSessions:true,canEditCourseFields:true,canReviewAdcScope:true});
    else if(role==='lab')Object.assign(c,{canSelectSessions:true,canEditLabTopic:true,canReviewLabScope:true});
    return Object.freeze(c);
  }
  return{forRole,officeForRole,isOfficeAccount};
})();
```

Existing faculty/HICC/VISC continue to receive calendar access through their current user-facing flow; the capability object is for office/admin tool decisions, not a replacement for Faculty self-service predicates.

- [ ] **Step 4: Update shared role labels and office identity behavior without broadening `UCVM.admin()`**

In `faculty-access.js`:

```js
const label=r=>({
  owner:'Owner',adfa_general:'Owner',administrator:'Administrator',adfa_regular:'Administrator',admin:'Administrator',
  other_office:'Other Office',adc:'ADC',lab:'LAB',hicc:'HICC',visc:'VISC',faculty:'Faculty',editor:'Faculty',viewer:'Faculty'
}[rawRole(r)]||rawRole(r));
```

Do **not** add `adc` or `lab` to `admin()` or `historyAll()`.

Update `linkFacultyIdentity()` so office accounts do not attempt email-to-Faculty auto-linking:

```js
if(admin(p)||['adc','lab','other_office'].includes(role(p?.role)))return;
```

- [ ] **Step 5: Publish/load the capability module**

Load it after `faculty-access.js` and before `timetable.js` in `index.html`, add it to `tools/static-assets.json`, and add runtime-asset assertions.

- [ ] **Step 6: Run focused tests**

```bash
node --test tests/office-capabilities.test.js tests/runtime-assets.test.js tests/page-modules.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add office-capabilities.js faculty-access.js index.html tools/static-assets.json tests/office-capabilities.test.js tests/runtime-assets.test.js tests/page-modules.test.js
git commit -m "feat: add ADC and LAB capability policy"
```

---

### Task 2: Make User Management support official ADC/LAB office accounts and existing Auth UIDs

**Files:**
- Modify: `user-management.html`
- Modify: `user-management.js`
- Modify: `tests/user-management.test.js`
- Modify: `firestore.rules` role vocabulary only in this task

**Interfaces:**
- Consumes: formal `adc` / `lab` roles from Task 1.
- Produces: Owner can create/update an office profile with no Faculty record and can link a pre-existing Firebase Authentication UID without recreating the Auth user.

- [ ] **Step 1: Add failing UI/profile tests for ADC/LAB roles and office identity fields**

Extend `tests/user-management.test.js` to assert:

```js
assert.match(html,/<option value="adc">ADC<\/option>/);
assert.match(html,/<option value="lab">LAB<\/option>/);
assert.match(html,/id="account-office-name"/);
assert.match(html,/id="account-office-email"/);
assert.match(html,/id="account-existing-uid"/);
assert.match(js,/\['faculty','hicc','visc'\]/);
```

Add a testable helper in `user-management.js` or a small exported form-policy object proving `adc`/`lab` do not require `facultyId`.

- [ ] **Step 2: Run the user-management test and verify failure**

```bash
node --test tests/user-management.test.js
```

Expected: FAIL until the role/options/form policy are updated.

- [ ] **Step 3: Update the role dropdown and add office-account identity controls**

In `user-management.html`, make the role list:

```html
<option value="faculty">Faculty</option>
<option value="hicc">HICC</option>
<option value="visc">VISC</option>
<option value="adc">ADC</option>
<option value="lab">LAB</option>
<option value="other_office">Other Office</option>
<option value="administrator">Administrator</option>
<option value="owner">Owner</option>
```

Add a hidden office identity block that becomes active for non-faculty-facing roles:

```html
<div id="account-office-identity" hidden>
  <label>Display name<input id="account-office-name" maxlength="120"></label>
  <label>Email<input id="account-office-email" type="email"></label>
  <label>Existing Firebase Authentication UID<input id="account-existing-uid" autocomplete="off"></label>
  <small>Use Existing UID to link an Authentication account that already exists. Leave blank to create a new Authentication account with the temporary password.</small>
</div>
```

- [ ] **Step 4: Split Faculty-facing and office-account profile creation**

Use a helper equivalent to:

```js
const facultyFacingRole=role=>['faculty','hicc','visc'].includes(role);
function officeIdentity(){return{name:$('account-office-name').value.trim(),email:$('account-office-email').value.trim().toLowerCase()};}
```

For `adc`, `lab`, `other_office`, `administrator`, and `owner`, do not require a Faculty record and do not add `facultyRoles`.

For a new account:

```js
const existingUid=$('account-existing-uid').value.trim();
if(existingUid){
  uid=existingUid;
}else{
  const password=$('account-password').value;
  if(password.length<8)throw Error('Enter a temporary password with at least 8 characters.');
  uid=await createAuthenticationUser(fields.email,password);
}
```

Never hardcode the known ADC/LAB UID values or any temporary password in source code.

- [ ] **Step 5: Extend Firestore user-profile role validation**

In `firestore.rules`, add `adc` and `lab` to `ready()` and `explicitRole()`. Do not add them to `admin()`, `general()`, or `historyAll()`.

`validFacultyLink(d)` must continue to require a Faculty link only for faculty-facing roles; ADC/LAB need no `facultyId`.

- [ ] **Step 6: Run focused tests**

```bash
node --test tests/user-management.test.js tests/office-capabilities.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add user-management.html user-management.js firestore.rules tests/user-management.test.js
git commit -m "feat: manage ADC and LAB office accounts"
```

---

### Task 3: Create the sanitized `calendar_sessions` read model and prove its privacy boundary

**Files:**
- Create: `calendar-session.js`
- Create: `tests/calendar-session.test.js`
- Create: `tests/calendar-session-security-emulator.test.js`
- Modify: `index.html`
- Modify: `tools/static-assets.json`
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: a source `sessions/{id}` object.
- Produces: `UCVM_CALENDAR_SESSION.fromSource(source,id)` containing public scheduling fields and Faculty display names only.

- [ ] **Step 1: Write sanitizer tests that explicitly reject private fields**

Create tests equivalent to:

```js
const source={
  id:'s1',course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,
  date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Pre-Op Lab',room:'CSB 116',
  instructor:'Jane Smith; Alex Faculty',facultyIds:['1001','1002'],
  assignments:[{ucid:'1001',name:'Jane Smith',doeCredit:1.25},{ucid:'1002',name:'Alex Faculty',doeCredit:1.25}],
  awayFromCampusRecords:[{startDate:'2027-03-20',reason:'Private'}]
};
const clean=api.fromSource(source,'s1');
assert.deepEqual(clean.instructorNames,['Jane Smith','Alex Faculty']);
assert.equal(clean.instructor,'Jane Smith; Alex Faculty');
for(const forbidden of ['facultyIds','assignments','ucid','doeCredit','awayFromCampusRecords'])assert.equal(JSON.stringify(clean).includes(forbidden),false);
```

Also assert `Object.keys(clean)` is limited to the approved public schema.

- [ ] **Step 2: Run sanitizer tests and verify failure**

```bash
node --test tests/calendar-session.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure sanitizer**

Create `calendar-session.js` with an allowlist rather than cloning/deleting private fields:

```js
'use strict';
window.UCVM_CALENDAR_SESSION=(()=>{
  const text=value=>String(value??'').trim();
  const names=source=>{
    const fromAssignments=Array.isArray(source?.assignments)?source.assignments.map(a=>text(a?.name)).filter(Boolean):[];
    const fromInstructor=text(source?.instructor).split(';').map(text).filter(Boolean);
    return [...new Set(fromAssignments.length?fromAssignments:fromInstructor)];
  };
  function fromSource(source={},id=''){
    const instructorNames=names(source);
    return{
      sessionId:text(id||source.id),
      course:text(source.course),courseName:text(source.courseName),year:Number(source.year)||null,
      semester:text(source.semester),week:Number(source.week)||null,date:text(source.date).slice(0,10),
      start:text(source.start),end:text(source.end),timeUnknown:source.timeUnknown===true,
      type:text(source.type),topic:text(source.topic),room:text(source.room),
      instructorNames,instructor:instructorNames.join('; ')
    };
  }
  return{fromSource};
})();
```

No generic spread (`{...source}`) is allowed in the sanitizer.

- [ ] **Step 4: Add Emulator tests for source-read denial and sanitized-read allowance**

In `tests/calendar-session-security-emulator.test.js`, create profiles for ADC, LAB, ADFA, and Faculty. Seed one source session and one sanitized calendar session as security-rules-disabled admin context, then assert:

```js
await assertFails(adc.firestore().doc('sessions/s1').get());
await assertFails(lab.firestore().doc('sessions/s1').get());
await assertSucceeds(adc.firestore().doc('calendar_sessions/s1').get());
await assertSucceeds(lab.firestore().doc('calendar_sessions/s1').get());
await assertSucceeds(adfa.firestore().doc('sessions/s1').get());
```

Also assert ADC/LAB cannot read `/faculty/{id}`, `/afc_requests/{id}`, or future `/change_request_private/{id}`.

- [ ] **Step 5: Add Firestore role/read rules for the sanitized layer**

Add helpers conceptually equivalent to:

```rules
function adc(){return ready() && profile().role == 'adc';}
function lab(){return ready() && profile().role == 'lab';}
function adfa(){return ready() && profile().role in ['owner','administrator','admin','adfa_general','adfa_regular'];}
function privateSessionRead(){return ready() && !adc() && !lab();}
```

Change source-session read to `privateSessionRead()` and add:

```rules
match /calendar_sessions/{id} {
  allow read: if ready();
}
```

Do not grant ADC/LAB `/faculty` or `/afc_requests` reads.

- [ ] **Step 6: Publish/load the sanitizer and run tests**

Add `calendar-session.js` to `index.html` before `timetable.js` and to `tools/static-assets.json`.

Run:

```bash
node --test tests/calendar-session.test.js tests/runtime-assets.test.js
npm run test:emulator -- --test-name-pattern="calendar session"
```

If the npm forwarding syntax does not filter Node tests in this repository, run the repository's normal emulator command and verify this test file passes in the full output:

```bash
npm run test:emulator
```

- [ ] **Step 7: Commit Task 3**

```bash
git add calendar-session.js firestore.rules index.html tools/static-assets.json tests/calendar-session.test.js tests/calendar-session-security-emulator.test.js tests/runtime-assets.test.js
git commit -m "feat: add sanitized calendar session read model"
```

---

### Task 4: Add role-scoped ADC/LAB timetable tools, greyed fields, and source+calendar paired writes

**Files:**
- Modify: `timetable.js`
- Modify: `timetable-selection.js`
- Modify: `timetable.css`
- Modify: `tests/timetable-selection.test.js`
- Modify: `tests/timetable-multi-edit-ui.test.js`
- Modify: `tests/security-emulator.test.js`
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: `UCVM_OFFICE_CAPABILITIES`, `UCVM_CALENDAR_SESSION`, and WS5A `UCVM_SCHEDULING`.
- Produces: ADC direct scheduling edits and LAB Topic-only selection edits with Firestore-enforced field boundaries.

- [ ] **Step 1: Add failing UI tests for the tool matrix and greyed editors**

Pin the expected controls:

```text
ADFA: Add Sessions, Add One, Select Sessions
ADC:  Add Sessions, Add One, Select Sessions
LAB:  Select Sessions only
```

In role-aware editor tests assert ADC Faculty control is disabled, ADC LAB Topic is disabled, LAB non-topic fields are disabled, and LAB cannot select a non-LAB row for editing.

- [ ] **Step 2: Replace `canEdit()` broad gating with capability-specific checks**

In `timetable.js` keep existing ADFA behavior but add:

```js
const capabilities=()=>UCVM_OFFICE_CAPABILITIES.forRole(UCVM.role(currentUser?.role));
const canAddSessions=()=>capabilities().canAddSessions;
const canAddOneSession=()=>capabilities().canAddOneSession;
const canSelectSessions=()=>capabilities().canSelectSessions;
```

Do not redefine `UCVM.admin()`.

Update `getRoleProfile()` valid roles to include `adc` and `lab`.

- [ ] **Step 3: Route ADC/LAB timetable reads to `calendar_sessions`**

Use a role-sensitive collection selector:

```js
function sessionCollection(){
  const role=UCVM.role(currentUser?.role);
  return ['adc','lab'].includes(role)?'calendar_sessions':'sessions';
}
```

`sessionQueryForRange()`, `ensureSessionsForDates()`, `subscribeSessions()`, and any ADC/LAB all-session load must use this selector. ADFA approval/private paths continue reading `sessions`.

- [ ] **Step 4: Implement ADC Add One/Add Sessions field ownership**

ADC form behavior:

```text
course/date/start/end/type/room -> enabled
topic -> enabled only when proposed type != LAB
Faculty/instructor -> disabled
type == LAB -> topic value forced to "TBD"
new source session -> assignments: [], facultyIds: [], instructor: ""
```

When type changes from non-LAB to LAB, write `topic:'TBD'`. When type changes from LAB to non-LAB, Topic becomes editable.

- [ ] **Step 5: Implement LAB Select Sessions-only editing**

LAB selection rules:

```js
if(role==='lab'&&String(session.type||'').toUpperCase()!=='LAB'){
  toast('LAB accounts can select LAB sessions only.',true);
  return;
}
```

In the review table render every context field, but apply `disabled` plus a `.role-locked-field` class to all fields except Topic. Faculty picker is read-only text for LAB, never the full DOE picker.

ADC review table enables ADC-owned public fields, disables Faculty, and disables Topic on LAB rows.

ADFA keeps the current complete selection editor during the testing phase.

- [ ] **Step 6: Pair every direct source write with the sanitized calendar document**

For create/update operations use one Firestore batch:

```js
const sourceRef=db.doc(`sessions/${id}`),calendarRef=db.doc(`calendar_sessions/${id}`);
batch.set(sourceRef,sourceData,{merge:true});
batch.set(calendarRef,UCVM_CALENDAR_SESSION.fromSource(nextSource,id));
```

For deletes performed by existing ADFA tools:

```js
batch.delete(sourceRef);
batch.delete(calendarRef);
```

ADC/LAB partial updates must build the sanitized document from their current sanitized session plus the public patch; they must not attempt to read private source fields.

- [ ] **Step 7: Add an ADC date/time assignment-recheck notification hook**

If an ADC direct edit changes `date`, `start`, or `end` and the sanitized session shows one or more instructor names, enqueue a sanitized `assignment_recheck_required` notification for ADFA containing only session/course/date/time and Faculty display names. Do not perform or reveal AFC/DOE/availability checks to ADC.

The notification helper is implemented fully in Task 8; until then the call may target the exported interface specified there and the test should use a stub.

- [ ] **Step 8: Enforce ADC/LAB write boundaries in Firestore Rules**

Add fixed field-set checks. Conceptually:

```rules
function adcSessionUpdate(){
  let changed=request.resource.data.diff(resource.data).affectedKeys();
  return adc()
    && changed.hasOnly(['course','courseName','year','semester','week','date','start','end','timeUnknown','type','room','topic','updatedBy','updatedByName','updatedAt'])
    && (!changed.hasAny(['topic']) || request.resource.data.type != 'LAB' || (resource.data.type != 'LAB' && request.resource.data.type == 'LAB' && request.resource.data.topic == 'TBD'));
}
function labSessionUpdate(){
  let changed=request.resource.data.diff(resource.data).affectedKeys();
  return lab() && resource.data.type == 'LAB' && request.resource.data.type == 'LAB'
    && changed.hasOnly(['topic','updatedBy','updatedByName','updatedAt']);
}
```

ADC create must require no assigned Faculty and `topic == 'TBD'` when `type == 'LAB'`.

ADC/LAB delete remains denied. Existing ADFA/admin delete remains available.

- [ ] **Step 9: Run focused UI + security tests**

```bash
node --test tests/timetable-selection.test.js tests/timetable-multi-edit-ui.test.js tests/office-capabilities.test.js
npm run test:emulator
```

Expected: ADC/LAB console attempts outside their field set are denied even when the UI is bypassed.

- [ ] **Step 10: Commit Task 4**

```bash
git add timetable.js timetable-selection.js timetable.css firestore.rules tests/timetable-selection.test.js tests/timetable-multi-edit-ui.test.js tests/security-emulator.test.js
git commit -m "feat: enforce ADC and LAB timetable editing scopes"
```

---

### Task 5: Synchronize `calendar_sessions` through bulk import/restore and add verify/repair health tooling

**Files:**
- Create: `calendar-session-maintenance.js`
- Create: `tests/calendar-session-maintenance.test.js`
- Modify: `bulk-import-core.js`
- Modify: `bulk-import-firestore.js`
- Modify: `bulk-import-controller.js`
- Modify: `tests/bulk-import-firestore.test.js`
- Modify: `tests/bulk-import-controller.test.js`
- Modify: `derived-index-health.js` and/or `index-maintenance.js`
- Modify: `tools/static-assets.json`
- Modify: `faculty-admin.html` or the existing health-panel host only if a button/status hook is required

**Interfaces:**
- Consumes: `UCVM_CALENDAR_SESSION.fromSource()`.
- Produces:
  - `UCVM_CALENDAR_SESSION_MAINTENANCE.compare(sourceSessions,calendarSessions)`
  - `verify(db) -> {ok,mismatchCount,mismatches}`
  - `repair(db,report,actor) -> postVerifyReport`
- Bulk import/restore writes source and sanitized session in the same batch unit.

- [ ] **Step 1: Add pure compare tests**

Test these cases:

```text
missing calendar document -> mismatch
stale calendar document with no source -> mismatch
wrong room/topic/instructor display -> mismatch
private field present in calendar doc -> mismatch
exact sanitized document -> healthy
```

- [ ] **Step 2: Implement compare/verify/repair helpers**

`repair()` must process each mismatch using a fresh transaction:

```js
await db.runTransaction(async tx=>{
  const sourceRef=db.doc(`sessions/${id}`),calendarRef=db.doc(`calendar_sessions/${id}`);
  const source=await tx.get(sourceRef);
  if(!source.exists)tx.delete(calendarRef);
  else tx.set(calendarRef,UCVM_CALENDAR_SESSION.fromSource(source.data(),id));
});
```

After all repaired IDs, run `verify()` again and return the result. This avoids silently trusting a stale snapshot during repair.

- [ ] **Step 3: Reduce bulk session/stale chunk sizes before doubling session operations**

Current `SESSION_BATCH_SIZE=300` and `STALE_BATCH_SIZE=350` cannot safely support source+calendar paired operations because Firestore batches allow at most 500 writes.

Change both to 200:

```js
const SESSION_BATCH_SIZE=200;
const STALE_BATCH_SIZE=200;
```

Keep `FACULTY_BATCH_SIZE=350` because Faculty batches are not doubled by calendar writes.

- [ ] **Step 4: Pair import/restore session writes and deletes**

In `bulk-import-firestore.js` add:

```js
const calendarSessionRef=id=>db.collection('calendar_sessions').doc(String(id));
```

For each source session set:

```js
const data=write.data||{};
batch.set(sessionRef(write.id),data);
batch.set(calendarSessionRef(write.id),UCVM_CALENDAR_SESSION.fromSource(data,write.id));
```

For stale/restore delete:

```js
batch.delete(sessionRef(id));
batch.delete(calendarSessionRef(id));
```

Ensure the browser and Node factory receive the sanitizer dependency explicitly rather than relying on an undefined global in tests.

- [ ] **Step 5: Add calendar verification to import/restore final gates**

After source sessions are verified and before maintenance unlock, verify the sanitized read model. A mismatch fails the final verification just like derived-index mismatch; it must not report successful completion while calendar data is stale.

- [ ] **Step 6: Surface Owner Verify/Repair without granting ADC/LAB maintenance rights**

Add a small health row/button in the existing derived-index/admin health area:

```text
Sanitized Calendar: HEALTHY / MISMATCH
[Verify Calendar]
[Repair Calendar]  // Owner only
```

Do not expose source private values in mismatch details; show session ID and public field path only.

- [ ] **Step 7: Run focused import/maintenance tests**

```bash
node --test tests/calendar-session-maintenance.test.js tests/bulk-import-firestore.test.js tests/bulk-import-controller.test.js tests/bulk-import-core.test.js tests/derived-index-health.test.js
```

- [ ] **Step 8: Commit Task 5**

```bash
git add calendar-session-maintenance.js bulk-import-core.js bulk-import-firestore.js bulk-import-controller.js derived-index-health.js index-maintenance.js tools/static-assets.json tests/calendar-session-maintenance.test.js tests/bulk-import-firestore.test.js tests/bulk-import-controller.test.js
git commit -m "feat: keep sanitized calendar synchronized and repairable"
```

---

### Task 6: Build pure multi-office routing and request-state engines

**Files:**
- Create: `approval-routing.js`
- Create: `approval-state.js`
- Create: `tests/approval-routing.test.js`
- Create: `tests/approval-state.test.js`
- Modify: `index.html`
- Modify: `tools/static-assets.json`

**Interfaces:**
- `UCVM_APPROVAL_ROUTING.route({base,patch}) -> {requiredOffices,scopes,hasFacultyChange,finalType}`
- `UCVM_APPROVAL_ROUTING.scopeSignature(fields,patch) -> stable string`
- `UCVM_APPROVAL_STATE.planOfficeDecision(...)`
- `UCVM_APPROVAL_STATE.planResubmission(...)`
- `UCVM_APPROVAL_STATE.canFinalize(...)`
- `UCVM_APPROVAL_STATE.planWithdrawal(...)`

- [ ] **Step 1: Write routing tests for normal and LAB sessions**

Pin the approved ownership matrix:

```js
assert.deepEqual(route({base:{type:'LEC'},patch:{date:'2026-10-02',room:'B201'}}).scopes.adc,['date','room']);
assert.deepEqual(route({base:{type:'LEC'},patch:{topic:'New topic'}}).scopes.adc,['topic']);
assert.deepEqual(route({base:{type:'LAB'},patch:{topic:'Advanced suturing'}}).scopes.lab,['topic']);
assert.deepEqual(route({base:{type:'LAB'},patch:{assignments:[{name:'Dr. B'}]}}).scopes.adfa,['assignments']);
```

Add a mixed LAB case where ADC=date, LAB=topic, ADFA=assignments.

Route Topic based on the **final/proposed type**, not only the base type.

- [ ] **Step 2: Implement fixed field ownership**

Use explicit allowlists:

```js
const ADC_FIELDS=['course','courseName','year','date','start','end','timeUnknown','type','room'];
const ADFA_FIELDS=['assignments','facultyIds','instructor'];
function officeForField(field,finalType){
  if(ADFA_FIELDS.includes(field))return'adfa';
  if(field==='topic')return String(finalType).toUpperCase()==='LAB'?'lab':'adc';
  if(ADC_FIELDS.includes(field))return'adc';
  return'';
}
```

Derived `semester`/`week` follow Date and should be included in the ADC scope when the patch changes them as part of date normalization.

- [ ] **Step 3: Write state-machine tests for approve/reject/push-back/resubmit/withdraw**

Cover at minimum:

```text
one reject -> overall rejected
push_back -> update_required + returned fields editable
resubmit unchanged approved scopes -> stay approved
change date/start/end with existing Faculty -> ADFA reopens
change type into/out of LAB -> routing recomputed
withdraw pending/update_required -> withdrawn
withdraw approved/rejected -> invalid
```

- [ ] **Step 4: Add finalizer tests including the Spark architectural rule**

Pin:

```js
assert.equal(api.canFinalize({office:'adc',hasFacultyChange:true,allRequiredApproved:true}),false);
assert.equal(api.canFinalize({office:'lab',hasFacultyChange:true,allRequiredApproved:true}),false);
assert.equal(api.canFinalize({office:'adfa',hasFacultyChange:true,allRequiredApproved:true}),true);
assert.equal(api.canFinalize({office:'adfa',hasFacultyChange:true,allRequiredApproved:false}),false);
assert.equal(api.canFinalize({office:'lab',hasFacultyChange:false,allRequiredApproved:true}),true);
```

- [ ] **Step 5: Implement deterministic scope signatures and revision planning**

Use canonical key ordering rather than a non-deterministic object stringify:

```js
function scopeSignature(fields,patch){
  return JSON.stringify([...fields].sort().map(field=>[field,patch?.[field]??null]));
}
```

Approved scope signatures are used for stale/revision checks, but Firestore Rules must still enforce immutable approved fields rather than trusting the client signature.

- [ ] **Step 6: Publish/load routing/state modules and run tests**

```bash
node --test tests/approval-routing.test.js tests/approval-state.test.js tests/runtime-assets.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add approval-routing.js approval-state.js index.html tools/static-assets.json tests/approval-routing.test.js tests/approval-state.test.js
git commit -m "feat: add office approval routing state machine"
```

---

### Task 7: Split request storage by privacy boundary and enforce it with Firestore Rules

**Files:**
- Modify: `approval-workflow.js`
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`
- Create: `tests/approval-security-emulator.test.js`
- Modify: existing faculty-swap/request tests that assert the old document shape

**Interfaces:**
- Consumes: routing/state modules from Task 6.
- Produces one logical request across these physical records:
  - `change_requests/{requestId}` — requester-readable sanitized request + overall state only.
  - `change_request_workflow/{requestId}` — office-readable routing metadata, no private Faculty IDs/DOE/AFC.
  - `change_request_approvals/{requestId}_{office}` — one sanitized office decision document.
  - `change_request_private/{requestId}` — ADFA-only private Faculty assignment reference data.
  - `change_request_audit/{eventId}` — authorized lifecycle audit.

- [ ] **Step 1: Add Emulator privacy tests before changing request creation**

Seed an office-routed request containing a public proposed Faculty name and a private assignment reference. Assert:

```js
await assertSucceeds(faculty.doc('change_requests/r1').get());
await assertFails(faculty.doc('change_request_workflow/r1').get());
await assertFails(faculty.doc('change_request_private/r1').get());
await assertSucceeds(adc.doc('change_request_workflow/r1').get());
await assertFails(adc.doc('change_request_private/r1').get());
await assertSucceeds(lab.doc('change_request_workflow/r1').get());
await assertFails(lab.doc('change_request_private/r1').get());
await assertSucceeds(adfa.doc('change_request_private/r1').get());
```

Also assert legacy request documents containing private fields are denied to ADC/LAB.

- [ ] **Step 2: Define the sanitized public request schema**

A new routed request must include only requester-safe fields, for example:

```js
{
  requestSchema:'office-routing-v1',
  requesterUid:user.uid,
  requesterRole:role,
  sessionId,
  requestType:'session_edit',
  status:'pending',
  revision:1,
  basePublic:{course,date,start,end,type,topic,room,instructor},
  patchPublic:{course,date,start,end,type,topic,room,instructor},
  proposedFacultyName:'Dr. Jane Smith',
  editableFields:[],
  requesterMessage:'',
  requestedAt:stamp(),updatedAt:stamp()
}
```

Never store UCID, Faculty email, DOE, AFC, detailed availability, or private assignment objects in this document.

- [ ] **Step 3: Define office-only workflow/approval records**

Workflow document:

```js
{
  requestId,
  revision:1,
  requiredOffices:['adc','adfa'],
  hasFacultyChange:true,
  finalType:'LEC',
  scopes:{adc:['date'],adfa:['assignments'],lab:[]},
  scopeSignatures:{adc:'...',adfa:'...',lab:''},
  updatedAt:stamp()
}
```

Per-office approval document:

```js
{
  requestId,
  office:'adc',
  revision:1,
  fields:['date'],
  scopeSignature:'...',
  status:'pending',
  decidedBy:'',decidedByName:'',decidedAt:null,
  pushBackReason:''
}
```

Faculty/HICC/VISC must not be able to read these internal routing documents.

- [ ] **Step 4: Put private Faculty assignment references only in `change_request_private`**

Use the existing sanitized candidate-key mechanism where available. A requester may create/write the private record required for their own request but receives no read permission afterward.

Example private shape:

```js
{
  requestId,
  requesterUid:user.uid,
  revision:1,
  assignmentChange:{fromKey:'opaque-current-key',toKey:'opaque-candidate-key'},
  updatedAt:stamp()
}
```

ADFA resolves opaque keys through the existing admin-only mapping before final apply. Do not replace opaque keys with UCIDs in requester-readable documents.

- [ ] **Step 5: Convert request creation to one batch**

The submit path writes public request + workflow + required approval docs + optional private doc + audit event in a single Firestore batch. Replace the old message `Request submitted to ADFA for approval.` with:

```text
Request submitted for approval.
```

- [ ] **Step 6: Add Security Rules for each collection**

Rules must enforce:

```text
change_requests
  requester: read own sanitized doc
  office users: read routed-schema docs needed for review
  legacy private-shaped requests: ADFA-only

change_request_workflow
  ADC/LAB/ADFA/Owner: read
  requester: no read

change_request_approvals
  office users: read
  office may decide only its own document
  requester may only perform narrowly validated resubmission resets

change_request_private
  ADFA/Owner: read
  requester: create/update own record only when parent state permits; no read

change_request_audit
  ADFA/Owner full read; office read only sanitized lifecycle events if UI requires it
```

Every new request create/update must pin `requestSchema == 'office-routing-v1'`.

- [ ] **Step 7: Add queue indexes**

Add composite indexes needed by actual queries, for example office approvals by `office + status + updatedAt`, and requester requests by `requesterUid + requestedAt` if Firestore reports them as required.

- [ ] **Step 8: Run request privacy/security tests**

```bash
node --test tests/approval-routing.test.js tests/approval-state.test.js
npm run test:emulator
```

Expected: ADC/LAB cannot fetch any private request or Faculty data even with direct console calls.

- [ ] **Step 9: Commit Task 7**

```bash
git add approval-workflow.js firestore.rules firestore.indexes.json tests/approval-security-emulator.test.js tests/faculty-swap-integration.test.js tests/faculty-swap-security-emulator.test.js
git commit -m "feat: split approval data by privacy boundary"
```

---

### Task 8: Implement office-scoped Approval Queues, Push Back, Resubmit, Withdraw, and guarded final apply

**Files:**
- Modify: `approval-workflow.js`
- Modify: `timetable.css`
- Modify: `tests/approval-state.test.js`
- Create or modify: `tests/approval-workflow-ui.test.js`
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: split request records from Task 7, WS5A scheduling core, routing/state helpers.
- Produces: ADC/LAB/ADFA queues and legal lifecycle actions.

- [ ] **Step 1: Add UI tests for office-specific queue labels and sanitized Faculty context**

Pin:

```text
ADC login button: ADC Approvals (N)
LAB login button: LAB Approvals (N)
ADFA login button: Approvals (N)
```

For ADC/LAB approval rendering assert the HTML contains proposed Faculty display name and status but does not contain strings/labels `UCID`, `DOE`, `AFC`, `Availability`, or Faculty email.

For ADFA rendering keep assertions that DOE/AFC/timetable context remains present.

- [ ] **Step 2: Split approver predicates**

Replace the old single `isApprover()` assumption with:

```js
const normalizedRole=()=>UCVM.role(role);
const office=()=>UCVM_OFFICE_CAPABILITIES.officeForRole(normalizedRole());
const isAdfaApprover=()=>office()==='adfa';
const isOfficeApprover=()=>['adc','lab','adfa'].includes(office());
```

Only `isAdfaApprover()` may call `ensureApprovalFaculty()`, read `change_request_private`, read Faculty Directory private details, or show DOE/AFC/availability.

- [ ] **Step 3: Build the office queue from `change_request_approvals`**

ADC/LAB query only their own office approval records. ADFA General/Owner may also load the full matrix/overview.

For a request card, load:

```text
public request -> basic session/change context
workflow record -> routing/scopes
approval records -> status matrix
private record -> ADFA only
```

Faculty/HICC/VISC continue querying only their own `change_requests` documents and render only overall status.

- [ ] **Step 4: Render non-owned fields as grey read-only context**

For each changed field show value change plus responsible office status. Only the current office gets action buttons.

ADC/LAB Faculty line is restricted to:

```text
Faculty Assignment
Proposed Faculty: Dr. Jane Smith
ADFA: Pending / Approved / Rejected
```

No hidden HTML/data attribute may contain UCID/DOE/AFC/private IDs.

- [ ] **Step 5: Add `Approve`, `Push Back`, and `Reject` actions**

Push Back requires a nonblank message. The batch/transaction writes:

```text
own approval -> push_back
public request -> status update_required
public editableFields -> this returned scope (union other already pushed-back scopes)
public requesterMessage -> reason text without office identity
change_request_audit -> internal event with office + actor
```

Reject writes own approval rejected, overall public status rejected, cancels still-pending office approvals, and applies **no** session changes.

- [ ] **Step 6: Implement requester `Edit & Resubmit`**

When public status is `update_required`, render fields in `editableFields` as editable and all other request fields grey/disabled.

On submit:

```text
revision += 1
returned office approval(s) -> pending with new revision/signature
unchanged approved office approvals -> remain approved
editableFields -> []
status -> pending
```

Backend rules must reject modification of fields outside `editableFields` even if the user edits the request through the browser console.

If Date/Start/End changed while a Faculty assignment exists, reset ADFA approval to pending regardless of its previous approved state.

If Type changes into/out of LAB, recompute routing and create/cancel the LAB Topic approval as needed.

- [ ] **Step 7: Implement requester Withdraw with a transaction**

Allowed source states:

```text
pending
update_required
```

Transaction flow:

```js
await db.runTransaction(async tx=>{
  const publicRef=db.doc(`change_requests/${id}`),snap=await tx.get(publicRef);
  const current=snap.data();
  if(!['pending','update_required'].includes(current.status))throw Error('This request can no longer be withdrawn.');
  tx.update(publicRef,{status:'withdrawn',editableFields:[],updatedAt:stamp(),withdrawnBy:user.uid,withdrawnAt:stamp()});
  // pending/push_back office approval records are changed to cancelled; approved history remains approved.
});
```

Rules must require requester ownership.

- [ ] **Step 8: Implement guarded finalization**

Before apply:

```text
reload public + workflow + all required approval docs
reload current live source session
verify request still pending and exact revision not already applied
verify all required approval scopes approved for current signatures
run stale-base check
run WS5A schedule/conflict checks
for Faculty change, load private record + full ADFA Faculty/AFC/DOE context
```

**Required migration marker in code:**

```js
// UCVM_DB_MIGRATION_REVISIT: spark-client-finalizer
// Current Spark/client architecture requires ADFA to finalize requests containing private Faculty changes.
// Move final apply to a trusted UCalgary backend transaction/service during the database/API migration.
```

Finalizer rule:

```js
if(workflow.hasFacultyChange&&office()!=='adfa')throw Error('ADFA must complete a request that changes Faculty assignment.');
if(!allRequiredApproved)throw Error('All required office approvals must be complete before applying this request.');
```

For non-Faculty requests, the office whose approval completes the set may finalize.

- [ ] **Step 9: Apply the whole patch once and synchronize calendar + audit**

Finalization transaction/batch must guard `appliedRevision` / `appliedAt` so concurrent approvals cannot apply twice. The applied write includes:

```text
sessions/{id} full authorized patch
calendar_sessions/{id} sanitized public result
session_change_log event
change_request_audit completion event
change_requests status=approved + appliedRevision + appliedAt
```

ADFA conflict override from WS5A remains available and auditable.

- [ ] **Step 10: Add a source-marker test**

In `tests/approval-state.test.js` or a dedicated static test:

```js
const source=fs.readFileSync(path.join(root,'approval-workflow.js'),'utf8');
assert.match(source,/UCVM_DB_MIGRATION_REVISIT: spark-client-finalizer/);
```

- [ ] **Step 11: Run focused workflow + Emulator tests**

```bash
node --test tests/approval-routing.test.js tests/approval-state.test.js tests/approval-workflow-ui.test.js tests/scheduling-core.test.js
npm run test:emulator
```

- [ ] **Step 12: Commit Task 8**

```bash
git add approval-workflow.js timetable.css firestore.rules tests/approval-state.test.js tests/approval-workflow-ui.test.js tests/approval-security-emulator.test.js
git commit -m "feat: add multi-office approval lifecycle"
```

---

### Task 9: Add sanitized Workflow Notifications side panel

**Files:**
- Create: `workflow-notifications.js`
- Create: `tests/workflow-notifications.test.js`
- Modify: `index.html`
- Modify: `timetable.css`
- Modify: `approval-workflow.js`
- Modify: `timetable.js`
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`
- Modify: `tools/static-assets.json`

**Interfaces:**
- Produces:
  - `UCVM_WORKFLOW_NOTIFICATIONS.build({kind,office,request,session,message}) -> safe payload`
  - `UCVM_WORKFLOW_NOTIFICATIONS.mount(...)`
  - `UCVM_WORKFLOW_NOTIFICATIONS.emitBatch(batch,db,event)` or equivalent helper.

- [ ] **Step 1: Write notification sanitizer tests**

Create a payload using an input object that deliberately contains `ucid`, `doe`, `awayFromCampusRecords`, and `email`. Assert the built notification contains none of those keys/values.

Approved safe fields:

```js
{
  recipientOffice:'adc',kind:'request_assigned',requestId:'r1',sessionId:'s1',
  course:'505',date:'2027-03-22',start:'14:45',end:'16:15',type:'LAB',topic:'Pre-Op Lab',
  facultyDisplayName:'Dr. Jane Smith',message:'',createdAt:null,readBy:[]
}
```

- [ ] **Step 2: Implement event types required by the design**

Support:

```text
request_assigned
request_resubmitted
office_decision
request_applied
request_withdrawn
assignment_recheck_required
```

All office payloads use sanitized data only. ADFA opens the request for rich context rather than receiving private context inside the notification document.

- [ ] **Step 3: Add notification documents to workflow batches**

Create one document per recipient office/event using `recipientOffice` and a generated doc ID. Completion emits to every participating required office; Owner can read all.

ADC direct Date/Time edits with an existing instructor emit `assignment_recheck_required` to ADFA.

- [ ] **Step 4: Add the right-side panel shell and role-specific rendering**

`index.html` adds:

```html
<aside id="workflow-notifications" class="workflow-notifications hidden" aria-label="Workflow notifications"></aside>
```

The module queries the signed-in office, renders newest items, and marks the current user's UID in `readBy` when acknowledged.

- [ ] **Step 5: Add Firestore notification rules**

ADC reads `recipientOffice == 'adc'`; LAB reads `lab`; ADFA reads `adfa`; Owner may read all. Updates are restricted to adding the signed-in UID to `readBy`; payload business fields are immutable after create.

Add the exact composite index required by the query if using `recipientOffice == ...` plus `orderBy(createdAt,'desc')`.

- [ ] **Step 6: Run notification + security tests**

```bash
node --test tests/workflow-notifications.test.js tests/approval-workflow-ui.test.js
npm run test:emulator
```

- [ ] **Step 7: Commit Task 9**

```bash
git add workflow-notifications.js index.html timetable.css timetable.js approval-workflow.js firestore.rules firestore.indexes.json tools/static-assets.json tests/workflow-notifications.test.js
git commit -m "feat: add sanitized workflow notifications"
```

---

### Task 10: Add AFC requester withdrawal with audit and race-safe rules

**Files:**
- Modify: `afc-actions.js`
- Modify: `afc-workflow.js`
- Modify: `firestore.rules`
- Modify: `tests/afc-ui.test.js`
- Modify: `tests/afc-policy.test.js`
- Create: `tests/afc-withdraw-security-emulator.test.js`

**Interfaces:**
- Produces: requester-only `withdrawn` AFC terminal state from `pending_report_to` or `pending_admin`.

- [ ] **Step 1: Add failing AFC UI/policy tests**

Pin the label mapping:

```js
assert.equal(statusLabel('withdrawn'),'Withdrawn');
```

Assert the requester's pending card includes `Withdraw Request`, while approved/rejected/withdrawn cards do not.

- [ ] **Step 2: Add a dedicated `withdraw()` action**

In `afc-actions.js`:

```js
async function withdraw({db,user,request}){
  const ref=db.doc(`afc_requests/${request.id}`),audit=db.collection('afc_audit').doc();
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref),current=snap.data()||{};
    if(current.requesterUid!==user.uid)throw Error('Only the requester can withdraw this AFC request.');
    if(!['pending_report_to','pending_admin'].includes(current.status))throw Error('This AFC request can no longer be withdrawn.');
    tx.update(ref,{status:'withdrawn',withdrawnBy:user.uid,withdrawnAt:stamp(),updatedAt:stamp()});
    tx.set(audit,{action:'afc_withdraw',requestId:request.id,requesterUid:user.uid,changedBy:user.uid,changedAt:stamp()});
  });
}
```

Export `{decide,withdraw}`.

- [ ] **Step 3: Add AFC UI binding**

For own pending AFC requests render:

```html
<button data-afc-withdraw="REQUEST_ID">Withdraw Request</button>
```

Confirm before withdrawal. Do not require a new electronic signature to withdraw.

- [ ] **Step 4: Add `afcWithdraw()` Firestore rule**

Require:

```text
request.auth.uid == resource.data.requesterUid
source status in pending_report_to/pending_admin
target status == withdrawn
withdrawnBy == request.auth.uid
withdrawnAt == request.time
updatedAt == request.time
only withdrawal fields changed
```

Existing approve/reject rules already require pending source states, so a completed withdrawal makes later approval fail. Emulator tests must exercise both action orders.

- [ ] **Step 5: Run AFC tests**

```bash
node --test tests/afc-ui.test.js tests/afc-policy.test.js
npm run test:emulator
```

- [ ] **Step 6: Commit Task 10**

```bash
git add afc-actions.js afc-workflow.js firestore.rules tests/afc-ui.test.js tests/afc-policy.test.js tests/afc-withdraw-security-emulator.test.js
git commit -m "feat: allow requesters to withdraw pending AFC requests"
```

---

### Task 11: Run the full security matrix and document the two existing office-account profile links

**Files:**
- Modify: `tests/security-emulator.test.js` if consolidated matrix coverage is needed.
- Modify: `SETUP.md` only to document the Owner UI procedure; do not store passwords.

**Interfaces:**
- Consumes: all WS5B implementation tasks.
- Produces: verified role matrix and a safe, repeatable way to link the already-created Authentication users after deployment.

- [ ] **Step 1: Add/verify Emulator permission matrix**

The matrix must prove:

```text
ADC
  read calendar_sessions YES
  read sessions NO
  read faculty NO
  read AFC NO
  update ADC-owned source fields YES
  update LAB topic NO
  update assignments NO

LAB
  read calendar_sessions YES
  read sessions NO
  update LAB topic YES on LAB only
  update date/time/course/room/type NO
  update assignments NO

ADFA
  existing source/faculty/AFC reads YES
  instructor assignment workflow YES

Faculty
  own request public status YES
  internal office workflow/approval/private docs NO
  withdraw own pending request YES
  withdraw someone else's request NO
```

- [ ] **Step 2: Run the complete Emulator suite**

```bash
npm run test:emulator
```

Expected: all security tests PASS.

- [ ] **Step 3: Add safe setup instructions for linking pre-existing Auth users**

Document in `SETUP.md`:

```text
1. Sign in as Owner.
2. Open User Management.
3. Choose ADC or LAB.
4. Enter the office display name and email.
5. Paste the existing Firebase Authentication UID into Existing Firebase Authentication UID.
6. Save with Active enabled and Require password change enabled.
```

Do not write the real UID values or any temporary password into repository documentation. The user can paste the known values at deployment time.

- [ ] **Step 4: Run the normal test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 11**

```bash
git add tests/security-emulator.test.js SETUP.md
git commit -m "test: verify office privacy and setup workflow"
```

---

### Task 12: Build, open the WS5B PR, deploy rules to Emulator only, and perform the manual browser gate

**Files:**
- No application code changes unless manual testing discovers a defect; any defect fix starts with a failing automated test and a new commit.

**Interfaces:**
- Consumes: completed WS5A on `main` plus completed WS5B implementation branch.
- Produces: reviewable WS5B PR, green automated/security tests, manual browser evidence, and explicit user approval before merge.

- [ ] **Step 1: Run all automated verification**

```bash
npm test
npm run test:emulator
node tools/build-static.js
```

Expected: PASS; static bundle includes every new module.

- [ ] **Step 2: Open a dedicated WS5B PR against `main`**

Use a branch such as:

```text
feature/workstream-5b-office-approval-routing
```

PR description must explicitly say:

```text
Firestore rules changed.
Rules are tested in Emulator.
CI does not deploy rules.
Do not manually deploy rules to tester-teaching until the user approves the tested PR/version and the deployment sequence is ready.
```

- [ ] **Step 3: Wait for GitHub test + GitHub Pages test workflows**

Do not merge yet.

- [ ] **Step 4: Manually browser-test ADFA regression on GitHub Pages**

Verify existing ADFA behavior remains available:

```text
Add Sessions
Add One
Select Sessions
Instructor assignment
DOE/AFC/availability approval context
existing Faculty/HICC/VISC request behavior
```

- [ ] **Step 5: Browser-test ADC using an Emulator/local-safe permission path or approved test profile**

Verify:

```text
Calendar visible
Add Sessions visible
Add One visible
Select Sessions visible
Faculty fields greyed
LAB Topic greyed on LAB
non-LAB Topic editable
LAB create forces Topic TBD and no Instructor
source private reads denied
```

Because the GitHub Pages test site shares live Firebase, do not create destructive live test data unless explicitly approved.

- [ ] **Step 6: Browser-test LAB**

Verify:

```text
Calendar visible
only Select Sessions in Admin tools
non-LAB selection denied
LAB rows selectable
only Lab Topic editable
Date/Time/Course/Room/Type/Faculty greyed
source private reads denied
```

- [ ] **Step 7: Browser-test mixed approval lifecycle**

Use safe test data and verify:

```text
Date + Lab Topic + Faculty request
ADC sees own fields + statuses only
LAB sees own topic + statuses only
ADC/LAB Faculty context shows display name/status only
ADFA sees rich DOE/AFC/availability context
Push Back -> requester sees Update required without office identity
Resubmit returned scope -> prior unrelated approvals remain
Date/Time revision -> prior ADFA approval reopens
Reject -> no timetable fields apply
Withdraw -> no timetable fields apply
Faculty-change request can only final-apply through ADFA
non-Faculty request can final-apply through last required office
completion notification appears for participating offices
```

- [ ] **Step 8: Browser-test AFC Withdraw**

Verify requester can withdraw both `pending_report_to` and `pending_admin`, and cannot withdraw approved/rejected/withdrawn AFC requests.

- [ ] **Step 9: Ask the user to approve the exact tested WS5B PR/version**

Do not merge or deploy live Firestore Rules until explicit approval.

- [ ] **Step 10: After approval, merge and follow the controlled deployment sequence**

After merge:

```text
1. Verify main Test workflow.
2. Verify Azure Static Web Apps workflow / production approval gate.
3. Manually deploy the tested firestore.rules to project tester-teaching only when the UI/code version that expects them is ready.
4. Sign in as Owner and link the existing ADC/LAB Authentication accounts using User Management; do not recreate Auth users.
5. Verify both office profiles require password change as intended.
6. Re-run a non-destructive login/calendar smoke test for ADC/LAB.
```

Do not claim live rules or office profiles are deployed until there is explicit tool/user confirmation.
