'use strict';
// Static guard for the SQL 057 disposable acceptance harness. It cannot execute
// SQL here, so it proves the harness is present, wired, and only references
// objects and columns that the reviewed migrations actually define.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const acceptance=read('database/azure-sql/057_ccc_schedule_read_acceptance.sql');
const rollback=read('database/azure-sql/rollback_057_ccc_schedule_read.sql');
const wrapper=read('tools/test-ccc-schedule-sql.ps1');
const workflow=read('.github/workflows/ccc-schedule-sql.yml');
const migrations=fs.readdirSync(path.join(root,'database/azure-sql'))
 .filter(name=>name.endsWith('.sql')).map(name=>read('database/azure-sql/'+name)).join('\n');

function tableBlock(schema,table){
 const pattern=new RegExp('CREATE TABLE '+schema.replace('.','\\.')+'\\.'+table+'[\\s\\S]*?\\n\\);');
 const match=migrations.match(pattern);
 return match?match[0]:null;
}
// Columns may arrive through CREATE TABLE or a later reviewed ALTER TABLE ... ADD.
function tableColumns(schema,table){
 const name=schema+'\\.'+table;
 const parts=[];
 const create=migrations.match(new RegExp('CREATE TABLE '+name+'[\\s\\S]*?\\n\\);'));
 if(create)parts.push(create[0]);
 for(const alter of migrations.matchAll(new RegExp('ALTER TABLE '+name+' ADD ([\\s\\S]*?);','g')))parts.push(alter[1]);
 return parts.join('\n');
}

test('the 057 acceptance harness exists and is wired to a labeled disposable container',()=>{
 assert.match(wrapper,/-Through '041' -SkipAcceptance/);
 assert.match(wrapper,/057_ccc_schedule_read\.sql/);
 assert.match(wrapper,/057_ccc_schedule_read_acceptance\.sql/);
 assert.match(wrapper,/rollback_057_ccc_schedule_read\.sql/);
 assert.match(wrapper,/PAWS_CCC_SCHEDULE_DEFINITION_SHA256=/);
 assert.doesNotMatch(wrapper,/-Server\b|\bServer=/,'the harness must never accept a server argument');
 assert.match(workflow,/--name paws-calendar-ccc-schedule --label paws\.calendar-test=1/);
 assert.match(workflow,/test-ccc-schedule-sql\.ps1 -ContainerName paws-calendar-ccc-schedule/);
 assert.match(workflow,/docker rm -f paws-calendar-ccc-schedule/);
});

test('the acceptance script covers every required 057 behaviour',()=>{
 for(const marker of [
  'CCC_SCHEDULE_READ_ACCEPTANCE_OK',
  'CCC_SCHEDULE_ROLLBACK_OK',
  'paws_runtime_read',
  '55701',
  '55702',
  '55708'
 ])assert.ok(wrapper.includes(marker)||acceptance.includes(marker)||rollback.includes(marker),marker);
 // Role matrix, boundaries, half day, Locum and privacy are all asserted.
 for(const role of ['ccc-owner','ccc-faculty','ccc-hicc','ccc-visc','ccc-adc','ccc-lab','ccc-viewer','ccc-inactive','ccc-password','ccc-unlinked'])
  assert.ok(acceptance.includes(role),role);
 assert.match(acceptance,/2026-05-01/);
 assert.match(acceptance,/2027-04-30/);
 assert.match(acceptance,/2027-05-01/);
 assert.match(acceptance,/halfDay/);
 assert.match(acceptance,/Locum/);
 assert.match(acceptance,/six-key allowlist/);
});

test('every table the acceptance script touches is defined by a reviewed migration',()=>{
 const touched=new Set([...acceptance.matchAll(/\b(paws|staging)\.([A-Za-z0-9_]+)/g)].map(m=>`${m[1]}.${m[2]}`));
 assert.ok(touched.size>=8,`expected a broad fixture, saw ${[...touched].join(',')}`);
 for(const name of touched){
  const [schema,table]=name.split('.');
  assert.ok(tableBlock(schema,table),`${name} is not created by any migration`);
 }
});

test('every stored procedure the acceptance script calls is defined by a reviewed migration',()=>{
 const called=new Set([...acceptance.matchAll(/EXEC\s+(paws_api\.[A-Za-z0-9_]+)/gi)].map(m=>m[1]));
 assert.ok(called.has('paws_api.ListCccSchedule'));
 for(const name of called){
  assert.match(migrations,new RegExp('CREATE (?:OR ALTER )?PROCEDURE '+name.replace('.','\\.'),'i'),name);
 }
});

test('every column the acceptance script writes exists on its target table',()=>{
 const writes=[...acceptance.matchAll(/INSERT\s+(paws\.[A-Za-z0-9_]+|staging\.[A-Za-z0-9_]+)\s*\(([^)]*)\)/gi)];
 assert.ok(writes.length>=6,`expected several fixture inserts, saw ${writes.length}`);
 for(const write of writes){
  const target=write[1];
  const [schema,table]=target.split('.');
  const block=tableBlock(schema,table);
  assert.ok(block,`${target} is not created by any migration`);
  const columns=tableColumns(schema,table);
  for(const column of write[2].split(',').map(value=>value.trim()).filter(Boolean)){
   const escaped=column.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   assert.match(columns,new RegExp('\\b'+escaped+'\\b'),`${target}.${column} is not a defined column`);
  }
 }
});

test('synthetic CCC acceptance year counts match the actual inserted fixture rows',()=>{
 // Static regression only: this does not replace SQL Server execution.
 const begin=acceptance.indexOf('/* 12 synthetic CCC rows:');
 const end=acceptance.indexOf(') rows(faculty,label,starts,ends,rowid,n,kind,stafflabel,block,col);',begin);
 assert.ok(begin>=0&&end>begin,'synthetic activity fixture is present');
 const block=acceptance.slice(begin,end);
 const rows=[...block.matchAll(/^\s*\((@ActiveFaculty|@OtherFaculty|@InactiveFaculty|CAST\(NULL AS uniqueidentifier\)),N'[^']+','(\d{4}-\d{2}-\d{2})','(\d{4}-\d{2}-\d{2})',@Row\d+,/gm)];
 assert.equal(rows.length,12,'synthetic fixture inserts exactly twelve CCC rows');
 const expected=rows.filter(m=>m[1]!=='@InactiveFaculty'&&m[2]<'2027-05-01'&&m[3]>='2026-05-01').length;
 assert.equal(expected,10,'ten active CCC rows belong to academic year 2026-27');
 const guards=[...acceptance.matchAll(/<>\s*(\d+)\s+THROW 55790,'(?:Owner year coverage|CCC reader duplicated|CCC reader produced duplicate|Linked faculty|HICC did not|VISC did not|ADC did not|LAB did not)/g)];
 assert.equal(guards.length,8,'owner, read-role and dedup checks all specify fixture size');
 for(const match of guards)assert.equal(Number(match[1]),expected,'asserted year count must equal inserted fixture');
});
