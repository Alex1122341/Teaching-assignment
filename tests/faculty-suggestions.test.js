'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const load=()=>{const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'faculty-suggestions.js'),'utf8'),ctx);return ctx.window.UCVM_FACULTY_SUGGESTIONS;};
const arr=value=>Array.from(value||[]);
const plain=value=>JSON.parse(JSON.stringify(value));

test('actor contributions share one safe candidate projection with legacy suggestions',()=>{
 const api=load(),input={candidateKey:' opaque-1 ',displayName:' Dr X ',sourceRole:'hicc',note:'internal'};
 const candidate=api.safeCandidate(input);
 assert.deepEqual(plain(candidate),{candidateKey:'opaque-1',displayName:'Dr X'});
 assert.deepEqual(arr(api.CONTRIBUTION_SOURCES),['adc','lab','hicc']);
 assert.deepEqual(arr(api.OFFICES),['adc','lab']);
 const legacy=api.createSuggestion({candidateKey:input.candidateKey,displayName:input.displayName,office:'adc'});
 assert.deepEqual(plain(api.safeCandidate(legacy)),plain(candidate));
 candidate.displayName='Changed';
 assert.equal(input.displayName,' Dr X ');
 assert.equal(input.note,'internal');
});

test('safe candidates reject malformed scalar identity/name values and bounded overflow',()=>{
 const api=load();
 for(const value of [null,{},[],12,true,'','   ']){
  assert.throws(()=>api.safeCandidate({candidateKey:value,displayName:'Dr X'}));
  assert.throws(()=>api.safeCandidate({candidateKey:'opaque-1',displayName:value}));
 }
 assert.throws(()=>api.safeCandidate({candidateKey:'x'.repeat(257),displayName:'Dr X'}));
 assert.throws(()=>api.safeCandidate({candidateKey:'opaque-1',displayName:'x'.repeat(201)}));
 for(const candidateKey of ['faculty@example.test','opaque\nkey','opaque\u0000key']){
  assert.throws(()=>api.safeCandidate({candidateKey,displayName:'Dr X'}));
 }
 assert.doesNotThrow(()=>api.safeCandidate({candidateKey:'x'.repeat(256),displayName:'x'.repeat(200)}));
});

test('the canonical candidate boundary refuses known private fields and drops all other metadata',()=>{
 const api=load();
 for(const field of ['ucid','UCID','email','facultyId','employeeId','doeCredit','afcReason','hrData','salary']){
  assert.throws(()=>api.safeCandidate({candidateKey:'opaque-1',displayName:'Dr X',[field]:'secret'}));
 }
 const result=api.safeCandidate({candidateKey:'opaque-1',displayName:'Dr X',rawPrivateFacultyId:'secret',
  targetDOE:99,DOEVariance:1,privateProfile:{medical:'secret'},note:'internal',updatedAt:'NOW'});
 assert.deepEqual(plain(result),{candidateKey:'opaque-1',displayName:'Dr X'});
});

test('legacy writers also reject nested candidate fields instead of leaking private objects',()=>{
 const api=load();
 assert.throws(()=>api.sanitize({candidateKey:{ucid:'secret'},displayName:'Dr X'}));
 assert.throws(()=>api.createSuggestion({candidateKey:'opaque-1',displayName:{email:'secret'},office:'adc'}));
 assert.throws(()=>api.addSuggestion(api.emptyMetadata(),{candidateKey:'opaque-1',displayName:'Dr X',suggestedByOffice:'adc',email:'secret'}));
 assert.throws(()=>api.assertStorable({adc:[{candidateKey:'opaque-1',displayName:{email:'secret'}}]}));
});

test('ADC and LAB can each raise a suggestion with an opaque candidate key',()=>{
 const api=load();
 let metadata=api.emptyMetadata();
 metadata=api.addSuggestion(metadata,api.createSuggestion({candidateKey:'cand-1',displayName:'Dr X',office:'adc',actor:{uid:'u-adc'},at:'NOW'}));
 metadata=api.addSuggestion(metadata,api.createSuggestion({candidateKey:'cand-2',displayName:'Dr Y',office:'lab',actor:{uid:'u-lab'},at:'NOW'}));
 assert.deepEqual(plain(metadata.adc),[ {candidateKey:'cand-1',displayName:'Dr X',suggestedByOffice:'adc',suggestedBy:'u-adc',suggestedAt:'NOW'} ]);
 assert.equal(metadata.lab.length,1);
 assert.equal(metadata.lab[0].suggestedByOffice,'lab');
});

test('a suggestion only stores allowlisted fields',()=>{
 const api=load();
 const record=api.sanitize({candidateKey:'cand-1',displayName:'Dr X',suggestedByOffice:'adc',suggestedBy:'u-adc',suggestedAt:'NOW',extra:'ignored'});
 assert.deepEqual(Object.keys(record).sort(),['candidateKey','displayName','suggestedBy','suggestedByOffice','suggestedAt'].sort());
 assert.equal('extra' in record,false);
});

test('private Faculty data is refused outright',()=>{
 const api=load();
 for(const field of ['ucid','facultyId','email','doe','doeCredit','afcReason','awayFromCampusRecords','hrFullName','fte','salary']){
  assert.equal(api.isForbiddenKey(field),true,field);
  assert.throws(()=>api.assertSafe({candidateKey:'cand-1',displayName:'Dr X',[field]:'secret'}),/must not carry private fields/,field);
 }
 // Case variants are caught too.
 assert.equal(api.isForbiddenKey('UCID'),true);
 assert.equal(api.isForbiddenKey('DOECredit'),true);
 assert.deepEqual(arr(api.forbiddenKeysPresent({candidateKey:'k',displayName:'n',email:'a@b.c'})),['email']);
 assert.doesNotThrow(()=>api.assertSafe({candidateKey:'k',displayName:'n',suggestedByOffice:'adc',suggestedBy:'u',suggestedAt:null}));
});

test('only ADC and LAB may suggest Faculty',()=>{
 const api=load();
 for(const office of ['adfa','faculty','hicc',''])assert.throws(()=>api.createSuggestion({candidateKey:'cand-1',displayName:'Dr X',office}),/Only ADC or LAB may suggest Faculty/);
 assert.throws(()=>api.createSuggestion({candidateKey:'',displayName:'Dr X',office:'adc'}),/opaque candidate key/);
 assert.throws(()=>api.createSuggestion({candidateKey:'cand-1',displayName:'',office:'adc'}),/display name/);
});

test('re-suggesting the same candidate is idempotent',()=>{
 const api=load();
 const first=api.addSuggestion(api.emptyMetadata(),api.createSuggestion({candidateKey:'cand-1',displayName:'Dr X',office:'adc'}));
 const second=api.addSuggestion(first,api.createSuggestion({candidateKey:'cand-1',displayName:'Dr X',office:'adc'}));
 assert.equal(second.adc.length,1);
 const removed=api.removeSuggestion(second,{office:'adc',candidateKey:'cand-1'});
 assert.deepEqual(plain(removed.adc),[]);
});

test('a suggestion is never converted into an assignment',()=>{
 const api=load();
 assert.throws(()=>api.suggestionToAssignment({candidateKey:'cand-1',displayName:'Dr X'}),/is not an assignment/);
});

test('ADFA sees suggestions labelled by the office that raised them',()=>{
 const api=load();
 let metadata=api.emptyMetadata();
 metadata=api.addSuggestion(metadata,api.createSuggestion({candidateKey:'cand-1',displayName:'Dr X',office:'adc'}));
 metadata=api.addSuggestion(metadata,api.createSuggestion({candidateKey:'cand-2',displayName:'Dr Y',office:'adc'}));
 metadata=api.addSuggestion(metadata,api.createSuggestion({candidateKey:'cand-3',displayName:'Dr Z',office:'lab'}));
 const lines=plain(api.describeForAdfa(metadata));
 assert.deepEqual(lines,[
  {office:'adc',label:'ADC',names:['Dr X','Dr Y'],text:'Suggested by ADC: Dr X, Dr Y'},
  {office:'lab',label:'LAB',names:['Dr Z'],text:'Suggested by LAB: Dr Z'}
 ]);
 assert.deepEqual(plain(api.describeForAdfa(api.emptyMetadata())),[]);
});

test('stored metadata can be re-validated before it is written',()=>{
 const api=load();
 assert.equal(api.assertStorable(api.addSuggestion(api.emptyMetadata(),api.createSuggestion({candidateKey:'cand-1',displayName:'Dr X',office:'adc'}))),true);
 assert.throws(()=>api.assertStorable({adc:[{candidateKey:'cand-1',displayName:'Dr X',email:'x@y.z'}]}),/must not carry private fields/);
});
