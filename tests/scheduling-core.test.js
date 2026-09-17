'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function load(){
  const context={window:{},Date};
  vm.runInNewContext(fs.readFileSync(path.join(root,'scheduling-core.js'),'utf8'),context);
  return context.window.UCVM_SCHEDULING;
}

test('parseTime accepts supported forms and rejects impossible values',()=>{
  const api=load();
  assert.equal(api.parseTime('09:00'),540);
  assert.equal(api.parseTime('9:00'),540);
  assert.equal(api.parseTime('12:00 AM'),0);
  assert.equal(api.parseTime('12:00 PM'),720);
  assert.equal(api.parseTime('1:30 PM'),810);
  assert.equal(api.parseTime('24:00'),null);
  assert.equal(api.parseTime('09:60'),null);
  assert.equal(api.parseTime('13:00 PM'),null);
  assert.equal(api.parseTime(''),null);
});

test('interval validation rejects zero, reversed, and cross-midnight intervals',()=>{
  const api=load();
  assert.equal(api.validateInterval('09:00','10:00').status,'valid');
  assert.equal(api.validateInterval('10:00','10:00').status,'invalid');
  assert.equal(api.validateInterval('11:00','10:00').status,'invalid');
  assert.equal(api.validateInterval('23:30','00:30').status,'invalid');
  assert.equal(api.validateInterval('','',{timeUnknown:true}).status,'unknown');
});

test('duration and overlap use half-open interval semantics',()=>{
  const api=load();
  assert.equal(api.durationMinutes('09:00','10:30'),90);
  assert.equal(api.durationHours('09:00','10:30'),1.5);
  assert.equal(api.intervalsOverlap('09:00','10:00','10:00','11:00'),false);
  assert.equal(api.intervalsOverlap('09:00','10:01','10:00','11:00'),true);
  assert.equal(api.intervalsOverlap('09:00','11:00','09:30','10:00'),true);
  assert.equal(api.intervalsOverlap('bad','11:00','09:30','10:00'),null);
});

test('findFacultyConflicts separates real conflicts from unknown-time checks',()=>{
  const api=load();
  const sessions=[
    {id:'a',date:'2026-10-01',start:'09:00',end:'10:00',faculty:['f1']},
    {id:'b',date:'2026-10-01',start:'',end:'',timeUnknown:true,faculty:['f1']},
    {id:'c',date:'2026-10-02',start:'09:00',end:'10:00',faculty:['f1']}
  ];
  const assigned=s=>s.faculty.includes('f1');
  const result=api.findFacultyConflicts({date:'2026-10-01',start:'09:30',end:'10:30',sessions,isAssigned:assigned});
  assert.equal(result.status,'conflict');
  assert.deepEqual(Array.from(result.conflicts,x=>x.id),['a']);
  assert.deepEqual(Array.from(result.possibleConflicts,x=>x.id),['b']);
  const adjacent=api.findFacultyConflicts({date:'2026-10-01',start:'10:00',end:'11:00',sessions:[sessions[0]],isAssigned:assigned});
  assert.equal(adjacent.status,'clear');
});
