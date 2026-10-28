'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReportApi}=require('../src/reports/report-api');
const definition=()=>({academicYear:'2026-27',datasets:[{source:'workload',columns:['facultyName','remainingDoe']}]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
test('global query and snapshot caps reject busy reads and evict the oldest private preview',async()=>{
 const h=harness(),pending=deferred();for(let i=0;i<10;i++)h.state.profiles.set('admin'+i,{active:true,baseRole:'administrator'});
 h.state.load=()=>pending.promise;const first=h.api.query('owner',definition()),second=h.api.query('admin',definition());await tick();assert.equal((await h.api.query('admin0',definition())).status,429);
 pending.resolve({tables:{workload:{rows:h.rows,coverage:[]}}});const [a,b]=await Promise.all([first,second]);assert.equal(a.status,200);assert.equal(b.status,200);
 h.state.load=async()=>({tables:{workload:{rows:[],coverage:[]}}});for(let i=0;i<7;i++)assert.equal((await h.api.query('admin'+i,definition())).status,200);
 assert.equal((await h.api.page('owner',{snapshot:a.body.snapshot,source:'workload',offset:0})).status,409);assert.equal((await h.api.page('admin',{snapshot:b.body.snapshot,source:'workload',offset:0})).status,200);
});
test('Excel exports all selected tables, and expired or malformed renderings never return bytes',async()=>{
 const h=harness();h.state.load=async()=>({tables:{workload:{rows:h.rows,coverage:[]},roles:{rows:[{facultyName:'Example, Alex'}],coverage:[]}}});
 const result=await h.api.query('owner',{academicYear:'2026-27',datasets:[definition().datasets[0],{source:'roles',columns:['facultyName']}]});
 assert.equal((await h.api.export('owner',{snapshot:result.body.snapshot,format:'xlsx',source:'workload'})).status,400);
 h.state.render=async(tables)=>{assert.deepEqual(tables.map(t=>t.source),['workload','roles']);return {bytes:Buffer.from('excel'),contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',fileName:'paws-reports.xlsx'};};
 const file=await h.api.export('owner',{snapshot:result.body.snapshot,format:'xlsx'});assert.equal(file.status,200);assert.deepEqual(file.body.rowCounts,{workload:73,roles:1});
 h.state.render=async()=>({bytes:Buffer.from('secret'),contentType:'text/csv',fileName:'../../secret.csv'});assert.equal((await h.api.export('owner',{snapshot:result.body.snapshot,format:'csv',source:'workload'})).status,503);
 h.state.render=async()=>{h.state.now+=600000;return {bytes:Buffer.from('secret'),contentType:'text/csv',fileName:'paws-reports.csv'};};const expired=await h.api.export('owner',{snapshot:result.body.snapshot,format:'csv',source:'workload'});assert.equal(expired.status,409);assert.equal(expired.body.fileBase64,undefined);
});
test('projected memory limits fail without a snapshot and response mutation cannot alter cached pages',async()=>{
 const h=harness(),first=await h.api.query('owner',definition());first.body.tables[0].rows[0][0]='CHANGED';assert.equal((await h.api.page('owner',{snapshot:first.body.snapshot,source:'workload',offset:0})).body.rows[0][0],'Example, 000');
 h.state.load=async()=>({tables:{workload:{rows:Array.from({length:300},()=>({facultyName:'x'.repeat(30000),remainingDoe:0})),coverage:[]}}});const large=await h.api.query('owner',definition());assert.equal(large.status,413);assert.equal(large.body.snapshot,undefined);
});
function harness(){
 const state={now:Date.parse('2026-10-25T23:00:00.000Z'),profiles:new Map([['owner',{active:true,baseRole:'owner'}],['admin',{active:true,baseRole:'administrator'}],['faculty',{active:true,baseRole:'faculty',facultyId:'linked'}],['hicc',{active:true,baseRole:'hicc',facultyId:'linked'}],['office',{active:true,baseRole:'adc'}],['inactive',{active:false,baseRole:'owner'}]]),reads:0,serial:0};
 const rows=Array.from({length:73},(_,i)=>({facultyName:'Example, '+String(i).padStart(3,'0'),remainingDoe:i,privateId:'HIDDEN'}));
 state.load=async()=>{state.reads++;return {tables:{workload:{rows,coverage:['Current authorized records only']}}};};
 state.render=async()=>({bytes:Buffer.from('file'),contentType:'text/csv',fileName:'paws-reports.csv'});
 const api=createReportApi({verifyToken:async token=>token?{uid:token}:null,findUser:async uid=>state.profiles.get(uid),clock:()=>state.now,randomId:()=> '00000000-0000-4000-8000-'+String(++state.serial).padStart(12,'0'),loadSources:options=>state.load(options),renderExport:(...args)=>state.render(...args)});
 return {state,api,rows};
}
test('only active existing administrator roles reach catalog or source readers',async()=>{
 const h=harness();assert.equal((await h.api.catalog('')).status,401);
 for(const token of ['faculty','hicc','office','inactive']){assert.equal((await h.api.catalog(token)).status,403);assert.equal((await h.api.query(token,definition())).status,403);}
 assert.equal(h.state.reads,0);assert.equal((await h.api.catalog('owner')).status,200);assert.equal((await h.api.catalog('admin')).status,200);
 const bad=await h.api.query('owner',{...definition(),sql:'SELECT confidential'});assert.equal(bad.status,400);assert.equal(h.state.reads,0);
});
test('role changes during reads discard the result and invalidate older private previews',async()=>{
 const h=harness(),first=await h.api.query('owner',definition()),pending=deferred();h.state.load=()=>pending.promise;
 const next=h.api.query('owner',definition());await tick();h.state.profiles.set('owner',{active:true,baseRole:'faculty',facultyId:'linked'});pending.resolve({tables:{workload:{rows:h.rows,coverage:[]}}});
 const rejected=await next;assert.equal(rejected.status,403);assert.equal(rejected.body.snapshot,undefined);
 h.state.profiles.set('owner',{active:true,baseRole:'owner'});assert.equal((await h.api.page('owner',{snapshot:first.body.snapshot,source:'workload',offset:0})).status,409);
});
test('snapshot expiry and per-actor eviction are bounded, with source expiry taking precedence',async()=>{
 const h=harness(),a=await h.api.query('owner',definition()),b=await h.api.query('owner',definition()),c=await h.api.query('owner',definition());
 assert.equal((await h.api.page('owner',{snapshot:a.body.snapshot,source:'workload',offset:0})).status,409);assert.equal((await h.api.page('owner',{snapshot:b.body.snapshot,source:'workload',offset:0})).status,200);
 h.state.now+=600000;assert.equal((await h.api.page('owner',{snapshot:c.body.snapshot,source:'workload',offset:0})).status,409);
 h.state.load=async()=>({tables:{workload:{rows:h.rows,coverage:[]}},expiresAt:'2026-10-25T23:11:00.000Z'});
 const shorter=await h.api.query('owner',definition());assert.equal(shorter.body.expiresAt,'2026-10-25T23:11:00.000Z');h.state.now+=60000;assert.equal((await h.api.page('owner',{snapshot:shorter.body.snapshot,source:'workload',offset:0})).status,409);
});
test('queries reject concurrent actor work and source failures never expose internal errors',async()=>{
 const h=harness(),pending=deferred();h.state.load=()=>pending.promise;const query=h.api.query('owner',definition());await tick();assert.equal((await h.api.query('owner',definition())).status,429);pending.resolve({tables:{workload:{rows:h.rows,coverage:[]}}});assert.equal((await query).status,200);
 h.state.load=async()=>{throw Error('SECRET DATABASE DETAILS');};const failure=await h.api.query('owner',definition());assert.equal(failure.status,503);assert.doesNotMatch(JSON.stringify(failure),/SECRET/);
});
test('CSV export is restricted to a previewed table and rechecks auth after asynchronous rendering',async()=>{
 const h=harness(),result=await h.api.query('owner',definition());
 assert.equal((await h.api.export('owner',{snapshot:result.body.snapshot,source:'schedule',format:'csv'})).status,403);
 const file=await h.api.export('owner',{snapshot:result.body.snapshot,source:'workload',format:'csv'});assert.equal(file.status,200);assert.equal(file.body.rowCounts.workload,73);assert.equal(Buffer.from(file.body.fileBase64,'base64').toString(),'file');
 const pending=deferred();h.state.render=()=>pending.promise;const exporting=h.api.export('owner',{snapshot:result.body.snapshot,source:'workload',format:'csv'});await tick();assert.equal((await h.api.export('owner',{snapshot:result.body.snapshot,source:'workload',format:'csv'})).status,429);
 h.state.profiles.set('owner',{active:false,baseRole:'owner'});pending.resolve({bytes:Buffer.from('PRIVATE'),fileName:'paws-reports.csv',contentType:'text/csv'});const denied=await exporting;assert.equal(denied.status,403);assert.equal(denied.body.fileBase64,undefined);
});
test('one immutable selected-column snapshot drives full counts and fifty-row pages',async()=>{
 const h=harness(),result=await h.api.query('owner',definition());assert.equal(result.status,200);assert.match(result.body.snapshot,/^[0-9a-f-]{36}$/);
 assert.equal(result.body.academicYear,'2026-27');assert.equal(result.body.tables[0].total,73);assert.equal(result.body.tables[0].rows.length,50);assert.deepEqual(result.body.tables[0].rows[0],['Example, 000',0]);assert.doesNotMatch(JSON.stringify(result.body),/HIDDEN|privateId/);
 h.rows[50].remainingDoe=999;
 const page=await h.api.page('owner',{snapshot:result.body.snapshot,source:'workload',offset:50});assert.equal(page.status,200);assert.equal(page.body.rows.length,23);assert.deepEqual(page.body.rows[0],['Example, 050',50]);assert.equal(page.body.expiresAt,'2026-10-25T23:10:00.000Z');
 assert.equal((await h.api.page('owner',{snapshot:result.body.snapshot,source:'schedule',offset:0})).status,403);
 assert.equal((await h.api.page('owner',{snapshot:result.body.snapshot,source:'workload',offset:1})).status,400);
 assert.equal((await h.api.page('admin',{snapshot:result.body.snapshot,source:'workload',offset:0})).status,403);
});
