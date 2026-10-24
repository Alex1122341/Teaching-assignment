'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('MASTER appointment SQL proves stale/atomic/recovery behavior in disposable acceptance',{skip:!process.env.PAWS_MASTER_REFRESH_TEST_CONTAINER},()=>{
 const result=spawnSync('powershell.exe',['-NoProfile','-File',path.resolve(__dirname,'../../tools/test-master-refresh-sql.ps1'),'-ContainerName',process.env.PAWS_MASTER_REFRESH_TEST_CONTAINER,'-Mode','Appointments'],{encoding:'utf8',timeout:240000,maxBuffer:2*1024*1024});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stdout,/MASTER_APPOINTMENT_ACCEPTANCE_OK/);
});
