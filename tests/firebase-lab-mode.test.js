'use strict';
// Firebase Lab mode focused tests.
//
// These tests protect the boundary between the two PAWS browser test modes:
//   FRONTEND DEMO   synthetic, browser-local, no cloud
//   FIREBASE LAB    real Firebase Auth + Firestore against vista-teaching-lab
// and they guard the DOE read-only boundary.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const staging=require('../tools/stage-github-pages.js');
const labDoe=require('../tools/doe-policy-firebase-lab.js');
const office=require('../office-capabilities.js');

const LAB_RUNTIME='tools/firebase-lab-runtime.js';
const LAB_DOE='tools/doe-policy-firebase-lab.js';
const LAB_WORKFLOW='.github/workflows/firebase-lab-pages.yml';
const LAB_PROJECT_ID='vista-teaching-lab';
const SHA='a'.repeat(40);
const FAKE_WEB_KEY='AIza'+'A'.repeat(35);

const HTML='<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>'+
  '<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>'+
  '<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>'+
  '<script src="firebase-config.js"></script>'+
  '</body></html>';
const CONFIG_SOURCE='(function(root){const config={apiKey:"placeholder",authDomain:"x",projectId:"vista-teaching-lab",storageBucket:"s",messagingSenderId:"0",appId:"1:0:web:0"};root.UCVM_FIREBASE_CONFIG=config;})(window);\n';

function makeDirectory(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'paws-pages-'));
  fs.writeFileSync(path.join(directory,'index.html'),HTML);
  fs.writeFileSync(path.join(directory,'firebase-config.js'),CONFIG_SOURCE);
  return directory;
}

function writeLabConfig(directory,overrides={}){
  const file=path.join(directory,'lab-config.json');
  fs.writeFileSync(file,JSON.stringify(Object.assign({
    apiKey:FAKE_WEB_KEY,
    authDomain:LAB_PROJECT_ID+'.firebaseapp.com',
    projectId:LAB_PROJECT_ID,
    storageBucket:LAB_PROJECT_ID+'.firebasestorage.app',
    messagingSenderId:'000000000000',
    appId:'1:000000000000:web:0000000000000000000000'
  },overrides)));
  return file;
}

function fakeFirestore(collections){
  return{
    collection(name){
      const rows=(collections&&collections[name])||[];
      const filters=[];
      const reference={
        where(field,operator,value){filters.push({field,operator,value});return reference},
        async get(){
          const matched=rows.filter(row=>filters.every(filter=>row.data[filter.field]===filter.value));
          return{docs:matched.map(row=>({id:row.id,data:()=>row.data}))};
        },
        doc(id){
          const found=rows.find(row=>row.id===id);
          return{async get(){return{id,data:()=>found?found.data:undefined}}};
        }
      };
      return reference;
    }
  };
}

test('1. Frontend Demo remains synthetic and cloud-free',()=>{
  const directory=makeDirectory();
  const result=staging.stagePagesDirectory(directory,{prNumber:7,headSha:SHA,buildSha:SHA});
  assert.equal(result.mode,'frontend-demo');
  const html=fs.readFileSync(path.join(directory,'index.html'),'utf8');
  assert.match(html,/pages-demo-runtime\.js/);
  assert.match(html,/pages-demo-data\.js/);
  assert.doesNotMatch(html,/firebase-lab-runtime\.js/);
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'github-pages-build.json'),'utf8'));
  assert.equal(manifest.mode,'frontend-demo');
  assert.equal(manifest.doeBackend,'disabled');
  const runtime=read('tools/pages-demo-runtime.js');
  assert.match(runtime,/UCVM_FRONTEND_DEMO_MODE\s*=\s*true/);
  assert.match(runtime,/backend\s*:\s*['"]browser-memory['"]/);
  assert.match(runtime,/doeAuthoritative\s*:\s*false/);
});

test('2. Firebase Lab does not install the synthetic Firebase compatibility runtime',()=>{
  const directory=makeDirectory();
  const configPath=writeLabConfig(directory);
  const result=staging.stagePagesDirectory(directory,{prNumber:0,headSha:SHA,buildSha:SHA},{mode:'lab',configPath});
  assert.equal(result.mode,'firebase-lab');
  assert.equal(fs.existsSync(path.join(directory,'pages-demo-runtime.js')),false);
  assert.equal(fs.existsSync(path.join(directory,'pages-demo-data.js')),false);
  const html=fs.readFileSync(path.join(directory,'index.html'),'utf8');
  assert.doesNotMatch(html,/pages-demo/);
  assert.match(html,/firebase-lab-runtime\.js/);
  assert.match(html,/doe-policy-firebase-lab\.js/);
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'github-pages-build.json'),'utf8'));
  assert.equal(manifest.mode,'firebase-lab');
  assert.equal(manifest.syntheticRuntime,false);
  // The runtime refuses to start if the demo runtime is somehow present.
  assert.match(read(LAB_RUNTIME),/UCVM_FRONTEND_DEMO_MODE===true/);
  assert.match(read(LAB_RUNTIME),/refused to start/);
});

test('3. Firebase Lab targets only vista-teaching-lab',()=>{
  assert.equal(staging.LAB_PROJECT_ID,LAB_PROJECT_ID);
  assert.equal(labDoe.LAB_PROJECT_ID,LAB_PROJECT_ID);
  const directory=makeDirectory();
  const configPath=writeLabConfig(directory);
  const result=staging.stagePagesDirectory(directory,{prNumber:0,headSha:SHA,buildSha:SHA},{mode:'lab',configPath});
  assert.equal(result.projectId,LAB_PROJECT_ID);
  const configSource=fs.readFileSync(path.join(directory,'firebase-config.js'),'utf8');
  assert.match(configSource,/vista-teaching-lab/);
  // A non-lab project is rejected outright.
  const other=writeLabConfig(directory,{projectId:'tester-teaching'});
  assert.throws(()=>staging.readLabConfig({configPath:other}),/must target vista-teaching-lab/);
  assert.match(read(LAB_WORKFLOW),/FIREBASE-LAB:vista-teaching-lab/);
});

test('4. Firebase Lab uses Firebase Authentication',()=>{
  const runtime=read(LAB_RUNTIME);
  assert.match(runtime,/firebase\.auth\(\)/);
  assert.match(runtime,/currentUser/);
  assert.match(runtime,/onAuthStateChanged/);
  // It must never replace the real SDK with a synthetic one.
  assert.doesNotMatch(runtime,/root\.firebase\s*=/);
  assert.doesNotMatch(runtime,/window\.firebase\s*=\s*runtime/);
});

test('5. users/{uid} profile authorization remains required',()=>{
  const access=read('faculty-access.js');
  assert.match(access,/users\/\$\{user\.uid\}/);
  const runtime=read(LAB_RUNTIME);
  // The lab runtime must not invent a profile source or a second role system.
  assert.doesNotMatch(runtime,/role\s*:\s*['"]developer['"]/);
  assert.doesNotMatch(runtime,/UCVM_PAGES_DEMO\.doeRulebook/);
  assert.doesNotMatch(runtime,/users\/\{uid\}/);
});

test('6. no production tester-teaching target enters the lab path',()=>{
  for(const file of [LAB_RUNTIME,LAB_DOE,LAB_WORKFLOW,'tools/stage-github-pages.js']){
    assert.doesNotMatch(read(file),/tester-teaching/,`${file} must not reference the production project`);
  }
});

test('7. no admin or service-account credentials enter browser artifacts',()=>{
  for(const file of [LAB_RUNTIME,LAB_DOE]){
    const source=read(file);
    assert.doesNotMatch(source,/service_account/i,file);
    assert.doesNotMatch(source,/BEGIN PRIVATE KEY/i,file);
    assert.doesNotMatch(source,/firebase-admin/i,file);
    assert.doesNotMatch(source,/private_key/i,file);
    assert.doesNotMatch(source,/FIREBASE_TOKEN|serviceAccount/i,file);
  }
  // The workflow may only consume the public lab web configuration secret.
  const workflow=read(LAB_WORKFLOW);
  const secrets=[...new Set((workflow.match(/secrets\.[A-Z_]+/g)||[]))].sort();
  assert.deepEqual(secrets,['secrets.LAB_FIREBASE_WEB_CONFIG']);
  assert.doesNotMatch(workflow,/secrets\.AZURE|secrets\.GCP|secrets\.FIREBASE_ADMIN|secrets\.SERVICE_ACCOUNT/);
});

test('8. the ADC / LAB / ADFA capability matrix is unchanged',()=>{
  const adc=office.forRole('adc');
  assert.equal(adc.canEditCourseFields,true);
  assert.equal(adc.canEditLabTopic,false);
  assert.equal(adc.canEditInstructor,false);
  const lab=office.forRole('lab');
  assert.equal(lab.canEditLabTopic,true);
  assert.equal(lab.canEditCourseFields,false);
  assert.equal(lab.canEditInstructor,false);
  const adfa=office.forRole('adfa_general');
  assert.equal(adfa.canEditInstructor,true);
  assert.equal(adfa.canEditLabTopic,false);
  const faculty=office.forRole('faculty');
  assert.equal(faculty.canEditCourseFields,false);
  assert.equal(faculty.canEditLabTopic,false);
  assert.equal(faculty.canEditInstructor,false);
});

test('9. the Firebase Lab DOE reader is read-only',()=>{
  const service=labDoe.createService({firestore:fakeFirestore({})});
  assert.equal(service.readOnly,true);
  assert.equal(service.authoritative,false);
  assert.equal(service.backend,'firebase-lab-firestore');
  for(const name of labDoe.WRITE_METHODS){
    assert.equal(typeof service[name],'function',`${name} must exist and fail closed`);
    const result=service[name]({});
    assert.rejects?null:null;
    result.then(()=>{throw new Error(`${name} must not succeed`)},error=>{
      assert.equal(error.code,labDoe.WRITE_ERROR_CODE);
    });
  }
});

test('9b. every DOE write attempt rejects with TRUSTED_DOE_BACKEND_REQUIRED',async()=>{
  const service=labDoe.createService({firestore:fakeFirestore({})});
  for(const name of ['saveRule','publish','archive','runRecalculate','createPolicyYear','cloneAsDraft','validateDraft','runImpactPreview']){
    await assert.rejects(()=>service[name]({}),error=>{
      assert.equal(error.code,'TRUSTED_DOE_BACKEND_REQUIRED');
      return true;
    });
  }
});

test('10. DOE policy collections remain browser write-denied by firestore.rules',()=>{
  const rules=read('firestore.rules');
  for(const collection of Object.values(labDoe.COLLECTIONS)){
    const pattern=new RegExp('match /'+collection+'/\\{id\\} \\{[^]*?allow create,update,delete: if false;');
    assert.match(rules,pattern,collection);
  }
});

test('11. Rule Book can render a real Firebase-shaped policy bundle',async()=>{
  const collections={
    doe_policy_versions:[{id:'v1',data:{policyVersionId:'v1',policyId:'p1',academicYear:'2026-27',versionNumber:1,status:'active',revision:2}}],
    doe_policies:[{id:'p1',data:{policyId:'p1',academicYear:'2026-27',name:'Lab Rule Book',currentActiveVersionId:'v1'}}],
    doe_rules:[{id:'r1',data:{ruleId:'r1',policyVersionId:'v1',ruleKey:'teaching.lecture',name:'Lecture rate',category:'teaching',priority:10,enabled:true}}],
    doe_rule_selectors:[{id:'s1',data:{selectorId:'s1',ruleId:'r1',policyVersionId:'v1',field:'activityType',operator:'equals',valueText:'Lecture'}}],
    doe_rule_parameters:[{id:'p1',data:{parameterId:'p1',ruleId:'r1',policyVersionId:'v1',name:'rate',valueNumber:14}}],
    doe_rule_tiers:[{id:'t1',data:{tierId:'t1',ruleId:'r1',policyVersionId:'v1',fromValue:0,toValue:10}}],
    doe_rule_inputs:[{id:'i1',data:{ruleInputId:'i1',ruleId:'r1',policyVersionId:'v1',inputName:'hours'}}],
    doe_exceptions:[{id:'e1',data:{exceptionId:'e1',policyVersionId:'v1'}}],
    doe_reference_sources:[{id:'ref1',data:{referenceId:'ref1',policyVersionId:'v1',title:'UCVM Workload Guidelines',section:'6.4'}}],
    doe_course_mappings:[{id:'cm1',data:{mappingId:'cm1',policyVersionId:'v1',courseCode:'VTMD 204',unitCount:2}}],
    doe_subject_mappings:[{id:'sm1',data:{mappingId:'sm1',policyVersionId:'v1',subjectKey:'anatomy'}}],
    doe_impact_runs:[{id:'ir1',data:{impactRunId:'ir1',policyVersionId:'v1',completedAt:'2026-09-01T00:00:00.000Z'}}],
    doe_impact_rows:[{id:'ir1-r1',data:{impactRowId:'ir1-r1',impactRunId:'ir1',facultyId:'f1'}}]
  };
  const service=labDoe.createService({firestore:fakeFirestore(collections)});
  const policies=await service.listPolicies();
  assert.equal(policies.length,1);
  assert.equal(policies[0].academicYear,'2026-27');
  const versions=await service.listVersions('p1');
  assert.equal(versions.length,1);
  const bundle=await service.loadPolicyBundle('v1');
  assert.equal(bundle.policy.policyId,'p1');
  assert.equal(bundle.version.policyVersionId,'v1');
  assert.equal(bundle.rules.length,1);
  assert.equal(bundle.rules[0].selectors.length,1);
  assert.equal(bundle.rules[0].parameters.length,1);
  assert.equal(bundle.rules[0].tiers.length,1);
  assert.equal(bundle.rules[0].inputs.length,1);
  assert.equal(bundle.references.length,1);
  assert.equal(bundle.courseMappings.length,1);
  assert.equal(bundle.subjectMappings.length,1);
  assert.equal(bundle.exceptions.length,1);
  const preview=await service.getImpactPreview('v1');
  assert.equal(preview.run.impactRunId,'ir1');
  assert.equal(preview.rows.length,1);
  const audit=await service.listAudit('v1');
  assert.deepEqual(audit,[]);
});

test('12. authoritative DOE write actions stay disabled without the trusted backend',()=>{
  const admin=read('doe-policy-admin.js');
  // A read-only lab service is accepted without a save method, and write
  // capabilities are switched off for it.
  assert.match(admin,/UCVM_FIREBASE_LAB_MODE===true\?root\?\.UCVM_DOE_LAB_SERVICE/);
  assert.match(admin,/if\(!readOnlyService&&!api\?\.saveRule\)return false/);
  assert.match(admin,/if\(state\.demoReadOnly\)for\(const key of \['editDraft','validate','preview','publish','archive','recalculate'\]\)cap\[key\]=false/);
  assert.match(admin,/authoritative writer OFF/);
});

test('13. Work Queue READY items still route to openScopedEditor',()=>{
  const queue=read('work-queue.js');
  assert.match(queue,/openScopedEditor/);
  assert.match(queue,/status==='ready'\?'READY'/);
});

test('14. LAB / ADC / ADFA field ownership stays enforced in the scoped editor',()=>{
  const capabilities=read('office-capabilities.js');
  assert.match(capabilities,/canEditCourseFields/);
  assert.match(capabilities,/canEditLabTopic/);
  assert.match(capabilities,/canEditInstructor/);
  assert.equal(office.forRole('adc').canEditLabTopic,false);
  assert.equal(office.forRole('lab').canEditCourseFields,false);
  assert.equal(office.forRole('adfa_general').canEditCourseFields,false);
  assert.equal(office.forRole('faculty').canEditCourseFields,false);
});

test('15. Frontend Demo browser smoke surface is untouched',()=>{
  const smoke=read('tools/browser-smoke.js');
  assert.match(smoke,/process\.argv\.includes\('--demo'\)/);
  assert.match(smoke,/Pages Frontend Demo mode is not enabled/);
  assert.match(smoke,/unexpected Firebase cloud request/);
  const workflow=read('.github/workflows/github-pages-test.yml');
  assert.match(workflow,/node tools\/stage-github-pages\.js/);
  assert.doesNotMatch(workflow,/--mode lab/);
});

test('16. Firebase Lab is manual-only and never an implicit PR default',()=>{
  const workflow=read(LAB_WORKFLOW);
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/\n\s*push:/);
  assert.doesNotMatch(workflow,/\n\s*pull_request:/);
  assert.doesNotMatch(workflow,/workflow_run:/);
  assert.doesNotMatch(workflow,/schedule:/);
  assert.doesNotMatch(workflow,/repository_dispatch:/);
  assert.match(workflow,/PUBLISH-LAB-TO-PAGES/);
  // The normal Pages workflow must stay in demo mode.
  const pages=read('.github/workflows/github-pages-test.yml');
  assert.doesNotMatch(pages,/--mode lab/);
  // No Azure deployment surface is introduced here.
  assert.doesNotMatch(workflow,/Azure\/static-web-apps-deploy|AZURE_STATIC_WEB_APPS_API_TOKEN/);
});
