'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
test('office timetable rules define paired calendar integrity and office field scopes',()=>{
 assert.match(rules,/function adc\(\)/);
 assert.match(rules,/function lab\(\)/);
 assert.match(rules,/function calendarMatchesSourceAfter\(id\)/);
 assert.match(rules,/let calendar=getAfter\(calendarPath\(id\)\)\.data/);
 assert.match(rules,/function adcSessionCreate\(id\)/);
 assert.match(rules,/function adcSessionUpdate\(id\)/);
 assert.match(rules,/function labSessionUpdate\(id\)/);
 assert.match(rules,/affectedKeys\(\)\.hasOnly/);
});
test('office audit writes are restricted to sanitized session-change shape',()=>{
 assert.match(rules,/function officeSessionAuditCreate\(\)/);
 assert.match(rules,/instructors.*size\(\) == 0/);
 assert.match(rules,/allow create: if teachingWritesOpen\(\) && \(\(admin\(\)/);
});
