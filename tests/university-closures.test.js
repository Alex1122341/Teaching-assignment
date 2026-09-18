'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const closures=require('../university-closures');

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
