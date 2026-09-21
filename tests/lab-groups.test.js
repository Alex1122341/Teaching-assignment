'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const load=()=>{const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'lab-groups.js'),'utf8'),ctx);return ctx.window.UCVM_LAB_GROUPS;};
const arr=value=>Array.from(value||[]);
const plain=value=>JSON.parse(JSON.stringify(value));

test('group codes and colour keys are deterministic and colour is never the only signal',()=>{
 const api=load();
 assert.deepEqual(arr(api.GROUP_CODES).slice(0,4),['A','B','C','D']);
 assert.equal(api.groupCodeForIndex(0),'A');
 assert.equal(api.groupCodeForIndex(3),'D');
 assert.equal(api.colorKeyForCode('A'),'group-a');
 assert.equal(api.colorKeyForCode('D'),'group-d');
 // Codes beyond the named set still resolve instead of being dropped.
 assert.equal(api.groupCodeForIndex(8),'G9');
 const group=plain(api.createGroup({groupId:'g-a',academicYear:'2026-27',course:'601',groupCode:'b'}));
 assert.equal(group.groupCode,'B');
 assert.equal(group.colorKey,'group-b');
 assert.equal(group.active,true);
 assert.equal(api.isKnownGroupCode('c'),true);
 assert.equal(api.isKnownGroupCode('Z9'),false);
});

test('a one-column paste keeps the default group and counts students',()=>{
 const api=load();
 const rows=Array.from({length:22},(_,i)=>`30010${String(i).padStart(3,'0')}`).join('\n');
 const parsed=api.parseRoster(rows,{defaultGroupCode:'A'});
 assert.equal(parsed.ok,true);
 assert.equal(parsed.count,22);
 assert.deepEqual(plain(parsed.countByGroup),{A:22});
 assert.equal(parsed.invalid.length,0);
});

test('a two-column tab-separated paste assigns each student to its group',()=>{
 const api=load();
 const parsed=api.parseRoster('30012345\tA\n30012346\tA\n30012347\tB\n30012348\tB\n');
 assert.equal(parsed.ok,true);
 assert.deepEqual(plain(parsed.countByGroup),{A:2,B:2});
 assert.deepEqual(plain(parsed.entries[2]),{studentId:'30012347',groupCode:'B',line:3});
});

test('blank rows are ignored and whitespace is trimmed',()=>{
 const api=load();
 const parsed=api.parseRoster('  30012345  \n\n\t\n30012346\n   \n');
 assert.equal(parsed.count,2);
 assert.deepEqual(arr(parsed.studentIds),['30012345','30012346']);
 assert.equal(parsed.invalid.length,0);
 assert.equal(parsed.duplicates.length,0);
});

test('duplicate IDs inside one paste are reported, not silently dropped',()=>{
 const api=load();
 const parsed=api.parseRoster('30012345\n30012346\n30012345\n');
 assert.equal(parsed.count,2);
 assert.equal(parsed.ok,false);
 assert.equal(parsed.duplicates.length,1);
 assert.deepEqual(plain(parsed.duplicates[0]),{line:3,value:'30012345',studentId:'30012345',reason:'duplicate_in_paste',firstLine:1});
});

test('a student already in another group of the same course is rejected',()=>{
 const api=load();
 const parsed=api.parseRoster('30012345\tB\n',{existingMembership:{'30012345':'A'}});
 assert.equal(parsed.ok,false);
 assert.equal(parsed.duplicates.length,1);
 assert.equal(parsed.duplicates[0].reason,'already_in_another_group');
 assert.equal(parsed.duplicates[0].existingGroupCode,'A');
 // Re-pasting the same student into the same group is not an error.
 const sameGroup=api.parseRoster('30012345\tA\n',{existingMembership:{'30012345':'A'}});
 assert.equal(sameGroup.ok,true);
});

test('an invalid student ID is surfaced with its line number and blocks the save',()=>{
 const api=load();
 const parsed=api.parseRoster('30012345\nabc123\n300123\n12345\n3001234567890123\n');
 assert.equal(parsed.ok,false);
 // 30012345 and 300123 are valid; the other three rows are rejected.
 assert.equal(parsed.count,2);
 assert.deepEqual(plain(parsed.invalid).map(row=>[row.line,row.reason]),[[2,'invalid_shape'],[4,'invalid_shape'],[5,'invalid_shape']]);
 // The rejected values are preserved so the user can see what was refused.
 assert.equal(parsed.invalid[0].value,'abc123');
 assert.equal(api.validateStudentId('300123').valid,true);
 assert.equal(api.validateStudentId('').valid,false);
});

test('roster documents de-duplicate student IDs',()=>{
 const api=load();
 const roster=plain(api.rosterFor('g-a',{studentIds:['30012345','30012345','30012346','']}));
 assert.deepEqual(roster.studentIds,['30012345','30012346']);
 assert.equal(roster.groupId,'g-a');
});

test('the sanitized projection carries codes, colours and counts but never student IDs',()=>{
 const api=load();
 const session={labGroupIds:['g-a','g-b']};
 const groups=[api.createGroup({groupId:'g-a',groupCode:'A'}),api.createGroup({groupId:'g-b',groupCode:'B'})];
 const rosters={'g-a':{studentIds:['30012345','30012346']},'g-b':{studentIds:['30012347']}};
 const sanitized=plain(api.sanitizedGroups(session,groups,rosters));
 assert.deepEqual(sanitized,[
  {groupId:'g-a',groupCode:'A',colorKey:'group-a',studentCount:2},
  {groupId:'g-b',groupCode:'B',colorKey:'group-b',studentCount:1}
 ]);
 const blob=JSON.stringify(sanitized);
 assert.equal(blob.includes('30012345'),false);
 assert.equal(blob.includes('30012347'),false);
});

test('the calendar sanitizer strips every roster-shaped field',()=>{
 const api=load();
 const payload=api.sanitizeCalendarPayload({
  topic:'Neuro',room:'LAB 2',
  studentIds:['30012345'],roster:{studentIds:['30012345']},rosters:{'g-a':{studentIds:['30012345']}},studentNames:['A Student'],
  labGroups:[{groupId:'g-a',groupCode:'a',colorKey:'group-a',studentCount:2,studentIds:['30012345']}]
 });
 assert.equal('studentIds' in payload,false);
 assert.equal('roster' in payload,false);
 assert.equal('rosters' in payload,false);
 assert.equal('studentNames' in payload,false);
 assert.deepEqual(plain(payload.labGroups),[{groupId:'g-a',groupCode:'A',colorKey:'group-a',studentCount:2}]);
 assert.equal(JSON.stringify(payload).includes('30012345'),false);
});

test('LAB completion requires topic, at least one group and a roster for each group',()=>{
 const api=load();
 assert.deepEqual(arr(api.completionState({}).missing),['topic','labGroups']);
 assert.deepEqual(arr(api.completionState({topic:'Neuro'}).missing),['labGroups']);
 assert.deepEqual(arr(api.completionState({topic:'Neuro',labGroupIds:['g-a']},{'g-a':{studentIds:[]}}).missing),['labRoster']);
 const complete=api.completionState({topic:'Neuro',labGroupIds:['g-a','g-b']},{'g-a':{studentIds:['30012345']},'g-b':{studentIds:['30012346']}});
 assert.equal(complete.complete,true);
 assert.deepEqual(arr(complete.missing),[]);
});

test('only LAB, Developer and Owner may read student rosters',()=>{
 const api=load();
 for(const role of ['lab','developer','owner','adfa_general'])assert.equal(api.canReadRoster(role),true,role);
 for(const role of ['faculty','hicc','visc','other_office','adc','administrator','admin','adfa_regular',''])assert.equal(api.canReadRoster(role),false,role);
});
