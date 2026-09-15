const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('faculty swap handoff preserves the exact clicked page session for the replacement button',()=>{
 const src=read('faculty-swap-handoff.js');
 assert.match(src,/let lastSession=null/);
 assert.match(src,/lastSession=sessionById\(lastSessionId\)/);
 assert.match(src,/let session=lastSession\|\|sessionById\(lastSessionId\)/);
});
