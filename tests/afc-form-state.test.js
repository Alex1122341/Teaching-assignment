'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load(){
 const context={window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','afc-form-state.js'),'utf8'),context);
 return context.window.UCVM_AFC_FORM_STATE;
}

test('vacation waits for timetable lookup and only asks for coverage when teaching exists',()=>{
 const policy=load();
 assert.deepEqual(JSON.parse(JSON.stringify(policy.fields({reason:'vacation',rangeReady:false,loading:false,sessionCount:0}))),{showPurpose:false,requirePurpose:false,showCoverage:false,requireCoverage:false,coverageMessage:''});
 assert.equal(policy.fields({reason:'vacation',rangeReady:true,loading:true,sessionCount:0}).coverageMessage,'Checking teaching assignments…');
 assert.deepEqual(JSON.parse(JSON.stringify(policy.fields({reason:'vacation',rangeReady:true,loading:false,sessionCount:0}))),{showPurpose:false,requirePurpose:false,showCoverage:false,requireCoverage:false,coverageMessage:'Coverage arrangements: None needed'});
 assert.equal(policy.fields({reason:'vacation',rangeReady:true,loading:false,sessionCount:2}).showCoverage,true);
});

test('business or other shows purpose only after a valid date range is selected',()=>{
 const policy=load();
 assert.equal(policy.fields({reason:'business_other',rangeReady:false,loading:false,sessionCount:0}).showPurpose,false);
 const ready=policy.fields({reason:'business_other',rangeReady:true,loading:false,sessionCount:0});
 assert.equal(ready.showPurpose,true);
 assert.equal(ready.requirePurpose,true);
});
