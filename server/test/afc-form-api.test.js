'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createAfcFormApi}=require('../src/afc/afc-form-api');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',bytes=Buffer.from('synthetic'),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
const upload={requestId:ID,facultyId:ID,fileName:'form.pdf',contentType:'application/pdf',fileBase64:bytes.toString('base64')};
function harness({role='administrator',active=true,mustChangePassword=false,gate=true,failure}={}){
 let parsed=0;const calls=[];const meta={documentId:ID,facultyId:ID,fileName:'form.pdf',byteLength:bytes.length,pageCount:1,sha256,createdAtUtc:'2026-10-17T12:00:00Z',privateKey:'secret',createdByUid:'secret'};
 const api=createAfcFormApi({verifyToken:async t=>{if(t!=='ok')throw Error('secret');return {uid:'actor'};},findUser:async()=>({baseRole:role,active,mustChangePassword,facultyId:ID}),writeGates:{afcFormUpload:gate},validatePdf:async()=>{parsed++;return {sha256,pageCount:1,byteLength:bytes.length};},repository:Object.fromEntries(['upload','list','get'].map(method=>[method,async args=>{calls.push({method,args});if(failure)throw failure;return method==='list'?{documents:[meta],nextCursor:null}:method==='get'?{...meta,pdfBytes:bytes}:meta;}]))});
 return {api,calls,parsed:()=>parsed};
}
test('AFC upload checks token, SQL profile, role and independent gate before parsing',async()=>{
 for(const options of [{role:'faculty'},{role:'hicc'},{role:'lab'},{active:false},{mustChangePassword:true},{gate:false}]){const h=harness(options);assert.ok([403,503].includes((await h.api.upload('ok',upload)).status));assert.equal(h.parsed(),0);assert.equal(h.calls.length,0);}
 assert.equal((await harness().api.upload('bad',upload)).status,401);
});
test('AFC forms authorize every metadata/download call and strip private repository fields',async()=>{
 for(const role of ['lab']){const h=harness({role});assert.equal((await h.api.list('ok',{facultyId:ID})).status,403);assert.equal((await h.api.get('ok',ID)).status,403);assert.equal(h.calls.length,0);}
 const h=harness();const r=await h.api.list('ok',{facultyId:ID});assert.equal(r.status,200);assert.doesNotMatch(JSON.stringify(r.body),/secret|createdByUid|privateKey/);assert.equal(h.calls[0].args.actorFirebaseUid,'actor');
});
test('AFC forms require strict upload fields, canonical base64, PDF extension and bounded size',async()=>{
 const h=harness();for(const patch of [{actorFirebaseUid:'spoof'},{reason:'private'},{fileName:'../x.pdf'},{fileName:'x.html'},{contentType:'text/html'},{facultyId:'wrong'},{fileBase64:'AB=='},{fileBase64:Buffer.alloc(2097153).toString('base64')}])assert.ok([400,413].includes((await h.api.upload('ok',{...upload,...patch})).status));assert.equal(h.parsed(),0);
 const r=await h.api.upload('ok',upload);assert.equal(r.status,201);assert.equal(h.parsed(),1);assert.equal(h.calls[0].args.requestId,ID);assert.deepEqual(h.calls[0].args.pdfBytes,bytes);assert.doesNotMatch(JSON.stringify(r.body),/secret/);
});
test('download detects mismatched bytes and returns safe fixed errors',async()=>{
 const h=harness({failure:{number:54803,message:'confidential SQL details'}});const r=await h.api.get('ok',ID);assert.equal(r.status,404);assert.doesNotMatch(JSON.stringify(r),/confidential/);
 const ok=harness();assert.equal((await ok.api.get('ok',ID)).status,200);
 for(const q of [{},{facultyId:ID,limit:'101'},{facultyId:ID,cursor:'invalid'},{facultyId:ID,ucid:'private'}])assert.equal((await ok.api.list('ok',q)).status,400);
});
