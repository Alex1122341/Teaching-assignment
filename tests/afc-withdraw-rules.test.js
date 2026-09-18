'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const actions=fs.readFileSync(path.join(root,'afc-actions.js'),'utf8');
const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');

test('AFC action module exposes requester-only transactional withdrawal with audit',()=>{
 assert.match(actions,/async function withdraw\(/);
 assert.match(actions,/runTransaction/);
 assert.match(actions,/Only the requester can withdraw this AFC request/);
 assert.match(actions,/\['pending_report_to','pending_admin'\]/);
 assert.match(actions,/status:'withdrawn'/);
 assert.match(actions,/action:'afc_withdraw'/);
 assert.match(actions,/return\{decide,withdraw\}/);
});

test('Firestore rules permit only the legal requester withdrawal field set',()=>{
 assert.match(rules,/function\s+afcWithdraw\(/);
 assert.match(rules,/resource\.data\.status in \['pending_report_to','pending_admin'\]/);
 assert.match(rules,/request\.resource\.data\.status == 'withdrawn'/);
 assert.match(rules,/withdrawnBy == request\.auth\.uid/);
 assert.match(rules,/affectedKeys\(\)\.hasOnly\(\['status','withdrawnBy','withdrawnAt','updatedAt'\]\)/);
 assert.match(rules,/afc_requests[^]*allow update:[^]*afcWithdraw\(\)/);
});
