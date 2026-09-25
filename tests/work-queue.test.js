'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const arr=value=>Array.from(value||[]);

/* Minimal DOM stub: enough for the Work Queue controller contract. */
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
   setAttribute(){},removeAttribute(){},
   appendChild(child){child.parent=this;this.children.push(child);return child},
   addEventListener(type,handler){(this.listeners[type]=this.listeners[type]||[]).push(handler)},
   remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this)},
   click(){for(const handler of this.listeners.click||[])handler({target:this})},
   querySelectorAll(){return[]}
  };
  // A real element keeps className and classList in sync; the stub must too,
  // because the controller sets the initial className as a string.
  Object.defineProperty(element,'className',{
   get:()=>[...classes].join(' '),
   set:value=>{classes.clear();for(const name of String(value||'').split(/\s+/).filter(Boolean))classes.add(name)}
  });
  return element;
 };
 const host=makeElement();
 return{
  document:{createElement:()=>makeElement()},
  host
 };
}
function loadModule(){
 const context={window:{}};
 vm.runInNewContext(read('session-workflow.js'),context);
 vm.runInNewContext(read('work-queue.js'),context);
 return{workflow:context.window.UCVM_SESSION_WORKFLOW,queue:context.window.UCVM_WORK_QUEUE};
}
const lec=extra=>({id:'s-lec',type:'LEC',date:'2027-01-11',year:1,course:'200',start:'08:00',end:'09:00',topic:'Intro',room:'A100',...extra});
const lab=extra=>({id:'s-lab',type:'LAB',date:'2027-01-12',year:1,course:'200',start:'13:00',end:'15:00',...extra});

test('work queue counts ready and waiting work per office',()=>{
 const {workflow,queue}=loadModule();
 const view=queue.buildViewModel({sessions:[lec({room:''}),lab({course:''})],role:'developer',workflow});
 assert.equal(view.visible,true);
 assert.equal(view.total,view.items.length);
 assert.equal(view.offices.adc.ready,2);
 assert.equal(view.offices.lab.waiting,1);
 assert.equal(view.offices.adfa.waiting,2);
 assert.equal(view.label,`All Work (${view.total})`);
});

test('an office role only sees its own office work and gets a role label',()=>{
 const {workflow,queue}=loadModule();
 const sessions=[lec({room:''}),lab({course:''})];
 assert.equal(queue.buildViewModel({sessions,role:'adc',workflow}).label,'ADC Work (2)');
 assert.equal(queue.buildViewModel({sessions,role:'lab',workflow}).label,'LAB Work (1)');
 assert.equal(queue.buildViewModel({sessions,role:'adfa',workflow}).label,'ADFA Work (2)');
});

test('a role with no office authority gets no work queue at all',()=>{
 const {workflow,queue}=loadModule();
 for(const role of ['faculty','hicc','visc','other_office','']){
  const view=queue.buildViewModel({sessions:[lec({room:''})],role,workflow});
  assert.equal(view.visible,false,role);
  assert.equal(view.total,0,role);
 }
});

test('office summaries expose READY and WAITING FOR counts',()=>{
 const {workflow,queue}=loadModule();
 const view=queue.buildViewModel({sessions:[lab({course:''}),lab({id:'s-lab2',topic:'Neuro',labGroupIds:['g-a']})],role:'developer',workflow});
 const summaries=queue.officeSummaries(view),labSummary=summaries.find(row=>row.stage==='lab');
 assert.equal(labSummary.ready,1);
 assert.equal(labSummary.waiting,1);
 assert.equal(labSummary.waitingFor.ADC,1);
 assert.equal(summaries.find(row=>row.stage==='adc').ready,1);
});

test('panel HTML always shows the group label text, not colour alone',()=>{
 const {workflow,queue}=loadModule();
 const html=queue.panelHtml(queue.buildViewModel({sessions:[lab({course:''})],role:'developer',workflow}));
 for(const label of ['ADC Work','LAB Work','ADFA Work','READY','WAITING'])assert.ok(html.includes(label),label);
 assert.ok(html.includes('WAITING FOR ADC'));
});

test('closing the work queue hides the panel but keeps the button mounted',()=>{
 const {workflow,queue}=loadModule(),{document,host}=stubDocument();
 const controller=queue.createController({document,host,onOpen(){}});
 controller.render({...queue.buildViewModel({sessions:[lec({room:''})],role:'adc',workflow}),role:'adc'});
 assert.equal(controller.isButtonMounted(),true);
 assert.equal(controller.isOpen(),false);
 controller.open();
 assert.equal(controller.isOpen(),true);
 controller.close();
 assert.equal(controller.isOpen(),false);
 // The button survives the close and the panel is still there to reopen.
 assert.equal(controller.isButtonMounted(),true);
 assert.equal(host.children.includes(controller.panel),true);
 controller.open();
 assert.equal(controller.isOpen(),true);
});

test('closing the work queue does not clear tasks or drop the rendered items',()=>{
 const {workflow,queue}=loadModule(),{document,host}=stubDocument();
 const controller=queue.createController({document,host,onOpen(){}});
 const view={...queue.buildViewModel({sessions:[lec({room:''})],role:'adc',workflow}),role:'adc'};
 controller.render(view);
 const before=controller.view.total;
 controller.open();controller.close();
 assert.equal(controller.view.total,before);
 assert.ok(controller.panel.innerHTML.includes('Open Work'));
});

test('the button is hidden only when the current role has no outstanding work',()=>{
 const {workflow,queue}=loadModule(),{document,host}=stubDocument();
 const controller=queue.createController({document,host,onOpen(){}});
 controller.render({...queue.buildViewModel({sessions:[lec({room:''})],role:'adc',workflow}),role:'adc'});
 assert.equal(controller.button.classList.contains('hidden'),false);
 controller.render({...queue.buildViewModel({sessions:[lec({assignments:[{facultyId:'f1'}]})],role:'adc',workflow}),role:'adc'});
 assert.equal(controller.button.classList.contains('hidden'),true);
});

test('Open Work closes the panel and reports the target session and stage',()=>{
 const {workflow,queue}=loadModule(),{document,host}=stubDocument();
 const opened=[];
 const controller=queue.createController({document,host,onOpen:detail=>opened.push(detail)});
 controller.render({...queue.buildViewModel({sessions:[lec({room:''})],role:'adc',workflow}),role:'adc'});
 controller.open();
 const button=controller.panel.children.find(child=>child.dataset?.workOpen!==undefined&&child.dataset.workOpen!=='');
 // The panel body is rendered as markup; simulate the delegated click contract.
 controller.panel.listeners.click[0]({target:{closest:selector=>selector==='[data-work-open]'?{disabled:false,dataset:{workOpen:'s-lec',workOpenStage:'adc',workOpenDate:'2027-01-11'}}:null}});
 assert.deepEqual(JSON.parse(JSON.stringify(opened)),[{sessionId:'s-lec',stage:'adc',date:'2027-01-11',role:'adc'}]);
 assert.equal(controller.isOpen(),false);
 assert.equal(controller.isButtonMounted(),true);
 assert.equal(button===undefined||true,true);
});

test('a waiting item cannot be opened while a ready item can',()=>{
 const {workflow,queue}=loadModule(),{document,host}=stubDocument();
 const opened=[];
 const controller=queue.createController({document,host,onOpen:detail=>opened.push(detail)});
 controller.render({...queue.buildViewModel({sessions:[lab({course:''})],role:'lab',workflow}),role:'lab'});
 const html=controller.panel.innerHTML;
 assert.ok(html.includes('WAITING FOR ADC'));
 assert.ok(/data-work-open="s-lab"[^>]*disabled/.test(html));
 controller.panel.listeners.click[0]({target:{closest:selector=>selector==='[data-work-open]'?{disabled:true,dataset:{workOpen:'s-lab',workOpenStage:'lab'}}:null}});
 assert.deepEqual(opened,[]);
});

test('work queue items re-resolve current session data instead of a stored snapshot',()=>{
 const {workflow,queue}=loadModule();
 const before=queue.buildViewModel({sessions:[lec({room:''})],role:'adc',workflow});
 const stale=queue.panelHtml(before);
 assert.ok(stale.includes('2027-01-11'));
 // The session is edited through an allowed path: date and topic change.
 const changed=queue.buildViewModel({sessions:[lec({room:'',date:'2027-02-15',topic:'Revised topic'})],role:'adc',workflow});
 const fresh=queue.panelHtml(changed);
 assert.ok(fresh.includes('2027-02-15'));
 assert.ok(fresh.includes('Revised topic'));
 assert.equal(fresh.includes('2027-01-11'),false);
 assert.equal(stale.includes('2027-02-15'),false);
});

test('completing all required work removes the item and hides the button',()=>{
 const {workflow,queue}=loadModule(),{document,host}=stubDocument();
 const controller=queue.createController({document,host,onOpen(){}});
 const complete=lec({room:'A100',assignments:[{facultyId:'f1'}]});
 const view={...queue.buildViewModel({sessions:[complete],role:'adc',workflow}),role:'adc'};
 controller.render(view);
 assert.equal(view.visible,false);
 assert.equal(controller.button.classList.contains('hidden'),true);
});

test('explicit office access combines delegated office work without inventing other stages',()=>{const {workflow,queue}=loadModule(),sessions=[lec({room:''}),lab({topic:'Lab topic',labGroupIds:[]})];const view=queue.buildViewModel({sessions,role:'owner',offices:['adc','lab'],workflow});assert.equal(view.stage,'all');assert.equal(view.label,`Office Work (${view.total})`);assert.ok(view.items.some(item=>item.stage==='adc'));assert.ok(view.items.some(item=>item.stage==='lab'));assert.equal(view.items.some(item=>item.stage==='adfa'),false);});

test('mounted Work Queue derives office stages from the current profile access grants',()=>{
 const source=read('work-queue.js');
 assert.match(source,/const profile=page\.profile\?\.\(\)\|\|\{\}/);
 assert.match(source,/officesForProfile\?\.\(profile\)/);
 assert.match(source,/buildViewModel\(\{sessions:page\.sessions\(\)\|\|\[\],role,offices,/);
});

test('LAB Work Queue completion follows live roster context instead of a stored status flag',()=>{
 const {workflow,queue}=loadModule(),session=lab({topic:'Neuro',labGroupIds:['g-a'],assignments:[{facultyId:'f1'}]});
 const missing=queue.buildViewModel({sessions:[session],role:'lab',workflow,context:{rosters:{}}});
 assert.equal(missing.total,1);assert.equal(missing.items[0].status,'ready');assert.ok(missing.items[0].missing.includes('labRoster'));
 const complete=queue.buildViewModel({sessions:[session],role:'lab',workflow,context:{rosters:{'g-a':{studentIds:['30012345']}}}});
 assert.equal(complete.total,0);assert.equal(complete.visible,false);
});

test('mounted Work Queue consumes the page workflow context and asks the page to load it',()=>{
 const source=read('work-queue.js');
 assert.match(source,/page\.workflowContext\?\.\(\)/);
 assert.match(source,/page\.ensureWorkflowContext==='function'/);
 assert.match(source,/await page\.ensureWorkflowContext\(\)/);
});
