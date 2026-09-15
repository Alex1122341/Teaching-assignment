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
