'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
test('059 changes only the two existing read procedures and preserves authorization and current-revision consent',()=>{
 const sql=read('database/azure-sql/059_swap_approval_read.sql');
 assert.deepEqual([...sql.matchAll(/CREATE OR ALTER PROCEDURE paws_api\.(\w+)/g)].map(row=>row[1]),['GetSessionSwap','GetSessionSwapQueue']);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|MERGE|GRANT|REVOKE|DENY)\s+(?:paws\.|paws_api\.|ON\s|EXECUTE\s)/i);
 assert.match(sql,/Request is outside your SWAP scope/);assert.match(sql,/n\.Revision=r\.Revision AND n\.TargetUid=@ActorFirebaseUid/);assert.match(sql,/u\.Active=1 AND u\.MustChangePassword=0/);
 assert.match(sql,/JSON_VALUE\(r\.SnapshotJson,'\$\.Topic'\) topic/);assert.doesNotMatch(sql,/r\.SnapshotJson\s+(?:AS\s+)?(?:snapshot|original|SnapshotJson)\b/i);
 assert.doesNotMatch(sql,/\bu\.Email\b|\bf\.UCID\b|\ba\.DoeCredit\b/);
 assert.match(sql,/JOIN paws\.Faculty sf ON sf\.FacultyId=s\.FacultyId/);assert.doesNotMatch(sql,/s\.SourceFacultyName/);
});
test('059 acceptance can only be launched through the existing disposable-container boundary',()=>{
 const launcher=read('tools/test-swap-approval-sql.ps1');assert.match(launcher,/test-calendar-activity-sql\.ps1/);assert.doesNotMatch(launcher,/\[string\]\$(?:Server|ConnectionString)/);
 assert.match(launcher,/059_swap_approval_read_acceptance\.sql/);assert.match(launcher,/WRITE_GRANTS_UNCHANGED/);assert.match(launcher,/rollback_059/);
 const rollback=read('database/azure-sql/rollback_059_swap_approval_read.sql');assert.match(rollback,/refuses an unknown/);assert.doesNotMatch(rollback,/DROP TABLE|DELETE FROM/i);
});
test('forward and rollback guards pin the exact normalized UTF-16 definitions they replace',()=>{
 const crypto=require('node:crypto'),forward=read('database/azure-sql/059_swap_approval_read.sql').replace(/\r\n/g,'\n'),rollback=read('database/azure-sql/rollback_059_swap_approval_read.sql');
 for(const name of ['GetSessionSwap','GetSessionSwapQueue']){
  const pattern=new RegExp('CREATE(?: OR ALTER)? PROCEDURE paws_api\\.'+name+'\\b.*?(?=\\nGO\\s*(?:\\n|$))','s');
  for(const source of [forward,read('database/azure-sql/030_session_swap.sql').replace(/\r\n/g,'\n')]){
   const definition=source.match(pattern)[0],canonical=('CREATE '+definition.slice(definition.indexOf('PROCEDURE'))).trim();
   const digest=crypto.createHash('sha256').update(canonical,'utf16le').digest('hex').toUpperCase();assert.ok(forward.includes(digest),name+' forward');assert.ok(rollback.includes(digest),name+' rollback');
  }
 }
});

test('Calendar SQL CI executes scoped approval059 and observes both protected-write and rollback receipts before cleanup',()=>{
 const workflow=read('.github/workflows/calendar-activity-sql.yml');
 const triggers=workflow.slice(0,workflow.indexOf('  workflow_dispatch:'));
 for(const source of ['tools/test-swap-approval-sql.ps1','server/test/swap-approval-sql-contract.test.js'])assert.ok(triggers.includes("'"+source+"'"),source+' changes must schedule real SQL acceptance');
 const step=workflow.match(/- name: Check scoped SWAP approval read and rollback[\s\S]*?(?=\n      - name:)/)?.[0];
 assert.ok(step,'059 must run in the existing labeled synthetic SQL job');
 assert.match(step,/shell: pwsh/);
 assert.match(step,/test-swap-approval-sql\.ps1 -ContainerName paws-calendar-sql-test/);
 for(const marker of ['SWAP_APPROVAL_READ_059_WRITE_GRANTS_UNCHANGED','SWAP_APPROVAL_READ_059_ROLLBACK_OK'])assert.ok(step.includes(marker),marker);
 assert.ok(workflow.indexOf(step)<workflow.indexOf('- name: Stop synthetic container after all checks'));
});
