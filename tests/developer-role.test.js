'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Developer is the highest frontend role with every capability',()=>{
 const ctx={window:{}};vm.runInNewContext(read('office-capabilities.js'),ctx);
 const api=ctx.window.UCVM_OFFICE_CAPABILITIES,c=api.forRole('developer');
 for(const [key,value] of Object.entries(c))assert.equal(value,true,key);
 assert.equal(api.officeForRole('developer'),'adfa');
});

test('Developer is supported by account setup and synthetic demo identity',()=>{
 const profile=require('../account-profile.js').build({role:'developer',office:{name:'VISTA Developer',email:'developer@example.test'},active:true,current:{},mustChangePassword:false});
 assert.equal(profile.role,'developer');
 const docs=require('../tools/seed/dataset.js').buildDataset().documents;
 assert.equal(docs.find(row=>row.path==='users/uid-developer')?.data?.role,'developer');
 assert.match(read('user-management.html'),/<option value="developer">Developer<\/option>/);
 assert.match(read('tools/bootstrap-lab-user.js'),/ROLES=new Set\(\['developer'/);
});

test('Developer is recognized by Firestore and authoritative DOE boundaries',()=>{
 const rules=read('firestore.rules');
 assert.match(rules,/p\.role in \['developer','owner'/);
 assert.match(rules,/function general\(\).*\['developer','owner','adfa_general'\]/);
 assert.match(rules,/function doeAdmin\(\).*\['developer','owner'/);
 assert.match(rules,/resource\.data\.role == 'developer'.*request\.resource\.data\.role == 'developer'/);
 for(const file of ['server/src/doe/calculation-service.js','server/src/doe/policy-admin-service.js','server/src/doe/rulebook-service.js','server/src/doe/target-service.js','server/src/routes/doe-routes.js']){
  assert.match(read(file),/new Set\(\['developer','owner'/,file);
 }
});


test('Developer also passes ADC and LAB scoped Firestore helpers',()=>{
 const rules=read('firestore.rules');
 assert.match(rules,/function adc\(\)\{return ready\(\) && profile\(\)\.role in \['developer','adc'\]/);
 assert.match(rules,/function lab\(\)\{return ready\(\) && profile\(\)\.role in \['developer','lab'\]/);
});
