const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('assigned faculty replacement uses the live session object already owned by the session modal',()=>{
 const src=read('approval-workflow.js');
 const start=src.indexOf('function openFacultySession(s)');
 const end=src.indexOf('\n }\n\n async function createRequest',start);
 assert.ok(start>=0&&end>start,'openFacultySession must exist');
 const body=src.slice(start,end);
 assert.match(body,/window\.UCVM_SAFE_SWAP\?\.openSelfReplacement/);
 assert.match(body,/openSelfReplacement\(s\)/);
 assert.match(body,/own\.length/);
});

test('replacement button is not intercepted by a second session-resolution listener',()=>{
 const src=read('faculty-swap-handoff.js');
 assert.doesNotMatch(src,/#workflow-self-swap/);
 assert.doesNotMatch(src,/stopImmediatePropagation/);
});
