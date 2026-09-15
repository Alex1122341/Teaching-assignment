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

test('faculty replacement button hands off to the safe picker before the legacy onclick runs',()=>{
 const handoffPath=path.join(root,'faculty-swap-handoff.js');
 assert.equal(fs.existsSync(handoffPath),true,'faculty-swap-handoff.js must exist');
 const src=fs.readFileSync(handoffPath,'utf8');
 assert.match(src,/#workflow-self-swap/);
 assert.match(src,/stopImmediatePropagation/);
 assert.match(src,/UCVM_SAFE_SWAP\?\.openSelfReplacement/);
 assert.match(src,/openSelfReplacement\(session\)/);
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
 assert.match(rules,/allow read: if ready\(\) && id == 'faculty_swap_index'/);
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
 assert.ok(safe>=0&&handoff>safe&&legacy>handoff,'safe swap handoff must load before approval-workflow.js');
 assert.match(loader,/ensureApprovalWorkflow/);
 assert.match(admin,/src="faculty-swap-safe\.js"/);
 assert.match(safeSrc,/faculty-admin\.html/);
 assert.match(safeSrc,/maybeInitializeSwapDirectory/);
});
