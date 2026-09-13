const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const workflow=fs.readFileSync(path.join(root,'approval-workflow.js'),'utf8');

test('pending faculty swap requests visibly mark their matching calendar session',()=>{
 assert.match(workflow,/r\.status\s*===\s*'pending'\s*&&\s*r\.requestType\s*===\s*'faculty_swap'/);
 assert.match(workflow,/workflow-swap-pending/);
 assert.match(workflow,/SWAP PENDING/);
 assert.match(workflow,/String\(r\.sessionId/);
});

test('swap marker is removed when a request is no longer pending or its session is not rendered',()=>{
 assert.match(workflow,/classList\.toggle\('workflow-swap-pending',\s*hasPendingSwap\)/);
 assert.match(workflow,/\.workflow-swap-pending-label/);
 assert.match(workflow,/existingLabel\?\.remove\(\)/);
});
