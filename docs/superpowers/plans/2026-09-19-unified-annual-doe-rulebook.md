# Unified Annual DOE Rule Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Annual DOE Rule Book database-driven and server-calculated so every faculty DOE view and workflow uses one authoritative Azure API and one Faculty DOE Worksheet.

**Architecture:** Keep the existing static VISTA frontend and reuse the current storage-agnostic DOE formula/engine semantics, but move authoritative execution behind a new Node-based Azure App Service API. Firestore remains the initial policy/assignment repository; new server repositories isolate persistence so Azure SQL can replace Firestore later without changing API contracts. Lookup, DOE List, Timetable, Swap, Approval, and Faculty Role editing consume the same server-side calculation/worksheet results.

**Tech Stack:** Static HTML/CSS/JavaScript frontend, Node 22, Node test runner, Express, Firebase Admin SDK, Firestore/Auth emulator, existing `doe-formula.js` and `doe-policy-engine.js`, GitHub Actions, Azure App Service.

**Spec:** `docs/superpowers/specs/2026-09-19-unified-annual-doe-rulebook-design.md`

## Global Constraints

- No UCVM-specific DOE rate, tier, HICC/VISC value, course-unit value, or reserve threshold may be hard-coded in active frontend production paths.
- The database is authoritative for annual rules, parameters, mappings, references, exceptions, and annual review state.
- Azure App Service is the authoritative calculator; clients submit assignment facts, not final deterministic DOE values.
- New annual data uses explicit `academicYear` fields; do not add new year-suffixed DOE structures such as `managedRoles2027_28`.
- Missing/ambiguous rules, mappings, or required inputs fail closed and never silently become zero.
- Published versions are immutable.
- Research, Service, and PPVM remain approved/source values until a deterministic approved source exists.
- Existing historical DOE and provenance remain readable and must not be silently rewritten.
- Production Firebase/Azure deployment and production data migration require separate explicit authorization.
- PR #45 must remain unmerged until this plan's acceptance gate is reached.

## Review Focus

1. **Missing mapping on an active assignment** — HICC/course or VISC/subject gaps must return `NEEDS_REVIEW` and block publish when the active dataset is affected; Task 4 and Task 6 tests pin this.
2. **Ambiguous rule selection** — two equally eligible rules must return `AMBIGUOUS_RULE`, not choose array order; Task 3 tests pin this.
3. **Client-supplied final DOE** — API must reject or ignore arbitrary `doeCredit` in deterministic assignment requests; Task 3 and Task 9 tests pin this.
4. **Annual roll-forward leakage** — publication/history/calculation records and one-time exceptions must not copy to the new academic year; Task 5 tests pin this.
5. **Historical policy drift** — activating or editing a later-year policy must not alter previously persisted DOE until an explicit recalculation/mutation occurs; Task 7 and Task 11 tests pin this.

---

## File Structure

### New server package

- `server/package.json` — isolated API dependencies and scripts.
- `server/src/app.js` — Express application factory.
- `server/src/server.js` — process entrypoint only.
- `server/src/auth/firebase-auth.js` — verifies Firebase ID tokens and resolves UCVM actor roles.
- `server/src/http/errors.js` — stable API error mapping.
- `server/src/doe/firestore-repository.js` — server Firestore implementation of policy/mapping/worksheet persistence.
- `server/src/doe/calculation-service.js` — authoritative assignment calculation orchestration.
- `server/src/doe/rulebook-service.js` — annual copy/review/validation orchestration.
- `server/src/doe/worksheet-service.js` — faculty annual worksheet construction.
- `server/src/doe/reserve-service.js` — trainee reserve and rolling-average rules from database configuration.
- `server/src/routes/doe-routes.js` — API routes only; no domain logic.
- `server/test/*.test.js` — Node tests for each server unit.
- `server/test/firestore-emulator.test.js` — Admin SDK + emulator integration.

### New frontend modules

- `doe-api-client.js` — authenticated API transport and response normalization.
- `doe-rulebook-admin.js` — Annual DOE Rule Book/mapping/review UI orchestration.
- `doe-worksheet-view.js` — one renderer used by Lookup and DOE List drill-down.

### Existing files modified

- `faculty-admin.html` — load new modules and preserve current VISTA structure.
- `faculty-admin.css` / `doe-policy-admin.css` — reuse current design tokens and extend Rule Book/Worksheet styles.
- `doe-policy-admin.js` — retire direct authoritative Firestore policy writes after API parity.
- `faculty-admin.js` — consume worksheet API; stop local DOE aggregation for active runtime.
- `faculty-admin-enhancements.js` — DOE List consumes worksheet summaries.
- `faculty-account-planner.js` — separate account-role normalization from DOE credit derivation.
- `timetable-selection.js` / `timetable.js` — call API for DOE preview/write result.
- `faculty-swap-safe.js` / `faculty-swap-handoff.js` — use API preview result.
- Approval-related modules under `index.html`/`app.js` path found during Task 9 — replace local projection with API.
- `data-index.js` — derived DOE becomes compatibility/read-model fallback only.
- `index-maintenance.js` — refresh worksheet/read-model references after canonical writes.
- `firestore.rules` — add reference/mapping protections, then deny direct client authoritative policy writes after cutover.
- `tools/static-assets.json` — include new frontend modules.
- `.github/workflows/test.yml` and GitHub Pages test workflow — run root + server test suites on exact PR head.

---

### Task 1: Add the Azure DOE API Skeleton and Authentication Boundary

**Files:**
- Create: `server/package.json`
- Create: `server/src/app.js`
- Create: `server/src/server.js`
- Create: `server/src/auth/firebase-auth.js`
- Create: `server/src/http/errors.js`
- Create: `server/test/app.test.js`
- Modify: root `package.json`

**Interfaces:**
- Consumes: Firebase ID token in `Authorization: Bearer <token>`.
- Produces: `createApp({authProvider, services}) -> Express.Application`; `requireActor(req) -> {uid,name,email,role,facultyId}`; `GET /api/health -> {ok:true,service:'ucvm-doe-api'}`.

- [ ] **Step 1: Write the failing API/authentication tests**

```js
// server/test/app.test.js
const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../src/app.js');

test('health endpoint does not require authentication',async()=>{
  const app=createApp({authProvider:{verify:async()=>{throw Error('should not run')}},services:{}});
  const response=await app.inject({method:'GET',url:'/api/health'});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.json(),{ok:true,service:'ucvm-doe-api'});
});

test('DOE endpoints reject missing bearer token',async()=>{
  const app=createApp({authProvider:{verify:async()=>null},services:{}});
  const response=await app.inject({method:'POST',url:'/api/doe/calculate',payload:{}});
  assert.equal(response.statusCode,401);
  assert.equal(response.json().code,'AUTH_REQUIRED');
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npm --prefix server test -- app.test.js
```

Expected: FAIL because `server/src/app.js` does not exist.

- [ ] **Step 3: Add the minimal server package and app boundary**

```json
// server/package.json
{
  "name":"ucvm-doe-api",
  "private":true,
  "type":"commonjs",
  "scripts":{"test":"node --test test/*.test.js","start":"node src/server.js"},
  "dependencies":{"express":"latest","firebase-admin":"latest"}
}
```

```js
// server/src/app.js
const express=require('express');

function createApp({authProvider,services}){
  const app=express();
  app.use(express.json({limit:'1mb'}));
  app.get('/api/health',(_req,res)=>res.json({ok:true,service:'ucvm-doe-api'}));
  app.use('/api/doe',(req,res,next)=>{
    const header=String(req.headers.authorization||'');
    if(!header.startsWith('Bearer '))return res.status(401).json({code:'AUTH_REQUIRED',message:'Authentication is required.'});
    Promise.resolve(authProvider.verify(header.slice(7))).then(actor=>{
      if(!actor?.uid)return res.status(401).json({code:'AUTH_REQUIRED',message:'Authentication is required.'});
      req.actor=actor;next();
    }).catch(next);
  });
  app.post('/api/doe/calculate',(_req,res)=>res.status(501).json({code:'NOT_IMPLEMENTED'}));
  return app;
}

module.exports={createApp};
```

Add a test-only `app.inject()` helper in `server/src/app.js` or a dedicated test helper using a real ephemeral HTTP listener; do not add a production-only testing dependency.

- [ ] **Step 4: Implement Firebase token/actor resolution**

```js
// server/src/auth/firebase-auth.js
function createFirebaseAuthProvider({adminAuth,firestore}){
  return{
    async verify(idToken){
      const decoded=await adminAuth.verifyIdToken(String(idToken));
      const snap=await firestore.collection('users').doc(decoded.uid).get();
      if(!snap.exists)throw Object.assign(Error('User profile is missing.'),{code:'PROFILE_REQUIRED'});
      const profile=snap.data();
      return{
        uid:decoded.uid,
        email:String(decoded.email||profile.email||'').toLowerCase(),
        name:String(profile.name||profile.displayName||decoded.name||''),
        role:String(profile.role||'').toLowerCase(),
        facultyId:String(profile.facultyId||'')
      };
    }
  };
}
module.exports={createFirebaseAuthProvider};
```

- [ ] **Step 5: Run server tests GREEN**

Run:

```bash
npm --prefix server test
```

Expected: PASS.

- [ ] **Step 6: Wire root CI command without changing production deploy**

Modify root `package.json`:

```json
{
  "scripts":{
    "test":"node --test tests/*.test.js",
    "test:server":"npm --prefix server test",
    "test:all":"npm test && npm run test:server",
    "test:emulator":"firebase emulators:exec --only firestore,auth --project demo-ucvm-access \"node --test tests/*.test.js && npm --prefix server test\""
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add package.json server
git commit -m "feat: add authenticated DOE API skeleton"
```

---

### Task 2: Add Server-Side DOE Repository Contracts, References, and Mappings

**Files:**
- Create: `server/src/doe/firestore-repository.js`
- Create: `server/test/firestore-repository.test.js`
- Modify: `firestore.rules`
- Modify: `tests/doe-policy-security-emulator.test.js`

**Interfaces:**
- Consumes: existing DOE collections and Firestore Admin SDK.
- Produces:
  - `getActivePolicyBundle(academicYear)`
  - `getReference(referenceId)`
  - `listCourseMappings(academicYear)`
  - `listSubjectMappings(academicYear)`
  - `saveDraftReference(reference)`
  - `saveDraftCourseMapping(mapping)`
  - `saveDraftSubjectMapping(mapping)`
  - `getAnnualReviewState(policyVersionId)`

- [ ] **Step 1: Write failing repository contract tests**

```js
test('active policy bundle includes structured references and annual mappings',async()=>{
  const repo=createRepository(fakeDb);
  const bundle=await repo.getActivePolicyBundle('2027-28');
  assert.equal(bundle.version.status,'active');
  assert.deepEqual(bundle.courseMappings,[{
    mappingId:'course-204-2027',
    academicYear:'2027-28',
    courseCode:'VTMD 204',
    unitCount:6,
    referenceId:'wg-6-4-t3'
  }]);
  assert.deepEqual(bundle.subjectMappings,[{
    mappingId:'visc-anatomy-2027',
    academicYear:'2027-28',
    subjectKey:'anatomy',
    curriculumStage:'year_3',
    referenceId:'wg-6-4-t3'
  }]);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm --prefix server test -- firestore-repository.test.js
```

Expected: FAIL with missing repository module/method.

- [ ] **Step 3: Implement the server repository with explicit top-level collections**

Use these collection names exactly:

```js
const COLLECTIONS=Object.freeze({
  policies:'doe_policies',
  versions:'doe_policy_versions',
  rules:'doe_rules',
  selectors:'doe_rule_selectors',
  parameters:'doe_rule_parameters',
  tiers:'doe_rule_tiers',
  inputs:'doe_rule_inputs',
  exceptions:'doe_exceptions',
  references:'doe_reference_sources',
  courseMappings:'doe_course_mappings',
  subjectMappings:'doe_subject_mappings',
  calculations:'doe_calculation_records',
  audit:'doe_audit_log'
});
```

Every mapping row must carry `academicYear`, `policyVersionId`, `referenceId`, `reviewStatus`, `enabled`.

- [ ] **Step 4: Add Firestore rules for client visibility and controlled Draft editing**

Add rules so:

- DOE admins can read references/mappings.
- Direct client writes remain Draft-only during migration.
- Non-admin roles cannot write.
- Active/Archived rows are immutable.
- Reference/mapping documents tied to an Active version cannot be changed.

- [ ] **Step 5: Add emulator security assertions**

```js
await assertFails(
  setDoc(doc(facultyDb,'doe_course_mappings','course-204-2027'),{
    academicYear:'2027-28',policyVersionId:'active-v1',courseCode:'VTMD 204',unitCount:6
  })
);

await assertSucceeds(
  setDoc(doc(regularAdminDb,'doe_course_mappings','course-204-draft'),{
    academicYear:'2027-28',policyVersionId:'draft-v2',courseCode:'VTMD 204',
    unitCount:6,referenceId:'wg-6-4-t3',reviewStatus:'updated',enabled:true
  })
);
```

- [ ] **Step 6: Run focused + emulator tests**

Run:

```bash
npm --prefix server test -- firestore-repository.test.js
npm run test:emulator
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/doe/firestore-repository.js server/test/firestore-repository.test.js firestore.rules tests/doe-policy-security-emulator.test.js
git commit -m "feat: add DOE references and annual mappings"
```

---

### Task 3: Make the Azure API the Authoritative Assignment Calculator

**Files:**
- Create: `server/src/doe/calculation-service.js`
- Create: `server/src/routes/doe-routes.js`
- Create: `server/test/calculation-service.test.js`
- Modify: `server/src/app.js`

**Interfaces:**
- Consumes: `getActivePolicyBundle(academicYear)`, assignment facts.
- Produces:
  - `calculateAssignment({actor,academicYear,facts,persist}) -> DoeCalculationResult`
  - `POST /api/doe/calculate`
  - `POST /api/doe/preview-assignment`

`DoeCalculationResult`:

```js
{
  status:'calculated',
  academicYear:'2027-28',
  policyVersionId:'...',
  ruleId:'...',
  ruleKey:'...',
  resultDoe:12,
  calculationText:'6 units × 2.00%',
  reference:{referenceId,title,section,table,page},
  inputs:{...},
  calculationId:'...' // only on persisted writes
}
```

- [ ] **Step 1: Write failing tests for rule selection, fail-closed behavior, and client DOE rejection**

```js
test('HICC calculation uses mapped units and database rate',async()=>{
  const service=createCalculationService({
    repository:fixtureRepository({
      rule:{ruleKey:'role.hicc.development',calculationMode:'formula',formulaText:'units * rate'},
      rate:2,
      courseMapping:{courseCode:'VTMD 204',unitCount:6}
    })
  });
  const result=await service.calculateAssignment({
    actor:general,
    academicYear:'2027-28',
    facts:{category:'role',roleType:'HICC',courseCode:'VTMD 204'}
  });
  assert.equal(result.resultDoe,12);
});

test('missing HICC course mapping fails closed',async()=>{
  await assert.rejects(
    ()=>service.calculateAssignment({actor:general,academicYear:'2027-28',facts:{category:'role',roleType:'HICC',courseCode:'VTMD 999'}}),
    error=>error.code==='COURSE_MAPPING_REQUIRED'
  );
});

test('equal-priority rule ambiguity is returned as an error',async()=>{
  await assert.rejects(()=>ambiguousService.calculateAssignment(request),error=>error.code==='AMBIGUOUS_RULE');
});

test('client cannot override deterministic result with doeCredit',async()=>{
  const result=await service.calculateAssignment({
    actor:general,
    academicYear:'2027-28',
    facts:{category:'teaching',activityType:'LEC',teachingRole:'Lecture',hours:2,doeCredit:99}
  });
  assert.equal(result.resultDoe,0.6);
  assert.notEqual(result.resultDoe,99);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm --prefix server test -- calculation-service.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement fact enrichment before calling the existing generic engine**

```js
async function enrichFacts(repository,academicYear,facts){
  const next={...facts,academicYear};
  if(['HICC','Course Coordinator','Course Coordinator / HICC'].includes(next.roleType)&&!Number.isFinite(Number(next.units))){
    const mapping=await repository.getCourseMapping(academicYear,next.courseCode);
    if(!mapping)throw apiError('COURSE_MAPPING_REQUIRED','Course/unit mapping is required.');
    next.units=Number(mapping.unitCount);
  }
  if(next.roleType==='VISC'&&!next.subjectKey){
    throw apiError('SUBJECT_MAPPING_REQUIRED','VISC subject mapping is required.');
  }
  return next;
}
```

Use existing `doe-policy-engine.js` via Node `require()`; do not duplicate its formula parser.

- [ ] **Step 4: Persist immutable calculation evidence only on write requests**

Persist:

- policy/rule IDs;
- inputs snapshot;
- parameters snapshot;
- rule snapshot;
- reference snapshot;
- result;
- actor;
- source entity IDs;
- trigger.

- [ ] **Step 5: Add routes and role checks**

```js
router.post('/preview-assignment',async(req,res,next)=>{
  try{
    const result=await service.calculateAssignment({
      actor:req.actor,
      academicYear:req.body.academicYear,
      facts:req.body.facts,
      persist:false
    });
    res.json(result);
  }catch(error){next(error)}
});
```

- [ ] **Step 6: Run tests GREEN**

Run:

```bash
npm --prefix server test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/doe/calculation-service.js server/src/routes/doe-routes.js server/src/app.js server/test/calculation-service.test.js
git commit -m "feat: calculate authoritative DOE in API"
```

---

### Task 4: Complete the Database Rule Model for the Reviewed Workload Guideline

**Files:**
- Create: `server/test/guideline-rules.test.js`
- Modify: `tools/doe-policy-2026-27-seed.json`
- Modify: `doe-policy-engine.js`
- Modify: `tests/doe-policy-engine.test.js`

**Interfaces:**
- Consumes: documented Teaching rules from the approved design/spec.
- Produces: database seed model capable of representing all deterministic rules, with no invented course/unit mappings.

- [ ] **Step 1: Write one RED test per documented rule family**

```js
const cases=[
  ['Lecture',{category:'teaching',activityType:'LEC',teachingRole:'Lecture',hours:2},0.60],
  ['SRL',{category:'teaching',activityType:'SRL',teachingRole:'SRL',hours:2},0.60],
  ['Lab Primary',{category:'teaching',activityType:'LAB',teachingRole:'Lab Primary',hours:2},0.42],
  ['Lab Secondary',{category:'teaching',activityType:'LAB',teachingRole:'Lab Secondary',hours:2},0.38],
  ['Rotation Participant',{category:'role',roleType:'Rotation Participant',weeks:2},5.00],
  ['Graduate Primary',{category:'supervision',traineeType:'graduate',supervisionRole:'primary',trainees:2},6.00],
  ['Graduate Co-supervisor',{category:'supervision',traineeType:'graduate',supervisionRole:'co_supervisor',trainees:2},4.00],
  ['Postdoc',{category:'supervision',traineeType:'postdoc',trainees:2},3.00]
];
for(const [name,context,expected] of cases){
  test(name,()=>assert.equal(engine.calculate(bundle,context).resultDoe,expected));
}
```

Add explicit tier tests:

```js
for(const [units,expected] of [[2,1.75],[3,3.5],[6,7],[10,10],[15,15]]){
  test(`course coordination ${units} units`,()=>assert.equal(calculateCourseCoordinator(units),expected));
}
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/doe-policy-engine.test.js server/test/guideline-rules.test.js
```

Expected: FAIL for unmodeled rule families.

- [ ] **Step 3: Expand the seed with rule categories and structured References**

Add rules for:

- Course Coordination tiered;
- Rotation Participant;
- designated Rotation Coordinator;
- Undergraduate/Intern;
- 4th Year Preceptor;
- Graduate Primary;
- Graduate Co-supervisor;
- Postdoc;
- HICC `units * rate`;
- VISC annual/stage selector;
- New Faculty capped allocation;
- Special Activity capped allocation.

Every enabled rule gets `referenceId` and `sourceReference`.

Do **not** invent VTMD course unit mappings in the seed.

- [ ] **Step 4: Add engine support only where a generic calculation primitive is missing**

If existing `tiered`, `capped`, or `formula` modes already express the rule, use them. Add no UCVM-specific branch such as `if(role==='HICC')`.

- [ ] **Step 5: Run GREEN**

Run:

```bash
node --test tests/doe-policy-engine.test.js server/test/guideline-rules.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/doe-policy-2026-27-seed.json doe-policy-engine.js tests/doe-policy-engine.test.js server/test/guideline-rules.test.js
git commit -m "feat: model complete teaching DOE guideline rules"
```

---

### Task 5: Add Annual Copy, Review Status, and Publication Completeness

**Files:**
- Create: `server/src/doe/rulebook-service.js`
- Create: `server/test/rulebook-service.test.js`
- Modify: `server/src/routes/doe-routes.js`
- Modify: `server/src/doe/firestore-repository.js`

**Interfaces:**
- Produces:
  - `copyAcademicYear({sourceYear,targetYear,actor})`
  - `validateAnnualReview(policyVersionId,dataset)`
  - `POST /api/doe/policy-years/:academicYear/copy-from/:sourceYear`
  - `POST /api/doe/drafts/:policyVersionId/validate`

- [ ] **Step 1: Write RED roll-forward tests**

```js
test('copy year copies configuration but not history or one-time exceptions',async()=>{
  const result=await service.copyAcademicYear({sourceYear:'2026-27',targetYear:'2027-28',actor:general});
  assert.equal(result.version.academicYear,'2027-28');
  assert.equal(result.version.status,'draft');
  assert.ok(result.rules.every(row=>row.reviewStatus==='needs_review'));
  assert.ok(result.mappings.every(row=>row.reviewStatus==='needs_review'));
  assert.equal(result.publications.length,0);
  assert.equal(result.calculationRecords.length,0);
  assert.equal(result.impactRuns.length,0);
  assert.equal(result.exceptions.some(row=>row.recurring!==true),false);
});

test('publish validation blocks active assignments with missing mapping',async()=>{
  const report=await service.validateAnnualReview('draft-2027',{activeFacts:[
    {category:'role',roleType:'HICC',courseCode:'VTMD 999'}
  ]});
  assert.equal(report.valid,false);
  assert.ok(report.errors.some(e=>e.code==='COURSE_MAPPING_REQUIRED'));
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm --prefix server test -- rulebook-service.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement deterministic copy semantics**

Copy only policy configuration rows and explicitly recurring exceptions. Generate new IDs and replace `academicYear` / `policyVersionId`.

- [ ] **Step 4: Implement annual completeness validation**

Require:

- all enabled rules have structured Reference;
- copied items are no longer `needs_review`;
- active HICC/course facts have mappings;
- active VISC facts have mappings;
- no rule ambiguity;
- required inputs declared;
- guideline rule families expected by policy schema exist.

- [ ] **Step 5: Run GREEN**

Run:

```bash
npm --prefix server test -- rulebook-service.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/doe/rulebook-service.js server/src/doe/firestore-repository.js server/src/routes/doe-routes.js server/test/rulebook-service.test.js
git commit -m "feat: add annual DOE roll forward"
```

---

### Task 6: Build the Annual DOE Rule Book UI in the Current VISTA Style

**Files:**
- Create: `doe-api-client.js`
- Create: `doe-rulebook-admin.js`
- Create: `tests/doe-rulebook-admin.test.js`
- Modify: `faculty-admin.html`
- Modify: `faculty-admin.css`
- Modify: `doe-policy-admin.css`
- Modify: `tools/static-assets.json`
- Modify: `tests/runtime-assets.test.js`

**Interfaces:**
- Consumes: server endpoints from Tasks 3 and 5.
- Produces:
  - `UCVM_DOE_API.getPolicyYear(year)`
  - `UCVM_DOE_API.copyPolicyYear(sourceYear,targetYear)`
  - `UCVM_DOE_API.saveRule(...)`
  - `UCVM_DOE_API.saveCourseMapping(...)`
  - `UCVM_DOE_API.saveSubjectMapping(...)`
  - Annual Rule Book tabs matching current Faculty Dashboard visual language.

- [ ] **Step 1: Write RED UI structure tests**

```js
test('DOE Rules uses current VISTA panel/table classes and annual tabs',()=>{
  const html=read('faculty-admin.html');
  assert.match(html,/data-doe-rulebook-tab="rules"/);
  assert.match(html,/data-doe-rulebook-tab="course-mapping"/);
  assert.match(html,/data-doe-rulebook-tab="visc-subjects"/);
  assert.match(html,/data-doe-rulebook-tab="preview"/);
  assert.match(html,/Copy from Previous Year/);
  assert.match(html,/Workload Guidelines/);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/doe-rulebook-admin.test.js tests/runtime-assets.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement authenticated API transport**

```js
async function request(path,{method='GET',body}={}){
  const token=await firebase.auth().currentUser.getIdToken();
  const response=await fetch(`${baseUrl}${path}`,{
    method,
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(Error(payload.message||'DOE API request failed.'),payload);
  return payload;
}
```

- [ ] **Step 4: Implement the approved Rule Book layout using existing CSS tokens**

Required visible sections:

- Rule Book;
- Course Mapping;
- VISC Subjects;
- Preview & Validate;
- History.

Rule groups:

- Assigned Teaching;
- Course Coordination;
- Clinical Rotations;
- Supervision;
- HICC / VISC;
- Reserve Logic;
- Other / Approved Activities.

- [ ] **Step 5: Add structured Reference editor separate from Notes**

Reference fields:

```js
{
  title:'UCVM Workload Guidelines',
  versionDate:'2025-12-23',
  section:'6.4',
  table:'Table 3',
  page:5,
  effectiveDate:'2025-04-01'
}
```

- [ ] **Step 6: Add annual diff/review state UI**

Display prior-year vs draft values and one of:

- Needs Review;
- Confirmed Unchanged;
- Updated;
- New;
- Retired.

- [ ] **Step 7: Run focused tests + static build**

Run:

```bash
node --test tests/doe-rulebook-admin.test.js tests/runtime-assets.test.js
node tools/build-static.js
```

Expected: PASS; static asset manifest includes `doe-api-client.js` and `doe-rulebook-admin.js`.

- [ ] **Step 8: Commit**

```bash
git add doe-api-client.js doe-rulebook-admin.js faculty-admin.html faculty-admin.css doe-policy-admin.css tools/static-assets.json tests/doe-rulebook-admin.test.js tests/runtime-assets.test.js
git commit -m "feat: add annual DOE rule book admin UI"
```

---

### Task 7: Implement Server-Side Trainee Reserve and Faculty DOE Worksheet

**Files:**
- Create: `server/src/doe/reserve-service.js`
- Create: `server/src/doe/worksheet-service.js`
- Create: `server/test/reserve-service.test.js`
- Create: `server/test/worksheet-service.test.js`
- Create: `server/test/guideline-scenarios.test.js`
- Modify: `server/src/routes/doe-routes.js`

**Interfaces:**
- Produces:
  - `applyTeachingReserve({teachingTarget,stream,rawSupervision,assignedTeaching})`
  - `buildFacultyWorksheet({facultyId,academicYear})`
  - `GET /api/doe/faculty/:facultyId/worksheet?academicYear=...`
  - `GET /api/doe/list?academicYear=...`

- [ ] **Step 1: Write RED reserve tests from the reviewed guideline**

```js
test('teaching DOE <=35 begins with equal reserve split',()=>{
  const result=applyTeachingReserve({
    teachingTarget:30,
    stream:'research_teaching',
    rawSupervision:10,
    assignedTeaching:15
  });
  assert.equal(result.initialTraineeReserve,15);
  assert.equal(result.initialAssignedTeachingReserve,15);
  assert.equal(result.appliedSupervision,10);
  assert.equal(result.totalAppliedTeaching,25);
});

test('teaching focused stream caps trainee reserve at 7.5',()=>{
  const result=applyTeachingReserve({
    teachingTarget:80,
    stream:'teaching_focused',
    rawSupervision:3,
    assignedTeaching:46
  });
  assert.equal(result.initialTraineeReserve,7.5);
  assert.equal(result.appliedSupervision,3);
});
```

- [ ] **Step 2: Add Appendix A scenario fixtures**

For Scenario 5, assert the documented components:

```js
test('guideline scenario 5 component calculations are reproducible',async()=>{
  const worksheet=await buildScenario5();
  assert.equal(worksheet.lines.find(x=>x.ruleKey==='role.hicc.development').resultDoe,12);
  assert.equal(worksheet.lines.find(x=>x.ruleKey==='role.rotation.participant').resultDoe,12.5);
  assert.equal(worksheet.lines.find(x=>x.ruleKey==='role.visc.development').resultDoe,5);
  assert.equal(worksheet.lines.find(x=>x.ruleKey==='role.rotation.coordinator').resultDoe,2);
  assert.equal(worksheet.rawSupervisionDoe,3);
  assert.equal(worksheet.assignedTeachingReserveAfterSupervision,46);
});
```

- [ ] **Step 3: Run RED**

Run:

```bash
npm --prefix server test -- reserve-service.test.js worksheet-service.test.js guideline-scenarios.test.js
```

Expected: FAIL.

- [ ] **Step 4: Implement reserve service using database-provided reserve parameters**

Do not hard-code thresholds in the function. Pass:

```js
{
  splitThreshold:35,
  highTeachingTraineeCeiling:15,
  teachingFocusedTraineeCeiling:7.5,
  rollingAverageYears:3
}
```

from the Active policy bundle.

- [ ] **Step 5: Implement worksheet line contract**

Every line returns:

```js
{
  lineId:'...',
  category:'scheduled_teaching',
  sourceEntityType:'session_assignment',
  sourceEntityId:'...',
  label:'VTMD 505 Lab Primary',
  quantity:3,
  quantityUnit:'hours',
  calculationText:'3 × 0.21%',
  resultDoe:0.63,
  policyVersionId:'...',
  ruleId:'...',
  ruleKey:'teaching.lab.primary',
  calculationId:'...',
  reference:{...},
  status:'calculated'
}
```

- [ ] **Step 6: Ensure historical policy drift does not mutate stored records**

Add a test that changes the current Active policy fixture after a historical calculation exists and verifies the historical worksheet line still shows its original persisted result/provenance unless explicit recalculate is requested.

- [ ] **Step 7: Run GREEN**

Run:

```bash
npm --prefix server test -- reserve-service.test.js worksheet-service.test.js guideline-scenarios.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/doe/reserve-service.js server/src/doe/worksheet-service.js server/src/routes/doe-routes.js server/test/reserve-service.test.js server/test/worksheet-service.test.js server/test/guideline-scenarios.test.js
git commit -m "feat: build canonical faculty DOE worksheet"
```

---

### Task 8: Switch Lookup and DOE List to the Same Server Worksheet

**Files:**
- Create: `doe-worksheet-view.js`
- Create: `tests/doe-worksheet-view.test.js`
- Modify: `faculty-admin.js`
- Modify: `faculty-admin-enhancements.js`
- Modify: `faculty-admin.html`
- Modify: `faculty-admin.css`
- Modify: `tools/static-assets.json`

**Interfaces:**
- Consumes: `UCVM_DOE_API.getFacultyWorksheet(facultyId,academicYear)`, `UCVM_DOE_API.listFacultyDoe(academicYear)`.
- Produces: one display contract reused by Lookup detail and DOE List drill-down.

- [ ] **Step 1: Write RED cross-view consistency tests**

```js
test('Lookup and DOE List render the same worksheet totals',()=>{
  const worksheet=fixtureWorksheet({assigned:31.2,target:40});
  const lookup=renderLookupDoe(worksheet);
  const list=renderDoeListRow(worksheet);
  assert.equal(lookup.assignedDoe,list.assignedDoe);
  assert.equal(lookup.remainingDoe,list.remainingDoe);
  assert.equal(lookup.policyVersionId,list.policyVersionId);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/doe-worksheet-view.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement one renderer/normalizer**

```js
function worksheetSummary(worksheet){
  return{
    assignedDoe:worksheet.totals.assignedTeachingDoe,
    targetDoe:worksheet.totals.effectiveTargetDoe,
    remainingDoe:worksheet.totals.remainingDoe,
    scheduledDoe:worksheet.totals.scheduledTeachingDoe,
    roleDoe:worksheet.totals.roleDoe,
    rawSupervisionDoe:worksheet.totals.rawSupervisionDoe,
    appliedSupervisionDoe:worksheet.totals.appliedSupervisionDoe,
    adjustmentDoe:worksheet.totals.adjustmentDoe,
    policyVersionId:worksheet.policyVersionId,
    calculationStatus:worksheet.status
  };
}
```

- [ ] **Step 4: Replace active Lookup DOE calculation path**

In `faculty-admin.js`, remove active-runtime dependence on `canonicalDoeEntry()` for DOE totals once the API response is available. Keep legacy helpers only for migration/history fallback during this task.

- [ ] **Step 5: Replace DOE List active calculation path**

In `faculty-admin-enhancements.js`, use `listFacultyDoe()` and display:

- Effective Target;
- Scheduled;
- Roles;
- Raw Supervision;
- Applied Supervision;
- Adjustments;
- Assigned;
- Remaining/Over;
- Policy Version;
- Status;
- Last Calculated.

- [ ] **Step 6: Add fail-closed display states**

`needs_review` and `error` show “DOE unavailable / Needs Review”; do not display `0.00%` unless the server returned an explicit calculated numeric zero.

- [ ] **Step 7: Run tests**

Run:

```bash
node --test tests/doe-worksheet-view.test.js tests/faculty-doe.test.js tests/doe-canonical-consistency.test.js tests/page-modules.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add doe-worksheet-view.js faculty-admin.js faculty-admin-enhancements.js faculty-admin.html faculty-admin.css tools/static-assets.json tests/doe-worksheet-view.test.js
git commit -m "feat: unify Lookup and DOE List worksheets"
```

---

### Task 9: Convert Faculty DOE Roles from Manual Credits to Assignment Facts

**Files:**
- Create: `server/test/role-assignment.test.js`
- Modify: `faculty-account-planner.js`
- Modify: `faculty-admin.js`
- Modify: `doe-api-client.js`
- Modify: `tests/faculty-account-planner.test.js`
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: role assignment facts.
- Produces: server-calculated role DOE; legacy `managedRoles2026_27` remains migration evidence only.

- [ ] **Step 1: Write RED tests that deterministic roles do not accept final DOE**

```js
test('HICC assignment fact excludes editable deterministic doeCredit',()=>{
  const row=normalizeDoeAssignment({
    academicYear:'2027-28',type:'HICC',courseCode:'VTMD 204',doeCredit:12
  });
  assert.equal(row.type,'HICC');
  assert.equal(row.courseCode,'VTMD 204');
  assert.equal(Object.hasOwn(row,'doeCredit'),false);
});

test('legacy managed role is classified for migration, not silently rewritten',()=>{
  const row=classifyLegacyManagedRole({type:'HICC',assignment:'VTMD 204',doeCredit:12});
  assert.equal(row.classification,'assignment_fact_candidate');
  assert.equal(row.legacyDoeCredit,12);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/faculty-account-planner.test.js
npm --prefix server test -- role-assignment.test.js
```

Expected: FAIL.

- [ ] **Step 3: Split account authorization roles from DOE assignment facts**

`faculty-account-planner.js` may still derive user account roles `hicc`/`visc`, but must not use DOE credit to determine access.

- [ ] **Step 4: Replace Edit Faculty DOE Role inputs**

For deterministic roles show:

- Academic Year;
- Role;
- Course or Subject;
- units/mapping result as read-only;
- server-calculated DOE as read-only;
- Reference.

For “up to” or approved discretionary values, show an approved allocation input constrained by the Active rule cap.

- [ ] **Step 5: Save through API, not direct client final DOE writes**

Request:

```js
await UCVM_DOE_API.saveRoleAssignment({
  academicYear:'2027-28',
  facultyId,
  facts:{roleType:'HICC',courseCode:'VTMD 204'}
});
```

- [ ] **Step 6: Tighten Firestore rules after frontend cutover**

Client may not create authoritative deterministic role DOE by setting a final `doeCredit` field directly.

- [ ] **Step 7: Run focused + emulator tests**

Run:

```bash
node --test tests/faculty-account-planner.test.js
npm run test:emulator
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add faculty-account-planner.js faculty-admin.js doe-api-client.js tests/faculty-account-planner.test.js server/test/role-assignment.test.js firestore.rules
git commit -m "feat: derive role DOE from assignment facts"
```

---

### Task 10: Switch Timetable, Swap, and Approval to Server DOE Preview/Write

**Files:**
- Modify: `timetable-selection.js`
- Modify: `timetable.js`
- Modify: `faculty-swap-safe.js`
- Modify: `faculty-swap-handoff.js`
- Modify: approval runtime module identified by existing tests/search before edit
- Modify: `doe-api-client.js`
- Modify: `tests/doe-policy-timetable-integration.test.js`
- Modify: `tests/faculty-swap-integration.test.js`
- Create: `tests/doe-api-consumers.test.js`

**Interfaces:**
- Consumes: `previewAssignment()`, server-authoritative save response, Faculty Worksheet summary.
- Produces: no local policy-specific DOE math in these workflows.

- [ ] **Step 1: Write RED consumer-boundary tests**

```js
test('timetable asks DOE API for a DOE-relevant edit',async()=>{
  const api=spyDoeApi({resultDoe:0.63});
  const next=await prepareTimetableAssignment({
    before:{teachingRole:'Lab Primary',creditedHours:2},
    after:{teachingRole:'Lab Primary',creditedHours:3},
    api
  });
  assert.equal(api.calls.length,1);
  assert.equal(next.doeCredit,0.63);
});

test('swap preview uses server-projected worksheet instead of local rate math',async()=>{
  const api=spyDoeApi({projectedAssignedDoe:30.63});
  const result=await previewSwapWithDoe({api,...swapFacts});
  assert.equal(result.projectedAssignedDoe,30.63);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/doe-policy-timetable-integration.test.js tests/faculty-swap-integration.test.js tests/doe-api-consumers.test.js
```

Expected: FAIL.

- [ ] **Step 3: Replace Timetable calculation adapter**

DOE-relevant fields are sent as facts to the API. Non-DOE changes retain existing provenance.

- [ ] **Step 4: Replace Swap DOE projection**

Incoming/outgoing projected totals come from server preview response.

- [ ] **Step 5: Replace Approval DOE projection**

Search the current branch for the approval projected DOE helper, add a regression test around that exact function, then route it through `UCVM_DOE_API`.

The test must assert that a mocked server result is displayed exactly and no client rate constant is consulted.

- [ ] **Step 6: Add client tamper test**

Verify a request payload containing `doeCredit:99` still returns the server-calculated value and the saved assignment receives only the server response.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test tests/doe-policy-timetable-integration.test.js tests/faculty-swap-integration.test.js tests/doe-api-consumers.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add timetable-selection.js timetable.js faculty-swap-safe.js faculty-swap-handoff.js doe-api-client.js tests/doe-policy-timetable-integration.test.js tests/faculty-swap-integration.test.js tests/doe-api-consumers.test.js
git commit -m "feat: unify DOE workflow consumers on API"
```

---

### Task 11: Migrate Legacy DOE Sources Without Losing History

**Files:**
- Create: `tools/plan-doe-assignment-migration.js`
- Create: `tests/doe-assignment-migration.test.js`
- Modify: `doe-policy-service.js`
- Modify: `data-index.js`
- Modify: `index-maintenance.js`
- Modify: `bulk-import-controller.js`
- Modify: `firestore.rules`

**Interfaces:**
- Produces a dry-run migration report with classifications:
  - `assignment_fact_candidate`
  - `approved_discretionary`
  - `fixed_exception`
  - `unresolved`

- [ ] **Step 1: Write RED migration classification tests**

```js
test('legacy HICC role with course can become assignment fact candidate',()=>{
  const result=classify({
    managedRole:{type:'HICC',assignment:'VTMD 204',doeCredit:12},
    courseMapping:{courseCode:'VTMD 204',unitCount:6},
    activeRule:{rate:2}
  });
  assert.equal(result.classification,'assignment_fact_candidate');
  assert.equal(result.parityDifference,0);
});

test('unexplained source value becomes fixed exception candidate, not inferred formula',()=>{
  const result=classify({
    sourceNonTimetableTeachingDOE:6.5,
    explainedLines:[]
  });
  assert.equal(result.classification,'fixed_exception');
  assert.equal(result.fixedDoe,6.5);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/doe-assignment-migration.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement dry-run-only planner**

The first version must not write Firestore. It outputs:

- facultyId;
- source row;
- classification;
- proposed assignment facts;
- proposed exception;
- legacy DOE;
- calculated DOE;
- parity difference;
- blocking reason.

- [ ] **Step 4: Preserve historical year-suffixed fields as read-only evidence**

Do not delete `facultySummary2026_27`, `workloadPolicy2026_27`, or existing managed role history during initial cutover.

New writes use stable annual entities.

- [ ] **Step 5: Ensure bulk import does not re-author old DOE fields as current formula truth**

Bulk import may preserve source evidence but active Worksheet calculations must come from server assignment/calculation records.

- [ ] **Step 6: Add explicit historical drift regression**

Changing 2027-28 rules must not change a 2026-27 historical line until an explicit 2026-27 recalc is requested and authorized.

- [ ] **Step 7: Run tests**

Run:

```bash
node --test tests/doe-assignment-migration.test.js tests/doe-policy-migration.test.js tests/doe-canonical-consistency.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tools/plan-doe-assignment-migration.js tests/doe-assignment-migration.test.js doe-policy-service.js data-index.js index-maintenance.js bulk-import-controller.js firestore.rules
git commit -m "feat: plan legacy DOE assignment migration"
```

---

### Task 12: Remove Active Browser Policy Logic and Tighten the Trust Boundary

**Files:**
- Modify: `faculty-admin.html`
- Modify: `index.html`
- Modify: `tools/static-assets.json`
- Modify: `firestore.rules`
- Create: `tests/doe-no-client-policy.test.js`
- Modify: `tests/runtime-assets.test.js`
- Modify: `tests/doe-policy-security-emulator.test.js`

**Interfaces:**
- Consumes: fully cut-over API consumers from Tasks 6-10.
- Produces: frontend cannot authoritatively calculate or write deterministic DOE.

- [ ] **Step 1: Write RED static trust-boundary tests**

```js
test('active frontend has no UCVM DOE rate constants',()=>{
  for(const path of runtimeJsFiles()){
    const source=read(path);
    assert.doesNotMatch(source,/Lecture\s*[=:]\s*0\.30/);
    assert.doesNotMatch(source,/HICC\s*[=:]\s*2(?:\.0+)?/);
    assert.doesNotMatch(source,/VISC\s*[=:]\s*2\.5/);
  }
});

test('Faculty and Timetable pages load DOE API client before DOE consumers',()=>{
  const faculty=read('faculty-admin.html');
  assert.ok(faculty.indexOf('doe-api-client.js')<faculty.indexOf('faculty-admin.js'));
  const timetable=read('index.html');
  assert.ok(timetable.indexOf('doe-api-client.js')<timetable.indexOf('timetable.js'));
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/doe-no-client-policy.test.js tests/runtime-assets.test.js
```

Expected: FAIL until old active paths are removed.

- [ ] **Step 3: Remove browser engine modules from active calculation load order**

After all consumers use API, stop loading `doe-formula.js` and `doe-policy-engine.js` as authoritative runtime dependencies on Faculty/Timetable pages.

Keep the files in the repository for server/shared tests until a later cleanup proves no other consumer needs them.

- [ ] **Step 4: Deny direct client authoritative policy and calculation writes**

Firestore Rules should permit the browser only the reads it needs after API cutover. Server Admin SDK bypasses client rules and enforces authorization in API service code.

- [ ] **Step 5: Run static + emulator tests**

Run:

```bash
node --test tests/doe-no-client-policy.test.js tests/runtime-assets.test.js
npm run test:emulator
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add faculty-admin.html index.html tools/static-assets.json firestore.rules tests/doe-no-client-policy.test.js tests/runtime-assets.test.js tests/doe-policy-security-emulator.test.js
git commit -m "refactor: enforce server-side DOE authority"
```

---

### Task 13: CI, Azure App Service Packaging, and Acceptance Gate

**Files:**
- Create: `server/.env.example`
- Create: `server/README.md`
- Create: `.github/workflows/doe-api-test.yml`
- Create: `docs/doe-api-deployment.md`
- Modify: `.github/workflows/test.yml`
- Modify: `.github/workflows/github-pages-test.yml`
- Modify: `tests/github-pages-deployment.test.js`
- Modify: PR #45 description after exact-head verification

**Interfaces:**
- Produces: reproducible local/test API startup and a deployment-ready App Service package; no production deployment is executed.

- [ ] **Step 1: Write RED workflow/static assertions**

```js
test('exact-head CI runs root and server DOE suites',()=>{
  const workflow=read('.github/workflows/test.yml');
  assert.match(workflow,/npm run test:all/);
  assert.match(workflow,/npm run test:emulator/);
  assert.match(workflow,/github\.event\.pull_request\.head\.sha/);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/github-pages-deployment.test.js
```

Expected: FAIL until workflows include server suite.

- [ ] **Step 3: Add API environment contract documentation**

`server/.env.example` documents names only, never secrets:

```text
PORT=3000
FIREBASE_PROJECT_ID=demo-ucvm-access
FIREBASE_SERVICE_ACCOUNT_JSON=
ALLOWED_ORIGINS=http://localhost:8000
DOE_REPOSITORY=firestore
```

Production guidance must use Azure App Settings / Key Vault references; never commit a service account.

- [ ] **Step 4: Add exact-head server CI**

Run:

```bash
npm ci
npm --prefix server ci
npm run test:all
npm run test:emulator
node tools/build-static.js
```

- [ ] **Step 5: Run the complete local gate**

Run:

```bash
npm run test:all
npm run test:emulator
node tools/build-static.js
```

Expected: zero failures.

- [ ] **Step 6: Search for forbidden active frontend constants and year-suffixed new-write code**

Run:

```bash
grep -RInE "0\.30|0\.21|0\.19|2\.5|managedRoles2027_28|doeOverride2027_28|facultySummary2027_28" -- *.js *.html tests server tools
```

Review each hit. Allowed hits:

- tests;
- historical migration fixtures;
- seed/reference data stored as database import data;
- documentation.

No active frontend calculation branch may remain.

- [ ] **Step 7: Push feature branch and wait for exact-head CI**

Required checks:

- root static/unit;
- server unit/integration;
- Firestore/Auth emulator;
- GitHub Pages static build;
- exact feature-head checkout verification.

- [ ] **Step 8: Perform non-destructive UI acceptance**

Because GitHub Pages uses the live Firebase backend, do not execute destructive Publish/Recalculate/save operations there.

Read-only acceptance checks:

- DOE Rules UI matches current VISTA style;
- prior-year diff renders;
- Reference panel renders;
- Lookup and DOE List display the same mocked/staging Worksheet;
- Needs Review/error states render without fake zeros.

Write-path acceptance must use emulator or separately authorized staging infrastructure.

- [ ] **Step 9: Stop before production deployment and merge**

Report:

- exact head SHA;
- CI run IDs;
- test counts;
- emulator result;
- unresolved migration rows;
- any remaining manual acceptance items.

Do not merge PR #45 and do not deploy Azure/Firebase production until separately authorized after this acceptance report.

- [ ] **Step 10: Commit documentation/workflow changes**

```bash
git add server/.env.example server/README.md .github/workflows/doe-api-test.yml docs/doe-api-deployment.md .github/workflows/test.yml .github/workflows/github-pages-test.yml tests/github-pages-deployment.test.js
git commit -m "ci: verify unified DOE API and frontend"
```

---

## Plan Self-Review

### Spec coverage

- Database-authoritative annual rules: Tasks 2, 4, 5.
- Azure server-side authority: Tasks 1, 3, 12, 13.
- Complete Teaching guideline model: Tasks 4 and 7.
- HICC/VISC course/subject mapping: Tasks 2, 3, 4, 5, 6.
- Structured Reference separate from Notes: Tasks 2 and 6.
- One-day annual roll-forward: Tasks 5 and 6.
- Faculty Assignment Facts: Task 9.
- Canonical Faculty Worksheet: Tasks 7 and 8.
- Lookup + DOE List consistency: Task 8.
- Timetable + Swap + Approval consistency: Task 10.
- Historical preservation/migration: Task 11.
- No active browser policy calculation: Task 12.
- Security/CI/deployment boundary: Tasks 1, 2, 9, 12, 13.

### Placeholder scan

No `TBD`, `TODO`, “implement later”, or unspecified test steps remain. The one code-location discovery in Task 10 is intentionally a repository search step because the current approval implementation is embedded in the existing runtime rather than represented by a stable standalone module; the required behavior and regression test are specified.

### Type/interface consistency

- `academicYear` is the stable year key across API/repository/UI.
- `policyVersionId` remains the policy-version foreign key.
- Assignment requests use `facts`; clients do not author deterministic `resultDoe`.
- Worksheet lines consistently carry `resultDoe`, rule/policy IDs, `reference`, and `calculationId`.
- Lookup and DOE List both consume the same Worksheet contracts.

### Execution order

Tasks are intentionally sequential. Task 1 creates the server boundary; Tasks 2-5 establish policy/mapping authority; Task 6 exposes annual administration; Task 7 establishes the canonical Worksheet; Tasks 8-10 cut consumers over; Tasks 11-12 remove legacy authority; Task 13 is the final acceptance/deployment gate.
