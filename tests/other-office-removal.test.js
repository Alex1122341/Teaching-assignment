'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const account=require('../account-profile.js');
const office=require('../office-capabilities.js');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('normal seed retains Other Office only as an inactive legacy fixture',()=>{
 const {buildDataset}=require('../tools/seed/dataset.js');
 const users=buildDataset().documents.filter(row=>row.path.startsWith('users/'));
 assert.equal(users.filter(row=>row.data.role==='other_office'&&row.data.active===true).length,0);
 const legacy=users.find(row=>row.path==='users/uid-otheroffice');
 assert.ok(legacy,'preserve legacy fixture identity for denial tests');
 assert.equal(legacy.data.role,'other_office');
 assert.equal(legacy.data.active,false);
});

test('lab bootstrap refuses deprecated roles before Auth or Firestore initialization',async()=>{
 const bootstrap=require('../tools/bootstrap-lab-user.js');
 const input={email:'legacy@ucalgary.ca',displayName:'Legacy',role:'other_office',confirmation:'BOOTSTRAP:legacy@ucalgary.ca:other_office'};
 assert.throws(()=>bootstrap.validateOptions(input,{projectId:'vista-teaching-lab'}),/Unsupported.*role/i);
 assert.throws(()=>bootstrap.buildProfile(input),/Unsupported.*role/i);
 let initialized=false;
 await assert.rejects(()=>bootstrap.execute(input,{env:{FIREBASE_PROJECT_ID:'vista-teaching-lab'},adminModule:{get apps(){initialized=true;return[]}}}),/Unsupported.*role/i);
 assert.equal(initialized,false);
 assert.doesNotMatch(read('.github/workflows/firebase-lab-bootstrap.yml'),/^\s*- other_office\s*$/m);
});

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
