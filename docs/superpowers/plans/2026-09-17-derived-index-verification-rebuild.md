# Derived Index Verification & Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a canonical, read-only verifier for all four derived Firestore index documents, add a safe atomic full rebuild with post-verification, surface it in Faculty Dashboard, and make Workstream 3 use the full health gate.

**Architecture:** `index-maintenance.js` remains the single derived-index domain module. It gains pure swap-identity analysis, deterministic document normalization/diffing, one Firestore `WriteBatch` for four-document rebuilds, and DB-aware verify/rebuild APIs. A focused `derived-index-health.js` module owns the Faculty Database health card. Bulk import keeps its existing state machine but calls the full verifier during preflight and final verification.

**Tech Stack:** Vanilla JavaScript, Firebase Firestore compat client, Node.js `node:test`, Firebase/Auth emulators, GitHub Pages, Azure Static Web Apps.

**Spec:** `docs/superpowers/specs/2026-09-16-derived-index-verification-rebuild-design.md`

## Global Constraints

- Managed documents remain `settings/faculty_index`, `settings/schedule_stats`, `settings/faculty_swap_index`, and `settings/faculty_swap_map`.
- Verify is read-only and never allocates opaque swap keys.
- Existing valid opaque swap keys are preserved exactly.
- A genuinely new active faculty member may receive a new opaque key only during rebuild.
- Ambiguous old swap-key ownership is `CRITICAL`; automatic rebuild is blocked and there is no Force Repair.
- Full rebuild writes all four derived documents in one Firestore `WriteBatch`, then runs a fresh full verification.
- A successful batch commit alone is never reported as repair success.
- All Admin roles may Verify; only Owner / ADFA General sees Manual Rebuild.
- Ordinary Admin timetable edits keep their existing automatic incremental index maintenance. Do not change all derived-index rules to `general()`-only.
- Manual Rebuild is an application/UI workflow boundary in the current Spark client architecture, not a trusted-server security boundary.
- Existing Workstream 3 maintenance lock takes precedence; `[data-derived-index-rebuild]` remains blocked while teaching-data maintenance is active.
- Workstream 3 preflight allows ordinary derived-index mismatch with a warning, but blocks `CRITICAL` swap identity corruption before source writes.
- Workstream 3 final import and restore verification use the full verifier.
- Verification details are capped at 50 returned/displayed diff rows while `mismatchCount` retains the full count.
- `generatedAt`, `generatedBy`, and `generatedByName` are non-semantic comparison metadata.
- Deliberate corruption tests run only against Firebase Emulator, never GitHub Pages live Firebase.
- No Cloud Functions, backend service, hash/version subsystem, scheduling changes, audit redesign, or role-vocabulary migration is part of this workstream.
- No Firestore rules change is expected. If implementation reveals a necessary rules change, stop and review it separately before editing `firestore.rules`.

---

## File Map

**Domain / Firestore**
- Modify `index-maintenance.js` — canonical four-index build, structured verifier, atomic writer, fresh-data rebuild.

**Faculty Dashboard**
- Create `derived-index-health.js` — report helpers and Verify/Rebuild runtime.
- Modify `faculty-admin.html` — static health card inside Faculty Database and script load.
- Modify `faculty-admin.css` — health card/status/diff styles.
- Modify `tools/static-assets.json` — add deployable module.

**Workstream 3**
- Modify `bulk-import-controller.js` — preflight health gate and structured final error formatting.
- Modify `bulk-import-ui.js` — inject the full verifier and atomic writer.

**Tests**
- Modify `tests/index-maintenance.test.js`.
- Create `tests/index-maintenance-emulator.test.js`.
- Create `tests/derived-index-health.test.js`.
- Modify `tests/bulk-import-controller.test.js`.
- Modify `tests/bulk-import-ui.test.js`.
- Modify `tests/maintenance-state.test.js`.
- Modify `tests/runtime-assets.test.js`.

---

### Task 1: Canonical Four-Document Verification Core

**Files:**
- Modify: `index-maintenance.js`
- Modify: `tests/index-maintenance.test.js`

**Interfaces:**
- Consumes `UCVM_DATA_INDEX.buildFacultyIndex`, `scheduleStats`, and `buildFacultySwapIndexes`.
- Produces:
  - `analyzeSwapIdentity({faculty, publicIndex, privateMap, publicExists, privateExists})`
  - `buildExpectedDerivedIndexes({faculty, sessions, privateMap, keyFactory, allocateMissingKeys})`
  - `compareDerivedIndexDocuments({expected, actual, swapAnalysis, counts, maxDetails})`
  - `verifyDerivedIndexes(db, {faculty, sessions, maxDetails}={})`
- Report shape: `{ok, severity, checkedAt, counts, documents, mismatchCount, mismatches}` with `severity` one of `healthy`, `mismatch`, `critical`.

- [ ] **Step 1: Replace provisional-only assertions with failing structured-verifier tests**

Add a canonical fixture to `tests/index-maintenance.test.js`:

```js
function fullVerifierFixture(){
 const api=require(path.join(root,'index-maintenance.js'));
 const dataIndex=require(path.join(root,'data-index.js'));
 const faculty=[
  {__id:'1001',preferredFullName:'Alex',active:true,doe:{teaching:20}},
  {__id:'1002',preferredFullName:'Blair',active:true,doe:{teaching:20}}
 ];
 const sessions=[{id:'s1',course:'200',assignments:[{ucid:'1001',doeCredit:2}]}];
 const privateMap={schemaVersion:'ucvm-faculty-swap-map-v1',entries:[
  {key:'key-a',facultyId:'1001'},
  {key:'key-b',facultyId:'1002'}
 ]};
 const swap=dataIndex.buildFacultySwapIndexes(faculty,privateMap,()=>{throw Error('verify must not allocate keys')});
 const base=api.derivedDocuments(faculty,sessions);
 return{api,faculty,sessions,docs:{
  faculty_index:{...base.facultyIndex,generatedAt:'old',generatedBy:'u',generatedByName:'N'},
  schedule_stats:{...base.scheduleStats,generatedAt:'old'},
  faculty_swap_index:{...swap.publicIndex,generatedAt:'old'},
  faculty_swap_map:{...swap.privateMap,generatedAt:'old',generatedBy:'u',generatedByName:'N'}
 }};
}

test('full verifier returns HEALTHY and ignores generation metadata',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions});
 assert.equal(result.ok,true);
 assert.equal(result.severity,'healthy');
 assert.equal(result.mismatchCount,0);
 assert.deepEqual(result.documents,{
  faculty_index:'healthy',schedule_stats:'healthy',faculty_swap_index:'healthy',faculty_swap_map:'healthy'
 });
});

test('full verifier reports exact schedule_stats path and values',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 docs.schedule_stats.courseCounts['200']=9;
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions});
 assert.equal(result.severity,'mismatch');
 assert.ok(result.mismatches.some(row=>row.document==='schedule_stats'&&row.path==='courseCounts.200'&&row.expected===1&&row.actual===9));
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test tests/index-maintenance.test.js
```

Expected: FAIL because `verifyDerivedIndexes()` does not exist.

- [ ] **Step 3: Add non-semantic metadata stripping and stable document normalization**

Inside `index-maintenance.js`:

```js
const DERIVED_IDS=Object.freeze(['faculty_index','schedule_stats','faculty_swap_index','faculty_swap_map']);
const GENERATION_META=new Set(['generatedAt','generatedBy','generatedByName']);

function stripGenerationMeta(value){
 if(Array.isArray(value))return value.map(stripGenerationMeta);
 if(value&&typeof value==='object'){
  const out={};
  for(const [key,item] of Object.entries(value)){
   if(!GENERATION_META.has(key))out[key]=stripGenerationMeta(item);
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

Before keyed conversion, structure validation added in Step 7 must catch missing identity fields or duplicate identity keys so conversion cannot silently collapse corrupted rows.

- [ ] **Step 4: Add bounded recursive diffing**

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
  const lo=left&&typeof left==='object'&&!Array.isArray(left),ro=right&&typeof right==='object'&&!Array.isArray(right);
  if(lo&&ro){
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

- [ ] **Step 5: Add swap-identity analysis that cannot silently collapse ambiguity**

```js
function analyzeSwapIdentity({faculty,publicIndex,privateMap,publicExists=true,privateExists=true}){
 const activeIds=new Set((faculty||[]).filter(row=>row&&row.active!==false).map(row=>String(row.__id||row.id||row.ucid||'').trim()).filter(Boolean));
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
 const privateKeys=new Set(keyOwners.keys());
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

- [ ] **Step 6: Add canonical expected-index building without key allocation during Verify**

```js
function buildExpectedDerivedIndexes({faculty,sessions,privateMap,keyFactory,allocateMissingKeys=false}){
 const base=derivedDocuments(faculty,sessions),active=(faculty||[]).filter(row=>row&&row.active!==false);
 const analysis=analyzeSwapIdentity({faculty:active,publicIndex:{entries:[]},privateMap,publicExists:true,privateExists:true});
 const known=new Set((analysis.knownPrivateMap.entries||[]).map(row=>String(row.facultyId)));
 const swapFaculty=allocateMissingKeys?active:active.filter(row=>known.has(String(row.__id||row.id||row.ucid||'')));
 const factory=allocateMissingKeys?keyFactory:()=>{throw Error('Verify cannot allocate opaque swap keys.');};
 const swap=index.buildFacultySwapIndexes(swapFaculty,analysis.knownPrivateMap,factory);
 return{documents:{
  faculty_index:base.facultyIndex,
  schedule_stats:base.scheduleStats,
  faculty_swap_index:swap.publicIndex,
  faculty_swap_map:swap.privateMap
 },swapAnalysis:analysis};
}
```

The full verifier separately adds a repairable `missing-new-faculty-key` mismatch for each `missingFacultyId`; it does not invent a placeholder key.

- [ ] **Step 7: Add exact DB-read and structure-validation helpers**

These helpers are required by later tasks and must be exported only when useful to tests; they are otherwise private module functions.

```js
async function loadCollectionRows(db,name){
 const snap=await db.collection(name).get();
 return snap.docs.map(doc=>({__id:doc.id,...doc.data()}));
}

async function loadDerivedDocuments(db){
 const snaps=await Promise.all(DERIVED_IDS.map(id=>db.collection('settings').doc(id).get()));
 return Object.fromEntries(DERIVED_IDS.map((id,i)=>[id,{exists:snaps[i].exists,data:snaps[i].exists?snaps[i].data():undefined}]));
}

function structureIssues(id,loaded){
 if(!loaded?.exists)return[{document:id,path:'document',issue:'document-missing',expected:'document exists',actual:'missing',severity:'mismatch'}];
 const data=loaded.data||{};
 if(id==='schedule_stats')return[];
 if(!Array.isArray(data.entries))return[{document:id,path:'entries',issue:'invalid-structure',expected:'array',actual:typeof data.entries,severity:'mismatch'}];
 if(id==='faculty_index'){
  const ids=data.entries.map(row=>String(row?.id||'').trim());
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)return[{document:id,path:'entries',issue:'invalid-structure',expected:'unique non-empty entry ids',actual:ids,severity:'mismatch'}];
 }
 if(id==='faculty_swap_index'){
  const keys=data.entries.map(row=>String(row?.key||'').trim());
  if(keys.some(key=>!key)||new Set(keys).size!==keys.length)return[{document:id,path:'entries',issue:'invalid-structure',expected:'unique non-empty keys',actual:keys,severity:'mismatch'}];
 }
 return[];
}
```

Private-map duplicate ownership is classified by `analyzeSwapIdentity()` as `CRITICAL`, not merely invalid structure.

- [ ] **Step 8: Implement `compareDerivedIndexDocuments()`**

```js
function compareDerivedIndexDocuments({expected,actual,swapAnalysis,counts,maxDetails=50}){
 const all=[],documents=Object.fromEntries(DERIVED_IDS.map(id=>[id,'healthy']));
 let mismatchCount=0;
 const push=row=>{
  mismatchCount++;
  const rank={healthy:0,mismatch:1,critical:2},next=row.severity||'mismatch';
  if(rank[next]>rank[documents[row.document]])documents[row.document]=next;
  if(all.length<maxDetails)all.push(row);
 };
 for(const id of DERIVED_IDS){
  const issues=structureIssues(id,actual[id]);
  if(issues.length){issues.forEach(push);continue}
  const diff=diffValues(id,comparableDocument(id,expected[id]),comparableDocument(id,actual[id].data),Number.MAX_SAFE_INTEGER);
  mismatchCount+=diff.count;
  if(diff.count)documents[id]='mismatch';
  for(const row of diff.mismatches){if(all.length<maxDetails)all.push(row)}
 }
 for(const facultyId of swapAnalysis.missingFacultyIds||[])push({document:'faculty_swap_map',path:`faculty.${facultyId}`,issue:'missing-new-faculty-key',expected:'opaque key allocated during rebuild',actual:'missing',severity:'mismatch'});
 for(const facultyId of swapAnalysis.staleFacultyIds||[])push({document:'faculty_swap_map',path:`faculty.${facultyId}`,issue:'stale-private-mapping',expected:'removed for inactive/deleted faculty',actual:'present',severity:'mismatch'});
 for(const row of swapAnalysis.criticalIssues||[])push(row);
 const severity=Object.values(documents).includes('critical')?'critical':Object.values(documents).includes('mismatch')?'mismatch':'healthy';
 return{ok:severity==='healthy',severity,checkedAt:new Date().toISOString(),counts,documents,mismatchCount,mismatches:all};
}
```

When the same condition would be reported both by generic diffing and a swap-identity special issue, the implementation should suppress the generic duplicate for that exact identity path so `mismatchCount` reflects distinct problems rather than double-counting one defect.

- [ ] **Step 9: Implement `verifyDerivedIndexes()` using supplied source arrays when available**

```js
async function verifyDerivedIndexes(db,{faculty,sessions,maxDetails=50}={}){
 const sourceFaculty=faculty||await loadCollectionRows(db,'faculty');
 const sourceSessions=sessions||await loadCollectionRows(db,'sessions');
 const actual=await loadDerivedDocuments(db);
 const privateMap=actual.faculty_swap_map.exists?actual.faculty_swap_map.data:{schemaVersion:'ucvm-faculty-swap-map-v1',entries:[]};
 const publicIndex=actual.faculty_swap_index.exists?actual.faculty_swap_index.data:{schemaVersion:'ucvm-faculty-swap-index-v1',entries:[]};
 const built=buildExpectedDerivedIndexes({faculty:sourceFaculty,sessions:sourceSessions,privateMap,allocateMissingKeys:false});
 const swapAnalysis=analyzeSwapIdentity({faculty:sourceFaculty,publicIndex,privateMap,publicExists:actual.faculty_swap_index.exists,privateExists:actual.faculty_swap_map.exists});
 return compareDerivedIndexDocuments({expected:built.documents,actual,swapAnalysis,counts:{faculty:sourceFaculty.length,sessions:sourceSessions.length},maxDetails});
}
```

Any Firestore read/network/permission error must reject from this function; it must not be converted into a data `MISMATCH`.

- [ ] **Step 10: Add failing/then-green coverage for new faculty, missing/invalid docs, critical ambiguity, and the 50-detail cap**

```js
test('new active faculty without private mapping is repairable and verify allocates nothing',async()=>{
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
 assert.ok(result.mismatches.some(row=>row.issue==='duplicate-key-ownership'));
});

test('verifier counts all mismatches but returns at most 50 details',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 docs.faculty_index.entries=Array.from({length:80},(_,i)=>({id:String(i),name:`Wrong ${i}`}));
 const result=await api.verifyDerivedIndexes(fakeSettingsDb(docs),{faculty,sessions,maxDetails:50});
 assert.ok(result.mismatchCount>50);
 assert.equal(result.mismatches.length,50);
});
```

Also assert `document-missing` and `invalid-structure` are named explicitly.

- [ ] **Step 11: Run focused verifier suite**

```bash
node --test tests/index-maintenance.test.js
```

Expected: PASS.

- [ ] **Step 12: Commit Task 1**

```bash
git add index-maintenance.js tests/index-maintenance.test.js
git commit -m "feat: add canonical derived index verification"
```

---

### Task 2: Atomic Full Rebuild and Emulator Corruption Proof

**Files:**
- Modify: `index-maintenance.js`
- Modify: `tests/index-maintenance.test.js`
- Create: `tests/index-maintenance-emulator.test.js`

**Interfaces:**
- Consumes Task 1 verifier/build helpers.
- Produces:
  - `writeDerivedIndexes(db, faculty, sessions, actor={})`
  - `rebuildDerivedIndexes(db, actor={})`
- `updateDerivedIndexes(db, changes, actor)` remains the normal incremental path.

- [ ] **Step 1: Add a failing fake-batch test**

Use a fake DB whose generated `doc()` IDs work for new swap keys:

```js
function fakeBatchDb(initial={}){
 const docs=new Map(Object.entries(initial)),commits=[];
 let generated=0;
 const makeRef=id=>({id,get:async()=>docs.has(id)?{exists:true,data:()=>docs.get(id)}:{exists:false,data:()=>undefined}});
 return{
  commits,
  collection(name){
   if(name!=='settings')throw Error(`unexpected collection ${name}`);
   return{doc(id){return id===undefined?{id:`generated-${++generated}`} : makeRef(id)}};
  },
  batch(){
   const writes=[];
   return{set(ref,data){writes.push({id:ref.id,data})},async commit(){for(const write of writes)docs.set(write.id,write.data);commits.push(writes)}};
  }
 };
}

test('writeDerivedIndexes commits all four settings documents in one batch',async()=>{
 const db=fakeBatchDb({
  faculty_swap_map:{schemaVersion:'ucvm-faculty-swap-map-v1',entries:[{key:'stable',facultyId:'1001'}]},
  faculty_swap_index:{schemaVersion:'ucvm-faculty-swap-index-v1',entries:[{key:'stable',name:'Alex',aliases:['Alex'],unavailableRanges:[]}]}
 });
 await api.writeDerivedIndexes(db,[{__id:'1001',preferredFullName:'Alex',active:true}],[],{uid:'g',name:'General'});
 assert.equal(db.commits.length,1);
 assert.deepEqual(db.commits[0].map(row=>row.id).sort(),['faculty_index','faculty_swap_index','faculty_swap_map','schedule_stats']);
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --test tests/index-maintenance.test.js
```

Expected: FAIL because current `writeDerivedIndexes()` performs independent writes.

- [ ] **Step 3: Make `writeDerivedIndexes()` analyze current swap identity and use one batch**

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
  error.report={ok:false,severity:'critical',mismatchCount:identity.criticalIssues.length,mismatches:identity.criticalIssues};
  throw error;
 }
 const built=buildExpectedDerivedIndexes({faculty,sessions,privateMap,keyFactory:()=>db.collection('settings').doc().id,allocateMissingKeys:true});
 const stamp=stampValue(),meta={generatedAt:stamp,...actorMeta(actor)},batch=db.batch();
 batch.set(db.collection('settings').doc('faculty_index'),{...built.documents.faculty_index,...meta});
 batch.set(db.collection('settings').doc('schedule_stats'),{...built.documents.schedule_stats,...meta});
 batch.set(db.collection('settings').doc('faculty_swap_index'),{...built.documents.faculty_swap_index,generatedAt:stamp});
 batch.set(db.collection('settings').doc('faculty_swap_map'),{...built.documents.faculty_swap_map,...meta});
 await batch.commit();
 return{facultyIndex:built.documents.faculty_index,scheduleStats:built.documents.schedule_stats,publicIndex:built.documents.faculty_swap_index,privateMap:built.documents.faculty_swap_map};
}
```

- [ ] **Step 4: Add `rebuildDerivedIndexes()` with fresh source reads and mandatory post-verify**

```js
async function rebuildDerivedIndexes(db,actor={}){
 const [faculty,sessions]=await Promise.all([loadCollectionRows(db,'faculty'),loadCollectionRows(db,'sessions')]);
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

- [ ] **Step 5: Add unit tests for stable key preservation, new-key allocation, critical blocking, and post-verify race detection**

Required assertions:

```js
assert.equal(after.privateMap.entries.find(row=>row.facultyId==='1001').key,'stable');
assert.match(newFacultyKey,/\S/);
assert.notEqual(newFacultyKey,'stable');
await assert.rejects(()=>api.rebuildDerivedIndexes(criticalDb,{uid:'g'}),error=>error.code==='critical-derived-index');
assert.equal(criticalDb.commits.length,0);
await assert.rejects(()=>api.rebuildDerivedIndexes(racingDb,{uid:'g'}),error=>error.code==='derived-index-post-verify-failed');
```

- [ ] **Step 6: Run unit suite GREEN**

```bash
node --test tests/index-maintenance.test.js
```

Expected: PASS.

- [ ] **Step 7: Create a dedicated emulator test with a modular-to-compat adapter**

Create `tests/index-maintenance-emulator.test.js`. Use project ID `demo-ucvm-derived-index` so its `clearFirestore()` cannot race existing emulator files.

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

Adapter:

```js
function compatDb(modularDb){
 const f=require('firebase/firestore');
 const wrap=(collectionName,id)=>({id,_native:f.doc(modularDb,collectionName,id),get:async()=>{const snap=await f.getDoc(f.doc(modularDb,collectionName,id));return{exists:snap.exists(),id:snap.id,data:()=>snap.data()}}});
 return{
  collection(name){return{
   doc(id){if(id===undefined){const native=f.doc(f.collection(modularDb,name));return{id:native.id,_native:native}}return wrap(name,id)},
   async get(){const snap=await f.getDocs(f.collection(modularDb,name));return{docs:snap.docs.map(row=>({id:row.id,data:()=>row.data()}))}}
  }},
  batch(){const native=f.writeBatch(modularDb);return{set(ref,data){native.set(ref._native,data)},commit(){return native.commit()}}}
 };
}
```

- [ ] **Step 8: Add deliberate-corruption scenarios**

Seed canonical data with security rules disabled, then use an authenticated ADFA General context for Verify/Rebuild.

Required emulator tests:

```js
check('missing faculty_index is detected, rebuilt, and HEALTHY afterward',async()=>{/* delete settings/faculty_index; verify mismatch; rebuild; verify healthy */});
check('wrong schedule count reports exact values then rebuilds cleanly',async()=>{/* set wrong courseCounts; assert path/expected/actual */});
check('stale public swap display and AFC ranges repair without changing private key',async()=>{/* capture key before/after */});
check('duplicate private opaque-key ownership is CRITICAL and rebuild is blocked',async()=>{/* force duplicate key */});
check('missing private map with surviving public keys is CRITICAL',async()=>{/* delete faculty_swap_map only */});
```

- [ ] **Step 9: Run the new emulator suite**

```bash
npx firebase emulators:exec --only firestore,auth --project demo-ucvm-derived-index "node --test tests/index-maintenance-emulator.test.js"
```

Expected: all deliberate-corruption tests PASS.

- [ ] **Step 10: Commit Task 2**

```bash
git add index-maintenance.js tests/index-maintenance.test.js tests/index-maintenance-emulator.test.js
git commit -m "feat: rebuild derived indexes atomically"
```

---

### Task 3: Faculty Database Derived Index Health UI

**Files:**
- Create: `derived-index-health.js`
- Create: `tests/derived-index-health.test.js`
- Modify: `faculty-admin.html`
- Modify: `faculty-admin.css`
- Modify: `tests/maintenance-state.test.js`
- Modify: `tools/static-assets.json`
- Modify: `tests/runtime-assets.test.js`

**Interfaces:**
- Consumes `UCVM_INDEX_MAINTENANCE.verifyDerivedIndexes(db)` and `rebuildDerivedIndexes(db,actor)`.
- Consumes `UCVM.admin(profile)`, `UCVM.general(profile)`, `UCVM.init()`.
- Consumes `UCVM_MAINTENANCE.normalWritesAllowed()` and existing `[data-derived-index-rebuild]` blocking.
- Produces CommonJS/browser module `UCVM_DERIVED_INDEX_HEALTH` exposing `canManualRebuild`, `statusRows`, `reportSummary`, `createRuntime`, `autoStart`.

- [ ] **Step 1: Create failing helper tests**

```js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ui=require('../derived-index-health.js');

test('manual rebuild is visible only for General semantics',()=>{
 const access={general:p=>['owner','adfa_general'].includes(p.role)};
 assert.equal(ui.canManualRebuild({role:'owner'},access),true);
 assert.equal(ui.canManualRebuild({role:'adfa_general'},access),true);
 assert.equal(ui.canManualRebuild({role:'adfa_regular'},access),false);
 assert.equal(ui.canManualRebuild({role:'administrator'},access),false);
});

test('report summary keeps three health severities distinct',()=>{
 assert.equal(ui.reportSummary({severity:'healthy'}).label,'HEALTHY');
 assert.equal(ui.reportSummary({severity:'mismatch'}).label,'MISMATCH');
 assert.equal(ui.reportSummary({severity:'critical'}).label,'CRITICAL');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/derived-index-health.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Create the UMD module and pure helpers**

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
 const reportSummary=report=>{const severity=String(report?.severity||'unchecked');return{severity,label:severity.toUpperCase(),count:Number(report?.mismatchCount)||0}};
 return{canManualRebuild,statusRows,reportSummary};
});
```

- [ ] **Step 4: Run helper tests GREEN**

```bash
node --test tests/derived-index-health.test.js
```

Expected: PASS.

- [ ] **Step 5: Add the static card to `#database-view`**

Immediately after the existing Faculty Database toolbar:

```html
<div id="derived-index-health-card" class="derived-index-health-card">
  <div class="derived-index-health-head">
    <div><div class="section-kicker">Data integrity</div><h2>Derived Index Health</h2><p id="derived-index-health-meta">Not checked yet.</p></div>
    <div class="derived-index-health-actions">
      <button type="button" class="btn" id="derived-index-verify">Verify Derived Indexes</button>
      <button type="button" class="btn btn-primary hidden" id="derived-index-rebuild" data-derived-index-rebuild>Rebuild Derived Indexes</button>
    </div>
  </div>
  <div id="derived-index-health-status" class="derived-index-health-status" aria-live="polite"></div>
  <div id="derived-index-health-diffs"></div>
</div>
```

Load `derived-index-health.js` after `index-maintenance.js` and `maintenance-state.js`.

- [ ] **Step 6: Implement runtime Verify/Rebuild behavior without auto-verifying on load**

```js
function createRuntime({document:doc,window:win,db,profile,actor,access,indexMaintenance,maintenance}={}){
 let report=null,busy=false,operationalError='';
 const $=id=>doc.getElementById(id);
 function render(){
  const general=canManualRebuild(profile,access);
  $('derived-index-rebuild')?.classList.toggle('hidden',!general);
  if($('derived-index-rebuild'))$('derived-index-rebuild').disabled=busy||!report||report.severity!=='mismatch'||maintenance?.normalWritesAllowed?.()===false;
  if($('derived-index-verify'))$('derived-index-verify').disabled=busy;
  // Build four document rows, checkedAt/counts, exact mismatch rows, remaining-count copy, or operational-error copy.
 }
 async function verify(){
  busy=true;operationalError='';render();
  try{report=await indexMaintenance.verifyDerivedIndexes(db)}catch(error){operationalError=error?.message||String(error)}finally{busy=false;render()}
 }
 async function rebuild(){
  if(!canManualRebuild(profile,access)||report?.severity!=='mismatch')return;
  if(maintenance?.normalWritesAllowed?.()===false)return;
  if(!win.confirm('Rebuild the four derived indexes from current Faculty and Session data? Source Faculty and Session records will not be changed.'))return;
  busy=true;operationalError='';render();
  try{report=await indexMaintenance.rebuildDerivedIndexes(db,actor)}catch(error){if(error?.report)report=error.report;operationalError=error?.message||String(error)}finally{busy=false;render()}
 }
 $('derived-index-verify')?.addEventListener('click',verify);
 $('derived-index-rebuild')?.addEventListener('click',rebuild);
 render();
 return{verify,rebuild,render,currentReport:()=>report};
}
```

Rendering requirements:
- `healthy` -> `Overall: HEALTHY`.
- `mismatch` -> `Overall: MISMATCH`; General rebuild enabled when maintenance is open.
- `critical` -> `Overall: CRITICAL`; rebuild disabled.
- Firestore/network/permission exception -> operational error copy, never mislabeled MISMATCH.
- If `mismatchCount > mismatches.length`, render the exact difference, such as `143 additional mismatches not shown.`

- [ ] **Step 7: Add Admin-only `autoStart()`**

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

Call `autoStart()` only in browser context and export it for tests.

- [ ] **Step 8: Add source-contract tests**

```js
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Faculty Database owns the health card and rebuild participates in maintenance blocking',()=>{
 const html=read('faculty-admin.html');
 assert.match(html,/id="database-view"[\s\S]*id="derived-index-health-card"/);
 assert.match(html,/id="derived-index-rebuild"[^>]*data-derived-index-rebuild/);
 assert.ok(html.indexOf('derived-index-health.js')>html.indexOf('index-maintenance.js'));
});

test('runtime separates read-only verify from full rebuild',()=>{
 const js=read('derived-index-health.js');
 assert.match(js,/verifyDerivedIndexes\(db\)/);
 assert.match(js,/rebuildDerivedIndexes\(db,actor\)/);
});
```

- [ ] **Step 9: Preserve explicit maintenance selector coverage**

Add to `tests/maintenance-state.test.js`:

```js
test('derived index manual rebuild remains a blocked maintenance mutation',()=>{
 const api=require('../maintenance-state.js');
 assert.ok(api.BLOCKED_CLICK_SELECTORS.includes('[data-derived-index-rebuild]'));
});
```

No production change to `maintenance-state.js` is expected.

- [ ] **Step 10: Add scoped styles**

```css
.derived-index-health-card{margin:14px 0;padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.derived-index-health-head{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.derived-index-health-actions{display:flex;gap:8px;flex-wrap:wrap}
.derived-index-health-status{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:8px;margin-top:12px}
.derived-index-health-doc{padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--surface-2)}
.derived-index-health-diff{padding:8px 0;border-top:1px solid var(--border);font-size:12px}
@media(max-width:760px){.derived-index-health-status{grid-template-columns:repeat(2,minmax(0,1fr))}}
```

Do not rely on color alone; each state must include text.

- [ ] **Step 11: Add runtime asset and update manifest count**

Add `"derived-index-health.js"` to `tools/static-assets.json` and change the runtime manifest assertion from 41 to 42.

```js
assert.equal(manifest.length,42);
for(const name of ['derived-index-health.js','index-maintenance.js','faculty-doe.js','user-management.css'])assert.ok(manifest.includes(name),name);
```

- [ ] **Step 12: Run focused UI/runtime tests**

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
- Consumes injected `verifyIndexes({faculty,sessions,mode}) -> report`.
- Consumes injected `rebuildIndexes({faculty,sessions,actor,mode})`.
- Produces preflight `indexHealth` plus exact critical/warning behavior; phase names remain unchanged.

- [ ] **Step 1: Extend the controller test harness for structured verifier results**

```js
function healthyIndexReport(){return{ok:true,severity:'healthy',documents:{faculty_index:'healthy',schedule_stats:'healthy',faculty_swap_index:'healthy',faculty_swap_map:'healthy'},mismatchCount:0,mismatches:[]}}

function makeController(store,actor={uid:'general',name:'General'},options={}){
 let failIndexRebuild=options.failOnceAt==='index-rebuild',failVerifyFinal=options.failOnceAt==='index-verify';
 return controllerModule.create({
  core:smallCore,backup,store,actor,projectId:'tester-teaching',
  prepareSession:row=>({...row,facultyIds:(row.assignments||[]).map(a=>a.ucid).filter(Boolean)}),
  rebuildIndexes:async()=>{if(failIndexRebuild){failIndexRebuild=false;throw Error('Injected failure at index-rebuild')}},
  verifyIndexes:async({mode})=>{
   if(failVerifyFinal&&mode!=='preflight'){failVerifyFinal=false;return{ok:false,severity:'mismatch',mismatchCount:1,mismatches:[{document:'schedule_stats',path:'sessionCount',issue:'value-mismatch',expected:3,actual:99}]}}
   return options.indexReportByMode?.[mode]||healthyIndexReport();
  }
 });
}
```

- [ ] **Step 2: Add failing preflight tests**

```js
test('preflight warns but allows ordinary derived-index mismatch',async()=>{
 const store=memoryStore(),controller=makeController(store,undefined,{indexReportByMode:{preflight:{ok:false,severity:'mismatch',mismatchCount:1,mismatches:[{document:'schedule_stats',path:'sessionCount',issue:'value-mismatch'}]}}});
 const result=await controller.preflight(sourceFile());
 assert.equal(result.errors.length,0);
 assert.match(result.warnings.join('\n'),/derived index/i);
 assert.equal(result.indexHealth.severity,'mismatch');
});

test('preflight blocks critical swap identity corruption before source writes',async()=>{
 const store=memoryStore(),controller=makeController(store,undefined,{indexReportByMode:{preflight:{ok:false,severity:'critical',mismatchCount:1,mismatches:[{document:'faculty_swap_map',path:'key.dup',issue:'duplicate-key-ownership',severity:'critical'}]}}});
 const result=await controller.preflight(sourceFile());
 assert.match(result.errors.join('\n'),/critical.*derived|critical.*swap/i);
 assert.equal(store.system.teachingDataWriteLocked,false);
 assert.equal(store.job,null);
});
```

- [ ] **Step 3: Run controller tests RED**

```bash
node --test tests/bulk-import-controller.test.js
```

Expected: FAIL because preflight does not inspect derived-index health.

- [ ] **Step 4: Call full verification during preflight after current dataset reads**

```js
const indexHealth=await verifyIndexes({faculty:currentFaculty,sessions:currentSessions,mode:'preflight'});
if(indexHealth?.severity==='critical'){
 errors.push('Critical derived-index swap identity corruption must be resolved before teaching-data synchronization can begin.');
}else if(indexHealth?.ok===false){
 warnings.push(`Derived indexes are currently inconsistent (${Number(indexHealth.mismatchCount)||0} mismatch${Number(indexHealth.mismatchCount)===1?'':'es'}). The import will rebuild and verify them before completion.`);
}
return{source,fingerprint,importId,analysis,currentFaculty,currentSessions,summarySettings,indexHealth,errors,warnings};
```

If verification throws for network/permission/operational reasons, allow the exception to reject preflight. No source writes occur.

- [ ] **Step 5: Add a structured failure formatter for final import and restore verification**

```js
function indexFailureMessage(report){
 const rows=(report?.mismatches||[]).slice(0,5).map(row=>{
  const where=[row.document,row.path].filter(Boolean).join('.');
  return `${where||'derived index'}: ${row.issue||'mismatch'}`;
 });
 return rows.join('; ')||'unknown derived-index mismatch';
}
```

Use it in both final gates:

```js
const indexCheck=await verifyIndexes({faculty:currentFaculty,sessions:currentSessions,mode:'import'});
if(!indexCheck?.ok)throw Error(`Derived index verification failed (${indexCheck?.severity||'mismatch'}): ${indexFailureMessage(indexCheck)}`);
```

Restore uses `mode:'restore'` but the same report contract.

- [ ] **Step 6: Update final failure tests**

```js
test('final structured verifier failure keeps the lock and identifies the mismatch',async()=>{
 const h=await createHarness({failOnceAt:'index-verify'});
 await assert.rejects(()=>h.controller.start(h.startArgs),/schedule_stats.*sessionCount/i);
 assert.equal(h.store.job.failedPhase,'VERIFYING_FINAL');
 assert.equal(h.store.system.teachingDataWriteLocked,true);
 await h.controller.resume(h.file);
 assert.equal(h.store.job.status,'COMPLETED');
});
```

Add the equivalent restore final-verifier failure assertion without changing restore checkpoint semantics.

- [ ] **Step 7: Run controller tests GREEN**

```bash
node --test tests/bulk-import-controller.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add bulk-import-controller.js tests/bulk-import-controller.test.js
git commit -m "feat: gate bulk import on derived index health"
```

---

### Task 5: Switch Workstream 3 Runtime to the Full Verifier

**Files:**
- Modify: `bulk-import-ui.js`
- Modify: `tests/bulk-import-ui.test.js`
- Modify: `index-maintenance.js`
- Modify: `tests/index-maintenance.test.js`

**Interfaces:**
- Consumes `verifyDerivedIndexes(db,{faculty,sessions})` and atomic `writeDerivedIndexes(db,faculty,sessions,actor)`.
- Keeps `verifyDerivedIndexesProvisional(db,faculty,sessions)` only as a compatibility wrapper that delegates to the full verifier.

- [ ] **Step 1: Add a failing source-contract test**

```js
test('bulk import runtime injects atomic rebuild and full canonical verification',()=>{
 const js=fs.readFileSync(path.join(root,'bulk-import-ui.js'),'utf8');
 assert.match(js,/rebuildIndexes:\s*\(\{faculty,sessions,actor:who\}\)=>indexMaintenance\.writeDerivedIndexes\(db,faculty,sessions,who\)/);
 assert.match(js,/verifyIndexes:\s*\(\{faculty,sessions\}\)=>indexMaintenance\.verifyDerivedIndexes\(db,\{faculty,sessions\}\)/);
 assert.doesNotMatch(js,/verifyDerivedIndexesProvisional/);
});
```

- [ ] **Step 2: Run focused UI test RED**

```bash
node --test tests/bulk-import-ui.test.js
```

Expected: FAIL because runtime still injects the provisional verifier name.

- [ ] **Step 3: Change only the dependency injection**

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

- [ ] **Step 4: Keep one compatibility wrapper, but no production caller uses it**

```js
async function verifyDerivedIndexesProvisional(db,faculty,sessions){
 return verifyDerivedIndexes(db,{faculty,sessions});
}
```

Export both names for one compatibility cycle.

- [ ] **Step 5: Add compatibility coverage**

```js
test('legacy provisional verifier name delegates to full structured verification',async()=>{
 const {api,faculty,sessions,docs}=fullVerifierFixture();
 docs.schedule_stats.sessionCount=99;
 const result=await api.verifyDerivedIndexesProvisional(fakeSettingsDb(docs),faculty,sessions);
 assert.equal(result.severity,'mismatch');
 assert.ok(result.mismatches.some(row=>row.document==='schedule_stats'));
});
```

- [ ] **Step 6: Run focused integration tests**

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

### Task 6: Full Regression and Release Gate

**Files:**
- Modify only if a failing Workstream 4 test exposes a Workstream 4 defect.
- Do not expand scope or refactor unrelated code.

**Interfaces:**
- Verifies Tasks 1–5 together.

- [ ] **Step 1: Run full static/unit suite**

```bash
npm test
```

Expected: exit code 0 and zero failures.

- [ ] **Step 2: Run full Firebase/Auth emulator suite**

```bash
npm run test:emulator
```

Expected: exit code 0 and zero failures.

- [ ] **Step 3: Re-run deliberate corruption suite alone for explicit evidence**

```bash
npx firebase emulators:exec --only firestore,auth --project demo-ucvm-derived-index "node --test tests/index-maintenance-emulator.test.js"
```

Expected: all derived-index corruption scenarios PASS.

- [ ] **Step 4: Verify no runtime caller uses the weak provisional name**

```bash
grep -R "verifyDerivedIndexesProvisional" -n --exclude-dir=.git --exclude="*.md" .
```

Expected: only the compatibility function/export and its regression test remain. No call remains in `bulk-import-ui.js`, `bulk-import-controller.js`, or dashboard runtime.

- [ ] **Step 5: Verify final changed-file scope**

```bash
git diff --name-only main...HEAD
```

Expected implementation files:

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

Approved spec/plan docs may also appear when implementation starts from the documentation branch. `firestore.rules` should not appear.

- [ ] **Step 6: Commit only final Workstream 4 corrections if regression found any**

If no file changed, do not create an empty commit. If a Workstream 4 defect was corrected:

```bash
git add <exact-files-that-changed>
git commit -m "fix: close derived index verification regressions"
```

- [ ] **Step 7: Push implementation branch and create a Draft PR to `main`**

PR body must state:

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

- [ ] **Step 8: Require PR-head Test and GitHub Pages Test Site workflows to succeed**

Do not ask for manual acceptance until both are green.

- [ ] **Step 9: Ask for non-destructive GitHub Pages validation**

Exact validation:

```text
1. Sign in with an Admin account.
2. Open Faculty Dashboard -> Faculty Database.
3. Derived Index Health card is present.
4. Click Verify Derived Indexes.
5. Four document states plus faculty/session counts and Overall status appear.
6. ADFA Regular can Verify but cannot see Manual Rebuild.
7. Owner / ADFA General can see Manual Rebuild.
8. Do not deliberately corrupt live indexes.
9. Do not click Manual Rebuild merely to test it when live status is HEALTHY.
10. If maintenance is active, Manual Rebuild is disabled/blocked by the shared maintenance guard.
```

If live Verify reports MISMATCH or CRITICAL, stop and report the exact result. Do not repair live data as part of smoke testing without a separate explicit decision.

- [ ] **Step 10: Merge only after explicit user approval of the tested PR/version**

CI success alone is not approval.

- [ ] **Step 11: Verify post-merge `main` workflows**

Require fresh success for both:

```text
Test
Azure Static Web Apps
```

Do not claim production completion while Azure is queued, in progress, failed, or waiting on an approval gate.

---

## Self-Review Coverage

- Four-document canonical business verification: Task 1.
- Generation metadata ignored: Task 1.
- Exact field diffs and 50-detail cap: Task 1.
- Missing/invalid documents vs operational errors: Task 1.
- Stable opaque-key preservation and new-key allocation only on rebuild: Tasks 1–2.
- `HEALTHY / MISMATCH / CRITICAL`: Task 1.
- Critical ambiguity blocks rebuild: Tasks 1–2.
- One four-document Firestore batch: Task 2.
- Fresh reads and mandatory post-rebuild verification: Task 2.
- Emulator deliberate corruption: Task 2.
- Faculty Database health UI: Task 3.
- Verify all Admin / Manual Rebuild General-only UI semantics: Task 3.
- Shared maintenance lock blocks Manual Rebuild: Task 3.
- Workstream 3 critical preflight block and ordinary mismatch warning: Task 4.
- Workstream 3 final import and restore full verification: Tasks 4–5.
- No production caller remains on weak provisional behavior: Task 5.
- No Firestore rules restriction that breaks normal Admin incremental writes: Global Constraints + Task 6 scope check.
- Non-destructive Pages validation and explicit merge approval: Task 6.

Self-review result: every approved spec requirement maps to an implementation task; function names and report fields are consistent across tasks; no unfinished implementation markers remain.