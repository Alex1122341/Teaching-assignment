const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..'),script=path.join(root,'tools','optimize_firestore_data.py');
const s=v=>({stringValue:String(v)}),n=v=>({doubleValue:v}),a=v=>({arrayValue:{values:v.map(encode)}}),m=v=>({mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}});
function encode(v){if(Array.isArray(v))return a(v);if(v&&typeof v==='object')return m(v);if(typeof v==='number')return n(v);if(typeof v==='boolean')return{booleanValue:v};if(v===null)return{nullValue:null};return s(v)}
function doc(pathName,fields){return{path:pathName,collectionPath:pathName.split('/').slice(0,-1).join('/'),documentId:pathName.split('/').at(-1),topLevelCollection:pathName.split('/')[0],fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,encode(v)]))}}
function fixture(){const documents=[
 doc('sessions/s1',{id:'s1',sourceWorkbook:'old.xlsx',sourceSchema:'v1',sourceCourseTypes:['LEC'],course:'501',date:'2026-09-01',assignments:[{ucid:'1001'},{facultyId:'1002'},{ucid:'1001'}]}),
 doc('faculty/1001',{ucid:'1001',preferredFullName:'Alpha',doe:{teaching:40,research:20},doeTeaching:40,doeResearch:99,specialtySearchText:'alpha',sourceKeyRow:4,doeImportedBy:'x'}),
 doc('faculty/1002',{ucid:'1002',preferredFullName:'Beta',doe:{teaching:30},doeTeaching:30}),
 doc('settings/migrations_assigned_ad_removed',{completedBy:'x'}),
 doc('faculty_change_log/log1',{action:'keep'}),doc('account_audit/a1',{action:'keep'})
 ];return{format:'firestore-rest-typed-v1',sourceProject:'tester-teaching',documentCount:documents.length,documents}}

test('cleanup dry run backfills IDs, deletes only safe duplicates, and preserves business paths',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ucvm-cleanup-')),backup=path.join(dir,'backup.json');fs.writeFileSync(backup,JSON.stringify(fixture()));
 const run=spawnSync('python',[script,'--project','tester-teaching','--backup',backup,'--dry-run'],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);const report=JSON.parse(run.stdout.trim());
 assert.equal(report.sessionsChanged,1);assert.equal(report.sessionFacultyIdsBackfilled,1);
 assert.equal(report.completedMarkersDeleted,1);assert.equal(report.doeFieldsDeleted,2);
 assert.equal(report.doeMismatches,1);assert.ok(report.preservedDocumentPaths.includes('faculty_change_log/log1'));assert.ok(report.preservedDocumentPaths.includes('account_audit/a1'));
 assert.equal(report.settingsDocumentsWritten,2);
});

test('cleanup planner is idempotent after applying its local mutations',()=>{
 const code=`import json,sys;sys.path.insert(0,r'${path.join(root,'tools').replace(/\\/g,'\\\\')}');import optimize_firestore_data as o;d=${JSON.stringify(fixture())};p=o.plan_cleanup(d);o.apply_plan_locally(d,p);q=o.plan_cleanup(d);print(json.dumps({'writes':q['report']['documentWrites'],'marker':q['report']['completedMarkersDeleted'],'mismatch':q['report']['doeMismatches']}))`;
 const run=spawnSync('python',['-c',code],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout.trim());
 assert.equal(result.writes,2);assert.equal(result.marker,0);assert.equal(result.mismatch,1);
});
