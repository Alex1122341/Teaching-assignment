'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const sourceFunction=require('../test-support/source-function');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function loadWorkQueue(){
  const context={window:{}};
  vm.runInNewContext(read('session-workflow.js'),context);
  vm.runInNewContext(read('work-queue.js'),context);
  return{workflow:context.window.UCVM_SESSION_WORKFLOW,queue:context.window.UCVM_WORK_QUEUE};
}

function stubDocument(){
  const makeElement=()=>{
    const classes=new Set();
    const element={
      id:'',innerHTML:'',textContent:'',dataset:{},type:'',disabled:false,children:[],
      isConnected:true,parent:null,listeners:{},
      classList:{
        add:name=>classes.add(name),
        remove:name=>classes.delete(name),
        contains:name=>classes.has(name),
        toggle:(name,force)=>{const on=force===undefined?!classes.has(name):Boolean(force);on?classes.add(name):classes.delete(name);return on}
      },
      setAttribute(){},
      appendChild(child){child.parent=this;this.children.push(child);return child},
      addEventListener(type,handler){(this.listeners[type]=this.listeners[type]||[]).push(handler)},
      remove(){this.isConnected=false},
      click(){for(const handler of this.listeners.click||[])handler({target:this})},
      querySelector(){return null},
      querySelectorAll(){return[]}
    };
    Object.defineProperty(element,'className',{
      get:()=>[...classes].join(' '),
      set:value=>{classes.clear();for(const name of String(value||'').split(/\s+/).filter(Boolean))classes.add(name)}
    });
    return element;
  };
  const host=makeElement();
  const document={
    body:host,
    createElement:()=>makeElement(),
    getElementById:()=>null,
    querySelector:()=>null
  };
  return{document,host};
}

test('Work Queue Open Work carries the session date into the scoped-editor request',()=>{
  const {workflow,queue}=loadWorkQueue(),{document,host}=stubDocument();
  const session={id:'lab-1',type:'LAB',date:'2027-03-22',year:3,course:'505',start:'14:45',end:'16:15',topic:'Suturing',labGroupIds:[]};
  const opened=[];
  const controller=queue.createController({document,host,onOpen:detail=>opened.push(detail)});
  const view={...queue.buildViewModel({sessions:[session],role:'lab',workflow,context:{rosters:{}}}),role:'lab'};
  controller.render(view);
  assert.match(controller.panel.innerHTML,/data-work-open-date="2027-03-22"/);
  controller.panel.listeners.click[0]({
    target:{closest:selector=>selector==='[data-work-open]'?{
      disabled:false,
      dataset:{workOpen:'lab-1',workOpenStage:'lab',workOpenDate:'2027-03-22'}
    }:null}
  });
  assert.deepEqual(JSON.parse(JSON.stringify(opened)),[{
    sessionId:'lab-1',stage:'lab',date:'2027-03-22',role:'lab'
  }]);
});

test('mounted Work Queue passes a known date to page.openScopedEditor so an evicted session can be reloaded',async()=>{
  const source=read('work-queue.js');
  assert.match(source,/openScopedEditor\(sessionId,\{stage,date:targetDate\}\)/);
  assert.match(source,/const targetDate=String\(date\|\|session\?\.date\|\|''\)\.slice\(0,10\)/);
  assert.match(source,/await page\.openScopedEditor\(sessionId,\{stage,date:targetDate\}\);\s*return;/);
  assert.doesNotMatch(source,/const opened=await page\.openScopedEditor/);
});

function approvalActionHarness(granted=['lab']){
  const context={
    lifecycle:{
      decisionReadiness({workflow,approvals,office}){
        const order=['adc','lab','adfa'],required=workflow.requiredOffices||[],index=order.indexOf(office);
        if(!required.includes(office))return{allowed:false,waitingFor:[],reason:'not_required'};
        const waitingFor=order.slice(0,index).filter(name=>required.includes(name)&&String(approvals?.[name]?.status||'pending')!=='approved');
        return{allowed:waitingFor.length===0,waitingFor,reason:waitingFor.length?'previous_stage_pending':'ready'};
      }
    },
    isDeveloper:()=>false,
    approvalOffices:()=>granted,
    esc:value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))
  };
  vm.createContext(context);
  vm.runInContext(sourceFunction('approval-workflow.js','routedOfficeActionHtml'),context);
  vm.runInContext(sourceFunction('approval-workflow.js','routedActionHtml'),context);
  return context;
}

const routedRequest=approvals=>({
  id:'req-lab-1',
  status:'pending',
  requestSchema:'office-routing-v1',
  _workflow:{
    requiredOffices:['adc','lab','adfa'],
    hasFacultyChange:true,
    scopes:{adc:['date'],lab:['topic'],adfa:['assignments']}
  },
  _approvals:approvals
});

test('LAB READY approval renders an actionable LAB Approve button',()=>{
  const ctx=approvalActionHarness(['lab']);
  const html=ctx.routedActionHtml(routedRequest({
    adc:{status:'approved'},
    lab:{status:'pending'},
    adfa:{status:'pending'}
  }));
  assert.match(html,/data-office-decision="approve"/);
  assert.match(html,/data-office-context="lab"/);
  assert.match(html,/>Approve</);
});

test('LAB waiting for ADC cannot approve yet but can Push Back or Reject',()=>{
  const ctx=approvalActionHarness(['lab']);
  const html=ctx.routedActionHtml(routedRequest({
    adc:{status:'pending'},
    lab:{status:'pending'},
    adfa:{status:'pending'}
  }));
  assert.doesNotMatch(html,/data-office-decision="approve"/);
  assert.match(html,/Waiting for ADC/);
  assert.match(html,/data-office-decision="push_back"/);
  assert.match(html,/data-office-decision="reject"/);
});

test('approval request listener follows actual officeAccess grants instead of only the primary role',()=>{
  const source=read('approval-workflow.js');
  const start=source.indexOf('function listenRequests()');
  const end=source.indexOf('function listenAfcRequests()',start);
  assert.ok(start>=0&&end>start);
  const listener=source.slice(start,end);
  assert.match(listener,/granted=approvalOffices\(\)/);
  assert.match(listener,/where\('office','==',granted\[0\]\)/);
  assert.match(listener,/where\('office','in',granted\)/);
  assert.doesNotMatch(listener,/currentOffice=office\(\)/);
  assert.match(listener,/byRequest=new Map\(\)/);
});


function rosterPlannerHarness(rawByGroup,existing={}){
  const labGroups=require('../lab-groups.js');
  const context={
    window:{UCVM_LAB_GROUPS:labGroups},
    scopedWork:{stage:'lab'},
    selectionCapabilities:()=>({canEditLabRoster:true}),
    captureSelectionLabRosterDrafts:()=>{},
    selectionLabRosterDrafts:new Map(Object.entries(rawByGroup||{})),
    labGroupDirectory:new Map([
      ['g-a',{groupId:'g-a',groupCode:'A',course:'505'}],
      ['g-b',{groupId:'g-b',groupCode:'B',course:'505'}]
    ]),
    labRosterDirectory:new Map(Object.entries(existing||{})),
    currentUser:{uid:'uid-lab',name:'LAB Coordinator',email:'lab@example.test'}
  };
  vm.createContext(context);
  vm.runInContext(sourceFunction('timetable.js','buildSelectionLabRosterPlans'),context);
  return context;
}

test('LAB roster planner creates only private roster-shaped writes for valid student IDs',()=>{
  const ctx=rosterPlannerHarness({'g-a':'30012345\n30012346'});
  const result=ctx.buildSelectionLabRosterPlans([{course:'505',labGroupIds:['g-a']}],'SERVER_TIME');
  assert.deepEqual(JSON.parse(JSON.stringify(result.errors)),[]);
  assert.equal(result.plans.length,1);
  assert.equal(result.plans[0].groupId,'g-a');
  assert.deepEqual(JSON.parse(JSON.stringify(result.plans[0].data)),{
    groupId:'g-a',
    studentIds:['30012345','30012346'],
    updatedAt:'SERVER_TIME',
    updatedBy:'uid-lab',
    updatedByName:'LAB Coordinator'
  });
  for(const forbidden of ['sessionId','course','topic','facultyIds','assignments'])assert.equal(Object.hasOwn(result.plans[0].data,forbidden),false,forbidden);
});

test('LAB roster planner blocks invalid, duplicate and cross-group student assignments',()=>{
  const invalid=rosterPlannerHarness({'g-a':'bad\n30012345\n30012345'});
  const invalidResult=invalid.buildSelectionLabRosterPlans([{course:'505',labGroupIds:['g-a']}],'SERVER_TIME');
  assert.ok(invalidResult.errors.some(message=>/line 1.*6–12 digit/i.test(message)));
  assert.ok(invalidResult.errors.some(message=>/duplicate student/i.test(message)));

  const duplicate=rosterPlannerHarness(
    {'g-a':'30012345'},
    {'g-b':{studentIds:['30012345']}}
  );
  const duplicateResult=duplicate.buildSelectionLabRosterPlans([{course:'505',labGroupIds:['g-a']}],'SERVER_TIME');
  assert.ok(duplicateResult.errors.some(message=>/both Group B and Group A|both Group A and Group B/i.test(message)));
});

test('LAB roster editor is scoped to LAB work and persists through the private roster collection',()=>{
  const source=read('timetable.js');
  assert.match(source,/canEditLabRoster=scopedWork\?\.stage==='lab'&&selectionCapabilities\(\)\.canEditLabRoster===true/);
  assert.match(source,/data-selection-lab-roster=/);
  assert.match(source,/UCVM_LAB_GROUPS/);
  assert.match(source,/api\.parseRoster/);
  assert.match(source,/api\.rosterFor/);
  assert.match(source,/db\.collection\('lab_group_rosters'\)\.doc\(roster\.groupId\)/);
  assert.match(source,/stageExtraWrites:rosterPlans\.length/);
  assert.match(source,/await ensureLabWorkflowContext\(true\)/);
  assert.doesNotMatch(source,/calendarFromSource:[^\n]*studentIds/);
});

test('LAB roster completion stays private from the sanitized calendar model',()=>{
  const calendar=require('../calendar-session.js');
  const clean=calendar.fromSource({
    id:'lab-1',course:'505',year:3,date:'2027-03-22',start:'14:45',end:'16:15',
    type:'LAB',topic:'Suturing',room:'Lab',instructor:'Faculty A',labGroupIds:['g-a'],
    studentIds:['30012345'],roster:{studentIds:['30012345']},rosters:{'g-a':{studentIds:['30012345']}}
  },'lab-1');
  assert.deepEqual(clean.labGroupIds,['g-a']);
  const serialized=JSON.stringify(clean);
  assert.equal(serialized.includes('30012345'),false);
  assert.equal(Object.hasOwn(clean,'studentIds'),false);
  assert.equal(Object.hasOwn(clean,'roster'),false);
  assert.equal(Object.hasOwn(clean,'rosters'),false);
});
