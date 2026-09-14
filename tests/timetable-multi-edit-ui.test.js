'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('timetable loads selection before its controller and exposes admin selection controls',()=>{
 const html=read('index.html'),js=read('timetable.js');
 assert.ok(html.indexOf('timetable-selection.js')<html.indexOf('timetable.js'));
 for(const id of ['select-sessions-btn','selection-cancel-btn','review-selected-btn','selection-count'])assert.match(html,new RegExp(`id=["']${id}["']`));
 assert.match(js,/selection-controls.*classList\.toggle\('hidden',\s*!canEdit\(\)\)/s);
});

test('selection mode routes every rendered session through stable IDs and blocks CCC selection',()=>{
 const js=read('timetable.js');
 assert.match(js,/function bindSessionBlocks[\s\S]*sessionSelection\.toggle/);
 assert.match(js,/if\s*\(s\?\.isCcc\)[\s\S]*return/);
 assert.match(js,/selectedRows\([\s\S]*selection.*ids\(\)/);
 assert.match(js,/viewMode\s*=\s*'list'/);
});

test('spreadsheet editor validates before one atomic commit and refreshes indexes afterward',()=>{
 const js=read('timetable.js');
 for(const field of ['date','year','course','type','start','end','topic','room','faculty'])assert.match(js,new RegExp(`data-selection-field=["']${field}["']`));
 assert.match(js,/planChanges\(/);
 assert.match(js,/firestoreSafeSession\(update\.data\)/);
 assert.match(js,/updatedBy:currentUser\.uid[\s\S]*updatedAt:timestamp/);
 assert.match(js,/commitPlan\(/);
 assert.match(js,/invalidateAllSessions\(\)[\s\S]*refreshDerivedIndexes\(\{rethrow:true\}\)/);
});
