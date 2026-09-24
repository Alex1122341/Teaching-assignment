'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const account=require('../account-profile.js');
const office=require('../office-capabilities.js');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Other Office cannot be provisioned as a new active account',()=>{
 assert.throws(()=>account.build({role:'other_office',office:{name:'Legacy Office',email:'legacy@example.test'},active:true}),/valid account role/i);
});

test('Other Office has no runtime office or timetable capability',()=>{
 const capabilities=office.forRole('other_office');
 assert.equal(office.isOfficeAccount('other_office'),false);
 assert.deepEqual(office.officesForProfile({role:'other_office',officeAccess:['adc','lab','adfa']}),[]);
 for(const [key,value] of Object.entries(capabilities))assert.equal(value,false,key);
});

test('User Management no longer offers Other Office and uses current office labels',()=>{
 const html=read('user-management.html');
 assert.doesNotMatch(html,/option value="other_office"/);
 assert.match(html,/option value="adc">ADC\/DVM<\/option>/);
 assert.match(html,/value="adfa">ADFAD faculty assignment/);
});

test('legacy Other Office profiles are blocked before normal portal readiness',()=>{
 const source=read('faculty-access.js');
 assert.match(source,/retiredRole\(p\).*role has been retired/s);
 assert.match(source,/other_office:'Other Office \(retired\)'/);
});
