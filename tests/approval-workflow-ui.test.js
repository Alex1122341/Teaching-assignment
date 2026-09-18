'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'approval-office-view.js'),'utf8'),context);
  return context.window.UCVM_APPROVAL_OFFICE_VIEW;
}

test('office queues use role-specific labels',()=>{
  const api=load();
  assert.equal(api.queueLabel('adc',3),'ADC Approvals (3)');
  assert.equal(api.queueLabel('lab',2),'LAB Approvals (2)');
  assert.equal(api.queueLabel('adfa',1),'Approvals (1)');
});

test('ADC and LAB request view contains display-only Faculty context and no private fields',()=>{
  const api=load();
  const request={
    id:'r1',requestType:'faculty_swap',basePublic:{course:'505',date:'2027-03-22',instructor:'Dr Old'},
    patchPublic:{instructor:'Dr New'},currentFacultyName:'Dr Old',proposedFacultyName:'Dr New',
    facultyId:'SECRET-ID',email:'secret@example.test',doe:42,availability:'private',afc:'private'
  };
  const view=api.requestView({office:'adc',request,approvalMatrix:{adfa:'pending'}});
  assert.equal(view.faculty.proposedName,'Dr New');
  assert.equal(view.faculty.adfaStatus,'pending');
  const json=JSON.stringify(view);
  for(const secret of ['SECRET-ID','secret@example.test','42','private'])assert.equal(json.includes(secret),false);
});

test('field rows mark only the current office scope editable',()=>{
  const api=load();
  const request={basePublic:{date:'2027-03-22',topic:'Old'},patchPublic:{date:'2027-03-23',topic:'New'}};
  const workflow={scopes:{adc:['date'],lab:['topic'],adfa:[]},finalType:'LAB'};
  const adc=api.requestView({office:'adc',request,workflow});
  assert.equal(adc.fields.find(x=>x.field==='date').owned,true);
  assert.equal(adc.fields.find(x=>x.field==='topic').owned,false);
  const lab=api.requestView({office:'lab',request,workflow});
  assert.equal(lab.fields.find(x=>x.field==='date').owned,false);
  assert.equal(lab.fields.find(x=>x.field==='topic').owned,true);
});

test('only ADFA view requests rich private context',()=>{
  const api=load();
  assert.equal(api.canUsePrivateFacultyContext('adc'),false);
  assert.equal(api.canUsePrivateFacultyContext('lab'),false);
  assert.equal(api.canUsePrivateFacultyContext('adfa'),true);
});
