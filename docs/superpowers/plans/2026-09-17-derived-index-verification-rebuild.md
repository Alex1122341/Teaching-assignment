# Derived Index Verification & Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a canonical, read-only verifier for all four derived Firestore index documents, add a safe atomic full rebuild with post-verification, surface it in Faculty Dashboard, and make Workstream 3 use the full health gate.

**Architecture:** `index-maintenance.js` remains the single derived-index domain module. It will gain pure swap-identity analysis, deterministic document normalization/diffing, one Firestore `WriteBatch` for four-document rebuilds, and a DB-aware verifier/rebuilder. A focused `derived-index-health.js` module will own the Faculty Database health card. Bulk import keeps its existing state machine but injects the full verifier/rebuilder and checks critical index health during preflight.

**Tech Stack:** Vanilla JavaScript, Firebase Firestore compat client, Node.js `node:test`, Firebase/Auth emulators, GitHub Pages, Azure Static Web Apps.

**Spec:** `docs/superpowers/specs/2026-09-16-derived-index-verification-rebuild-design.md`

## Global Constraints

- The four managed documents remain `settings/faculty_index`, `settings/schedule_stats`, `settings/faculty_swap_index`, and `settings/faculty_swap_map`.
- Verify is read-only and never allocates opaque swap keys.
- Existing valid opaque swap keys are preserved exactly.
- A genuinely new active faculty member may receive a new opaque key only during a rebuild.
- Ambiguous old swap-key ownership is `CRITICAL`; automatic rebuild is blocked and there is no Force Repair.
- Full rebuild writes all four derived documents in one Firestore `WriteBatch`, then runs a fresh full verification.
- A successful batch commit alone is never reported as repair success.
- All Admin roles may Verify; only Owner / ADFA General sees Manual Rebuild.
- Ordinary Admin timetable edits keep their existing automatic incremental index maintenance. Do not change all derived-index rules to `general()`-only.
- Manual Rebuild is an application/UI workflow boundary in the current Spark client architecture, not a trusted-server security boundary.
- Existing Workstream 3 maintenance lock takes precedence; `[data-derived-index-rebuild]` remains blocked while teaching-data maintenance is active.
- Workstream 3 preflight allows ordinary derived-index mismatch with a warning, but blocks `CRITICAL` swap identity corruption before source writes.
- Workstream 3 final import and restore verification use the full verifier.
- Verification details are capped at 50 displayed diff rows while `mismatchCount` retains the full count.
- Generation metadata `generatedAt`, `generatedBy`, and `generatedByName` is non-semantic for comparison.
- Deliberate corruption tests run only against Firebase Emulator, never the GitHub Pages live Firebase project.
- No Cloud Functions, new backend service, hash/version subsystem, scheduling changes, audit redesign, or role-vocabulary migration is part of this workstream.
- No Firestore rules change is expected for this workstream. If implementation reveals a necessary rules change, stop and review it separately before editing `firestore.rules`.

---

## File Structure

### Domain and Firestore behavior

- Modify `index-maintenance.js`
  - Pure canonical build and swap-identity analysis.
  - Structured detailed diffing.
  - `verifyDerivedIndexes()`.
  - Atomic `writeDerivedIndexes()`.
  - Fresh-data `rebuildDerivedIndexes()`.
  - Compatibility wrapper for `verifyDerivedIndexesProvisional()` while callers migrate.

### Faculty Dashboard UI

- Create `derived-index-health.js`
  - Pure report/view helpers.
  - Verify/Rebuild runtime.
  - Admin/General permission rendering.
  - Maintenance-lock-aware Manual Rebuild.
- Modify `faculty-admin.html`
  - Static Derived Index Health card inside Faculty Database.
  - Load `derived-index-health.js` after shared maintenance/index modules.
- Modify `faculty-admin.css`
  - Health card, four-document status grid, mismatch details, critical state.
- Modify `tools/static-assets.json`
  - Add `derived-index-health.js` to deployable runtime assets.

### Workstream 3 integration

- Modify `bulk-import-controller.js`
  - Run injected full index verification during preflight.
  - Critical = blocking error; ordinary mismatch = warning.
  - Format structured verifier failures at final import/restore gates.
- Modify `bulk-import-ui.js`
  - Inject `verifyDerivedIndexes()` and atomic `writeDerivedIndexes()`; stop using the provisional verifier.

### Tests

- Modify `tests/index-maintenance.test.js`
  - Pure verifier, identity classification, diff cap, atomic batch behavior.
- Create `tests/index-maintenance-emulator.test.js`
  - Deliberate Firestore corruption, safe repair, critical blocking.
- Create `tests/derived-index-health.test.js`
  - UI view model, permissions, button semantics, source contract.
- Modify `tests/bulk-import-controller.test.js`
  - Preflight mismatch/critical behavior and structured final failures.
- Modify `tests/bulk-import-ui.test.js`
  - Full verifier/rebuilder injection contract.
- Modify `tests/maintenance-state.test.js`
  - Preserve explicit Manual Rebuild maintenance blocking contract.
- Modify `tests/runtime-assets.test.js`
  - Runtime manifest grows from 41 to 42 files and includes the new module.

---

### Task 1: Canonical Four-Document Verification Core

**Files:**
- Modify: `index-maintenance.js` — replace provisional comparison internals with pure canonical analysis helpers while preserving existing incremental APIs.
- Modify: `tests/index-maintenance.test.js` — replace provisional-only verifier assertions and add structured report coverage.

**Interfaces:**
- Consumes: `UCVM_DATA_INDEX.buildFacultyIndex(faculty, sessions)`, `scheduleStats(sessions)`, and `buildFacultySwapIndexes(faculty, previousMap, keyFactory)` from `data-index.js`.
- Produces:
  - `analyzeSwapIdentity({faculty, publicIndex, privateMap, publicExists, privateExists}) -> {criticalIssues, missingFacultyIds, staleFacultyIds, knownPrivateMap}`
  - `buildExpectedDerivedIndexes({faculty, sessions, privateMap, keyFactory, allocateMissingKeys}) -> {documents, swapAnalysis}`
  - `compareDerivedIndexDocuments({expected, actual, swapAnalysis, maxDetails}) -> report`
  - `verifyDerivedIndexes(db, {faculty, sessions, maxDetails}={}) -> Promise<report>`
  - Report shape: `{ok, severity, checkedAt, counts, documents, mismatchCount, mismatches}` where `severity` is `healthy`, `mismatch`, or `critical`.

- [ ] **Step 1: Replace the first provisional tests with failing structured-verifier tests**

Add fixtures that describe the actual four documents and assert exact report semantics. Keep existing session delta tests unchanged.

```js
function fullVerifierFixture(){
 const api=require(path.join(root,'index-maintenance.js'));
 const faculty=[
  {__id:'1001',preferredFullName:'Alex',active:true,doe:{teaching:20}},
  {__id:'1002',preferredFullName:'Blair',active:true,doe:{teaching:20}}
 ];
 const sessions=[{id:'s1',course:'200',assignments:[{ucid:'1001',doeCredit:2}]}];
 const privateMap={schemaVersion:'ucvm-faculty-swap-map-v1',entries:[
  {key:'key-a',facultyId:'1001'},
  {key:'key-b',facultyId:'1002'}
 ]};
 const swap=require(path.join(root,'data-index.js')).buildFacultySwapIndexes(
  faculty,
  privateMap,
  ()=>{throw Error('verification must not allocate keys')}
 );
 const base=api.derivedDocuments(faculty,sessions);
 return {api,faculty,sessions,docs:{
  faculty_index:{...base.facultyIndex,generatedAt:'old',generatedBy:'u',generatedByName:'N'},
  schedule_stats:{...base.scheduleStats,generatedAt:'old'},
  faculty_swap_index:{...swap.publicIndex,generatedAt:'old'},
  faculty_swap_map:{...swap.privateMap,generatedAt:'old',generatedBy:'u',generatedByName:'N'}
 }};
}

test('full verifier returns healthy and ignores generation metadata',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions});
 assert.equal(result.ok,true);
 assert.equal(result.severity,'healthy');
 assert.equal(result.mismatchCount,0);
 assert.deepEqual(result.documents,{
  faculty_index:'healthy',schedule_stats:'healthy',faculty_swap_index:'healthy',faculty_swap_map:'healthy'
 });
});

test('full verifier reports an exact schedule_stats path and values',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 docs.schedule_stats.courseCounts['200']=9;
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions});
 assert.equal(result.severity,'mismatch');
 assert.equal(result.ok,false);
 assert.ok(result.mismatches.some(row=>
  row.document==='schedule_stats' &&
  row.path==='courseCounts.200' &&
  row.expected===1 &&
  row.actual===9
 ));
});
```

- [ ] **Step 2: Run the focused test to prove RED**

Run:

```bash
node --test tests/index-maintenance.test.js
```

Expected: FAIL because `verifyDerivedIndexes()` and the structured report do not exist yet.

- [ ] **Step 3: Add canonical metadata stripping, stable document normalization, and bounded recursive diffing**

Implement document-aware comparison helpers inside `index-maintenance.js`.

```js
const DERIVED_IDS=Object.freeze(['faculty_index','schedule_stats','faculty_swap_index','faculty_swap_map']);
const GENERATION_META=new Set(['generatedAt','generatedBy','generatedByName']);

function stripGenerationMeta(value){
 if(Array.isArray(value))return value.map(stripGenerationMeta);
 if(value&&typeof value==='object'){
  const out={};
  for(const [key,item] of Object.entries(value)){
   if(GENERATION_META.has(key))continue;
   out[key]=stripGenerationMeta(item);
  }
  return out;
 }
 return value;
}

function comparableDocument(id,value){
 const doc=stripGenerationMeta(value||{});
 if(id==='faculty_index'&&Array.isArray(doc.entries)){
  doc.entries=Object.fromEntries(doc.entries.map(row=>[String(row.id||''),row]).sort(([a],[b])=>a.localeCompare(b)));
 }
 if(id==='faculty_swap_index'&&Array.isArray(doc.entries)){
  doc.entries=Object.fromEntries(doc.entries.map(row=>[String(row.key||''),row]).sort(([a],[b])=>a.localeCompare(b)));
 }
 if(id==='faculty_swap_map'&&Array.isArray(doc.entries)){
  doc.entries=Object.fromEntries(doc.entries.map(row=>[String(row.facultyId||''),row]).sort(([a],[b])=>a.localeCompare(b)));
 }
 return canonical(doc);
}
```

Use a recursive walker that increments the full count for every leaf/object presence difference while pushing only the first `maxDetails` rows.

```js
function diffValues(document,expected,actual,maxDetails=50){
 const mismatches=[];
 let count=0;
 const add=(path,expectedValue,actualValue,issue='value-mismatch',severity='mismatch')=>{
  count++;
  if(mismatches.length<maxDetails)mismatches.push({document,path,expected:expectedValue,actual:actualValue,issue,severity});
 };
 const walk=(left,right,path='')=>{
  if(sameCanonical(left,right))return;
  const leftObject=left&&typeof left==='object'&&!Array.isArray(left);
  const rightObject=right&&typeof right==='object'&&!Array.isArray(right);
  if(leftObject&&rightObject){
   const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].sort();
   for(const key of keys)walk(left[key],right[key],path?`${path}.${key}`:key);
   return;
  }
  add(path,left,right);
 };
 walk(expected,actual);
 return{count,mismatches};
}
```

- [ ] **Step 4: Add pure swap-identity analysis before calling the existing swap builder**

The analyzer must detect ambiguity that `new Map()` would otherwise silently collapse.

```js
function analyzeSwapIdentity({faculty,publicIndex,privateMap,publicExists=true,privateExists=true}){
 const activeIds=new Set((faculty||[])
  .filter(row=>row&&row.active!==false)
  .map(row=>String(row.__id||row.id||row.ucid||'').trim())
  .filter(Boolean));
 const privateRows=Array.isArray(privateMap?.entries)?privateMap.entries:[];
 const publicRows=Array.isArray(publicIndex?.entries)?publicIndex.entries:[];
 const keyOwners=new Map(),facultyKeys=new Map(),criticalIssues=[];
 for(const row of privateRows){
  const facultyId=String(row?.facultyId||'').trim(),key=String(row?.key||'').trim();
  if(!facultyId||!key){
   criticalIssues.push({document:'faculty_swap_map',path:'entries',issue:'invalid-private-identity',expected:'non-empty facultyId and key',actual:{facultyId,key},severity:'critical'});
   continue;
  }
  const owners=keyOwners.get(key)||new Set();owners.add(facultyId);keyOwners.set(key,owners);
  const keys=facultyKeys.get(facultyId)||new Set();keys.add(key);facultyKeys.set(facultyId,keys);
 }
 for(const [key,owners] of keyOwners)if(owners.size>1)criticalIssues.push({document:'faculty_swap_map',path:`key.${key}`,issue:'duplicate-key-ownership',expected:'one faculty owner',actual:[...owners],severity:'critical'});
 for(const [facultyId,keys] of facultyKeys)if(keys.size>1)criticalIssues.push({document:'faculty_swap_map',path:`faculty.${facultyId}`,issue:'conflicting-faculty-keys',expected:'one opaque key',actual:[...keys],severity:'critical'});
 const privateKeys=new Set([...keyOwners.keys()]);
 if(!privateExists&&publicRows.some(row=>String(row?.key||'').trim()))criticalIssues.push({document:'faculty_swap_map',path:'document',issue:'missing-private-map-with-public-keys',expected:'private ownership map',actual:'missing',severity:'critical'});
 for(const row of publicRows){
  const key=String(row?.key||'').trim();
  if(key&&!privateKeys.has(key))criticalIssues.push({document:'faculty_swap_index',path:`entries.${key}`,issue:'public-key-without-private-owner',expected:'matching private ownership',actual:key,severity:'critical'});
 }
 const missingFacultyIds=[...activeIds].filter(id=>!facultyKeys.has(id)).sort();
 const staleFacultyIds=[...facultyKeys.keys()].filter(id=>!activeIds.has(id)).sort();
 const knownEntries=privateRows.filter(row=>activeIds.has(String(row?.facultyId||'').trim())&&String(row?.key||'').trim());
 return{criticalIssues,missingFacultyIds,staleFacultyIds,knownPrivateMap:{schemaVersion:'ucvm-faculty-swap-map-v1',entries:knownEntries}};
}
```

- [ ] **Step 5: Add the canonical expected builder without key allocation during Verify**

`allocateMissingKeys:false` must never call a random-key factory for missing faculty. It builds swap expectations only for identities already proven by the private map and returns `missingFacultyIds` for the verifier to report as repairable mismatches.

```js
function buildExpectedDerivedIndexes({faculty,sessions,privateMap,keyFactory,allocateMissingKeys=false}){
 const base=derivedDocuments(faculty,sessions);
 const active=Array.isArray(faculty)?faculty.filter(row=>row&&row.active!==false):[];
 const analysis=analyzeSwapIdentity({faculty:active,publicIndex:{entries:[]},privateMap,publicExists:true,privateExists:true});
 const known=new Set((analysis.knownPrivateMap.entries||[]).map(row=>String(row.facultyId)));
 const rows=allocateMissingKeys?active:active.filter(row=>known.has(String(row.__id||row.id||row.ucid||'')));
 const factory=allocateMissingKeys?keyFactory:()=>{throw Error('Verify cannot allocate opaque swap keys.');};
 const swap=index.buildFacultySwapIndexes(rows,analysis.knownPrivateMap,factory);
 return{documents:{
  faculty_index:base.facultyIndex,
  schedule_stats:base.scheduleStats,
  faculty_swap_index:swap.publicIndex,
  faculty_swap_map:swap.privateMap
 },swapAnalysis:analysis};
}
```

The actual implementation must pass the real public document into the final identity analysis before classifying report severity; the snippet above only demonstrates the builder boundary.

- [ ] **Step 6: Implement `compareDerivedIndexDocuments()` and `verifyDerivedIndexes()`**

Read four settings docs, treat missing/malformed documents as explicit report rows, merge swap critical issues into the same report, and add repairable rows for new active faculty with no private mapping.

```js
async function verifyDerivedIndexes(db,{faculty,sessions,maxDetails=50}={}){
 const sourceFaculty=faculty||await loadCollectionRows(db,'faculty');
 const sourceSessions=sessions||await loadCollectionRows(db,'sessions');
 const actual=await loadDerivedDocuments(db);
 const privateMap=actual.faculty_swap_map.exists?actual.faculty_swap_map.data:{entries:[]};
 const publicIndex=actual.faculty_swap_index.exists?actual.faculty_swap_index.data:{entries:[]};
 const expected=buildExpectedDerivedIndexes({faculty:sourceFaculty,sessions:sourceSessions,privateMap,allocateMissingKeys:false});
 const swapAnalysis=analyzeSwapIdentity({
  faculty:sourceFaculty,
  publicIndex,
  privateMap,
  publicExists:actual.faculty_swap_index.exists,
  privateExists:actual.faculty_swap_map.exists
 });
 return compareDerivedIndexDocuments({
  expected:expected.documents,
  actual,
  swapAnalysis,
  counts:{faculty:sourceFaculty.length,sessions:sourceSessions.length},
  maxDetails
 });
}
```

Return `checkedAt` as an ISO timestamp created after reads complete. `documents[id]` is `healthy`, `mismatch`, or `critical`; overall severity is the highest document severity.

- [ ] **Step 7: Add tests for missing/invalid docs, new faculty, critical ambiguity, and the 50-detail cap**

```js
test('new active faculty without a private key is repairable and verify allocates nothing',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 faculty.push({__id:'1003',preferredFullName:'Casey',active:true});
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions});
 assert.equal(result.severity,'mismatch');
 assert.ok(result.mismatches.some(row=>row.issue==='missing-new-faculty-key'&&row.path.includes('1003')));
});

test('duplicate private key ownership is critical',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 docs.faculty_swap_map.entries[1].key='key-a';
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions});
 assert.equal(result.severity,'critical');
 assert.ok(result.mismatches.some(row=>row.issue==='duplicate-key-ownership'&&row.severity==='critical'));
});

test('verifier counts every mismatch but returns only the first 50 details',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 docs.schedule_stats.courseCounts={};
 docs.faculty_index.entries=Array.from({length:80},(_,i)=>({id:String(i),name:`Wrong ${i}`}));
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions,maxDetails:50});
 assert.ok(result.mismatchCount>50);
 assert.equal(result.mismatches.length,50);
});
```

Also cover:

```js
assert.equal(result.documents.faculty_swap_map,'critical');
assert.equal(missingDocMismatch.issue,'document-missing');
assert.equal(invalidEntriesMismatch.issue,'invalid-structure');
```

- [ ] **Step 8: Run the focused verifier suite to prove GREEN**

Run:

```bash
node --test tests/index-maintenance.test.js
```

Expected: PASS with all existing session-delta tests and all new verifier tests green.

- [ ] **Step 9: Commit Task 1**

```bash
git add index-maintenance.js tests/index-maintenance.test.js
git commit -m "feat: add canonical derived index verification"
```

---

### Task 2: Atomic Full Rebuild and Emulator Corruption Proof

**Files:**
- Modify: `index-maintenance.js` — atomic batch writer and fresh-data manual rebuild.
- Modify: `tests/index-maintenance.test.js` — batch contract and key preservation tests.
- Create: `tests/index-maintenance-emulator.test.js` — real Firestore emulator corruption/repair tests.

**Interfaces:**
- Consumes from Task 1: `analyzeSwapIdentity()`, `buildExpectedDerivedIndexes()`, `verifyDerivedIndexes()`.
- Produces:
  - `writeDerivedIndexes(db, faculty, sessions, actor={}) -> Promise<{facultyIndex,scheduleStats,publicIndex,privateMap}>`
  - `rebuildDerivedIndexes(db, actor={}) -> Promise<report>`
  - Existing `updateDerivedIndexes(db, changes, actor)` remains unchanged for normal incremental session maintenance.

- [ ] **Step 1: Add a failing unit test proving full writes use exactly one batch**

Extend the fake DB with refs and a batch recorder.

```js
function fakeBatchDb(initial){
 const docs=new Map(Object.entries(initial||{}));
 const commits=[];
 const refs=new Map();
 const ref=id=>{
  if(!refs.has(id))refs.set(id,{id,get:async()=>docs.has(id)?{exists:true,data:()=>docs.get(id)}:{exists:false}});
  return refs.get(id);
 };
 return{
  commits,
  collection(name){
   if(name==='settings')return{doc:id=>ref(id)};
   throw Error(`unexpected collection ${name}`);
  },
  batch(){
   const writes=[];
   return{
    set(reference,data){writes.push({id:reference.id,data})},
    async commit(){for(const write of writes)docs.set(write.id,write.data);commits.push(writes)}
   };
  }
 };
}

test('writeDerivedIndexes commits all four documents in one batch',async()=>{
 const db=fakeBatchDb({faculty_swap_map:{schemaVersion:'ucvm-faculty-swap-map-v1',entries:[{key:'stable',facultyId:'1001'}]},faculty_swap_index:{schemaVersion:'ucvm-faculty-swap-index-v1',entries:[{key:'stable',name:'Alex',aliases:['Alex'],unavailableRanges:[]}]}});
 const faculty=[{__id:'1001',preferredFullName:'Alex',active:true}],sessions=[];
 await api.writeDerivedIndexes(db,faculty,sessions,{uid:'g',name:'General'});
 assert.equal(db.commits.length,1);
 assert.deepEqual(db.commits[0].map(row=>row.id).sort(),['faculty_index','faculty_swap_index','faculty_swap_map','schedule_stats']);
});
```

- [ ] **Step 2: Run the focused test to prove RED**

Run:

```bash
node --test tests/index-maintenance.test.js
```

Expected: FAIL because current `writeDerivedIndexes()` uses four independent writes and the fake DB has no direct `.set()` path.

- [ ] **Step 3: Replace four independent writes with one Firestore `WriteBatch`**

Read both current swap documents first, analyze them, block on critical identity ambiguity, allocate missing keys only here, and commit four writes atomically.

```js
async function writeDerivedIndexes(db,faculty,sessions,actor={}){
 const [publicSnap,privateSnap]=await Promise.all([
  db.collection('settings').doc('faculty_swap_index').get(),
  db.collection('settings').doc('faculty_swap_map').get()
 ]);
 const publicIndex=publicSnap.exists?publicSnap.data():{schemaVersion:'ucvm-faculty-swap-index-v1',entries:[]};
 const privateMap=privateSnap.exists?privateSnap.data():{schemaVersion:'ucvm-faculty-swap-map-v1',entries:[]};
 const identity=analyzeSwapIdentity({faculty,publicIndex,privateMap,publicExists:publicSnap.exists,privateExists:privateSnap.exists});
 if(identity.criticalIssues.length){
  const error=Error('Critical swap identity corruption blocks derived-index rebuild.');
  error.code='critical-derived-index';
  error.report={ok:false,severity:'critical',mismatches:identity.criticalIssues};
  throw error;
 }
 const built=buildExpectedDerivedIndexes({
  faculty,sessions,privateMap,
  keyFactory:()=>db.collection('settings').doc().id,
  allocateMissingKeys:true
 });
 const stamp=stampValue(),meta={generatedAt:stamp,...actorMeta(actor)},batch=db.batch();
 batch.set(db.collection('settings').doc('faculty_index'),{...built.documents.faculty_index,...meta});
 batch.set(db.collection('settings').doc('schedule_stats'),{...built.documents.schedule_stats,...meta});
 batch.set(db.collection('settings').doc('faculty_swap_index'),{...built.documents.faculty_swap_index,generatedAt:stamp});
 batch.set(db.collection('settings').doc('faculty_swap_map'),{...built.documents.faculty_swap_map,...meta});
 await batch.commit();
 return{
  facultyIndex:built.documents.faculty_index,
  scheduleStats:built.documents.schedule_stats,
  publicIndex:built.documents.faculty_swap_index,
  privateMap:built.documents.faculty_swap_map
 };
}
```

Keep `writeFacultySwapIndexes()` behavior separate unless its callers need the same helper; Workstream 4 does not require unrelated refactoring.

- [ ] **Step 4: Add `rebuildDerivedIndexes()` with fresh source reads and mandatory post-verify**

```js
async function rebuildDerivedIndexes(db,actor={}){
 const [faculty,sessions]=await Promise.all([
  loadCollectionRows(db,'faculty'),
  loadCollectionRows(db,'sessions')
 ]);
 const before=await verifyDerivedIndexes(db,{faculty,sessions});
 if(before.severity==='critical'){
  const error=Error('Critical swap identity corruption blocks derived-index rebuild.');
  error.code='critical-derived-index';
  error.report=before;
  throw error;
 }
 await writeDerivedIndexes(db,faculty,sessions,actor);
 const after=await verifyDerivedIndexes(db);
 if(!after.ok){
  const error=Error('Derived indexes were written but post-rebuild verification is not healthy.');
  error.code='derived-index-post-verify-failed';
  error.report=after;
  throw error;
 }
 return after;
}
```

A source change between build and final verification is therefore reported as a failed repair, not a success.

- [ ] **Step 5: Add unit tests for stable key preservation, new key allocation, critical blocking, and post-verify failure**

```js
test('full rebuild preserves an existing opaque key exactly',async()=>{
 // seed 1001 -> stable-key, rebuild, then assert faculty_swap_map still has stable-key
});

test('full rebuild allocates a key for a genuinely new active faculty member',async()=>{
 // seed one known mapping plus a new faculty row; assert new non-empty key differs from existing key
});

test('critical identity corruption performs no batch commit',async()=>{
 // duplicate one private key across two faculty IDs; assert rejection code and db.commits.length===0
});
```

For the post-verify race test, use a fake DB that mutates a source session after `batch.commit()` and before the verifier reloads; assert `rebuildDerivedIndexes()` rejects with `derived-index-post-verify-failed`.

- [ ] **Step 6: Run the unit suite to prove GREEN before emulator work**

Run:

```bash
node --test tests/index-maintenance.test.js
```

Expected: PASS.

- [ ] **Step 7: Create a modular-to-compat Firestore test adapter in the new emulator test**

`index-maintenance.js` uses compat-style `db.collection().doc()`. The emulator suite already uses modular Firestore, so the test file supplies a tiny adapter rather than changing production code.

```js
function compatDb(modularDb){
 const firestore=require('firebase/firestore');
 const wrapRef=(collectionName,id)=>({collectionName,id,_native:firestore.doc(modularDb,collectionName,id),get:async()=>{
  const snap=await firestore.getDoc(firestore.doc(modularDb,collectionName,id));
  return{exists:snap.exists(),id:snap.id,data:()=>snap.data()};
 }});
 return{
  collection(name){
   return{
    doc(id){
     if(id===undefined){
      const native=firestore.doc(firestore.collection(modularDb,name));
      return{id:native.id,_native:native};
     }
     return wrapRef(name,id);
    },
    async get(){
     const snap=await firestore.getDocs(firestore.collection(modularDb,name));
     return{docs:snap.docs.map(row=>({id:row.id,data:()=>row.data()}))};
    }
   };
  },
  batch(){
   const native=firestore.writeBatch(modularDb);
   return{set(ref,data){native.set(ref._native,data)},commit(){return native.commit()}};
  }
 };
}
```

- [ ] **Step 8: Add emulator setup and canonical seed helpers**

Use a dedicated project ID so this test does not race `demo-ucvm-access` suites.

```js
const PROJECT_ID='demo-ucvm-derived-index';
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
let env;

before(async()=>{
 if(!enabled)return;
 const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
 env=await initializeTestEnvironment({projectId:PROJECT_ID,firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
});

after(async()=>{if(env)await env.cleanup()});
```

Seed user/profile, faculty, sessions, and all four canonical documents with security rules disabled. Use Task 1/2 production builders to produce the seed index values, then deliberately corrupt only the target document for each test.

- [ ] **Step 9: Add deliberate-corruption emulator tests**

At minimum implement these concrete scenarios:

```js
check('missing faculty_index is detected, rebuilt, and fully healthy afterward',async()=>{
 await seedCanonical();
 await env.withSecurityRulesDisabled(async context=>{
  const {deleteDoc,doc}=require('firebase/firestore');
  await deleteDoc(doc(context.firestore(),'settings/faculty_index'));
 });
 const db=compatDb(env.authenticatedContext('general').firestore());
 const before=await api.verifyDerivedIndexes(db);
 assert.equal(before.severity,'mismatch');
 const after=await api.rebuildDerivedIndexes(db,{uid:'general',name:'General'});
 assert.equal(after.ok,true);
});

check('wrong schedule count produces exact expected and actual values then rebuilds cleanly',async()=>{
 // overwrite courseCounts.301, verify path/value, rebuild, verify HEALTHY
});

check('stale public swap display data and AFC ranges are repaired without changing the private key',async()=>{
 // corrupt public name/unavailableRanges; capture private key before and after; assert equal
});

check('duplicate private opaque key ownership is critical and rebuild is blocked',async()=>{
 // force f1 and f2 to the same private key; verify critical; assert rebuild rejects
});

check('missing private map with surviving public keys is critical',async()=>{
 // delete faculty_swap_map only; verify critical
});
```

- [ ] **Step 10: Run only the new emulator test to prove it passes**

Run:

```bash
npx firebase emulators:exec --only firestore,auth --project demo-ucvm-derived-index "node --test tests/index-maintenance-emulator.test.js"
```

Expected: all deliberate-corruption tests PASS.

- [ ] **Step 11: Run Task 1 + Task 2 focused tests together**

Run:

```bash
node --test tests/index-maintenance.test.js
npx firebase emulators:exec --only firestore,auth --project demo-ucvm-derived-index "node --test tests/index-maintenance-emulator.test.js"
```

Expected: both commands PASS.

- [ ] **Step 12: Commit Task 2**

```bash
git add index-maintenance.js tests/index-maintenance.test.js tests/index-maintenance-emulator.test.js
git commit -m "feat: rebuild derived indexes atomically"
```

---

### Task 3: Faculty Database Derived Index Health UI

**Files:**
- Create: `derived-index-health.js`
- Create: `tests/derived-index-health.test.js`
- Modify: `faculty-admin.html` — static card inside `#database-view` and script load.
- Modify: `faculty-admin.css` — card/status/diff styles.
- Modify: `tests/maintenance-state.test.js` — explicit Manual Rebuild selector contract.
- Modify: `tools/static-assets.json` — add runtime module.
- Modify: `tests/runtime-assets.test.js` — manifest count 42 and module presence.

**Interfaces:**
- Consumes from Task 2: `UCVM_INDEX_MAINTENANCE.verifyDerivedIndexes(db)` and `rebuildDerivedIndexes(db, actor)`.
- Consumes shared access helpers: `UCVM.admin(profile)`, `UCVM.general(profile)`, `UCVM.label(role)`, `UCVM.init()`.
- Consumes maintenance runtime: `UCVM_MAINTENANCE.normalWritesAllowed()` plus existing `[data-derived-index-rebuild]` click blocker.
- Produces browser global / CommonJS module `UCVM_DERIVED_INDEX_HEALTH` with testable helpers `canManualRebuild`, `statusRows`, `reportSummary`, `createRuntime`, and `autoStart`.

- [ ] **Step 1: Write failing pure UI-helper tests**

Create `tests/derived-index-health.test.js`:

```js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ui=require('../derived-index-health.js');

test('manual rebuild is available only to Owner and ADFA General semantics',()=>{
 const general=profile=>['owner','adfa_general'].includes(profile.role);
 assert.equal(ui.canManualRebuild({role:'owner'},{general}),true);
 assert.equal(ui.canManualRebuild({role:'adfa_general'},{general}),true);
 assert.equal(ui.canManualRebuild({role:'adfa_regular'},{general}),false);
 assert.equal(ui.canManualRebuild({role:'administrator'},{general}),false);
});

test('report summary distinguishes healthy mismatch and critical states',()=>{
 assert.equal(ui.reportSummary({ok:true,severity:'healthy',mismatchCount:0}).label,'HEALTHY');
 assert.equal(ui.reportSummary({ok:false,severity:'mismatch',mismatchCount:3}).label,'MISMATCH');
 assert.equal(ui.reportSummary({ok:false,severity:'critical',mismatchCount:2}).label,'CRITICAL');
});

test('status rows always cover the four canonical documents',()=>{
 const rows=ui.statusRows({documents:{faculty_index:'healthy',schedule_stats:'mismatch',faculty_swap_index:'healthy',faculty_swap_map:'critical'}});
 assert.deepEqual(rows.map(row=>row.id),['faculty_index','schedule_stats','faculty_swap_index','faculty_swap_map']);
});
```

- [ ] **Step 2: Run the new UI test to prove RED**

Run:

```bash
node --test tests/derived-index-health.test.js
```

Expected: FAIL because `derived-index-health.js` does not exist.

- [ ] **Step 3: Create the module shell and pure view helpers**

Use the same UMD pattern as other focused modules so Node tests can `require()` it.

```js
(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DERIVED_INDEX_HEALTH=api;
})(typeof window!=='undefined'?window:null,function(root){
 'use strict';
 const IDS=['faculty_index','schedule_stats','faculty_swap_index','faculty_swap_map'];
 const canManualRebuild=(profile,access)=>Boolean(access?.general?.(profile));
 const statusRows=report=>IDS.map(id=>({id,status:report?.documents?.[id]||'unchecked'}));
 function reportSummary(report){
  const severity=String(report?.severity||'unchecked');
  return{severity,label:severity.toUpperCase(),count:Number(report?.mismatchCount)||0};
 }
 // createRuntime and autoStart are added in later steps.
 return{canManualRebuild,statusRows,reportSummary};
});
```

- [ ] **Step 4: Run helper tests to prove GREEN before adding DOM/runtime behavior**

Run:

```bash
node --test tests/derived-index-health.test.js
```

Expected: PASS.

- [ ] **Step 5: Add static card markup to Faculty Database**

Place it immediately after the existing Faculty Database toolbar, not as a new top-level tab.

```html
<div id="derived-index-health-card" class="derived-index-health-card">
  <div class="derived-index-health-head">
    <div>
      <div class="section-kicker">Data integrity</div>
      <h2>Derived Index Health</h2>
      <p id="derived-index-health-meta">Not checked yet.</p>
    </div>
    <div class="derived-index-health-actions">
      <button type="button" class="btn" id="derived-index-verify">Verify Derived Indexes</button>
      <button type="button" class="btn btn-primary hidden" id="derived-index-rebuild" data-derived-index-rebuild>Rebuild Derived Indexes</button>
    </div>
  </div>
  <div id="derived-index-health-status" class="derived-index-health-status" aria-live="polite"></div>
  <div id="derived-index-health-diffs"></div>
</div>
```

Load the new script after `maintenance-state.js` and `index-maintenance.js`; loading after `faculty-admin.js` is acceptable because `autoStart()` independently observes auth/profile readiness.

```html
<script src="derived-index-health.js"></script>
```

- [ ] **Step 6: Implement runtime behavior with no automatic verification on page load**

The initial card says Not checked yet. This avoids extra Firestore reads every time Faculty Dashboard opens.

```js
function createRuntime({document:doc,window:win,db,profile,actor,access,indexMaintenance,maintenance}={}){
 let report=null,busy=false;
 const $=id=>doc.getElementById(id);
 function render(){
  const general=canManualRebuild(profile,access),summary=reportSummary(report);
  $('derived-index-rebuild')?.classList.toggle('hidden',!general);
  if($('derived-index-rebuild'))$('derived-index-rebuild').disabled=busy||!report||report.severity!=='mismatch'||maintenance?.normalWritesAllowed?.()===false;
  if($('derived-index-verify'))$('derived-index-verify').disabled=busy;
  // Render four status rows, checkedAt/counts, first report.mismatches rows, and hidden-count copy.
 }
 async function verify(){
  busy=true;render();
  try{report=await indexMaintenance.verifyDerivedIndexes(db)}
  catch(error){renderOperationalError(error)}
  finally{busy=false;render()}
 }
 async function rebuild(){
  if(!canManualRebuild(profile,access))return;
  if(maintenance?.normalWritesAllowed?.()===false)return renderMaintenanceBlocked();
  if(report?.severity!=='mismatch')return;
  if(!win.confirm('Rebuild the four derived indexes from current Faculty and Session data? Source Faculty and Session records will not be changed.'))return;
  busy=true;render();
  try{report=await indexMaintenance.rebuildDerivedIndexes(db,actor)}
  catch(error){report=error.report||report;renderOperationalError(error)}
  finally{busy=false;render()}
 }
 $('derived-index-verify')?.addEventListener('click',verify);
 $('derived-index-rebuild')?.addEventListener('click',rebuild);
 render();
 return{verify,rebuild,render,currentReport:()=>report};
}
```

Render rules:

```text
healthy  -> Overall: HEALTHY
mismatch -> Overall: MISMATCH; General may rebuild
critical -> Overall: CRITICAL; rebuild disabled; show critical reason
error    -> Operational error; do not label as MISMATCH
```

If `mismatchCount > mismatches.length`, render exactly the remaining count, for example `143 additional mismatches not shown.`

- [ ] **Step 7: Add `autoStart()` for active Admin profiles only**

Follow the existing Firebase client pattern:

```js
async function autoStart(){
 if(!root?.document||!root.UCVM||typeof root.firebase==='undefined')return null;
 const page=(root.location?.pathname?.split('/').pop()||'').toLowerCase();
 if(page&&page!=='faculty-admin.html')return null;
 const {auth,db}=root.UCVM.init();
 return new Promise(resolve=>{
  const unsub=auth.onAuthStateChanged(async user=>{
   if(!user)return;
   const snap=await db.collection('users').doc(user.uid).get(),profile=snap.exists?snap.data():null;
   if(!profile||profile.active!==true||!root.UCVM.admin(profile))return;
   unsub?.();
   const actor={uid:user.uid,email:user.email||'',name:profile.name||user.displayName||user.email||'Administrator'};
   resolve(createRuntime({document:root.document,window:root,db,profile,actor,access:root.UCVM,indexMaintenance:root.UCVM_INDEX_MAINTENANCE,maintenance:root.UCVM_MAINTENANCE}));
  });
 });
}
```

- [ ] **Step 8: Add UI source-contract tests**

Extend `tests/derived-index-health.test.js` with source assertions rather than a browser dependency:

```js
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Faculty Database owns the health card and rebuild control participates in maintenance blocking',()=>{
 const html=read('faculty-admin.html');
 assert.match(html,/id="database-view"[\s\S]*id="derived-index-health-card"/);
 assert.match(html,/id="derived-index-rebuild"[^>]*data-derived-index-rebuild/);
 assert.ok(html.indexOf('derived-index-health.js')>html.indexOf('index-maintenance.js'));
});

test('runtime calls read-only verify and full rebuild separately',()=>{
 const js=read('derived-index-health.js');
 assert.match(js,/verifyDerivedIndexes\(db\)/);
 assert.match(js,/rebuildDerivedIndexes\(db,actor\)/);
 assert.match(js,/UCVM\.general|access\.general|general\(profile\)/);
});
```

- [ ] **Step 9: Preserve explicit maintenance-state coverage**

Add to `tests/maintenance-state.test.js`:

```js
test('derived index manual rebuild remains a blocked maintenance mutation',()=>{
 const api=require('../maintenance-state.js');
 assert.ok(api.BLOCKED_CLICK_SELECTORS.includes('[data-derived-index-rebuild]'));
});
```

No production change to `maintenance-state.js` is expected because the selector is already present.

- [ ] **Step 10: Add styles in `faculty-admin.css`**

Use existing dashboard tokens/classes. Keep styles scoped under `.derived-index-health-*`.

```css
.derived-index-health-card{margin:14px 0;padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.derived-index-health-head{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.derived-index-health-actions{display:flex;gap:8px;flex-wrap:wrap}
.derived-index-health-status{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:8px;margin-top:12px}
.derived-index-health-doc{padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--surface-2)}
.derived-index-health-diff{padding:8px 0;border-top:1px solid var(--border);font-size:12px}
@media(max-width:760px){.derived-index-health-status{grid-template-columns:repeat(2,minmax(0,1fr))}}
```

Use existing semantic text/indicator styles or plain status words; do not depend on color alone for HEALTHY/MISMATCH/CRITICAL.

- [ ] **Step 11: Add the new JS to the static asset manifest and update manifest tests**

Add `"derived-index-health.js"` to `tools/static-assets.json` adjacent to `data-index.js` / `index-maintenance.js`.

Update `tests/runtime-assets.test.js`:

```js
test('production manifest contains the complete 42-file dependency graph and no stale visible names',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json'));
 assert.equal(manifest.length,42);
 for(const name of ['derived-index-health.js','afc-form-values.js','faculty-doe.js','index-maintenance.js','user-management.css'])assert.ok(manifest.includes(name),name);
 // retain the existing stale-name and HTML dependency checks
});
```

- [ ] **Step 12: Run focused UI/runtime tests**

Run:

```bash
node --test tests/derived-index-health.test.js tests/maintenance-state.test.js tests/runtime-assets.test.js
```

Expected: PASS.

- [ ] **Step 13: Commit Task 3**

```bash
git add derived-index-health.js faculty-admin.html faculty-admin.css tools/static-assets.json tests/derived-index-health.test.js tests/maintenance-state.test.js tests/runtime-assets.test.js
git commit -m "feat: add derived index health controls"
```

---

### Task 4: Workstream 3 Preflight and Final-Gate Integration

**Files:**
- Modify: `bulk-import-controller.js`
- Modify: `tests/bulk-import-controller.test.js`

**Interfaces:**
- Consumes injected `verifyIndexes({faculty,sessions,mode}) -> report` where report is the Task 1 structured report.
- Consumes injected `rebuildIndexes({faculty,sessions,actor,mode})` which remains controller-agnostic.
- Produces preflight result field `indexHealth` and warning/error behavior without changing the import phase names.

- [ ] **Step 1: Extend the controller test harness so verifier results can be configured**

Replace the binary `failVerifyFinal` mock with an option that can return structured reports by mode.

```js
function healthyIndexReport(){return{ok:true,severity:'healthy',documents:{faculty_index:'healthy',schedule_stats:'healthy',faculty_swap_index:'healthy',faculty_swap_map:'healthy'},mismatchCount:0,mismatches:[]}}
function makeController(store,actor={uid:'general',name:'General'},options={}){
 let failIndexRebuild=options.failOnceAt==='index-rebuild';
 let failVerifyFinal=options.failOnceAt==='index-verify';
 return controllerModule.create({
  core:smallCore,backup,store,actor,projectId:'tester-teaching',
  prepareSession:row=>({...row,facultyIds:(row.assignments||[]).map(a=>a.ucid).filter(Boolean)}),
  rebuildIndexes:async()=>{if(failIndexRebuild){failIndexRebuild=false;throw Error('Injected failure at index-rebuild')}},
  verifyIndexes:async({mode})=>{
   if(failVerifyFinal&&mode!=='preflight'){failVerifyFinal=false;return{ok:false,severity:'mismatch',mismatchCount:1,mismatches:[{document:'schedule_stats',path:'sessionCount',expected:3,actual:99}]}}
   return options.indexReportByMode?.[mode]||healthyIndexReport();
  }
 });
}
```

- [ ] **Step 2: Add failing tests for ordinary mismatch warning and critical preflight block**

```js
test('preflight warns but allows ordinary derived-index mismatch',async()=>{
 const store=memoryStore(),controller=makeController(store,undefined,{indexReportByMode:{preflight:{ok:false,severity:'mismatch',mismatchCount:1,mismatches:[{document:'schedule_stats',path:'sessionCount',expected:3,actual:4}]}}});
 const result=await controller.preflight(sourceFile());
 assert.equal(result.errors.length,0);
 assert.match(result.warnings.join('\n'),/derived index/i);
 assert.equal(result.indexHealth.severity,'mismatch');
});

test('preflight blocks critical swap identity corruption before backup or source writes',async()=>{
 const store=memoryStore(),controller=makeController(store,undefined,{indexReportByMode:{preflight:{ok:false,severity:'critical',mismatchCount:1,mismatches:[{document:'faculty_swap_map',path:'key.dup',issue:'duplicate-key-ownership',severity:'critical'}]}}});
 const result=await controller.preflight(sourceFile());
 assert.match(result.errors.join('\n'),/critical.*swap|critical.*derived/i);
 assert.equal(store.system.teachingDataWriteLocked,false);
 assert.equal(store.job,null);
});
```

- [ ] **Step 3: Run controller tests to prove RED**

Run:

```bash
node --test tests/bulk-import-controller.test.js
```

Expected: FAIL because preflight does not call `verifyIndexes()` or expose `indexHealth`.

- [ ] **Step 4: Add preflight health verification after the existing current-data reads**

Inside `preflight(file)`, after validation and current dataset loads:

```js
const indexHealth=await verifyIndexes({faculty:currentFaculty,sessions:currentSessions,mode:'preflight'});
if(indexHealth?.severity==='critical'){
 errors.push('Critical derived-index swap identity corruption must be resolved before teaching-data synchronization can begin.');
}else if(indexHealth?.ok===false){
 warnings.push(`Derived indexes are currently inconsistent (${Number(indexHealth.mismatchCount)||0} mismatch${Number(indexHealth.mismatchCount)===1?'':'es'}). The import will rebuild and verify them before completion.`);
}
return{source,fingerprint,importId,analysis,currentFaculty,currentSessions,summarySettings,indexHealth,errors,warnings};
```

If `verifyIndexes()` throws because of a network/permission/operational failure, do not convert it into `MISMATCH`; let preflight reject so the UI displays the operational error and no import can start.

- [ ] **Step 5: Replace legacy `errors`-array formatting at final verification with structured mismatch formatting**

Add a local formatter:

```js
function indexFailureMessage(report){
 const rows=(report?.mismatches||[]).slice(0,5).map(row=>{
  const where=[row.document,row.path].filter(Boolean).join('.');
  return `${where||'derived index'}: ${row.issue||'mismatch'}`;
 });
 return rows.join('; ')||'unknown derived-index mismatch';
}
```

Then final import verification becomes:

```js
const indexCheck=await verifyIndexes({faculty:currentFaculty,sessions:currentSessions,mode:'import'});
if(!indexCheck?.ok)throw Error(`Derived index verification failed (${indexCheck?.severity||'mismatch'}): ${indexFailureMessage(indexCheck)}`);
```

Apply the same structured check in restore final verification, preserving existing restore phase/checkpoint behavior.

- [ ] **Step 6: Update final-verification failure tests to assert phase/lock and useful mismatch text**

```js
test('final structured verifier failure keeps the lock and reports the mismatched document',async()=>{
 const h=await createHarness({failOnceAt:'index-verify'});
 await assert.rejects(()=>h.controller.start(h.startArgs),/schedule_stats.*sessionCount/i);
 assert.equal(h.store.job.failedPhase,'VERIFYING_FINAL');
 assert.equal(h.store.system.teachingDataWriteLocked,true);
 await h.controller.resume(h.file);
 assert.equal(h.store.job.status,'COMPLETED');
});
```

Also add a restore-path structured verifier failure test using the existing restore failpoint harness so both import and restore share the full report contract.

- [ ] **Step 7: Run focused Workstream 3 controller tests**

Run:

```bash
node --test tests/bulk-import-controller.test.js
```

Expected: PASS, including all previous resumability tests.

- [ ] **Step 8: Commit Task 4**

```bash
git add bulk-import-controller.js tests/bulk-import-controller.test.js
git commit -m "feat: gate bulk import on derived index health"
```

---

### Task 5: Inject the Full Verifier/Rebuilder and Close the Provisional Path

**Files:**
- Modify: `bulk-import-ui.js`
- Modify: `tests/bulk-import-ui.test.js`
- Modify: `index-maintenance.js` — keep a compatibility wrapper only; no runtime caller should use the provisional name.
- Modify: `tests/index-maintenance.test.js` — compatibility wrapper delegates to the full verifier.

**Interfaces:**
- Consumes from Task 1/2: `verifyDerivedIndexes(db,{faculty,sessions})`, `writeDerivedIndexes(db,faculty,sessions,actor)`.
- Produces Workstream 3 runtime injection with no `verifyDerivedIndexesProvisional` references.

- [ ] **Step 1: Add a failing source-contract test requiring the full verifier injection**

Extend `tests/bulk-import-ui.test.js`:

```js
test('bulk import runtime injects atomic rebuild and full canonical verification',()=>{
 const js=fs.readFileSync(path.join(root,'bulk-import-ui.js'),'utf8');
 assert.match(js,/rebuildIndexes:\s*\(\{faculty,sessions,actor:who\}\)=>indexMaintenance\.writeDerivedIndexes\(db,faculty,sessions,who\)/);
 assert.match(js,/verifyIndexes:\s*\(\{faculty,sessions\}\)=>indexMaintenance\.verifyDerivedIndexes\(db,\{faculty,sessions\}\)/);
 assert.doesNotMatch(js,/verifyDerivedIndexesProvisional/);
});
```

- [ ] **Step 2: Run the focused UI test to prove RED**

Run:

```bash
node --test tests/bulk-import-ui.test.js
```

Expected: FAIL because the runtime still injects `verifyDerivedIndexesProvisional()`.

- [ ] **Step 3: Switch the Workstream 3 runtime injection to the full verifier**

Change only the dependency injection line; do not redesign the UI state machine.

```js
const controller=controllerApi.create({
 core,backup,store,actor,projectId,
 Timestamp:firebase.firestore.Timestamp,
 prepareSession:indexMaintenance.sessionForWrite,
 rebuildIndexes:({faculty,sessions,actor:who})=>indexMaintenance.writeDerivedIndexes(db,faculty,sessions,who),
 verifyIndexes:({faculty,sessions})=>indexMaintenance.verifyDerivedIndexes(db,{faculty,sessions}),
 onProgress:value=>{progress=value;render()}
});
```

Because `writeDerivedIndexes()` is atomic after Task 2, the existing `REBUILDING_INDEXES` phase gains the required atomic behavior without a new import phase.

- [ ] **Step 4: Keep a compatibility wrapper in `index-maintenance.js`, but remove production references**

```js
async function verifyDerivedIndexesProvisional(db,faculty,sessions){
 return verifyDerivedIndexes(db,{faculty,sessions});
}
```

Export both names for one compatibility cycle. The wrapper prevents an accidental stale caller from reverting to weak behavior because it now delegates to the full verifier.

- [ ] **Step 5: Add a compatibility test**

```js
test('legacy provisional verifier name delegates to the full structured verifier',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 docs.schedule_stats.sessionCount=99;
 const result=await api.verifyDerivedIndexesProvisional(fakeSettingsDb(docs),faculty,sessions);
 assert.equal(result.severity,'mismatch');
 assert.ok(result.mismatches.some(row=>row.document==='schedule_stats'));
});
```

- [ ] **Step 6: Run focused integration tests**

Run:

```bash
node --test tests/index-maintenance.test.js tests/bulk-import-controller.test.js tests/bulk-import-ui.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add index-maintenance.js bulk-import-ui.js tests/index-maintenance.test.js tests/bulk-import-ui.test.js
git commit -m "feat: use full derived index verifier in recovery flow"
```

---

### Task 6: Full Regression, Emulator Verification, and PR Test-Site Gate

**Files:**
- Modify only if a failing test exposes a Workstream 4 defect.
- No scope expansion or unrelated refactor during this task.

**Interfaces:**
- Verifies all interfaces produced by Tasks 1–5 together.

- [ ] **Step 1: Run the full static/unit suite**

Run:

```bash
npm test
```

Expected: exit code 0; no failing tests.

- [ ] **Step 2: Run the full Firebase/Auth emulator suite using the repository command**

Run:

```bash
npm run test:emulator
```

Expected: exit code 0; all emulator-enabled tests pass. The new derived-index emulator test uses its own project ID internally and must not race other suites.

- [ ] **Step 3: Re-run the deliberate-corruption emulator test alone for explicit evidence**

Run:

```bash
npx firebase emulators:exec --only firestore,auth --project demo-ucvm-derived-index "node --test tests/index-maintenance-emulator.test.js"
```

Expected: every corruption scenario passes, including repairable missing/stale docs and critical swap-identity blocking.

- [ ] **Step 4: Verify no production source still calls the provisional verifier**

Run:

```bash
grep -R "verifyDerivedIndexesProvisional" -n --exclude-dir=.git --exclude="*.md" .
```

Expected: only the compatibility function/export and its regression test remain; `bulk-import-ui.js`, `bulk-import-controller.js`, and Faculty Dashboard runtime contain no provisional call.

- [ ] **Step 5: Verify the final changed-file scope**

Run:

```bash
git diff --name-only main...HEAD
```

Expected Workstream 4 implementation scope:

```text
bulk-import-controller.js
bulk-import-ui.js
derived-index-health.js
faculty-admin.css
faculty-admin.html
index-maintenance.js
tests/bulk-import-controller.test.js
tests/bulk-import-ui.test.js
tests/derived-index-health.test.js
tests/index-maintenance-emulator.test.js
tests/index-maintenance.test.js
tests/maintenance-state.test.js
tests/runtime-assets.test.js
tools/static-assets.json
```

The already-approved spec/plan docs may also appear if execution is based on the documentation branch. `firestore.rules` should not appear.

- [ ] **Step 6: Commit only any final Workstream 4 fixes required by full regression**

If Step 1–5 require no changes, do not create an empty commit. If a Workstream 4 defect was fixed, commit only those files:

```bash
git add <exact-files-fixed>
git commit -m "fix: close derived index verification regressions"
```

- [ ] **Step 7: Push the implementation branch and create a Draft PR to `main`**

The PR body must state:

```text
- Verify is read-only and available to all Admin roles.
- Manual Rebuild is UI-limited to Owner / ADFA General.
- Normal Admin incremental derived-index maintenance remains intact.
- Full rebuild is one Firestore batch of four documents plus mandatory reverify.
- Critical swap identity ambiguity blocks rebuild and bulk-import preflight.
- Workstream 3 final import/restore gates use the full verifier.
- Firestore rules were not changed.
- Deliberate corruption was tested only in Firebase Emulator.
- Do not merge until GitHub Pages manual validation is complete and explicitly approved.
```

- [ ] **Step 8: Wait for Test and GitHub Pages Test Site workflows**

Require both PR-head workflows to complete successfully before asking for manual validation.

- [ ] **Step 9: Manual GitHub Pages validation — non-destructive only**

Ask the user to validate these exact behaviors on the fixed Pages test site:

```text
1. Sign in with an Admin account.
2. Open Faculty Dashboard -> Faculty Database.
3. Derived Index Health card is present.
4. Click Verify Derived Indexes.
5. Four document states, faculty/session counts, and Overall status appear.
6. With ADFA Regular: Verify is available; Manual Rebuild is not visible.
7. With Owner / ADFA General: Manual Rebuild is visible.
8. Do not deliberately corrupt live indexes.
9. Do not click Manual Rebuild merely to test it if the live report is HEALTHY.
10. If maintenance is active, Manual Rebuild is disabled/blocked by the shared maintenance guard.
```

If live Verify returns MISMATCH or CRITICAL, stop and report the exact output; do not repair live data as part of smoke testing without a separate explicit decision.

- [ ] **Step 10: Merge only after explicit user approval**

Do not merge on CI alone. The user must explicitly approve the tested PR/version.

- [ ] **Step 11: Verify post-merge `main` workflows**

After merge, require fresh success for:

```text
Test
Azure Static Web Apps
```

Do not claim production completion while Azure is queued, in progress, failed, or waiting for an approval gate.

---

## Plan Self-Review Checklist

Before execution starts, confirm the plan covers every approved spec requirement:

- Canonical business-content verification for all four documents: Task 1.
- Generation metadata ignored: Task 1.
- Exact field-level diffs and 50-row display cap: Task 1.
- Missing/invalid documents distinguished from operational errors: Task 1.
- Stable opaque-key preservation and new-key allocation only on rebuild: Tasks 1–2.
- `HEALTHY / MISMATCH / CRITICAL`: Task 1.
- Critical ambiguity blocks automatic rebuild: Tasks 1–2.
- One four-document Firestore batch: Task 2.
- Fresh source reads and mandatory post-rebuild verification: Task 2.
- Emulator deliberate corruption: Task 2.
- Faculty Database health UI: Task 3.
- Verify all Admin / Manual Rebuild Owner-General UI semantics: Task 3.
- Shared maintenance lock blocks Manual Rebuild: Task 3.
- Workstream 3 critical preflight block and ordinary mismatch warning: Task 4.
- Workstream 3 final import and restore full verification: Tasks 4–5.
- No production caller remains on weak provisional behavior: Task 5.
- No Firestore rules restriction that breaks normal Admin incremental writes: Global Constraints + Task 6 scope check.
- Non-destructive Pages validation and explicit merge approval: Task 6.

The implementation plan is complete only when this mapping has no uncovered requirement and the plan contains no unfinished implementation markers.