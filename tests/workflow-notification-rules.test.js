'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
const indexes=JSON.parse(fs.readFileSync(path.join(root,'firestore.indexes.json'),'utf8'));
const css=fs.readFileSync(path.join(root,'timetable.css'),'utf8');

test('workflow notification rules enforce sanitized shape role-scoped reads and readBy-only acknowledgement',()=>{
 assert.match(rules,/function\s+workflowNotificationShapeValid\(/);
 assert.match(rules,/function\s+validWorkflowNotificationCreate\(/);
 assert.match(rules,/function\s+workflowNotificationRead\(/);
 assert.match(rules,/function\s+workflowNotificationAcknowledge\(/);
 assert.match(rules,/match \/workflow_notifications\/\{id\}/);
 assert.match(rules,/allow read:\s*if\s+workflowNotificationRead\(\)/);
 assert.match(rules,/allow create:\s*if\s+validWorkflowNotificationCreate\(\)/);
 assert.match(rules,/allow update:\s*if\s+workflowNotificationAcknowledge\(\)/);
 assert.match(rules,/allow delete:\s*if\s+false/);
 assert.match(rules,/affectedKeys\(\)\.hasOnly\(\['readBy'\]\)/);
 assert.match(rules,/assignment_recheck_required/);
 assert.match(rules,/recipientOffice\s*==\s*'adfa'/);
});

test('workflow notification query has recipientOffice plus createdAt descending composite index',()=>{
 const found=indexes.indexes.some(index=>index.collectionGroup==='workflow_notifications'&&JSON.stringify(index.fields)===JSON.stringify([
  {fieldPath:'recipientOffice',order:'ASCENDING'},
  {fieldPath:'createdAt',order:'DESCENDING'}
 ]));
 assert.equal(found,true);
});

test('workflow notification panel has compact fixed side-panel styles and unread emphasis',()=>{
 assert.match(css,/\.workflow-notifications\s*\{/);
 assert.match(css,/\.workflow-notification\.unread/);
 assert.match(css,/\.workflow-notifications-head/);
 assert.match(css,/\.workflow-notifications-list/);
});
