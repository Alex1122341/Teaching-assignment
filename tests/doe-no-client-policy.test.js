'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Timetable active runtime loads DOE API but not browser policy calculation modules',()=>{
  const html=read('index.html');
  assert.match(html,/src="doe-api-client\.js"/);
  for(const name of ['doe-formula.js','doe-policy-engine.js','doe-policy-service.js'])assert.doesNotMatch(html,new RegExp(`src="${name.replaceAll('.','\\.')}"`),name);
  assert.ok(html.indexOf('doe-api-client.js')<html.indexOf('timetable-selection.js'));
  assert.ok(html.indexOf('doe-api-client.js')<html.indexOf('timetable.js'));
});

test('Faculty DOE runtime uses API for calculations and does not load browser engine/service',()=>{
  const html=read('faculty-admin.html');
  assert.match(html,/src="doe-api-client\.js"/);
  for(const name of ['doe-formula.js','doe-policy-engine.js','doe-policy-service.js'])assert.doesNotMatch(html,new RegExp(`src="${name.replaceAll('.','\\.')}"`),name);
  assert.ok(html.indexOf('doe-api-client.js')<html.indexOf('doe-policy-admin.js'));
  assert.ok(html.indexOf('doe-api-client.js')<html.indexOf('faculty-admin.js'));
});

test('browser DOE admin has no local engine service or recalculation writer authority',()=>{
  const source=read('doe-policy-admin.js');
  assert.doesNotMatch(source,/UCVM_DOE_POLICY_ENGINE|require\(['"]\.\/doe-policy-engine\.js['"]\)/);
  assert.doesNotMatch(source,/UCVM_DOE_POLICY_SERVICE|createService\s*\(/);
  assert.doesNotMatch(source,/createFirestoreRecalculationWriter|stageCalculationRecord\s*\(/);
  assert.match(source,/UCVM_DOE_API/);
});

test('active browser pages contain no hard-coded UCVM DOE rate table',()=>{
  const pages=['index.html','faculty-admin.html'];
  const scripts=new Set();
  for(const page of pages)for(const match of read(page).matchAll(/<script src="([^"]+\.js)"/g))if(!/^https?:/.test(match[1]))scripts.add(match[1]);
  const active=[...scripts].map(name=>read(name)).join('\n');
  assert.doesNotMatch(active,/Lecture\s*[=:]\s*0\.30/i);
  assert.doesNotMatch(active,/Lab Primary\s*[=:]\s*0\.21/i);
  assert.doesNotMatch(active,/Lab Secondary\s*[=:]\s*0\.19/i);
  assert.doesNotMatch(active,/HICC\s*[=:]\s*2(?:\.0+)?/i);
});


test('authoritative DOE Firestore collections are client read-only after API cutover',()=>{
  const rules=read('firestore.rules');
  const collections=[
    'doe_policies','doe_policy_versions','doe_rules','doe_rule_selectors','doe_rule_parameters',
    'doe_rule_tiers','doe_rule_inputs','doe_exceptions','doe_reference_sources','doe_course_mappings',
    'doe_subject_mappings','doe_impact_runs','doe_impact_rows','doe_publications',
    'doe_recalculation_batches','doe_calculation_records','doe_audit_log'
  ];
  for(const name of collections){
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const block=rules.match(new RegExp(`match /${escaped}/\\{id\\} \\{([\\s\\S]*?)\\n  \\}`));
    assert.ok(block,`missing Firestore match block for ${name}`);
    assert.match(block[1],/allow create,update,delete: if false/,`${name} must be server-write-only`);
  }
});
