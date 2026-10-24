'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('empty-result rollback refuses an existing reader whose definition is unreadable',()=>{
 const sql=fs.readFileSync(path.resolve(__dirname,'../../database/azure-sql/rollback_055_trainee_empty_results.sql'),'utf8');
 assert.match(sql,/OBJECT_DEFINITION\(OBJECT_ID\(ObjectName\)\)\s+IS\s+NULL/i,'A NULL definition must not pass SQL three-valued hash comparisons');
});
