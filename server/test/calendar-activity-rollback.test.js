'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
test('disposable rollback rehearsal restores the exact baseline and refuses populated or bound state',()=>{
 const runner=fs.readFileSync(path.join(root,'tools/test-calendar-activity-sql.ps1'),'utf8');
 assert.match(runner,/\[switch\]\$CheckRollback/);assert.match(runner,/Assert-RollbackRefuses/);
 assert.match(runner,/CALENDAR_ACTIVITY_EMPTY_ROLLBACK_OK/);assert.match(runner,/CalendarActivityRollbackBaseline/);
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/calendar-activity-sql.yml'),'utf8');assert.match(workflow,/-Through 041 -CheckRollback/);
});
