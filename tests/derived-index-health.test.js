'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ui=require('../derived-index-health.js');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('manual rebuild is visible only for General semantics',()=>{
 const access={general:p=>['owner','adfa_general'].includes(p.role)};
 assert.equal(ui.canManualRebuild({role:'owner'},access),true);
 assert.equal(ui.canManualRebuild({role:'adfa_general'},access),true);
 assert.equal(ui.canManualRebuild({role:'adfa_regular'},access),false);
 assert.equal(ui.canManualRebuild({role:'administrator'},access),false);
});

test('report summary keeps three health severities distinct',()=>{
 assert.equal(ui.reportSummary({severity:'healthy'}).label,'HEALTHY');
 assert.equal(ui.reportSummary({severity:'mismatch'}).label,'MISMATCH');
 assert.equal(ui.reportSummary({severity:'critical'}).label,'CRITICAL');
});

test('status rows always name all four derived documents',()=>{
 assert.deepEqual(ui.statusRows({documents:{faculty_index:'healthy',schedule_stats:'mismatch'}}),[
  {id:'faculty_index',status:'healthy'},
  {id:'schedule_stats',status:'mismatch'},
  {id:'faculty_swap_index',status:'unchecked'},
  {id:'faculty_swap_map',status:'unchecked'}
 ]);
});

test('Faculty Database owns the health card and rebuild participates in maintenance blocking',()=>{
 const html=read('faculty-admin.html');
 assert.match(html,/id="database-view"[\s\S]*id="derived-index-health-card"/);
 assert.match(html,/id="derived-index-rebuild"[^>]*data-derived-index-rebuild/);
 assert.ok(html.indexOf('derived-index-health.js')>html.indexOf('index-maintenance.js'));
});

test('runtime separates read-only verify from full rebuild',()=>{
 const js=read('derived-index-health.js');
 assert.match(js,/verifyDerivedIndexes\(db\)/);
 assert.match(js,/rebuildDerivedIndexes\(db,actor\)/);
});

function fakeNode(){return{textContent:'',innerHTML:'',disabled:false,classList:{toggle(){}},addEventListener(){}}}
function fakeDocument(){
 const nodes={
  'derived-index-health-card':fakeNode(),
  'derived-index-health-meta':fakeNode(),
  'derived-index-health-status':fakeNode(),
  'derived-index-health-diffs':fakeNode(),
  'derived-index-verify':fakeNode(),
  'derived-index-rebuild':fakeNode()
 };
 return{nodes,head:{appendChild(){}},getElementById:id=>nodes[id]||null,createElement:()=>({id:'',textContent:''})};
}

test('post-rebuild verification failure keeps mismatch details visible',async()=>{
 const document=fakeDocument(),mismatch={
  ok:false,severity:'mismatch',checkedAt:'2026-09-17T12:00:00Z',counts:{faculty:2,sessions:1},mismatchCount:1,
  documents:{faculty_index:'healthy',schedule_stats:'mismatch',faculty_swap_index:'healthy',faculty_swap_map:'healthy'},
  mismatches:[{document:'schedule_stats',path:'sessionCount',issue:'value-mismatch',expected:1,actual:2,severity:'mismatch'}]
 };
 const runtime=ui.createRuntime({
  document,window:{confirm:()=>true},db:{},profile:{role:'adfa_general'},actor:{uid:'g',name:'General'},access:{general:()=>true},maintenance:{normalWritesAllowed:()=>true,subscribe:()=>()=>{}},
  indexMaintenance:{
   verifyDerivedIndexes:async()=>mismatch,
   rebuildDerivedIndexes:async()=>{const error=Error('Derived indexes were written but post-rebuild verification is not healthy.');error.report=mismatch;throw error}
  }
 });
 await runtime.verify();
 await runtime.rebuild();
 assert.match(document.nodes['derived-index-health-diffs'].innerHTML,/Overall: MISMATCH/);
 assert.match(document.nodes['derived-index-health-diffs'].innerHTML,/schedule_stats/);
 assert.match(document.nodes['derived-index-health-diffs'].innerHTML,/post-rebuild verification is not healthy/i);
});
