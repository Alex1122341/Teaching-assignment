'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.resolve(__dirname,'../../tools',name),'utf8');
test('046 acceptance starts a fresh guarded schema before running historical fixtures once',()=>{
 const runner=read('test-calendar-commit-preflight-sql.ps1');
 assert.match(runner,/test-calendar-activity-sql\.ps1'\) -ContainerName \$ContainerName -Through '041' -SkipAcceptance/);
 assert.doesNotMatch(runner,/test-calendar-away-sql\.ps1/);
 assert.match(runner,/foreach\(\$number in @\('038','039','040','041'\)\)/);
 const base=read('test-calendar-activity-sql.ps1');
 assert.match(base,/\[switch\]\$SkipAcceptance/);
 const guard=base.indexOf('if($SkipAcceptance){return}');
 assert.ok(guard>base.indexOf('044_calendar_empty_activity_array.sql'));
 assert.ok(guard<base.lastIndexOf('foreach($number in $selected)'));
});
