'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createSqlTeachingAssignmentWorkflowRepository}=require('../src/data/sql-teaching-assignment-workflow-repository');

function harness(responses=[]) { const seen=[];return {seen,repo:createSqlTeachingAssignmentWorkflowRepository({query:async(sql,params)=>{seen.push({sql,params});return responses.shift()||[];}})}; }

test('work queue query enforces active temporal authority and SQL server package scope',async()=>{
  const {repo,seen}=harness();
  await repo.listWorkQueue({actorFirebaseUid:'uid',facultyId:'faculty',role:'hicc',academicYear:'2026-27'});
  assert.match(seen[0].sql,/CanActOnTeachingAssignmentPackage\(p\.TeachingAssignmentPackageId,@actorFirebaseUid,@actionKind\)=1/i);
  assert.match(seen[0].sql,/ExpirationDate\s+IS\s+NULL/i);
  assert.match(seen[0].sql,/ActiveDate<=CONVERT\(date,SYSUTCDATETIME\(\)\)/i);
  assert.equal(seen[0].params.actorFirebaseUid,'uid');
  assert.equal(seen[0].params.actionKind,'hicc');
  assert.equal(seen[0].params.isAdmin,0);
});

test('ADC/LAB contribution target query exposes only open current-revision session metadata',async()=>{
  const {repo,seen}=harness();
  await repo.listContributionTargets({academicYear:'2026-27'});
  assert.match(seen[0].sql,/p\.Status IN\s*\(N'draft',N'changes_requested'\)/);
  assert.match(seen[0].sql,/rev\.RevisionNumber=p\.WorkingRevision/);
  assert.match(seen[0].sql,/JOIN paws\.TeachingAssignmentRevisionSession/);
  assert.doesNotMatch(seen[0].sql,/paws\.TeachingAssignmentReview|paws\.TeachingAssignmentFinalizationLine|FacultyDisplayName/);
  assert.deepEqual(seen[0].params,{academicYear:'2026-27'});
});

test('workflow writes call only named procedures with server-owned actor parameters',async()=>{
  const {repo,seen}=harness();
  await repo.review({packageId:'pkg',revisionNumber:4,decision:'push_back',comment:'Revise',actorFirebaseUid:'verified-uid'});
  assert.match(seen[0].sql,/EXEC paws_api\.RecordTeachingAssignmentReview/);
  assert.doesNotMatch(seen[0].sql,/INSERT\s+INTO|UPDATE\s+paws\./i);
  assert.equal(seen[0].params.ActorFirebaseUid,'verified-uid');
  assert.equal(seen[0].params.RevisionNumber,4);
});

test('published Faculty query scopes output by canonical FacultyId and immutable release id',async()=>{
  const {repo,seen}=harness([[{releaseId:'release',academicYear:'2026-27',versionNumber:2}],[]]);
  await repo.getPublishedRelease({academicYear:'2026-27',role:'faculty',facultyId:'canonical-faculty'});
  assert.match(seen[1].sql,/ps\.ReleaseId=@releaseId/);
  assert.match(seen[1].sql,/pi\.FacultyId=@facultyId/);
  assert.equal(seen[1].params.releaseId,'release');
  assert.equal(seen[1].params.facultyId,'canonical-faculty');
});
