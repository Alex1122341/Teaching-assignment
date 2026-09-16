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
- `bulk-import-controller.js` — lifecycle orchestration for start/resume/import/verify/stale-delete/restore/takeover; depends on an injected store plus injected index rebuild/verify functions.
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
- Create `tests/bulk-import-firestore.test.js`.
- Create `tests/bulk-import-controller.test.js`.
- Create `tests/bulk-import-ui.test.js`.
- Create `tests/maintenance-state.test.js`.
- Create `tests/bulk-import-static-assets.test.js`.
- Modify `tests/security-emulator.test.js`.
- Modify `tests/index-maintenance.test.js`.
- Modify `tests/timetable-selection.test.js`, `tests/timetable-multi-edit-ui.test.js`, `tests/faculty-swap-integration.test.js`, and `tests/faculty-swap-direct-session.test.js` where maintenance write guards change behavior.

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

- [ ] **Step 1: Write the failing core tests**

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

test('analyzeSource reports stale sessions and large-change confirmation',()=>{
  const source=validSource();
  source.sessions.push({id:'s2',course:'302',date:'2026-09-09',assignments:[]});
  const analysis=core.analyzeSource({
    source,
    currentFaculty:[{__id:'100'},{__id:'200'}],
    currentSessions:[{id:'s1'},{id:'old-1'},{id:'old-2'},{id:'old-3'},{id:'old-4'},{id:'old-5'},{id:'old-6'},{id:'old-7'},{id:'old-8'}]
  });
  assert.equal(analysis.sessionExpected,2);
  assert.equal(analysis.staleSessionIds.length,8);
  assert.equal(analysis.requiresTypedImportConfirmation,true);
});

test('diffIdSets compares identity, not only counts',()=>{
  assert.deepEqual(core.diffIdSets(['A','B','C'],['A','B','D']),{missing:['C'],unexpected:['D']});
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/bulk-import-core.test.js`

Expected: FAIL because `bulk-import-core.js` does not exist.

- [ ] **Step 3: Implement the core module**

Use UMD/CommonJS compatibility matching existing shared modules. Implement:

```js
const SOURCE_SCHEMA='ucvm-all-faculty-summaries-v8-synced-2026-27';
const FACULTY_BATCH_SIZE=350,SESSION_BATCH_SIZE=300,STALE_BATCH_SIZE=350;
const PHASES=Object.freeze({
  APPLYING_FACULTY:'APPLYING_FACULTY',APPLYING_SESSIONS:'APPLYING_SESSIONS',VERIFYING_SOURCE:'VERIFYING_SOURCE',
  DELETING_STALE:'DELETING_STALE',REBUILDING_INDEXES:'REBUILDING_INDEXES',VERIFYING_FINAL:'VERIFYING_FINAL',
  RESTORING_FACULTY:'RESTORING_FACULTY',RESTORING_SESSIONS:'RESTORING_SESSIONS',
  REMOVING_POST_BACKUP_SESSIONS:'REMOVING_POST_BACKUP_SESSIONS',RESTORE_VERIFYING:'RESTORE_VERIFYING',RESTORE_FINAL_VERIFY:'RESTORE_FINAL_VERIFY'
});
const TERMINAL_STATUSES=Object.freeze(['COMPLETED','RESTORED']);
async function fingerprintBytes(input){
  const bytes=input instanceof ArrayBuffer?new Uint8Array(input):input;
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
```

`validateSource()` blocks unsupported schema, missing arrays, blank session IDs, duplicate UCIDs, and duplicate session IDs. `analyzeSource()` computes current/source counts, no-source faculty, stale IDs, new IDs, and `requiresTypedImportConfirmation` when deletions exceed 10% or total count change exceeds 20%.

- [ ] **Step 4: Run focused and full tests**

Run:

```bash
node --test tests/bulk-import-core.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

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
- Consumes: `UCVM_BULK_IMPORT_CORE.fingerprintBytes` / CommonJS `require('./bulk-import-core.js')`.
- Produces: `encodeValue(value)` and `decodeValue(value,{Timestamp})`.
- Produces: `buildBackup({projectId,importId,sourceFingerprint,actor,faculty,sessions,summarySettings,createdAt})`.
- Produces: `serializeBackup(backup): string` and `parseAndValidateBackup(text,{projectId,importId,sourceFingerprint}): Promise<object>`.
- Backup schema constant: `ucvm-teaching-recovery-v1`.

- [ ] **Step 1: Write failing backup tests**

```js
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const backup=require('../bulk-import-backup.js');
class FakeTimestamp{constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds}toDate(){return new Date(this.seconds*1000)}}

test('backup codec round-trips timestamps',()=>{
  const encoded=backup.encodeValue({updatedAt:new FakeTimestamp(123,456)});
  assert.deepEqual(encoded,{updatedAt:{__ucvmFirestoreType:'timestamp',seconds:123,nanoseconds:456}});
  const decoded=backup.decodeValue(encoded,{Timestamp:FakeTimestamp});
  assert.equal(decoded.updatedAt.seconds,123);
  assert.equal(decoded.updatedAt.nanoseconds,456);
});

test('backup codec rejects unknown class instances',()=>{
  class Unknown{}
  assert.throws(()=>backup.encodeValue(new Unknown()),/unsupported firestore value/i);
});

test('backup identity must match the interrupted import',async()=>{
  const payload=await backup.buildBackup({projectId:'tester-teaching',importId:'i1',sourceFingerprint:'abc',actor:{uid:'general',name:'General'},faculty:[],sessions:[],summarySettings:null,createdAt:'2026-09-16T20:00:00.000Z'});
  await backup.parseAndValidateBackup(backup.serializeBackup(payload),{projectId:'tester-teaching',importId:'i1',sourceFingerprint:'abc'});
  await assert.rejects(()=>backup.parseAndValidateBackup(backup.serializeBackup(payload),{projectId:'tester-teaching',importId:'i2',sourceFingerprint:'abc'}),/does not belong/i);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/bulk-import-backup.test.js`

Expected: FAIL because `bulk-import-backup.js` does not exist.

- [ ] **Step 3: Implement backup serialization**

Persist:

```js
{
  schemaVersion:'ucvm-teaching-recovery-v1',
  metadata:{backupId,projectId,importId,sourceFingerprint,createdAt,createdBy,createdByName,facultyCount,sessionCount,backupFingerprint},
  faculty:[{id,fields}],
  sessions:[{id,data}],
  settings:{faculty_summary_2026_27:{exists,data}}
}
```

Encode primitives, arrays, plain objects, and Firestore Timestamp-like values. Reject any other class instance before download. Compute `backupFingerprint` from a canonical JSON representation with that field omitted, and recompute/validate it during restore parsing.

- [ ] **Step 4: Run tests**

Run:

```bash
node --test tests/bulk-import-backup.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

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
- Store methods: `loadSystemState`, `loadJob`, `findActiveJob`, `acquireImport`, `commitFacultyBatch`, `commitSessionBatch`, `freezeStaleBatches`, `loadStaleBatch`, `commitStaleDeleteBatch`, `patchJob`, `takeOver`, `completeAndUnlock`, `appendEvent`, `loadCurrentFaculty`, `loadCurrentSessions`, `loadSummarySettings`.

- [ ] **Step 1: Write failing atomicity tests with a recording fake Firestore**

The test helper must expose `collection().doc()`, `batch()`, and `runTransaction()` and record every path included in each commit. Use the real module API:

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const firestoreStore=require('../bulk-import-firestore.js');

function recordingDb(){
  const commits=[];
  const ref=path=>({path,collection:name=>({doc:id=>ref(`${path}/${name}/${id}`)})});
  const db={
    collection:name=>({doc:id=>ref(`${name}/${id}`)}),
    batch:()=>{const paths=[];return{set:r=>paths.push(r.path),update:r=>paths.push(r.path),delete:r=>paths.push(r.path),commit:async()=>commits.push(paths.slice())}},
    runTransaction:async fn=>fn({get:async()=>({exists:false,data:()=>({})}),set:()=>{},update:()=>{}})
  };
  return{db,commits};
}
const fakeFirebase={firestore:{FieldValue:{serverTimestamp:()=>({serverTimestamp:true}),delete:()=>({delete:true})}}};

test('faculty data and checkpoint share one batch commit',async()=>{
  const fake=recordingDb(),store=firestoreStore.create({db:fake.db,firebase:fakeFirebase});
  await store.commitFacultyBatch({importId:'i1',batchIndex:0,total:2,writes:[{id:'f1',patch:{facultySummaryStatus2026_27:'Loaded'}}]});
  assert.deepEqual(fake.commits[0].sort(),['bulk_import_jobs/i1','faculty/f1']);
});

test('terminal status and unlock share one batch commit',async()=>{
  const fake=recordingDb(),store=firestoreStore.create({db:fake.db,firebase:fakeFirebase});
  await store.completeAndUnlock({importId:'i1',status:'COMPLETED'});
  assert.deepEqual(fake.commits[0].sort(),['bulk_import_jobs/i1','settings/system_state']);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/bulk-import-firestore.test.js`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the compat Firestore adapter**

`acquireImport()` must use `db.runTransaction()` and reject a current `teachingDataWriteLocked === true` state before writing the job and `settings/system_state`. `commitFacultyBatch`, `commitSessionBatch`, and `commitStaleDeleteBatch` must write the data rows plus the matching completed-batch counter in one batch commit.

Persist stale IDs as deterministic chunk docs:

```text
bulk_import_jobs/{importId}/stale_batches/000000
bulk_import_jobs/{importId}/stale_batches/000001
```

with `{index,ids,count}`.

`completeAndUnlock()` writes the job terminal state and `{teachingDataWriteLocked:false,maintenanceMode:'none',activeImportId:''}` in one batch.

- [ ] **Step 4: Run tests**

Run:

```bash
node --test tests/bulk-import-firestore.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bulk-import-firestore.js tests/bulk-import-firestore.test.js
git commit -m "feat: add bulk import firestore store"
```

---

### Task 4: Import Lifecycle Controller, Resume, Verification, and Stale Deletion

**Files:**
- Create: `bulk-import-controller.js`
- Create: `tests/bulk-import-controller.test.js`

**Interfaces:**
- Consumes: `core`, `backup`, injected `store`, `actor`, `projectId`.
- Consumes injected functions `rebuildIndexes({faculty,sessions,actor})` and `verifyIndexes({faculty,sessions})` so orchestration tests do not depend directly on Firestore.
- Produces controller methods `preflight`, `createRecoveryBackup`, `start`, `resume`, `loadRecoveryState`, `runUntilTerminal`.
- Calls `onProgress({status,phase,completed,total,message})` after every persisted checkpoint.

- [ ] **Step 1: Write RED failure-injection tests**

Create an in-memory store implementing the Task 3 method names and supporting `failOnceAt` keys. Required tests:

```js
test('session failure keeps lock and never starts stale deletion',async()=>{
  const h=createHarness({failOnceAt:'session:1'});
  await assert.rejects(()=>h.controller.start(h.startArgs),/injected failure/i);
  assert.equal(h.store.job.status,'FAILED');
  assert.equal(h.store.job.failedPhase,'APPLYING_SESSIONS');
  assert.equal(h.store.deletedSessionIds.length,0);
  assert.equal(h.store.system.teachingDataWriteLocked,true);
});

test('resume rejects a different source fingerprint',async()=>{
  const h=createInterruptedHarness();
  await assert.rejects(()=>h.controller.resume({bytes:new TextEncoder().encode('{"different":true}'),text:'{"different":true}'}),/does not match/i);
});

test('stale deletion resumes and completes',async()=>{
  const h=createHarness({failOnceAt:'stale:1'});
  await assert.rejects(()=>h.controller.start(h.startArgs));
  await h.controller.resume(h.originalSourceFile);
  assert.equal(h.store.job.status,'COMPLETED');
  assert.equal(h.store.system.teachingDataWriteLocked,false);
});
```

The helper must include at least two session batches and two stale batches so injected failure occurs after an earlier checkpoint has committed.

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/bulk-import-controller.test.js`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement import phase transitions**

Persist exactly:

```text
APPLYING_FACULTY -> APPLYING_SESSIONS -> VERIFYING_SOURCE -> DELETING_STALE -> REBUILDING_INDEXES -> VERIFYING_FINAL -> COMPLETED
```

On any post-lock exception persist `status:'FAILED'`, `failedPhase`, `lastError`, `failedAt`; never release the lock.

`resume()` loads the active job, hashes the selected raw bytes, requires exact `sourceFingerprint`, re-validates schema, then resumes using the persisted completed-batch counters.

- [ ] **Step 4: Implement source verification before stale deletion**

Verify all incoming session IDs exist. Deep-compare imported `facultySummary2026_27` against source rows for matching current faculty. For current faculty absent from the source, require the summary field to be absent and `facultySummaryStatus2026_27 === 'No source summary'`.

Only after this verification passes may the controller call `freezeStaleBatches()` and enter `DELETING_STALE`.

- [ ] **Step 5: Implement final source and provisional index gates**

After stale deletion:

```js
const finalIds=core.diffIdSets(source.sessions.map(row=>row.id),currentSessions.map(row=>row.id));
if(finalIds.missing.length||finalIds.unexpected.length)throw Error('Final session ID verification failed.');
await rebuildIndexes({faculty:currentFaculty,sessions:currentSessions,actor});
const indexCheck=await verifyIndexes({faculty:currentFaculty,sessions:currentSessions});
if(!indexCheck.ok)throw Error(`Derived index verification failed: ${indexCheck.errors.join('; ')}`);
await store.completeAndUnlock({importId:job.importId,status:'COMPLETED',event:completedEvent});
```

- [ ] **Step 6: Run all import failure injection tests**

Exercise `faculty:1`, `session:1`, `verify-source`, `stale:1`, `index-rebuild`, and `verify-final`.

Run:

```bash
node --test tests/bulk-import-controller.test.js
npm test
```

Expected: PASS; every injected failure keeps the lock active and remains resumable.

- [ ] **Step 7: Commit**

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
- Add `previewRestore(backupText)`, `restore(backupText)`, `resumeRestore(backupText)`, `takeOver(reason)`.
- Add store methods `commitRestoreFacultyBatch`, `commitRestoreSessionBatch`, `commitRestoreDeleteBatch` using the same atomic data+checkpoint rule.

- [ ] **Step 1: Add RED restore tests**

```js
test('restore rejects a backup for another import',async()=>{
  const h=createInterruptedHarness();
  const wrong=await h.makeBackup({importId:'different'});
  await assert.rejects(()=>h.controller.restore(JSON.stringify(wrong)),/does not belong/i);
});

test('interrupted restore resumes to the exact backup session set',async()=>{
  const h=createInterruptedHarness({failOnceAt:'restore-session:1'});
  await assert.rejects(()=>h.controller.restore(h.backupText));
  assert.equal(h.store.system.teachingDataWriteLocked,true);
  await h.controller.resumeRestore(h.backupText);
  assert.deepEqual([...h.store.sessions.keys()].sort(),h.backupSessionIds.slice().sort());
  assert.equal(h.store.job.status,'RESTORED');
  assert.equal(h.store.system.teachingDataWriteLocked,false);
});

test('takeover changes recovery owner but not active import or phase',async()=>{
  const h=createInterruptedHarness();
  const before={id:h.store.system.activeImportId,phase:h.store.job.phase};
  await h.controller.takeOver('Original administrator unavailable');
  assert.equal(h.store.system.activeImportId,before.id);
  assert.equal(h.store.job.phase,before.phase);
  assert.equal(h.store.system.maintenanceOwnerUid,h.actor.uid);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/bulk-import-controller.test.js tests/bulk-import-firestore.test.js`

Expected: new restore tests FAIL.

- [ ] **Step 3: Implement restore lifecycle**

Persist exactly:

```text
RESTORING_FACULTY -> RESTORING_SESSIONS -> REMOVING_POST_BACKUP_SESSIONS -> RESTORE_VERIFYING -> REBUILDING_INDEXES -> RESTORE_FINAL_VERIFY -> RESTORED
```

Restore only captured faculty teaching-summary fields; use `FieldValue.delete()` for fields recorded as absent in the backup. Restore complete session documents by original ID, then delete current sessions absent from backup in checkpointed batches.

- [ ] **Step 4: Implement recovery takeover**

Require a non-blank reason. Atomically update `settings/system_state.maintenanceOwnerUid/Name` plus job takeover metadata while keeping the same `activeImportId` and current phase, then append `BULK_IMPORT_RECOVERY_TAKEN_OVER`.

- [ ] **Step 5: Run restore failure injection tests**

Exercise `restore-faculty:1`, `restore-session:1`, `restore-delete:1`, `restore-verify`, `restore-index-rebuild`, and `restore-final-verify`.

Run:

```bash
node --test tests/bulk-import-controller.test.js tests/bulk-import-firestore.test.js
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add bulk-import-controller.js bulk-import-firestore.js tests/bulk-import-controller.test.js tests/bulk-import-firestore.test.js
git commit -m "feat: add resumable bulk import restore"
```

---

### Task 6: Firestore Maintenance Rules and Security Emulator Coverage

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/security-emulator.test.js`

**Rule invariants:**
- Ready users may read `settings/system_state`.
- Only Owner / ADFA General may create/update import jobs, stale-batch docs, and append events.
- Job events are append-only.
- Locked maintenance denies normal admin session/faculty/change-request/derived-index writes.
- Only the active maintenance owner may perform import/recovery writes while locked.
- Unlock requires `getAfter()` job status `COMPLETED` or `RESTORED`.

- [ ] **Step 1: Add RED emulator tests**

Add `general2:{role:'adfa_general',name:'General Two'}` to the fixture users and tests that seed a locked `settings/system_state` plus non-terminal `bulk_import_jobs/i1` using `withSecurityRulesDisabled`.

Required assertions:

```js
await assertFails(setDoc(doc(regular,'sessions/s1'),{topic:'blocked',updatedBy:'regular',updatedAt:serverTimestamp()},{merge:true}));
await assertFails(setDoc(doc(general2,'sessions/s1'),{topic:'blocked',updatedBy:'general2',updatedAt:serverTimestamp()},{merge:true}));
await assertSucceeds(setDoc(doc(general,'sessions/s1'),{topic:'recovery',updatedBy:'general',updatedAt:serverTimestamp()},{merge:true}));
await assertSucceeds(getDoc(doc(member,'settings/system_state')));
```

Also assert: regular cannot create job/event; general can create event but cannot update/delete it; unlock with non-terminal job fails; one batch that changes job to `COMPLETED` and system state to unlocked succeeds for the active owner.

- [ ] **Step 2: Run emulator test to verify RED**

Run: `npm run test:emulator`

Expected: new maintenance tests FAIL under current rules.

- [ ] **Step 3: Implement rule helpers and collection rules**

Add helper semantics:

```text
teachingMaintenanceActive() = system_state exists and teachingDataWriteLocked == true
teachingWritesOpen() = not teachingMaintenanceActive()
maintenanceOwner() = general() and lock active and maintenanceOwnerUid == request.auth.uid
```

Add explicit rules for `settings/system_state`, `bulk_import_jobs/{importId}`, `events/{eventId}`, and `stale_batches/{batchId}`. Use `getAfter()` for terminal unlock. Apply `teachingWritesOpen() || maintenanceOwner()` to protected teaching-data writes without weakening existing actor/role checks.

- [ ] **Step 4: Run emulator and full tests**

Run:

```bash
npm run test:emulator
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/security-emulator.test.js
git commit -m "security: enforce teaching maintenance lock"
```

---

### Task 7: Provisional Derived-Index Completion Verification

**Files:**
- Modify: `index-maintenance.js`
- Modify: `tests/index-maintenance.test.js`

**Interfaces:**
- Add `verifyDerivedIndexesProvisional(db,faculty,sessions): Promise<{ok:boolean,errors:string[]}>` to `UCVM_INDEX_MAINTENANCE`.

- [ ] **Step 1: Add RED tests to `tests/index-maintenance.test.js`**

Use a fake `db.collection('settings').doc(id).get()` returning supplied snapshots. Assert:

```js
const result=await api.verifyDerivedIndexesProvisional(fakeDb,faculty,sessions);
assert.equal(result.ok,true);
```

Then mutate `schedule_stats.sessionCount` and assert `ok === false`; make either swap doc absent and assert the errors name the missing doc. Metadata `generatedAt`, `generatedBy`, `generatedByName` must not affect canonical comparison.

- [ ] **Step 2: Run focused test to verify RED**

Run: `node --test tests/index-maintenance.test.js`

Expected: the new verifier tests FAIL because the function is not exported.

- [ ] **Step 3: Implement the verifier**

Build expected canonical `faculty_index` and `schedule_stats` via existing `derivedDocuments(faculty,sessions)`. Read all four derived setting docs. Strip generation metadata from the first two before deep comparison. Require both swap docs to exist and have `entries` arrays with equal public/private entry counts.

Return `{ok:errors.length===0,errors}` and export the function.

- [ ] **Step 4: Run tests**

Run:

```bash
node --test tests/index-maintenance.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index-maintenance.js tests/index-maintenance.test.js
git commit -m "feat: verify derived indexes after bulk import"
```

---

### Task 8: Shared Maintenance State and Normal Write Guards

**Files:**
- Create: `maintenance-state.js`
- Create: `tests/maintenance-state.test.js`
- Modify: `index.html`
- Modify: `faculty-admin.html`
- Modify: `timetable.js`
- Modify: `approval-workflow.js`
- Modify: `tests/timetable-selection.test.js`
- Modify: `tests/timetable-multi-edit-ui.test.js`
- Modify: `tests/faculty-swap-integration.test.js`
- Modify: `tests/faculty-swap-direct-session.test.js`

**Interfaces:**
- `UCVM_MAINTENANCE.normalize(data)`.
- `isActive(state)`.
- `normalTeachingWritesAllowed(state)`.
- `watch(db,callback): unsubscribe`.
- `installBanner()` / `renderBanner(state,{isAdmin})`.
- `guardNormalWrite(state,{toast}): boolean`.

- [ ] **Step 1: Write RED unit tests**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const maintenance=require('../maintenance-state.js');

test('missing system state is unlocked',()=>assert.equal(maintenance.isActive(maintenance.normalize(null)),false));
test('locked maintenance blocks normal teaching writes',()=>{
  const state=maintenance.normalize({teachingDataWriteLocked:true,maintenanceMode:'bulk_import',activeImportId:'i1'});
  assert.equal(maintenance.normalTeachingWritesAllowed(state),false);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/maintenance-state.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement watcher and banner**

Load `maintenance-state.js` before `timetable.js`/`approval-workflow.js` in `index.html`, and before `faculty-admin.js` in `faculty-admin.html`. Missing `settings/system_state` normalizes to unlocked.

Banner text is exactly:

`Teaching Data Maintenance in Progress. Teaching and faculty-data editing is temporarily unavailable. Viewing remains available.`

- [ ] **Step 4: Guard timetable mutations**

Keep module-level `maintenanceState` and call:

```js
function teachingWriteAvailable(){return window.UCVM_MAINTENANCE.guardNormalWrite(maintenanceState,{toast})}
```

before admin faculty swap, multi-session save, bulk session create, single create/update, and delete.

- [ ] **Step 5: Guard change-request writes**

In `approval-workflow.js`, block request create, approval/apply, and rejection/update while maintenance is active. Reads remain available. AFC workflow remains unchanged unless it reaches a session mutation path.

- [ ] **Step 6: Update behavior tests and run verification**

Add locked-state assertions to the four listed tests so each affected mutation path returns before Firestore commit. Then run:

```bash
node --test tests/maintenance-state.test.js tests/timetable-selection.test.js tests/timetable-multi-edit-ui.test.js tests/faculty-swap-integration.test.js tests/faculty-swap-direct-session.test.js
npm test
npm run test:emulator
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add maintenance-state.js tests/maintenance-state.test.js index.html faculty-admin.html timetable.js approval-workflow.js tests/timetable-selection.test.js tests/timetable-multi-edit-ui.test.js tests/faculty-swap-integration.test.js tests/faculty-swap-direct-session.test.js
git commit -m "feat: block normal teaching edits during maintenance"
```

---

### Task 9: Faculty Dashboard Bulk Import / Recovery UI

**Files:**
- Create: `bulk-import-ui.js`
- Create: `tests/bulk-import-ui.test.js`
- Modify: `faculty-admin.html`
- Modify: `faculty-admin.css`
- Modify: `faculty-admin.js`

**Interfaces:**
- `UCVM_BULK_IMPORT_UI.create({controller,actor,getFaculty,getSessions,reloadAdminDataset,toast})`.
- UI methods `initialize`, `handleSourceFile`, `handleBackupFile`, `renderRecovery`, `destroy`.

- [ ] **Step 1: Write RED UI tests**

Use a fake controller with counters and a minimal DOM fixture containing `bulk-import-card`, `summary-import-file`, and `recovery-backup-file`.

```js
test('hard preflight failure never starts an import',async()=>{
  const fake=createUiHarness({preflight:{errors:['Duplicate session ID'],warnings:[]}});
  await fake.ui.handleSourceFile(fake.sourceFile);
  assert.equal(fake.controllerCalls.start,0);
  assert.match(fake.card.textContent,/IMPORT BLOCKED/);
});

test('incomplete job renders Resume and Restore instead of new import',async()=>{
  const fake=createUiHarness({recovery:{job:{status:'FAILED',phase:'APPLYING_SESSIONS'},state:{teachingDataWriteLocked:true}}});
  await fake.ui.initialize();
  assert.match(fake.card.textContent,/Resume Import/);
  assert.match(fake.card.textContent,/Restore Recovery Backup/);
  assert.doesNotMatch(fake.card.textContent,/Select New Import File/);
});
```

Add matching tests that typed `IMPORT` is required for large changes, backup checkbox gates Start, typed `RESTORE` gates restore, and blank takeover reason is rejected.

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/bulk-import-ui.test.js`

Expected: FAIL because the UI module does not exist.

- [ ] **Step 3: Add synchronization card markup and script order**

In `faculty-admin.html` add:

```html
<div id="bulk-import-card" class="bulk-import-card" data-general-only></div>
<input type="file" id="summary-import-file" data-general-only accept="application/json,.json" class="hidden">
<input type="file" id="recovery-backup-file" data-general-only accept="application/json,.json" class="hidden">
```

Load `bulk-import-core.js`, `bulk-import-backup.js`, `bulk-import-firestore.js`, `bulk-import-controller.js`, and `bulk-import-ui.js` before `faculty-admin.js`.

- [ ] **Step 4: Replace the current destructive `importSummaryJson()` body**

After admin auth, construct store/controller/UI. Pass controller index functions as wrappers:

```js
rebuildIndexes:({faculty,sessions,actor})=>UCVM_INDEX_MAINTENANCE.writeDerivedIndexes(db,faculty,sessions,actor),
verifyIndexes:({faculty,sessions})=>UCVM_INDEX_MAINTENANCE.verifyDerivedIndexesProvisional(db,faculty,sessions)
```

`summary-import-file.onchange` delegates to `bulkImportUi.handleSourceFile(file)` and `recovery-backup-file.onchange` delegates to `handleBackupFile(file)`.

- [ ] **Step 5: Implement healthy/preflight/recovery rendering**

Healthy card shows last completed import date/source and Select New Import File. Preflight shows source counts, current counts, creates/updates/stale deletes, warnings, and hard failures. Large changes require typed `IMPORT`. After backup generation trigger filename `UCVM-pre-import-backup-YYYY-MM-DD-HHmm.json`; Start stays disabled until `I have saved the recovery backup.` is checked. Failed/incomplete jobs show progress/error plus Resume, Restore, and Take Over Recovery when authorized.

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/bulk-import-ui.test.js
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add bulk-import-ui.js tests/bulk-import-ui.test.js faculty-admin.html faculty-admin.css faculty-admin.js
git commit -m "feat: add bulk import recovery dashboard"
```

---

### Task 10: Static Bundle, Setup Documentation, and Completion Gate

**Files:**
- Modify: `tools/static-assets.json`
- Create: `tests/bulk-import-static-assets.test.js`
- Modify: `SETUP.md`

- [ ] **Step 1: Write RED static-asset test**

```js
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const assets=require('../tools/static-assets.json');
test('bulk import recovery modules ship in the shared bundle',()=>{
  for(const file of ['bulk-import-core.js','bulk-import-backup.js','bulk-import-firestore.js','bulk-import-controller.js','bulk-import-ui.js','maintenance-state.js'])assert.ok(assets.includes(file),`${file} missing from static assets`);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/bulk-import-static-assets.test.js`

Expected: FAIL until assets are added.

- [ ] **Step 3: Update static assets and SETUP**

Add all six modules to `tools/static-assets.json`. Document backup storage responsibility, Resume using original source, Restore using matching backup, takeover restriction, intentional lock persistence after failure, no force-unlock path, emulator-only destructive testing, and Firestore-rule deployment before relying on production maintenance enforcement.

- [ ] **Step 4: Run the full automated gate**

Run:

```bash
npm test
npm run test:emulator
node tools/build-static.js
```

Expected: all tests PASS and static build exits 0 with the six modules included.

- [ ] **Step 5: Self-review implementation against the spec**

Verify every item is evidenced by code/tests: zero-write preflight; mandatory typed-value-safe backup; transactional lock; atomic data+checkpoint batches; exact raw fingerprint resume; source verification before stale deletion; frozen chunked stale list; exact final ID match; real provisional index verification; resumable restore; audited takeover; terminal+unlock atomicity; UI+rules write blocking; append-only events; no force unlock; Workstream 4 replacement boundary.

- [ ] **Step 6: Commit**

```bash
git add tools/static-assets.json tests/bulk-import-static-assets.test.js SETUP.md
git commit -m "docs: finalize bulk import recovery rollout"
```

- [ ] **Step 7: Open the implementation PR as draft and wait for CI**

Title: `Bulk import: add resumable recovery workflow`

The PR body records RED/GREEN evidence, security-rule changes, recovery semantics, and that destructive failure injection ran only in the emulator.

- [ ] **Step 8: Perform the fixed Pages non-destructive smoke test**

1. Confirm TEST SITE banner.
2. Sign in as ADFA General/Owner.
3. Open Faculty Dashboard > Teaching Summary.
4. Select a known-good source JSON and verify preflight counts/warnings.
5. Stop before Start Import unless a real synchronization is intentionally being performed.
6. Verify timetable/faculty views still load.
7. Verify recovery UI shows Healthy when no active import exists.

Do not inject failures, start a disposable import, restore, or manually manipulate `system_state` on Pages/live Firebase.

- [ ] **Step 9: Merge only after explicit manual approval and verify production**

After approval, merge through the established release flow. Verify post-merge `Test` and Azure Static Web Apps workflows complete successfully. Deploy the reviewed `firestore.rules` separately; do not claim maintenance security is live until that deployment is confirmed.
