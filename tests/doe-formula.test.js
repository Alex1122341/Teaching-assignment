'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const FORMULA=require('../doe-formula.js');

test('evaluates arithmetic with normal precedence',()=>{
  assert.equal(FORMULA.evaluate('hours * rate',{hours:6,rate:.30}),1.8);
  assert.equal(FORMULA.evaluate('2 + 3 * 4',{}),14);
  assert.equal(FORMULA.evaluate('(2 + 3) * 4',{}),20);
  assert.equal(FORMULA.evaluate('-hours + 10',{hours:3}),7);
});

test('evaluates comparisons and ternary expressions',()=>{
  assert.equal(
    FORMULA.evaluate('trainees <= 2 ? trainees * 0.5 : 1 + (trainees - 2) * 0.25',{trainees:4}),
    1.5
  );
  assert.equal(FORMULA.evaluate('hours > 5 ? 10 : 2',{hours:6}),10);
  assert.equal(FORMULA.evaluate('hours == 6 ? 1 : 0',{hours:6}),1);
  assert.equal(FORMULA.evaluate('hours != 6 ? 1 : 0',{hours:5}),1);
});

test('evaluates only the approved DOE helper functions',()=>{
  assert.equal(FORMULA.evaluate('min(trainees * rate, cap)',{trainees:12,rate:.5,cap:4}),4);
  assert.equal(FORMULA.evaluate('max(hours, minimum)',{hours:2,minimum:5}),5);
  assert.equal(FORMULA.evaluate('round(2.6) + floor(2.9) + ceil(2.1) + abs(-3)',{}),11);
});

test('validate accepts only explicitly declared identifiers',()=>{
  assert.doesNotThrow(()=>FORMULA.validate('hours * rate',{allowedIdentifiers:['hours','rate']}));
  assert.throws(
    ()=>FORMULA.validate('hours * hiddenRate',{allowedIdentifiers:['hours','rate']}),
    error=>error&&error.code==='FORMULA_IDENTIFIER_NOT_ALLOWED'&&error.identifier==='hiddenRate'
  );
});

test('rejects executable JavaScript, member access, assignment, and arbitrary calls',()=>{
  const cases=[
    'window.alert(1)',
    'firebase.firestore()',
    'constructor.constructor(1)',
    'faculty.__proto__',
    'Math.max(hours,1)',
    'hours = 10',
    'unknown(hours)'
  ];
  for(const source of cases){
    assert.throws(
      ()=>FORMULA.validate(source,{allowedIdentifiers:['hours']}),
      error=>Boolean(error&&error.code),
      source
    );
  }
});

test('rejects missing and non-finite runtime identifiers',()=>{
  assert.throws(
    ()=>FORMULA.evaluate('hours * rate',{hours:6}),
    error=>error&&error.code==='FORMULA_IDENTIFIER_MISSING'&&error.identifier==='rate'
  );
  assert.throws(
    ()=>FORMULA.evaluate('hours * rate',{hours:Infinity,rate:.3}),
    error=>error&&error.code==='FORMULA_VALUE_NON_FINITE'&&error.identifier==='hours'
  );
});

test('fails closed on division by zero and non-finite output',()=>{
  assert.throws(
    ()=>FORMULA.evaluate('hours / divisor',{hours:2,divisor:0}),
    error=>error&&error.code==='FORMULA_DIVIDE_BY_ZERO'
  );
  assert.throws(
    ()=>FORMULA.evaluate('1e308 * 1e308',{}),
    error=>error&&error.code==='OUTPUT_NON_FINITE'
  );
});

test('parse returns a data AST rather than executable JavaScript',()=>{
  const ast=FORMULA.parse('hours * rate + 1');
  assert.equal(ast.type,'binary');
  assert.equal(ast.operator,'+');
  assert.equal(ast.left.type,'binary');
  assert.equal(ast.left.operator,'*');
  assert.deepEqual(
    JSON.parse(JSON.stringify(ast.right)),
    {type:'number',value:1}
  );
});

test('syntax errors return typed parse errors',()=>{
  for(const source of ['','hours +','min(','1..2','? 1 : 2']){
    assert.throws(
      ()=>FORMULA.parse(source),
      error=>error&&error.code==='FORMULA_PARSE_ERROR',
      source
    );
  }
});
