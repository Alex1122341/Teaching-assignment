'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const shell=process.platform==='win32'?'powershell.exe':'pwsh';
test('recovery tools reject an artifact anywhere inside the source tree before opening SQL',()=>{
 const script=path.join(root,'tools/export_calendar_activity_recovery.ps1');assert.ok(fs.existsSync(script),'Export script exists');
 const result=spawnSync(shell,['-NoProfile','-File',script,'-ActorFirebaseUid','synthetic','-ReceiptId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','-Path',path.join(root,'output/forbidden-recovery.json')],{encoding:'utf8'});
 assert.notEqual(result.status,0);assert.match(result.stderr,/outside the repository/);assert.doesNotMatch(result.stderr,/connection string/);
});
test('recovery verifies UTF-16LE content hash before any SQL connection',()=>{
 const script=path.join(root,'tools/recover_calendar_activity_import.ps1');assert.ok(fs.existsSync(script),'Recovery script exists');
 const file=path.join(require('node:os').tmpdir(),'calendar-recovery-synthetic-'+process.pid+'.json');
 fs.writeFileSync(file,Buffer.from('{"receiptId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}','utf16le'));
 try{const result=spawnSync(shell,['-NoProfile','-File',script,'-ActorFirebaseUid','synthetic','-ReceiptId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','-Path',file,'-ExpectedSha256','0'.repeat(64),'-ConfirmRecovery'],{encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/artifact hash/);assert.doesNotMatch(result.stderr,/connection string/);}finally{fs.unlinkSync(file);}
});
test('private export writes exact bytes with a protected Windows ACL and refuses overwrite',{skip:process.platform!=='win32'},()=>{
 const file=path.join(require('node:os').tmpdir(),'calendar-private-synthetic-'+process.pid+'.json');
 const command="$ErrorActionPreference='Stop'; Import-Module $env:CALENDAR_TEST_MODULE -Force; Write-PrivateCalendarRecoveryFile $env:CALENDAR_TEST_PATH ([Text.Encoding]::Unicode.GetBytes('synthetic')); $acl=[IO.File]::GetAccessControl($env:CALENDAR_TEST_PATH); if(-not $acl.AreAccessRulesProtected){throw 'Inherited ACL'}; $allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544'); foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.IdentityReference.Value -notin $allowed){throw 'Unexpected access'}}; try{Write-PrivateCalendarRecoveryFile $env:CALENDAR_TEST_PATH ([byte[]]@(1));throw 'Overwrite succeeded'}catch{if($_.Exception.Message -eq 'Overwrite succeeded'){throw}}; [Convert]::ToBase64String([IO.File]::ReadAllBytes($env:CALENDAR_TEST_PATH))";
 try{const result=spawnSync(shell,['-NoProfile','-Command',command],{encoding:'utf8',env:{...process.env,CALENDAR_TEST_MODULE:path.join(root,'tools/calendar-activity-recovery.psm1'),CALENDAR_TEST_PATH:file}});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),Buffer.from('synthetic','utf16le').toString('base64'));}finally{if(fs.existsSync(file))fs.unlinkSync(file);}
});
