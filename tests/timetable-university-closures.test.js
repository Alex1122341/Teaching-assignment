'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
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


test('standard exports label enabled University closures and emit them as all-day calendar events',()=>{
  const js=read('timetable.js');
  const filtered=js.slice(js.indexOf('function exportFilteredRows'),js.indexOf('function downloadFile'));
  assert.match(filtered,/closureCalendar\.entries/);
  assert.match(filtered,/sessionsWithOverlays/);

  const csv=js.slice(js.indexOf('function exportCsv'),js.indexOf('function icsEscape'));
  assert.match(csv,/['"]University Closure['"]/);
  assert.match(csv,/!!s\.isUniversityClosure/);

  const ics=js.slice(js.indexOf('function exportCalendar'),js.indexOf('function outlookAttendeesForSession'));
  assert.match(ics,/s\.isUniversityClosure\|\|s\.isCcc/);
  assert.match(ics,/University Closed/);
  assert.match(ics,/University Closure — read-only institutional calendar record/);
  assert.match(ics,/DTSTART;VALUE=DATE/);
});

test('Outlook teaching invitation paths defensively exclude University closures',()=>{
  const js=read('timetable.js');
  const exporter=js.slice(js.indexOf('function exportOutlookInvites'),js.indexOf('async function openOutlookInviteDialog'));
  assert.match(exporter,/filter\([^\n]*isUniversityClosure/);
  const dialog=js.slice(js.indexOf('async function openOutlookInviteDialog'),js.indexOf('\n  function ',js.indexOf('async function openOutlookInviteDialog')));
  assert.match(dialog,/filter\([^\n]*isUniversityClosure/);
});



test('academic week month range includes both Easter Monday closure dates',()=>{
  const source=read('timetable.js');
  const match=source.match(/  function monthRangeForAcademicPosition\([\s\S]*?\n  \}/);
  assert.ok(match,'monthRangeForAcademicPosition should be independently testable');
  const context={
    Date,
    weekStart:(week,semester)=>{
      if(semester==='spring')return new Date(2026,3,27);
      if(semester==='winter')return new Date(2027,2,22);
      return new Date(2026,8,1);
    },
    ymd:d=>d.toISOString().slice(0,10)
  };
  vm.runInNewContext(match[0]+'\nresult=monthRangeForAcademicPosition;',context);
  const spring=JSON.parse(JSON.stringify(context.result('spring',1)));
  const winter=JSON.parse(JSON.stringify(context.result('winter',12)));
  assert.deepEqual({start:spring.start,end:spring.end},{start:'2026-04-01',end:'2026-04-30'});
  assert.deepEqual({start:winter.start,end:winter.end},{start:'2027-03-01',end:'2027-03-31'});
  assert.ok(closures.between(spring.start,spring.end).some(row=>row.name==='Easter Monday'&&row.date==='2026-04-06'));
  assert.ok(closures.between(winter.start,winter.end).some(row=>row.name==='Easter Monday'&&row.date==='2027-03-29'));
});


test('Easter Monday projects to Winter Week 13 across Alberta daylight-saving time',()=>{
  const script=String.raw\`
    const fs=require('node:fs');
    const vm=require('node:vm');
    const closures=require('./university-closures');
    const source=fs.readFileSync('timetable.js','utf8');
    const academic=source.match(/  function academicPositionForDate\\([\\s\\S]*?\\n  \\}/);
    const overlay=source.match(/  function universityClosureRows\\([\\s\\S]*?\\n  \\}/);
    if(!academic||!overlay)throw new Error('required timetable functions not found');
    const context={
      Date,
      SPRING_BASE_MONDAY:new Date(2026,3,27),
      FALL_BASE_MONDAY:new Date(2026,7,24),
      WINTER_BASE_MONDAY:new Date(2027,0,4),
      WEEK_COUNT:17,
      addDays:(date,days)=>{const d=new Date(date);d.setDate(d.getDate()+days);return d;},
      closureCalendar:closures,
      showUniversityClosures:true,
      parseYmd:value=>{const [y,m,d]=String(value).split('-').map(Number);return new Date(y,m-1,d);}
    };
    vm.runInNewContext(academic[0]+'\\n'+overlay[0]+'\\nresult=universityClosureRows;',context);
    process.stdout.write(JSON.stringify(context.result('2027-03-29','2027-04-02')));
  \`;
  const run=spawnSync(process.execPath,['-e',script],{
    cwd:root,
    env:{...process.env,TZ:'America/Edmonton'},
    encoding:'utf8'
  });
  assert.equal(run.status,0,run.stderr);
  const rows=JSON.parse(run.stdout);
  const easter=rows.find(row=>row.date==='2027-03-29');
  assert.ok(easter,'Easter Monday closure should be projected');
  assert.equal(easter.week,13,'Easter Monday must remain in Winter Week 13 after the DST transition');
});
