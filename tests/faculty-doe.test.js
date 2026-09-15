'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const DOE=require('../faculty-doe.js');

test('override DOE wins over contract DOE',()=>{
 assert.deepEqual(
  DOE.effectiveTarget({doe:{teaching:40},doeOverride2026_27:{value:25,reason:'RSL'}}),
  {value:25,source:'override',reason:'RSL'}
 );
});

test('contract DOE is used when no override exists',()=>{
 assert.deepEqual(DOE.effectiveTarget({doe:{teaching:40}}),{value:40,source:'contract',reason:''});
});

test('effective target recognizes indexed faculty values',()=>{
 assert.equal(DOE.effectiveTarget({contractTeachingDOE:30,overrideDOE:20,overrideReason:'Leave'}).value,20);
 assert.equal(DOE.targetLabel({contractTeachingDOE:30,overrideDOE:20,overrideReason:'Leave'}),'Override DOE 20.00% · Leave');
});

test('missing DOE has an unavailable label',()=>{
 assert.deepEqual(DOE.effectiveTarget({}),{value:null,source:'none',reason:''});
 assert.equal(DOE.targetLabel({}),'DOE unavailable');
});
