'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Developer is the highest frontend role with every capability',()=>{
 const ctx={window:{}};vm.runInNewContext(read('web/js/core/office-capabilities.js'),ctx);
 const api=ctx.window.UCVM_OFFICE_CAPABILITIES,c=api.forRole('developer');
 for(const [key,value] of Object.entries(c))assert.equal(value,true,key);
 assert.equal(api.officeForRole('developer'),'adfa');
});

test('Developer is supported by account setup and synthetic demo identity',()=>{
 const profile=require('../web/js/accounts/account-profile.js').build({role:'developer',office:{name:'VISTA Developer',email:'developer@example.test'},active:true,current:{},mustChangePassword:false});
 assert.equal(profile.role,'developer');
 const docs=require('../tools/seed/dataset.js').buildDataset().documents;
 assert.equal(docs.find(row=>row.path==='users/uid-developer')?.data?.role,'developer');
 assert.match(read('web/user-management.html'),/<option value="developer">Developer<\/option>/);
 assert.match(read('tools/bootstrap-lab-user.js'),/ROLES=new Set\(\['developer'/);
});

test('Developer is recognized by Firestore and the authoritative SQL role policy',()=>{
 const rules=read('firebase/firestore.rules');
 assert.match(rules,/p\.role in \['developer','owner'/);
 assert.match(rules,/function general\(\).*\['developer','owner','adfa_general'\]/);
 assert.match(rules,/function doeAdmin\(\).*\['developer','owner'/);
 assert.match(rules,/resource\.data\.role == 'developer'.*request\.resource\.data\.role == 'developer'/);
 // The retired Firestore DOE services each carried their own hardcoded
 // `new Set(['developer','owner',...])`. The ported SQL stack authorises through
 // one shared policy module instead, so the assertion moves to that module.
 const policy=require('../server/src/auth/role-policy.js');
 assert.equal(policy.isAdministratorRole('developer'),true);
 assert.equal(policy.isGeneralRole('developer'),true);
 assert.equal(policy.isSelfServiceRole('developer'),false);
 assert.equal(policy.isSupportedRole('developer'),true);
});


test('Developer also passes ADC and LAB scoped Firestore helpers',()=>{
 const rules=read('firebase/firestore.rules');
 assert.match(rules,/function adc\(\)\{return hasOfficeAccess\('adc'\);\}/);
 assert.match(rules,/function lab\(\)\{return hasOfficeAccess\('lab'\);\}/);
 assert.match(rules,/function hasOfficeAccess\(name\).*developer\(\).*name in officeAccess\(\)/);
});


test('Developer multi-office routed approvals are explicit in UI and Firestore rules',()=>{
 const workflow=read('web/js/approvals/approval-workflow.js'),rules=read('firebase/firestore.rules');
 assert.match(workflow,/approvalOffices=\(\)=>isDeveloper\(\)\?\['adc','lab','adfa'\]/);
 assert.match(workflow,/data-office-context/);
 assert.match(workflow,/decideRoutedRequest\(id,decision,officeOverride=''/);
 assert.match(workflow,/Developer · all approval queues/);
 assert.match(rules,/function officeDecisionOn\(id,office\)/);
 assert.match(rules,/function decisionOffice\(id\)\{return officeDecisionOn\(id,'adc'\) \? 'adc' : \(officeDecisionOn\(id,'lab'\) \? 'lab' : \(officeDecisionOn\(id,'adfa'\) \? 'adfa' : ''\)\);\}/);
 assert.match(rules,/hasOfficeAccess\(resource\.data\.office\) && validOfficeApprovalDecision\(id,d,resource\.data\.office\)/);
 assert.match(rules,/d\.status == 'cancelled' \? validRoutedOfficeCancellation/);
 assert.match(rules,/function hasRequiredOffice\(workflow\)/);
 assert.match(rules,/!workflow\.hasFacultyChange \|\| hasOfficeAccess\('adfa'\)/);
});
