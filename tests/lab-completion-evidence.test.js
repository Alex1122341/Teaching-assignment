'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const workflow=require('../session-workflow');
const sourceFunction=require('../test-support/source-function');
const session={id:'lab-1',type:'LAB',date:'2027-03-22',year:3,course:'505',start:'14:45',end:'16:15',topic:'Suturing',labGroupIds:['g-a'],assignments:[]};
const group={groupId:'g-a',course:'505',active:true,rosterComplete:true};

test('ADFA-only readiness consumes safe group completion without student IDs',()=>{
  const context={labGroups:[group],rosters:{}};
  assert.equal(workflow.stageStatus(session,'adfa',context).status,'ready');
  assert.equal(JSON.stringify(context).includes('studentIds'),false);
});

test('missing, inactive, mismatched or contradictory roster evidence fails closed',()=>{
  for(const context of [
    {},{labGroups:[{...group,rosterComplete:undefined}]},
    {labGroups:[{...group,rosterComplete:false}]},
    {labGroups:[{...group,rosterComplete:'true'}]},
    {labGroups:[{...group,active:false}]},
    {labGroups:[{...group,groupId:'another-group'}]},
    {labGroups:[{...group,course:'999'}]},
    {labGroups:[{groupId:'g-a',course:'505',active:true}],rosters:{'g-a':{studentIds:['30012345']}}},
    {labGroups:[group],rosters:{'g-a':{studentIds:[]}}}
  ]) assert.equal(workflow.stageStatus(session,'adfa',context).status,'waiting');
});

test('ADFA context loader reads group evidence without requesting private rosters',async()=>{
  const reads=[];
  const ctx={currentUser:{role:'administrator'},hasOfficeAccess:office=>office==='adfa',
    labGroupDirectory:new Map(),labRosterDirectory:new Map(),labWorkflowLoaded:false,labWorkflowLoading:null,
    publishPageData(){},db:{collection(name){reads.push(name);return{where(){return this},async get(){return{docs:[{id:'g-a',data:()=>group}]}}}}}};
  vm.createContext(ctx);
  vm.runInContext(sourceFunction('timetable.js','workflowContext')+'\n'+sourceFunction('timetable.js','ensureLabWorkflowContext'),ctx);
  const context=await ctx.ensureLabWorkflowContext();
  assert.deepEqual(reads,['lab_groups']);
  assert.equal(context.labGroups[0].rosterComplete,true);
  assert.equal(Object.keys(context.rosters).length,0);
  assert.equal(workflow.stageStatus(session,'adfa',context).status,'ready');
});
