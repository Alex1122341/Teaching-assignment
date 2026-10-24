'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const path=require('node:path');const {spawnSync}=require('node:child_process');
const runner=path.resolve(__dirname,'../../tools/test-calendar-activity-sql.ps1');
test('disposable SQL runner rejects arbitrary server-shaped container names before invoking Docker',()=>{
 for(const name of ['localhost','UniversityHost','paws-calendar-test;remove','paws-calendar-../private']){
  const result=spawnSync('pwsh',['-NoProfile','-File',runner,'-ContainerName',name],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/DISPOSABLE_SQL_REQUIRED/);
 }
});
test('range schema and source projection execute in the labeled synthetic SQL environment',t=>{
 const name=process.env.PAWS_SQL_TEST_CONTAINER;
 if(!name){t.skip('SQL acceptance is provided by the disposable CI container; local Docker is absent.');return;}
 const result=spawnSync('pwsh',['-NoProfile','-File',runner,'-ContainerName',name,'-Through','038'],{encoding:'utf8',timeout:240000});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/CALENDAR_ACTIVITY_FOUNDATION_ACCEPTANCE_OK/);
});
