'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const closures=require('../university-closures');

test('timetable exposes an opt-in University closure control beside CCC',()=>{
  const html=read('index.html');
  assert.match(html,/id="show-ccc"/);
  assert.match(html,/id="show-university-closures"/);
  assert.match(html,/Show University Closures/);
  assert.ok(html.indexOf('show-ccc')<html.indexOf('show-university-closures'));
});

test('University closure overlay defaults off and reset turns it off',()=>{
  const js=read('timetable.js');
  assert.match(js,/showUniversityClosures\s*=\s*false/);
  assert.match(js,/showUniversityClosures=false/);
  assert.match(js,/\$\('show-university-closures'\)\.checked=false/);
});

test('University closure row projection carries exact display data',()=>{
  const source=read('timetable.js');
  const match=source.match(/  function universityClosureRows\([\s\S]*?\n  \}/);
  assert.ok(match,'universityClosureRows should be independently testable');
  const context={
    closureCalendar:closures,
    showUniversityClosures:true,
    parseYmd:value=>new Date(value+'T00:00:00Z'),
    academicPositionForDate:()=>({semester:'winter',week:7})
  };
  vm.runInNewContext(match[0]+'\nresult=universityClosureRows;',context);
  const rows=context.result('2027-02-15','2027-02-15');
  assert.equal(rows.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(rows[0])),{
    id:'closure-2027-02-15',
    date:'2027-02-15',
    week:7,
    semester:'winter',
    year:'',
    course:'UC',
    courseName:'University Closed',
    type:'CLOSURE',
    topic:'Family Day',
    instructor:'',
    assignments:[],
    room:'',
    start:'07:30',
    end:'17:00',
    timeUnknown:false,
    isUniversityClosure:true,
    sourceSystem:'UCalgary University Closure Calendar'
  });
});

test('closure overlays bypass teaching filters only after explicit opt-in',()=>{
  const js=read('timetable.js');
  assert.match(js,/if\(s\.isUniversityClosure\)return showUniversityClosures/);
  assert.match(js,/sessionsWithOverlays/);
  const courseStart=js.indexOf('function courseCodes');
  const courseEnd=js.indexOf('function populateCourseFilter',courseStart);
  assert.doesNotMatch(js.slice(courseStart,courseEnd),/University Closed|CLOSURE/);
});

test('closure rendering has dedicated day week month list copy and styling',()=>{
  const js=read('timetable.js'),css=read('timetable.css');
  assert.match(js,/University Closed/);
  assert.match(js,/Institutional closure/);
  assert.match(js,/isUniversityClosure/);
  assert.match(css,/\.tg-type-closure/);
  assert.match(css,/html\.dark[\s\S]*tg-type-closure/);
});

test('closure details are read-only institutional records',()=>{
  const js=read('timetable.js');
  assert.match(js,/University Closure — read-only institutional calendar record/);
  assert.match(js,/UCalgary University Closure Calendar/);
});

test('closure rows stay in render/export projection and out of core teaching data',()=>{
  const js=read('timetable.js');
  assert.match(js,/sessions:\(\)=>pageSessions\(\)/);
  const pageData=js.slice(js.indexOf('window.UCVM_PAGE_DATA='),js.indexOf('let scheduleSource'));
  assert.doesNotMatch(pageData,/sessionsWithOverlays|universityClosureRows/);
  const schedulingStart=js.indexOf('function reviewSchedulingChanges');
  const schedulingEnd=js.indexOf('function confirmSchedulingChanges',schedulingStart);
  assert.ok(schedulingStart>=0&&schedulingEnd>schedulingStart);
  const schedulingReview=js.slice(schedulingStart,schedulingEnd);
  assert.doesNotMatch(schedulingReview,/sessionsWithOverlays|universityClosureRows/);
  const derivedStart=js.indexOf('async function updateDerivedIndexes');
  const derivedEnd=js.indexOf('function ensureFacultyDirectory',derivedStart);
  assert.ok(derivedStart>=0&&derivedEnd>derivedStart);
  const derived=js.slice(derivedStart,derivedEnd);
  assert.doesNotMatch(derived,/sessionsWithOverlays|universityClosureRows/);
});
