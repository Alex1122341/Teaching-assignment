const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'../faculty-admin.html'),'utf8');
const js=fs.readFileSync(path.resolve(__dirname,'../faculty-admin.js'),'utf8');
test('sessional and other assignments have a dedicated lazy tab',()=>{
 assert.match(html,/data-tab="sessional"/);assert.match(html,/id="sessional-view"/);assert.match(html,/id="sessional-search"/);assert.match(js,/function renderSessional/);assert.match(js,/tab==='sessional'.*loadAuxOnce\(\)/);assert.doesNotMatch(html,/id="roles-view"[\s\S]*id="aux-body"[\s\S]*<section id="sessional-view"/);
});
