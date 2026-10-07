'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const roles=require('../temporal-role-assignment.js');

test('Teaching Assignment role year defaults to Sep 1 through the following May 1',()=>{
 assert.deepEqual(roles.defaultWindow('2026-27'),{activeDate:'2026-09-01',expirationDate:'2027-05-01'});
 assert.throws(()=>roles.defaultWindow('2026-28'),/following year/i);
});

test('custom active and expiration dates accept any valid day but expiration must be later',()=>{
 assert.deepEqual(roles.normalizeWindow({academicYear:'2026-27',activeDate:'2026-10-17',expirationDate:'2027-02-03'}),{activeDate:'2026-10-17',expirationDate:'2027-02-03'});
 assert.throws(()=>roles.normalizeWindow({academicYear:'2026-27',activeDate:'2027-03-01',expirationDate:'2027-03-01'}),/later than active/i);
 assert.throws(()=>roles.normalizeWindow({academicYear:'2026-27',activeDate:'2027-03-02',expirationDate:'2027-03-01'}),/later than active/i);
});

test('role windows are half-open so expiration day is already inactive',()=>{
 const row={academicYear:'2026-27',activeDate:'2026-09-01',expirationDate:'2027-03-01',active:true};
 assert.equal(roles.statusAt(row,'2026-08-31'),'scheduled');
 assert.equal(roles.statusAt(row,'2026-09-01'),'active');
 assert.equal(roles.statusAt(row,'2027-02-28'),'active');
 assert.equal(roles.statusAt(row,'2027-03-01'),'expired');
 assert.equal(roles.statusAt({...row,active:false},'2026-10-01'),'inactive');
});

test('DOE override is independent from dates and may be negative',()=>{
 assert.equal(roles.effectiveDoe(12,''),12);
 assert.equal(roles.effectiveDoe(12,null),12);
 assert.equal(roles.effectiveDoe(12,-3.5),-3.5);
 assert.equal(roles.effectiveDoe(12,0),0);
 assert.throws(()=>roles.normalizeDoeOverride('not-a-number'),/finite number/i);
});

test('annual copy shifts custom windows by Academic Year and clamps leap day safely',()=>{
 assert.deepEqual(roles.shiftWindow({academicYear:'2026-27',activeDate:'2026-09-01',expirationDate:'2027-03-01'},'2026-27','2027-28'),{activeDate:'2027-09-01',expirationDate:'2028-03-01'});
 assert.equal(roles.shiftDateYears('2028-02-29',1),'2029-02-28');
});

test('Calgary business date controls temporal role rollover instead of UTC date',()=>{
 assert.equal(roles.dateInTimeZone(new Date('2027-03-01T05:30:00Z')),'2027-02-28');
 assert.equal(roles.dateInTimeZone(new Date('2027-03-01T07:30:00Z')),'2027-03-01');
});

test('Calgary date boundaries resolve local midnight correctly across DST',()=>{
 assert.equal(roles.dateBoundaryIso('2027-01-15'),'2027-01-15T07:00:00.000Z');
 assert.equal(roles.dateBoundaryIso('2027-07-15'),'2027-07-15T06:00:00.000Z');
 assert.equal(roles.dateBoundaryIso('2027-03-14'),'2027-03-14T07:00:00.000Z');
 assert.equal(roles.dateBoundaryIso('2027-11-07'),'2027-11-07T06:00:00.000Z');
});
