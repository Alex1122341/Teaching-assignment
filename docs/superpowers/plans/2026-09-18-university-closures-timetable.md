# Shared University Closures + Timetable Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AFC's duplicated hard-coded closure dates with one canonical University closure calendar and expose the same named closures as an opt-in, read-only 07:30-17:00 overlay in the timetable.

**Architecture:** A new pure `university-closures.js` module owns all closure dates, names, date-range lookup, and workday counting. AFC consumes that module directly; the timetable projects closure entries into in-memory synthetic rows only at render/export time, never into Firestore or scheduling/DOE data. Existing CCC behavior stays independent, while both CCC and closure rows share a read-only synthetic-session guard for edit/selection safety.

**Tech Stack:** Vanilla browser JavaScript, Node.js `node:test`, existing Firebase compat runtime, existing static-site build pipeline, GitHub Actions + Firebase Emulator Suite.

**Spec:** `docs/superpowers/specs/2026-09-18-university-closures-timetable-design.md`

## Global Constraints

- `university-closures.js` is the only application source of University closure dates and names.
- Runtime closure data remains static/bundled; do not fetch external calendar websites.
- Preserve the existing AFC 2026-2027 closure dates exactly during this refactor.
- University closure timetable rows are memory-only synthetic rows and must never be written to `sessions`, `calendar_sessions`, derived indexes, or audit collections.
- Timetable closure display time is exactly **07:30-17:00**.
- Standard ICS exports represent University closures as all-day events.
- Outlook teaching invitation packages always exclude University closures.
- A closure overlay is not hidden by Year, Course, Type, Search, My Timetable, or Faculty filters after the user explicitly turns **Show University Closures** on.
- Term breaks, Fall Break, weekends, and other non-teaching days are not closures unless explicitly present in the canonical catalog.
- No `firestore.rules` changes.
- Do not change CCC persistence/storage semantics.
- Do not mix this feature with privacy / approval-security / AFC authorization / 200-row student-owned work.
- Keep the existing workflow: feature branch -> tests -> GitHub Pages test site -> manual browser acceptance -> explicit merge approval -> merge to `main` -> main verification/build -> separate production approval.

---

### Task 1: Canonical University closure calendar and AFC migration

**Files:**
- Create: `university-closures.js`
- Create: `tests/university-closures.test.js`
- Modify: `afc-workflow.js`
- Modify: `test-support/afc-policy.js`
- Modify: `tests/afc-policy.test.js`
- Modify: `tests/afc-timetable-integration.test.js`

**Interfaces:**
- Consumes: no application module; date-only strings are `YYYY-MM-DD`.
- Produces: `UCVM_UNIVERSITY_CLOSURES.entries`, `get(date)`, `isClosed(date)`, `between(startDate,endDate)`, and `countWorkingDays(startDate,endDate)`.
- Node tests consume the same API through `require('../university-closures')`.
- AFC runtime obtains it from `window.UCVM_UNIVERSITY_CLOSURES`.

- [ ] **Step 1: Write the closure-core and AFC regression tests first**

Create `tests/university-closures.test.js` with exact catalog and date-only behavior assertions:

```js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const closures=require('../university-closures');

test('University closure catalog is sorted unique and carries display names',()=>{
  const dates=closures.entries.map(row=>row.date);
  assert.deepEqual(dates,[...dates].sort());
  assert.equal(new Set(dates).size,dates.length);
  assert.deepEqual(closures.get('2027-02-15'),{
    date:'2027-02-15',
    name:'Family Day',
    category:'university_closure'
  });
  assert.equal(closures.get('2027-09-30').name,'National Day for Truth and Reconciliation');
  assert.equal(closures.get('2027-12-27').name,'Holiday Observance — University Closed');
  assert.equal(closures.get('2027-04-01'),null);
});

test('closure range lookup is inclusive and date-only safe',()=>{
  assert.deepEqual(
    closures.between('2027-03-26','2027-03-29').map(row=>row.date),
    ['2027-03-26','2027-03-29']
  );
  assert.deepEqual(closures.between('2027-03-27','2027-03-28'),[]);
  assert.deepEqual(closures.between('bad','2027-03-29'),[]);
});

test('working days exclude weekends and catalog closures exactly once',()=>{
  assert.equal(closures.countWorkingDays('2026-09-28','2026-10-02'),4);
  assert.equal(closures.countWorkingDays('2026-12-21','2027-01-04'),5);
  assert.equal(closures.countWorkingDays('2027-02-13','2027-02-15'),0);
  assert.equal(closures.countWorkingDays('2027-02-16','2027-02-16'),1);
  assert.equal(closures.countWorkingDays('','2027-02-16'),0);
  assert.equal(closures.countWorkingDays('2027-02-17','2027-02-16'),0);
});
```

Extend `tests/afc-policy.test.js` so its holiday set is explicitly derived from the shared catalog rather than duplicated:

```js
const closures=require('../university-closures');

test('AFC policy derives its closure dates from the shared catalog',()=>{
  assert.equal(HOLIDAYS.size,closures.entries.length);
  for(const row of closures.entries)assert.equal(HOLIDAYS.has(row.date),true,row.date);
});
```

Update the VM harnesses in `tests/afc-timetable-integration.test.js` to run `university-closures.js` before `afc-workflow.js`:

```js
vm.runInNewContext(read('university-closures.js'), context);
vm.runInNewContext(read('afc-workflow.js'), context);
```

Add one integration assertion that the AFC runtime no longer owns a second date list:

```js
test('AFC runtime delegates workday policy to the shared University closure calendar',()=>{
  const source=read('afc-workflow.js');
  assert.match(source,/UCVM_UNIVERSITY_CLOSURES/);
  assert.match(source,/countWorkingDays/);
  assert.doesNotMatch(source,/const holidays=new Set/);
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail for the intended reasons**

Run:

```bash
node --test tests/university-closures.test.js tests/afc-policy.test.js tests/afc-timetable-integration.test.js
```

Expected result before implementation:

- `tests/university-closures.test.js` fails because `../university-closures` does not exist.
- AFC integration/policy assertions fail because AFC and `test-support/afc-policy.js` still own duplicated hard-coded date sets.

- [ ] **Step 3: Implement `university-closures.js` as a pure browser/CommonJS module**

Use a UMD-style wrapper consistent with existing focused modules:

```js
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UCVM_UNIVERSITY_CLOSURES=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';

  const entries=[
    {date:'2026-01-01',name:"New Year's Day",category:'university_closure'},
    {date:'2026-02-16',name:'Family Day',category:'university_closure'},
    {date:'2026-04-03',name:'Good Friday',category:'university_closure'},
    {date:'2026-04-06',name:'Easter Monday',category:'university_closure'},
    {date:'2026-05-18',name:'Victoria Day',category:'university_closure'},
    {date:'2026-07-01',name:'Canada Day',category:'university_closure'},
    {date:'2026-08-03',name:'Heritage Day',category:'university_closure'},
    {date:'2026-09-07',name:'Labour Day',category:'university_closure'},
    {date:'2026-09-30',name:'National Day for Truth and Reconciliation',category:'university_closure'},
    {date:'2026-10-12',name:'Thanksgiving Day',category:'university_closure'},
    {date:'2026-11-11',name:'Remembrance Day',category:'university_closure'},
    {date:'2026-12-25',name:'Christmas Day',category:'university_closure'},
    {date:'2026-12-28',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2026-12-29',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2026-12-30',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2026-12-31',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2027-01-01',name:"New Year's Day",category:'university_closure'},
    {date:'2027-02-15',name:'Family Day',category:'university_closure'},
    {date:'2027-03-26',name:'Good Friday',category:'university_closure'},
    {date:'2027-03-29',name:'Easter Monday',category:'university_closure'},
    {date:'2027-05-24',name:'Victoria Day',category:'university_closure'},
    {date:'2027-07-01',name:'Canada Day',category:'university_closure'},
    {date:'2027-08-02',name:'Heritage Day',category:'university_closure'},
    {date:'2027-09-06',name:'Labour Day',category:'university_closure'},
    {date:'2027-09-30',name:'National Day for Truth and Reconciliation',category:'university_closure'},
    {date:'2027-10-11',name:'Thanksgiving Day',category:'university_closure'},
    {date:'2027-11-11',name:'Remembrance Day',category:'university_closure'},
    {date:'2027-12-27',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2027-12-28',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2027-12-29',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2027-12-30',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2027-12-31',name:'Holiday Observance — University Closed',category:'university_closure'}
  ];

  const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
  const catalog=Object.freeze(entries.map(row=>Object.freeze({...row})));
  const byDate=new Map(catalog.map(row=>[row.date,row]));

  function validDate(value){
    const raw=String(value||'');
    if(!DATE_RE.test(raw))return null;
    const d=new Date(raw+'T00:00:00Z');
    return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===raw?raw:null;
  }
  function utcDate(value){return new Date(value+'T00:00:00Z')}
  function get(date){return byDate.get(String(date||''))||null}
  function isClosed(date){return byDate.has(String(date||''))}
  function between(startDate,endDate){
    const start=validDate(startDate),end=validDate(endDate);
    if(!start||!end||start>end)return[];
    return catalog.filter(row=>row.date>=start&&row.date<=end);
  }
  function countWorkingDays(startDate,endDate){
    const start=validDate(startDate),end=validDate(endDate);
    if(!start||!end||start>end)return 0;
    let count=0;
    for(let d=utcDate(start);d<=utcDate(end);d.setUTCDate(d.getUTCDate()+1)){
      const key=d.toISOString().slice(0,10),day=d.getUTCDay();
      if(day!==0&&day!==6&&!isClosed(key))count++;
    }
    return count;
  }

  return{entries:catalog,get,isClosed,between,countWorkingDays};
});
```

Do not add automatic holiday formulas. The explicit catalog is the institutional source used by the application.

- [ ] **Step 4: Replace AFC's duplicate date sets with the shared API**

At the top of `afc-workflow.js`, remove `const holidays=new Set(...)` and bind the shared module:

```js
const closures=window.UCVM_UNIVERSITY_CLOSURES;
if(!closures)throw Error('UCVM University closure calendar is required.');
```

Replace the local workday loop with:

```js
function workDays(a,b){return closures.countWorkingDays(a,b)}
```

In `test-support/afc-policy.js`, derive `HOLIDAYS` instead of maintaining a second catalog:

```js
const closures=require('../university-closures');
const HOLIDAYS=new Set(closures.entries.map(row=>row.date));

function workDays(startDate,endDate){
  const start=parse(startDate),end=parse(endDate);
  if(end<start)throw Error('End date must be on or after start date.');
  return closures.countWorkingDays(ymd(start),ymd(end));
}
```

This keeps test-policy validation errors intact while sharing the actual closure source.

- [ ] **Step 5: Run focused tests and verify the AFC baseline is unchanged**

Run:

```bash
node --test tests/university-closures.test.js tests/afc-policy.test.js tests/afc-timetable-integration.test.js
```

Expected: all pass, including:

- `2026-12-21 -> 2027-01-04 = 5` working days;
- `2027-02-15` resolves to Family Day;
- AFC runtime has no hard-coded closure set.

- [ ] **Step 6: Commit Task 1**

```bash
git add university-closures.js afc-workflow.js test-support/afc-policy.js tests/university-closures.test.js tests/afc-policy.test.js tests/afc-timetable-integration.test.js
git commit -m "feat: centralize university closure calendar"
```

---

### Task 2: Static asset and dependency load order

**Files:**
- Modify: `tools/static-assets.json`
- Modify: `index.html`
- Modify: `tests/afc-timetable-integration.test.js`
- Modify: `tests/university-closures.test.js`

**Interfaces:**
- Consumes: `university-closures.js` from Task 1.
- Produces: guaranteed browser load order before both `timetable.js` and `afc-workflow.js`, and inclusion in the static deployment artifact.

- [ ] **Step 1: Add failing static-asset/load-order tests**

Add to `tests/university-closures.test.js`:

```js
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('shared closure module ships in the static deployment allowlist',()=>{
  const assets=JSON.parse(read('tools/static-assets.json'));
  assert.ok(assets.includes('university-closures.js'));
});

test('timetable loads closure calendar before both timetable and AFC consumers',()=>{
  const html=read('index.html');
  const closure=html.indexOf('university-closures.js');
  const timetable=html.indexOf('timetable.js');
  const afc=html.indexOf('afc-workflow.js');
  assert.ok(closure>=0);
  assert.ok(closure<timetable,'closure calendar loads before timetable.js');
  assert.ok(closure<afc,'closure calendar loads before afc-workflow.js');
});
```

Also strengthen the first test in `tests/afc-timetable-integration.test.js` with the same runtime order assertion.

- [ ] **Step 2: Run the static tests and confirm the new assertions fail**

Run:

```bash
node --test tests/university-closures.test.js tests/afc-timetable-integration.test.js
```

Expected: failure because the new module is not yet in `tools/static-assets.json` or `index.html`.

- [ ] **Step 3: Add the asset and script dependency**

Add:

```json
"university-closures.js"
```

to `tools/static-assets.json`.

In `index.html`, load the module in the common script chain before the timetable/AFC consumers, for example immediately after `scheduling-core.js`:

```html
<script src="scheduling-core.js"></script>
<script src="university-closures.js"></script>
```

Keep `timetable.js` and `afc-workflow.js` after that point.

- [ ] **Step 4: Verify static packaging and dependency order**

Run:

```bash
node --test tests/university-closures.test.js tests/afc-timetable-integration.test.js
node tools/build-static.js
test -f .deploy-static/university-closures.js
```

Expected: tests pass and `.deploy-static/university-closures.js` exists.

- [ ] **Step 5: Commit Task 2**

```bash
git add tools/static-assets.json index.html tests/university-closures.test.js tests/afc-timetable-integration.test.js
git commit -m "build: ship shared university closure calendar"
```

---

### Task 3: Timetable closure overlay, filtering, rendering, and read-only protection

**Files:**
- Create: `tests/timetable-university-closures.test.js`
- Modify: `index.html`
- Modify: `timetable.js`
- Modify: `timetable.css`
- Modify: `timetable-selection.js`
- Modify: `tests/timetable-selection.test.js`
- Modify: `tests/timetable-multi-edit-ui.test.js`
- Modify: `tests/timetable-views-export.test.js`

**Interfaces:**
- Consumes: `window.UCVM_UNIVERSITY_CLOSURES.between(start,end)`.
- Produces: `showUniversityClosures` UI state, `universityClosureRows(start,end)`, `sessionsWithOverlays(source,start,end)`, and a shared read-only synthetic-session predicate.
- Synthetic row marker: `isUniversityClosure:true`.
- Synthetic row type: `CLOSURE`.
- Synthetic row display course: `University Closed`.

- [ ] **Step 1: Write failing timetable overlay tests**

Create `tests/timetable-university-closures.test.js`:

```js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const closures=require('../university-closures');

test('timetable exposes an opt-in University closure control beside CCC',()=>{
  const html=read('index.html');
  assert.match(html,/id="show-ccc"/);
  assert.match(html,/id="show-university-closures"/);
  assert.match(html,/Show University Closures/);
  assert.ok(html.indexOf('show-ccc')<html.indexOf('show-university-closures'));
});

test('University closure overlay defaults off and reset turns it off',()=>{
  const js=read('timetable.js');
  assert.match(js,/showUniversityClosures\s*=\s*false/);
  assert.match(js,/showUniversityClosures=false/);
  assert.match(js,/\$\('show-university-closures'\)\.checked=false/);
});

test('University closure row projection carries exact display data',()=>{
  const source=read('timetable.js');
  const match=source.match(/  function universityClosureRows\([\s\S]*?\n  \}/);
  assert.ok(match,'universityClosureRows should be independently testable');
  const context={
    closureCalendar:closures,
    showUniversityClosures:true,
    parseYmd:value=>new Date(value+'T00:00:00Z'),
    academicPositionForDate:()=>({semester:'winter',week:7})
  };
  vm.runInNewContext(match[0]+'\nresult=universityClosureRows;',context);
  const rows=context.result('2027-02-15','2027-02-15');
  assert.equal(rows.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(rows[0])),{
    id:'closure-2027-02-15',
    date:'2027-02-15',
    week:7,
    semester:'winter',
    year:'',
    course:'UC',
    courseName:'University Closed',
    type:'CLOSURE',
    topic:'Family Day',
    instructor:'',
    assignments:[],
    room:'',
    start:'07:30',
    end:'17:00',
    timeUnknown:false,
    isUniversityClosure:true,
    sourceSystem:'UCalgary University Closure Calendar'
  });
});

test('closure overlays bypass teaching filters only after explicit opt-in',()=>{
  const js=read('timetable.js');
  assert.match(js,/if\(s\.isUniversityClosure\)return showUniversityClosures/);
  assert.match(js,/sessionsWithOverlays/);
  assert.doesNotMatch(js,/courseCodes[\s\S]*University Closed/);
});

test('closure rendering has dedicated day week month list copy and styling',()=>{
  const js=read('timetable.js'),css=read('timetable.css');
  assert.match(js,/University Closed/);
  assert.match(js,/Institutional closure/);
  assert.match(js,/isUniversityClosure/);
  assert.match(css,/\.tg-type-closure/);
  assert.match(css,/html\.dark[\s\S]*tg-type-closure/);
});

test('closure details are read-only institutional records',()=>{
  const js=read('timetable.js');
  assert.match(js,/University Closure — read-only institutional calendar record/);
  assert.match(js,/UCalgary University Closure Calendar/);
});

test('closure rows stay in render/export projection and out of core teaching data',()=>{
  const js=read('timetable.js');
  assert.match(js,/sessions:\(\)=>pageSessions\(\)/);
  const pageData=js.slice(js.indexOf('window.UCVM_PAGE_DATA='),js.indexOf('let scheduleSource'));
  assert.doesNotMatch(pageData,/sessionsWithOverlays|universityClosureRows/);
  const schedulingReview=js.slice(js.indexOf('function reviewSchedulingChanges'),js.indexOf('function sessionLabel'));
  assert.doesNotMatch(schedulingReview,/sessionsWithOverlays|universityClosureRows/);
  const derived=js.slice(js.indexOf('async function updateDerivedIndexes'),js.indexOf('async function ensureFacultyDirectory'));
  assert.doesNotMatch(derived,/sessionsWithOverlays|universityClosureRows/);
});
```

Extend `tests/timetable-selection.test.js`:

```js
test('read-only synthetic records cannot be selected by any office role',()=>{
  const api=load();
  for(const role of ['adfa_general','adc','lab']){
    assert.equal(api.editPolicy(role,{isUniversityClosure:true,type:'CLOSURE'}).canSelect,false);
    assert.equal(api.editPolicy(role,{isCcc:true,type:'CCC'}).canSelect,false);
  }
  const rows=api.selectedRows(
    [{id:'normal'},{id:'ccc',isCcc:true},{id:'closed',isUniversityClosure:true}],
    ['normal','ccc','closed']
  );
  assert.deepEqual(plain(rows.map(row=>row.id)),['normal']);
});
```

Update `tests/timetable-multi-edit-ui.test.js` so the existing CCC guard becomes a shared synthetic guard:

```js
test('selection mode blocks CCC and University closure synthetic rows',()=>{
  const js=read('timetable.js');
  assert.match(js,/function isReadOnlySynthetic/);
  assert.match(js,/isReadOnlySynthetic\(s\)/);
  assert.match(js,/University closure records are read-only|read-only institutional/i);
});
```

- [ ] **Step 2: Run the timetable-focused tests and confirm they fail**

Run:

```bash
node --test tests/timetable-university-closures.test.js tests/timetable-selection.test.js tests/timetable-multi-edit-ui.test.js tests/timetable-views-export.test.js
```

Expected: new tests fail because the control, overlay rows, closure type styling, and shared read-only guard do not exist yet.

- [ ] **Step 3: Add timetable state, checkbox, row projection, and shared overlay assembly**

At timetable initialization, bind the closure module and fail closed if dependency order is wrong:

```js
const closureCalendar=window.UCVM_UNIVERSITY_CLOSURES;
if(!closureCalendar)throw Error('UCVM University closure calendar is required.');
```

Add state beside CCC state:

```js
let showCcc=false;
let showUniversityClosures=false;
```

In `index.html`, place this immediately after **Show CCC**:

```html
<label class="ccc-toggle closure-toggle">
  <input type="checkbox" id="show-university-closures">
  Show University Closures
</label>
```

Add the projection helper exactly as a pure function over the catalog/range:

```js
function universityClosureRows(start,end){
  if(!showUniversityClosures)return[];
  return closureCalendar.between(start,end).map(entry=>{
    const position=academicPositionForDate(parseYmd(entry.date));
    return{
      id:`closure-${entry.date}`,
      date:entry.date,
      week:position.week,
      semester:position.semester,
      year:'',
      course:'UC',
      courseName:'University Closed',
      type:'CLOSURE',
      topic:entry.name,
      instructor:'',
      assignments:[],
      room:'',
      start:'07:30',
      end:'17:00',
      timeUnknown:false,
      isUniversityClosure:true,
      sourceSystem:'UCalgary University Closure Calendar'
    };
  });
}

function sessionsWithOverlays(source,start,end){
  return [...source,...expandCccEvents(start,end),...universityClosureRows(start,end)];
}
```

Replace render/export calls to `sessionsWithCcc(...)` with `sessionsWithOverlays(...)`. Do not change `sessions`, `pageSessions()`, or `UCVM_PAGE_DATA.sessions()`.

- [ ] **Step 4: Make closure overlay explicit and independent of teaching filters**

At the top of each `filteredSessions()` row predicate, before Year/Course/Type/My Timetable/Search checks:

```js
if(s.isUniversityClosure)return showUniversityClosures;
if(String(s.type||'').toUpperCase()==='CCC'&&!showCcc)return false;
```

Because `universityClosureRows(start,end)` only injects closures inside the visible/export range, this early return does not leak out-of-period closure dates; it only prevents teaching-specific filters from hiding an explicitly enabled institutional overlay.

Add the control binding:

```js
$('show-university-closures').addEventListener('change',e=>{
  showUniversityClosures=e.target.checked;
  render();
});
```

Add reset behavior:

```js
showUniversityClosures=false;
$('show-university-closures').checked=false;
```

Do not add `University Closed` to `courseCodes()` and do not add `CLOSURE` to the Type dropdown.

- [ ] **Step 5: Add dedicated closure display text and style**

Extend `sessionTypeClass()`:

```js
if(normalized==='closure')return'tg-type-closure';
```

Use dedicated rendering copy for closure rows in Day/Week:

```js
const closure=s.isUniversityClosure;
const line1=closure?'University Closed':`${s.course} - ${s.type}`;
const line2=closure?s.topic:s.topic;
const line3=closure?'07:30-17:00 · Institutional closure':`${s.start}-${s.end}${s.room?` | ${s.room}`:''}\n${s.instructor||('T'+'BD')}`;
```

For Month view, render closure rows as:

```html
<div class="cal-event-l1">University Closed</div>
<div class="cal-event-l2">Family Day</div>
```

For List view, emit closure columns as:

```text
Date | 07:30-17:00 | University Closed | Closure | <closure name> | <blank> | <blank>
```

Add a visually distinct theme treatment in `timetable.css`:

```css
.tg-type-closure,.cal-event.tg-type-closure{background:#fff7d6;border-left-color:#8a6500}
html.dark .tg-type-closure,html.dark .cal-event.tg-type-closure{background:#3c3115;border-left-color:#f2c94c}
```

Keep the existing `.colors-off` override behavior.

- [ ] **Step 6: Centralize read-only synthetic protection**

In `timetable-selection.js`, add:

```js
const isReadOnlySynthetic=row=>Boolean(row?.isCcc||row?.isUniversityClosure);
```

Make `editPolicy()` fail closed before role-specific permissions:

```js
function editPolicy(role,row={}){
  role=text(role).toLowerCase();
  const fields=Object.fromEntries(EDIT_FIELDS.map(field=>[field,false]));
  if(isReadOnlySynthetic(row))return{canSelect:false,fields};
  // existing ADFA / ADC / LAB policy follows
}
```

Update `selectedRows()`:

```js
function selectedRows(source,ids){
  const byId=new Map((source||[]).filter(row=>!isReadOnlySynthetic(row)).map(row=>[text(row.id),row]));
  return(ids||[]).map(id=>byId.get(text(id))).filter(Boolean);
}
```

In `timetable.js`, add the UI-side guard:

```js
function isReadOnlySynthetic(session){
  return Boolean(session?.isCcc||session?.isUniversityClosure);
}
```

Use it for:

- selection candidate styling;
- click-to-select;
- Edit Session button;
- SWAP Faculty button.

For the click guard:

```js
if(isReadOnlySynthetic(s)){
  toast(
    s?.isUniversityClosure
      ? 'University closure records are read-only institutional calendar entries.'
      : 'CCC records are read-only and cannot be selected.',
    true
  );
  return;
}
```

- [ ] **Step 7: Add a closure-specific detail modal path**

At the start of `openSessionDetail(id)`, after resolving `s`, handle closures before normal teaching details:

```js
if(s.isUniversityClosure){
  showModal(`
    <div class="modal-header">
      <div class="modal-title">University Closed - ${escapeHtml(s.topic)}</div>
      <div class="modal-subtitle">${formatLongDate(parseYmd(s.date))}</div>
    </div>
    <div class="modal-body">
      <div class="login-cheatsheet">
        <strong>University Closure — read-only institutional calendar record</strong><br><br>
        ${escapeHtml(s.topic)}<br>
        07:30-17:00 timetable display block<br>
        <strong>Source:</strong> UCalgary University Closure Calendar
      </div>
    </div>
    <div class="modal-footer">
      <span></span>
      <button class="btn btn-secondary" id="detail-close">Close</button>
    </div>`);
  $('detail-close').onclick=closeModal;
  return;
}
```

No Edit or Swap controls are rendered for this branch.

- [ ] **Step 8: Run the timetable-focused suite**

Run:

```bash
node --test tests/timetable-university-closures.test.js tests/timetable-selection.test.js tests/timetable-multi-edit-ui.test.js tests/timetable-views-export.test.js
```

Expected: all pass.

- [ ] **Step 9: Commit Task 3**

```bash
git add index.html timetable.js timetable.css timetable-selection.js tests/timetable-university-closures.test.js tests/timetable-selection.test.js tests/timetable-multi-edit-ui.test.js tests/timetable-views-export.test.js
git commit -m "feat: show read-only university closures in timetable"
```

---

### Task 4: CSV / ICS export and Outlook invitation safety

**Files:**
- Modify: `timetable.js`
- Modify: `tests/timetable-university-closures.test.js`
- Modify: `tests/timetable-views-export.test.js`
- Modify: `tests/timetable-bulk-outlook.test.js`

**Interfaces:**
- Consumes: `sessionsWithOverlays()`, `isUniversityClosure`.
- Produces: CSV `University Closure` flag, all-day closure ICS entries, and hard exclusion from Outlook teaching invitations.

- [ ] **Step 1: Add failing export safety tests**

Add to `tests/timetable-university-closures.test.js`:

```js
test('standard exports include enabled closures and label them explicitly',()=>{
  const js=read('timetable.js');
  assert.match(js,/University Closure/);
  assert.match(js,/s\.isUniversityClosure/);
  assert.match(js,/DTSTART;VALUE=DATE/);
  assert.match(js,/University Closed/);
});

test('Outlook teaching invitations defensively exclude University closures',()=>{
  const js=read('timetable.js');
  const start=js.indexOf('function exportOutlookInvites');
  const end=js.indexOf('\n  async function openOutlookInviteDialog',start);
  const fn=js.slice(start,end);
  assert.match(fn,/!.*isUniversityClosure|filter\([^)]*isUniversityClosure/);
});
```

Strengthen `tests/timetable-bulk-outlook.test.js`:

```js
assert.match(timetable,/isUniversityClosure/);
assert.match(timetable,/exportOutlookInvites[\s\S]*filter[\s\S]*isUniversityClosure/);
```

Strengthen `tests/timetable-views-export.test.js`:

```js
assert.match(html,/University Closure/);
assert.match(html,/sessionsWithOverlays/);
```

- [ ] **Step 2: Run export tests and verify they fail before implementation**

Run:

```bash
node --test tests/timetable-university-closures.test.js tests/timetable-views-export.test.js tests/timetable-bulk-outlook.test.js
```

Expected: failures for the CSV column and Outlook exclusion assertions.

- [ ] **Step 3: Include closures in standard export projection only when the toggle is on**

In `exportFilteredRows()`, include enabled closure catalog dates when calculating the projection span:

```js
const closureDates=showUniversityClosures
  ? closureCalendar.entries.map(row=>row.date)
  : [];
const allDates=[
  ...all.map(s=>s.date),
  ...cccEvents.flatMap(e=>[e.startDate,e.endDate]),
  ...closureDates
].filter(Boolean).sort();

const source=sessionsWithOverlays(
  all,
  allDates[0]||'2026-01-01',
  allDates[allDates.length-1]||'2027-12-31'
);
```

The existing date/academic/all scope filter then trims the projected closures to the requested export range.

- [ ] **Step 4: Make CSV and standard ICS closure-aware**

Extend the CSV header:

```js
const header=[
  'ID','Source','Date','Week','Semester','Year','Course','Course Name',
  'Type','Topic','Instructor','Assignments JSON','Room','Start','End',
  'Time Unknown','CCC','University Closure'
];
```

Append:

```js
!!s.isUniversityClosure
```

to every exported row.

For standard ICS, use closure-specific summary/description helpers:

```js
function calendarSummary(s){
  return s.isUniversityClosure
    ? `University Closed - ${s.topic}`
    : `${s.course} ${s.type}${s.topic?` - ${s.topic}`:''}`;
}
function calendarDescription(s){
  return s.isUniversityClosure
    ? 'University Closure — read-only institutional calendar record'
    : `Faculty: ${s.instructor||('T'+'BD')}${s.room?`\nRoom: ${s.room}`:''}`;
}
```

Treat closure rows as all-day for standard ICS:

```js
if(s.isUniversityClosure||s.isCcc||s.timeUnknown||!s.start||!s.end){
  const next=ymd(addDays(parseYmd(s.date),1));
  // existing VALUE=DATE event construction
}
```

The 07:30-17:00 values remain display-only.

- [ ] **Step 5: Exclude closures from Outlook invitation preparation twice**

At the beginning of `exportOutlookInvites(data,organizer)`, filter defensively:

```js
const teachingData=(data||[]).filter(session=>!session?.isUniversityClosure);
const events=teachingData.map(session=>{
  // existing invitation event builder
});
```

Also filter the rows prepared inside `openOutlookInviteDialog()` before review/count/export:

```js
const rows=()=>exportFilteredRows(all,options()).filter(row=>!row.isUniversityClosure);
```

Do not change existing CCC invitation behavior in this task.

- [ ] **Step 6: Run export tests**

Run:

```bash
node --test tests/timetable-university-closures.test.js tests/timetable-views-export.test.js tests/timetable-bulk-outlook.test.js
```

Expected: all pass.

- [ ] **Step 7: Commit Task 4**

```bash
git add timetable.js tests/timetable-university-closures.test.js tests/timetable-views-export.test.js tests/timetable-bulk-outlook.test.js
git commit -m "feat: export university closures safely"
```

---

### Task 5: Full regression verification, static build, and PR gate

**Files:**
- Verify all changed files from Tasks 1-4.
- Do not modify `firestore.rules` or deployment workflow files unless a failing test demonstrates an unrelated pre-existing problem; if that occurs, stop and report instead of broadening this PR.

**Interfaces:**
- Consumes: complete implementation.
- Produces: one reviewable feature PR and one GitHub Pages acceptance artifact.

- [ ] **Step 1: Run the complete static/unit suite**

Run:

```bash
npm test
```

Expected: exit code 0 and zero failing tests.

- [ ] **Step 2: Run Firestore/Auth emulator verification**

Run:

```bash
npm run test:emulator
```

Expected: exit code 0. No Firestore rule changes are required for this feature.

- [ ] **Step 3: Build the exact static artifact**

Run:

```bash
rm -rf .deploy-static
node tools/build-static.js
test -f .deploy-static/university-closures.js
test -f .deploy-static/index.html
test -f .deploy-static/timetable.js
```

Expected: all checks succeed.

- [ ] **Step 4: Inspect the final diff for scope boundaries**

Run:

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Expected implementation file set is limited to:

```text
university-closures.js
afc-workflow.js
test-support/afc-policy.js
index.html
timetable.js
timetable.css
timetable-selection.js
tools/static-assets.json
tests/university-closures.test.js
tests/afc-policy.test.js
tests/afc-timetable-integration.test.js
tests/timetable-university-closures.test.js
tests/timetable-selection.test.js
tests/timetable-multi-edit-ui.test.js
tests/timetable-views-export.test.js
tests/timetable-bulk-outlook.test.js
```

If `firestore.rules`, GitHub workflow files, approval modules, privacy modules, or 200-row implementation files appear, stop and remove/review the unrelated changes before opening the PR.

- [ ] **Step 5: Push the feature branch and create the PR**

Use a feature branch named:

```text
feat/university-closure-timetable
```

PR title:

```text
University closures: shared AFC calendar and timetable overlay
```

PR body must state:

```text
- Replaces AFC's duplicated closure dates with one shared university-closures.js catalog.
- Adds opt-in Show University Closures timetable overlay.
- Displays closures as read-only 07:30-17:00 blocks with named institutional closure days.
- Keeps closure overlays out of DOE, conflicts, Firestore session writes, derived indexes, and Outlook teaching invitations.
- Includes closures in CSV/standard ICS only when the overlay toggle is enabled.
- No Firestore Rules or deployment workflow changes.
```

- [ ] **Step 6: Wait for exact-head GitHub validation**

Require both checks on the PR head SHA:

```text
Test                         success
GitHub Pages Test Site       success
```

Do not use an older green run from a prior commit.

- [ ] **Step 7: Perform the manual GitHub Pages acceptance checklist**

On the fixed GitHub Pages test site:

1. Confirm **Show University Closures** appears directly beside **Show CCC** and defaults off.
2. Turn it on and verify no Firestore load is required for the closure layer.
3. Check **2027-02-15 — Family Day**.
4. Check **2027-03-26 — Good Friday**.
5. Check **2027-09-30 — National Day for Truth and Reconciliation**.
6. Check at least one **2027-12-27 through 2027-12-31** closure.
7. In Day and Week views, verify each closure occupies exactly **07:30-17:00**.
8. In Month view, verify **University Closed** plus the closure name appears.
9. In List view, verify Faculty and Room are blank.
10. Enable restrictive Course, Type, Search, Year, and My Timetable filters; the enabled closure overlay must remain visible.
11. Enter Select Sessions; closure rows must not be selectable.
12. Click a closure; only the read-only institutional detail appears, with no Edit or SWAP controls.
13. Open AFC for a date range spanning a closure and confirm working-day calculation still excludes the closure.
14. Export CSV with the closure toggle on; verify the `University Closure` column is true on closure rows.
15. Export standard ICS with the closure toggle on; verify the closure is an all-day calendar event.
16. Prepare an Outlook teaching invitation package; verify no University closure event appears.

Because the GitHub Pages test site uses the live Firebase backend, use only known disposable/test teaching records for any AFC or timetable interaction that could persist data. Closure rows themselves are static and never write data.

- [ ] **Step 8: Stop at the merge approval gate**

After automated and manual acceptance are green, report the PR number, exact head SHA, Test run number, and GitHub Pages Test Site run number.

Do **not** merge until the user explicitly approves this feature PR.

Do **not** deploy Azure Production as part of this task. Production approval remains a separate gate.
