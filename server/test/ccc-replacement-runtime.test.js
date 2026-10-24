'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('CCC routes are exact, query-free and never expose recovery route',async()=>{
 const {createCccReplacementFunctions}=require('../src/runtime/swa-ccc-replacement-functions');const calls=[];
 const api=Object.fromEntries(['capabilities','stage','get','preview','commit'].map(name=>[name,async(...args)=>{calls.push({name,args});return {status:200,body:{ok:true}};}]));const route=createCccReplacementFunctions({api});
 for(const [path,method] of [['/capabilities','GET'],['','POST'],['/'+ID,'GET'],['/'+ID+'/preview','POST'],['/'+ID+'/commit','POST']])assert.equal((await route(new Request('http://localhost/api/v1/ccc-replacements'+path,{method,headers:{authorization:'Bearer verified'},...(method==='POST'?{body:'{}'}:{})}))).status,200);
 assert.equal(calls[0].args[0],'verified');
 for(const path of ['/'+ID+'/recover','/'+ID+'/receipt','/'])assert.equal((await route(new Request('http://localhost/api/v1/ccc-replacements'+path))).status,404);
 assert.equal((await route(new Request('http://localhost/api/v1/ccc-replacements/'+ID+'?actor=spoof'))).status,400);
 assert.equal((await route(new Request('http://localhost/api/v1/ccc-replacements/'+ID+'/commit',{method:'POST',body:'broken'}))).status,400);
});
test('CCC stage alone has the 1MiB JSON limit through the University HTTP boundary',async t=>{
 const {createUniversityHttpServer}=require('../src/runtime/university-http-server');
 const server=createUniversityHttpServer({env:{PAWS_RELEASE_SHA:'a'.repeat(40),PAWS_RUNTIME_TRUST_ANCHOR:'b'.repeat(40)},runtime:async()=>({status:200,jsonBody:{ok:true}})});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const root='http://127.0.0.1:'+server.address().port,headers={'content-type':'application/json'},body=JSON.stringify({x:'A'.repeat(800000)});
 assert.equal((await fetch(root+'/api/v1/ccc-replacements',{method:'POST',headers,body})).status,200);
 for(const path of ['/api/v1/ccc-replacements/','/api/v1/ccc-replacements/'+ID+'/commit'])assert.equal((await fetch(root+path,{method:'POST',headers,body})).status,413);
 assert.equal((await fetch(root+'/api/v1/ccc-replacements',{method:'POST',headers,body:JSON.stringify({x:'A'.repeat(1048576)})})).status,413);
});
