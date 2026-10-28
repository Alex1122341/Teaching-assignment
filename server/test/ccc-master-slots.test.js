'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {publicActivity}=require('../src/data/sql-calendar-activity-repository');
const {createCalendarActivityView,renderRangeLane}=require('../../frontend/scripts/calendar-activities.js');
const locum={activityId:'slot-1',category:'ccc',staffingKind:'unassigned',staffingLabel:'Locum',blockLabel:'Example <Block>',facultyKey:null,facultyDisplayName:null,label:'CCC',startDate:'2026-10-20',endDate:'2026-10-20',timeStatus:'not_provided'};
test('unassigned CCC has a literal label and no invented faculty identity or private evidence',()=>{
 const row=publicActivity({...locum,facultyId:'private-id',privateNotes:'confidential',sourceColumn:'C'});
 assert.equal(row.staffingKind,'unassigned');assert.equal(row.staffingLabel,'Locum');assert.equal(row.facultyKey,null);assert.equal(row.facultyDisplayName,'Locum');assert.equal(row.blockLabel,'Example <Block>');assert.equal(Object.hasOwn(row,'facultyId'),false);assert.equal(JSON.stringify(row).includes('private'),false);
});
test('only literal unassigned CCC may bypass real assigned faculty presentation',()=>{
 for(const bad of [{...locum,category:'clinical_day'},{...locum,staffingLabel:'Unknown'},{...locum,facultyKey:'invented'},{...locum,staffingKind:'other'}])assert.throws(()=>publicActivity(bad),{code:'INVALID_CALENDAR_RESPONSE'});
});
test('public range shows Locum/block with escaped labels, keyword search and missing time',()=>{
 const original=JSON.stringify(locum);
 const html=renderRangeLane([locum],{start:'2026-10-01',end:'2026-11-01',filters:{search:'Locum'}});
 assert.match(html,/Locum/);assert.match(html,/Example &lt;Block&gt;/);assert.match(html,/Default time: 08:30–16:30/);assert.match(html,/Needs Review/);assert.doesNotMatch(html,/<Block>|09:00|faculty-id/);
 assert.equal(JSON.stringify(locum),original,'display default must not rewrite source time status or evidence');
});
test('personal schedule excludes unassigned staffing even if an adapter returns it',()=>{
 const view=createCalendarActivityView({api:{},getUser:()=>({uid:'test'})});
 assert.doesNotMatch(view.renderFacultyActivities([locum]),/Locum|Example/);
 assert.match(view.renderFacultyActivities([locum]),/0 ranges/);
});
