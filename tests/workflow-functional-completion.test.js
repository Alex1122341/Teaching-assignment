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
  assert.match(source,/if\(opened\)return/);
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
