'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tool=require('../tools/seed-lab-admin.js');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const dataset={
  projectId:'vista-teaching-lab',
  counts:{users:2,settings:1,labGroups:1,total:4},
  documents:[
    {path:'users/uid-developer',data:{role:'developer'}},
    {path:'users/uid-owner',data:{role:'owner'}},
    {path:'settings/example',data:{value:1}},
    {path:'lab_groups/group-a',data:{groupId:'group-a'}}
  ]
};

function fakeFirestore(initial=[]){
  const existing=new Set(initial);
  const created=[];
  const setCalls=[];
  return{
    existing,created,setCalls,
    doc:path=>({path}),
    getAll:async(...refs)=>refs.map(ref=>({exists:existing.has(ref.path)})),
    batch:()=>{
      const pending=[];
      return{
        create:(ref,data)=>{created.push({path:ref.path,data});pending.push(ref.path)},
        set:(ref,data)=>{setCalls.push({path:ref.path,data});pending.push(ref.path)},
        commit:async()=>{pending.forEach(path=>existing.add(path))}
      };
    }
  };
}

test('live Lab fixture projection excludes synthetic users but keeps canonical non-account data',()=>{
  const projected=tool.labFixtureDataset(dataset);
  assert.deepEqual(projected.documents.map(row=>row.path),['settings/example','lab_groups/group-a']);
  assert.equal(projected.counts.users,0);
  assert.equal(projected.counts.total,2);
  assert.equal(projected.excludedSyntheticUsers,2);
});

test('verify ignores synthetic user fixtures and reports only missing live Lab fixture documents',async()=>{
  const firestore=fakeFirestore(['settings/example']);
  const result=await tool.verifyDataset(firestore,dataset);
  assert.deepEqual(result,{total:2,present:1,missing:['lab_groups/group-a'],ok:false,excludedSyntheticUsers:2});
});

test('repair creates only missing non-account fixtures and never overwrites existing documents',async()=>{
  const firestore=fakeFirestore(['settings/example']);
  const repaired=await tool.repairMissingDataset(firestore,dataset);
  assert.equal(repaired.written,1);
  assert.deepEqual(firestore.created.map(row=>row.path),['lab_groups/group-a']);
  assert.deepEqual(firestore.setCalls,[]);
  assert.equal(firestore.created.some(row=>row.path.startsWith('users/')),false);
  const second=await tool.repairMissingDataset(firestore,dataset);
  assert.equal(second.written,0);
  assert.equal(firestore.created.length,1);
});

test('seed mode also excludes synthetic users from live Lab writes',async()=>{
  const firestore=fakeFirestore();
  const seeded=await tool.seedDataset(firestore,dataset);
  assert.equal(seeded.written,2);
  assert.deepEqual(firestore.setCalls.map(row=>row.path).sort(),['lab_groups/group-a','settings/example']);
  assert.equal(firestore.setCalls.some(row=>row.path.startsWith('users/')),false);
});

test('repair is a supported lab-only mode',()=>{
  assert.equal(tool.validateOptions({mode:'repair'},{projectId:'vista-teaching-lab'}).mode,'repair');
  assert.throws(()=>tool.validateOptions({mode:'repair'},{projectId:'tester-teaching'}),/vista-teaching-lab/);
});

test('workflow exposes confirmation-gated repair-data without coupling it to rule deployment',()=>{
  const source=read('.github/workflows/firebase-lab-data-setup.yml');
  assert.match(source,/\n\s*- repair-data\s*\n/);
  assert.match(source,/REPAIR:vista-teaching-lab/);
  assert.match(source,/repair-data\) expected="REPAIR:vista-teaching-lab"/);
  assert.match(source,/inputs\.operation == 'repair-data'[\s\S]*--mode repair/);
  assert.doesNotMatch(source,/inputs\.operation == 'repair-data'[^\n]*\|\|[^\n]*deploy-firestore/);
});

test('package exposes an explicit lab data repair command',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['lab:data:repair'],'node tools/seed-lab-admin.js --mode repair');
});
