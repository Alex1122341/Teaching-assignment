'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const runner=path.resolve(__dirname,'../../tools/test-scheduling-task-sql.ps1');

test('scheduling acceptance refuses a live server or shell-shaped target before database operations',()=>{
 for(const target of ['UniversityHost','localhost','paws-calendar-test;bad','paws-calendar-../private']){
  const result=spawnSync('pwsh',['-NoProfile','-File',runner,'-ContainerName',target],{encoding:'utf8',timeout:15000});
  assert.notEqual(result.status,0);
  assert.match(result.stdout+result.stderr,/DISPOSABLE_SQL_REQUIRED/);
 }
});

test('scheduling tasks execute against real synthetic SQL when the explicitly labeled container is supplied',t=>{
 const container=process.env.PAWS_SQL_TEST_CONTAINER;
 if(!container){t.skip('Real SQL behavior runs in the labeled CI container; local Docker is unavailable.');return;}
 const result=spawnSync('pwsh',['-NoProfile','-File',runner,'-ContainerName',container],{encoding:'utf8',timeout:300000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/SCHEDULING_TASK_OVERLAP_OK/);
});
