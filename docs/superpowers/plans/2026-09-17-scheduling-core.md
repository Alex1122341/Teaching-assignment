# Workstream 5A Canonical Scheduling Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated timetable time/duration/overlap logic with one tested scheduling core and make all current timetable, selection, availability, and ADFA approval paths use the same conflict rules.

**Architecture:** Add a pure browser module `scheduling-core.js` that owns time parsing, interval validation, duration, overlap, date normalization, and structured Faculty timetable-conflict checks. Existing UI modules continue to own rendering, DOE/AFC display, and Firestore writes, but delegate scheduling meaning to `window.UCVM_SCHEDULING` instead of maintaining local copies.

**Tech Stack:** Vanilla JavaScript, Node `node:test`, Firebase Web compat SDK, Cloud Firestore, static HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-09-17-scheduling-core-design.md`

## Global Constraints

- Keep the production architecture Firebase Spark-compatible; do not add Cloud Functions or another server runtime.
- Adjacent intervals where one session ends exactly when another begins are not conflicts.
- Cross-midnight teaching sessions remain invalid.
- `timeUnknown: true` remains supported and must not receive invented times.
- Unknown/invalid comparison time returns a `check_needed` result rather than a false `clear` result.
- ADFA Faculty overlap remains warning + explicit deliberate override + audit, not a silent save and not a permanent hard block.
- Existing session IDs, Firestore collection names, stale-request protection, DOE calculations, AFC behavior, and privacy rules must remain intact.
- Do not change Firestore rules merely to centralize time logic.
- Add tests before implementation changes where practical.
- Run `npm test` before claiming the workstream is ready for browser testing.
- Do not merge the implementation PR until the exact GitHub Pages test build is manually browser-tested and explicitly approved by the user.

---

## File Structure

**Create**

- `scheduling-core.js` — pure canonical time/date/interval/conflict functions; no Firebase access and no DOM access.
- `tests/scheduling-core.test.js` — exhaustive unit tests for the shared scheduling semantics.

**Modify**

- `index.html` — load `scheduling-core.js` before timetable/selection/approval consumers.
- `tools/static-assets.json` — publish `scheduling-core.js` in both GitHub Pages test and Azure static bundles.
- `timetable.js` — replace local parsing, duration, and overlap business rules with `UCVM_SCHEDULING` calls.
- `timetable-selection.js` — validate selected-row timing through the shared core.
- `approval-workflow.js` — replace local timetable overlap functions and add explicit audited conflict override on current ADFA approvals.
- `tests/timetable-selection.test.js` — load the scheduling core before the selection module and assert shared validation behavior.
- `tests/page-modules.test.js` and/or `tests/runtime-assets.test.js` — assert module/static-asset loading order.
- Existing approval/integration tests as named in Task 4 — assert conflict override behavior without weakening stale-request checks.

---

### Task 1: Build the pure canonical scheduling module

**Files:**
- Create: `scheduling-core.js`
- Create: `tests/scheduling-core.test.js`

**Interfaces:**
- Consumes: plain strings/objects only; no Firebase and no DOM.
- Produces:
  - `UCVM_SCHEDULING.parseTime(value) -> number|null`
  - `UCVM_SCHEDULING.formatTime(minutes) -> string|null`
  - `UCVM_SCHEDULING.normalizeDate(value) -> string|null`
  - `UCVM_SCHEDULING.validateInterval(start,end,{timeUnknown=false}) -> {status,reason,startMinutes,endMinutes}`
  - `UCVM_SCHEDULING.durationMinutes(start,end,{timeUnknown=false}) -> number|null`
  - `UCVM_SCHEDULING.durationHours(start,end,{timeUnknown=false}) -> number|null`
  - `UCVM_SCHEDULING.intervalsOverlap(aStart,aEnd,bStart,bEnd) -> boolean|null`
  - `UCVM_SCHEDULING.validateSessionTiming(session) -> {status,reason,...}`
  - `UCVM_SCHEDULING.findFacultyConflicts({date,start,end,sessions,excludeSessionId,isAssigned}) -> {status,conflicts,possibleConflicts,reason}`

- [ ] **Step 1: Write failing unit tests for canonical parsing, duration, and interval behavior**

Create `tests/scheduling-core.test.js` with a VM loader and assertions equivalent to:

```js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function load(){
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
  return context.window.UCVM_SCHEDULING;
}

test('parseTime accepts supported forms and rejects impossible values',()=>{
  const api=load();
  assert.equal(api.parseTime('09:00'),540);
  assert.equal(api.parseTime('9:00'),540);
  assert.equal(api.parseTime('12:00 AM'),0);
  assert.equal(api.parseTime('12:00 PM'),720);
  assert.equal(api.parseTime('1:30 PM'),810);
  assert.equal(api.parseTime('24:00'),null);
  assert.equal(api.parseTime('09:60'),null);
  assert.equal(api.parseTime('13:00 PM'),null);
  assert.equal(api.parseTime(''),null);
});

test('interval validation rejects zero, reversed, and cross-midnight intervals',()=>{
  const api=load();
  assert.equal(api.validateInterval('09:00','10:00').status,'valid');
  assert.equal(api.validateInterval('10:00','10:00').status,'invalid');
  assert.equal(api.validateInterval('11:00','10:00').status,'invalid');
  assert.equal(api.validateInterval('23:30','00:30').status,'invalid');
  assert.equal(api.validateInterval('','',{timeUnknown:true}).status,'unknown');
});

test('duration and overlap use half-open interval semantics',()=>{
  const api=load();
  assert.equal(api.durationMinutes('09:00','10:30'),90);
  assert.equal(api.durationHours('09:00','10:30'),1.5);
  assert.equal(api.intervalsOverlap('09:00','10:00','10:00','11:00'),false);
  assert.equal(api.intervalsOverlap('09:00','10:01','10:00','11:00'),true);
  assert.equal(api.intervalsOverlap('09:00','11:00','09:30','10:00'),true);
  assert.equal(api.intervalsOverlap('bad','11:00','09:30','10:00'),null);
});
```

- [ ] **Step 2: Run the new unit test and confirm the expected failure**

Run:

```bash
node --test tests/scheduling-core.test.js
```

Expected: FAIL because `scheduling-core.js` does not exist yet.

- [ ] **Step 3: Implement the minimal canonical module**

Create `scheduling-core.js` with the following structure and semantics:

```js
'use strict';
window.UCVM_SCHEDULING=(()=>{
  function parseTime(value){
    const raw=String(value??'').trim();
    const match=raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if(!match)return null;
    let hour=Number(match[1]);
    const minute=Number(match[2]);
    if(!Number.isInteger(minute)||minute<0||minute>59)return null;
    const meridiem=String(match[3]||'').toUpperCase();
    if(meridiem){
      if(hour<1||hour>12)return null;
      if(hour===12)hour=0;
      if(meridiem==='PM')hour+=12;
    }else if(hour<0||hour>23)return null;
    return hour*60+minute;
  }

  function formatTime(minutes){
    if(!Number.isInteger(minutes)||minutes<0||minutes>=1440)return null;
    return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
  }

  function normalizeDate(value){
    const raw=String(value??'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;
    const d=new Date(`${raw}T12:00:00`);
    if(Number.isNaN(d.getTime()))return null;
    const [y,m,day]=raw.split('-').map(Number);
    return d.getFullYear()===y&&d.getMonth()+1===m&&d.getDate()===day?raw:null;
  }

  function validateInterval(start,end,{timeUnknown=false}={}){
    if(timeUnknown)return{status:'unknown',reason:'time_unknown',startMinutes:null,endMinutes:null};
    const startMinutes=parseTime(start),endMinutes=parseTime(end);
    if(startMinutes===null||endMinutes===null)return{status:'invalid',reason:'invalid_time',startMinutes,endMinutes};
    if(endMinutes<=startMinutes)return{status:'invalid',reason:'end_not_after_start',startMinutes,endMinutes};
    return{status:'valid',reason:'clear',startMinutes,endMinutes};
  }

  function durationMinutes(start,end,options={}){
    const check=validateInterval(start,end,options);
    return check.status==='valid'?check.endMinutes-check.startMinutes:null;
  }
  function durationHours(start,end,options={}){
    const minutes=durationMinutes(start,end,options);
    return minutes===null?null:minutes/60;
  }

  function intervalsOverlap(aStart,aEnd,bStart,bEnd){
    const a=validateInterval(aStart,aEnd),b=validateInterval(bStart,bEnd);
    if(a.status!=='valid'||b.status!=='valid')return null;
    return a.startMinutes<b.endMinutes&&b.startMinutes<a.endMinutes;
  }

  function validateSessionTiming(session={}){
    const date=normalizeDate(session.date);
    if(!date)return{status:'invalid',reason:'invalid_date',date:null};
    return{date,...validateInterval(session.start,session.end,{timeUnknown:session.timeUnknown===true})};
  }

  function findFacultyConflicts({date,start,end,sessions=[],excludeSessionId='',isAssigned=()=>false}){
    const normalizedDate=normalizeDate(date);
    const target=validateInterval(start,end);
    const sameDay=sessions.filter(s=>String(s?.id||'')!==String(excludeSessionId||'')&&normalizeDate(s?.date)===normalizedDate&&isAssigned(s));
    if(!normalizedDate||target.status!=='valid')return{status:'check_needed',conflicts:[],possibleConflicts:sameDay,reason:'target_time'};
    const conflicts=[],possibleConflicts=[];
    for(const session of sameDay){
      const check=validateInterval(session?.start,session?.end,{timeUnknown:session?.timeUnknown===true});
      if(check.status!=='valid'){possibleConflicts.push(session);continue;}
      if(target.startMinutes<check.endMinutes&&check.startMinutes<target.endMinutes)conflicts.push(session);
    }
    if(conflicts.length)return{status:'conflict',conflicts,possibleConflicts,reason:'overlap'};
    if(possibleConflicts.length)return{status:'check_needed',conflicts,possibleConflicts,reason:'other_time_unknown'};
    return{status:'clear',conflicts,possibleConflicts,reason:'clear'};
  }

  return{parseTime,formatTime,normalizeDate,validateInterval,durationMinutes,durationHours,intervalsOverlap,validateSessionTiming,findFacultyConflicts};
})();
```

- [ ] **Step 4: Add structured Faculty-conflict tests**

Append tests equivalent to:

```js
test('findFacultyConflicts separates real conflicts from unknown-time checks',()=>{
  const api=load();
  const sessions=[
    {id:'a',date:'2026-10-01',start:'09:00',end:'10:00',faculty:['f1']},
    {id:'b',date:'2026-10-01',start:'',end:'',timeUnknown:true,faculty:['f1']},
    {id:'c',date:'2026-10-02',start:'09:00',end:'10:00',faculty:['f1']}
  ];
  const assigned=s=>s.faculty.includes('f1');
  const result=api.findFacultyConflicts({date:'2026-10-01',start:'09:30',end:'10:30',sessions,isAssigned:assigned});
  assert.equal(result.status,'conflict');
  assert.deepEqual(result.conflicts.map(x=>x.id),['a']);
  assert.deepEqual(result.possibleConflicts.map(x=>x.id),['b']);
  const adjacent=api.findFacultyConflicts({date:'2026-10-01',start:'10:00',end:'11:00',sessions:[sessions[0]],isAssigned:assigned});
  assert.equal(adjacent.status,'clear');
});
```

- [ ] **Step 5: Run the focused tests and make them pass**

Run:

```bash
node --test tests/scheduling-core.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add scheduling-core.js tests/scheduling-core.test.js
git commit -m "feat: add canonical scheduling core"
```

---

### Task 2: Publish and load the scheduling core before all consumers

**Files:**
- Modify: `index.html`
- Modify: `tools/static-assets.json`
- Modify: `tests/runtime-assets.test.js`
- Modify: `tests/page-modules.test.js` if that test owns script-order assertions

**Interfaces:**
- Consumes: `scheduling-core.js` from Task 1.
- Produces: guaranteed browser global `window.UCVM_SCHEDULING` before `timetable-selection.js`, `timetable.js`, and dynamically loaded `approval-workflow.js` use it.

- [ ] **Step 1: Add a failing static-asset/script-order test**

Add assertions equivalent to:

```js
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const assets=JSON.parse(fs.readFileSync(path.join(root,'tools/static-assets.json'),'utf8'));
assert.ok(assets.includes('scheduling-core.js'));
assert.ok(html.includes('<script src="scheduling-core.js"></script>'));
assert.ok(html.indexOf('scheduling-core.js')<html.indexOf('timetable-selection.js'));
assert.ok(html.indexOf('scheduling-core.js')<html.indexOf('timetable.js'));
```

- [ ] **Step 2: Run the focused asset tests and verify they fail**

Run:

```bash
node --test tests/runtime-assets.test.js tests/page-modules.test.js
```

Expected: FAIL because the asset and script tag are not present.

- [ ] **Step 3: Add the script in the canonical load order**

Change the bottom script chain in `index.html` so the relevant portion is:

```html
<script src="availability-lookup.js"></script>
<script src="scheduling-core.js"></script>
<script src="timetable-selection.js"></script>
<script src="timetable.js"></script>
```

Add `"scheduling-core.js"` to `tools/static-assets.json` adjacent to the timetable modules.

- [ ] **Step 4: Run asset tests and the core tests**

```bash
node --test tests/scheduling-core.test.js tests/runtime-assets.test.js tests/page-modules.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add index.html tools/static-assets.json tests/runtime-assets.test.js tests/page-modules.test.js
git commit -m "build: publish canonical scheduling module"
```

---

### Task 3: Make timetable and selection paths delegate to the canonical core

**Files:**
- Modify: `timetable.js`
- Modify: `timetable-selection.js`
- Modify: `tests/timetable-selection.test.js`
- Create or modify: `tests/doe-canonical-consistency.test.js` only if needed to pin duration fallback behavior

**Interfaces:**
- Consumes: `UCVM_SCHEDULING` from Task 1.
- Produces: all current timetable validation, day/week lane positioning inputs, Faculty timetable-conflict checks, and selection row timing validation use the same parser/interval semantics.

- [ ] **Step 1: Update selection tests to load the shared module first and add adjacency/invalid-time cases**

Change the test loader to:

```js
function load(){
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(root,'timetable-selection.js'),'utf8'),context);
  return context.window.UCVM_TIMETABLE_SELECTION;
}
```

Add assertions that `10:00-11:00` following `09:00-10:00` validates, while equal/reversed time remains invalid.

- [ ] **Step 2: Run the selection tests and verify failure before changing the consumer**

```bash
node --test tests/timetable-selection.test.js
```

Expected: FAIL because `timetable-selection.js` still owns its old timing validation.

- [ ] **Step 3: Replace selection timing business logic with the shared API**

At module startup require the shared API:

```js
const scheduling=window.UCVM_SCHEDULING;
if(!scheduling)throw new Error('UCVM scheduling core is required.');
```

In `validateRow`, replace manual start/end parsing/comparison with:

```js
const timing=scheduling.validateSessionTiming(row);
if(timing.status==='invalid')errors.push(`Row ${rowNumber}: end time must be after start time and use a valid timetable time.`);
```

Do not add a fallback parser.

- [ ] **Step 4: Replace duplicated timetable time helpers with aliases/delegation, not duplicate parsing**

In `timetable.js`, use one shared reference:

```js
const scheduling=window.UCVM_SCHEDULING;
```

Replace business-rule implementations so call sites use:

```js
scheduling.parseTime(value)
scheduling.durationHours(start,end,{timeUnknown:s.timeUnknown===true})
scheduling.intervalsOverlap(aStart,aEnd,bStart,bEnd)
scheduling.findFacultyConflicts({...})
```

If an old function name is too invasive to remove in one task, keep only a one-line adapter such as:

```js
const timeToMinutes=value=>scheduling.parseTime(value);
const blockHours=(start,end)=>scheduling.durationHours(start,end)??0;
```

Adapters must contain no independent parsing/overlap rules.

- [ ] **Step 5: Convert `timetableAvailability()` to the structured shared conflict result**

Use the existing authorized `sessionHasFaculty(sess,f)` matcher as the assignment predicate:

```js
const check=scheduling.findFacultyConflicts({
  date:dateYmd,
  start,
  end,
  sessions:pageSessions(),
  excludeSessionId,
  isAssigned:sess=>sessionHasFaculty(sess,f)
});
return {
  available:check.status==='clear'?true:(check.status==='conflict'?false:null),
  conflicts:check.conflicts,
  possibleConflicts:check.possibleConflicts,
  reason:check.reason
};
```

Keep AFC availability as a separate existing concern and combine it only in `facultyAssignmentAvailability()`.

- [ ] **Step 6: Preserve DOE duration fallback semantics**

Where assignment hours currently fall back to session start/end, use:

```js
const hours=scheduling.durationHours(s.start,s.end,{timeUnknown:s.timeUnknown===true});
return hours===null?null:hours;
```

Do not overwrite explicit `creditedHours` or `doeCredit`.

- [ ] **Step 7: Run focused timetable/selection/DOE tests**

```bash
node --test tests/scheduling-core.test.js tests/timetable-selection.test.js tests/doe-canonical-consistency.test.js tests/timetable-multi-edit-ui.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add timetable.js timetable-selection.js tests/timetable-selection.test.js tests/doe-canonical-consistency.test.js
git commit -m "refactor: use canonical scheduling rules in timetable"
```

---

### Task 4: Make current ADFA approval conflict checks canonical and require audited override

**Files:**
- Modify: `approval-workflow.js`
- Create or modify: `tests/approval-scheduling.test.js`
- Modify: `tests/audit-details.test.js` only if the audit renderer needs the new override field displayed

**Interfaces:**
- Consumes: `UCVM_SCHEDULING.findFacultyConflicts()` and current authorized ADFA Faculty/AFC data.
- Produces: current approval workflow detects the same overlap as the timetable, blocks accidental approval on a real conflict until deliberate override, and writes an audit-visible override payload.

- [ ] **Step 1: Add a focused approval scheduling test harness**

Create `tests/approval-scheduling.test.js` that loads `scheduling-core.js` and a small exported/pure approval policy helper from `approval-workflow.js` or a testable helper extracted during this task. Pin these outcomes:

```js
assert.equal(policy.requiresOverride({status:'conflict'}),true);
assert.equal(policy.requiresOverride({status:'clear'}),false);
assert.equal(policy.requiresOverride({status:'check_needed'}),false);
assert.deepEqual(
  policy.overrideAudit({uid:'admin-1',name:'Admin User'},[{id:'s2',course:'304',date:'2026-10-01',start:'09:00',end:'10:00'}]),
  {
    type:'faculty_time_conflict',
    confirmed:true,
    confirmedBy:'admin-1',
    confirmedByName:'Admin User',
    conflicts:[{id:'s2',course:'304',date:'2026-10-01',start:'09:00',end:'10:00'}]
  }
);
```

Keep timestamps outside the pure helper so tests remain deterministic.

- [ ] **Step 2: Run the focused test and verify failure**

```bash
node --test tests/approval-scheduling.test.js
```

Expected: FAIL because the pure policy/export does not exist.

- [ ] **Step 3: Remove local `timeMinutes()` / `overlaps()` scheduling meaning from `approval-workflow.js`**

Replace the current local functions with shared calls. `timetableCheck()` may remain as an adapter for existing view code, but its overlap result must come from:

```js
const check=UCVM_SCHEDULING.findFacultyConflicts({
  date,
  start,
  end,
  sessions:[...sessions.values()],
  excludeSessionId:excludeId,
  isAssigned:s=>sessionHasFaculty(s,f)
});
```

Map `status` back to the existing approval display shape only at the UI boundary.

- [ ] **Step 4: Add a deliberate conflict-override confirmation to the approval action**

When the proposed Faculty assignment has `status === 'conflict'`, show a confirmation containing the conflicting course/time and require explicit confirmation before the approval write proceeds:

```js
const conflictText=check.conflicts.map(s=>`${s.course||'Course'} ${s.start||'—'}-${s.end||'—'}`).join('\n');
const confirmed=window.confirm(`WARNING: Faculty timetable conflict\n\n${conflictText}\n\nOverride and approve this assignment?`);
if(!confirmed)return;
```

Do not treat `check_needed` as clear. Continue showing the existing incomplete-check warning/context to ADFA.

- [ ] **Step 5: Persist an auditable override payload when confirmation occurs**

Build the payload without private AFC/DOE details:

```js
const conflictOverride={
  type:'faculty_time_conflict',
  confirmed:true,
  confirmedBy:user.uid,
  confirmedByName:me?.name||user.email||'',
  confirmedAt:stamp(),
  conflicts:check.conflicts.map(s=>({
    id:String(s.id||''),course:String(s.course||''),date:String(s.date||''),start:String(s.start||''),end:String(s.end||'')
  }))
};
```

Include it on the approval/session audit record created by the existing apply path. Do not copy AFC reason, DOE values, email, or UCID into this override subobject.

- [ ] **Step 6: Preserve stale-request and live-session recheck order**

The approval path must still reload/revalidate the live session before apply. The order should be:

```text
load current live session
-> stale-base comparison
-> current Faculty/AFC/timetable checks
-> conflict confirmation when needed
-> write session + audit
```

Do not move confirmation ahead of the live recheck.

- [ ] **Step 7: Run focused approval and scheduling tests**

```bash
node --test tests/approval-scheduling.test.js tests/scheduling-core.test.js tests/audit-details.test.js tests/faculty-swap-integration.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add approval-workflow.js tests/approval-scheduling.test.js tests/audit-details.test.js
git commit -m "feat: require audited override for faculty conflicts"
```

---

### Task 5: Remove remaining duplicate scheduling-rule implementations and run regression verification

**Files:**
- Modify only files that still contain duplicate time/overlap business rules after Tasks 1-4.
- Modify: `tests/page-modules.test.js` or `tests/runtime-assets.test.js` if a final dependency assertion is missing.

**Interfaces:**
- Consumes: complete WS5A changes.
- Produces: no independent timetable overlap parser remains in active timetable/approval/selection paths.

- [ ] **Step 1: Search for legacy duplicate implementations**

Run:

```bash
grep -RInE "function (timeToMinutes|availabilityTimeMinutes|timeMinutes|overlaps|availabilityIntervalsOverlap)|as<be&&bs<ae|h\*60\+" -- *.js tests test-support
```

Expected: any remaining active implementation is either inside `scheduling-core.js` or a one-line adapter that delegates to it. Test fixtures may contain literal examples but must not encode a second production implementation.

- [ ] **Step 2: Replace any remaining production duplicate with shared calls**

For each active duplicate, replace the body with a shared call or remove the helper. Do not introduce another fallback parser.

- [ ] **Step 3: Run the full automated suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Build the shared static bundle**

```bash
node tools/build-static.js
```

Expected: successful build including `scheduling-core.js` and no missing-asset error.

- [ ] **Step 5: Commit any cleanup from Task 5**

```bash
git add scheduling-core.js timetable.js timetable-selection.js approval-workflow.js index.html tools/static-assets.json tests
git commit -m "test: verify canonical scheduling integration"
```

---

### Task 6: Open the WS5A PR and perform the manual browser gate

**Files:**
- No application code should be changed during this task unless a browser-discovered defect requires a new test-first fix commit.

**Interfaces:**
- Consumes: green WS5A implementation branch.
- Produces: one reviewable PR and an explicit manual-test result; no merge without user approval.

- [ ] **Step 1: Push the WS5A implementation branch and open a PR against `main`**

Use a dedicated implementation branch such as:

```text
feature/workstream-5a-scheduling-core
```

PR description must state that Firestore rules are unchanged for WS5A.

- [ ] **Step 2: Wait for GitHub test + GitHub Pages test workflows to succeed**

Do not merge on CI success alone.

- [ ] **Step 3: Manually test the fixed GitHub Pages test site**

Verify at minimum:

```text
1. Existing week/day/month/list timetable loads.
2. 09:00-10:00 and 10:00-11:00 are treated as adjacent, not conflicting.
3. 09:00-10:01 and 10:00-11:00 produce a conflict.
4. Add One rejects equal/reversed time.
5. Add Sessions rejects invalid rows consistently.
6. Select Sessions uses the same time validation.
7. Faculty assignment availability shows real overlaps consistently.
8. Unknown-time sessions show Check needed rather than Available.
9. ADFA approval shows the current DOE/AFC context.
10. A real Faculty conflict requires explicit Override and records it in change history/audit.
11. Canceling the override leaves the request/session unchanged.
```

- [ ] **Step 4: Ask the user to approve the exact tested PR/version**

Do not merge until the user explicitly approves that exact build.

- [ ] **Step 5: After explicit approval, merge and verify post-merge workflows**

Verify both the `main` Test workflow and Azure Static Web Apps workflow. Respect the existing production-environment approval gate; do not bypass it.
