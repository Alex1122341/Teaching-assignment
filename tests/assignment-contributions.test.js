'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const load = () => {
  const file = path.join(root, 'assignment-contributions.js');
  assert.ok(fs.existsSync(file), 'Task 5 contribution domain module must exist');
  return require(file);
};
const input = (overrides = {}) => ({sessionId:'s1', sourceRole:'adc', actorUid:'actor-a',
  suggestions:[{candidateKey:'cand-1', displayName:'Dr One'}], ...overrides});
const stored = (overrides = {}) => ({id:'ac-v1__s1__adc__actor-a', ...input(), ...overrides});

for (const sourceRole of ['adc','lab','hicc']) {
  test(`${sourceRole} creates an independent safe contribution`, () => {
    const api = load();
    const result = api.createContribution(input({sourceRole}));
    assert.deepEqual(result, {id:`ac-v1__s1__${sourceRole}__actor-a`, sessionId:'s1', sourceRole,
      actorUid:'actor-a', suggestions:[{candidateKey:'cand-1', displayName:'Dr One'}]});
    assert.deepEqual(api.sanitizeContribution(result), result);
  });
}

test('unsupported and malformed sources cannot become peer contributors', () => {
  const api = load();
  for (const sourceRole of ['visc','adfad','adfa','faculty','developer','other_office','dvm','ADC',' adc ','',null,{},['adc']]) {
    assert.throws(() => api.createContribution(input({sourceRole})), /source/i);
    assert.throws(() => api.documentId('s1',sourceRole,'actor-a'), /source/i);
  }
});

test('document identity is deterministic, unambiguous and safe for Firestore paths', () => {
  const api = load();
  assert.equal(api.documentId('s1','adc','actor-a'), 'ac-v1__s1__adc__actor-a');
  assert.equal(api.documentId('a/b__%','hicc','u/v__%'), 'ac-v1__a%2Fb%5F%5F%25__hicc__u%2Fv%5F%5F%25');
  const ids = [
    ['s1','adc','actor-a'], ['s1','adc','actor-b'], ['s1','lab','actor-a'], ['s1','hicc','actor-a'],
    ['s1__adc','lab','actor-a'], ['s1','adc','lab__actor-a'], ['a/b','adc','u'], ['a%2Fb','adc','u'],
    ['café','adc','u'], ['cafe\u0301','adc','u']
  ].map(args => api.documentId(...args));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.ok(!id.includes('/'));
    assert.ok(Buffer.byteLength(id,'utf8') <= 1500);
  }
});

test('blank, noncanonical, nonscalar and overlong identities fail closed', () => {
  const api = load();
  for (const value of ['', ' ', ' s1', 's1 ', null, undefined, 1, {}, [], '\ud800', 'x'.repeat(1501)]) {
    assert.throws(() => api.documentId(value,'adc','actor-a'));
    assert.throws(() => api.documentId('s1','adc',value));
  }
  assert.throws(() => api.documentId('界'.repeat(256),'adc','界'.repeat(256)), /identity|1500|long/i);
});

test('stored and expected document identities prevent actor or source masquerading', () => {
  const api = load();
  for (const override of [{actorUid:'actor-b'}, {sourceRole:'lab'}, {sourceRole:'hicc'}, {sessionId:'s2'}]) {
    assert.throws(() => api.sanitizeContribution(stored(override)), /identity|id/i);
    assert.throws(() => api.createContribution(stored(override)), /identity|id/i);
  }
  assert.throws(() => api.sanitizeContribution(stored(), 'ac-v1__s1__adc__actor-b'), /identity|id/i);
  assert.throws(() => api.sanitizeContribution(input()), /identity|id/i);
  assert.deepEqual(api.sanitizeContribution(input(), 'ac-v1__s1__adc__actor-a'), stored());
});

test('safe candidate projection trims fields, strips unknown metadata and returns defensive copies', () => {
  const api = load();
  const candidate = {candidateKey:' cand-1 ',displayName:' Dr One ',extra:{privatePayload:'drop'},note:'drop'};
  const original = input({suggestions:[candidate]});
  const result = api.createContribution(original);
  assert.deepEqual(result.suggestions,[{candidateKey:'cand-1',displayName:'Dr One'}]);
  result.suggestions[0].displayName = 'Changed';
  result.suggestions.push({candidateKey:'cand-2',displayName:'Dr Two'});
  assert.equal(candidate.displayName,' Dr One ');
  assert.equal(original.suggestions.length,1);
});

test('private Faculty fields fail closed in candidates and contribution envelopes', () => {
  const api = load();
  const fields = ['UCID','email','facultyId','faculty_id','employeeId','doe',
    'afcReason','awayFromCampusRecords','hrData','salary'];
  for (const field of fields) {
    assert.throws(() => api.createContribution(input({suggestions:[{candidateKey:'cand-1',displayName:'Dr One',[field]:'secret'}]})), /private/i, field);
    assert.throws(() => api.createContribution(input({[field]:'secret'})), /private/i, field);
  }
  const privateExtras = {exactDOE:10,targetDOE:20,doeVariance:-10,medical:'private',leave:'private',privateProfile:{email:'private'}};
  const result = api.createContribution(input({...privateExtras,suggestions:[{candidateKey:'c',displayName:'Dr',...privateExtras}]}));
  for (const field of Object.keys(privateExtras)) assert.equal(field in result,false);
  assert.deepEqual(result.suggestions,[{candidateKey:'c',displayName:'Dr'}]);
});

test('malformed candidate data and suggestion collections fail closed', () => {
  const api = load();
  for (const suggestions of [null,{},'cand-1',[null],[{}],[{candidateKey:[],displayName:'Dr One'}],
    [{candidateKey:'c',displayName:{}}],[{candidateKey:'',displayName:'Dr One'}],
    [{candidateKey:'x'.repeat(257),displayName:'Dr One'}],[{candidateKey:'c',displayName:'x'.repeat(201)}]]) {
    assert.throws(() => api.createContribution(input({suggestions})));
  }
  assert.deepEqual(api.createContribution(input({suggestions:[]})).suggestions,[]);
});

test('notes are optional scalar trimmed text with a 2000-character maximum', () => {
  const api = load();
  assert.equal('note' in api.createContribution(input()),false);
  assert.equal(api.createContribution(input({note:'  internal  '})).note,'internal');
  assert.equal(api.createContribution(input({note:'x'.repeat(2000)})).note.length,2000);
  for (const note of ['x'.repeat(2001),null,1,false,[],{},new String('text')]) {
    assert.throws(() => api.createContribution(input({note})), /note/i);
  }
});

test('optional context uses canonical Subject keys and never infers Subject from Topic', () => {
  const api = load();
  const result = api.createContribution(input({course:' VTMD 505 ',subjectKey:'surgery',actorDisplayName:' Actor A ',topic:'other',extra:'drop'}));
  assert.equal(result.course,'VTMD 505');
  assert.equal(result.subjectKey,'surgery');
  assert.equal(result.actorDisplayName,'Actor A');
  assert.equal('topic' in result,false);
  assert.equal('extra' in result,false);
  assert.equal('subjectKey' in api.createContribution(input({topic:'Surgery'})),false);
  for (const subjectKey of ['Surgery',' surgery ','surgery|*','',null,{},'*']) {
    assert.throws(() => api.createContribution(input({subjectKey})), /subject/i);
  }
  for (const field of ['course','actorDisplayName']) {
    for (const value of [null,{},[],42,'x'.repeat(201)]) assert.throws(() => api.createContribution(input({[field]:value})));
  }
});

test('timestamps are optional caller-supplied deterministic scalar metadata', () => {
  const api = load();
  assert.equal('updatedAt' in api.createContribution(input()),false);
  for (const updatedAt of [null,0,1750000000000,'2026-09-22T12:00:00.000Z']) {
    assert.equal(api.createContribution(input({updatedAt})).updatedAt,updatedAt);
  }
  for (const updatedAt of [{seconds:1},[],new Date(),Infinity,NaN,-1,0.5,'NOW','2026-99-99T00:00:00.000Z']) {
    assert.throws(() => api.createContribution(input({updatedAt})), /updatedAt|timestamp/i);
  }
});

test('multiple actors and sources coexist with safe provenance and deterministic order', () => {
  const api = load();
  const records = [api.createContribution(input({sourceRole:'hicc'})),api.createContribution(input({sourceRole:'lab'})),
    api.createContribution(input({actorUid:'actor-b'})), api.createContribution(input({note:'internal',updatedAt:0,actorDisplayName:'Actor A'}))];
  const result = api.suggestionsForAdfad(records);
  assert.deepEqual(result.map(row => [row.sourceRole,row.contributionId]),[
    ['adc','ac-v1__s1__adc__actor-a'],['adc','ac-v1__s1__adc__actor-b'],['hicc','ac-v1__s1__hicc__actor-a'],['lab','ac-v1__s1__lab__actor-a']]);
  assert.deepEqual(result[0],{sessionId:'s1',candidateKey:'cand-1',displayName:'Dr One',sourceRole:'adc',contributionId:'ac-v1__s1__adc__actor-a',actorDisplayName:'Actor A'});
  assert.deepEqual(api.suggestionsForAdfad([...records].reverse()),result);
  assert.equal(JSON.stringify(result).includes('internal'),false);
  for (const row of result) for (const key of ['note','updatedAt','actorUid','assignments','facultyIds','instructor']) assert.equal(key in row,false);
});

test('duplicate suggestions normalize deterministically without conflating opaque keys with display names', () => {
  const api = load();
  const suggestions = [{candidateKey:'b',displayName:'Same Name'}, {candidateKey:'a',displayName:'Same Name'}, {candidateKey:'a',displayName:'Same Name'}];
  const first = api.createContribution(input({suggestions}));
  assert.deepEqual(first.suggestions,[{candidateKey:'a',displayName:'Same Name'},{candidateKey:'b',displayName:'Same Name'}]);
  assert.deepEqual(api.createContribution(input({suggestions:[...suggestions].reverse()})),first);
  assert.throws(() => api.createContribution(input({suggestions:[{candidateKey:'a',displayName:'One'},{candidateKey:'a',displayName:'Two'}]})), /conflict|duplicate/i);
});

test('malformed and conflicting duplicate contributions fail closed independently of input order', () => {
  const api = load();
  const valid = stored();
  assert.equal(api.suggestionsForAdfad([valid,{...valid}]).length,1);
  for (const bad of [null,{},stored({actorUid:'actor-b'}),stored({suggestions:[{candidateKey:'c',displayName:'Dr',email:'secret'}]}),
    stored({suggestions:[{candidateKey:'different',displayName:'Other'}]}),stored({note:'conflicting snapshot'})]) {
    assert.throws(() => api.suggestionsForAdfad([valid,bad]));
    assert.throws(() => api.suggestionsForAdfad([bad,valid]));
  }
  for (const collection of [null,{},'']) assert.throws(() => api.suggestionsForAdfad(collection));
  assert.deepEqual(api.suggestionsForAdfad([]),[]);
});

test('contribution helpers do not change session assignments or expose authoritative fields', () => {
  const api = load();
  const session = {id:'s1',assignments:[{facultyId:'private-existing',displayName:'Existing'}],facultyIds:['private-existing'],instructor:'Existing'};
  const original = JSON.parse(JSON.stringify(session));
  Object.freeze(session.assignments[0]); Object.freeze(session.assignments); Object.freeze(session.facultyIds); Object.freeze(session);
  const record = api.createContribution(input({session,assignments:session.assignments,facultyIds:session.facultyIds,instructor:session.instructor}));
  const output = api.suggestionsForAdfad([record]);
  assert.deepEqual(session,original);
  for (const row of [record,...output]) for (const key of ['session','assignments','facultyIds','instructor']) assert.equal(key in row,false);
});

test('Task 4 fingerprint accepts safe contributions and excludes internal notes, time and actor labels', () => {
  const api = load();
  const review = require('../teaching-assignment-review.js');
  const sessions = [{id:'s1',course:'VTMD 505',subjectKey:'surgery',date:'2026-09-22',start:'09:00',end:'10:00',type:'LEC',topic:'Surgery'}];
  const first = api.suggestionsForAdfad([api.createContribution(input({note:'private note',updatedAt:0,actorDisplayName:'Actor A'}))]);
  const changed = api.suggestionsForAdfad([api.createContribution(input({note:'changed note',updatedAt:1,actorDisplayName:'Renamed'}))]);
  assert.equal(review.reviewFingerprint(sessions,first),review.reviewFingerprint(sessions,changed));
  assert.equal(review.reviewFingerprint(sessions,first),review.reviewFingerprint(sessions,[{sessionId:'s1',candidateKey:'cand-1',displayName:'Dr One',sourceRole:'adc'}]));
  assert.notEqual(review.reviewFingerprint(sessions,first),review.reviewFingerprint(sessions,[]));
});

test('browser global loads with the same safe dependency boundary as Node', () => {
  const api = load();
  const context = {window:{}};
  for (const file of ['subject-catalog.js','faculty-suggestions.js','assignment-contributions.js']) vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  const browser = context.window.UCVM_ASSIGNMENT_CONTRIBUTIONS;
  assert.deepEqual(JSON.parse(JSON.stringify(browser.createContribution(input()))),api.createContribution(input()));
  assert.throws(() => vm.runInNewContext(fs.readFileSync(path.join(root,'assignment-contributions.js'),'utf8'),{window:{}}), /requires/i);
});
