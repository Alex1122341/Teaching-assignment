# Safe Bulk Import Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current one-shot teaching-summary/session bulk import with a resumable, backup-protected, maintenance-locked import/restore workflow that never treats a partial write as a successful synchronization.

**Architecture:** Keep the application Spark-compatible and client-only. Split pure import analysis/backup serialization from the Firestore adapter and lifecycle controller, persist import checkpoints under `bulk_import_jobs/{importId}`, expose the active maintenance state from `settings/system_state`, and integrate a small recovery UI into the existing Faculty Dashboard. Normal timetable/faculty write paths consult the shared maintenance state for user-friendly blocking, while Firestore rules remain the security boundary.

**Tech Stack:** Vanilla JavaScript (UMD/browser globals + CommonJS test compatibility), Firebase Auth, Cloud Firestore compat SDK in the browser, Firebase Rules Unit Testing / Firestore+Auth Emulator, Node 22 `node:test`, Web Crypto SHA-256.

**Spec:** `docs/superpowers/specs/2026-09-16-bulk-import-recovery-design.md`

## Global Constraints

- `main` is the only production source of truth; implementation work uses a feature branch and PR.
- Keep the production architecture Firebase Spark-compatible; do not add Cloud Functions or another backend service.
- Only Owner / ADFA General may start, resume, restore, or take over bulk teaching-data synchronization.
- GitHub Pages shares the live Firebase backend; destructive/failure-injection tests run only against the Firebase Emulator.
- The supported source schema remains `ucvm-all-faculty-summaries-v8-synced-2026-27`.
- Preserve the current source batch scales unless a test proves they are unsafe: faculty 350, incoming sessions 300, stale deletes 350.
- Preflight and backup generation must not mutate teaching data.
- Stale sessions may not be deleted until all incoming faculty/session writes verify successfully.
- Every data batch and its checkpoint update must commit atomically in the same Firestore batch.
- Only terminal job states `COMPLETED` or `RESTORED` may release the teaching-data write lock.
- Resume requires the exact original source-file raw-byte SHA-256 fingerprint.
- Restore requires a recovery backup whose fingerprint and intended import fingerprint match the interrupted job.
- Do not silently serialize unsupported Firestore value types; backup generation must fail before import rather than produce a lossy backup.
- Workstream 3 supplies a provisional derived-index completion check; Workstream 4 later replaces it with the full canonical build/diff/repair verifier without changing the lifecycle interface.
- Preserve existing audit, DOE, availability, stale-request, role, and privacy behavior outside the bulk-import/maintenance scope.
- Before presenting an implementation PR for browser review, run `npm test` and `npm run test:emulator` and require both to pass.
- Do not merge the implementation PR until the fixed GitHub Pages test site has been manually checked and explicitly approved.

---

## File Map

### New runtime modules

- `bulk-import-core.js` — pure schema validation, fingerprinting, source analysis, ID-set verification, batch planning, phase/status constants.
- `bulk-import-backup.js` — lossless backup encoding/decoding for supported Firestore values, backup manifest generation, backup validation.
- `bulk-import-controller.js` — lifecycle orchestration for start/resume/import/verify/stale-delete/restore/takeover; depends on an injected store.
- `bulk-import-firestore.js` — Firestore compat adapter implementing atomic lock acquisition, data+checkpoint batches, stale-batch persistence, terminal unlock, and append-only events.
- `bulk-import-ui.js` — Faculty Dashboard preflight/recovery card, file selection, backup download/confirmation, progress, Resume/Restore/Takeover actions.
- `maintenance-state.js` — shared read-only watcher/normalizer for `settings/system_state` and common maintenance banner/normal-write guard.

### Existing runtime files to modify

- `faculty-admin.html` — load the new modules, add synchronization/recovery UI mount and source/backup file inputs.
- `faculty-admin.css` — synchronization/recovery card and progress/status styles.
- `faculty-admin.js` — replace destructive `importSummaryJson()` body with delegation to the new UI/controller; expose current actor/reload callbacks; guard normal faculty-directory writes during maintenance.
- `timetable.js` — initialize maintenance watcher and guard all normal session create/update/delete/swap/multi-edit paths.
- `approval-workflow.js` — block request submission/approval mutations while teaching-data maintenance is active.
- `index-maintenance.js` — add `verifyDerivedIndexesProvisional()` so Workstream 3 has a real completion check.
- `index.html` — load `maintenance-state.js` before timetable/approval mutation code.
- `firestore.rules` — maintenance-state/job/event/stale-batch rules and lock enforcement on protected teaching-data writes.
- `tools/static-assets.json` — include all new browser modules in the shared static bundle.
- `SETUP.md` — document import recovery, manual backup storage responsibility, Resume/Restore, and rule deployment ordering.

### Tests to create/modify

- Create `tests/bulk-import-core.test.js`.
- Create `tests/bulk-import-backup.test.js`.
- Create `tests/bulk-import-controller.test.js`.
- Create `tests/bulk-import-ui.test.js`.
- Create `tests/maintenance-state.test.js`.
- Create `tests/bulk-import-static-assets.test.js`.
- Modify `tests/security-emulator.test.js`.
- Modify existing timetable/approval tests where maintenance write guards change behavior.

---

### Task 1: Pure Source Validation, Fingerprinting, and Import Analysis

**Files:**
- Create: `bulk-import-core.js`
- Create: `tests/bulk-import-core.test.js`

**Interfaces:**
- Produces: `UCVM_BULK_IMPORT_CORE.SOURCE_SCHEMA`.
- Produces: `fingerprintBytes(bytes: Uint8Array|ArrayBuffer): Promise<string>` returning lowercase hex SHA-256.
- Produces: `parseSource(text: string): object`.
- Produces: `validateSource(source: object): {errors:string[], warnings:string[]}`.
- Produces: `analyzeSource({source,currentFaculty,currentSessions}): ImportAnalysis`.
- Produces: `chunkRows(rows,size): Array<Array<any>>`.
- Produces: `diffIdSets(expected,current): {missing:string[],unexpected:string[]}`.
- Produces: constants `PHASES`, `TERMINAL_STATUSES`, `FACULTY_BATCH_SIZE=350`, `SESSION_BATCH_SIZE=300`, `STALE_BATCH_SIZE=350`.

- [ ] **Step 1: Write failing tests for schema validation, duplicates, raw-byte fingerprinting, warnings, and ID-set differences**

```js
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../bulk-import-core.js');

const validSource=()=>({
  schemaVersion:'ucvm-all-faculty-summaries-v8-synced-2026-27',
  sourceWorkbook:'Teaching Assignments.xlsx',
  faculty:[{ucid:'100',displayName:'One'}],
  sessions:[{id:'s1',course:'301',date:'2026-09-08',assignments:[]}]
});

test('validateSource blocks duplicate faculty and session IDs',()=>{
  const source=validSource();
  source.faculty.push({ucid:'100'});
  source.sessions.push({...source.sessions[0]});
  const result=core.validateSource(source);
  assert.match(result.errors.join('\n'),/duplicate faculty/i);
  assert.match(result.errors.join('\n'),/duplicate session/i);
});

test('fingerprintBytes hashes raw bytes, not parsed JSON',async()=>{
  const a=new TextEncoder().encode('{"a":1}');
  const b=new TextEncoder().encode('{ "a": 1 }');
  assert.notEqual(await core.fingerprintBytes(a),await core.fingerprintBytes(b));
});

test('analyzeSource reports creates, updates, stale deletes and large-change warnings',()=>{
  const source=validSource();
  source.sessions.push({id:'s2',course:'302',date:'2026-09-09',assignments:[]});
  const analysis=core.analyzeSource({
    source,
    currentFaculty:[{__id:'100'},{__id:'200'}],
    currentSessions:[{id:'s1',topic:'old'},{id:'old-1'},{id:'old-2'},{id:'old-3'},{id:'old-4'},{id:'old-5'},{id:'old-6'},{id:'old-7'},{id:'old-8'}]
  });
  assert.equal(analysis.sessionExpected,2);
  assert.deepEqual(analysis.staleSessionIds.sort(),['old-1','old-2','old-3','old-4','old-5','old-6','old-7','old-8']);
  assert.equal(analysis.requiresTypedImportConfirmation,true);
});

test('diffIdSets compares identity, not only counts',()=>{
  assert.deepEqual(core.diffIdSets(['A','B','C'],['A','B','D']),{missing:['C'],unexpected:['D']});
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/bulk-import-core.test.js`

Expected: FAIL because `../bulk-import-core.js` does not exist.

- [ ] **Step 3: Implement the UMD core module with deterministic validation and analysis**

Use this public shape:

```js
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UCVM_BULK_IMPORT_CORE=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const SOURCE_SCHEMA='ucvm-all-faculty-summaries-v8-synced-2026-27';
  const FACULTY_BATCH_SIZE=350,SESSION_BATCH_SIZE=300,STALE_BATCH_SIZE=350;
  const PHASES=Object.freeze({
    APPLYING_FACULTY:'APPLYING_FACULTY',
    APPLYING_SESSIONS:'APPLYING_SESSIONS',
    VERIFYING_SOURCE:'VERIFYING_SOURCE',
    DELETING_STALE:'DELETING_STALE',
    REBUILDING_INDEXES:'REBUILDING_INDEXES',
    VERIFYING_FINAL:'VERIFYING_FINAL',
    RESTORING_FACULTY:'RESTORING_FACULTY',
    RESTORING_SESSIONS:'RESTORING_SESSIONS',
    REMOVING_POST_BACKUP_SESSIONS:'REMOVING_POST_BACKUP_SESSIONS',
    RESTORE_VERIFYING:'RESTORE_VERIFYING',
    RESTORE_FINAL_VERIFY:'RESTORE_FINAL_VERIFY'
  });
  const TERMINAL_STATUSES=Object.freeze(['COMPLETED','RESTORED']);
  const text=value=>String(value??'').trim();
  const duplicateValues=values=>{
    const seen=new Set(),dupes=new Set();
    for(const raw of values){const value=text(raw);if(!value)continue;if(seen.has(value))dupes.add(value);seen.add(value)}
    return [...dupes].sort();
  };
  async function fingerprintBytes(input){
    const bytes=input instanceof ArrayBuffer?new Uint8Array(input):input;
    if(!bytes||typeof bytes.byteLength!=='number')throw Error('Source bytes are required.');
    const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  }
  function parseSource(textValue){
    try{return JSON.parse(String(textValue))}catch(error){throw Error(`Invalid JSON: ${error.message}`)}
  }
  function validateSource(source){
    const errors=[],warnings=[];
    if(!source||typeof source!=='object'||Array.isArray(source))return{errors:['Source JSON must be an object.'],warnings};
    if(source.schemaVersion!==SOURCE_SCHEMA)errors.push(`Unsupported schema: ${text(source.schemaVersion)||'(blank)'}.`);
    if(!Array.isArray(source.faculty))errors.push('Source faculty must be an array.');
    if(!Array.isArray(source.sessions))errors.push('Source sessions must be an array.');
    if(errors.length)return{errors,warnings};
    const facultyIds=source.faculty.map(row=>text(row?.ucid));
    const sessionIds=source.sessions.map(row=>text(row?.id));
    const missingSessionIds=sessionIds.filter(id=>!id).length;
    if(missingSessionIds)errors.push(`${missingSessionIds} session record(s) are missing a stable ID.`);
    const duplicateFaculty=duplicateValues(facultyIds);
    const duplicateSessions=duplicateValues(sessionIds);
    if(duplicateFaculty.length)errors.push(`Duplicate faculty IDs: ${duplicateFaculty.join(', ')}.`);
    if(duplicateSessions.length)errors.push(`Duplicate session IDs: ${duplicateSessions.join(', ')}.`);
    return{errors,warnings};
  }
  function diffIdSets(expected,current){
    const expectedSet=new Set(expected.map(text).filter(Boolean)),currentSet=new Set(current.map(text).filter(Boolean));
    return{
      missing:[...expectedSet].filter(id=>!currentSet.has(id)).sort(),
      unexpected:[...currentSet].filter(id=>!expectedSet.has(id)).sort()
    };
  }
  function chunkRows(rows,size){if(!Number.isInteger(size)||size<1)throw Error('Chunk size must be a positive integer.');const out=[];for(let i=0;i<(rows||[]).length;i+=size)out.push(rows.slice(i,i+size));return out}
  function analyzeSource({source,currentFaculty,currentSessions}){
    const validation=validateSource(source);if(validation.errors.length)return{...validation};
    const currentSessionIds=(currentSessions||[]).map(row=>text(row?.id)),incomingIds=source.sessions.map(row=>text(row?.id));
    const currentSet=new Set(currentSessionIds),incomingSet=new Set(incomingIds);
    const staleSessionIds=currentSessionIds.filter(id=>id&&!incomingSet.has(id)).sort();
    const createdSessionIds=incomingIds.filter(id=>!currentSet.has(id)).sort();
    const deletedRatio=currentSessionIds.length?staleSessionIds.length/currentSessionIds.length:0;
    const countDeltaRatio=currentSessionIds.length?Math.abs(incomingIds.length-currentSessionIds.length)/currentSessionIds.length:0;
    const sourceFacultyIds=new Set(source.faculty.map(row=>text(row?.ucid)).filter(Boolean));
    const noSourceFacultyIds=(currentFaculty||[]).map(row=>text(row?.__id||row?.ucid)).filter(id=>id&&!sourceFacultyIds.has(id));
    const warnings=[...validation.warnings];
    if(noSourceFacultyIds.length)warnings.push(`${noSourceFacultyIds.length} current faculty record(s) have no source summary.`);
    if(staleSessionIds.length)warnings.push(`${staleSessionIds.length} existing session(s) will be removed after verification.`);
    return{
      errors:[],warnings,
      facultyExpected:sourceFacultyIds.size,
      sessionExpected:incomingIds.length,
      staleSessionIds,createdSessionIds,noSourceFacultyIds,
      requiresTypedImportConfirmation:deletedRatio>0.10||countDeltaRatio>0.20,
      facultyBatches:chunkRows(currentFaculty||[],FACULTY_BATCH_SIZE),
      sessionBatches:chunkRows(source.sessions,SESSION_BATCH_SIZE),
      staleBatches:chunkRows(staleSessionIds,STALE_BATCH_SIZE)
    };
  }
  return{SOURCE_SCHEMA,FACULTY_BATCH_SIZE,SESSION_BATCH_SIZE,STALE_BATCH_SIZE,PHASES,TERMINAL_STATUSES,fingerprintBytes,parseSource,validateSource,analyzeSource,chunkRows,diffIdSets};
});
```

- [ ] **Step 4: Run focused tests and the existing suite**

Run:

```bash
node --test tests/bulk-import-core.test.js
npm test
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add bulk-import-core.js tests/bulk-import-core.test.js
git commit -m "feat: add bulk import source analysis"
```

---

### Task 2: Lossless Recovery Backup Codec and Manifest

**Files:**
- Create: `bulk-import-backup.js`
- Create: `tests/bulk-import-backup.test.js`

**Interfaces:**
- Consumes: `UCVM_BULK_IMPORT_CORE.fingerprintBytes`.
- Produces: `encodeValue(value)` and `decodeValue(value,{Timestamp})`.
- Produces: `buildBackup({projectId,importId,sourceFingerprint,actor,faculty,sessions,summarySettings,createdAt})`.
- Produces: `serializeBackup(backup): string` and `parseAndValidateBackup(text,{projectId,importId,sourceFingerprint}): object`.
- Backup schema constant: `ucvm-teaching-recovery-v1`.

- [ ] **Step 1: Write failing tests for Timestamp preservation, unsupported values, and backup identity**

```js
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const backup=require('../bulk-import-backup.js');

class FakeTimestamp{constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds}toDate(){return new Date(this.seconds*1000)}}

test('backup codec round-trips Firestore timestamps',()=>{
  const encoded=backup.encodeValue({updatedAt:new FakeTimestamp(123,456)});
  assert.deepEqual(encoded,{updatedAt:{__ucvmFirestoreType:'timestamp',seconds:123,nanoseconds:456}});
  const decoded=backup.decodeValue(encoded,{Timestamp:FakeTimestamp});
  assert.equal(decoded.updatedAt.seconds,123);
  assert.equal(decoded.updatedAt.nanoseconds,456);
});

test('backup codec rejects unknown class instances instead of stringifying them',()=>{
  class Unknown{}
  assert.throws(()=>backup.encodeValue(new Unknown()),/unsupported firestore value/i);
});

test('validated backup must belong to the interrupted import',async()=>{
  const payload=await backup.buildBackup({
    projectId:'tester-teaching',importId:'imp-1',sourceFingerprint:'source-abc',
    actor:{uid:'general',name:'General'},faculty:[],sessions:[],summarySettings:null,createdAt:'2026-09-16T20:00:00.000Z'
  });
  const parsed=await backup.parseAndValidateBackup(backup.serializeBackup(payload),{projectId:'tester-teaching',importId:'imp-1',sourceFingerprint:'source-abc'});
  assert.equal(parsed.metadata.importId,'imp-1');
  await assert.rejects(()=>backup.parseAndValidateBackup(backup.serializeBackup(payload),{projectId:'tester-teaching',importId:'imp-2',sourceFingerprint:'source-abc'}),/does not belong/i);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/bulk-import-backup.test.js`

Expected: FAIL because the backup module does not exist.

- [ ] **Step 3: Implement tagged Timestamp encoding and deterministic backup fingerprinting**

Use the exact persisted shape:

```js
{
  schemaVersion:'ucvm-teaching-recovery-v1',
  metadata:{
    backupId:'...',projectId:'tester-teaching',importId:'...',sourceFingerprint:'...',
    createdAt:'2026-09-16T20:00:00.000Z',createdBy:'uid',createdByName:'name',
    facultyCount:118,sessionCount:2391,backupFingerprint:'...'
  },
  faculty:[{id:'123',fields:{facultySummary2026_27:...,facultySummaryStatus2026_27:...}}],
  sessions:[{id:'session-id',data:{...}}],
  settings:{faculty_summary_2026_27:{exists:true,data:{...}}}
}
```

Encode only primitives, arrays, plain objects, and objects with numeric `seconds`/`nanoseconds` plus `toDate()` as timestamps. Throw before download for any other class instance.

Compute `backupFingerprint` over a canonical JSON string of the payload with `metadata.backupFingerprint` temporarily omitted. `parseAndValidateBackup()` recomputes the fingerprint and rejects any mismatch.

- [ ] **Step 4: Run backup tests and the full unit suite**

Run:

```bash
node --test tests/bulk-import-backup.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add bulk-import-backup.js tests/bulk-import-backup.test.js
git commit -m "feat: add recovery backup codec"
```

---

### Task 3: Firestore Import Store and Atomic Maintenance Lock

**Files:**
- Create: `bulk-import-firestore.js`
- Create: `tests/bulk-import-firestore.test.js`

**Interfaces:**
- Produces: `UCVM_BULK_IMPORT_FIRESTORE.create({db,firebase})`.
- Store methods consumed by the controller:
  - `loadSystemState()`.
  - `loadJob(importId)`.
  - `findActiveJob()`.
  - `acquireImport({job,state,event})`.
  - `commitFacultyBatch({importId,batchIndex,total,writes,event})`.
  - `commitSessionBatch({importId,batchIndex,total,writes,event})`.
  - `freezeStaleBatches({importId,batches,event})`.
  - `loadStaleBatch(importId,batchIndex)`.
  - `commitStaleDeleteBatch({importId,batchIndex,total,ids,event})`.
  - `patchJob(importId,patch,event)`.
  - `takeOver({importId,actor,reason,event})`.
  - `completeAndUnlock({importId,status,event})` where status is `COMPLETED` or `RESTORED`.
  - `appendEvent(importId,event)`.

- [ ] **Step 1: Write failing tests using a minimal fake Firestore that records transaction/batch operations**

The tests must assert operation grouping, not source-code strings. A successful `commitFacultyBatch()` must record faculty document writes and the corresponding `facultyBatchCompleted` checkpoint in the same fake batch commit. `completeAndUnlock()` must record terminal job status and `settings/system_state` unlock in the same batch.

```js
test('faculty data writes and checkpoint share one commit',async()=>{
  const fake=createFakeFirestore();
  const store=createStore(fake.db,fake.firebase);
  await store.commitFacultyBatch({importId:'i1',batchIndex:0,total:2,writes:[{id:'f1',patch:{facultySummaryStatus2026_27:'Loaded'}}]});
  assert.equal(fake.commits.length,1);
  assert.deepEqual(fake.commits[0].paths.sort(),['bulk_import_jobs/i1','faculty/f1']);
});

test('terminal job update and unlock share one commit',async()=>{
  const fake=createFakeFirestore();
  const store=createStore(fake.db,fake.firebase);
  await store.completeAndUnlock({importId:'i1',status:'COMPLETED'});
  assert.equal(fake.commits.length,1);
  assert.deepEqual(fake.commits[0].paths.sort(),['bulk_import_jobs/i1','settings/system_state']);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/bulk-import-firestore.test.js`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the compat Firestore adapter**

`acquireImport()` must use `db.runTransaction()` and reject an already-active lock before writing either the job or `settings/system_state`:

```js
async function acquireImport({job,state,event}){
  const systemRef=db.collection('settings').doc('system_state');
  const jobRef=db.collection('bulk_import_jobs').doc(job.importId);
  await db.runTransaction(async tx=>{
    const systemSnap=await tx.get(systemRef),current=systemSnap.exists?systemSnap.data():{};
    if(current.teachingDataWriteLocked===true)throw Error(`Teaching data maintenance is already active (${current.activeImportId||'unknown import'}).`);
    tx.set(jobRef,job);
    tx.set(systemRef,state,{merge:true});
  });
  if(event)await appendEvent(job.importId,event);
}
```

For `commitFacultyBatch`, `commitSessionBatch`, and `commitStaleDeleteBatch`, write the data rows and checkpoint patch into one `db.batch()` before `commit()`.

Persist stale IDs as deterministic chunk docs `bulk_import_jobs/{importId}/stale_batches/{String(index).padStart(6,'0')}` with `{index,ids,count}`. Never keep an unbounded stale list on the job document.

- [ ] **Step 4: Run adapter tests and the full unit suite**

Run:

```bash
node --test tests/bulk-import-firestore.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add bulk-import-firestore.js tests/bulk-import-firestore.test.js
git commit -m "feat: add bulk import firestore store"
```

---

### Task 4: Import Lifecycle Controller, Resume, Source Verification, and Stale Deletion

**Files:**
- Create: `bulk-import-controller.js`
- Create: `tests/bulk-import-controller.test.js`

**Interfaces:**
- Consumes: `core`, `backup`, injected `store`, injected `indexMaintenance`.
- Produces: `UCVM_BULK_IMPORT_CONTROLLER.create(options)` with methods:
  - `preflight({bytes,text,currentFaculty,currentSessions})`.
  - `createRecoveryBackup({preflight,currentFaculty,currentSessions,summarySettings})`.
  - `start({preflight,backupManifest})`.
  - `resume({bytes,text})`.
  - `loadRecoveryState()`.
  - `runUntilTerminal(source)`.
- Controller returns progress snapshots `{status,phase,completed,total,message}` through injected `onProgress(snapshot)`.

- [ ] **Step 1: Write failure-injection tests before implementation**

Create an in-memory store implementing the Task 3 interface and an option `failOnceAt` keyed by operation name/batch index.

Required RED tests:

```js
test('session failure leaves job FAILED and does not delete stale sessions',async()=>{
  const harness=createHarness({failOnceAt:'session:1'});
  await assert.rejects(()=>harness.controller.start(harness.startArgs),/injected failure/i);
  assert.equal(harness.store.job.status,'FAILED');
  assert.equal(harness.store.job.failedPhase,'APPLYING_SESSIONS');
  assert.equal(harness.store.deletedSessionIds.length,0);
  assert.equal(harness.store.system.teachingDataWriteLocked,true);
});

test('resume rejects a different raw source fingerprint',async()=>{
  const harness=createInterruptedHarness();
  await assert.rejects(()=>harness.controller.resume({bytes:new TextEncoder().encode('{"different":true}'),text:'{"different":true}'}),/does not match/i);
});

test('stale delete interruption resumes from the first incomplete stale batch',async()=>{
  const harness=createHarness({failOnceAt:'stale:1'});
  await assert.rejects(()=>harness.controller.start(harness.startArgs));
  const before=harness.store.job.staleBatchCompleted;
  await harness.controller.resume(harness.originalSourceFile);
  assert.ok(harness.store.job.staleBatchCompleted>before);
  assert.equal(harness.store.job.status,'COMPLETED');
});
```

- [ ] **Step 2: Run focused controller tests and verify RED**

Run: `node --test tests/bulk-import-controller.test.js`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement start/import/resume phase transitions**

Use these exact phase rules:

```text
APPLYING_FACULTY -> APPLYING_SESSIONS -> VERIFYING_SOURCE -> DELETING_STALE -> REBUILDING_INDEXES -> VERIFYING_FINAL -> COMPLETED
```

At the beginning of each mutating phase, persist the phase on the job. On any exception after lock acquisition, persist:

```js
{
  status:'FAILED',
  failedPhase:currentPhase,
  lastError:String(error?.message||error),
  failedAt:serverTimestamp
}
```

and keep the maintenance lock set.

`resume()` must:

1. load the active job;
2. fingerprint the selected raw bytes;
3. reject when fingerprint differs from `job.sourceFingerprint`;
4. re-validate the source schema;
5. continue from `job.failedPhase || job.phase` using persisted batch counters.

- [ ] **Step 4: Implement source verification before stale deletion**

Add pure comparison helpers inside the controller or core tests so verification checks actual IDs and import-controlled data, not counts only.

Before stale deletion, read the current canonical source state through store methods and require:

```js
const ids=core.diffIdSets(source.sessions.map(s=>s.id),currentSessions.map(s=>s.id));
if(ids.missing.length)throw Error(`Source verification failed: ${ids.missing.length} incoming session(s) are missing.`);
```

For each source faculty UCID that exists in the current faculty directory, deep-compare the imported `facultySummary2026_27` with the source row. For faculty not present in the source, require the summary field to be absent and `facultySummaryStatus2026_27 === 'No source summary'`.

Only after verification passes may the controller compute/freeze stale batches and enter `DELETING_STALE`.

- [ ] **Step 5: Implement final ID-set verification and provisional index gate**

After stale deletion, require both:

```js
missing.length===0
unexpected.length===0
```

Then call:

```js
await indexMaintenance.writeDerivedIndexes(dbFaculty,dbSessions,actor);
const indexCheck=await indexMaintenance.verifyDerivedIndexesProvisional(db,dbFaculty,dbSessions);
if(!indexCheck.ok)throw Error(`Derived index verification failed: ${indexCheck.errors.join('; ')}`);
```

Only then call `store.completeAndUnlock({importId,status:'COMPLETED',event})`.

- [ ] **Step 6: Run controller tests including every failure injection point**

Required injected failures: `faculty:1`, `session:1`, `verify-source`, `stale:1`, `index-rebuild`, `verify-final`.

Run:

```bash
node --test tests/bulk-import-controller.test.js
npm test
```

Expected: PASS; every failure leaves the lock active and the job resumable.

- [ ] **Step 7: Commit Task 4**

```bash
git add bulk-import-controller.js tests/bulk-import-controller.test.js
git commit -m "feat: add resumable bulk import controller"
```

---

### Task 5: Resumable Restore and Recovery Takeover

**Files:**
- Modify: `bulk-import-controller.js`
- Modify: `bulk-import-firestore.js`
- Modify: `tests/bulk-import-controller.test.js`
- Modify: `tests/bulk-import-firestore.test.js`

**Interfaces:**
- Add controller methods `previewRestore(backupText)`, `restore(backupText)`, `resumeRestore(backupText)`, `takeOver(reason)`.
- Add store methods `commitRestoreFacultyBatch`, `commitRestoreSessionBatch`, `commitRestoreDeleteBatch` reusing the same atomic data+checkpoint rule as import batches.

- [ ] **Step 1: Add RED tests for wrong backup, interrupted restore, post-backup session removal, and takeover**

```js
test('restore rejects a backup from another import',async()=>{
  const harness=createInterruptedHarness();
  const wrong=await harness.makeBackup({importId:'different-import'});
  await assert.rejects(()=>harness.controller.restore(JSON.stringify(wrong)),/does not belong/i);
});

test('interrupted restore is resumable and ends at exact backup session ID set',async()=>{
  const harness=createInterruptedHarness({failOnceAt:'restore-session:1'});
  await assert.rejects(()=>harness.controller.restore(harness.backupText));
  assert.equal(harness.store.system.teachingDataWriteLocked,true);
  await harness.controller.resumeRestore(harness.backupText);
  assert.deepEqual([...harness.store.sessions.keys()].sort(),harness.backupSessionIds.sort());
  assert.equal(harness.store.job.status,'RESTORED');
  assert.equal(harness.store.system.teachingDataWriteLocked,false);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/bulk-import-controller.test.js tests/bulk-import-firestore.test.js`

Expected: new restore tests FAIL.

- [ ] **Step 3: Implement restore lifecycle exactly**

```text
RESTORING_FACULTY -> RESTORING_SESSIONS -> REMOVING_POST_BACKUP_SESSIONS -> RESTORE_VERIFYING -> REBUILDING_INDEXES -> RESTORE_FINAL_VERIFY -> RESTORED
```

Faculty restore writes only the teaching-summary fields captured in the backup. When a backed-up field did not exist, restore with `firebase.firestore.FieldValue.delete()` rather than leaving an import-created value behind.

Session restore writes complete decoded backup session documents by original document ID. After all backup sessions are restored, compute current session IDs not present in the backup and remove them in checkpointed delete batches.

- [ ] **Step 4: Implement recovery takeover transaction**

`takeOver(reason)` requires a non-blank reason and calls store `takeOver()` to atomically change `settings/system_state.maintenanceOwnerUid/Name` and job owner metadata while keeping `activeImportId`, lock, and current phase unchanged. Append `BULK_IMPORT_RECOVERY_TAKEN_OVER` after the transaction.

- [ ] **Step 5: Add restore failure injection and run all controller tests**

Required injected failures: `restore-faculty:1`, `restore-session:1`, `restore-delete:1`, `restore-verify`, `restore-index-rebuild`, `restore-final-verify`.

Run:

```bash
node --test tests/bulk-import-controller.test.js tests/bulk-import-firestore.test.js
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add bulk-import-controller.js bulk-import-firestore.js tests/bulk-import-controller.test.js tests/bulk-import-firestore.test.js
git commit -m "feat: add resumable bulk import restore"
```

---

### Task 6: Firestore Maintenance Rules and Security Emulator Coverage

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/security-emulator.test.js`

**Interfaces / rule invariants:**
- Ready users may read `settings/system_state`.
- Only Owner / ADFA General may create/update `bulk_import_jobs`, stale-batch docs, and append events.
- Job events are append-only.
- When teaching maintenance is active, normal admin session/faculty/change-request/derived-index writes are denied.
- The active maintenance owner may perform recovery/import writes.
- Unlock requires the active job to be terminal (`COMPLETED` or `RESTORED`) in `getAfter()` state.

- [ ] **Step 1: Extend emulator fixtures and write RED security tests**

Add a second general user:

```js
general2:{role:'adfa_general',name:'General Two'}
```

Add tests covering these exact cases:

```js
check('maintenance lock blocks ordinary teaching writes but permits the active recovery owner',async()=>{
  // Seed system_state locked to general and bulk_import_jobs/i1 with non-terminal state using security-rules-disabled context.
  // Assert regular cannot update/delete/create sessions or update faculty.
  // Assert general2 cannot mutate protected teaching data while general owns the lock.
  // Assert general can write the import-controlled session/faculty data needed to recover.
});

check('system_state is readable to ready users but only General can acquire or take over maintenance',async()=>{
  // member getDoc(settings/system_state) succeeds.
  // regular set/update fails.
  // general transaction-shaped state/job writes succeed when valid.
});

check('bulk import job events are append-only',async()=>{
  // general create event succeeds; update/delete fail; regular create fails.
});

check('maintenance lock cannot be released before the active import is terminal',async()=>{
  // non-terminal job + unlock fails.
  // batch update job to COMPLETED plus system_state unlock succeeds for active owner.
});
```

- [ ] **Step 2: Run emulator tests and verify RED**

Run: `npm run test:emulator`

Expected: the new maintenance security tests FAIL under current rules.

- [ ] **Step 3: Implement rule helpers and collection rules**

Add helpers with this behavior:

```text
teachingMaintenanceActive() = system_state exists and teachingDataWriteLocked == true
teachingWritesOpen() = not teachingMaintenanceActive()
maintenanceOwner() = general() and locked and maintenanceOwnerUid == request.auth.uid
```

Change protected paths so normal writes require `teachingWritesOpen()` and maintenance-owner writes remain possible.

Add explicit matches:

```text
/settings/system_state
/bulk_import_jobs/{importId}
/bulk_import_jobs/{importId}/events/{eventId}
/bulk_import_jobs/{importId}/stale_batches/{batchId}
```

Use `getAfter()` when validating terminal unlock so the job terminal status and unlock may commit atomically.

Do not change AFC write permissions except where an AFC action would mutate the timetable session collection through another code path.

- [ ] **Step 4: Run security emulator tests and full test suite**

Run:

```bash
npm run test:emulator
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add firestore.rules tests/security-emulator.test.js
git commit -m "security: enforce teaching maintenance lock"
```

---

### Task 7: Provisional Derived-Index Completion Verification

**Files:**
- Modify: `index-maintenance.js`
- Modify: `tests/index-maintenance.test.js` if present; otherwise create `tests/index-maintenance-verification.test.js`

**Interfaces:**
- Add `verifyDerivedIndexesProvisional(db,faculty,sessions): Promise<{ok:boolean,errors:string[]}>` to `UCVM_INDEX_MAINTENANCE`.

- [ ] **Step 1: Write RED verification tests**

Tests must prove:

- exact canonical `faculty_index` + `schedule_stats` returns `{ok:true}`;
- changed session count returns error;
- missing `faculty_swap_index` or `faculty_swap_map` returns error;
- metadata fields such as `generatedAt`, `generatedBy`, `generatedByName` are ignored when comparing canonical `faculty_index` / `schedule_stats` content.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/index-maintenance-verification.test.js`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement the provisional verifier**

Build expected canonical documents with existing `derivedDocuments(faculty,sessions)`. Read all four derived settings documents. Strip metadata from the two canonical documents and deep-compare their remaining content. Require both swap docs to exist and have array `entries`; require private/public swap entry counts to be equal.

Return errors rather than throwing for mismatches:

```js
return {ok:errors.length===0,errors};
```

Export the function in the module return object.

- [ ] **Step 4: Run focused + full tests**

Run:

```bash
node --test tests/index-maintenance-verification.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add index-maintenance.js tests/index-maintenance-verification.test.js
git commit -m "feat: verify derived indexes after bulk import"
```

---

### Task 8: Shared Maintenance-State Watcher and Normal Write Guards

**Files:**
- Create: `maintenance-state.js`
- Create: `tests/maintenance-state.test.js`
- Modify: `index.html`
- Modify: `faculty-admin.html`
- Modify: `timetable.js`
- Modify: `approval-workflow.js`
- Modify timetable/approval behavior tests that exercise writes.

**Interfaces:**
- Produces: `UCVM_MAINTENANCE.normalize(data)`.
- Produces: `isActive(state)`.
- Produces: `normalTeachingWritesAllowed(state)`.
- Produces: `watch(db,callback): unsubscribe`.
- Produces: `installBanner(): HTMLElement` and `renderBanner(state,{isAdmin})`.
- Produces: `guardNormalWrite(state,{toast}): boolean` returning false and showing the standard maintenance message when locked.

- [ ] **Step 1: Write RED unit tests for default unlocked state and locked message**

```js
test('missing system state is treated as unlocked for backward-compatible rules rollout',()=>{
  assert.equal(maintenance.isActive(maintenance.normalize(null)),false);
});

test('locked maintenance blocks normal teaching writes for every role',()=>{
  const state=maintenance.normalize({teachingDataWriteLocked:true,maintenanceMode:'bulk_import',activeImportId:'i1'});
  assert.equal(maintenance.normalTeachingWritesAllowed(state),false);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/maintenance-state.test.js`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement watcher/banner module and load it before mutation code**

`index.html`: load `maintenance-state.js` before `timetable.js` and `approval-workflow.js`.

`faculty-admin.html`: load it before `faculty-admin.js`.

The watcher reads `settings/system_state`; a missing document normalizes to unlocked.

The banner text is exactly:

`Teaching Data Maintenance in Progress. Teaching and faculty-data editing is temporarily unavailable. Viewing remains available.`

- [ ] **Step 4: Guard every normal timetable mutation path**

In `timetable.js`, keep a module-level `maintenanceState` updated by the watcher and call one shared helper before:

- admin faculty swap batch;
- multi-session selection save;
- bulk session creation;
- single session create/update;
- session delete.

Use:

```js
function teachingWriteAvailable(){
  return window.UCVM_MAINTENANCE.guardNormalWrite(maintenanceState,{toast});
}
```

Return before opening destructive confirmation/commit when false.

- [ ] **Step 5: Guard change-request mutations**

In `approval-workflow.js`, block request create, approval/apply, and rejection/update while maintenance is active. Reads/rendering remain available.

Do not modify AFC request approval logic unless the path applies a timetable session mutation.

- [ ] **Step 6: Run maintenance, timetable, approval, and full tests**

Run:

```bash
node --test tests/maintenance-state.test.js tests/timetable-selection.test.js
npm test
npm run test:emulator
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add maintenance-state.js tests/maintenance-state.test.js index.html faculty-admin.html timetable.js approval-workflow.js tests
git commit -m "feat: block normal teaching edits during maintenance"
```

---

### Task 9: Faculty Dashboard Bulk Import / Recovery UI Integration

**Files:**
- Create: `bulk-import-ui.js`
- Create: `tests/bulk-import-ui.test.js`
- Modify: `faculty-admin.html`
- Modify: `faculty-admin.css`
- Modify: `faculty-admin.js`

**Interfaces:**
- Produces: `UCVM_BULK_IMPORT_UI.create({controller,db,actor,profile,getFaculty,getSessions,reloadAdminDataset,toast})`.
- UI object methods: `initialize()`, `handleSourceFile(file)`, `handleBackupFile(file)`, `renderRecovery(job,state)`, `destroy()`.

- [ ] **Step 1: Write RED UI behavior tests with a minimal fake DOM/controller**

Cover:

- hard preflight error shows `IMPORT BLOCKED` and never calls `start()`;
- large-change preflight requires typed `IMPORT`;
- backup confirmation checkbox gates Start Import;
- incomplete job hides/disables new import and shows Resume/Restore;
- Resume with matching source calls controller `resume()`;
- Restore requires typed `RESTORE`;
- takeover requires non-blank reason.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/bulk-import-ui.test.js`

Expected: FAIL because the UI module does not exist.

- [ ] **Step 3: Add synchronization card markup and styles**

In `faculty-admin.html`, replace the direct summary import button with a mount inside the Teaching Summary panel:

```html
<div id="bulk-import-card" class="bulk-import-card" data-general-only></div>
<input type="file" id="summary-import-file" data-general-only accept="application/json,.json" class="hidden">
<input type="file" id="recovery-backup-file" data-general-only accept="application/json,.json" class="hidden">
```

Keep Workload DOE import separate.

Load scripts before `faculty-admin.js` in dependency order:

```html
<script src="bulk-import-core.js"></script>
<script src="bulk-import-backup.js"></script>
<script src="bulk-import-firestore.js"></script>
<script src="bulk-import-controller.js"></script>
<script src="bulk-import-ui.js"></script>
```

- [ ] **Step 4: Replace current `importSummaryJson()` destructive body with delegation**

In `faculty-admin.js`, remove the old sequence that directly batches faculty, sessions, stale deletes, settings/logs, and reload.

After admin auth is established, construct the Firestore store/controller/UI using current `db`, `firebase`, actor, providers, `reloadAdminDataset`, and existing `toast`.

`summary-import-file.onchange` delegates the selected file to `bulkImportUi.handleSourceFile(file)`; recovery input delegates to `handleBackupFile(file)`.

Expose no new global faculty/private dataset beyond existing admin-only page scope.

- [ ] **Step 5: Implement progress/recovery rendering**

Healthy card shows last completed import source/date and Select New Import File.

Active/failed card shows import ID, source, phase, batch progress, last error, and authorized buttons. `Start New Import` is unavailable until the active job is terminal.

Before starting a new import, the UI:

1. computes preflight;
2. shows impact counts/warnings;
3. requires typed `IMPORT` when `requiresTypedImportConfirmation` is true;
4. calls `controller.createRecoveryBackup()`;
5. triggers JSON download with filename `UCVM-pre-import-backup-YYYY-MM-DD-HHmm.json`;
6. requires checkbox `I have saved the recovery backup.`;
7. starts only after confirmation.

- [ ] **Step 6: Run focused + full tests**

Run:

```bash
node --test tests/bulk-import-ui.test.js
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 9**

```bash
git add bulk-import-ui.js tests/bulk-import-ui.test.js faculty-admin.html faculty-admin.css faculty-admin.js
git commit -m "feat: add bulk import recovery dashboard"
```

---

### Task 10: Static Bundle, Setup Documentation, and End-to-End Completion Gate

**Files:**
- Modify: `tools/static-assets.json`
- Create: `tests/bulk-import-static-assets.test.js`
- Modify: `SETUP.md`
- Review: all Workstream 3 runtime/tests/rules files

**Interfaces:**
- Shared static bundle must ship the new modules to both GitHub Pages and Azure.
- Operational docs must state that Firestore rules must be deployed before relying on the production maintenance lock.

- [ ] **Step 1: Write RED static-asset manifest test**

```js
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const assets=require('../tools/static-assets.json');

test('bulk import recovery browser modules are in the shared static bundle',()=>{
  for(const file of ['bulk-import-core.js','bulk-import-backup.js','bulk-import-firestore.js','bulk-import-controller.js','bulk-import-ui.js','maintenance-state.js']){
    assert.ok(assets.includes(file),`${file} missing from tools/static-assets.json`);
  }
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/bulk-import-static-assets.test.js`

Expected: FAIL until the new assets are added.

- [ ] **Step 3: Update shared asset manifest and setup documentation**

Add the six new JS files to `tools/static-assets.json` in dependency-friendly alphabetical grouping.

Document in `SETUP.md`:

- preflight/backup workflow;
- where the user is responsible for safely storing the downloaded recovery JSON;
- Resume requires the original source file;
- Restore requires the matching recovery backup;
- recovery takeover is Owner / ADFA General only;
- an incomplete import intentionally keeps teaching-data writes locked;
- do not force-unlock; Resume or Restore;
- failure testing belongs in emulator only;
- Firestore rules must be deployed before the production UI version that depends on maintenance enforcement.

- [ ] **Step 4: Run the complete automated verification gate**

Run:

```bash
npm test
npm run test:emulator
node tools/build-static.js
```

Expected:

- all Node tests PASS;
- all emulator tests PASS;
- static build exits 0 and includes all six new modules.

- [ ] **Step 5: Perform implementation self-review against the design spec**

Check every spec requirement against code/tests and record no unresolved gaps before PR creation:

- preflight has zero teaching-data writes;
- backup is mandatory and typed-value-safe;
- lock acquisition is transactional;
- batch checkpoint is atomic with each data batch;
- Resume raw fingerprint is enforced;
- no stale delete before source verification;
- stale list is frozen/chunked;
- final source IDs match exactly;
- provisional index gate is real, not a no-op;
- restore is resumable;
- takeover is audited;
- terminal state + unlock are atomic;
- normal writes are blocked by UI and rules;
- events are append-only;
- no force unlock;
- Workstream 4 can replace provisional index verification through the existing function boundary.

- [ ] **Step 6: Commit Task 10**

```bash
git add tools/static-assets.json tests/bulk-import-static-assets.test.js SETUP.md
git commit -m "docs: finalize bulk import recovery rollout"
```

- [ ] **Step 7: Open implementation PR as draft and wait for CI**

PR title:

`Bulk import: add resumable recovery workflow`

PR body must summarize the RED/GREEN evidence, security-rule changes, recovery semantics, and explicitly state that destructive failure injection ran only in the emulator.

- [ ] **Step 8: GitHub Pages manual smoke test before merge**

Use only non-destructive checks on the fixed Pages test site because it shares live Firebase:

1. confirm TEST SITE banner;
2. sign in as ADFA General/Owner;
3. open Faculty Dashboard > Teaching Summary;
4. select a known-good source JSON and verify preflight counts/warnings appear;
5. stop before Start Import unless a real production synchronization is intentionally being performed;
6. verify existing timetable/faculty views still load;
7. verify recovery UI reports Healthy when no active import exists.

Do not inject failures, start a disposable import, restore, or manipulate `system_state` on Pages/live Firebase.

- [ ] **Step 9: Merge only after explicit manual approval, then verify production workflow**

After approval, merge the PR using the established repository release flow. Verify the post-merge `Test` workflow and Azure Static Web Apps workflow complete successfully. Deploy the reviewed `firestore.rules` separately according to the documented rules-deployment step; do not claim maintenance security is live until that deployment is confirmed.
