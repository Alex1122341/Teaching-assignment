'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const plannerPath=path.join(__dirname,'..','tools','plan-doe-assignment-migration.js');

function planner(){
  delete require.cache[require.resolve(plannerPath)];
  return require(plannerPath);
}

test('legacy HICC role with course can become assignment fact candidate',()=>{
  const result=planner().classify({
    facultyId:'f1',academicYear:'2026-27',
    managedRole:{type:'HICC',assignment:'VTMD 204',doeCredit:12},
    courseMapping:{courseCode:'VTMD 204',unitCount:6},
    activeRule:{ruleKey:'role.hicc.development',rate:2}
  });
  assert.equal(result.classification,'assignment_fact_candidate');
  assert.equal(result.legacyDoe,12);
  assert.equal(result.calculatedDoe,12);
  assert.equal(result.parityDifference,0);
  assert.deepEqual(result.proposedAssignmentFacts,{academicYear:'2026-27',facultyId:'f1',category:'role',roleType:'HICC',courseCode:'VTMD 204',units:6});
  assert.equal(result.proposedException,null);
});

test('legacy deterministic role with parity mismatch remains unresolved',()=>{
  const result=planner().classify({
    facultyId:'f1',academicYear:'2026-27',
    managedRole:{type:'HICC',assignment:'VTMD 204',doeCredit:12},
    courseMapping:{courseCode:'VTMD 204',unitCount:6},
    activeRule:{ruleKey:'role.hicc.development',rate:1.5}
  });
  assert.equal(result.classification,'unresolved');
  assert.equal(result.calculatedDoe,9);
  assert.equal(result.parityDifference,-3);
  assert.match(result.blockingReason,/parity/i);
});

test('unexplained source value becomes fixed exception candidate, not inferred formula',()=>{
  const result=planner().classify({
    facultyId:'f2',academicYear:'2026-27',sourceNonTimetableTeachingDOE:6.5,
    explainedLines:[],sourceReference:'facultySummary2026_27.sourceNonTimetableTeachingDOE'
  });
  assert.equal(result.classification,'fixed_exception');
  assert.equal(result.fixedDoe,6.5);
  assert.equal(result.calculatedDoe,null);
  assert.equal(result.proposedAssignmentFacts,null);
  assert.equal(result.proposedException.fixedDoe,6.5);
  assert.match(result.proposedException.reason,/legacy source reconciliation/i);
});

test('planner is dry-run only and preserves year-suffixed historical evidence without mutation',()=>{
  const source=[{
    __id:'f1',
    facultySummary2026_27:{sourceNonTimetableTeachingDOE:12,marker:'keep'},
    workloadPolicy2026_27:{credits:[{type:'HICC',rawDOE:12}]},
    managedRoles2026_27:[{type:'HICC',assignment:'VTMD 204',doeCredit:12}]
  }];
  const before=JSON.parse(JSON.stringify(source));
  const report=planner().plan(source,{
    academicYear:'2026-27',
    courseMappings:[{courseCode:'VTMD 204',unitCount:6}],
    activeRules:[{ruleKey:'role.hicc.development',roleType:'HICC',rate:2}]
  });
  assert.deepEqual(source,before);
  assert.equal(report.rows[0].classification,'assignment_fact_candidate');
  assert.equal(report.writes.length,0);
  assert.deepEqual(report.historicalEvidence[0].facultySummary2026_27,before[0].facultySummary2026_27);
  assert.deepEqual(report.historicalEvidence[0].managedRoles2026_27,before[0].managedRoles2026_27);
});

test('migration planner contains no Firebase/Firestore write path',()=>{
  const source=fs.readFileSync(plannerPath,'utf8');
  assert.doesNotMatch(source,/\.set\s*\(|\.update\s*\(|\.delete\s*\(|firebase-admin|initializeApp\s*\(/);
});
