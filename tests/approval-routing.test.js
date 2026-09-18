'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'approval-routing.js'),'utf8'),context);
  return context.window.UCVM_APPROVAL_ROUTING;
}

test('routes public scheduling fields to ADC and Faculty assignment to ADFA',()=>{
  const api=load();
  const route=api.build({
    base:{date:'2027-03-22',start:'14:45',end:'16:15',type:'LEC',topic:'Old',room:'A',instructor:'Dr A'},
    patch:{date:'2027-03-23',room:'B',instructor:'Dr B'}
  });
  assert.deepEqual([...route.scopes.adc],['date','room']);
  assert.deepEqual([...route.scopes.lab],[]);
  assert.deepEqual([...route.scopes.adfa],['instructor']);
  assert.deepEqual([...route.requiredOffices],['adc','adfa']);
  assert.equal(route.hasFacultyChange,true);
});

test('LAB topic is owned by LAB while ordinary topic is owned by ADC',()=>{
  const api=load();
  const lab=api.build({base:{type:'LAB',topic:'TBD'},patch:{topic:'Microscopy'}});
  assert.deepEqual([...lab.scopes.lab],['topic']);
  assert.deepEqual([...lab.scopes.adc],[]);
  assert.deepEqual([...lab.requiredOffices],['lab']);

  const lec=api.build({base:{type:'LEC',topic:'Old'},patch:{topic:'New'}});
  assert.deepEqual([...lec.scopes.adc],['topic']);
  assert.deepEqual([...lec.scopes.lab],[]);
});

test('type change recomputes topic ownership from the final type',()=>{
  const api=load();
  const toLab=api.build({base:{type:'LEC',topic:'Lecture'},patch:{type:'LAB',topic:'TBD'}});
  assert.deepEqual([...toLab.scopes.adc],['type']);
  assert.deepEqual([...toLab.scopes.lab],['topic']);
  assert.deepEqual([...toLab.requiredOffices],['adc','lab']);

  const fromLab=api.build({base:{type:'LAB',topic:'TBD'},patch:{type:'LEC',topic:'Lecture'}});
  assert.deepEqual([...fromLab.scopes.adc],['topic','type']);
  assert.deepEqual([...fromLab.scopes.lab],[]);
});

test('scope signatures are deterministic regardless of field order or patch key order',()=>{
  const api=load();
  const a=api.scopeSignature(['room','date'],{room:'B',date:'2027-03-23'});
  const b=api.scopeSignature(['date','room'],{date:'2027-03-23',room:'B'});
  assert.equal(a,b);
  assert.equal(a,JSON.stringify([['date','2027-03-23'],['room','B']]));
});
