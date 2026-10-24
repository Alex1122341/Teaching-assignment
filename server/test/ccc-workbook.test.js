'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),ExcelJS=require('exceljs');
const headers=['Faculty ID','Faculty Name','Start Date','End Date','Course Code','Label'];
async function book(rows=[],options={}){const b=new ExcelJS.Workbook(),s=b.addWorksheet(options.sheet||'CCC');s.addRow(options.headers||headers);for(const row of rows)s.addRow(row);return Buffer.from(await b.xlsx.writeBuffer());}
const row=['','Synthetic Faculty','2026-10-15','2026-10-15','206','CCC'];
test('strict CCC workbook preserves dates, source hash and explicit missing times',async()=>{
 const {parseCccWorkbook}=require('../src/calendar/ccc-workbook');const r=await parseCccWorkbook(await book([row]),'2026-2027');assert.equal(r.academicYear,'2026-27');assert.equal(r.rows.length,1);assert.deepEqual(r.rows[0].issues,[]);assert.equal(r.rows[0].startDate,'2026-10-15');assert.equal(r.rows[0].facultySourceName,'Synthetic Faculty');assert.match(r.sourceSha256,/^[A-F0-9]{64}$/);assert.equal(r.rows[0].startTime,undefined);
});
test('CCC workbook rejects unknown sheet/headers, empty sources and archive limits',async()=>{
 const {parseCccWorkbook}=require('../src/calendar/ccc-workbook');for(const b of [await book([row],{sheet:'AFC records'}),await book([row],{headers:['Unknown']}),await book([]),Buffer.alloc(524289)])await assert.rejects(parseCccWorkbook(b,'2026-27'));
});
test('CCC workbook exposes invalid dates, formulas, identities and year violations as blocking rows',async()=>{
 const {parseCccWorkbook}=require('../src/calendar/ccc-workbook');const bad=[['','', '2026-02-30','2026-10-14','206','CCC'],['','Synthetic Faculty',{formula:'TODAY()',result:'2026-10-15'},'2026-10-15','','CCC'],['','Synthetic Faculty','2027-05-01','2027-05-02','','CCC']];const r=await parseCccWorkbook(await book(bad),'2026-27');for(const x of r.rows)assert.ok(x.issues.length);assert.ok(r.rows[1].issues.includes('FORMULA_NOT_ALLOWED'));assert.ok(r.rows[2].issues.includes('OUTSIDE_ACADEMIC_YEAR'));
});
test('CCC workbook preserves complete date ranges and flags duplicate source rows',async()=>{
 const {parseCccWorkbook}=require('../src/calendar/ccc-workbook');const range=[...row];range[2]=new Date('2026-10-15T00:00:00Z');range[3]=new Date('2026-10-17T00:00:00Z');const r=await parseCccWorkbook(await book([range,range]),'2026-27');assert.equal(r.rows[0].endDate,'2026-10-17');assert.ok(r.rows.every(x=>x.issues.includes('DUPLICATE_SOURCE_ROW')));
});
test('CCC template rejects extra headers and hidden sheets',async()=>{
 const {parseCccWorkbook}=require('../src/calendar/ccc-workbook');
 await assert.rejects(parseCccWorkbook(await book([row],{headers:[...headers,'Unknown']}),'2026-27'),{code:'INVALID_CCC_SOURCE'});
 const b=new ExcelJS.Workbook(),s=b.addWorksheet('CCC',{state:'hidden'});s.addRow(headers);s.addRow(row);
 await assert.rejects(parseCccWorkbook(Buffer.from(await b.xlsx.writeBuffer()),'2026-27'),{code:'INVALID_CCC_SOURCE'});
});
test('CCC identity/name/label values cannot silently become missing/default text',async()=>{
 const {parseCccWorkbook}=require('../src/calendar/ccc-workbook');
 const rows=[row.map((v,i)=>i===0?123:v),row.map((v,i)=>i===1?123:v),row.map((v,i)=>i===5?123:v),row.map((v,i)=>i===4?{text:'206',hyperlink:'https://example.test'}:v)];
 const r=await parseCccWorkbook(await book(rows),'2026-27');assert.ok(r.rows.every(x=>x.issues.includes('INVALID_CELL_TYPE')));
});
test('CCC unknown-column-only rows cannot disappear from a complete replacement source',async()=>{
 const {parseCccWorkbook}=require('../src/calendar/ccc-workbook');
 for(const extra of ['Unrecognized activity',{formula:'TODAY()',result:100}]){const b=new ExcelJS.Workbook(),s=b.addWorksheet('CCC');s.addRow(headers);s.addRow(row);s.getCell('G3').value=extra;const result=await parseCccWorkbook(Buffer.from(await b.xlsx.writeBuffer()),'2026-27');assert.equal(result.rows.length,2);assert.ok(result.rows[1].issues.includes('EXTRA_COLUMNS'));if(typeof extra==='object')assert.ok(result.rows[1].issues.includes('FORMULA_NOT_ALLOWED'));}
});
