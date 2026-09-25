'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const ai=require('../tools/ai/task.js');
// All actor/review values below are synthetic fixtures, never real attestations.
const {validate}=require('../tools/ai/schema.js');
const {redact,assertSafe,id}=require('../tools/ai/safety.js');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vista-ai-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.cpSync(path.join(__dirname,'../.ai'),path.join(root,'.ai'),{recursive:true,filter:s=>!/[\\/](?:tasks|generated|examples)(?:[\\/]|$)/.test(s)});
 fs.writeFileSync(path.join(root,'app.js'),'original\n');
 for(const args of [['init','-q','-b','ai/task-72'],['config','user.name','Fixture'],['config','user.email','fixture@example.test'],['add','.'],['commit','-qm','fixture']]){
  assert.equal(spawnSync('git',args,{cwd:root}).status,0);
 }
 ai.init(root,{number:72,title:'Documentation example',body:'Synthetic task',html_url:'https://github.com/Alex1122341/Teaching-assignment/issues/72'});
 return root;
}
function spec(root){
 const value=ai.read(root,72,'spec.json');
 Object.assign(value,{problem_statement:'Need durable handoffs',current_behavior:'Manual context',required_behavior:'Reproducible prompts',
 acceptance_criteria:[{id:'AC1',description:'CLI validates a package'}],required_tests:['unit','build'],
 expected_files:['app.js'],open_questions:[]});
 ai.write(root,72,'spec.json',value);return value;
}
test('IDs reject traversal, zero, fractional and unsafe integers',()=>{
 for(const bad of ['../1','01','0','1;echo hi','1.2','-1','9007199254740992'])assert.throws(()=>id(bad));
 assert.equal(id('72'),'72');
});

const {verify,summarize,cleanEnv,profiles}=require('../tools/ai/verify.js');
// Captured build-static output shape; test data, not a production success emitter.
const BUILD_OUTPUT=JSON.stringify({output:'/fixture/.deploy-static',files:32,bytes:3224057,
 metadataPath:'.deploy-metadata/deployment-assets.json',metadataBytes:9534,deployedJs:20,bundles:12})+'\n';
const TAP_OUTPUT='TAP version 13\nok 1 - fixture assertion\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
const BROWSER_OUTPUT='Browser smoke passed 4/4 pages in emulator mode.\n';
const DEMO_OUTPUT='Browser smoke passed 4/4 pages in Pages Frontend Demo mode.\n';
const OWNER_OUTPUT='Authenticated owner smoke passed 3/3 protected pages: index.html, faculty-admin.html, user-management.html.\n';
const RULEBOOK_OUTPUT='Rule Book smoke checkpoint: recalculation completed.\n';
const PASSWORD_OUTPUT='Password reset browser smoke passed: signed-out page stayed accessible, reset submitted, privacy-safe confirmation rendered, and Auth emulator recorded the reset request.\n';
function review(root,stage='adversarial',model='deepseek'){
 return {issue:72,stage,model,...ai.context(root,72),criteria:[{id:'AC1',result:'PASS',evidence:'Synthetic test fixture only; not a real model review'}],
 blocking_findings:[],warnings:[],remaining_risk:[],human_checks:['Human merge only'],reviewed_at:new Date().toISOString()};
}
test('complete synthetic handoff reaches readiness, then code changes invalidate it',t=>{
 const root=fixture(t),s=spec(root);s.required_tests=['build'];ai.write(root,72,'spec.json',s);
 ai.advance(root,72,'implementation');ai.advance(root,72,'review');
 ai.write(root,72,'review.json',review(root));
 ai.advance(root,72,'verification');
 const report=verify(root,72,['build'],{run:()=>({status:0,stdout:BUILD_OUTPUT,stderr:''})});
 assert.equal(report.checks[0].result,'PASS');
 ai.advance(root,72,'final_review');
 ai.write(root,72,'final-review.json',review(root,'final','sol'));
 ai.advance(root,72,'ready_for_human');
 assert.equal(ai.check(root,72).ready,true);
 assert.equal(ai.validateAll(root,{branch:'ai/task-72'}).length,1);
 spawnSync('git',['add','.ai/tasks'],{cwd:root});
 spawnSync('git',['commit','-qm','evidence only'],{cwd:root});
 assert.equal(ai.check(root,72).ready,true,'evidence-only commit remains valid');
 fs.writeFileSync(path.join(root,'app.js'),'later change');
 assert.equal(ai.check(root,72).ready,false);
 assert.throws(()=>ai.validateAll(root,{branch:'ai/task-72'}),/stale/);
 const historical=ai.validateAll(root,{branch:'another-task'});
 assert.equal(historical[0].readiness,'not_evaluated');
});
test('same-model, mismatched criteria and stale reviews stop advancement',t=>{
 const root=fixture(t);spec(root);ai.advance(root,72,'implementation');ai.advance(root,72,'review');
 ai.write(root,72,'review.json',review(root,'adversarial','hy4'));
 assert.throws(()=>ai.advance(root,72,'verification'),/independent/);
 const record=review(root);record.criteria[0].id='AC2';ai.write(root,72,'review.json',record);
 assert.throws(()=>ai.advance(root,72,'verification'),/criteria/);
 ai.write(root,72,'review.json',review(root));fs.writeFileSync(path.join(root,'app.js'),'edit');
 assert.throws(()=>ai.advance(root,72,'verification'),/stale/);
});
test('verification records failures, skipped tests and missing executables without false PASS',t=>{
 const root=fixture(t);spec(root);
 for(const [raw,expected] of [
  [{status:1,stdout:'failed'},'FAIL'],
  [{status:0,stdout:'# skipped 2\n'},'NOT RUN'],
  [{status:null,error:Object.assign(Error('missing'),{code:'ENOENT'})},'NOT RUN'],
  [{status:null,error:Object.assign(Error('timeout'),{code:'ETIMEDOUT'})},'FAIL']
 ]){
  assert.equal(verify(root,72,['build'],{run:()=>raw}).checks[0].result,expected);
 }
 const token='ghp_'+'b'.repeat(40);
 const output=summarize({status:0,stdout:token});assert.doesNotMatch(output.output,new RegExp(token));
 const env=cleanEnv({PATH:'bin',GH_TOKEN:'secret',OPENAI_API_KEY:'secret',GOOGLE_APPLICATION_CREDENTIALS:'secret',FIRESTORE_EMULATOR_HOST:'unexpected'});
 assert.deepEqual(env,{PATH:'bin'});
});
test('verification rejects commands before execution and detects concurrent source edits',t=>{
 const root=fixture(t);spec(root);let called=false;
 assert.throws(()=>verify(root,72,['publish'],{run:()=>{called=true}}),/profile/);assert.equal(called,false);
 assert.throws(()=>verify(root,72,['build'],{run:()=>{fs.writeFileSync(path.join(root,'app.js'),'during');return{status:0}}}),/changed during/);
});
test('schema evaluator fails on unsupported keywords and duplicate test profiles',()=>{
 const {inspect}=require('../tools/ai/schema.js');
 assert.throws(()=>inspect({type:'string',unknownKeyword:true}),/Unsupported/);
});
test('workflow syntax keeps issue inputs in env and never enables write/merge/model calls',()=>{
 const root=path.join(__dirname,'..');
 const artifact=fs.readFileSync(path.join(root,'.github/workflows/ai-task-package.yml'),'utf8');
 const ci=fs.readFileSync(path.join(root,'.github/workflows/ai-orchestration.yml'),'utf8');
 assert.match(artifact,/contents: read/);assert.match(artifact,/issues: read/);
 assert.doesNotMatch(artifact+ci,/contents: write|pull-requests: write|pull_request_target|enable-auto-merge|gh pr merge/);
 assert.match(artifact,/ref: \$\{\{ github.event.repository.default_branch \}\}/);
 assert.doesNotMatch(artifact,/run:.*\$\{\{/);
 for(const workflow of [artifact,ci]){
  for(const action of workflow.matchAll(/uses: ([^\s]+)/g))assert.match(action[1],/@[0-9a-f]{40}$/);
 }
});

test('strict schema rejects extras, missing required fields and invalid enums',t=>{
 const root=fixture(t),s=spec(root);validate('task-spec',s);
 assert.throws(()=>validate('task-spec',{...s,unexpected:true}),/unexpected/);
 assert.throws(()=>validate('task-spec',{...s,risk:'extreme'}),/risk/);
 assert.throws(()=>validate('task-spec',{...s,issue:'72'}),/issue/);
 assert.throws(()=>validate('task-spec',{...s,expected_files:['../secret']}),/expected_files/);
});
test('creation is repeatable without overwriting work; prompts are manual',t=>{
 const root=fixture(t);spec(root);
 assert.throws(()=>ai.init(root,{number:72,title:'overwrite',body:''}),/exists/);
 const out=ai.prompt(root,72,'architect');
 assert.match(fs.readFileSync(out,'utf8'),/Untrusted task data/);
 assert.match(fs.readFileSync(out,'utf8'),/Human merge/);
 assert.throws(()=>ai.prompt(root,99,'architect'),/missing/);
 assert.throws(()=>ai.prompt(root,72,'builder','unknown'),/model/);
});
test('sensitive input is rejected and known secrets are redacted',()=>{
 const token='ghp_'+'a'.repeat(40);
 assert.throws(()=>assertSafe('token '+token),/secret/i);
 assert.doesNotMatch(redact('token '+token),new RegExp(token));
 assert.throws(()=>assertSafe('password=superSecret123'),/secret/i);
 assert.throws(()=>assertSafe(JSON.stringify({client_email:'private@example.test',private_key:'secret'})),/secret/i);
});
test('stage cannot skip architecture or incomplete specification',t=>{
 const root=fixture(t);
 assert.throws(()=>ai.advance(root,72,'review'),/transition/);
 assert.throws(()=>ai.advance(root,72,'implementation'),/specification/);
 spec(root);ai.advance(root,72,'implementation');
 assert.equal(ai.read(root,72,'STATUS.json').current_stage,'implementation');
 assert.throws(()=>ai.advance(root,72,'ready_for_human'),/transition/);
});
test('source fingerprint detects uncommitted edits and ignores generated handoffs',t=>{
 const root=fixture(t),before=ai.fingerprint(root);
 ai.prompt(root,72,'architect');assert.equal(ai.fingerprint(root),before);
 fs.writeFileSync(path.join(root,'app.js'),'changed');assert.notEqual(ai.fingerprint(root),before);
});
test('readiness fails closed for missing reviews and verification',t=>{
 const root=fixture(t);spec(root);
 const result=ai.check(root,72);assert.equal(result.ready,false);
 assert.ok(result.problems.some(x=>/review/i.test(x)));
});
test('protected scopes need explicit authorization and open questions block implementation',t=>{
 const root=fixture(t),s=spec(root);
 s.expected_files=['firestore.rules'];ai.write(root,72,'spec.json',s);
 assert.throws(()=>ai.advance(root,72,'implementation'),/protected/i);
 s.protected_changes=[{path:'firestore.rules',reason:'Explicit issue requirement'}];s.open_questions=['Unresolved role'];
 ai.write(root,72,'spec.json',s);assert.throws(()=>ai.advance(root,72,'implementation'),/questions/);
});
test('symlink task directories cannot escape the repository',t=>{
 const root=fixture(t),outside=fs.mkdtempSync(path.join(os.tmpdir(),'vista-outside-'));
 t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 fs.symlinkSync(outside,path.join(root,'.ai/tasks/73'),process.platform==='win32'?'junction':'dir');
 assert.throws(()=>ai.read(root,73,'STATUS.json'),/link|outside/i);
});
test('arbitrary test commands are never executed from task specs',t=>{
 const root=fixture(t),s=spec(root);s.required_tests=['echo injected'];
 assert.throws(()=>validate('task-spec',s),/required_tests/);
});
test('review schema requires per-criterion evidence and rejects unknown result values',()=>{
 const review={issue:72,stage:'adversarial',model:'deepseek',head_sha:'a'.repeat(40),source_digest:'b'.repeat(64),
 spec_digest:'c'.repeat(64),criteria:[{id:'AC1',result:'PASS',evidence:'test output'}],
 blocking_findings:[],warnings:[],remaining_risk:[],human_checks:[],reviewed_at:new Date().toISOString()};
 validate('review',review);
 assert.throws(()=>validate('review',{...review,criteria:[{id:'AC1',result:'PASS',evidence:''}]}),/evidence/);
 assert.throws(()=>validate('review',{...review,criteria:[{id:'AC1',result:'MAYBE',evidence:'none'}]}),/result/);
});

test('prompts include strict output contracts and select the correct independent model',t=>{
 const root=fixture(t);spec(root);
 const architecture=fs.readFileSync(ai.prompt(root,72,'architect'),'utf8');
 assert.match(architecture,/"additionalProperties": false/);
 assert.match(architecture,/"role_checks"/);
 const builder=fs.readFileSync(ai.prompt(root,72,'builder'),'utf8');
 assert.match(builder,/Requested model alias: hy4/);
 const reviewer=fs.readFileSync(ai.prompt(root,72,'review'),'utf8');
 assert.match(reviewer,/Requested model alias: deepseek/);
 assert.throws(()=>ai.prompt(root,72,'review','hy4'),/independent/);
});

test('inconsistent stage flags and mismatched status identities fail validation',t=>{
 const root=fixture(t);spec(root);ai.advance(root,72,'implementation');
 const status=ai.read(root,72,'STATUS.json');status.architecture_status='pending';ai.write(root,72,'STATUS.json',status);
 assert.throws(()=>ai.advance(root,72,'review'),/stage|status/i);
 status.architecture_status='complete';status.issue_number=73;ai.write(root,72,'STATUS.json',status);
 assert.throws(()=>ai.validateAll(root),/mismatch/i);
});

test('every affected role needs a source-based check and auth changes need explicit scope',t=>{
 const root=fixture(t),s=spec(root);s.roles_affected=['ADC','LAB'];
 s.role_checks=[{role:'ADC',source:'office-capabilities.js',scenario:'Read',expected:'Allowed based on source'}];
 ai.write(root,72,'spec.json',s);assert.throws(()=>ai.validSpec(root,72),/role/i);
 s.roles_affected=[];s.role_checks=[];s.expected_files=['shared-auth.js'];ai.write(root,72,'spec.json',s);
 assert.throws(()=>ai.validSpec(root,72),/protected/i);
});

test('source digests are stable across Git CRLF/LF checkout conversion',t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'app.js'),'line one\nline two\n');
 const before=ai.fingerprint(root);
 fs.writeFileSync(path.join(root,'app.js'),'line one\r\nline two\r\n');
 assert.equal(ai.fingerprint(root),before);
});

test('blocking reviews can reach integration but never final review or readiness',t=>{
 const root=fixture(t),s=spec(root);s.required_tests=['build'];ai.write(root,72,'spec.json',s);
 ai.advance(root,72,'implementation');ai.advance(root,72,'review');
 const record=review(root);record.blocking_findings=['Fix required'];record.criteria[0].result='FAIL';ai.write(root,72,'review.json',record);
 const status=ai.read(root,72,'STATUS.json');status.blocking_findings=['Fix required'];ai.write(root,72,'STATUS.json',status);
 ai.advance(root,72,'verification');verify(root,72,['build'],{run:()=>({status:0,stdout:BUILD_OUTPUT})});
 assert.throws(()=>ai.advance(root,72,'final_review'),/blocking/);
 status.current_stage='verification';status.review_status='complete';status.blocking_findings=[];ai.write(root,72,'STATUS.json',status);
 assert.throws(()=>ai.advance(root,72,'final_review'),/blocking|failing/);
 ai.write(root,72,'review.json',review(root));ai.advance(root,72,'final_review');
 assert.equal(ai.check(root,72).ready,false,'final review is still required');
});

test('staging and committing a deletion preserve the same source digest',t=>{
 const root=fixture(t),before=ai.fingerprint(root);fs.unlinkSync(path.join(root,'app.js'));const digest=ai.fingerprint(root);
 assert.notEqual(digest,before,'deleting working-tree content changes the digest');
 assert.equal(spawnSync('git',['add','-u'],{cwd:root}).status,0);
 assert.equal(ai.fingerprint(root),digest);
 assert.equal(spawnSync('git',['commit','-qm','delete fixture'],{cwd:root}).status,0);
 assert.equal(ai.fingerprint(root),digest);
});

test('an additional failing check cannot be hidden by passing required profiles',t=>{
 const root=fixture(t),s=spec(root);s.required_tests=['build'];ai.write(root,72,'spec.json',s);
 ai.advance(root,72,'implementation');ai.advance(root,72,'review');ai.write(root,72,'review.json',review(root));
 ai.advance(root,72,'verification');let calls=0;
 const result=verify(root,72,['build','server'],{run:()=>calls++===0?{status:0,stdout:BUILD_OUTPUT}:{status:1,stdout:'failed'}});
 assert.deepEqual(result.checks.map(check=>check.result),['PASS','FAIL']);
 assert.throws(()=>ai.advance(root,72,'final_review'),/verification|check/i);
});

test('removing only the index entry keeps the working-file source digest',t=>{
 const root=fixture(t),before=ai.fingerprint(root);
 assert.equal(spawnSync('git',['rm','--cached','app.js'],{cwd:root}).status,0);
 assert.equal(fs.readFileSync(path.join(root,'app.js'),'utf8'),'original\n');
 assert.equal(ai.fingerprint(root),before);
});

const FAILED_TAP=TAP_OUTPUT.replace('ok 1','not ok 1').replace('# pass 1','# pass 0').replace('# fail 0','# fail 1');
const SKIPPED_TAP=TAP_OUTPUT.replace('fixture assertion','fixture assertion # SKIP unavailable').replace('# pass 1','# pass 0').replace('# skipped 0','# skipped 1');
const evidenceCases=[
 ['unit empty output','unit','','NOT RUN'],
 ['unit arbitrary text','unit','arbitrary non-test text','NOT RUN'],
 ['unit not ok without completion','unit','not ok 1 - failed','FAIL'],
 ['unit complete TAP','unit',TAP_OUTPUT,'PASS'],
 ['server complete TAP','server',TAP_OUTPUT,'PASS'],
 ['unit failing TAP','unit',FAILED_TAP,'FAIL'],
 ['unit skipped TAP','unit',SKIPPED_TAP,'NOT RUN'],
 ['unit CRLF TAP','unit',TAP_OUTPUT.replace(/\n/g,'\r\n'),'PASS'],
 ['unit summary without execution','unit',TAP_OUTPUT.replace('ok 1 - fixture assertion\n',''),'NOT RUN'],
 ['unit incomplete summary','unit',TAP_OUTPUT.replace('# skipped 0\n',''),'NOT RUN'],
 ['unit contradictory summary','unit',TAP_OUTPUT.replace('# tests 1','# tests 2'),'NOT RUN'],
 ['unit zero tests','unit','TAP version 13\n1..0\n# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n','NOT RUN'],
 ['unit bailout','unit',TAP_OUTPUT+'Bail out! interrupted\n','FAIL'],
 ['unit hidden not ok after summary','unit',TAP_OUTPUT+'not ok 2 - late failure\n','FAIL'],
 ['unit cancelled tests','unit',TAP_OUTPUT.replace('# pass 1','# pass 0').replace('# cancelled 0','# cancelled 1'),'FAIL'],
 ['unit todo tests','unit',TAP_OUTPUT.replace('# pass 1','# pass 0').replace('# todo 0','# todo 1'),'NOT RUN'],
 ['emulator both commands complete','emulator',TAP_OUTPUT+'emulator log\n'+TAP_OUTPUT,'PASS'],
 ['emulator only first command','emulator',TAP_OUTPUT,'NOT RUN'],
 ['emulator partial second command','emulator',TAP_OUTPUT+'TAP version 13\nok 1 - unfinished\n','NOT RUN'],
 ['emulator second command fails','emulator',TAP_OUTPUT+FAILED_TAP,'FAIL'],
 ['emulator second command skips','emulator',TAP_OUTPUT+SKIPPED_TAP,'NOT RUN'],
 ['build real output shape','build',BUILD_OUTPUT,'PASS'],
 ['build empty output','build','','NOT RUN'],
 ['build arbitrary JSON','build','{"success":true}\n','NOT RUN'],
 ['build truncated JSON','build',BUILD_OUTPUT.slice(0,-3),'NOT RUN'],
 ['browser completion','browser',BROWSER_OUTPUT,'PASS'],
 ['browser no completion','browser','Browser started','NOT RUN'],
 ['browser wrong mode','browser',DEMO_OUTPUT,'NOT RUN'],
 ['browser partial pages','browser',BROWSER_OUTPUT.replace('4/4','3/4'),'NOT RUN'],
 ['demo completion','demo',DEMO_OUTPUT,'PASS'],
 ['demo wrong mode','demo',BROWSER_OUTPUT,'NOT RUN'],
 ['demo missing completion','demo',BUILD_OUTPUT,'NOT RUN'],
 ['authenticated full completion','authenticated',BROWSER_OUTPUT+RULEBOOK_OUTPUT+OWNER_OUTPUT+PASSWORD_OUTPUT,'PASS'],
 ['authenticated owner only','authenticated',BROWSER_OUTPUT+RULEBOOK_OUTPUT+OWNER_OUTPUT,'NOT RUN'],
 ['authenticated password only','authenticated',PASSWORD_OUTPUT,'NOT RUN'],
 ['authenticated missing Rule Book','authenticated',BROWSER_OUTPUT+OWNER_OUTPUT+PASSWORD_OUTPUT,'NOT RUN']
];
const registry=profiles(path.join(__dirname,'..'));
for(const [name,profile,stdout,expected]of evidenceCases){
 test('profile evidence: '+name,()=>{
  const result=summarize({status:0,stdout,stderr:''},registry[profile].evidence);
  assert.equal(result.result,expected);
  if(expected==='NOT RUN')assert.ok(result.reason,'incomplete evidence needs an explanation');
 });
}
test('process failures override valid evidence for every profile',()=>{
 for(const [profile,command]of Object.entries(registry)){
  const stdout=profile==='emulator'?TAP_OUTPUT+TAP_OUTPUT:profile==='build'?BUILD_OUTPUT:
   profile==='demo'?DEMO_OUTPUT:profile==='browser'?BROWSER_OUTPUT:profile==='authenticated'?BROWSER_OUTPUT+RULEBOOK_OUTPUT+OWNER_OUTPUT+PASSWORD_OUTPUT:TAP_OUTPUT;
  assert.equal(summarize({status:1,stdout},command.evidence).result,'FAIL',profile);
  assert.equal(summarize({status:null,error:Object.assign(Error('missing'),{code:'ENOENT'}),stdout},command.evidence).result,'NOT RUN',profile);
  assert.equal(summarize({status:null,error:Object.assign(Error('timeout'),{code:'ETIMEDOUT'}),stdout},command.evidence).result,'FAIL',profile);
 }
});
test('verification stores profile-specific missing-evidence failures instead of PASS',t=>{
 const root=fixture(t);spec(root);
 for(const profile of Object.keys(registry)){
  const result=verify(root,72,[profile],{run:()=>({status:0,stdout:'',stderr:''})});
  assert.equal(result.checks[0].result,'NOT RUN',profile);
  assert.equal(ai.read(root,72,'verification.json').checks[0].result,'NOT RUN');
 }
});

test('isolated demonstration verifies the note through real Node TAP execution',t=>{
 const root=path.resolve(__dirname,'..');
 const result=require('../tools/ai/demo.js').demonstrate(root);
 assert.equal(path.dirname(result.output),path.join(root,'.ai/generated'));
 t.after(()=>fs.rmSync(result.output,{recursive:true,force:true}));
 const record=JSON.parse(fs.readFileSync(path.join(result.output,'tasks/900001/verification.json'),'utf8'));
 assert.equal(record.checks[0].profile,'unit');
 assert.equal(record.checks[0].result,'PASS');
 const log=fs.readFileSync(path.join(result.output,'generated/900001/unit.log'),'utf8');
 assert.equal(summarize({status:0,stdout:log},registry.unit.evidence).result,'PASS');
});
