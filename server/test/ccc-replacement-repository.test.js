'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('CCC SQL replacement protects whole dataset, private recovery and unrelated AFC/DOE',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../../database/azure-sql/049_ccc_full_replacement.sql'),'utf8');
 for(const name of ['StageCccReplacement','GetCccReplacement','PreviewCccReplacement','CommitCccReplacement','RecoverCccReplacement','CccReplacementSnapshot','AcquireCalendarActivityFacultyLocks','CalendarActivityProtectedReferences','paws_ccc_recovery_admin','ccc_activity_added','ccc_activity_removed'])assert.ok(sql.includes(name),name);
 assert.match(sql,/SERIALIZABLE/);assert.match(sql,/sp_getapplock/);assert.match(sql,/MustChangePassword=0/);assert.match(sql,/DATEADD\(minute,15/);assert.match(sql,/ActivityVersion/);
 assert.doesNotMatch(sql,/(?:DELETE|UPDATE|INSERT)\s+(?:FROM\s+)?paws\.(?:AfcRecord|AfcManualRecord|RoleAssignment|DoeAssignment)\b/i);assert.doesNotMatch(sql,/ALTER ROLE.*ADD MEMBER/);
});
test('CCC repository uses fixed procedures, import pool and named verified parameters',async()=>{
 const {createSqlCccReplacementRepository}=require('../src/data/sql-ccc-replacement-repository');let call;
 const repo=createSqlCccReplacementRepository({query:async()=>{throw Error('wrong pool');}},{importDb:{query:async(sql,params)=>{call={sql,params};return [{responseJson:'{"batchId":"id"}'}];}}});
 await repo.stage({actorFirebaseUid:'actor',requestId:'id',fileName:'CCC.xlsx',byteLength:10,parsed:{sourceSha256:'A'.repeat(64),academicYear:'2026-27',rows:[]}});assert.match(call.sql,/EXEC paws_api.StageCccReplacement/);assert.equal(call.params.ActorFirebaseUid,'actor');assert.equal(call.params.AcademicYear,'2026-27');assert.equal(call.params.FileName,'CCC.xlsx');assert.equal(call.params.RowsJson,'[]');
});
