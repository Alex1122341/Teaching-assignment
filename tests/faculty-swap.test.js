'use strict';
// ---------------------------------------------------------------------------
// Merged domain test file.
//
// This file was assembled from several small single-purpose test files in the
// same domain. No assertion was changed: each source body is preserved verbatim
// inside its own IIFE so top-level declarations from different files cannot
// collide, and the total number of tests is unchanged.
//
// Split it back out by taking each block below to its own file if a failure ever
// needs a narrower blast radius.
// ---------------------------------------------------------------------------

// ------------------------------------------------------------------------
// merged from tests/faculty-swap-candidates.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const index=require('../data-index.js');

test('faculty swap projection exposes only safe identity and binary AFC ranges',()=>{
 assert.equal(typeof index.buildFacultySwapIndexes,'function');
 const faculty=[{
  __id:'10001234',preferredFullName:'Jane Smith',hrFullName:'Smith, Jane',email:'jane@ucalgary.ca',
  doe:{teaching:22},awayFromCampusRecords:[{startDate:'2026-10-05',endDate:'2026-10-07',purpose:'Vacation',reason:'private'}]
 }];
 const built=index.buildFacultySwapIndexes(faculty,{entries:[]},()=> 'opaque-key-1');
 assert.deepEqual(built.publicIndex.entries,[{
  key:'opaque-key-1',name:'Jane Smith',aliases:['Jane Smith','Smith, Jane'],
  unavailableRanges:[{startDate:'2026-10-05',endDate:'2026-10-07'}]
 }]);
 const serialized=JSON.stringify(built.publicIndex);
 for(const secret of ['10001234','jane@ucalgary.ca','Vacation','private','22'])assert.equal(serialized.includes(secret),false,`public projection leaked ${secret}`);
 assert.deepEqual(built.privateMap.entries,[{key:'opaque-key-1',facultyId:'10001234'}]);
});

test('faculty swap projection preserves opaque keys across rebuilds and skips inactive faculty',()=>{
 const previous={entries:[{key:'keep-me',facultyId:'f1'}]};
 let generated=0;
 const built=index.buildFacultySwapIndexes([
  {__id:'f1',preferredFullName:'A Person'},
  {__id:'f2',preferredFullName:'B Person',active:false},
  {__id:'f3',preferredFullName:'C Person'}
 ],previous,()=>`new-${++generated}`);
 assert.deepEqual(built.privateMap.entries,[{key:'keep-me',facultyId:'f1'},{key:'new-1',facultyId:'f3'}]);
 assert.deepEqual(built.publicIndex.entries.map(x=>x.key),['keep-me','new-1']);
});

test('candidate availability hides AFC details but reports timetable course conflicts',()=>{
 assert.equal(typeof index.assessSwapCandidate,'function');
 assert.equal(typeof index.swapCandidateDisplay,'function');
 const candidate={key:'k1',name:'Jane Smith',aliases:['Jane Smith'],unavailableRanges:[{startDate:'2026-10-05',endDate:'2026-10-05'}]};
 const target={id:'target',date:'2026-10-05',start:'09:00',end:'10:00',course:'VTMD 500'};
 const sessions=[target,{id:'other',date:'2026-10-05',start:'09:30',end:'10:30',course:'VTMD 571',topic:'Private-ish topic not needed',assignments:[{name:'Jane Smith',ucid:'10001234'}]}];
 const result=index.assessSwapCandidate(candidate,sessions,target);
 assert.equal(result.available,false);
 const display=index.swapCandidateDisplay(result);
 assert.equal(display.label,'Unavailable');
 assert.match(display.detail,/VTMD 571/);
 assert.match(display.detail,/09:30-10:30/);
 assert.doesNotMatch(display.detail,/AFC|Vacation|reason/i);
 assert.doesNotMatch(display.detail,/10001234/);
});

test('AFC-only unavailability renders only Unavailable with no explanation',()=>{
 const candidate={key:'k1',name:'Jane Smith',aliases:['Jane Smith'],unavailableRanges:[{startDate:'2026-10-05',endDate:'2026-10-05'}]};
 const target={id:'target',date:'2026-10-05',start:'09:00',end:'10:00'};
 const display=index.swapCandidateDisplay(index.assessSwapCandidate(candidate,[target],target));
 assert.deepEqual(display,{label:'Unavailable',detail:''});
});

test('clear candidate is Available',()=>{
 const candidate={key:'k1',name:'Jane Smith',aliases:['Jane Smith'],unavailableRanges:[]};
 const target={id:'target',date:'2026-10-05',start:'09:00',end:'10:00'};
 const display=index.swapCandidateDisplay(index.assessSwapCandidate(candidate,[target],target));
 assert.deepEqual(display,{label:'Available',detail:''});
});
})();

// ------------------------------------------------------------------------
// merged from tests/faculty-swap-direct-session.test.js
// ------------------------------------------------------------------------
(() => {
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
})();

// ------------------------------------------------------------------------
// merged from tests/faculty-swap-integration.test.js
// ------------------------------------------------------------------------
(() => {
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const maintenance=require('../index-maintenance.js');

test('index maintenance exposes swap-index writers and safe AFC range patching',()=>{
 assert.equal(typeof maintenance.writeFacultySwapIndexes,'function');
 assert.equal(typeof maintenance.addFacultySwapUnavailableRange,'function');
 const next=maintenance.addFacultySwapUnavailableRange(
  {schemaVersion:'ucvm-faculty-swap-index-v1',entries:[{key:'k1',name:'Jane',aliases:['Jane'],unavailableRanges:[]}]},
  {schemaVersion:'ucvm-faculty-swap-map-v1',entries:[{key:'k1',facultyId:'f1'}]},
  'f1','2026-10-05','2026-10-07'
 );
 assert.deepEqual(next.entries[0].unavailableRanges,[{startDate:'2026-10-05',endDate:'2026-10-07'}]);
});

test('faculty self swap uses sanitized directory with availability and special targets',()=>{
 const src=read('faculty-swap-safe.js');
 for(const token of ['faculty_swap_index','candidateKey','Sessional','Other','assessSwapCandidate','swapCandidateDisplay'])assert.match(src,new RegExp(token));
 assert.match(src,/Reason \/ note is required for Sessional or Other/);
 assert.match(src,/reason\.required=special/);
 assert.doesNotMatch(src,/Search name, specialty, teaching area, UCID/i);
});

test('faculty session modal routes assigned replacements directly to the privacy-safe picker',()=>{
 const src=read('approval-workflow.js');
 const start=src.indexOf('function openFacultySession(s)');
 const end=src.indexOf('\n }\n\n async function createRequest',start);
 assert.ok(start>=0&&end>start,'openFacultySession must exist');
 const body=src.slice(start,end);
 assert.match(body,/const openSelfReplacement=window\.UCVM_SAFE_SWAP\?\.openSelfReplacement/);
 assert.match(body,/if\(own\.length&&typeof openSelfReplacement==='function'\)return openSelfReplacement\(s\)/);
 assert.match(body,/return openSelfSwap\(s\)/);
});

test('legacy faculty swap handoff remains a non-intercepting compatibility asset',()=>{
 const handoffPath=path.join(root,'faculty-swap-handoff.js');
 assert.equal(fs.existsSync(handoffPath),true,'faculty-swap-handoff.js must remain deployable');
 const src=fs.readFileSync(handoffPath,'utf8');
 assert.match(src,/UCVM_SAFE_SWAP_HANDOFF=\{mode:'direct-session-modal'\}/);
 assert.doesNotMatch(src,/#workflow-self-swap/);
 assert.doesNotMatch(src,/stopImmediatePropagation/);
 assert.doesNotMatch(src,/db\.collection\(SESSIONS\)/);
});

test('approval resolves opaque candidate keys through admin-only mapping and supports special categories',()=>{
 const src=read('faculty-swap-safe.js');
 assert.match(src,/faculty_swap_map/);
 assert.match(src,/candidateKey/);
 assert.match(src,/specialReplacement/);
 assert.match(src,/category:resolved\.special\?specialLabel/);
 assert.match(src,/liveIncomingWarnings/);
});

test('Firestore rules expose only sanitized swap index and require notes for special targets',()=>{
 const rules=read('firestore.rules');
 assert.match(rules,/id == 'faculty_swap_index'/);
 assert.match(rules,/allow read: if privateReader\(\) && id == 'faculty_swap_index'/);
 assert.match(rules,/faculty_swap_map/);
 assert.match(rules,/specialReplacement/);
 assert.match(rules,/reason\.size\(\) > 0/);
});

test('AFC approval refreshes the sanitized availability projection through index maintenance',()=>{
 const actions=read('afc-actions.js'),maintenanceSrc=read('index-maintenance.js');
 assert.match(actions,/prepareFacultySwapAfcUpdate/);
 assert.match(actions,/swapIndexUpdate/);
 assert.match(maintenanceSrc,/faculty_swap_index/);
 assert.match(maintenanceSrc,/faculty_swap_map/);
 assert.match(maintenanceSrc,/addFacultySwapUnavailableRange/);
});

test('shared static build includes safe swap and loads it for timetable and admin initialization',()=>{
 const manifest=JSON.parse(read('tools/static-assets.json')),loader=read('asset-loader.js'),admin=read('faculty-admin.html'),safeSrc=read('faculty-swap-safe.js');
 assert.ok(manifest.includes('faculty-swap-safe.js'));
 assert.ok(manifest.includes('faculty-swap-handoff.js'));
 assert.ok(manifest.includes('approval-workflow.js'));
 const safe=loader.indexOf("loadScriptOnce('faculty-swap-safe.js'");
 const handoff=loader.indexOf("loadScriptOnce('faculty-swap-handoff.js'");
 const legacy=loader.indexOf("loadScriptOnce('approval-workflow.js'");
 assert.ok(safe>=0&&handoff>safe&&legacy>handoff,'safe swap compatibility asset must load after safe picker and before approval-workflow.js');
 assert.match(loader,/ensureApprovalWorkflow/);
 assert.match(admin,/src="faculty-swap-safe\.js"/);
 assert.match(safeSrc,/faculty-admin\.html/);
 assert.match(safeSrc,/maybeInitializeSwapDirectory/);
});
})();
