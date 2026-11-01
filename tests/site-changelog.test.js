'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const {validateChangelog,assertPrUpdated,publishChangelog}=require('../tools/site-changelog.js');

const entry=(pr=99)=>({date:'2026-11-01',pr,title:'Testing site update',changes:['Describe what changed for testers.']});
const log=(...entries)=>({schemaVersion:1,entries});

test('change log requires valid dates, safe text, and unique PR entries',()=>{
 assert.equal(validateChangelog(log(entry(99))).entries[0].pr,99);
 assert.throws(()=>validateChangelog(log(entry(99),entry(99))),/duplicate|unique/i);
 assert.throws(()=>validateChangelog(log({...entry(99),date:'2026-02-30'})),/date/i);
 assert.throws(()=>validateChangelog(log({...entry(99),changes:[]})),/changes/i);
 assert.throws(()=>validateChangelog(log({...entry(99),changes:['<script>alert(1)</script>']})),/markup|html|script/i);
});

test('each PR must change its own entry; unchanged or unrelated entries are rejected',()=>{
 const old=log(entry(98));
 const newLog=log(entry(99),entry(98));
 assert.doesNotThrow(()=>assertPrUpdated(newLog,old,99));
 assert.throws(()=>assertPrUpdated(old,old,99),/PR #99/);
 assert.throws(()=>assertPrUpdated(newLog,newLog,99),/not changed|update/i);
 assert.throws(()=>assertPrUpdated(newLog,old,100),/PR #100/);
});

test('build stages an identical public read-only change log from repository data',()=>{
 const actual=validateChangelog(JSON.parse(read('CHANGELOG.json')));
 assert.ok(actual.entries.some(e=>e.pr===99));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paws-changelog-'));
 try{
   publishChangelog(root,dir);
   const staged=JSON.parse(fs.readFileSync(path.join(dir,'changelog.json'),'utf8'));
   assert.deepEqual(staged,actual);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('home page has one large floating dialog with an open and close button',()=>{
 const html=read('frontend/pages/index.html');
 const css=read('frontend/styles/site-changelog.css');
 const js=read('frontend/scripts/site-changelog.js');
 const assets=JSON.parse(read('tools/static-assets.paws.json'));
 assert.match(html,/id="site-changelog-open"/);
 assert.match(html,/<dialog[^>]+id="site-changelog-dialog"/);
 assert.match(html,/id="site-changelog-close"/);
 assert.match(html,/src="site-changelog\.js"/);
 assert.match(html,/href="site-changelog\.css"/);
 assert.match(css,/width:\s*min\(\s*9\d\dpx/);
 assert.match(js,/showModal\(/);
 assert.match(js,/\.close\(/);
 assert.match(js,/changelog\.json/);
 assert.match(js,/textContent/);
 assert.doesNotMatch(js,/innerHTML\s*=\s*.*changes/i);
 assert.ok(assets.includes('site-changelog.js'));
 assert.ok(assets.includes('site-changelog.css'));
});

test('every agent entrypoint and PR workflow require change log updates',()=>{
 for(const file of ['agent.md','AGENTS.md']){
   assert.match(read(file),/CHANGELOG\.json/);
   assert.match(read(file),/each PR|every PR|每个 PR/i);
 }
 for(const file of ['.github/workflows/test.yml','.github/workflows/github-pages-test.yml']){
   const workflow=read(file);
   assert.match(workflow,/tools\/check-pr-changelog\.js/);
   assert.match(workflow,/pull_request\.number/);
   assert.match(workflow,/pull_request\.base\.sha/);
 }
});
