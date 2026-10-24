'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),ExcelJS=require('exceljs');
const {createCccReplacementApi}=require('../src/calendar/ccc-replacement-api');
const {createCccReplacementFunctions}=require('../src/runtime/swa-ccc-replacement-functions');
test('authorized read-only template download yields a genuine header-only CCC workbook accepted after completion',async()=>{
 const route=createCccReplacementFunctions({api:createCccReplacementApi({verifyToken:async()=>({uid:'owner'}),findUser:async()=>({active:true,baseRole:'owner'}),repository:{stage(){throw Error('Template must never stage');}},writeGates:{cccReplaceStage:false,cccReplaceCommit:false}})});
 const r=await route(new Request('https://paws.invalid/api/v1/ccc-replacements/template',{headers:{authorization:'Bearer token'}}));assert.equal(r.status,200);assert.equal(r.jsonBody.fileName,'CCC-template.xlsx');assert.match(r.jsonBody.contentType,/spreadsheetml/);
 const b=new ExcelJS.Workbook();await b.xlsx.load(Buffer.from(r.jsonBody.fileBase64,'base64'));assert.equal(b.worksheets.length,1);const s=b.getWorksheet('CCC');assert.ok(s);assert.equal(s.rowCount,1);assert.deepEqual(s.getRow(1).values.slice(1),['Faculty ID','Faculty Name','Start Date','End Date','Course Code','Label']);
 const {parseCccWorkbook}=require('../src/calendar/ccc-workbook');await assert.rejects(parseCccWorkbook(Buffer.from(r.jsonBody.fileBase64,'base64'),'2026-27'),{code:'INVALID_CCC_SOURCE'});
 s.addRow(['','Synthetic Faculty','2026-11-01','2026-11-03','206','CCC']);const parsed=await parseCccWorkbook(Buffer.from(await b.xlsx.writeBuffer()),'2026-27');assert.equal(parsed.rows.length,1);assert.deepEqual(parsed.rows[0].issues,[]);
});
test('CCC template remains administrator-only and the template route is exact GET without injected parameters',async()=>{
 const route=createCccReplacementFunctions({api:createCccReplacementApi({verifyToken:async()=>({uid:'faculty'}),findUser:async()=>({active:true,baseRole:'faculty',facultyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),repository:{}})});
 assert.equal((await route(new Request('https://paws.invalid/api/v1/ccc-replacements/template',{headers:{authorization:'Bearer token'}}))).status,403);
 assert.equal((await route(new Request('https://paws.invalid/api/v1/ccc-replacements/template'))).status,401);
 assert.equal((await route(new Request('https://paws.invalid/api/v1/ccc-replacements/template?faculty=other'))).status,400);
 assert.equal((await route(new Request('https://paws.invalid/api/v1/ccc-replacements/template',{method:'POST'}))).status,405);
});
