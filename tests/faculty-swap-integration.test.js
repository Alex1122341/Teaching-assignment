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
 const src=read('approval-workflow.js');
 for(const token of ['faculty_swap_index','candidateKey','Sessional','Other','assessSwapCandidate','swapCandidateDisplay'])assert.match(src,new RegExp(token));
 assert.match(src,/Reason \/ note[^\n]*required|reason[^\n]*required/i);
 assert.doesNotMatch(src,/Search name, specialty, teaching area, UCID/i);
});

test('approval flow resolves opaque candidate keys through admin-only mapping and supports special category',()=>{
 const src=read('approval-workflow.js');
 assert.match(src,/faculty_swap_map/);
 assert.match(src,/candidateKey/);
 assert.match(src,/specialReplacement|isSpecialReplacement/);
 assert.match(src,/category[^\n]*(Sessional|Other)/);
});

test('Firestore rules expose only sanitized swap index and require notes for special targets',()=>{
 const rules=read('firestore.rules');
 assert.match(rules,/faculty_swap_index/);
 assert.match(rules,/allow read: if ready\(\)/);
 assert.match(rules,/faculty_swap_map/);
 assert.match(rules,/specialReplacement|specialSwap/);
 assert.match(rules,/reason[^\n]*size\(\) > 0/);
});

test('AFC approval refreshes the sanitized availability projection',()=>{
 const src=read('afc-actions.js');
 assert.match(src,/faculty_swap_index|addFacultySwapUnavailableRange/);
 assert.match(src,/faculty_swap_map/);
});
