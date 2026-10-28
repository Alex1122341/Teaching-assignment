'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../tools/pages-demo-api/repos/swap.js'),'utf8');
const start=src.indexOf('const canOverrideStage = role =>'),end=src.indexOf('\nfunction canSee(store, r, uid)',start);
if(start<0||end<start)throw Error('Missing synthetic SWAP approval role policy');
const policy=src.slice(start,end);
const users=[
  {firebaseUid:'dev',baseRole:'developer',active:true},
  {firebaseUid:'owner',baseRole:'owner',active:true},
  {firebaseUid:'general',baseRole:'adfa_general',active:true},
  {firebaseUid:'regular',baseRole:'adfa_regular',active:true},
  {firebaseUid:'adc',baseRole:'adc',active:true},
  {firebaseUid:'lab',baseRole:'lab',active:true},
  {firebaseUid:'visc',baseRole:'visc',facultyId:'fv',active:true},
  {firebaseUid:'other-visc',baseRole:'visc',facultyId:'other',active:true},
  {firebaseUid:'faculty',baseRole:'faculty',facultyId:'ff',active:true},
  {firebaseUid:'replacement',baseRole:'faculty',facultyId:'fr',active:true}
];
const store={tables:{users,faculty:[{facultyId:'fr',candidateKey:'c1'}],
  sessions:[{id:'s1',date:'2026-11-01',academicYear:'2026-27',subjectKey:'Anatomy'},
            {id:'s2',date:'2026-11-01',academicYear:'2026-27',subjectKey:null}],
  roles:[{roleType:'VISC',facultyId:'fv',academicYear:'2026-27',courseOrSubjectOrRotation:'Anatomy',
    effectiveDate:'2026-07-01',expirationDate:'2027-06-30'}]}};
const ctx={
  userOf:(s,uid)=>s.tables.users.find(u=>u.firebaseUid===uid)||{},
  facultyByCandidate:(s,key)=>s.tables.faculty.find(f=>f.candidateKey===key)||null,
  isAdministratorRole:role=>['developer','owner','adfa_general','adfa_regular','administrator','admin'].includes(role)
};
vm.createContext(ctx);vm.runInContext(policy+'\nthis.allowed=canDecideStage;',ctx);
const allowed=(uid,stage,extra={})=>ctx.allowed(store,{sessionId:extra.sessionId||'s1',status:'pending',nextStage:stage,
  changes:{replacementCandidateKey:'c1'},notifyReplacement:extra.notifyReplacement===true},uid);
test('ADFA Regular handles ADFA final, not ADC/LAB/VISC early stages',()=>{
  assert.equal(allowed('regular','adfa'),true);
  for(const stage of ['adc','lab','visc'])assert.equal(allowed('regular',stage),false);
});
test('Developer, Owner and ADFA General may act on earlier office stages with override',()=>{
  for(const uid of ['dev','owner','general'])for(const stage of ['adc','lab','visc'])assert.equal(allowed(uid,stage),true);
  assert.match(src,/A recorded override reason is required/);
});
test('ADC and LAB can approve their respective stage only',()=>{
  assert.equal(allowed('adc','adc'),true);assert.equal(allowed('adc','lab'),false);
  assert.equal(allowed('lab','lab'),true);assert.equal(allowed('lab','adc'),false);
  assert.equal(allowed('faculty','adc'),false);
});
test('VISC scope requires an explicit subject assignment',()=>{
  assert.equal(allowed('visc','visc'),true);
  assert.equal(allowed('other-visc','visc'),false);
  assert.equal(allowed('visc','visc',{sessionId:'s2'}),false);
});
test('VISC appointment must be effective on the session date',()=>{
  store.tables.roles[0].expirationDate='2026-10-01';
  assert.equal(allowed('visc','visc'),false);
  store.tables.roles[0].expirationDate='2027-06-30';
  assert.equal(allowed('visc','visc'),true);
});
test('only one active notified linked account can provide replacement consent',()=>{
  assert.equal(allowed('replacement','target',{notifyReplacement:true}),true);
  assert.equal(allowed('replacement','target'),false);
  assert.equal(allowed('general','target',{notifyReplacement:true}),false);
  users.push({firebaseUid:'duplicate',baseRole:'faculty',facultyId:'fr',active:true});
  assert.equal(allowed('replacement','target',{notifyReplacement:true}),false);
  users.pop();
});
test('known seeded ADFA-stage synthetic SWAP has recorded target consent',()=>{
  const {createStore}=require('../tools/pages-demo-api/store.js');
  const {list}=require('../tools/pages-demo-api/repos/swap.js');
  const requests=list(createStore());
  const seeded=requests.find(row=>row.status==='pending'&&row.nextStage==='adfa'&&row.notifyReplacement);
  assert.ok(seeded,'expected seeded ADFA decision fixture');
  assert.ok(seeded.history.some(h=>h.stage==='target'&&h.decision==='approve'));
});
