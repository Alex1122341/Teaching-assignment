'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const whole=fs.readFileSync(path.join(__dirname,'../frontend/scripts/testing-only-features.js'),'utf8');
const start=whole.indexOf('  async function openApprovals(){');
const end=whole.indexOf('  async function openWorkQueue() {',start);
if(start<0||end<start)throw Error('Missing All Approvals implementation');
const source=whole.slice(start,end);
function make({role='faculty',uid='report',afcWritable=true,swapWritable=true}={}){
  const calls=[],opened=[],nodes=new Map();
  const afc=[
    {afcRequestId:'a1',status:'pending_report_to',reportToFirebaseUid:'report',facultyName:'A One',startDate:'2026-11-01',endDate:'2026-11-03'},
    {afcRequestId:'a2',status:'pending_admin',reportToFirebaseUid:'report',facultyName:'B Two',startDate:'2026-12-01',endDate:'2026-12-04'}
  ];
  const swaps=[
    {requestId:'s1',status:'pending',canDecide:true,nextStage:'adc',courseCode:'VTMD 304'},
    {requestId:'s2',status:'pending',canDecide:false,nextStage:'adfa',courseCode:'VTMD 306'}
  ];
  const root={UCVM_TIMETABLE_TESTING_HOOKS:{currentUser:()=>({role,displayName:'Test Actor'})},
    firebase:{auth:()=>({currentUser:{uid,displayName:'Test Actor'}})},
    PAWS_SWAP:{openDetail:id=>opened.push(id)},crypto:require('node:crypto').webcrypto};
  const api=async(endpoint,options)=>{
    calls.push({endpoint,options});
    if(endpoint==='/api/v1/afc-requests')return {afcRequests:afc};
    if(endpoint==='/api/v1/swaps/queue')return {requests:swaps};
    if(endpoint==='/api/v1/afc-requests/write-capabilities')return {writeCapabilities:{decisions:afcWritable}};
    if(endpoint==='/api/v1/swaps/capabilities')return {writeCapabilities:{swapDecision:swapWritable}};
    if(endpoint==='/api/v1/swaps/s1')return {request:{status:'pending',nextStage:'adc',revision:1,changes:{room:'R2'},courseCode:'VTMD 304'},capabilities:{canDecide:true,requiresOverride:false,decisions:['approve','reject','push_back']},workflow:{verified:true}};
    if(endpoint==='/api/v1/swaps/s2')return {request:{status:'pending',nextStage:'adfa',revision:1,changes:{replacementCandidateKey:'f2'}},capabilities:{canDecide:true,requiresOverride:false,decisions:['approve','reject','push_back']},workflow:{verified:true}};
    return {ok:true};
  };
  const table=(columns,rows,empty)=>rows.length?rows.map(row=>columns.map(c=>c.html?c.html(row):c.value(row)).join('|')).join('\n'):empty;
  const holder={hidden:true,innerHTML:'',replaceChildren(){this.innerHTML='';},scrollIntoView(){}};
  const form={listeners:{},elements:{namedItem:name=>({signature:{value:'Test Actor'},attested:{checked:true},comment:{value:'Reviewed'},reason:{value:'Reviewed'}}[name])},reportValidity:()=>true,
    addEventListener(n,fn){this.listeners[n]=fn;},querySelector:()=>({disabled:false,isConnected:true})};
  nodes.set('testing-only-decision',holder);nodes.set('testing-only-decision-form',form);nodes.set('testing-only-swap-decision-form',form);
  nodes.set('testing-only-decision-cancel',{addEventListener(){}});nodes.set('testing-only-decision-status',{textContent:''});
  const sandbox={root,ADMIN_ROLES:new Set(['developer','owner','adfa_general','adfa_regular','administrator','admin']),
    roleOf:u=>u.role,esc:v=>String(v??''),AFC_STAGE:{pending_report_to:'Reports-To',pending_admin:'Admin'},
    api,table,pill:s=>s,openPanel:()=>{const body={isConnected:true,innerHTML:'',listeners:{},addEventListener(k,fn){this.listeners[k]=fn;}};sandbox.body=body;return body;},
    closePanel(){},failure(){},toast(){},$:name=>nodes.get(name)||null,TextEncoder,Uint8Array,Date};
  vm.createContext(sandbox);
  vm.runInContext(source+'\nthis.run=openApprovals;',sandbox);
  return {run:async()=>{await sandbox.run();return sandbox.body;},calls,opened,nodes};
}
test('Reports-To may recommend their pending AFC request but not admin-approve',async()=>{
  const {run}=make({uid:'report',role:'faculty'}),body=await run();
  assert.match(body.innerHTML,/data-approval-id="a1" data-approval-action="recommend"/);
  assert.doesNotMatch(body.innerHTML,/data-approval-id="a2" data-approval-action="approve"/);
});
test('ADFA may approve the pending-admin AFC request',async()=>{
  const {run}=make({uid:'admin',role:'adfa_general'}),body=await run();
  assert.match(body.innerHTML,/data-approval-id="a2" data-approval-action="approve"/);
  assert.doesNotMatch(body.innerHTML,/data-approval-id="a1" data-approval-action="recommend"/);
});
test('unrelated Faculty has no AFC decision and API gates suppress actions',async()=>{
  const a=make({uid:'unrelated'}),body=await a.run();
  assert.doesNotMatch(body.innerHTML,/data-approval-kind="afc"/);
  const b=make({uid:'admin',role:'adfa_general',afcWritable:false,swapWritable:false}),gated=await b.run();
  assert.doesNotMatch(gated.innerHTML,/data-approval-action="approve"/);
  assert.match(gated.innerHTML,/data-approval-action="open"/);
});
test('intermediate SWAP approve posts to exact request and revision',async()=>{
  const a=make({uid:'adc',role:'adc'}),body=await a.run();
  await body.listeners.click({target:{closest:()=>({dataset:{approvalKind:'swap',approvalId:'s1',approvalAction:'approve'}})}});
  const form=a.nodes.get('testing-only-swap-decision-form');
  await form.listeners.submit({preventDefault(){},currentTarget:form});
  const post=a.calls.find(r=>r.endpoint==='/api/v1/swaps/s1/decisions'&&r.options?.method==='POST');
  assert.ok(post);assert.equal(post.options.body.expectedRevision,1);assert.equal(post.options.body.decision,'approve');
});
test('final SWAP approve goes to full review instead of bypassing DOE checks',async()=>{
  const a=make({uid:'admin',role:'adfa_general'}),body=await a.run();
  await body.listeners.click({target:{closest:()=>({dataset:{approvalKind:'swap',approvalId:'s2',approvalAction:'approve'}})}});
  assert.deepEqual(a.opened,['s2']);
});
test('AFC approve sends authenticated signed decision through existing API',async()=>{
  const a=make({uid:'admin',role:'adfa_general'}),body=await a.run();
  await body.listeners.click({target:{closest:()=>({dataset:{approvalKind:'afc',approvalId:'a2',approvalAction:'approve'}})}});
  const form=a.nodes.get('testing-only-decision-form');
  await form.listeners.submit({preventDefault(){},currentTarget:form});
  const post=a.calls.find(r=>r.endpoint==='/api/v1/afc-requests/a2/approve'&&r.options?.method==='POST');
  assert.ok(post);assert.equal(post.options.body.signature.mode,'typed');
  assert.equal(post.options.body.signature.uid,'admin');
  assert.match(post.options.body.signature.fingerprint,/^[a-f0-9]{64}$/);
});
