'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createAfcFormApi}=require('../src/afc/afc-form-api');
const {createDashboardApi}=require('../src/data/dashboard-api');
const {createSqlAfcWriteRepository}=require('../src/data/sql-afc-write-repository');
const F='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',DOC='dddddddd-dddd-4ddd-8ddd-dddddddddddd',bytes=Buffer.from('%PDF-synthetic'),meta={documentId:DOC,facultyId:F,fileName:'AFC.pdf',pageCount:1,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
test('faculty/hicc/visc may list and download only their own originals, never upload or select another faculty',async()=>{
 for(const role of ['faculty','hicc','visc']){
  const calls=[];let record=meta;
  const api=createAfcFormApi({verifyToken:async()=>({uid:'self'}),findUser:async()=>({active:true,baseRole:role,facultyId:F}),writeGates:{afcFormUpload:true},repository:{list:async p=>{calls.push(p);return {documents:[record],nextCursor:null};},get:async()=>({...record,pdfBytes:bytes})}});
  assert.deepEqual((await api.capabilities('t')).body,{read:true,upload:false,maxBytes:2097152,contentType:'application/pdf'});
  assert.equal((await api.list('t',{facultyId:F})).status,200);assert.equal((await api.list('t',{facultyId:OTHER})).status,403);assert.equal(calls.length,1);
  assert.equal((await api.get('t',DOC)).status,200);record={...meta,facultyId:OTHER};assert.equal((await api.get('t',DOC)).status,404);
  assert.equal((await api.upload('t',{})).status,403);
 }
});
test('a live identity change during PDF retrieval prevents releasing binary data',async()=>{
 let profile={active:true,baseRole:'faculty',facultyId:F},called=0;
 const api=createAfcFormApi({verifyToken:async()=>({uid:'self'}),findUser:async()=>profile,repository:{get:async()=>{called++;profile={...profile,facultyId:OTHER};return {...meta,pdfBytes:bytes};}}});
 const r=await api.get('t',DOC);assert.equal(called,1);assert.equal(r.status,403);assert.equal(r.document,undefined);
});
test('manual AFC optional PDF is validated and passed to the scoped transactional create procedure',async()=>{
 const calls=[],api=createDashboardApi({verifyToken:async()=>({uid:'admin'}),findUser:async()=>({active:true,baseRole:'owner',displayName:'Admin'}),repository:{},writeGates:{afcSingle:true,afcFormUpload:true},writeRepository:{createAfcRecord:async p=>{calls.push(p);return {...p,sourceKind:'manual',active:true,documentId:p.documentId};}}});
 const input={facultyId:F,startDate:'2026-11-01',endDate:'2026-11-02',reasonCode:'vacation',documentId:DOC};
 const r=await api.createAfcRecord('t',input);assert.equal(r.status,201);assert.equal(calls[0].documentId,DOC);assert.equal(r.body.afcRecord.documentId,DOC);
 assert.equal((await api.createAfcRecord('t',{...input,documentId:'spoof'})).status,400);assert.equal(calls.length,1);
 const dbCalls=[],repo=createSqlAfcWriteRepository({query:async(sql,params)=>{dbCalls.push({sql,params});return [{afcRecordId:F}];}});await repo.createAfcRecord({...calls[0],documentId:DOC});assert.match(dbCalls[0].sql,/paws_api.CreateAfcRecordWithDocument/);assert.equal(dbCalls[0].params.documentId,DOC);
});
test('PDF create requires both existing AFC and archive gates before any create call',async()=>{
 let calls=0;const api=createDashboardApi({verifyToken:async()=>({uid:'admin'}),findUser:async()=>({active:true,baseRole:'owner'}),repository:{},writeGates:{afcSingle:true,afcFormUpload:false},writeRepository:{createAfcRecord:async()=>{calls++;}}});
 assert.equal((await api.createAfcRecord('t',{facultyId:F,startDate:'2026-11-01',endDate:'2026-11-02',reasonCode:'vacation',documentId:DOC})).status,503);assert.equal(calls,0);
});
