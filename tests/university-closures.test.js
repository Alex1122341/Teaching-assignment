'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const closures=require('../university-closures');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('University closure catalog is sorted unique and carries display names',()=>{
  const dates=closures.entries.map(row=>row.date);
  assert.deepEqual(dates,[...dates].sort());
  assert.equal(new Set(dates).size,dates.length);
  assert.deepEqual(closures.get('2027-02-15'),{
    date:'2027-02-15',
    name:'Family Day',
    category:'university_closure'
  });
  assert.equal(closures.get('2027-09-30').name,'National Day for Truth and Reconciliation');
  assert.equal(closures.get('2027-12-27').name,'Holiday Observance — University Closed');
  assert.equal(closures.get('2027-04-01'),null);
});

test('closure range lookup is inclusive and date-only safe',()=>{
  assert.deepEqual(
    closures.between('2027-03-26','2027-03-29').map(row=>row.date),
    ['2027-03-26','2027-03-29']
  );
  assert.deepEqual(closures.between('2027-03-27','2027-03-28'),[]);
  assert.deepEqual(closures.between('bad','2027-03-29'),[]);
});

test('working days exclude weekends and catalog closures exactly once',()=>{
  assert.equal(closures.countWorkingDays('2026-09-28','2026-10-02'),4);
  assert.equal(closures.countWorkingDays('2026-12-21','2027-01-04'),5);
  assert.equal(closures.countWorkingDays('2027-02-13','2027-02-15'),0);
  assert.equal(closures.countWorkingDays('2027-02-16','2027-02-16'),1);
  assert.equal(closures.countWorkingDays('','2027-02-16'),0);
  assert.equal(closures.countWorkingDays('2027-02-17','2027-02-16'),0);
});


test('shared closure module ships in the static deployment allowlist',()=>{
  const assets=JSON.parse(read('tools/static-assets.json'));
  assert.ok(assets.includes('university-closures.js'));
});

test('timetable loads closure calendar before both timetable and AFC consumers',()=>{
  const html=read('index.html');
  const closure=html.indexOf('university-closures.js');
  const timetable=html.indexOf('timetable.js');
  const afc=html.indexOf('afc-workflow.js');
  assert.ok(closure>=0);
  assert.ok(closure<timetable,'closure calendar loads before timetable.js');
  assert.ok(closure<afc,'closure calendar loads before afc-workflow.js');
});


test('closure coverage is explicit and blocks unreviewed future workday calculations',()=>{
  assert.equal(closures.coverage.startDate,'2026-01-01');
  assert.equal(closures.coverage.endDate,'2027-12-31');
  assert.equal(closures.coverage.timeZone,'America/Edmonton');
  assert.equal(closures.coverageStatus('2027-12-01','2027-12-31').supported,true);
  const future=closures.coverageStatus('2028-01-01','2028-01-31');
  assert.equal(future.valid,true);
  assert.equal(future.supported,false);
  assert.equal(future.afterCoverage,true);
  assert.match(closures.coverageMessage(future),/verified only through .*2027/i);
  assert.throws(
    ()=>closures.countWorkingDays('2028-01-01','2028-01-31'),
    error=>error instanceof RangeError&&error.code==='UNIVERSITY_CLOSURE_COVERAGE'&&/2027/.test(error.message)
  );
});

test('known closures remain queryable when a display range extends beyond verified coverage',()=>{
  assert.deepEqual(
    closures.between('2027-12-27','2028-01-05').map(row=>row.date),
    ['2027-12-27','2027-12-28','2027-12-29','2027-12-30','2027-12-31']
  );
});

test('closure maintenance uses the Calgary calendar day rather than UTC rollover',()=>{
  assert.equal(closures.calendarDate(new Date('2026-09-21T01:00:00Z')),'2026-09-20');
  assert.equal(closures.calendarDate(new Date('2026-09-21T07:00:00Z')),'2026-09-21');
  assert.equal(closures.maintenanceStatus(new Date('2027-10-01T01:00:00Z')).asOfDate,'2027-09-30');
});

test('only maintenance roles receive proactive review warnings',()=>{
  assert.equal(closures.maintenanceRole('faculty'),false);
  assert.equal(closures.maintenanceRole('lab'),false);
  assert.equal(closures.maintenanceRole('adfa_regular'),false);
  assert.equal(closures.maintenanceRole('developer'),true);
  assert.equal(closures.maintenanceRole('owner'),true);
  assert.equal(closures.maintenanceRole('adfa general'),true);
  assert.equal(closures.maintenanceStatus('2027-01-01').status,'current');
  assert.equal(closures.maintenanceStatus('2027-10-01').status,'review_due');
  assert.equal(closures.maintenanceStatus('2028-01-01').status,'expired');
});

test('dismissed closure warnings can be shown again for the same out-of-range dates',()=>{
  const source=read('university-closures.js');
  assert.match(source,/close\.onclick=\(\)=>\{box\.remove\(\);browserWarningKey=''\}/);
  assert.doesNotMatch(source,/if\(typeof document!=='undefined'\)\{\s*const health=maintenanceStatus/);
});
