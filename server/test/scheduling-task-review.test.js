'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');

test('review race runner rejects non-disposable targets before starting any database connection',()=>{
 const result=spawnSync('pwsh',['-NoProfile','-File',path.resolve(__dirname,'../../tools/test-scheduling-task-races.ps1'),'-ContainerName','UniversityHost'],{encoding:'utf8',timeout:15000});
 assert.notEqual(result.status,0);
 assert.match(result.stdout+result.stderr,/DISPOSABLE_SQL_REQUIRED/);
});

test('review and concurrency acceptance use real SQL in the explicitly selected synthetic environment',t=>{
 const container=process.env.PAWS_SQL_TEST_CONTAINER;
 if(!container){t.skip('Review and actual lock waits run in the dedicated CI SQL lane.');return;}
 const root=path.resolve(__dirname,'../..');
 const review=spawnSync('pwsh',['-NoProfile','-File',path.join(root,'tools/test-scheduling-task-sql.ps1'),'-ContainerName',container],{encoding:'utf8',timeout:300000});
 assert.equal(review.status,0,review.stdout+review.stderr);
 assert.match(review.stdout,/SCHEDULING_TASK_REVIEW_OK/);
 const race=spawnSync('pwsh',['-NoProfile','-File',path.join(root,'tools/test-scheduling-task-races.ps1'),'-ContainerName',container],{encoding:'utf8',timeout:300000});
 assert.equal(race.status,0,race.stdout+race.stderr);
 assert.match(race.stdout,/SCHEDULING_TASK_RACES_OK/);
});
