'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>require('../account-profile.js');
const faculty={id:'f1',name:'Faculty Name',email:'FACULTY@example.test'};

test('office profiles require their own identity and carry no Faculty link or roles',()=>{
 const api=load();for(const role of ['adc','lab','other_office','administrator','owner','developer']){
  const profile=api.build({role,faculty,roles:['hicc'],office:{name:'Scheduling Office',email:'OFFICE@example.test'},active:true,current:{facultyId:'f1',facultyRoles:['hicc']},mustChangePassword:true});
  const expected={name:'Scheduling Office',email:'office@example.test',role,active:true,mustChangePassword:true};if(['adc','lab','administrator','owner','developer'].includes(role))expected.officeAccess=api.defaultOfficeAccess(role);assert.deepEqual(profile,expected);
  assert.equal(api.facultyFacingRole(role),false);
 }
});
test('faculty-facing profile identity comes from the faculty record, not office inputs',()=>{
 const api=load(),roles=['visc'];const profile=api.build({role:'hicc',faculty,roles,office:{name:'Forged',email:'fake@example.test'},active:true,mustChangePassword:false});
 assert.deepEqual(profile,{facultyId:'f1',name:'Faculty Name',email:'faculty@example.test',role:'hicc',facultyRoles:['hicc','visc'],active:true,mustChangePassword:true});
 assert.deepEqual(roles,['visc']);assert.equal(api.facultyFacingRole('hicc'),true);
});
test('missing Faculty identity, invalid office identity and unknown roles are rejected',()=>{
 const api=load();assert.throws(()=>api.build({role:'faculty',office:{name:'Name',email:'name@example.test'}}),/faculty record/i);
 for(const role of ['adc','lab']){
  assert.throws(()=>api.build({role,office:{name:'',email:'office@example.test'}}),/name/i);
  assert.throws(()=>api.build({role,office:{name:'Office',email:'bad'}}),/email/i);
 }
 for(const role of ['','constructor','__proto__','unknown'])assert.throws(()=>api.build({role,faculty}),/role/i);
});
test('new Auth and existing-UID links always start with password change required',()=>{
 const api=load();assert.equal(api.build({role:'lab',office:{name:'Lab',email:'lab@example.test'},active:true,mustChangePassword:false}).mustChangePassword,true);
 assert.equal(api.build({role:'lab',office:{name:'Lab',email:'lab@example.test'},current:{},active:true,mustChangePassword:false}).mustChangePassword,false);
});
test('existing UID validation cannot create nested paths or accept pasted whitespace',()=>{
 const api=load();assert.equal(api.existingUid('  uid-123  '),'uid-123');assert.equal(api.existingUid(''),'');
 for(const value of ['a/b','a b','a\nb','x'.repeat(129)])assert.throws(()=>api.existingUid(value),/UID/);
});
test('linking an existing Auth UID does not create another Authentication user',async()=>{
 let creates=0,reads=[];const uid=await load().resolveNewUid({existingUid:'existing-uid',password:'',email:'office@example.test',readProfile:async id=>{reads.push(id);return{exists:false};},createAuthenticationUser:async()=>{creates++;return 'unexpected';}});
 assert.equal(uid,'existing-uid');assert.deepEqual(reads,['existing-uid']);assert.equal(creates,0);
});
test('linking refuses to overwrite an existing user profile',async()=>{
 let creates=0;await assert.rejects(load().resolveNewUid({existingUid:'taken',readProfile:async()=>({exists:true}),createAuthenticationUser:async()=>{creates++;}}),/already.*profile|profile.*already/i);assert.equal(creates,0);
});
test('new Authentication creation requires a password and delegates once',async()=>{
 const api=load();let calls=[];const createAuthenticationUser=async(...args)=>{calls.push(args);return'new-uid';};
 await assert.rejects(api.resolveNewUid({email:'office@example.test',password:'short',createAuthenticationUser}),/8 characters/);assert.equal(calls.length,0);
 assert.equal(await api.resolveNewUid({email:'office@example.test',password:'synthetic-test-password',createAuthenticationUser}),'new-uid');assert.equal(calls.length,1);
});

test('an indeterminate existing-profile read fails closed',async()=>{await assert.rejects(load().resolveNewUid({existingUid:'test',readProfile:async()=>undefined}),/verify|profile/i);});

test('operational office access is independent of the primary role and fails closed for faculty roles',()=>{const api=load();assert.deepEqual(api.build({role:'owner',office:{name:'Owner',email:'owner@example.test'},officeAccess:['adc','lab'],current:{},active:true,mustChangePassword:false}).officeAccess,['adc','lab']);assert.deepEqual(api.build({role:'administrator',office:{name:'Admin',email:'admin@example.test'},officeAccess:[],current:{},active:true,mustChangePassword:false}).officeAccess,[]);assert.equal(Object.prototype.hasOwnProperty.call(api.build({role:'faculty',faculty}), 'officeAccess'),false);assert.deepEqual(api.normalizeOfficeAccess(['LAB','adc','lab','bad']),['lab','adc']);});

test('ADC and LAB accounts may exchange ADC/LAB duties but cannot receive ADFA private-data authority',()=>{const api=load();assert.deepEqual(api.allowedOfficeAccess('adc'),['adc','lab']);assert.deepEqual(api.allowedOfficeAccess('lab'),['adc','lab']);assert.deepEqual(api.officeAccessFor({role:'lab',officeAccess:['adc','adfa']}),['adc']);assert.deepEqual(api.allowedOfficeAccess('administrator'),['adc','lab','adfa']);});
