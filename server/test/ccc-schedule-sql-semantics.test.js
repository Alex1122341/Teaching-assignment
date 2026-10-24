'use strict';
// The 057 procedure cannot execute on this machine (no Docker, no SQL instance).
// This test therefore models the procedure's selection rules in JavaScript and
// drives them from the *actual* fixture rows parsed out of the acceptance
// script, then asserts the acceptance script's own expectations against that
// independent derivation. It would have caught the 9-vs-10 fixture miscount
// without a database, and it exercises the real HTTP route, API gate and
// response allowlist end to end with the modelled rows.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const acceptance=fs.readFileSync(path.join(root,'database/azure-sql/057_ccc_schedule_read_acceptance.sql'),'utf8');
const {createCccScheduleApi}=require('../src/ccc/ccc-schedule-api');
const {createCccScheduleFunctions}=require('../src/runtime/swa-ccc-schedule-functions');

const FACULTY={ '@ActiveFaculty':{active:true,name:'Alexandre Ellis'}, '@OtherFaculty':{active:true,name:'Zoe Park'}, '@InactiveFaculty':{active:false,name:'Retired, Ina'} };
const UNASSIGNED='CAST(NULL AS uniqueidentifier)';

function fixtureRows(){
  // Anchor on the activity block's closing alias, then take the last
  // FROM(VALUES before it: earlier inserts in the file also use FROM(VALUES).
  const end=acceptance.indexOf(') rows(faculty,label,starts,ends,rowid,n,kind,stafflabel,block,col);');
  assert.ok(end>0,'synthetic CCC VALUES block is present');
  const start=acceptance.lastIndexOf('FROM(VALUES',end);
  assert.ok(start>0,'synthetic CCC VALUES keyword is present');
  const lines=acceptance.slice(start,end).split(/\r?\n/).filter(line=>line.trim().startsWith('('));
  return lines.map(line=>{
    const faculty=line.includes(UNASSIGNED)?UNASSIGNED:(line.match(/@(Active|Other|Inactive)Faculty/)[0]);
    const label=line.match(/N'([^']*)'/)[1];
    const dates=[...line.matchAll(/'(\d{4}-\d{2}-\d{2})'/g)].map(m=>m[1]);
    const rowNumber=Number(line.match(/@Row\d+,(\d+),/)[1]);
    const kind=line.match(/N'(assigned|unassigned)'/)[1];
    const block=line.match(/N'(Block \d+)'/)[1];
    const column=/N'D'/.test(line)?'D':null;
    return {category:'ccc',faculty,label,start:dates[0],end:dates[1],rowNumber,kind,block,column};
  });
}
function evidenceRows(){
  const start=acceptance.indexOf('INSERT paws.CalendarActivityDayTime');
  const end=acceptance.indexOf(') t(date,starts,ends)',start);
  assert.ok(start>=0&&end>start,'day-time evidence fixture is present');
  return [...acceptance.slice(start,end).matchAll(/'(\d{4}-\d{2}-\d{2})','(\d{2}:\d{2})','(\d{2}:\d{2})'/g)]
    .map(m=>({date:m[1],start:m[2],end:m[3]}));
}
function minutes(clock){const [h,m]=clock.split(':').map(Number);return h*60+m;}

// Mirrors paws_api.ListCccSchedule: category, half-open academic-year overlap,
// active-faculty-or-unassigned, Locum naming, and the half-day rule.
function listCccSchedule(rows,evidence,academicYear){
  const startYear=Number(academicYear.slice(0,4));
  const from=`${startYear}-05-01`, to=`${(startYear+1)}-05-01`;
  return rows
    .filter(row=>row.category==='ccc')
    .filter(row=>row.start<to&&row.end>=from)
    .filter(row=>row.faculty===UNASSIGNED?row.kind==='unassigned':FACULTY[row.faculty].active)
    .map(row=>{
      const unassigned=row.faculty===UNASSIGNED;
      const sameDay=row.start===row.end;
      const dayEvidence=evidence.filter(e=>e.date===row.start);
      const labelled=/half[- ]day/.test(row.label.toLowerCase());
      const shortVerified=dayEvidence.length===1&&(()=>{const d=minutes(dayEvidence[0].end)-minutes(dayEvidence[0].start);return d>=1&&d<=300;})();
      return {
        date:row.start,
        endDate:row.end,
        blockLabel:row.block,
        courseCode:'292',
        facultyName:unassigned?'Locum':FACULTY[row.faculty].name,
        halfDay:(sameDay&&(labelled||shortVerified))?1:0
      };
    })
    .sort((a,b)=>a.date.localeCompare(b.date)||a.endDate.localeCompare(b.endDate));
}

const rows=fixtureRows();
const evidence=evidenceRows();
// The non-CCC activity is a separate insert; it must never appear in the view.
assert.match(acceptance,/N'clinical_day',N'Not a CCC row','2026-11-07','2026-11-07'/);
rows.push({category:'clinical_day',faculty:'@ActiveFaculty',label:'Not a CCC row',start:'2026-11-07',end:'2026-11-07',rowNumber:14,kind:'assigned',block:null,column:null});

test('the parsed fixture is the one the acceptance script describes',()=>{
  assert.equal(rows.filter(row=>row.category==='ccc').length,12,'the fixture inserts exactly twelve CCC rows');
  assert.equal(rows.filter(row=>row.category!=='ccc').length,1,'the fixture inserts exactly one non-CCC activity');
  assert.equal(evidence.length,3,'the fixture inserts three day-time evidence rows');
  assert.equal(rows.filter(row=>row.faculty===UNASSIGNED).length,1);
  assert.equal(rows.filter(row=>row.kind==='unassigned').length,1);
  assert.equal(rows.filter(row=>row.faculty==='@InactiveFaculty').length,1);
});

test('the modelled procedure reproduces every expectation the acceptance script asserts',()=>{
  const inYear=listCccSchedule(rows,evidence,'2026-27');
  assert.equal(inYear.length,10,'2026-27 must contain ten active CCC rows');
  assert.equal(inYear.filter(entry=>entry.halfDay===1).length,2,'half day is the labelled row and the 120-minute row');
  assert.equal(inYear.filter(entry=>entry.facultyName==='Locum').length,1);
  assert.equal(inYear.filter(entry=>entry.facultyName==='Retired, Ina').length,0,'inactive faculty must not appear');
  assert.ok(inYear.some(entry=>entry.date==='2026-05-01'),'first day of the academic year is included');
  assert.ok(inYear.some(entry=>entry.date==='2027-04-30'),'last day of the academic year is included');
  assert.ok(!inYear.some(entry=>entry.date==='2027-05-01'),'next academic year is excluded');
  assert.ok(inYear.some(entry=>entry.date==='2026-10-23'&&entry.halfDay===1),'explicit label wins');
  assert.ok(inYear.some(entry=>entry.date==='2026-11-04'&&entry.halfDay===1),'verified 120-minute day is a half day');
  assert.ok(!inYear.some(entry=>entry.date==='2026-11-02'&&entry.halfDay===1),'a two-day record is not a half day');
  assert.ok(!inYear.some(entry=>entry.date==='2026-11-05'&&entry.halfDay===1),'a 480-minute day is not a half day');
  assert.equal(new Set(inYear.map(entry=>[entry.date,entry.endDate,entry.blockLabel,entry.facultyName].join('|'))).size,10,'no duplicate schedule rows');
  assert.ok(inYear.some(entry=>entry.date==='2026-10-21'&&entry.endDate==='2026-10-22'),'a distinct end date is preserved beside the shared start date');
  assert.ok(!inYear.some(entry=>entry.date==='2026-11-07'),'the non-CCC activity never appears');

  assert.equal(listCccSchedule(rows,evidence,'2027-28').length,1);
  assert.equal(listCccSchedule(rows,evidence,'2027-28')[0].date,'2027-05-01');
  assert.equal(listCccSchedule(rows,evidence,'2024-25').length,0);
});

test('every cardinality guard in the acceptance script equals the modelled count',()=>{
  const expected=listCccSchedule(rows,evidence,'2026-27').length;
  const guards=[...acceptance.matchAll(/<>\s*(\d+)\s+THROW 55790,'(?:Owner year coverage|CCC reader duplicated|CCC reader produced duplicate|Linked faculty|HICC did not|VISC did not|ADC did not|LAB did not)/g)];
  assert.equal(guards.length,8,'all eight cardinality guards are present');
  for(const guard of guards)assert.equal(Number(guard[1]),expected,'each guard must equal the modelled year count');
});

test('the modelled rows survive the real route, API gate and response allowlist',async()=>{
  const modelled=listCccSchedule(rows,evidence,'2026-27');
  const api=createCccScheduleApi({
    verifyToken:async()=>({uid:'actor'}),
    findUser:async()=>({active:true,mustChangePassword:false,baseRole:'owner'}),
    repository:{list:async()=>({entries:modelled})}
  });
  const route=createCccScheduleFunctions({api});
  const response=await route({url:'https://paws.invalid/api/v1/ccc-schedule?academicYear=2026-27',method:'GET',headers:new Headers({authorization:'Bearer token'})});
  assert.equal(response.status,200);
  assert.deepEqual(response.headers,{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  assert.equal(response.jsonBody.academicYear,'2026-27');
  assert.equal(response.jsonBody.entries.length,10);
  for(const entry of response.jsonBody.entries){
    assert.deepEqual(Object.keys(entry).sort(),['blockLabel','courseCode','date','endDate','facultyName','halfDay']);
    assert.equal(typeof entry.halfDay,'boolean','bit values must reach the client as booleans');
  }
  assert.equal(response.jsonBody.entries.filter(entry=>entry.halfDay).length,2);
  const serialised=JSON.stringify(response.jsonBody);
  assert.doesNotMatch(serialised,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i,'no identifiers may leak');
  assert.doesNotMatch(serialised,/@|ucid|doe|afc|fte|rank|stream/i,'no private fields may leak');
});
