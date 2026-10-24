'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('AFC form route adapter has exact paths/methods and fixed binary attachment headers',async()=>{
 const {createAfcFormFunctions}=require('../src/runtime/swa-afc-form-functions');const calls=[];
 const route=createAfcFormFunctions({api:{capabilities:async()=>({status:200,body:{upload:true}}),list:async(t,q)=>{calls.push(q);return {status:200,body:{documents:[]}};},upload:async(t,p)=>({status:201,body:p}),get:async()=>({status:200,document:{pdfBytes:Buffer.from('%PDF synthetic'),byteLength:14}})}});
 assert.equal((await route(new Request('http://localhost/api/v1/afc-forms/capabilities'))).status,200);
 assert.equal((await route(new Request('http://localhost/api/v1/afc-forms?facultyId='+ID))).status,200);
 assert.equal(calls[0].facultyId,ID);
 const r=await route(new Request('http://localhost/api/v1/afc-forms/'+ID+'/document'));assert.equal(r.status,200);assert.match(r.headers['Content-Disposition'],/attachment/);assert.equal(r.headers['Cache-Control'],'private, no-store');
 assert.equal((await route(new Request('http://localhost/api/v1/afc-forms/'+ID+'/document',{method:'POST'}))).status,405);
 assert.equal((await route(new Request('http://localhost/api/v1/afc-forms?facultyId='+ID+'&facultyId='+ID))).status,400);
});
test('real University HTTP permits only exact upload route to expand JSON cap and exact document route for binary',async t=>{
 const {createUniversityHttpServer}=require('../src/runtime/university-http-server');
 const s=createUniversityHttpServer({env:{PAWS_RELEASE_SHA:'a'.repeat(40),PAWS_RUNTIME_TRUST_ANCHOR:'b'.repeat(40)},runtime:async r=>new URL(r.url).pathname.endsWith('/document')?{status:200,binaryBody:Buffer.from('%PDF synthetic')}:{status:201,jsonBody:{length:(await r.json()).x.length}}});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());const root='http://127.0.0.1:'+s.address().port;
 const body=JSON.stringify({x:'A'.repeat(1200000)}),headers={'content-type':'application/json'};
 assert.equal((await fetch(root+'/api/v1/afc-forms',{method:'POST',headers,body})).status,201);
 for(const path of ['/api/v1/afc-forms/','/api/v1/afc-forms/capabilities','/api/v1/me'])assert.equal((await fetch(root+path,{method:'POST',headers,body})).status,413);
 const pdf=await fetch(root+'/api/v1/afc-forms/'+ID+'/document');assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-disposition'),/afc-form-/);assert.equal(pdf.headers.get('content-security-policy'),"sandbox; default-src 'none'");
});
