'use strict';
require('node:test')('duplicate JSON properties, including escaped nested keys, are rejected before API dispatch',async()=>{
 const h=harness(),assert=require('node:assert/strict');
 for(const body of ['{"academicYear":"2026-27","academicYear":"2027-28","datasets":[]}','{"datasets":[{"filters":[{"field":"remainingDoe","op":"gte","value":0}],"filt\\u0065rs":[]}]}','{"datasets":[{"sort":{"field":"facultyName","field":"remainingDoe"}}]}'])assert.equal((await h.handle(request('query',{method:'POST',headers:{'content-type':'application/json'},body}))).status,400);
 const onlyParsed={url:'http://local/api/v1/reports/query',method:'POST',headers:new Headers({'content-type':'application/json'}),json:async()=>({})};assert.equal((await h.handle(onlyParsed)).status,400);assert.equal(h.calls.length,0);
});
const test=require('node:test'),assert=require('node:assert/strict');
const {createReportFunctions}=require('../src/runtime/swa-report-functions');
function harness(){const calls=[],api=Object.fromEntries(['catalog','query','page','export'].map(method=>[method,async(...args)=>{calls.push({method,args});return {status:200,body:{method}};}]));return {calls,handle:createReportFunctions({api})};}
const request=(path,options={})=>new Request('https://paws.test/api/v1/reports/'+path,{...options,headers:{authorization:'Bearer credential',...(options.headers||{})}});
test('report wrapper dispatches only the specified methods and never caches private responses',async()=>{
 const h=harness(),payload={academicYear:'2026-27',datasets:[]};
 const response=await h.handle(request('query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));assert.equal(response.status,200);assert.equal(response.headers['Cache-Control'],'private, no-store');assert.deepEqual(h.calls[0],{method:'query',args:['credential',payload]});
 assert.equal((await h.handle(request('catalog'))).status,200);const wrong=await h.handle(request('query'));assert.equal(wrong.status,405);assert.equal(wrong.headers.Allow,'POST');assert.equal((await h.handle(request('missing'))).status,404);
});
test('duplicate/unregistered URL fields and malformed or oversized JSON never reach the API',async()=>{
 const h=harness();for(const path of ['catalog?other=x','page?snapshot=x&source=workload&offset=0&offset=50','export?snapshot=x&format=csv&sql=secret'])assert.equal((await h.handle(request(path))).status,400);
 assert.equal((await h.handle(request('query',{method:'POST',headers:{'content-type':'application/json'},body:'broken'}))).status,400);
 assert.equal((await h.handle(request('query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:'x'.repeat(65536)})}))).status,413);assert.equal(h.calls.length,0);
 const page=await h.handle(request('page?snapshot=opaque&source=workload&offset=50'));assert.equal(page.status,200);assert.deepEqual(h.calls[0].args,['credential',{snapshot:'opaque',source:'workload',offset:'50'}]);
});
