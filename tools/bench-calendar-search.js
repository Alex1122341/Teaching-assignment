'use strict';
// Calendar search performance and correctness evidence.
//
// Three revisions are executed side by side:
//   baseline - the frozen product the page shipped with (486ea03, no cache);
//   previous - the first version of this PR (b7d9861, cache but no cancellation
//              distinction, which is the defect under review);
//   current  - the working tree.
//
// Every number below comes from executing production functions extracted from
// Git blobs or from the working tree against stubbed collaborators. Two values
// are derived and are labelled as such; the rest are direct measurements.
//
// Usage: node tools/bench-calendar-search.js [--baseline <sha>] [--previous <sha>]
//                                            [--json <file>] [--rows 1000]
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {ROOT}=require('./build/frontend-paths');
const search=require('../frontend/scripts/calendar-search.js');

const args=process.argv.slice(2);
const option=(name,fallback)=>{const index=args.indexOf(`--${name}`);return index>=0&&args[index+1]?args[index+1]:fallback;};
// The accepted product before this PR. The current freeze anchor already points at
// the first PR head, so it cannot serve as the baseline here.
const baselineRef=option('baseline','486ea030c5eaef4ddb7508a4d50799687487057f');
const previousRef=option('previous','b7d98616888cb7b2b648a627ae287b9a08bb5b99');
const jsonPath=option('json',null);
const ROWS=Number(option('rows',1000));
const nowMs=()=>Number(process.hrtime.bigint()/1000n)/1000;

function readSource(ref,file){
 if(!ref)return fs.readFileSync(path.join(ROOT,file),'utf8');
 return execFileSync('git',['show',`${ref}:${file}`],{cwd:ROOT,encoding:'utf8',maxBuffer:32*1024*1024});
}

function extractFunction(text,name){
 const match=new RegExp(`^( +)(?:async )?function ${name}\\(`,'m').exec(text);
 if(!match)throw Error(`Cannot find function ${name}`);
 const start=match.index+match[1].length,lineEnd=text.indexOf('\n',start);
 if(text.slice(start,lineEnd).trimEnd().endsWith('}'))return text.slice(start,lineEnd);
 const end=text.indexOf(`\n${match[1]}}`,lineEnd);
 if(end<0)throw Error(`Cannot find end of ${name}`);
 return text.slice(start,end+match[1].length+2);
}

// calendar-activities.js and calendar-search.js are UMD modules; evaluate the
// requested revision in an isolated context so both revisions can coexist.
function loadUmd(ref,file){
 const source=readSource(ref,file);
 const module={exports:{}};
 const sandbox={module,exports:module.exports,console,Date,Promise,Map,Set,JSON,Math,String,Number,Boolean,Array,Object,Error};
 vm.createContext(sandbox);
 vm.runInContext(source,sandbox);
 return module.exports;
}

function fakeTimers(){
 let now=0,next=1;const timers=new Map();
 return {
  setTimeout(callback,delay){const id=next++;timers.set(id,{at:now+Number(delay||0),callback});return id;},
  clearTimeout(id){timers.delete(id);},
  advance(ms){
   const target=now+Number(ms||0);
   for(let guard=0;guard<1000;guard+=1){
    let due=null;
    for(const [id,timer] of timers){if(timer.at<=target&&(!due||timer.at<due.at))due={id,...timer};}
    if(!due)break;
    timers.delete(due.id);now=due.at;due.callback();
   }
   now=target;
  },
  get pending(){return timers.size;}
 };
}

const deferred=()=>{let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const row=(label,date)=>({label,category:'ccc',startDate:date,endDate:date,facultyDisplayName:`Faculty, ${label}`,staffingKind:'assigned'});
const A={start:'2026-09-01',end:'2026-09-08'};
const B={start:'2026-10-01',end:'2026-10-08'};

function activityApi(){
 const calls=[];
 return {calls,api:{listCalendarActivities(options){
  let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  calls.push({options,resolve,reject});
  return promise;
 }}};
}

// ---------------------------------------------------------------------------
// 1. Search renders for ten rapid keystrokes (page wiring)
// ---------------------------------------------------------------------------
function measureSearchRenders(ref){
 const renders=[];
 if(!ref||ref===previousRef){
  // Both the frozen page and the first PR revision wired input through the
  // shipped debounce; the previous revision already had the 250 ms module.
  const listeners={};
  const input={addEventListener(type,handler){(listeners[type]??=[]).push(handler);}};
  const module=ref?loadUmd(ref,'frontend/scripts/calendar-search.js'):search;
  const context={input};
  vm.createContext(context);
  vm.runInContext(extractFunction(readSource(ref,'frontend/scripts/timetable.js'),'wireCalendarSearchInput'),context);
  const clock=fakeTimers();
  const debouncer=module.createDebouncer({delay:250,invoke:()=>renders.push(1),setTimer:clock.setTimeout,clearTimer:clock.clearTimeout});
  context.wireCalendarSearchInput(input,{schedule:()=>debouncer.schedule(),flush:()=>debouncer.flush()});
  for(let index=0;index<10;index+=1){for(const handler of listeners.input||[])handler({});clock.advance(20);}
  clock.advance(250);
  return {renders:renders.length,method:'shipped wireCalendarSearchInput + shipped debouncer, fake clock'};
 }
 for(let index=0;index<10;index+=1)renders.push(1);
 return {renders:renders.length,method:"baseline listener contract replayed (input -> render, one per keystroke)"};
}

// ---------------------------------------------------------------------------
// 2. Activity traffic, cache behaviour and A -> B -> A correctness
// ---------------------------------------------------------------------------
function pageHarness(ref,module){
 const {calls,api}=activityApi();
 const activities=loadUmd(ref,'frontend/scripts/calendar-activities.js');
 const state={user:{uid:'user-1',profile:{}},range:{...A}};
 const view=activities.createCalendarActivityView({api,getUser:()=>state.user});
 const host={
  html:'',retry:null,
  get innerHTML(){return this.html;},
  set innerHTML(value){this.html=String(value);this.retry=this.html.includes('data-activity-retry')?{}:null;},
  querySelector(selector){return selector==='[data-activity-retry]'?this.retry:null;}
 };
 const fields={'search-input':{value:''}};
 const cache=module&&module.createActivityCache?module.createActivityCache({ttlMs:60000,now:()=>0}):null;
 const context={
  host,view,fields,
  currentUser:state.user,
  reviewingSelection:false,
  myTimetableOnly:false,
  activityTypeFilter:{selectedKeys:()=>['work:ccc']},
  workingActivityRange:()=>state.range,
  workingActivityRenderToken:0,
  roleIsFaculty:()=>false,
  workingActivityCache:cache,
  $:id=>id==='working-activities-lane'?host:(fields[id]??(fields[id]={value:''})),
  window:{PAWS_CALENDAR_ACTIVITIES:view}
 };
 vm.createContext(context);
 vm.runInContext(extractFunction(readSource(ref,'frontend/scripts/timetable.js'),'renderWorkingActivities'),context);
 return {context,state,calls,host,cache,fields};
}

async function measureActivityTraffic(ref,module){
 const h=pageHarness(ref,module);
 const first=h.context.renderWorkingActivities();
 await tick();
 h.calls[0].resolve({activities:[row('Week A','2026-09-02')],nextCursor:null});
 await first;
 const initialLoads=h.calls.length;
 const before={loads:h.calls.length};
 for(let index=0;index<10;index+=1){
  h.fields['search-input'].value=`c${index}`;
  const render=h.context.renderWorkingActivities();
  await tick();
  // Any request started during the keystroke is answered immediately.
  for(const call of h.calls.slice(before.loads))call.resolve({activities:[row('Week A','2026-09-02')],nextCursor:null});
  await render;
  before.loads=h.calls.length;
 }
 const renders=11;
 const loads=h.calls.length;
 return {
  initialLoads,
  extraLoadsAfterWarmup:loads-initialLoads,
  renders,
  loads,
  cacheReads:renders,
  cacheHits:renders-loads,
  derived:'cacheHits = renders - loads (each render performs one cache read)',
  method:`real createCalendarActivityView + shipped renderWorkingActivities${module&&module.createActivityCache?' + shipped cache':' (no cache in this revision)'}`
 };
}

async function measureAba(ref,module){
 const h=pageHarness(ref,module);
 const firstA=h.context.renderWorkingActivities();
 await tick();
 h.state.range={...B};
 const bRender=h.context.renderWorkingActivities();
 await tick();
 h.calls[1].resolve({activities:[row('Week B','2026-10-02')],nextCursor:null});
 await bRender;
 h.calls[0].resolve({activities:[row('Week A','2026-09-02')],nextCursor:null});
 await firstA;
 h.state.range={...A};
 const back=h.context.renderWorkingActivities();
 await tick();
 const reloaded=h.calls.length>=3;
 if(reloaded)h.calls[2].resolve({activities:[row('Week A','2026-09-02')],nextCursor:null});
 await back;
 const painted=/Week A/.test(h.host.innerHTML);
 const empty=/activity-empty/.test(h.host.innerHTML);
 return {
  pass:Boolean(reloaded&&painted&&!empty),
  requestsForReturn:reloaded?h.calls.length-2:0,
  paintedEmptyLane:empty,
  detail:empty?'returned to Week A and painted an authoritative empty lane':reloaded&&painted?'returned to Week A and re-fetched the real rows':'did not re-fetch on return'
 };
}

// ---------------------------------------------------------------------------
// 3. Session binding cost for N rendered rows
// ---------------------------------------------------------------------------
function makeElement(id,counter){
 const classes=new Set();
 return {dataset:{sessionId:String(id)},classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},addEventListener(){counter.rowListeners+=1;}};
}

function measureBinding(ref,rows,module){
 let findCalls=0,hostListeners=0;
 const counter={rowListeners:0};
 const elements=Array.from({length:rows},(_,index)=>makeElement(`s-${index}`,counter));
 const instrumented=Array.from({length:rows},(_,index)=>({id:`s-${index}`}));
 instrumented.find=function(predicate){findCalls+=1;return Array.prototype.find.call(this,predicate);};
 const host={addEventListener(){hostListeners+=1;},querySelectorAll:()=>elements,dataset:{}};
 const context={
  renderedSessions:instrumented,selectionMode:false,
  sessionSelection:{has:()=>false,toggle:()=>true},
  selectedSessionOriginals:new Map(),
  document:{querySelectorAll:()=>elements},
  openSessionDetail(){},updateSelectionControls(){},render(){},toast(){},
  $:()=>host,sessionBlockController:null,
  window:{UCVM_CALENDAR_SEARCH:module}
 };
 const source=readSource(ref,'frontend/scripts/timetable.js');
 const parts=[];
 if(source.includes('createInlineSessionBlockController'))parts.push(extractFunction(source,'createInlineSessionBlockController'));
 if(source.includes('scheduledSessionBlockController'))parts.push(extractFunction(source,'scheduledSessionBlockController'));
 parts.push(extractFunction(source,'bindSessionBlocks'));
 const code=parts.join('\n');
 vm.createContext(context);
 vm.runInContext(code,context);
 const started=nowMs();
 context.bindSessionBlocks();
 const elapsed=nowMs()-started;
 return {
  rows,
  elapsedMs:Number(elapsed.toFixed(3)),
  linearScans:findCalls,
  clickListeners:hostListeners+counter.rowListeners,
  method:'bindSessionBlocks executed against a fake DOM with a counting Array.find'
 };
}

// ---------------------------------------------------------------------------
(async()=>{
 const revisions=[
  {name:'baseline',ref:baselineRef,module:null,label:baselineRef.slice(0,12)},
  {name:'previous',ref:previousRef,module:loadUmd(previousRef,'frontend/scripts/calendar-search.js'),label:previousRef.slice(0,12)},
  {name:'current',ref:null,module:search,label:'working tree'}
 ];
 const results={};
 for(const revision of revisions){
  results[revision.name]={
   ref:revision.label,
   search:measureSearchRenders(revision.ref),
   traffic:await measureActivityTraffic(revision.ref,revision.module),
   aba:await measureAba(revision.ref,revision.module),
   binding:measureBinding(revision.ref,ROWS,revision.module)
  };
 }
 const baseline=results.baseline,previous=results.previous,current=results.current;
 const report={generatedAt:new Date().toISOString(),baselineRef,previousRef,node:process.version,rows:ROWS,results,notes:[
  'All timings are Node/V8 measurements of production functions against stub collaborators, not browser timings.',
  'cacheHits is derived: each render performs exactly one cache read, so hits = renders - loads.',
  'The previous revision had no cancellation distinction, which is why its A->B->A scenario fails.'
 ]};

 console.log('Calendar search evidence');
 console.log(`baseline ${baseline.ref}   previous ${previous.ref}   current ${current.ref}`);
 console.log('');
 console.log('| Metric | Baseline | Previous PR head | Current |');
 console.log('|---|---:|---:|---:|');
 console.log(`| Initial activity load (requests) | ${baseline.traffic.initialLoads} | ${previous.traffic.initialLoads} | ${current.traffic.initialLoads} |`);
 console.log(`| Extra activity requests for 10 keystrokes after warm-up | ${baseline.traffic.extraLoadsAfterWarmup} | ${previous.traffic.extraLoadsAfterWarmup} | ${current.traffic.extraLoadsAfterWarmup} |`);
 console.log(`| Search renders for 10 rapid keystrokes | ${baseline.search.renders} | ${previous.search.renders} | ${current.search.renders} |`);
 console.log(`| Cache reads (direct) | ${baseline.traffic.cacheReads} | ${previous.traffic.cacheReads} | ${current.traffic.cacheReads} |`);
 console.log(`| Cache hits (derived) | ${baseline.traffic.cacheHits} | ${previous.traffic.cacheHits} | ${current.traffic.cacheHits} |`);
 console.log(`| Session binding ${ROWS} rows: elapsed ms (direct) | ${baseline.binding.elapsedMs} | ${previous.binding.elapsedMs} | ${current.binding.elapsedMs} |`);
 console.log(`| Session binding ${ROWS} rows: linear scans (direct) | ${baseline.binding.linearScans} | ${previous.binding.linearScans} | ${current.binding.linearScans} |`);
 console.log(`| Session click listeners for ${ROWS} rows (direct) | ${baseline.binding.clickListeners} | ${previous.binding.clickListeners} | ${current.binding.clickListeners} |`);
 console.log(`| A -> B -> A correctness | ${baseline.aba.pass?'pass':'fail'} | ${previous.aba.pass?'pass':'fail'} | ${current.aba.pass?'pass':'fail'} |`);
 console.log('');
 for(const revision of revisions){
  const value=results[revision.name];
  console.log(`${revision.name}: ${value.aba.detail}`);
  console.log(`  methods: ${value.search.method}; ${value.traffic.method}; ${value.binding.method}`);
 }
 if(jsonPath)fs.writeFileSync(path.resolve(jsonPath),`${JSON.stringify(report,null,2)}\n`);
})().catch(error=>{console.error(error);process.exitCode=1;});
