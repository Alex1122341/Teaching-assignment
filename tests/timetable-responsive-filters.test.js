'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Schedule filters markup has one accessible always-visible toggle',()=>{
 const html=read('index.html'),css=read('timetable.css');
 assert.match(html,/id="schedule-filter-toggle"[^>]*aria-controls="schedule-filter-panel"[^>]*aria-expanded="true"/);
 assert.match(html,/id="schedule-filter-panel"/);
 assert.doesNotMatch(html,/id="filter-toggle-btn"/);
 assert.match(css,/@media\s*\(max-width:\s*900px\)/);
 assert.match(css,/\.schedule-filter-panel\[hidden\]/);
});

test('Schedule filters default by viewport and honor tab preference',()=>{
 const source=read('timetable.js');
 const fn=source.match(/  function initialScheduleFiltersExpanded\([\s\S]*?\n  \}/)?.[0];
 assert.ok(fn,'initialScheduleFiltersExpanded should be independently testable');
 const context={};vm.runInNewContext(`${fn}\nresult=initialScheduleFiltersExpanded;`,context);
 assert.equal(context.result({matches:true},null),false);
 assert.equal(context.result({matches:false},null),true);
 assert.equal(context.result({matches:true},'true'),true);
 assert.equal(context.result({matches:false},'false'),false);
 assert.match(source,/sessionStorage\.setItem\(SCHEDULE_FILTERS_KEY/);
 assert.match(source,/aria-expanded/);
});
