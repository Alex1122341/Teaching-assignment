'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../src/app.js');
const {DEFAULT_ACADEMIC_YEAR,InvalidAcademicYearError,canonicalAcademicYear,resolveAcademicYear}=require('../src/data/academic-year.js');
const {createWriteGates,writeDisabled}=require('../src/data/write-gates.js');
const roles=require('../src/auth/role-policy.js');
const names=require('../src/domain/person-name.js');
const {createRequestTiming,METRIC_NAMES}=require('../src/perf/request-timing.js');

// ---------------------------------------------------------------------------
// Academic year
// ---------------------------------------------------------------------------

test('academic year canonicalises the 4-4 spelling onto the stored 2-2 form',()=>{
  assert.equal(canonicalAcademicYear('2026-27'),'2026-27');
  assert.equal(canonicalAcademicYear('2026-2027'),'2026-27');
  assert.equal(canonicalAcademicYear('2027-2028'),'2027-28');
  assert.equal(canonicalAcademicYear(' 2026-27 '),'2026-27');
});

test('academic year rejects a span that is not exactly one year',()=>{
  for(const value of ['2026-28','2026-26','2026','junk','','2026/27','26-27']){
    assert.throws(()=>canonicalAcademicYear(value),error=>error instanceof InvalidAcademicYearError&&error.code==='INVALID_ACADEMIC_YEAR',`expected ${JSON.stringify(value)} to be rejected`);
  }
});

test('an omitted academic year defaults, an explicit invalid one never silently defaults',()=>{
  assert.equal(resolveAcademicYear(undefined),DEFAULT_ACADEMIC_YEAR);
  assert.equal(resolveAcademicYear(null),DEFAULT_ACADEMIC_YEAR);
  assert.equal(resolveAcademicYear('   '),DEFAULT_ACADEMIC_YEAR);
  // The distinction that matters: an explicit bad value must throw rather than
  // answer 200 with a different year's data.
  assert.throws(()=>resolveAcademicYear('2026'),/not a recognised academic year/);
});

// ---------------------------------------------------------------------------
// Role policy
// ---------------------------------------------------------------------------

test('role policy recognises every role this repository issues',()=>{
  // Sourced from server/src/data/sql-user-repository.js and AGENTS.md.
  for(const role of ['developer','owner','administrator','adfa_general','adfa_regular','adc','lab','hicc','visc','faculty','admin']){
    assert.equal(roles.isSupportedRole(role),true,`${role} must be recognised`);
  }
  // Not authorization grants: `isSupportedRole` is used as the predicate by the
  // ported APIs, so recognising these would grant access. They fail closed.
  assert.equal(roles.isSupportedRole('other_office'),false);
  assert.equal(roles.isSupportedRole('editor'),false);
  assert.equal(roles.isSupportedRole('viewer'),false);
  assert.equal(roles.isSupportedRole('student'),false);
  assert.equal(roles.isSupportedRole(''),false);
  assert.equal(roles.isSupportedRole(null),false);
});

test('other_office is a real identity but carries no business capability',()=>{
  // `isSupportedRole` is the authorization predicate used by the ported APIs, not
  // a description of the role vocabulary. Recognising `other_office` would grant
  // it access to every scoped route, so it fails closed even though AGENTS.md
  // lists it as a formal role and sql-user-repository.js can issue it.
  assert.equal(roles.isSupportedRole('other_office'),false);
  assert.equal(roles.normalizeBaseRole('other_office'),null);
  assert.equal(roles.isAdministratorRole('other_office'),false);
  assert.equal(roles.isGeneralRole('other_office'),false);
  assert.equal(roles.isSelfServiceRole('other_office'),false);
  assert.equal(roles.isOfficeRole('other_office'),false);
});

test('legacy administrator aliases collapse, and display-only aliases fail closed',()=>{
  assert.equal(roles.normalizeBaseRole('owner'),'adfa_general');
  assert.equal(roles.normalizeBaseRole('administrator'),'adfa_regular');
  assert.equal(roles.normalizeBaseRole('admin'),'adfa_regular');
  assert.equal(roles.isAdministratorRole('owner'),true);
  assert.equal(roles.isAdministratorRole('administrator'),true);
  assert.equal(roles.isGeneralRole('owner'),true);
  assert.equal(roles.isGeneralRole('administrator'),false);
  // `editor`/`viewer` are collapsed onto `faculty` by the browser helper for
  // display only. Mapping them here would grant self-service scope that SQL
  // never issues, so the server refuses to recognise them at all.
  assert.equal(roles.normalizeBaseRole('editor'),null);
  assert.equal(roles.normalizeBaseRole('viewer'),null);
  assert.equal(roles.isSelfServiceRole('editor'),false);
});

// ---------------------------------------------------------------------------
// Write gates
// ---------------------------------------------------------------------------

test('every write gate is closed unless its own flag is explicitly true',()=>{
  const closed=createWriteGates({});
  assert.equal(Object.values(closed).every(value=>value===false),true);
  assert.equal(Object.isFrozen(closed),true);

  const one=createWriteGates({PAWS_AFC_SINGLE_WRITE_ENABLED:'true'});
  assert.equal(one.afcSingle,true);
  assert.equal(one.afcBatch,false);
  // Enabling AFC must never open Teaching Assignment publication.
  assert.equal(one.taPublish,false);

  // Anything other than the literal 'true' stays closed.
  assert.equal(createWriteGates({PAWS_AFC_SINGLE_WRITE_ENABLED:'TRUE'}).afcSingle,false);
  assert.equal(createWriteGates({PAWS_AFC_SINGLE_WRITE_ENABLED:'1'}).afcSingle,false);
});

test('the disabled-write response is a fresh 503 each call',()=>{
  const first=writeDisabled();
  assert.equal(first.status,503);
  assert.equal(first.body.error.code,'WRITE_DISABLED');
  first.body.error.code='MUTATED';
  assert.equal(writeDisabled().body.error.code,'WRITE_DISABLED');
});

// ---------------------------------------------------------------------------
// Person name presentation
// ---------------------------------------------------------------------------

test('names render as Last name, First name and survive formatting twice',()=>{
  assert.equal(names.format({firstName:'David',lastName:'Hall'}),'Hall, David');
  assert.equal(names.format({preferredFirstName:'Mary Jane',preferredLastName:'de la Cruz'}),'de la Cruz, Mary Jane');
  // Idempotency: already-comma names must not be reversed again.
  assert.equal(names.format('Hall, David'),'Hall, David');
  assert.equal(names.format(names.format('David Hall')),'Hall, David');
});

test('placeholders and non-person labels are never turned into reversed names',()=>{
  for(const value of ['Locum','TBD','Not provided','N/A','Unknown faculty','Unassigned']){
    assert.equal(names.format(value),value);
  }
  assert.equal(names.format('faculty@ucalgary.ca'),'faculty@ucalgary.ca');
  assert.equal(names.format('8f3a1c2e-1b4d-4e6f-9a0b-1c2d3e4f5a6b'),'8f3a1c2e-1b4d-4e6f-9a0b-1c2d3e4f5a6b');
  assert.equal(names.format(''),'');
});

test('structured components win over a free-text label, and lists split on semicolons',()=>{
  assert.equal(names.format({displayName:'D. Hall',firstName:'David',lastName:'Hall'}),'Hall, David');
  // A single recorded component stays truthful rather than being split.
  assert.equal(names.format({lastName:'de la Cruz'}),'de la Cruz');
  assert.equal(names.formatList('David Hall; Mary Smith'),'Hall, David; Smith, Mary');
  assert.equal(names.formatList('David Hall\nMary Smith'),'Hall, David\nSmith, Mary');
  // A comma inside one person's name is not a person separator.
  assert.equal(names.formatList('Hall, David; Smith, Mary'),'Hall, David; Smith, Mary');
});

// ---------------------------------------------------------------------------
// Request timing
// ---------------------------------------------------------------------------

test('request timing stays silent until eligible and only emits allow-listed metrics',()=>{
  let clock=0;
  const timing=createRequestTiming({now:()=>clock});
  assert.equal(timing.serverTiming(),'');
  timing.record('sql_connect',1.25,'cold');
  assert.equal(timing.serverTiming(),'');
  timing.markEligible();
  assert.equal(timing.serverTiming(),'sql_connect;dur=1.25;desc="cold"');
  // Unknown metric names and descriptions are dropped, not escaped.
  timing.record('sql_connect',2,'evil";desc="x');
  assert.equal(timing.serverTiming(),'sql_connect;dur=2');
  assert.equal(timing.record('not_a_metric',1),false);
  assert.deepEqual(METRIC_NAMES.includes('sql_connect'),true);
});

// ---------------------------------------------------------------------------
// Route contract
// ---------------------------------------------------------------------------

test('the sessions route keeps its exact call shape when no academic year is supplied',async()=>{
  const calls=[];
  const app=createApp({
    authProvider:{verify:async()=>({uid:'u1',role:'adfa_regular',email:'admin@ucalgary.ca'})},
    services:{sessionReadService:{async listSessions(input){calls.push(input);return[]}}}
  });
  const response=await app.inject({method:'GET',url:'/api/data/sessions?start=2027-03-22&end=2027-03-23',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,200);
  assert.deepEqual(calls,[{start:'2027-03-22',end:'2027-03-23',facultyEmail:''}]);
});

test('the sessions route canonicalises a supplied academic year before it reaches SQL',async()=>{
  const calls=[];
  const app=createApp({
    authProvider:{verify:async()=>({uid:'u1',role:'adfa_regular',email:'admin@ucalgary.ca'})},
    services:{sessionReadService:{async listSessions(input){calls.push(input);return[]}}}
  });
  const response=await app.inject({method:'GET',url:'/api/data/sessions?start=2027-03-22&end=2027-03-23&academicYear=2026-2027',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,200);
  assert.equal(calls[0].academicYear,'2026-27');
});

test('a malformed academic year is a 400, not a 500 and not a silent default',async()=>{
  let called=false;
  const app=createApp({
    authProvider:{verify:async()=>({uid:'u1',role:'adfa_regular',email:'admin@ucalgary.ca'})},
    services:{sessionReadService:{async listSessions(){called=true;return[]}}}
  });
  const response=await app.inject({method:'GET',url:'/api/data/sessions?start=2027-03-22&end=2027-03-23&academicYear=2026',headers:{authorization:'Bearer token'}});
  assert.equal(response.statusCode,400);
  assert.equal(response.json().code,'INVALID_ACADEMIC_YEAR');
  assert.equal(called,false,'SQL must not be queried for an invalid academic year');
});
