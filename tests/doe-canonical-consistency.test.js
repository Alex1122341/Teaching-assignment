'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const DOE=require('../faculty-doe.js');
const DATA_INDEX=require('../data-index.js');

const cases=[
 ['object override',{doe:{teaching:40},doeOverride2026_27:{value:25,reason:'RSL'}},25,'RSL'],
 ['raw override',{doe:{teaching:40},doeOverride2026_27:25,overrideReason:'RSL'},25,'RSL'],
 ['legacy override',{doe:{teaching:40},overrideDOE:25,overrideReason:'RSL'},25,'RSL'],
 ['zero raw override',{doe:{teaching:40},doeOverride2026_27:0,overrideReason:'Approved zero'},0,'Approved zero'],
 ['zero legacy override',{doe:{teaching:40},overrideDOE:0,overrideReason:'Approved zero'},0,'Approved zero']
];

for(const [label,faculty,value,reason] of cases)test(`faculty index agrees with canonical DOE for ${label}`,()=>{
 const target=DOE.effectiveTarget(faculty);
 const entry=DATA_INDEX.facultyEntry('1001',faculty);
 assert.equal(target.source,'override');
 assert.equal(target.value,value);
 assert.equal(target.reason,reason);
 assert.equal(entry.overrideDOE,target.value);
 assert.equal(entry.overrideReason,target.reason);
});

test('faculty index and canonical helper agree when contract DOE is the effective target',()=>{
 const faculty={doe:{teaching:40}};
 const target=DOE.effectiveTarget(faculty);
 const entry=DATA_INDEX.facultyEntry('1001',faculty);
 assert.deepEqual(target,{value:40,source:'contract',reason:''});
 assert.equal(entry.overrideDOE,null);
 assert.equal(entry.overrideReason,'');
 assert.equal(entry.contractTeachingDOE,target.value);
});

test('Faculty Dashboard DOE list delegates effective target calculation to the canonical helper',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../faculty-admin-enhancements.js'),'utf8');
 assert.match(source,/UCVM_FACULTY_DOE\.effectiveTarget\(/);
 assert.doesNotMatch(source,/num\(f\?\.doeOverride2026_27\?\.value\)/);
});

test('pages load canonical DOE before data-index consumers',()=>{
 for(const file of ['index.html','faculty-admin.html','user-management.html']){
  const html=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const canonical=html.indexOf('src="faculty-doe.js"');
  const consumer=html.indexOf('src="data-index.js"');
  assert.ok(canonical>=0,`${file} must load faculty-doe.js`);
  assert.ok(consumer>=0,`${file} must load data-index.js`);
  assert.ok(canonical<consumer,`${file} must load faculty-doe.js before data-index.js`);
 }
});
